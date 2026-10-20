import type { CustomEpisodeRow, NaturalNudgeCategory } from "@/modules/natural-nudges/db/types";

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

const HANGING_CONVERSATION_PREREQUISITE = "hanging_conversation";
const RELATIONSHIP_USER_PREREQUISITE = "relationship_user";
const RECENT_MEMORY_PREREQUISITE = "recent_memory";
const PRESENCE_ACTIVITY_PREREQUISITE = "presence_activity";
const TWO_PERSONAS_PREREQUISITE = "two_personas";
const TOOL_PREREQUISITE_PREFIX = "tool:";

export const NUDGE_PREREQUISITE_IDS: readonly string[] = [
  HANGING_CONVERSATION_PREREQUISITE,
  RELATIONSHIP_USER_PREREQUISITE,
  RECENT_MEMORY_PREREQUISITE,
  PRESENCE_ACTIVITY_PREREQUISITE,
  TWO_PERSONAS_PREREQUISITE,
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
    key: "reach_out.check_in",
    category: "reach_out",
    titleKey: "commands.config.natural_nudges.episode_titles.reach_out_check_in",
    brief:
      "Have {persona} casually check on {target}, the way a friend would after not talking for a while. Keep it to one or two lines.",
    agendaHint: "Get {target} to commit to a time to hang out; if they decline, sulk a little, then drop it",
    prerequisites: [RELATIONSHIP_USER_PREREQUISITE],
    recommendedTools: ["select_sticker_for_response"],
    builtIn: true,
  },
  {
    key: "reach_out.memory_callback",
    category: "reach_out",
    titleKey: "commands.config.natural_nudges.episode_titles.reach_out_memory_callback",
    brief:
      "Pick one recent memory about {target} that has a natural follow-up (an exam, a trip, a project) and have {persona} ask how it went.",
    agendaHint: "Find out how the thing went, and remember the answer by updating the old memory",
    prerequisites: [RELATIONSHIP_USER_PREREQUISITE, RECENT_MEMORY_PREREQUISITE],
    recommendedTools: ["update_long_term_memory"],
    builtIn: true,
  },
  {
    key: "reach_out.saw_this",
    category: "reach_out",
    titleKey: "commands.config.natural_nudges.episode_titles.reach_out_saw_this",
    brief: "Find something new related to {target}'s interests and have {persona} share it with them.",
    agendaHint: "Find out whether {target} had already heard about it",
    prerequisites: [RELATIONSHIP_USER_PREREQUISITE, "tool:web_search"],
    recommendedTools: ["web_search", "fetch_url"],
    builtIn: true,
  },
  {
    key: "reach_out.presence_poke",
    category: "reach_out",
    titleKey: "commands.config.natural_nudges.episode_titles.reach_out_presence_poke",
    brief: "{target} is doing something right now: {presence}. Have {persona} notice and tease or cheer them about it.",
    agendaHint: "Get {target} to share how it is going",
    prerequisites: [RELATIONSHIP_USER_PREREQUISITE, PRESENCE_ACTIVITY_PREREQUISITE],
    recommendedTools: ["select_sticker_for_response"],
    builtIn: true,
  },
  {
    key: "reach_out.favor_ask",
    category: "reach_out",
    titleKey: "commands.config.natural_nudges.episode_titles.reach_out_favor_ask",
    brief: "Have {persona} ask {target} for their opinion on a small decision that fits {persona}'s character.",
    agendaHint: "Get {target} to settle the decision",
    prerequisites: [RELATIONSHIP_USER_PREREQUISITE],
    recommendedTools: [],
    builtIn: true,
  },
  {
    key: "reach_out.new_look",
    category: "reach_out",
    titleKey: "commands.config.natural_nudges.episode_titles.reach_out_new_look",
    brief: "Have {persona} look at {target}'s profile picture and comment on it in character.",
    agendaHint: "Get {target} to explain the picture",
    prerequisites: [RELATIONSHIP_USER_PREREQUISITE, "tool:peek_profile_picture"],
    recommendedTools: ["peek_profile_picture"],
    builtIn: true,
  },
  {
    key: "reach_out.remind_you",
    category: "reach_out",
    titleKey: "commands.config.natural_nudges.episode_titles.reach_out_remind_you",
    brief: "{persona} remembers something {target} has coming up and offers to remind them.",
    agendaHint: "Get {target} to accept a reminder, then set it",
    prerequisites: [RELATIONSHIP_USER_PREREQUISITE, "tool:create_task"],
    recommendedTools: ["create_task"],
    builtIn: true,
  },
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
  {
    key: "alter_talk.banter",
    category: "alter_talk",
    titleKey: "commands.config.natural_nudges.episode_titles.alter_talk_banter",
    brief: "Start a short, playful disagreement between {persona} and {partner} about something both have opinions on.",
    agendaHint: "Win the argument; get a human to take its side",
    prerequisites: [TWO_PERSONAS_PREREQUISITE],
    recommendedTools: ["select_sticker_for_response"],
    builtIn: true,
  },
  {
    key: "alter_talk.scheming",
    category: "alter_talk",
    titleKey: "commands.config.natural_nudges.episode_titles.alter_talk_scheming",
    brief:
      "Have {persona} and {partner} plan a harmless surprise for {target}, whispering loudly enough that everyone can see.",
    agendaHint: "Pull off the surprise at the planned time",
    prerequisites: [TWO_PERSONAS_PREREQUISITE, RELATIONSHIP_USER_PREREQUISITE],
    recommendedTools: ["create_task"],
    builtIn: true,
  },
  {
    key: "alter_talk.asking_for_advice",
    category: "alter_talk",
    titleKey: "commands.config.natural_nudges.episode_titles.alter_talk_asking_for_advice",
    brief: "Have {persona} ask {partner} for advice about something in its life.",
    agendaHint: "Get {partner} to reveal something about itself",
    prerequisites: [TWO_PERSONAS_PREREQUISITE],
    recommendedTools: [],
    builtIn: true,
  },
  {
    key: "alter_talk.show_off",
    category: "alter_talk",
    titleKey: "commands.config.natural_nudges.episode_titles.alter_talk_show_off",
    brief: "Have {persona} show {partner} a picture it made and ask what it thinks.",
    agendaHint: "Get {partner} and a human to react",
    prerequisites: [TWO_PERSONAS_PREREQUISITE, "tool:image"],
    recommendedTools: ["image"],
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

/** Enabled built-ins and custom episodes, in panel order. */
export function listRunnableEpisodes(
  disabledBuiltIns: readonly string[],
  customEpisodes: readonly CustomEpisodeRow[],
): EpisodeDefinition[] {
  return [
    ...BUILTIN_EPISODES.filter((episode) => !disabledBuiltIns.includes(episode.key)),
    ...customEpisodes.filter((episode) => episode.enabled).map(customEpisodeDefinition),
  ];
}

/** What the prerequisite checks know about one persona at one moment. */
export interface PrerequisiteFacts {
  hasHangingConversation: boolean;
  /** Another persona that could join a scene shares a channel with this one. */
  hasScenePartner: boolean;
  availableTools: ReadonlySet<string>;
  /** The persona's drawn Reach-out target, or null when nobody passed the gate. */
  target: { hasRecentMemories: boolean; isActive: boolean } | null;
}

const TARGET_PREREQUISITES: readonly string[] = [
  RELATIONSHIP_USER_PREREQUISITE,
  RECENT_MEMORY_PREREQUISITE,
  PRESENCE_ACTIVITY_PREREQUISITE,
];

/**
 * A Reach-out always pings someone, so a custom one that forgot `relationship_user` still needs a
 * target, and so does any episode that asks about a target's memories or activity.
 */
export function episodeNeedsTarget(episode: EpisodeDefinition): boolean {
  return episode.category === "reach_out" || episode.prerequisites.some((id) => TARGET_PREREQUISITES.includes(id));
}

/** An unknown prerequisite (the registry shrank since the episode was saved) makes the episode ineligible. */
export function isEpisodeEligible(episode: EpisodeDefinition, facts: PrerequisiteFacts): boolean {
  if (episodeNeedsTarget(episode) && !facts.target) return false;
  // Alter Talk is always a scene, so a custom one that forgot `two_personas` still needs a partner.
  if (episode.category === "alter_talk" && !facts.hasScenePartner) return false;
  return episode.prerequisites.every((id) => {
    if (id === HANGING_CONVERSATION_PREREQUISITE) return facts.hasHangingConversation;
    if (id === RELATIONSHIP_USER_PREREQUISITE) return facts.target !== null;
    if (id === RECENT_MEMORY_PREREQUISITE) return facts.target?.hasRecentMemories ?? false;
    if (id === PRESENCE_ACTIVITY_PREREQUISITE) return facts.target?.isActive ?? false;
    if (id === TWO_PERSONAS_PREREQUISITE) return facts.hasScenePartner;
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
