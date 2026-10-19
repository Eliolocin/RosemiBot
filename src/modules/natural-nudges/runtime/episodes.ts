import type { CustomEpisodeRow, NaturalNudgeCategory } from "@/modules/natural-nudges/db/types";

/** Categories with a working runner; the rest stay ineligible until their slice lands. */
export const ACTIVE_NATURAL_NUDGE_CATEGORIES = [
  "revive",
  "new_topic",
] as const satisfies readonly NaturalNudgeCategory[];
export type ActiveNaturalNudgeCategory = (typeof ACTIVE_NATURAL_NUDGE_CATEGORIES)[number];

export function isActiveCategory(category: NaturalNudgeCategory): category is ActiveNaturalNudgeCategory {
  return (ACTIVE_NATURAL_NUDGE_CATEGORIES as readonly string[]).includes(category);
}

/** Tools an episode may require or recommend; `image` stands for either image generator. */
export const NUDGE_TOOL_NAMES = [
  "web_search",
  "fetch_url",
  "image",
  "generate_voice_message",
  "generate_video",
  "select_sticker_for_response",
  "create_task",
  "update_task",
  "create_thread",
  "peek_profile_picture",
  "interact_with_recent_message",
  "create_long_term_memory",
  "update_long_term_memory",
  "update_short_term_memory",
  "process_youtube_video",
] as const;
export type NudgeToolName = (typeof NUDGE_TOOL_NAMES)[number];

const IMAGE_TOOL_NAMES = ["generate_image", "generate_image_nai"] as const;

export const HANGING_CONVERSATION_PREREQUISITE = "hanging_conversation";
const TOOL_PREREQUISITE_PREFIX = "tool:";

export const NUDGE_PREREQUISITE_IDS: readonly string[] = [
  HANGING_CONVERSATION_PREREQUISITE,
  ...NUDGE_TOOL_NAMES.map((tool) => `${TOOL_PREREQUISITE_PREFIX}${tool}`),
];

export function isKnownPrerequisite(id: string): boolean {
  return NUDGE_PREREQUISITE_IDS.includes(id);
}

export function prerequisiteTool(id: string): NudgeToolName | null {
  if (!id.startsWith(TOOL_PREREQUISITE_PREFIX)) return null;
  const tool = id.slice(TOOL_PREREQUISITE_PREFIX.length);
  return (NUDGE_TOOL_NAMES as readonly string[]).includes(tool) ? (tool as NudgeToolName) : null;
}

export function isNudgeToolName(name: string): name is NudgeToolName {
  return (NUDGE_TOOL_NAMES as readonly string[]).includes(name);
}

/** Built-in episodes share the custom shape, so one path runs both. */
export interface EpisodeDefinition {
  key: string;
  category: NaturalNudgeCategory;
  /** Locale key for built-ins; custom episodes carry their own title. */
  titleKey?: string;
  title?: string;
  brief: string;
  agendaHint: string | null;
  prerequisites: readonly string[];
  recommendedTools: readonly string[];
  builtIn: boolean;
}

/** Briefs are planner instructions, so they stay in English like every other model-facing prompt. */
export const BUILTIN_EPISODES: readonly EpisodeDefinition[] = [
  {
    key: "revive.pick_up_thread",
    category: "revive",
    titleKey: "commands.config.natural_nudges.episode_titles.revive_pick_up_thread",
    brief: "Find the question or topic that was left unanswered and have {persona} bring it back up naturally.",
    agendaHint: "Get the open question resolved",
    prerequisites: [HANGING_CONVERSATION_PREREQUISITE],
    recommendedTools: ["interact_with_recent_message"],
    builtIn: true,
  },
  {
    key: "revive.second_thoughts",
    category: "revive",
    titleKey: "commands.config.natural_nudges.episode_titles.revive_second_thoughts",
    brief: "Have {persona} come back having thought more about what was said, with a changed or stronger opinion.",
    agendaHint: "Change someone's stance from earlier",
    prerequisites: [HANGING_CONVERSATION_PREREQUISITE],
    recommendedTools: ["interact_with_recent_message"],
    builtIn: true,
  },
  {
    key: "revive.looked_it_up",
    category: "revive",
    titleKey: "commands.config.natural_nudges.episode_titles.revive_looked_it_up",
    brief: "Something in the hanging conversation was uncertain. Have {persona} look it up and report back.",
    agendaHint: "Settle who was right",
    prerequisites: [HANGING_CONVERSATION_PREREQUISITE, "tool:web_search"],
    recommendedTools: ["web_search", "fetch_url"],
    builtIn: true,
  },
  {
    key: "new_topic.interest_musing",
    category: "new_topic",
    titleKey: "commands.config.natural_nudges.episode_titles.new_topic_interest_musing",
    brief: "Have {persona} bring up one of its interests with a specific, concrete thought or question.",
    agendaHint: "Find out who else likes the topic",
    prerequisites: [],
    recommendedTools: ["select_sticker_for_response"],
    builtIn: true,
  },
  {
    key: "new_topic.hot_take",
    category: "new_topic",
    titleKey: "commands.config.natural_nudges.episode_titles.new_topic_hot_take",
    brief: "Have {persona} share a mildly controversial opinion or a quick either/or poll that fits its character.",
    agendaHint: "Get at least two people to pick a side",
    prerequisites: [],
    recommendedTools: ["create_thread"],
    builtIn: true,
  },
  {
    key: "new_topic.would_you_rather",
    category: "new_topic",
    titleKey: "commands.config.natural_nudges.episode_titles.new_topic_would_you_rather",
    brief: 'Have {persona} pose a playful "would you rather" built around its interests.',
    agendaHint: "Get everyone present to answer",
    prerequisites: [],
    recommendedTools: [],
    builtIn: true,
  },
  {
    key: "new_topic.current_event",
    category: "new_topic",
    titleKey: "commands.config.natural_nudges.episode_titles.new_topic_current_event",
    brief: "Find a recent, light news item related to {persona}'s interests and have it react.",
    agendaHint: "Hear what people think about it",
    prerequisites: ["tool:web_search"],
    recommendedTools: ["web_search", "fetch_url"],
    builtIn: true,
  },
  {
    key: "new_topic.show_and_tell",
    category: "new_topic",
    titleKey: "commands.config.natural_nudges.episode_titles.new_topic_show_and_tell",
    brief: "Have {persona} share a picture of what it is doing or something it made, in character.",
    agendaHint: "Get a compliment, or get someone to guess where it is",
    prerequisites: ["tool:image"],
    recommendedTools: ["image"],
    builtIn: true,
  },
  {
    key: "new_topic.voice_note",
    category: "new_topic",
    titleKey: "commands.config.natural_nudges.episode_titles.new_topic_voice_note",
    brief: "Have {persona} send a short, casual voice message instead of text.",
    agendaHint: "Get someone to answer with a voice message",
    prerequisites: ["tool:generate_voice_message"],
    recommendedTools: ["generate_voice_message"],
    builtIn: true,
  },
];

const CUSTOM_EPISODE_KEY_PREFIX = "custom:";

export function customEpisodeDefinition(row: CustomEpisodeRow): EpisodeDefinition {
  return {
    key: `${CUSTOM_EPISODE_KEY_PREFIX}${row.episode_id}`,
    category: row.category,
    title: row.title,
    brief: row.brief,
    agendaHint: row.agenda_hint,
    prerequisites: row.prerequisites,
    recommendedTools: row.recommended_tools,
    builtIn: false,
  };
}

/** Enabled built-ins and custom episodes in the active categories, in panel order. */
export function listRunnableEpisodes(
  disabledBuiltIns: readonly string[],
  customEpisodes: readonly CustomEpisodeRow[],
): EpisodeDefinition[] {
  return [
    ...BUILTIN_EPISODES.filter((episode) => !disabledBuiltIns.includes(episode.key)),
    ...customEpisodes.filter((episode) => episode.enabled).map(customEpisodeDefinition),
  ].filter((episode) => isActiveCategory(episode.category));
}

/** What the prerequisite checks know about one persona at one moment. */
export interface PrerequisiteFacts {
  hasHangingConversation: boolean;
  availableTools: ReadonlySet<string>;
}

/** An unknown prerequisite (the registry shrank since the episode was saved) makes the episode ineligible. */
export function isEpisodeEligible(episode: EpisodeDefinition, facts: PrerequisiteFacts): boolean {
  return episode.prerequisites.every((id) => {
    if (id === HANGING_CONVERSATION_PREREQUISITE) return facts.hasHangingConversation;
    const tool = prerequisiteTool(id);
    if (!tool) return false;
    if (tool === "image") return IMAGE_TOOL_NAMES.some((name) => facts.availableTools.has(name));
    return facts.availableTools.has(tool);
  });
}

/**
 * Recommended and prerequisite tools that are available; `image` expands to every concrete
 * generator, since the catalogue names the capability rather than a provider.
 */
export function availableEpisodeTools(episode: EpisodeDefinition, availableTools: ReadonlySet<string>): string[] {
  const named = [...episode.recommendedTools, ...episode.prerequisites.flatMap((id) => prerequisiteTool(id) ?? [])];
  const expanded = named.flatMap((tool) => (tool === "image" ? [...IMAGE_TOOL_NAMES] : [tool]));
  return [...new Set(expanded)].filter((tool) => availableTools.has(tool));
}
