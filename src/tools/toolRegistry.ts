/**
 * Central tool registry for managing all available tools
 * Provides registration, discovery, and execution of tools
 */

import { log } from "../utils/misc/logger";
import type {
  Tool,
  ToolContext,
  ToolResult,
  ToolRegistryInterface,
  ToolExecutionEvent,
} from "../types/tool/interfaces";
import { getGuildMcpManager } from "../utils/mcp/guildMcpManager";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { redactToolParametersForStorage } from "@/utils/tools/toolParameterRedaction";
import {
  getAvailableToolsForContext as getAvailableToolsForContextFromRegistry,
  getAvailableToolsForProvider,
  isBuiltInToolAvailable,
  getAvailableToolsWithMCP as getAvailableToolsWithMCPFromRegistry,
  type AvailableToolsWithMCP,
  type ToolStateForContext,
} from "@/tools/availability";
import { localizer } from "@/utils/text/localizer";
import { refreshToolExecutionContext } from "@/tools/availability";
import { configToFeatureFlags } from "@/utils/tools/featureFlagMapper";

const BUILTIN_TOOL_ALIASES: Record<string, string> = {
  remember_this_fact: "create_long_term_memory",
};

function resolveBuiltInToolAlias(toolName: string): string {
  return BUILTIN_TOOL_ALIASES[toolName] ?? toolName;
}

function toolNameDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      current[rightIndex] = Math.min(
        (previous[rightIndex] ?? 0) + 1,
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

function closestToolName(name: string, available: readonly string[]): string | null {
  return available.reduce<string | null>((closest, candidate) => {
    if (!closest) return candidate;
    return toolNameDistance(name, candidate) < toolNameDistance(name, closest) ? candidate : closest;
  }, null);
}

function resolveOpaqueIds(args: Record<string, unknown>, messageIdMap?: MessageIdMap): Record<string, unknown> {
  if (!messageIdMap) {
    return args;
  }

  let resolvedArgs: Record<string, unknown> | undefined;

  for (const key of ["media_id", "message_id", "end_message_id"] as const) {
    const value = args[key];
    if (typeof value !== "string" || !MessageIdMap.isOpaqueKey(value)) {
      continue;
    }

    const resolvedValue = messageIdMap.resolve(value);
    if (!resolvedValue) {
      log.warn(`Failed to resolve opaque ${key} "${value}" before tool execution`);
      continue;
    }

    resolvedArgs ??= { ...args };
    resolvedArgs[key] = resolvedValue;
    resolvedArgs[`__original_${key}`] = value;
  }

  return resolvedArgs ?? args;
}

export type { ToolContext } from "../types/tool/interfaces";
export type { ToolStateForContext } from "@/tools/availability";

/**
 * Central registry for all tools
 * Implements singleton pattern to ensure single source of truth
 */
class ToolRegistryImpl implements ToolRegistryInterface {
  private tools = new Map<string, Tool>();
  private executionHistory: ToolExecutionEvent[] = [];
  private readonly maxHistorySize = 1000;

  /**
   * @throws Error if tool with same name already exists
   */
  registerTool(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool with name '${tool.name}' is already registered`);
    }

    this.validateTool(tool);

    this.tools.set(tool.name, tool);
    log.info(`Registered tool: ${tool.name} (category: ${tool.category})`);
  }

  /**
   * @param name - Tool name to lookup
   * @returns Tool instance or undefined if not found
   */
  getTool(name: string): Tool | undefined {
    const resolvedName = resolveBuiltInToolAlias(name);
    return this.tools.get(resolvedName);
  }

  /**
   * @param provider - Provider name (e.g., "google", "openai")
   * @param context - Tool context for checking feature flags and permissions
   */
  getAvailableTools(provider: string, context: ToolContext): Tool[] {
    return getAvailableToolsForProvider(this.tools.values(), provider, context);
  }

  /**
   * Get tools available for context building (only checks feature flags, no Discord permissions)
   * Used when building context instructions where we don't have full Discord context
   * @param provider - Provider name (e.g., "google", "openai")
   */
  getAvailableToolsForContext(provider: string, stateForContext: ToolStateForContext): Tool[] {
    return getAvailableToolsForContextFromRegistry(this.tools.values(), provider, stateForContext);
  }

  /**
   * Get all available tools (built-in + MCP) with feature flag filtering
   * This is the new centralized method that replaces provider-specific filtering
   * @param provider - Provider name (e.g., "google", "openai")
   */
  async getAvailableToolsWithMCP(
    provider: string,
    stateForContext: ToolStateForContext,
  ): Promise<AvailableToolsWithMCP> {
    return getAvailableToolsWithMCPFromRegistry(this.tools.values(), provider, stateForContext);
  }

  /**
   * Get all registered tools
   */
  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getReservedToolNames(): Set<string> {
    return new Set([...this.tools.keys(), ...Object.keys(BUILTIN_TOOL_ALIASES)]);
  }

  /**
   * Check if a tool requires a follow-up generation after execution
   * Built-in tools check the `requiresFollowUp` property; guild MCP tools always return true
   * because the model has to present a remote tool's result
   * @param serverId - Optional internal server_id for guild MCP check
   * @returns Promise<boolean> - True if the tool needs a follow-up generation
   */
  async requiresFollowUp(functionName: string, serverId?: number): Promise<boolean> {
    const resolvedFunctionName = resolveBuiltInToolAlias(functionName);

    if (serverId) {
      try {
        const isGuildMcp = (await getGuildMcpManager().getGuildMCPRouting(serverId)).routes.has(resolvedFunctionName);
        if (isGuildMcp) return true;
      } catch {}
    }

    const tool = this.getTool(resolvedFunctionName);
    return tool?.requiresFollowUp ?? false;
  }

  /**
   * Execute a tool by name with given arguments and context
   * Supports built-in tools and guild MCP functions
   */
  async executeTool(toolName: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now();
    const resolvedToolName = resolveBuiltInToolAlias(toolName);
    const unavailable = (): ToolResult => ({
      success: false,
      error: localizer(context.locale, "tools.execution.unavailable", { tool: toolName }),
    });
    const refreshed = await refreshToolExecutionContext(context);
    if (!refreshed) return unavailable();
    context = refreshed;
    if (resolvedToolName === context.tomoriState?.config.response_rule_checker_ref?.toolName)
      return { success: false, error: "Internal review evidence is unavailable to author tools" };
    const resolvedArgs =
      context.preparedToolRequest?.name === resolvedToolName && context.preparedToolRequest.args === args
        ? args
        : resolveOpaqueIds(args, context.messageIdMap);

    const serverId = context.tomoriState?.server_id;
    if (serverId) {
      try {
        const guildMcpManager = getGuildMcpManager();
        const routing = await guildMcpManager.getGuildMCPRouting(serverId);
        const current = await refreshToolExecutionContext(context);
        if (!current) return unavailable();
        context = current;
        if (resolvedToolName === context.tomoriState.config.response_rule_checker_ref?.toolName) return unavailable();
        const route = routing.routes.get(resolvedToolName);
        const isGuildMcp = Boolean(route);
        if (context.isExecutionCancelled?.()) return { success: false };
        const replacementFamily =
          route?.config.server_type === "web_search" || route?.config.server_type === "url_fetcher";
        const replacedBuiltIn =
          (resolvedToolName === "fetch_url" && routing.replaced.has("url_fetcher")) ||
          (resolvedToolName === "web_search" && routing.replaced.has("web_search"));
        if (
          (replacementFamily && !configToFeatureFlags(context.tomoriState.config).web_search) ||
          (replacedBuiltIn && !route)
        ) {
          return {
            success: false,
            error: localizer(context.locale, "tools.execution.unavailable", { tool: toolName }),
          };
        }
        if (isGuildMcp) {
          log.info(`Executing guild MCP function: ${resolvedToolName} for server ${serverId}`);
          const result = await guildMcpManager.executeGuildMCPFunction(
            serverId,
            resolvedToolName,
            resolvedArgs,
            context,
          );
          const executionTime = Date.now() - startTime;

          this.recordExecution({
            toolName: resolvedToolName,
            provider: context.provider,
            serverId: serverId.toString(),
            userId: context.userId,
            parameters: resolvedArgs,
            result,
            executionTime,
            timestamp: new Date(),
          });

          if (result.success) {
            log.success(`Guild MCP function executed successfully: ${resolvedToolName} (${executionTime}ms)`);
          } else {
            log.warn(
              `Guild MCP function execution completed with error: ${resolvedToolName} - ${result.error} (${executionTime}ms)`,
            );
          }

          return result;
        }
      } catch (error) {
        log.warn(`Error checking/executing guild MCP function '${resolvedToolName}':`, error as Error);
        if (!this.getTool(resolvedToolName) || resolvedToolName === "fetch_url" || resolvedToolName === "web_search")
          return unavailable();
        // MCP cannot own other built-ins, but flags may have changed during the failed lookup.
        const current = await refreshToolExecutionContext(context);
        if (!current || resolvedToolName === current.tomoriState.config.response_rule_checker_ref?.toolName)
          return unavailable();
        context = current;
      }
    }

    return this.executeBuiltInTool(resolvedToolName, resolvedArgs, context, startTime);
  }

  /** Alias and opaque targets must be fixed before reviewing effects. */
  async prepareToolRequest(toolName: string, args: Record<string, unknown>, context: ToolContext) {
    return {
      name: resolveBuiltInToolAlias(toolName),
      args: resolveOpaqueIds(structuredClone(args), context.messageIdMap),
    };
  }

  /**
   * @param args - Tool arguments
   * @param startTime - Execution start time for metrics
   */
  private async executeBuiltInTool(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolContext,
    startTime: number,
  ): Promise<ToolResult> {
    if (context.isExecutionCancelled?.()) return { success: false };
    const tool = this.getTool(toolName);

    if (!tool) {
      // Suggesting a tool this turn cannot run only trades the unknown-name error for an
      // availability rejection on the next loop iteration.
      const available = this.getAvailableTools(context.provider, context).map((candidate) => candidate.name);
      const closest = closestToolName(toolName, available);
      const errorResult: ToolResult = {
        success: false,
        error: `Tool '${toolName}' not found. ${closest ? `Did you mean '${closest}'? ` : ""}Available tools: ${available.join(", ")}`,
      };

      log.error(
        `Tool execution failed - tool not found: ${toolName}. Available: ${Array.from(this.tools.keys()).join(", ")}`,
      );

      return errorResult;
    }

    if (!isBuiltInToolAvailable(tool, context.provider, context)) {
      return { success: false, error: localizer(context.locale, "tools.execution.unavailable", { tool: toolName }) };
    }

    try {
      if (context.isExecutionCancelled?.()) return { success: false };
      log.info(`Executing built-in tool: ${toolName} (${tool.category}) for provider ${context.provider}`);

      const result = await tool.execute(args, context);
      const executionTime = Date.now() - startTime;

      const executionEvent: ToolExecutionEvent = {
        toolName,
        provider: context.provider,
        serverId: context.tomoriState.server_id?.toString() || "unknown",
        userId: context.userId,
        parameters: redactToolParametersForStorage(toolName, args),
        result,
        executionTime,
        timestamp: new Date(),
      };

      this.recordExecution(executionEvent);

      if (result.success) {
        log.success(`Tool executed successfully: ${toolName} (${executionTime}ms)`);
      } else {
        log.warn(`Tool execution completed with error: ${toolName} - ${result.error} (${executionTime}ms)`);
      }

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorResult: ToolResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };

      const executionEvent: ToolExecutionEvent = {
        toolName,
        provider: context.provider,
        serverId: context.tomoriState.server_id?.toString() || "unknown",
        userId: context.userId,
        parameters: redactToolParametersForStorage(toolName, args),
        result: errorResult,
        executionTime,
        timestamp: new Date(),
      };

      this.recordExecution(executionEvent);

      log.error(
        `Tool execution threw error: ${toolName} for provider ${context.provider} (${executionTime}ms)`,
        error as Error,
      );

      return errorResult;
    }
  }

  getExecutionHistory(limit = 100): ToolExecutionEvent[] {
    return this.executionHistory.slice(-limit).reverse(); // Most recent first
  }

  /**
   * Clear the tool registry (useful for testing)
   */
  clearRegistry(): void {
    this.tools.clear();
    this.executionHistory = [];
    log.info("Tool registry cleared");
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalTools: number;
    toolsByCategory: Record<string, number>;
    recentExecutions: number;
    totalExecutions: number;
  } {
    const toolsByCategory: Record<string, number> = {};

    for (const tool of this.tools.values()) {
      toolsByCategory[tool.category] = (toolsByCategory[tool.category] || 0) + 1;
    }

    const recentExecutions = this.executionHistory.filter(
      (event) => Date.now() - event.timestamp.getTime() < 24 * 60 * 60 * 1000, // Last 24 hours
    ).length;

    return {
      totalTools: this.tools.size,
      toolsByCategory,
      recentExecutions,
      totalExecutions: this.executionHistory.length,
    };
  }

  /**
   * Validate tool structure and required properties
   * @param tool - Tool to validate
   * @throws Error if tool is invalid
   */
  private validateTool(tool: Tool): void {
    if (!tool.name || tool.name.trim().length === 0) {
      throw new Error("Tool must have a non-empty name");
    }

    if (!tool.description || tool.description.trim().length === 0) {
      throw new Error(`Tool '${tool.name}' must have a description`);
    }

    if (!tool.category) {
      throw new Error(`Tool '${tool.name}' must have a category`);
    }

    if (!tool.parameters?.properties || !Array.isArray(tool.parameters.required)) {
      throw new Error(`Tool '${tool.name}' must have valid parameter schema`);
    }

    if (typeof tool.execute !== "function") {
      throw new Error(`Tool '${tool.name}' must have an execute method`);
    }

    if (typeof tool.isAvailableFor !== "function") {
      throw new Error(`Tool '${tool.name}' must have an isAvailableFor method`);
    }
  }

  /**
   * Record a tool execution event in history
   * @param event - Execution event to record
   */
  private recordExecution(event: ToolExecutionEvent): void {
    this.executionHistory.push(event);

    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory = this.executionHistory.slice(-this.maxHistorySize + 100);
    }
  }
}

export const ToolRegistry = new ToolRegistryImpl();

export function registerTool(tool: Tool): void {
  ToolRegistry.registerTool(tool);
}

export function getTool(name: string): Tool | undefined {
  return ToolRegistry.getTool(name);
}

export function getAvailableTools(provider: string, context: ToolContext): Tool[] {
  return ToolRegistry.getAvailableTools(provider, context);
}

export function getAvailableToolsForContext(provider: string, stateForContext: ToolStateForContext): Tool[] {
  return ToolRegistry.getAvailableToolsForContext(provider, stateForContext);
}

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  return ToolRegistry.executeTool(toolName, args, context);
}

export async function requiresFollowUp(functionName: string, serverId?: number): Promise<boolean> {
  return ToolRegistry.requiresFollowUp(functionName, serverId);
}

export async function getAvailableToolsWithMCP(
  provider: string,
  stateForContext: ToolStateForContext,
): Promise<AvailableToolsWithMCP> {
  return ToolRegistry.getAvailableToolsWithMCP(provider, stateForContext);
}
