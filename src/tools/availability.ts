import { type BaseGuildTextChannel, ChannelType, type Client } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import type {
  StreamingContext,
  Tool,
  ToolAssemblyState,
  ToolAvailabilityLlmState,
  ToolContext,
} from "@/types/tool/interfaces";
import { assembleToolsForContext } from "@/tools/assembly";
import { ELEVENLABS_SERVICE_NAME } from "@/utils/audio/elevenLabsAccount";
import { sql } from "@/utils/db/client";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { log } from "@/utils/misc/logger";
import { resolveActiveSpeechEndpoint } from "@/utils/provider/speechEndpointResolver";
import { hasOptApiKey } from "@/utils/security/crypto";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { configToFeatureFlags } from "@/utils/tools/featureFlagMapper";

/**
 * Minimal state interface for context building operations.
 * Contains only what's needed for feature flag checking without full Discord context.
 */
export type ToolStateForContext = ToolAssemblyState;

export interface AvailableToolsWithMCP {
  builtInTools: Tool[];
  mcpFunctionNames: string[];
  totalCount: number;
  mcpToolFamilies?: Record<string, string>;
}

export async function refreshToolExecutionContext(context: ToolContext): Promise<ToolContext | null> {
  const scopeId = context.guildId ?? ("recipientId" in context.channel ? context.channel.recipientId : undefined);
  if (scopeId) {
    const current = await getCachedTomoriState(scopeId).catch(() => null);
    if (!current || current.server_id !== context.tomoriState.server_id) {
      return null;
    }
    // Keep persona and personal-provider state, but re-read guild switches after cache invalidation.
    context = {
      ...context,
      tomoriState: {
        ...context.tomoriState,
        config: {
          ...context.tomoriState.config,
          sticker_usage_enabled: current.config.sticker_usage_enabled,
          web_search_enabled: current.config.web_search_enabled,
          self_teaching_enabled: current.config.self_teaching_enabled,
          manage_message_enabled: current.config.manage_message_enabled,
          imagegen_enabled: current.config.imagegen_enabled,
          videogen_enabled: current.config.videogen_enabled,
          voice_message_enabled: current.config.voice_message_enabled,
          user_blocking_enabled: current.config.user_blocking_enabled,
          user_info_updates_enabled: current.config.user_info_updates_enabled,
          thread_creation_enabled: current.config.thread_creation_enabled,
          response_rule_checker_ref: current.config.response_rule_checker_ref,
        },
      },
    };
  }
  return context;
}

/** Dispatch uses the same policy as declarations; bot permissions do not authorize the invoking user. */
export function isBuiltInToolAvailable(tool: Tool, provider: string, context: ToolContext): boolean {
  return (
    tool.isAvailableFor(provider) &&
    tool.isAvailableForContext?.(provider, context) !== false &&
    meetsModelCapabilityRequirements(tool, context.tomoriState.llm) &&
    (!tool.requiresFeatureFlag || checkFeatureFlag(tool.requiresFeatureFlag, context)) &&
    (!tool.requiresPermissions?.length || checkPermissions(tool.requiresPermissions, context))
  );
}

export function getAvailableToolsForProvider(tools: Iterable<Tool>, provider: string, context: ToolContext): Tool[] {
  const availableTools: Tool[] = [];

  for (const tool of tools) {
    try {
      if (!isBuiltInToolAvailable(tool, provider, context)) {
        continue;
      }

      availableTools.push(tool);
    } catch (error) {
      log.warn(`Error checking availability for tool ${tool.name}: ${(error as Error).message}`);
    }
  }

  log.info(
    `Found ${availableTools.length} available tools for provider: ${provider} (${availableTools.map((t) => t.name).join(", ")})`,
  );

  return availableTools;
}

/**
 * Drops tools whose live-turn availability has lapsed (per-turn dedup flags,
 * active model capabilities) from the set a provider is about to declare to the
 * LLM, so a withdrawn tool is never advertised and then rejected at dispatch.
 *
 * Runs at declaration time, before any Discord interaction exists, so the
 * synthesized context carries placeholder `channel`/`client` values: an
 * `isAvailableForContext` implementation may read only `streamContext` and
 * `tomoriState`.
 */
export function applyStreamContextAvailability(params: {
  providerLabel: string;
  provider: string;
  builtInTools: Tool[];
  streamContext?: StreamingContext | null;
  tomoriState: TomoriState;
}): Tool[] {
  const { providerLabel, provider, builtInTools, streamContext, tomoriState } = params;
  if (!streamContext) {
    return builtInTools;
  }

  const declarationContext: ToolContext = {
    streamContext,
    provider,
    channel: {} as BaseGuildTextChannel,
    client: {} as Client,
    tomoriState,
    locale: "en-US",
  };

  const filteredTools = builtInTools.filter(
    (tool) => tool.isAvailableForContext?.(provider, declarationContext) !== false,
  );

  if (filteredTools.length !== builtInTools.length) {
    log.info(
      `${providerLabel}: Applied streaming context filtering: ${builtInTools.length} -> ${filteredTools.length} built-in tools`,
    );
  }

  return filteredTools;
}

export function getAvailableToolsForContext(
  tools: Iterable<Tool>,
  provider: string,
  stateForContext: ToolStateForContext,
): Tool[] {
  const availableTools: Tool[] = [];

  for (const tool of tools) {
    try {
      if (!tool.isAvailableFor(provider)) {
        continue;
      }

      if (!meetsModelCapabilityRequirements(tool, stateForContext.llm)) {
        continue;
      }

      if (tool.requiresFeatureFlag && !checkFeatureFlagOnly(tool.requiresFeatureFlag, stateForContext)) {
        continue;
      }

      availableTools.push(tool);
    } catch (error) {
      log.warn(`Error checking availability for tool ${tool.name}: ${(error as Error).message}`);
    }
  }

  log.info(
    `Found ${availableTools.length} available tools for context building with provider: ${provider} (${availableTools.map((t) => t.name).join(", ")})`,
  );

  return availableTools;
}

export async function getAvailableToolsWithMCP(
  tools: Iterable<Tool>,
  provider: string,
  stateForContext: ToolStateForContext,
): Promise<AvailableToolsWithMCP> {
  try {
    let builtInTools = getAvailableToolsForContext(tools, provider, stateForContext);
    let mcpFunctionNames: string[] = [];
    const mcpToolFamilies: Record<string, string> = {};

    const serverIdNum = stateForContext.server_id ? Number.parseInt(stateForContext.server_id, 10) : undefined;
    if (serverIdNum) {
      const routing = await getGuildMcpManager().getGuildMCPRouting(serverIdNum);
      for (const [name, route] of routing.routes) {
        if (route.config.server_type) mcpToolFamilies[name] = route.config.server_type;
      }
      builtInTools = builtInTools.filter(
        (tool) =>
          !(tool.name === "fetch_url" && routing.replaced.has("url_fetcher")) &&
          !(tool.name === "web_search" && routing.replaced.has("web_search")),
      );
      mcpFunctionNames = [...routing.routes]
        .filter(
          ([name, route]) =>
            name !== stateForContext.config.response_rule_checker_ref?.toolName &&
            (!(route.config.server_type === "url_fetcher" || route.config.server_type === "web_search") ||
              configToFeatureFlags(stateForContext.config).web_search),
        )
        .map(([name]) => name);
    }

    const serverIdNumber = stateForContext.server_id ? Number.parseInt(stateForContext.server_id, 10) : undefined;
    if (serverIdNumber) {
      const activeSpeechEndpoint = await resolveActiveSpeechEndpoint(serverIdNumber);
      const hasElevenLabsOptKey = await hasOptApiKey(serverIdNumber, ELEVENLABS_SERVICE_NAME);
      const hasSpeechProvider = Boolean(activeSpeechEndpoint) || hasElevenLabsOptKey;
      // Read split-table model slots: diffusion_model_id/video_model_id live in
      //    server_model_configs; nai_diffusion_model_id lives in server_novelai_imagegen_configs.
      const [toolConfigRow] = await sql<
        [{ diffusion_model_id: number | null; nai_diffusion_model_id: number | null; video_model_id: number | null }]
      >`
        SELECT smc.diffusion_model_id,
               snic.nai_diffusion_model_id,
               smc.video_model_id
        FROM server_model_configs smc
        LEFT JOIN server_novelai_imagegen_configs snic ON snic.server_id = smc.server_id
        WHERE smc.server_id = ${serverIdNumber}
        LIMIT 1
      `;

      const hasStandardImageSlot =
        stateForContext.diffusion_model_id != null || toolConfigRow?.diffusion_model_id != null;
      const hasNaiImageSlot =
        stateForContext.nai_diffusion_model_id != null || toolConfigRow?.nai_diffusion_model_id != null;
      const hasVideoSlot = stateForContext.video_model_id != null || toolConfigRow?.video_model_id != null;

      if (!hasNaiImageSlot) {
        const beforeCount = builtInTools.length;
        builtInTools = builtInTools.filter((tool) => tool.name !== "generate_image_nai");
        if (builtInTools.length < beforeCount) {
          log.info("Excluded generate_image_nai (no NovelAI image slot configured)");
        }
      }

      if (!hasStandardImageSlot) {
        const beforeCount = builtInTools.length;
        builtInTools = builtInTools.filter((tool) => tool.name !== "generate_image");
        if (builtInTools.length < beforeCount) {
          log.info("Excluded generate_image (no standard image slot configured)");
        }
      }

      if (!hasVideoSlot) {
        const beforeCount = builtInTools.length;
        builtInTools = builtInTools.filter((tool) => tool.name !== "generate_video");
        if (builtInTools.length < beforeCount) {
          log.info("Excluded generate_video (no video slot configured)");
        }
      }

      if (
        !hasSpeechProvider ||
        !stateForContext.activePersonaHasElevenlabsVoice ||
        !stateForContext.config.voice_message_enabled
      ) {
        const beforeCount = builtInTools.length;
        builtInTools = builtInTools.filter((tool) => tool.name !== "generate_voice_message");
        if (builtInTools.length < beforeCount) {
          log.info(
            `Excluded generate_voice_message (${
              !hasSpeechProvider
                ? "no speech provider"
                : !stateForContext.activePersonaHasElevenlabsVoice
                  ? "active persona has no assigned voice"
                  : "voice_message_enabled is disabled"
            })`,
          );
        }
      }
    }

    builtInTools = await assembleToolsForContext(builtInTools, {
      provider,
      state: stateForContext,
      availableToolNames: new Set([...builtInTools.map((tool) => tool.name), ...mcpFunctionNames]),
    });

    const totalCount = builtInTools.length + mcpFunctionNames.length;

    log.info(
      `Centralized tool filtering complete: ${builtInTools.length} built-in + ${mcpFunctionNames.length} MCP = ${totalCount} total tools for provider: ${provider}`,
    );

    return {
      builtInTools,
      mcpFunctionNames,
      totalCount,
      mcpToolFamilies,
    };
  } catch (error) {
    log.error("Failed to get available tools with MCP:", error as Error);

    const builtInTools = getAvailableToolsForContext(tools, provider, stateForContext).filter(
      (tool) => !stateForContext.server_id || (tool.name !== "web_search" && tool.name !== "fetch_url"),
    );
    return {
      builtInTools,
      mcpFunctionNames: [],
      totalCount: builtInTools.length,
    };
  }
}

function meetsModelCapabilityRequirements(tool: Tool, llm: ToolAvailabilityLlmState): boolean {
  if (!tool.requiredModelCapabilities) {
    return true;
  }

  return Object.entries(tool.requiredModelCapabilities).every(
    ([capability, expectedValue]) => llm[capability as keyof ToolAvailabilityLlmState] === expectedValue,
  );
}

function checkFeatureFlag(featureFlag: string, context: ToolContext): boolean {
  const featureFlags = configToFeatureFlags(context.tomoriState.config);
  return featureFlags[featureFlag] ?? false;
}

function checkFeatureFlagOnly(featureFlag: string, stateForContext: ToolStateForContext): boolean {
  const featureFlags = configToFeatureFlags(stateForContext.config);
  return featureFlags[featureFlag] ?? false;
}

function checkPermissions(requiredPermissions: string[], context: ToolContext): boolean {
  if (requiredPermissions.includes("SEND_MESSAGES")) {
    const clientUser = context.client.user;
    if (!clientUser) {
      return false;
    }
    if ("permissionsFor" in context.channel) {
      const permissions = context.channel.permissionsFor(clientUser);
      if (!permissions) {
        return false;
      }
      const isThreadChannel =
        context.channel.type === ChannelType.PublicThread ||
        context.channel.type === ChannelType.PrivateThread ||
        context.channel.type === ChannelType.AnnouncementThread;
      const canSend = isThreadChannel ? permissions.has("SendMessagesInThreads") : permissions.has("SendMessages");
      if (!canSend) {
        return false;
      }
    }
  }

  if (requiredPermissions.includes("USE_EXTERNAL_STICKERS")) {
    const clientUser = context.client.user;
    if (
      !clientUser ||
      !("permissionsFor" in context.channel
        ? context.channel.permissionsFor(clientUser)?.has("UseExternalStickers")
        : true)
    ) {
      return false;
    }
  }

  return true;
}
