/**
 * Guild MCP Manager: On-demand connection pool for per-guild remote MCP servers.
 *
 * Singleton that manages lazy (production) or eager (dev) connections to remote
 * MCP servers registered by guild admins. Each connection is keyed by
 * "${serverId}:${name}" and auto-evicted after a configurable idle TTL.
 *
 * Streamable HTTP, SSE, and Smithery Connect share pinned URL validation and response-byte limits.
 */

import { Client as MCPClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { type CallableTool, mcpToTool } from "@google/genai";
import { log } from "@/utils/misc/logger";
import type { GuildMcpServerRow } from "@/types/db/schema";
import type {
  GuildMCPConnection,
  GuildMCPTestResult,
  TypedMCPToolResult,
  MCPServerResponse,
} from "@/types/tool/mcpTypes";
import type { ToolContext } from "@/types/tool/interfaces";
import { getGuildMcpConfigReadResult } from "@/utils/cache/guildMcpConfigCache";
import { toolRepository } from "@/utils/db/repositories/ToolRepository";
import { sendToolNotice } from "@/utils/discord/toolProgressNotice";
import { sendFetchProgressNotice } from "@/tools/fetchUrl/fetchProgressNotice";
import { validateRemoteUrl } from "@/utils/security/remoteUrlSecurity";
import { localizer } from "@/utils/text/localizer";
import { ToolRegistry } from "@/tools/toolRegistry";
import { refreshToolExecutionContext } from "@/tools/availability";
import { configToFeatureFlags } from "@/utils/tools/featureFlagMapper";
import { validateFetchUrlTarget } from "@/tools/fetchUrl/urlSafety";
import { createGuildMcpFetch } from "@/utils/mcp/guildMcpFetch";
import { connectSmithery, isSmitheryUrl } from "@/utils/mcp/smitheryConnection";

interface GuildMcpRoute {
  config: GuildMcpServerRow;
  connection: GuildMCPConnection;
}

export interface GuildMcpRouting {
  routes: Map<string, GuildMcpRoute>;
  replaced: Set<string>;
}

async function validateReplacementUrls(value: unknown, schema: unknown, propertyName = ""): Promise<void> {
  if (!schema || typeof schema !== "object") return;
  const definition = schema as Record<string, unknown>;
  if (typeof value === "string" && (definition.format === "uri" || /^(url|uri|urls)$/i.test(propertyName))) {
    const result = await validateFetchUrlTarget(value);
    if (!result.allowed) throw new Error(result.error);
  }
  if (Array.isArray(value)) {
    for (const item of value) await validateReplacementUrls(item, definition.items, propertyName);
  } else if (value && typeof value === "object" && definition.properties && typeof definition.properties === "object") {
    for (const [name, childSchema] of Object.entries(definition.properties)) {
      await validateReplacementUrls((value as Record<string, unknown>)[name], childSchema, name);
    }
  }
}

/** How long an idle connection lives before eviction (default: 10 min) */
const CONNECTION_TTL_MS = (Number(process.env.GUILD_MCP_CONNECTION_TTL_MINUTES) || 10) * 60 * 1000;

/** Timeout for initial connect + tool discovery (default: 15s) */
const CONNECT_TIMEOUT_MS = Number(process.env.GUILD_MCP_CONNECT_TIMEOUT_MS) || 15_000;

/** Timeout for individual tool execution calls (default: 30s) */
const EXECUTION_TIMEOUT_MS = Number(process.env.GUILD_MCP_EXECUTION_TIMEOUT_MS) || 30_000;

/**
 * How long a server that failed to connect is quarantined before it may be
 * re-dialed (default: 5 min). This is the circuit breaker that stops one
 * unreachable server from re-paying the full connect timeout on every
 * generation (and every fallback-model attempt), which otherwise stalls chat.
 */
const CONNECT_FAILURE_COOLDOWN_MS = Number(process.env.GUILD_MCP_FAILURE_COOLDOWN_MS) || 5 * 60_000;

/** Eviction sweep interval (60s) */
const EVICTION_INTERVAL_MS = 60_000;

class GuildMcpManager {
  private static instance: GuildMcpManager;

  /**
   * Active connections keyed by "${serverId}:${serverName}".
   * Each entry holds the MCP client, CallableTool, and timing metadata.
   */
  private pool = new Map<string, GuildMCPConnection>();

  /** Interval handle for the TTL eviction sweep */
  private evictionTimer: ReturnType<typeof setInterval> | null = null;

  /** Set of pool keys currently being connected (prevents duplicate connect races) */
  private connectingKeys = new Set<string>();

  /**
   * Circuit breaker: pool key → epoch-ms timestamp until which the server is
   * quarantined after a failed connect. Cleared on successful connect, on
   * explicit disconnect, and once the cooldown elapses.
   */
  private connectFailures = new Map<string, number>();

  private constructor() {
    this.evictionTimer = setInterval(() => this.evictIdleConnections(), EVICTION_INTERVAL_MS);
  }

  static getInstance(): GuildMcpManager {
    if (!GuildMcpManager.instance) {
      GuildMcpManager.instance = new GuildMcpManager();
    }
    return GuildMcpManager.instance;
  }

  /** Raw names never grant ownership; only one selected registration can replace its own family. */
  async getGuildMCPRouting(serverId: number): Promise<GuildMcpRouting> {
    const read = await getGuildMcpConfigReadResult(serverId);
    if (read.status !== "fresh") throw new Error("Current MCP registrations unavailable");
    const configs = read.configs.filter((config) => config.server_id === serverId && config.is_enabled);
    const reserved = ToolRegistry.getReservedToolNames();
    const replaced = new Set(
      configs
        .map((config) => config.server_type)
        .filter((type): type is string => type === "url_fetcher" || type === "web_search"),
    );
    const candidates = new Map<string, GuildMcpRoute[]>();
    for (const config of configs) {
      if (
        replaced.has(config.server_type ?? "") &&
        configs.filter((row) => row.server_type === config.server_type).length !== 1
      )
        continue;
      const callable = await this.getRegisteredTool(config);
      const connection = this.pool.get(this.poolKey(serverId, config.name));
      if (!callable || !connection || connection.guildMcpId !== config.guild_mcp_id) continue;
      for (const name of new Set(connection.functionNames)) {
        const replacesOwnFamily =
          (name === "fetch_url" && config.server_type === "url_fetcher") ||
          (name === "web_search" && config.server_type === "web_search");
        if (reserved.has(name) && !replacesOwnFamily) continue;
        const entries = candidates.get(name) ?? [];
        entries.push({ config, connection });
        candidates.set(name, entries);
      }
    }
    return {
      replaced,
      routes: new Map(
        [...candidates]
          .filter(([, entries]) => entries.length === 1)
          .map(([name, entries]) => [name, entries[0] as GuildMcpRoute]),
      ),
    };
  }

  /** Reads the exact connected registration; a same-name replacement cannot inherit its binding. */
  async getRegisteredTool(config: GuildMcpServerRow, privateFailure = false): Promise<CallableTool | null> {
    if (!config.is_enabled) return null;
    const connection =
      this.pool.get(this.poolKey(config.server_id, config.name)) ?? (await this.connectServer(config, privateFailure));
    return connection && connection.guildMcpId === config.guild_mcp_id
      ? (connection.callableTool as CallableTool)
      : null;
  }

  /** The caller revalidates the owned row; dispatch also checks the exact pooled registration. */
  async callInternalRuleChecker(config: GuildMcpServerRow, text: string, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const connection = this.pool.get(this.poolKey(config.server_id, config.name));
    if (!config.is_enabled || !connection || connection.guildMcpId !== config.guild_mcp_id)
      throw new Error("Internal rule registration unavailable");
    connection.lastUsedAt = Date.now();
    return CallToolResultSchema.parse(
      await (connection.client as MCPClient).callTool(
        { name: "check_slop", arguments: { text } },
        CallToolResultSchema,
        {
          signal,
          timeout: EXECUTION_TIMEOUT_MS,
        },
      ),
    );
  }

  async getGuildMCPTools(serverId: number): Promise<CallableTool[]> {
    const { routes } = await this.getGuildMCPRouting(serverId);
    const groups = new Map<GuildMCPConnection, Set<string>>();
    for (const [name, route] of routes) {
      const names = groups.get(route.connection) ?? new Set<string>();
      names.add(name);
      groups.set(route.connection, names);
    }
    return [...groups].map(([connection, names]) => {
      const callable = connection.callableTool as CallableTool;
      return {
        tool: async () => {
          const declaration = await callable.tool();
          return {
            ...declaration,
            functionDeclarations: declaration.functionDeclarations?.filter((tool) => tool.name && names.has(tool.name)),
          };
        },
        callTool: callable.callTool.bind(callable),
      };
    });
  }

  /**
   * Get all discovered function names for a server's guild MCP tools.
   * Used by toolRegistry to build the MCP function name list.
   *
   * @param serverId - Internal server_id
   */
  async getGuildMCPFunctionNames(serverId: number): Promise<string[]> {
    const tools = await this.getGuildMCPTools(serverId);
    const names: string[] = [];

    for (const tool of tools) {
      try {
        const geminiTool = await tool.tool();
        if (geminiTool.functionDeclarations) {
          for (const decl of geminiTool.functionDeclarations) {
            const name = (decl as { name: string }).name;
            names.push(name);
          }
        }
      } catch (error) {
        log.warn("[GuildMcpManager] Failed to extract function names from guild MCP tool", error);
      }
    }

    return names;
  }

  /**
   * Get discovered function names for only the guild MCP servers that advertise
   * a specific `server_type`. This is used by prompt-macro resolution so
   * capability families like web search and URL fetching can point at the
   * exact replacement tool names provided by guild MCP servers.
   *
   * @param serverId - Internal server_id
   */
  async getGuildMCPFunctionNamesByServerType(serverId: number, serverType: string): Promise<string[]> {
    const { routes } = await this.getGuildMCPRouting(serverId);
    return [...routes].filter(([, route]) => route.config.server_type === serverType).map(([name]) => name);
  }

  /**
   * Check if a function name belongs to a guild MCP server for this guild.
   *
   * @param serverId - Internal server_id
   */
  async isGuildMCPFunction(serverId: number, functionName: string): Promise<boolean> {
    const names = await this.getGuildMCPFunctionNames(serverId);
    return names.includes(functionName);
  }

  /**
   * Execute a guild MCP function. Finds the right connection, calls the tool,
   * and returns a standardized TypedMCPToolResult using default MCP processing.
   *
   * @param serverId - Internal server_id
   * @param context - Optional ToolContext for Discord operations
   */
  async executeGuildMCPFunction(
    serverId: number,
    functionName: string,
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<TypedMCPToolResult> {
    const executionStartTime = Date.now();

    try {
      const route = (await this.getGuildMCPRouting(serverId)).routes.get(functionName);
      if (context) {
        const current = await refreshToolExecutionContext(context);
        if (!current || current.tomoriState.config.response_rule_checker_ref?.toolName === functionName)
          return {
            success: false,
            error: localizer(context.locale, "tools.execution.unavailable", { tool: functionName }),
          };
        context = current;
      }
      const conn = route?.connection;
      if (route && (route.config.server_type === "url_fetcher" || route.config.server_type === "web_search")) {
        if (!context || !configToFeatureFlags(context.tomoriState.config).web_search) {
          return {
            success: false,
            error: localizer(context?.locale ?? "en-US", "tools.execution.unavailable", { tool: functionName }),
          };
        }
        const declaration = await (route.connection.callableTool as CallableTool).tool();
        const schema = declaration.functionDeclarations?.find((tool) => tool.name === functionName);
        await validateReplacementUrls(args, schema?.parametersJsonSchema ?? schema?.parameters);
      }
      if (!conn) {
        return {
          success: false,
          message: `Guild MCP function '${functionName}' not found in any connected server`,
          error: `Function '${functionName}' not found`,
          data: {
            source: "mcp",
            functionName,
            serverName: `guild:${serverId}`,
            executionTime: Date.now() - executionStartTime,
            status: "failed",
          },
        };
      }

      if (context?.isExecutionCancelled?.()) return { success: false };
      conn.lastUsedAt = Date.now();

      if (context?.channel && context.locale) {
        try {
          if (route?.config.server_type === "url_fetcher" && typeof args.url === "string") {
            await sendFetchProgressNotice(
              context,
              String(args.url || ""),
              "GuildMcpManager",
              Number(args.start_index) || 0,
            );
          } else {
            const formattedArgs = this.formatMcpArgs(args, context.locale);
            await sendToolNotice(
              context,
              "mcp_tool_call",
              {
                titleKey: "tools.mcp.tool_invoke_title",
                titleVars: { server: conn.name, function: functionName },
                description: formattedArgs,
              },
              "GuildMcpManager",
            );
          }
        } catch (embedError) {
          // Non-critical, so don't block execution if the embed fails
          log.warn(`[GuildMcpManager] Failed to send MCP tool embed for ${functionName}:`, embedError);
        }
      }

      log.info(`[GuildMcpManager] Executing guild MCP function: ${functionName} (server: ${conn.name})`);

      if (context?.isExecutionCancelled?.()) return { success: false };
      const currentRegistration = await getGuildMcpConfigReadResult(serverId);
      const stillSelected =
        currentRegistration.status === "fresh" &&
        currentRegistration.configs.some(
          (row) =>
            row.server_id === serverId &&
            row.guild_mcp_id === route?.config.guild_mcp_id &&
            row.is_enabled &&
            row.name === route.config.name &&
            row.server_type === route.config.server_type,
        ) &&
        (!(route?.config.server_type === "url_fetcher" || route?.config.server_type === "web_search") ||
          currentRegistration.configs.filter(
            (row) => row.server_id === serverId && row.is_enabled && row.server_type === route.config.server_type,
          ).length === 1);
      if (!stillSelected)
        return {
          success: false,
          error: localizer(context?.locale ?? "en-US", "tools.execution.unavailable", { tool: functionName }),
        };
      if (context) {
        const current = await refreshToolExecutionContext(context);
        const family = route?.config.server_type === "url_fetcher" || route?.config.server_type === "web_search";
        if (
          !current ||
          current.tomoriState.config.response_rule_checker_ref?.toolName === functionName ||
          (family && !configToFeatureFlags(current.tomoriState.config).web_search)
        )
          return {
            success: false,
            error: localizer(context.locale, "tools.execution.unavailable", { tool: functionName }),
          };
        context = current;
      }
      if (context?.isExecutionCancelled?.()) return { success: false };
      const mcpResult = CallToolResultSchema.parse(
        await (conn.client as MCPClient).callTool({ name: functionName, arguments: args }, CallToolResultSchema, {
          timeout: EXECUTION_TIMEOUT_MS,
          signal: context?.abortSignal ?? context?.streamContext?.abortSignal,
        }),
      );
      return this.processDefaultResult(functionName, mcpResult, conn.name, executionStartTime, context);
    } catch (error) {
      const executionTime = Date.now() - executionStartTime;
      log.error(`[GuildMcpManager] Guild MCP execution failed: ${functionName}`, error);

      return {
        success: false,
        message: error instanceof Error ? error.message : "Guild MCP execution failed",
        error: error instanceof Error ? error.message : String(error),
        data: {
          source: "mcp",
          functionName,
          serverName: `guild:${serverId}`,
          executionTime,
          status: "failed",
        },
      };
    }
  }

  /**
   * Formats MCP tool arguments into a human-readable description for the
   * user-facing embed. Renders as a Markdown code block with key-value pairs,
   * truncated to stay within Discord embed limits.
   *
   * @param args - The arguments record passed to the MCP function
   */
  private formatMcpArgs(args: Record<string, unknown>, locale: string): string {
    const entries = Object.entries(args);

    if (entries.length === 0) {
      return localizer(locale, "tools.mcp.tool_invoke_no_params");
    }

    const MAX_VALUE_LENGTH = 200;
    const MAX_TOTAL_LENGTH = 900; // Stay under Discord's 1024 field limit with header
    const lines = entries.map(([key, value]) => {
      const stringValue = typeof value === "string" ? value : JSON.stringify(value);
      const truncated =
        stringValue.length > MAX_VALUE_LENGTH ? `${stringValue.substring(0, MAX_VALUE_LENGTH)}...` : stringValue;
      return `${key}: ${truncated}`;
    });

    const header = localizer(locale, "tools.mcp.tool_invoke_description");
    let body = lines.join("\n");

    if (body.length > MAX_TOTAL_LENGTH) {
      body = `${body.substring(0, MAX_TOTAL_LENGTH)}...`;
    }

    return `${header}\n\`\`\`\n${body}\n\`\`\``;
  }

  /**
   * Test a remote MCP server connection without persisting anything.
   * Used by MCP registration surfaces to validate before saving.
   *
   * @param authToken - Optional bearer token
   * @returns Test result with tool count and names
   */
  async testConnection(url: string, authToken?: string): Promise<GuildMCPTestResult> {
    let client: MCPClient | null = null;
    try {
      // Connection testing uses the same guarded transports as runtime discovery.
      // Returns the fresh client from whichever transport succeeded.
      const discovered = await this.connectAndDiscover("tomoribot-test", url, authToken, "test");
      client = discovered.client;
      const { functionNames } = discovered;

      await client.close();

      return {
        success: true,
        toolCount: functionNames.length,
        functionNames,
      };
    } catch (error) {
      try {
        await client?.close();
      } catch {}

      return {
        success: false,
        toolCount: 0,
        functionNames: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Called when removing or disabling a server via commands.
   *
   * @param serverId - Internal server_id
   */
  async disconnectGuildServer(serverId: number, name: string): Promise<void> {
    const key = this.poolKey(serverId, name);
    // Always clear any quarantine so a fixed/re-added server isn't skipped by the
    // circuit breaker, even if it never made it into the pool.
    this.connectFailures.delete(key);
    const conn = this.pool.get(key);
    if (!conn) return;

    try {
      await (conn.client as MCPClient).close();
    } catch (error) {
      log.warn(`[GuildMcpManager] Error closing connection ${key}`, error);
    }

    this.pool.delete(key);
    log.info(`[GuildMcpManager] Disconnected guild MCP server: ${key}`);
  }

  /**
   * Eagerly connect all enabled guild MCP servers.
   * Called at startup in dev/local environments for instant availability.
   *
   * @param configs - Pre-loaded enabled guild MCP server rows
   */
  async eagerConnectAll(configs: GuildMcpServerRow[]): Promise<void> {
    if (configs.length === 0) return;

    log.info(`[GuildMcpManager] Eager-connecting ${configs.length} guild MCP server(s)...`);

    const results = await Promise.allSettled(configs.map((config) => this.connectServer(config)));

    const succeeded = results.filter((r) => r.status === "fulfilled" && r.value !== null).length;
    const failed = results.length - succeeded;

    log.info(`[GuildMcpManager] Eager connect complete: ${succeeded} succeeded, ${failed} failed`);
  }

  /**
   * Graceful shutdown: close all connections and stop eviction timer.
   */
  async cleanup(): Promise<void> {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }

    const closePromises = Array.from(this.pool.entries()).map(async ([key, conn]) => {
      try {
        await (conn.client as MCPClient).close();
        log.info(`[GuildMcpManager] Closed connection: ${key}`);
      } catch (error) {
        log.warn(`[GuildMcpManager] Error closing connection ${key} during cleanup`, error);
      }
    });

    await Promise.allSettled(closePromises);
    this.pool.clear();
    log.info("[GuildMcpManager] Cleanup complete");
  }

  /**
   * Get pool statistics for monitoring/debugging.
   */
  getPoolStats(): {
    activeConnections: number;
    serverBreakdown: Record<string, number>;
  } {
    const serverBreakdown: Record<string, number> = {};
    for (const conn of this.pool.values()) {
      const key = `server:${conn.serverId}`;
      serverBreakdown[key] = (serverBreakdown[key] || 0) + 1;
    }

    return {
      activeConnections: this.pool.size,
      serverBreakdown,
    };
  }

  /**
   * Connect to a single guild MCP server and add it to the pool.
   * Handles transport creation, connection, tool discovery, and collision checks.
   */
  private async connectServer(config: GuildMcpServerRow, privateFailure = false): Promise<GuildMCPConnection | null> {
    const key = this.poolKey(config.server_id, config.name);

    const existing = this.pool.get(key);
    if (existing) return existing;

    // Circuit breaker: skip servers that recently failed to connect until their
    // cooldown elapses. Without this, one unreachable server re-pays the full
    // connect timeout on EVERY generation (and every fallback-model attempt),
    // blowing the stream inactivity budget and stalling chat for that guild.
    const cooldownUntil = this.connectFailures.get(key);
    if (cooldownUntil !== undefined) {
      if (Date.now() < cooldownUntil) return null; // still quarantined, so skip silently
      this.connectFailures.delete(key); // cooldown elapsed, so allow one fresh attempt
    }

    if (this.connectingKeys.has(key)) {
      log.info(`[GuildMcpManager] Connection already in progress for ${key}, skipping`);
      return null;
    }

    this.connectingKeys.add(key);

    try {
      const authToken = await toolRepository.decryptMcpAuthToken(config, privateFailure);

      const { client, functionNames } = await this.connectAndDiscover(
        `tomoribot-guild-${config.server_id}-${config.name}`,
        config.url,
        authToken ?? undefined,
        config.name,
        privateFailure,
      );

      // Create CallableTool via mcpToTool (same as global MCP servers)
      const callableTool = mcpToTool(client);

      const conn: GuildMCPConnection = {
        guildMcpId: config.guild_mcp_id ?? 0,
        serverId: config.server_id,
        name: config.name,
        client,
        callableTool,
        functionNames,
        connectedAt: Date.now(),
        lastUsedAt: Date.now(),
      };

      this.pool.set(key, conn);
      this.connectFailures.delete(key); // clear any prior quarantine on success
      const guildMcpId = config.guild_mcp_id;
      if (typeof guildMcpId === "number" && Number.isSafeInteger(guildMcpId) && guildMcpId > 0) {
        try {
          void toolRepository
            .updateMcpToolNameSnapshot(config.server_id, guildMcpId, functionNames)
            .then((snapshotResult) => {
              if (snapshotResult === "failed") {
                log.warn(
                  `[GuildMcpManager] Tool-name snapshot refresh failed for MCP server ID ${guildMcpId} ` +
                    `on server ${config.server_id}; keeping the live connection`,
                );
              }
            })
            .catch(() => {
              log.warn(
                `[GuildMcpManager] Tool-name snapshot refresh threw for MCP server ID ${guildMcpId} ` +
                  `on server ${config.server_id}; keeping the live connection`,
              );
            });
        } catch {
          log.warn(
            `[GuildMcpManager] Tool-name snapshot refresh threw for MCP server ID ${guildMcpId} ` +
              `on server ${config.server_id}; keeping the live connection`,
          );
        }
      }
      log.success(
        `[GuildMcpManager] Connected to guild MCP server "${config.name}" ` +
          `(server: ${config.server_id}, tools: ${functionNames.length}: ${functionNames.join(", ")})`,
      );

      return conn;
    } catch (error) {
      this.connectFailures.set(key, Date.now() + CONNECT_FAILURE_COOLDOWN_MS);
      if (!privateFailure)
        log.error(
          `[GuildMcpManager] Failed to connect to guild MCP server "${config.name}" (server: ${config.server_id}); ` +
            `quarantining for ${Math.round(CONNECT_FAILURE_COOLDOWN_MS / 1000)}s`,
          error,
        );
      return null;
    } finally {
      this.connectingKeys.delete(key);
    }
  }

  /** A client whose discovery fails is closed here, so callers never hold a half-open transport. */
  private async connectAndDiscover(
    clientName: string,
    url: string,
    authToken?: string,
    serverLabel?: string,
    privateFailure = false,
  ): Promise<{ client: MCPClient; functionNames: string[] }> {
    if (isSmitheryUrl(url) && authToken) {
      return await connectSmithery(clientName, url, authToken, AbortSignal.timeout(CONNECT_TIMEOUT_MS));
    }
    const client = await this.connectWithFallback(clientName, url, authToken, serverLabel, privateFailure);
    try {
      const toolResult = await client.listTools();
      return { client, functionNames: toolResult.tools.map((tool) => tool.name) };
    } catch (error) {
      await this.safeCloseClient(client);
      throw error;
    }
  }

  /**
   * SSE-only servers reject the Streamable HTTP handshake, so both attempts need
   * fresh clients and the same guarded fetcher. A Smithery account key must never
   * become a bearer token for the upstream server, even after a Smithery failure.
   */
  private async connectWithFallback(
    clientName: string,
    url: string,
    authToken?: string,
    serverLabel?: string,
    privateFailure = false,
  ): Promise<MCPClient> {
    const label = serverLabel ?? url;
    if (isSmitheryUrl(url) && authToken) {
      throw new Error("Smithery account keys are sent only to Smithery Connect");
    }
    const urlValidation = await validateRemoteUrl(url);
    if (!urlValidation.valid) {
      throw new Error(urlValidation.details ?? `Guild MCP URL failed runtime validation for '${label}'.`);
    }

    // Every transport attempt below uses its OWN fresh MCP client. The SDK's Client
    // throws "Already connected to a transport" if the same instance is reused after
    // a failed/timed-out connect, which previously broke the SSE fallback outright.
    const errors: string[] = [];

    const guardedFetch = createGuildMcpFetch(url);

    const headers: Record<string, string> = {};
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const parsedUrl = new URL(url);
    const requestInit = {
      headers,
      redirect: "error" as const,
    };

    // Try StreamableHTTP (modern MCP transport)
    {
      const client = this.newMcpClient(clientName);
      try {
        const streamableTransport = new StreamableHTTPClientTransport(parsedUrl, {
          fetch: guardedFetch,
          requestInit,
        });
        await this.connectWithTimeout(client, streamableTransport, label, "StreamableHTTP");
        log.info(`[GuildMcpManager] Connected via StreamableHTTP: ${label}`);
        return client;
      } catch (streamableError) {
        const message = privateFailure
          ? "Transport connection failed"
          : streamableError instanceof Error
            ? streamableError.message
            : String(streamableError);
        errors.push(`StreamableHTTP: ${message}`);
        await this.safeCloseClient(client);
        log.info(`[GuildMcpManager] StreamableHTTP failed for "${label}", falling back to SSE: ${message}`);
      }
    }

    {
      const client = this.newMcpClient(clientName);
      try {
        const sseTransport = new SSEClientTransport(parsedUrl, {
          fetch: guardedFetch,
          requestInit,
          eventSourceInit: {
            fetch: guardedFetch,
          },
        });
        await this.connectWithTimeout(client, sseTransport, label, "SSE");
        log.info(`[GuildMcpManager] Connected via SSE fallback: ${label}`);
        return client;
      } catch (sseError) {
        const message = privateFailure
          ? "Transport connection failed"
          : sseError instanceof Error
            ? sseError.message
            : String(sseError);
        errors.push(`SSE: ${message}`);
        await this.safeCloseClient(client);
        throw new Error(`All MCP transports failed for '${label}': ${errors.join("; ")}`);
      }
    }
  }

  /** Create a fresh MCP client. One is used per transport attempt (see connectWithFallback). */
  private newMcpClient(clientName: string): MCPClient {
    return new MCPClient({ name: clientName, version: "1.0.0" });
  }

  /**
   * Connect a client to a transport with a hard timeout, always clearing the timer.
   *
   * @param kind - Transport kind for the timeout message (e.g. "SSE")
   */
  private async connectWithTimeout(
    client: MCPClient,
    transport: Parameters<MCPClient["connect"]>[0],
    label: string,
    kind: string,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${kind} connection to '${label}' timed out`)), CONNECT_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Best-effort close of a client whose connect attempt failed, releasing any half-open transport. */
  private async safeCloseClient(client: MCPClient): Promise<void> {
    try {
      await client.close();
    } catch {
      // ignore because the client may have no active transport to close
    }
  }

  /**
   * Evict connections that have been idle longer than CONNECTION_TTL_MS.
   */
  private async evictIdleConnections(): Promise<void> {
    const now = Date.now();
    const toEvict: string[] = [];

    // Prune expired circuit-breaker entries so the map stays bounded even for
    // servers that were removed from config and are never dialed again.
    for (const [key, cooldownUntil] of this.connectFailures.entries()) {
      if (now >= cooldownUntil) {
        this.connectFailures.delete(key);
      }
    }

    for (const [key, conn] of this.pool.entries()) {
      if (now - conn.lastUsedAt > CONNECTION_TTL_MS) {
        toEvict.push(key);
      }
    }

    for (const key of toEvict) {
      const conn = this.pool.get(key);
      if (!conn) continue;

      try {
        await (conn.client as MCPClient).close();
      } catch (error) {
        log.warn(`[GuildMcpManager] Error closing idle connection ${key}`, error);
      }

      this.pool.delete(key);
      log.info(
        `[GuildMcpManager] Evicted idle connection: ${key} ` + `(idle: ${Math.round((now - conn.lastUsedAt) / 1000)}s)`,
      );
    }
  }

  /**
   * Default result processing for guild MCP tools.
   */
  private processDefaultResult(
    functionName: string,
    mcpResult: MCPServerResponse,
    serverName: string,
    executionStartTime: number,
    _context?: ToolContext,
  ): TypedMCPToolResult {
    const executionTime = Date.now() - executionStartTime;

    const text = mcpResult.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    const message =
      text ||
      (mcpResult.structuredContent
        ? JSON.stringify(mcpResult.structuredContent)
        : "Guild MCP function executed successfully");
    if (mcpResult.isError) {
      const error = text || "Guild MCP function execution failed";
      return {
        success: false,
        message: error,
        error,
        data: {
          source: "mcp",
          functionName,
          serverName: `guild:${serverName}`,
          rawResult: mcpResult,
          executionTime,
          status: "failed",
        },
      };
    }

    return {
      success: true,
      message,
      data: {
        source: "mcp",
        functionName,
        serverName: `guild:${serverName}`,
        rawResult: mcpResult,
        executionTime,
        summary: message,
        status: "completed",
      },
    };
  }

  /** Build a consistent pool key from serverId and server name. */
  private poolKey(serverId: number, name: string): string {
    return `${serverId}:${name}`;
  }
}

/** Get the GuildMcpManager singleton */
export function getGuildMcpManager(): GuildMcpManager {
  return GuildMcpManager.getInstance();
}
