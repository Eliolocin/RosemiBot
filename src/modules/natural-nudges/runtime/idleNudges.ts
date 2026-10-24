import {
  CATEGORY_IMPLIED_PREREQUISITES,
  customIdleNudgeKey,
  HANGING_CONVERSATION_PREREQUISITE,
  isKnownPrerequisite,
  isNudgeToolName,
  NUDGE_PREREQUISITE_IDS,
  NUDGE_TOOL_NAMES,
  personaAuthoredIdleNudgeKey,
  PRESENCE_ACTIVITY_PREREQUISITE,
  prerequisiteTool,
  RECENT_MEMORY_PREREQUISITE,
  RELATIONSHIP_USER_PREREQUISITE,
  TWO_PERSONAS_PREREQUISITE,
  type CustomIdleNudgeRow,
  type IdleNudgePersonaScopes,
  type NaturalNudgeCategory,
  type NudgeToolName,
  type PersonaNaturalNudgeConfig,
} from "@/modules/natural-nudges/db/types";

export {
  CATEGORY_IMPLIED_PREREQUISITES,
  isKnownPrerequisite,
  isNudgeToolName,
  NUDGE_PREREQUISITE_IDS,
  NUDGE_TOOL_NAMES,
  prerequisiteTool,
  type NudgeToolName,
};

const IMAGE_TOOL_NAMES = ["generate_image", "generate_image_nai"] as const;

/** Built-in idle nudges share the custom shape, so one path runs both. */
export interface IdleNudgeDefinition {
  key: string;
  category: NaturalNudgeCategory;
  /** Locale key for built-ins; custom idle nudges carry their own title. */
  titleKey?: string;
  title?: string;
  brief: string;
  agendaHint: string | null;
  prerequisites: readonly string[];
  recommendedTools: readonly string[];
  builtIn: boolean;
  /** Present only on persona-authored definitions: the local persona instance that owns and may run this entry. */
  ownerPersonaId?: number;
}

/** Briefs are planner instructions, so they stay in English like every other model-facing prompt. */
export const BUILTIN_IDLE_NUDGES: readonly IdleNudgeDefinition[] = [
  {
    key: "ping_user.check_in",
    category: "ping_user",
    titleKey: "commands.nudge-studio.idle_nudge_titles.ping_user_check_in",
    brief:
      "Have {persona} casually check on {target}, the way a friend would after not talking for a while. Keep it to one or two lines.",
    agendaHint: "Get {target} to commit to a time to hang out; if they decline, sulk a little, then drop it",
    prerequisites: [RELATIONSHIP_USER_PREREQUISITE],
    recommendedTools: ["select_sticker_for_response"],
    builtIn: true,
  },
  {
    key: "ping_user.memory_callback",
    category: "ping_user",
    titleKey: "commands.nudge-studio.idle_nudge_titles.ping_user_memory_callback",
    brief:
      "Pick one recent memory about {target} that has a natural follow-up (an exam, a trip, a project) and have {persona} ask how it went.",
    agendaHint: "Find out how the thing went, and remember the answer by updating the old memory",
    prerequisites: [RELATIONSHIP_USER_PREREQUISITE, RECENT_MEMORY_PREREQUISITE],
    recommendedTools: ["update_long_term_memory"],
    builtIn: true,
  },
  {
    key: "ping_user.saw_this",
    category: "ping_user",
    titleKey: "commands.nudge-studio.idle_nudge_titles.ping_user_saw_this",
    brief: "Find something new related to {target}'s interests and have {persona} share it with them.",
    agendaHint: "Find out whether {target} had already heard about it",
    prerequisites: [RELATIONSHIP_USER_PREREQUISITE, "tool:web_search"],
    recommendedTools: ["web_search", "fetch_url", "process_youtube_video"],
    builtIn: true,
  },
  {
    key: "ping_user.presence_poke",
    category: "ping_user",
    titleKey: "commands.nudge-studio.idle_nudge_titles.ping_user_presence_poke",
    brief: "{target} is doing something right now: {presence}. Have {persona} notice and tease or cheer them about it.",
    agendaHint: "Get {target} to share how it is going",
    prerequisites: [RELATIONSHIP_USER_PREREQUISITE, PRESENCE_ACTIVITY_PREREQUISITE],
    recommendedTools: ["select_sticker_for_response"],
    builtIn: true,
  },
  {
    key: "ping_user.favor_ask",
    category: "ping_user",
    titleKey: "commands.nudge-studio.idle_nudge_titles.ping_user_favor_ask",
    brief: "Have {persona} ask {target} for their opinion on a small decision that fits {persona}'s character.",
    agendaHint: "Get {target} to settle the decision",
    prerequisites: [RELATIONSHIP_USER_PREREQUISITE],
    recommendedTools: [],
    builtIn: true,
  },
  {
    key: "ping_user.new_look",
    category: "ping_user",
    titleKey: "commands.nudge-studio.idle_nudge_titles.ping_user_new_look",
    brief:
      "Have {persona} look at {target}'s profile picture and comment on it in character; decline if {target}'s recent memories already describe their profile picture.",
    agendaHint: "Get {target} to explain the picture, then save a memory of what their profile picture is",
    prerequisites: [RELATIONSHIP_USER_PREREQUISITE, "tool:peek_profile_picture"],
    recommendedTools: ["peek_profile_picture", "create_long_term_memory"],
    builtIn: true,
  },
  {
    key: "ping_user.remind_you",
    category: "ping_user",
    titleKey: "commands.nudge-studio.idle_nudge_titles.ping_user_remind_you",
    brief: "{persona} remembers something {target} has coming up and offers to remind them.",
    agendaHint: "Get {target} to accept a reminder, then set it",
    prerequisites: [RELATIONSHIP_USER_PREREQUISITE, "tool:create_task"],
    recommendedTools: ["create_task"],
    builtIn: true,
  },
  {
    key: "ping_user.recommend_me",
    category: "ping_user",
    titleKey: "commands.nudge-studio.idle_nudge_titles.ping_user_recommend_me",
    brief:
      "Have {persona} ask {target} for a recommendation (a song, game, food, or watch) based on something {target} likes in their memories.",
    agendaHint: "Judge {target}'s taste playfully, then save the recommendation as a memory if it sounds good",
    prerequisites: [RELATIONSHIP_USER_PREREQUISITE, RECENT_MEMORY_PREREQUISITE],
    recommendedTools: ["create_long_term_memory"],
    builtIn: true,
  },
  {
    key: "ping_user.role_reversal",
    category: "ping_user",
    titleKey: "commands.nudge-studio.idle_nudge_titles.ping_user_role_reversal",
    brief:
      "{persona} tries something {target} is into (from their memories) and reports a minor, funny struggle with it.",
    agendaHint: "Get {target} to coach or bail {persona} out",
    prerequisites: [RELATIONSHIP_USER_PREREQUISITE, RECENT_MEMORY_PREREQUISITE],
    recommendedTools: ["select_sticker_for_response"],
    builtIn: true,
  },
  {
    key: "ping_user.settle_a_bet",
    category: "ping_user",
    titleKey: "commands.nudge-studio.idle_nudge_titles.ping_user_settle_a_bet",
    brief:
      "Have {persona} drag {target} in as the tiebreaker on a trivial hypothetical or pet peeve that fits {persona}'s interests.",
    agendaHint: "Refuse to accept a neutral answer; make {target} pick a side",
    prerequisites: [RELATIONSHIP_USER_PREREQUISITE],
    recommendedTools: [],
    builtIn: true,
  },
  {
    key: "revive_topic.pick_up_thread",
    category: "revive_topic",
    titleKey: "commands.nudge-studio.idle_nudge_titles.revive_topic_pick_up_thread",
    brief: "Find the question or topic that was left unanswered and have {persona} bring it back up naturally.",
    agendaHint: "Get the open question resolved",
    prerequisites: [HANGING_CONVERSATION_PREREQUISITE],
    recommendedTools: ["interact_with_recent_message"],
    builtIn: true,
  },
  {
    key: "revive_topic.second_thoughts",
    category: "revive_topic",
    titleKey: "commands.nudge-studio.idle_nudge_titles.revive_topic_second_thoughts",
    brief: "Have {persona} come back having thought more about what was said, with a changed or stronger opinion.",
    agendaHint: "Change someone's stance from earlier",
    prerequisites: [HANGING_CONVERSATION_PREREQUISITE],
    recommendedTools: ["interact_with_recent_message"],
    builtIn: true,
  },
  {
    key: "revive_topic.looked_it_up",
    category: "revive_topic",
    titleKey: "commands.nudge-studio.idle_nudge_titles.revive_topic_looked_it_up",
    brief: "Something in the hanging conversation was uncertain. Have {persona} look it up and report back.",
    agendaHint: "Settle who was right",
    prerequisites: [HANGING_CONVERSATION_PREREQUISITE, "tool:web_search"],
    recommendedTools: ["web_search", "fetch_url"],
    builtIn: true,
  },
  {
    key: "revive_topic.what_did_you_mean",
    category: "revive_topic",
    titleKey: "commands.nudge-studio.idle_nudge_titles.revive_topic_what_did_you_mean",
    brief:
      "Pick a strange, funny, or ambiguous line from the hanging conversation and have {persona} belatedly fixate on it.",
    agendaHint: "Get the author to explain themselves without letting them brush it off",
    prerequisites: [HANGING_CONVERSATION_PREREQUISITE],
    recommendedTools: ["interact_with_recent_message"],
    builtIn: true,
  },
  {
    key: "revive_topic.visual_receipts",
    category: "revive_topic",
    titleKey: "commands.nudge-studio.idle_nudge_titles.revive_topic_visual_receipts",
    brief:
      "Turn a joke, scenario, or claim from the hanging conversation into a picture and have {persona} drop it back into the channel. Never depict the members themselves; draw the joke or scenario.",
    agendaHint: "Get the people from the earlier chat to rate how accurate it is",
    prerequisites: [HANGING_CONVERSATION_PREREQUISITE, "tool:image"],
    recommendedTools: ["image", "interact_with_recent_message"],
    builtIn: true,
  },
  {
    key: "start_topic.interest_musing",
    category: "start_topic",
    titleKey: "commands.nudge-studio.idle_nudge_titles.start_topic_interest_musing",
    brief: "Have {persona} bring up one of its interests with a specific, concrete thought or question.",
    agendaHint: "Find out who else likes the topic",
    prerequisites: [],
    recommendedTools: ["select_sticker_for_response"],
    builtIn: true,
  },
  {
    key: "start_topic.hot_take",
    category: "start_topic",
    titleKey: "commands.nudge-studio.idle_nudge_titles.start_topic_hot_take",
    brief: "Have {persona} share a mildly controversial opinion or a quick either/or poll that fits its character.",
    agendaHint: "Get at least two people to pick a side",
    prerequisites: [],
    recommendedTools: ["create_thread"],
    builtIn: true,
  },
  {
    key: "start_topic.would_you_rather",
    category: "start_topic",
    titleKey: "commands.nudge-studio.idle_nudge_titles.start_topic_would_you_rather",
    brief: 'Have {persona} pose a playful "would you rather" built around its interests.',
    agendaHint: "Get everyone present to answer",
    prerequisites: [],
    recommendedTools: [],
    builtIn: true,
  },
  {
    key: "start_topic.current_event",
    category: "start_topic",
    titleKey: "commands.nudge-studio.idle_nudge_titles.start_topic_current_event",
    brief: "Find a recent, light news item related to {persona}'s interests and have it react.",
    agendaHint: "Hear what people think about it",
    prerequisites: ["tool:web_search"],
    recommendedTools: ["web_search", "fetch_url"],
    builtIn: true,
  },
  {
    key: "start_topic.show_and_tell",
    category: "start_topic",
    titleKey: "commands.nudge-studio.idle_nudge_titles.start_topic_show_and_tell",
    brief: "Have {persona} share a picture of what it is doing or something it made, in character.",
    agendaHint: "Get a compliment, or get someone to guess where it is",
    prerequisites: ["tool:image"],
    recommendedTools: ["image"],
    builtIn: true,
  },
  {
    key: "start_topic.voice_note",
    category: "start_topic",
    titleKey: "commands.nudge-studio.idle_nudge_titles.start_topic_voice_note",
    brief: "Have {persona} send a short, casual voice message instead of text.",
    agendaHint: "Get someone to answer with a voice message",
    prerequisites: ["tool:generate_voice_message"],
    recommendedTools: ["generate_voice_message"],
    builtIn: true,
  },
  {
    key: "start_topic.fit_check",
    category: "start_topic",
    titleKey: "commands.nudge-studio.idle_nudge_titles.start_topic_fit_check",
    brief:
      "Have {persona} share a selfie (mirror selfie or handheld angle) showing an outfit or hairstyle different from its usual look, and ask the channel what they think.",
    agendaHint: "Get people to rate the fit or give styling tips",
    prerequisites: ["tool:image"],
    recommendedTools: ["image"],
    builtIn: true,
  },
  {
    key: "play_scene.banter",
    category: "play_scene",
    titleKey: "commands.nudge-studio.idle_nudge_titles.play_scene_banter",
    brief: "Start a short, playful disagreement between {persona} and {partner} about something both have opinions on.",
    agendaHint: "Win the argument; get a human to take its side",
    prerequisites: [TWO_PERSONAS_PREREQUISITE],
    recommendedTools: ["select_sticker_for_response"],
    builtIn: true,
  },
  {
    key: "play_scene.scheming",
    category: "play_scene",
    titleKey: "commands.nudge-studio.idle_nudge_titles.play_scene_scheming",
    brief:
      "Have {persona} and {partner} plan a harmless surprise for {target}, whispering loudly enough that everyone can see.",
    agendaHint: "Pull off the surprise at the planned time",
    prerequisites: [TWO_PERSONAS_PREREQUISITE, RELATIONSHIP_USER_PREREQUISITE],
    recommendedTools: ["create_task"],
    builtIn: true,
  },
  {
    key: "play_scene.asking_for_advice",
    category: "play_scene",
    titleKey: "commands.nudge-studio.idle_nudge_titles.play_scene_asking_for_advice",
    brief: "Have {persona} ask {partner} for advice about something in its life.",
    agendaHint: "Get {partner} to reveal something about itself",
    prerequisites: [TWO_PERSONAS_PREREQUISITE],
    recommendedTools: [],
    builtIn: true,
  },
  {
    key: "play_scene.show_off",
    category: "play_scene",
    titleKey: "commands.nudge-studio.idle_nudge_titles.play_scene_show_off",
    brief:
      "Have {persona} show {partner} a picture it made and ask what it thinks; {partner} insists on one specific nitpick.",
    agendaHint: "Get {partner} and a human to react",
    prerequisites: [TWO_PERSONAS_PREREQUISITE, "tool:image"],
    recommendedTools: ["image"],
    builtIn: true,
  },
  {
    key: "play_scene.good_cop_bad_cop",
    category: "play_scene",
    titleKey: "commands.nudge-studio.idle_nudge_titles.play_scene_good_cop_bad_cop",
    brief:
      "Have {persona} and {partner} team up to question {target} about a harmless habit or something {target} said in this server, one teasing and one defending them.",
    agendaHint: "Get {target} to confess, while {partner} dramatically defends {target} no matter what",
    prerequisites: [TWO_PERSONAS_PREREQUISITE, RELATIONSHIP_USER_PREREQUISITE, RECENT_MEMORY_PREREQUISITE],
    recommendedTools: ["select_sticker_for_response"],
    builtIn: true,
  },
  {
    key: "play_scene.alibi",
    category: "play_scene",
    titleKey: "commands.nudge-studio.idle_nudge_titles.play_scene_alibi",
    brief:
      "Have {persona} try to rope {partner} into backing up an obviously questionable story or excuse in front of the channel.",
    agendaHint: "Keep the story straight while {partner} pokes holes in it with innocent questions",
    prerequisites: [TWO_PERSONAS_PREREQUISITE],
    recommendedTools: [],
    builtIn: true,
  },
];

export function customIdleNudgeDefinition(row: CustomIdleNudgeRow): IdleNudgeDefinition {
  return {
    key: customIdleNudgeKey(row.custom_idle_nudge_id),
    category: row.category,
    title: row.title,
    brief: row.brief,
    agendaHint: row.agenda_hint,
    prerequisites: row.prerequisites,
    recommendedTools: row.recommended_tools,
    builtIn: false,
  };
}

/** Built-in, server-created, or persona-authored. */
export type IdleNudgeSource = "builtin" | "server" | "persona";

export function idleNudgeSource(idleNudge: IdleNudgeDefinition): IdleNudgeSource {
  if (idleNudge.builtIn) return "builtin";
  return idleNudge.ownerPersonaId === undefined ? "server" : "persona";
}

/** A persona-authored definition and its local availability, for surfaces that list disabled entries too. */
export interface PersonaIdleNudgeEntry {
  definition: IdleNudgeDefinition;
  enabled: boolean;
}

/** Owner definitions stay with their own persona; a missing or unreadable config never opens them to others. */
export function listPersonaIdleNudges(
  personaId: number,
  config: PersonaNaturalNudgeConfig | undefined,
): PersonaIdleNudgeEntry[] {
  if (!config || config.persona_id !== personaId) return [];
  const disabled = new Set(config.disabled_idle_nudge_ids);
  return config.idle_nudges.map((authored) => ({
    definition: {
      key: personaAuthoredIdleNudgeKey(personaId, authored.id),
      category: authored.category,
      title: authored.title,
      brief: authored.brief,
      agendaHint: authored.agenda_hint,
      prerequisites: authored.prerequisites,
      recommendedTools: authored.recommended_tools,
      builtIn: false,
      ownerPersonaId: personaId,
    },
    enabled: !disabled.has(authored.id),
  }));
}

export function isInPersonaScope(key: string, personaId: number, scopes: IdleNudgePersonaScopes): boolean {
  return scopes.get(key)?.includes(personaId) ?? true;
}

/** Enabled built-ins and custom idle nudges, in panel order. */
export function listRunnableIdleNudges(
  disabledBuiltIns: readonly string[],
  customIdleNudges: readonly CustomIdleNudgeRow[],
): IdleNudgeDefinition[] {
  return [
    ...BUILTIN_IDLE_NUDGES.filter((idleNudge) => !disabledBuiltIns.includes(idleNudge.key)),
    ...customIdleNudges.filter((idleNudge) => idleNudge.enabled).map(customIdleNudgeDefinition),
  ];
}

/** Loaded server and owner state that idle nudge selection reads for one drawn persona. */
export interface IdleNudgeSelectionSources {
  personaId: number;
  disabledBuiltIns: readonly string[];
  customIdleNudges: readonly CustomIdleNudgeRow[];
  scopes: IdleNudgePersonaScopes;
  personaConfig: PersonaNaturalNudgeConfig | undefined;
}

/** Everything the drawn persona may run: enabled built-ins, scoped server customs, and its own available entries. */
export function listPersonaRunnableIdleNudges(sources: IdleNudgeSelectionSources): IdleNudgeDefinition[] {
  const serverDefinitions = listRunnableIdleNudges(sources.disabledBuiltIns, sources.customIdleNudges).filter(
    (idleNudge) => isInPersonaScope(idleNudge.key, sources.personaId, sources.scopes),
  );
  const ownerDefinitions = listPersonaIdleNudges(sources.personaId, sources.personaConfig)
    .filter((entry) => entry.enabled)
    .map((entry) => entry.definition);
  return [...serverDefinitions, ...ownerDefinitions];
}

/** Fresh lookup of the planned entry; null when it was deleted, disabled, or no longer belongs to this persona. */
export function findPersonaRunnableIdleNudge(
  key: string,
  sources: IdleNudgeSelectionSources,
): IdleNudgeDefinition | null {
  return listPersonaRunnableIdleNudges(sources).find((idleNudge) => idleNudge.key === key) ?? null;
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return right.every((value) => values.has(value));
}

/** The authored content the planner saw must still match the stored definition right before delivery. */
export function sameIdleNudgeDefinition(left: IdleNudgeDefinition, right: IdleNudgeDefinition): boolean {
  return (
    left.category === right.category &&
    left.titleKey === right.titleKey &&
    left.title === right.title &&
    left.brief === right.brief &&
    left.agendaHint === right.agendaHint &&
    left.builtIn === right.builtIn &&
    left.ownerPersonaId === right.ownerPersonaId &&
    sameStringList(left.prerequisites, right.prerequisites) &&
    sameStringList(left.recommendedTools, right.recommendedTools)
  );
}

/** What the prerequisite checks know about one persona at one moment. */
export interface PrerequisiteFacts {
  hasHangingConversation: boolean;
  /** Another persona that could join a scene shares a channel with this one. */
  hasScenePartner: boolean;
  availableTools: ReadonlySet<string>;
  /** The persona's drawn Ping User nudge target, or null when nobody passed the gate. */
  target: { hasRecentMemories: boolean; isActive: boolean } | null;
}

const TARGET_PREREQUISITES: readonly string[] = [
  RELATIONSHIP_USER_PREREQUISITE,
  RECENT_MEMORY_PREREQUISITE,
  PRESENCE_ACTIVITY_PREREQUISITE,
];

/**
 * A Ping User nudge always pings someone, so a custom one that forgot `relationship_user` still needs a
 * target, and so does any idle nudge that asks about a target's memories or activity.
 */
export function idleNudgeNeedsTarget(idleNudge: IdleNudgeDefinition): boolean {
  return idleNudge.category === "ping_user" || idleNudge.prerequisites.some((id) => TARGET_PREREQUISITES.includes(id));
}

/** An unknown prerequisite (the registry shrank since the idle nudge was saved) makes the idle nudge ineligible. */
export function isIdleNudgeEligible(idleNudge: IdleNudgeDefinition, facts: PrerequisiteFacts): boolean {
  if (idleNudgeNeedsTarget(idleNudge) && !facts.target) return false;
  // A category implies its scenario, so a custom idle nudge that omits the matching prerequisite still needs it.
  if (idleNudge.category === "play_scene" && !facts.hasScenePartner) return false;
  if (idleNudge.category === "revive_topic" && !facts.hasHangingConversation) return false;
  return idleNudge.prerequisites.every((id) => {
    if (id === HANGING_CONVERSATION_PREREQUISITE) return facts.hasHangingConversation;
    if (id === RELATIONSHIP_USER_PREREQUISITE) return facts.target !== null;
    if (id === RECENT_MEMORY_PREREQUISITE) return facts.target?.hasRecentMemories ?? false;
    if (id === PRESENCE_ACTIVITY_PREREQUISITE) return facts.target?.isActive ?? false;
    if (id === TWO_PERSONAS_PREREQUISITE) return facts.hasScenePartner;
    const tool = prerequisiteTool(id);
    return tool !== null && hasNudgeTool(tool, facts.availableTools);
  });
}

function needsScenePartner(idleNudge: IdleNudgeDefinition): boolean {
  return idleNudge.category === "play_scene" || idleNudge.prerequisites.includes(TWO_PERSONAS_PREREQUISITE);
}

function prerequisiteTools(idleNudge: IdleNudgeDefinition): NudgeToolName[] {
  return idleNudge.prerequisites.flatMap((id) => prerequisiteTool(id) ?? []);
}

/** Whether `findIdleNudgeBlocker` could block it, so callers skip resolving tools when nothing could. */
export function canIdleNudgeBeBlocked(idleNudge: IdleNudgeDefinition): boolean {
  return needsScenePartner(idleNudge) || prerequisiteTools(idleNudge).length > 0;
}

function hasNudgeTool(tool: NudgeToolName, availableTools: ReadonlySet<string>): boolean {
  return tool === "image" ? IMAGE_TOOL_NAMES.some((name) => availableTools.has(name)) : availableTools.has(tool);
}

/** The first prerequisite tool the persona no longer holds; the before-send recheck aborts instead of offering it. */
export function findMissingIdleNudgeTool(
  idleNudge: IdleNudgeDefinition,
  availableTools: ReadonlySet<string>,
): NudgeToolName | null {
  for (const id of idleNudge.prerequisites) {
    const tool = prerequisiteTool(id);
    if (tool !== null && !hasNudgeTool(tool, availableTools)) return tool;
  }
  return null;
}

/** What keeps an enabled idle nudge from ever running on a server, judged only on facts that hold for days. */
export type IdleNudgeBlocker =
  | { kind: "tool"; tool: NudgeToolName }
  | { kind: "two_personas" }
  | { kind: "no_persona" };

export interface ServerCapabilityFacts {
  /** Available tools of each persona that can nudge at all, by persona ID. */
  personaTools: ReadonlyMap<number, ReadonlySet<string>>;
}

/**
 * Hanging conversations, targets, and presence change minute to minute, so only scope, tools, and a
 * second nudging persona can block. A tool nudge needs one persona in `scope` holding every tool it
 * names; a scene partner may be any nudging persona, because scope limits only the lead.
 */
export function findIdleNudgeBlocker(
  idleNudge: IdleNudgeDefinition,
  facts: ServerCapabilityFacts,
  scope?: readonly number[],
): IdleNudgeBlocker | null {
  const leads = [...facts.personaTools]
    .filter(([personaId]) => !scope || scope.includes(personaId))
    .map(([, available]) => available);
  if (leads.length === 0) return { kind: "no_persona" };
  if (needsScenePartner(idleNudge) && facts.personaTools.size < 2) return { kind: "two_personas" };
  const tools = prerequisiteTools(idleNudge);
  if (tools.length === 0) return null;
  if (leads.some((available) => tools.every((tool) => hasNudgeTool(tool, available)))) return null;
  const missing = tools.find((tool) => !leads.some((available) => hasNudgeTool(tool, available)));
  return { kind: "tool", tool: missing ?? tools[0] };
}

/**
 * Recommended and prerequisite tools that are available; `image` expands to every concrete
 * generator, since the catalogue names the capability rather than a provider.
 */
export function availableIdleNudgeTools(idleNudge: IdleNudgeDefinition, availableTools: ReadonlySet<string>): string[] {
  const named = [...idleNudge.recommendedTools, ...idleNudge.prerequisites.flatMap((id) => prerequisiteTool(id) ?? [])];
  const expanded = named.flatMap((tool) => (tool === "image" ? [...IMAGE_TOOL_NAMES] : [tool]));
  return [...new Set(expanded)].filter((tool) => availableTools.has(tool));
}
