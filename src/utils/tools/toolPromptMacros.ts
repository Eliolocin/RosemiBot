import { type ToolStateForContext, getAvailableToolsWithMCP } from "@/tools/toolRegistry";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { expandDeliberateToolAllowedNames } from "@/utils/tools/deliberateToolMode";
import { log } from "@/utils/misc/logger";
import type { AssembledServerConfig, TomoriState } from "@/types/db/schema";
import { renderPromptConditionals, type PromptConditionPredicate } from "./promptConditionals";

const PROMPT_CAPABILITY_NAMES = [
  "tool_use",
  "self_teaching",
  "personal_memories",
  "emoji_usage",
  "sticker_usage",
  "web_search",
  "manage_message",
  "thread_creation",
  "image_generation",
  "video_generation",
  "voice_message",
  "user_blocking",
  "short_term_memory",
  "time_awareness",
] as const;

type PromptCapabilityName = (typeof PROMPT_CAPABILITY_NAMES)[number];
export type PromptCapabilityValues = Partial<Record<PromptCapabilityName, boolean>>;

export interface ToolPromptMacroContext {
  provider?: string | null;
  stateForContext?: ToolStateForContext | null;
  capabilities?: PromptCapabilityValues | null;
  deliberateToolAllowedNames?: readonly string[] | null;
  availableToolNames?: ReadonlySet<string> | null;
}

export interface ToolPromptMacroResolver {
  expand(text: string): Promise<string>;
}

interface ToolPromptMacroAvailability {
  availableToolNames: Set<string>;
  guildWebSearchToolNames: string[];
  guildUrlFetcherToolNames: string[];
}

const STATIC_TOOL_PROMPT_MACROS: Record<string, string> = {
  "{capabilities_tool}": "review_capabilities",
  "{memory_tool}": "create_long_term_memory",
  "{memory_update_tool}": "update_long_term_memory",
  "{short_term_memory_tool}": "update_short_term_memory",
  "{task_tool}": "create_task",
  "{task_update_tool}": "update_task",
  "{cross_channel_tool}": "cross_channel_message",
  "{create_thread_tool}": "create_thread",
  "{sticker_tool}": "select_sticker_for_response",
  "{manage_message_tool}": "manage_message",
  "{pin_tool}": "manage_message",
  "{message_interaction_tool}": "interact_with_recent_message",
  "{profile_picture_tool}": "peek_profile_picture",
  "{document_tool}": "read_file",
  "{message_metadata_tool}": "reveal_message_metadata",
  "{timestamp_refresh_tool}": "reveal_message_metadata",
  "{gif_tool}": "process_gif",
  "{youtube_tool}": "process_youtube_video",
  "{image_analysis_tool}": "analyze_image",
  "{image_generation_tool}": "generate_image",
  "{anime_image_generation_tool}": "generate_image_nai",
  "{voice_message_tool}": "generate_voice_message",
  "{block_user_tool}": "block_user",
  "{unblock_user_tool}": "unblock_user",
  "{user_info_tool}": "update_user_info",
};

const DYNAMIC_TOOL_PROMPT_MACROS = {
  "{web_search_tool}": {
    currentTarget: "best available web search tool",
    fallbackText: "the currently available web search tool",
    resolve: (availability: ToolPromptMacroAvailability) => resolveWebSearchToolName(availability),
  },
  "{image_search_tool}": {
    currentTarget: "best available image search tool",
    fallbackText: "the currently available image-search or web-search tool",
    resolve: (availability: ToolPromptMacroAvailability) =>
      resolveGuildFamilyToolName(
        availability.guildWebSearchToolNames,
        [/image/],
        [/video/, /news/, /local/, /fetch/],
      ) || resolveWebSearchToolName(availability),
  },
  "{video_search_tool}": {
    currentTarget: "best available video search tool",
    fallbackText: "the currently available video-search or web-search tool",
    resolve: (availability: ToolPromptMacroAvailability) =>
      resolveGuildFamilyToolName(
        availability.guildWebSearchToolNames,
        [/video/],
        [/image/, /news/, /local/, /fetch/],
      ) || resolveWebSearchToolName(availability),
  },
  "{news_search_tool}": {
    currentTarget: "best available news search tool",
    fallbackText: "the currently available news-search or web-search tool",
    resolve: (availability: ToolPromptMacroAvailability) =>
      resolveGuildFamilyToolName(
        availability.guildWebSearchToolNames,
        [/news/],
        [/image/, /video/, /local/, /fetch/],
      ) || resolveWebSearchToolName(availability),
  },
  "{url_fetch_tool}": {
    currentTarget: "best available URL fetch tool",
    fallbackText: "the currently available URL fetch tool",
    resolve: (availability: ToolPromptMacroAvailability) => resolveUrlFetchToolName(availability),
  },
  "{url_metadata_tool}": {
    currentTarget: "best available URL metadata tool",
    fallbackText: "the currently available URL metadata or fetch tool",
    resolve: (availability: ToolPromptMacroAvailability) =>
      resolveGuildFamilyToolName(
        availability.guildUrlFetcherToolNames,
        [/metadata/, /meta/, /head/, /headers/, /preview/, /info/],
        [/fetch/, /read/, /crawl/],
      ) || pickFirstAvailable(availability.availableToolNames, ["fetch_url"]),
  },
} as const;

const STATIC_TOOL_PROMPT_MACRO_KEYS = Object.keys(STATIC_TOOL_PROMPT_MACROS);
const DYNAMIC_TOOL_PROMPT_MACRO_KEYS = Object.keys(DYNAMIC_TOOL_PROMPT_MACROS);
const ALL_TOOL_PROMPT_MACRO_KEYS = [...STATIC_TOOL_PROMPT_MACRO_KEYS, ...DYNAMIC_TOOL_PROMPT_MACRO_KEYS];

function hasToolPromptMacros(text: string): boolean {
  return ALL_TOOL_PROMPT_MACRO_KEYS.some((macro) => text.includes(macro));
}

export function resolvePromptCapabilityValues(config: AssembledServerConfig): PromptCapabilityValues {
  return {
    tool_use: config.tool_use_enabled ?? true,
    self_teaching: config.self_teaching_enabled,
    personal_memories: config.personal_memories_enabled,
    emoji_usage: config.emoji_usage_enabled,
    sticker_usage: config.sticker_usage_enabled,
    web_search: config.web_search_enabled,
    manage_message: config.manage_message_enabled,
    thread_creation: config.thread_creation_enabled,
    image_generation: config.imagegen_enabled,
    video_generation: config.videogen_enabled,
    voice_message: config.voice_message_enabled,
    user_blocking: config.user_blocking_enabled,
    short_term_memory: config.short_term_memory_enabled,
    time_awareness: config.time_awareness_enabled,
  };
}

export function resolvePromptCapabilityValuesFromToolState(state: ToolStateForContext): PromptCapabilityValues {
  return {
    tool_use: state.llm.has_tools,
    self_teaching: state.config.self_teaching_enabled,
    sticker_usage: state.config.sticker_usage_enabled,
    web_search: state.config.web_search_enabled,
    manage_message: state.config.manage_message_enabled,
    thread_creation: state.config.thread_creation_enabled,
    image_generation: state.config.imagegen_enabled,
    video_generation: state.config.videogen_enabled,
    voice_message: state.config.voice_message_enabled,
    user_blocking: state.config.user_blocking_enabled,
    short_term_memory: true,
  };
}

export function createToolPromptMacroResolver(context?: ToolPromptMacroContext | null): ToolPromptMacroResolver {
  let availabilityPromise: Promise<ToolPromptMacroAvailability> | null = null;
  const warnedConditions = new Set<string>();

  const warnOnce = (message: string): void => {
    if (warnedConditions.has(message)) return;
    warnedConditions.add(message);
    log.warn(`[PromptConditionals] ${message}`);
  };

  const evaluateCondition = async (predicate: PromptConditionPredicate): Promise<boolean | undefined> => {
    if (predicate.namespace === "capability") {
      if (!PROMPT_CAPABILITY_NAMES.includes(predicate.name as PromptCapabilityName)) {
        return undefined;
      }
      return context?.capabilities?.[predicate.name as PromptCapabilityName];
    }

    availabilityPromise ??= loadToolPromptMacroAvailability(context);
    const availability = await availabilityPromise;
    if (predicate.namespace === "tool") {
      return availability.availableToolNames.has(predicate.name);
    }

    if (predicate.name === "url_fetch") {
      return resolveUrlFetchToolName(availability) !== null;
    }

    return undefined;
  };

  return {
    async expand(text: string): Promise<string> {
      if (!text) {
        return text;
      }

      let expanded = await renderPromptConditionals(text, {
        evaluate: evaluateCondition,
        warn: warnOnce,
      });

      if (!hasToolPromptMacros(expanded)) {
        return expanded;
      }

      for (const [macro, toolName] of Object.entries(STATIC_TOOL_PROMPT_MACROS)) {
        if (expanded.includes(macro)) {
          expanded = expanded.replaceAll(macro, formatResolvedToolName(toolName));
        }
      }

      const presentDynamicMacros = DYNAMIC_TOOL_PROMPT_MACRO_KEYS.filter((macro) => expanded.includes(macro));
      if (presentDynamicMacros.length === 0) {
        return expanded;
      }

      availabilityPromise ??= loadToolPromptMacroAvailability(context);
      const availability = await availabilityPromise;

      for (const macro of presentDynamicMacros) {
        const definition = DYNAMIC_TOOL_PROMPT_MACROS[macro as keyof typeof DYNAMIC_TOOL_PROMPT_MACROS];
        const resolvedToolName = definition.resolve(availability);
        expanded = expanded.replaceAll(
          macro,
          resolvedToolName ? formatResolvedToolName(resolvedToolName) : definition.fallbackText,
        );
      }

      return expanded;
    },
  };
}

function formatResolvedToolName(toolName: string): string {
  return `\`${toolName}\``;
}

async function loadToolPromptMacroAvailability(
  context?: ToolPromptMacroContext | null,
): Promise<ToolPromptMacroAvailability> {
  const fallbackAvailability: ToolPromptMacroAvailability = {
    availableToolNames: new Set<string>(),
    guildWebSearchToolNames: [],
    guildUrlFetcherToolNames: [],
  };

  const provider = context?.provider?.trim().toLowerCase();
  const stateForContext = context?.stateForContext;
  if (
    context?.capabilities?.tool_use === false ||
    !provider ||
    !stateForContext?.server_id ||
    !stateForContext.llm ||
    !stateForContext.llm.has_tools
  ) {
    return fallbackAvailability;
  }

  try {
    const preloadedToolNames = context?.availableToolNames;
    if (preloadedToolNames) {
      const guildToolNames = await loadGuildToolFamilyNames(stateForContext.server_id).catch(() => ({
        webSearch: [],
        urlFetcher: [],
      }));
      const families = Object.fromEntries([
        ...guildToolNames.webSearch.map((name) => [name, "web_search"]),
        ...guildToolNames.urlFetcher.map((name) => [name, "url_fetcher"]),
      ]);
      const deliberateToolAllowedNames = expandDeliberateToolAllowedNames(
        context?.deliberateToolAllowedNames,
        families,
      );
      const availableToolNames = deliberateToolAllowedNames
        ? new Set([...preloadedToolNames].filter((name) => deliberateToolAllowedNames.includes(name)))
        : new Set(preloadedToolNames);
      return {
        availableToolNames,
        guildWebSearchToolNames: guildToolNames.webSearch.filter((name) => availableToolNames.has(name)),
        guildUrlFetcherToolNames: guildToolNames.urlFetcher.filter((name) => availableToolNames.has(name)),
      };
    }

    const {
      builtInTools,
      mcpFunctionNames,
      mcpToolFamilies = {},
    } = await getAvailableToolsWithMCP(provider, stateForContext);
    const guildToolNames = {
      webSearch: mcpFunctionNames.filter((name) => mcpToolFamilies[name] === "web_search"),
      urlFetcher: mcpFunctionNames.filter((name) => mcpToolFamilies[name] === "url_fetcher"),
    };
    const availableToolNames = new Set<string>();

    for (const tool of builtInTools) {
      availableToolNames.add(tool.name);
    }

    for (const functionName of mcpFunctionNames) {
      availableToolNames.add(functionName);
    }

    const families = Object.fromEntries([
      ...guildToolNames.webSearch.map((name) => [name, "web_search"]),
      ...guildToolNames.urlFetcher.map((name) => [name, "url_fetcher"]),
    ]);
    const deliberateToolAllowedNames = expandDeliberateToolAllowedNames(context?.deliberateToolAllowedNames, families);
    const filteredAvailableToolNames = deliberateToolAllowedNames
      ? new Set([...availableToolNames].filter((name) => deliberateToolAllowedNames.includes(name)))
      : availableToolNames;

    return {
      availableToolNames: filteredAvailableToolNames,
      guildWebSearchToolNames: guildToolNames.webSearch.filter((name) => filteredAvailableToolNames.has(name)),
      guildUrlFetcherToolNames: guildToolNames.urlFetcher.filter((name) => filteredAvailableToolNames.has(name)),
    };
  } catch (error) {
    log.warn("[ToolPromptMacros] Failed to load tool availability for prompt macro expansion", error);
    return fallbackAvailability;
  }
}

async function loadGuildToolFamilyNames(serverId: string): Promise<{ webSearch: string[]; urlFetcher: string[] }> {
  const parsedServerId = Number.parseInt(serverId, 10);
  if (!Number.isFinite(parsedServerId)) {
    return { webSearch: [], urlFetcher: [] };
  }

  const guildMcpManager = getGuildMcpManager();
  const { routes } = await guildMcpManager.getGuildMCPRouting(parsedServerId);
  return {
    webSearch: [...routes].filter(([, route]) => route.config.server_type === "web_search").map(([name]) => name),
    urlFetcher: [...routes].filter(([, route]) => route.config.server_type === "url_fetcher").map(([name]) => name),
  };
}

function resolveWebSearchToolName(availability: ToolPromptMacroAvailability): string | null {
  return (
    resolveGuildFamilyToolName(
      availability.guildWebSearchToolNames,
      [/web/, /search/],
      [/image/, /video/, /news/, /local/, /fetch/, /metadata/, /summar/, /preview/],
    ) || pickFirstAvailable(availability.availableToolNames, ["web_search"])
  );
}

function resolveGuildFamilyToolName(
  functionNames: string[],
  preferredPatterns: RegExp[],
  avoidPatterns: RegExp[] = [],
): string | null {
  const uniqueFunctionNames = Array.from(new Set(functionNames));
  if (uniqueFunctionNames.length === 0) {
    return null;
  }

  let bestName: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const name of uniqueFunctionNames) {
    const normalized = name.toLowerCase();
    let score = 0;

    for (const pattern of preferredPatterns) {
      if (pattern.test(normalized)) {
        score += 10;
      }
    }

    for (const pattern of avoidPatterns) {
      if (pattern.test(normalized)) {
        score -= 10;
      }
    }

    if (score > bestScore || (score === bestScore && bestName !== null && name.localeCompare(bestName) < 0)) {
      bestName = name;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestName : (uniqueFunctionNames[0] ?? null);
}

function resolveUrlFetchToolName(availability: ToolPromptMacroAvailability): string | null {
  return (
    resolveGuildFamilyToolName(
      availability.guildUrlFetcherToolNames,
      [/fetch/, /read/, /crawl/, /page/, /open/, /visit/, /url/],
      [/metadata/, /meta/, /head/],
    ) || pickFirstAvailable(availability.availableToolNames, ["fetch_url"])
  );
}

function pickFirstAvailable(availableToolNames: Set<string>, preferredToolNames: string[]): string | null {
  for (const toolName of preferredToolNames) {
    if (availableToolNames.has(toolName)) {
      return toolName;
    }
  }

  return null;
}

/**
 * A resolver scoped to one generation attempt's provider and config. Macros are provider-specific,
 * so a fallback attempt must not reuse the primary model's resolver.
 */
export function createToolPromptMacroResolverForState(tomoriState: TomoriState): ToolPromptMacroResolver {
  return createToolPromptMacroResolver({
    provider: tomoriState.llm.llm_provider,
    capabilities: resolvePromptCapabilityValues(tomoriState.config),
    stateForContext:
      tomoriState.server_id && tomoriState.llm
        ? {
            server_id: tomoriState.server_id.toString(),
            activePersonaHasElevenlabsVoice: false,
            llm: tomoriState.llm,
            diffusion_model_id: tomoriState.config.diffusion_model_id,
            nai_diffusion_model_id: tomoriState.config.nai_diffusion_model_id,
            video_model_id: tomoriState.config.video_model_id,
            config: {
              sticker_usage_enabled: tomoriState.config.sticker_usage_enabled,
              web_search_enabled: tomoriState.config.web_search_enabled,
              self_teaching_enabled: tomoriState.config.self_teaching_enabled,
              manage_message_enabled: tomoriState.config.manage_message_enabled,
              imagegen_enabled: tomoriState.config.imagegen_enabled,
              videogen_enabled: tomoriState.config.videogen_enabled,
              voice_message_enabled: tomoriState.config.voice_message_enabled,
              user_blocking_enabled: tomoriState.config.user_blocking_enabled,
              user_info_updates_enabled: tomoriState.config.user_info_updates_enabled,
              response_rule_checker_ref: tomoriState.config.response_rule_checker_ref,
              thread_creation_enabled: tomoriState.config.thread_creation_enabled,
            },
          }
        : undefined,
  });
}
