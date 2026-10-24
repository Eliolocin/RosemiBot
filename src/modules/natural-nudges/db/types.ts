import { createHash } from "node:crypto";
import { z } from "zod";
import type { DecisionModelRow } from "@/types/db/schema";

export const NATURAL_NUDGE_CATEGORIES = ["ping_user", "revive_topic", "start_topic", "play_scene"] as const;
export type NaturalNudgeCategory = (typeof NATURAL_NUDGE_CATEGORIES)[number];

/** Tools an idle nudge may require or recommend; `image` stands for either image generator. */
export const NUDGE_TOOL_NAMES = [
  "web_search",
  "fetch_url",
  "danbooru_search_tags",
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

export const HANGING_CONVERSATION_PREREQUISITE = "hanging_conversation";
export const RELATIONSHIP_USER_PREREQUISITE = "relationship_user";
export const RECENT_MEMORY_PREREQUISITE = "recent_memory";
export const PRESENCE_ACTIVITY_PREREQUISITE = "presence_activity";
export const TWO_PERSONAS_PREREQUISITE = "two_personas";
export const TOOL_PREREQUISITE_PREFIX = "tool:";

export const NUDGE_PREREQUISITE_IDS: readonly string[] = [
  HANGING_CONVERSATION_PREREQUISITE,
  RELATIONSHIP_USER_PREREQUISITE,
  RECENT_MEMORY_PREREQUISITE,
  PRESENCE_ACTIVITY_PREREQUISITE,
  TWO_PERSONAS_PREREQUISITE,
  ...NUDGE_TOOL_NAMES.map((tool) => `${TOOL_PREREQUISITE_PREFIX}${tool}`),
];

/** The prerequisite each category already enforces in `isIdleNudgeEligible`, so authors never need to pick it. */
export const CATEGORY_IMPLIED_PREREQUISITES: Record<NaturalNudgeCategory, string | null> = {
  ping_user: RELATIONSHIP_USER_PREREQUISITE,
  revive_topic: HANGING_CONVERSATION_PREREQUISITE,
  start_topic: null,
  play_scene: TWO_PERSONAS_PREREQUISITE,
};

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

export const NATURAL_NUDGE_INTEREST_LIMIT = 8;
export const NATURAL_NUDGE_INTEREST_LABEL_MAX = 40;
export const NATURAL_NUDGE_INTEREST_DESCRIPTION_MAX = 160;

/** Level 0 never nudges; 2 is the default for personas without a config row. */
export const NATURAL_NUDGE_TALKATIVENESS_LEVELS = [0, 1, 2, 3, 4] as const;
export const DEFAULT_NATURAL_NUDGE_TALKATIVENESS = 2;

const trimmedText = (max: number) => z.string().trim().min(1).max(max);

export const naturalNudgeInterestSchema = z
  .object({
    label: trimmedText(NATURAL_NUDGE_INTEREST_LABEL_MAX),
    description: trimmedText(NATURAL_NUDGE_INTEREST_DESCRIPTION_MAX),
  })
  .strict();
export type NaturalNudgeInterest = z.infer<typeof naturalNudgeInterestSchema>;

/** Bun returns JSONB as text from some query shapes, so stored arrays are parsed before validation. */
function parseJsonbText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export const naturalNudgeInterestsSchema = z.preprocess(
  parseJsonbText,
  z.array(naturalNudgeInterestSchema).max(NATURAL_NUDGE_INTEREST_LIMIT),
);

/**
 * Compares by position, because JSONB reorders object keys while Zod emits them in schema order. A
 * stored list that does not parse matches nothing.
 */
export function sameNaturalNudgeInterests(interests: readonly NaturalNudgeInterest[], stored: unknown): boolean {
  const parsed = naturalNudgeInterestsSchema.safeParse(stored);
  if (!parsed.success) return false;
  const key = (list: readonly NaturalNudgeInterest[]) =>
    JSON.stringify(list.map((interest) => [interest.label, interest.description]));
  return key(interests) === key(parsed.data);
}

export const naturalNudgeTalkativenessSchema = z.number().int().min(0).max(4);

export const IDLE_NUDGE_FREQUENCY_LEVELS = [0, 1, 2, 3] as const;
export type IdleNudgeFrequencyLevel = (typeof IDLE_NUDGE_FREQUENCY_LEVELS)[number];
const frequencyLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const serverNaturalNudgeConfigSchema = z.object({
  server_id: z.number().int(),
  idle_nudges_enabled: z.boolean(),
  active_nudges_enabled: z.boolean(),
  channel_disc_ids: z.array(z.string()),
  llm_id: z.number().int().nullable(),
  /** At most one checker column is set; both null means the recommended Active Nudge Checker. */
  checker_llm_id: z.number().int().nullable(),
  checker_decision_model_id: z.number().int().nullable(),
  idle_nudge_frequency: frequencyLevelSchema,
  active_nudge_frequency: frequencyLevelSchema,
  disabled_builtin_idle_nudges: z.array(z.string()),
});
export type ServerNaturalNudgeConfig = z.infer<typeof serverNaturalNudgeConfigSchema>;

/** Column defaults from migrations 110 and 114 and `schema.sql`, used when a server has never saved Natural Nudges settings. */
export function defaultServerNaturalNudgeConfig(serverId: number): ServerNaturalNudgeConfig {
  return {
    server_id: serverId,
    idle_nudges_enabled: true,
    active_nudges_enabled: true,
    channel_disc_ids: [],
    llm_id: null,
    checker_llm_id: null,
    checker_decision_model_id: null,
    idle_nudge_frequency: 1,
    active_nudge_frequency: 1,
    disabled_builtin_idle_nudges: [],
  };
}

export type ServerNaturalNudgeConfigPatch = Partial<Omit<ServerNaturalNudgeConfig, "server_id">>;

/** The Active Nudge Checker asks one `choice` question, so a predicate-only Decision model cannot serve it. */
export function supportsCheckerChoice(model: Pick<DecisionModelRow, "supported_primitives">): boolean {
  return (model.supported_primitives as readonly string[]).includes("choice");
}

export const CUSTOM_IDLE_NUDGE_LIMIT = 25;
export const CUSTOM_IDLE_NUDGE_TITLE_MAX = 80;
export const CUSTOM_IDLE_NUDGE_BRIEF_MAX = 1000;
export const CUSTOM_IDLE_NUDGE_AGENDA_HINT_MAX = 500;
export const CUSTOM_IDLE_NUDGE_LIST_MAX = 8;

export const customIdleNudgeInputSchema = z.object({
  category: z.enum(NATURAL_NUDGE_CATEGORIES),
  title: trimmedText(CUSTOM_IDLE_NUDGE_TITLE_MAX),
  brief: trimmedText(CUSTOM_IDLE_NUDGE_BRIEF_MAX),
  agenda_hint: z.string().trim().max(CUSTOM_IDLE_NUDGE_AGENDA_HINT_MAX).nullable(),
  prerequisites: z.array(z.string().min(1).max(64)).max(CUSTOM_IDLE_NUDGE_LIST_MAX),
  recommended_tools: z.array(z.string().min(1).max(64)).max(CUSTOM_IDLE_NUDGE_LIST_MAX),
  enabled: z.boolean(),
});
export type CustomIdleNudgeInput = z.infer<typeof customIdleNudgeInputSchema>;

export const customIdleNudgeRowSchema = customIdleNudgeInputSchema.extend({
  custom_idle_nudge_id: z.number().int(),
  server_id: z.number().int(),
});
export type CustomIdleNudgeRow = z.infer<typeof customIdleNudgeRowSchema>;

/** Four add actions plus 20 entries fill one 25-option select. */
export const PERSONA_AUTHORED_IDLE_NUDGE_LIMIT = 20;
export const PERSONA_AUTHORED_IDLE_NUDGE_ID_MAX = 24;
export const PERSONA_AUTHORED_IDLE_NUDGE_ID_PATTERN = new RegExp(
  `^[A-Za-z0-9_-]{1,${PERSONA_AUTHORED_IDLE_NUDGE_ID_MAX}}$`,
);

export const personaAuthoredIdleNudgeIdSchema = z.string().regex(PERSONA_AUTHORED_IDLE_NUDGE_ID_PATTERN);

const uniqueIdleNudgeListSchema = z
  .array(z.string().min(1).max(64))
  .max(CUSTOM_IDLE_NUDGE_LIST_MAX)
  .refine((values) => new Set(values).size === values.length);

const idleNudgeContentShape = {
  category: z.enum(NATURAL_NUDGE_CATEGORIES),
  title: trimmedText(CUSTOM_IDLE_NUDGE_TITLE_MAX),
  brief: trimmedText(CUSTOM_IDLE_NUDGE_BRIEF_MAX),
  agenda_hint: z.string().trim().max(CUSTOM_IDLE_NUDGE_AGENDA_HINT_MAX).nullable(),
  prerequisites: uniqueIdleNudgeListSchema,
  recommended_tools: uniqueIdleNudgeListSchema,
};

function refineIdleNudgeContent(
  value: { prerequisites: readonly string[]; recommended_tools: readonly string[] },
  ctx: z.RefinementCtx,
): void {
  if (!value.prerequisites.every(isKnownPrerequisite)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["prerequisites"], message: "Unknown prerequisite" });
  }
  if (!value.recommended_tools.every(isNudgeToolName)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["recommended_tools"], message: "Unknown tool" });
  }
}

export const personaAuthoredIdleNudgeDraftSchema = z
  .object(idleNudgeContentShape)
  .strict()
  .superRefine(refineIdleNudgeContent);
export type PersonaAuthoredIdleNudgeDraft = z.infer<typeof personaAuthoredIdleNudgeDraftSchema>;

export const personaAuthoredIdleNudgeSchema = z
  .object({ id: personaAuthoredIdleNudgeIdSchema, ...idleNudgeContentShape })
  .strict()
  .superRefine(refineIdleNudgeContent);
export type PersonaAuthoredIdleNudge = z.infer<typeof personaAuthoredIdleNudgeSchema>;

export const personaAuthoredIdleNudgesSchema = z.preprocess(
  parseJsonbText,
  z
    .array(personaAuthoredIdleNudgeSchema)
    .max(PERSONA_AUTHORED_IDLE_NUDGE_LIMIT)
    .refine((nudges) => new Set(nudges.map((nudge) => nudge.id)).size === nudges.length, {
      message: "Duplicate authored idle nudge id",
    }),
);

export function computePersonaNudgeFingerprint(
  personaId: number,
  content: Omit<PersonaAuthoredIdleNudgeDraft, "prerequisites" | "recommended_tools"> & {
    prerequisites: readonly string[];
    recommended_tools: readonly string[];
  },
): string {
  return createHash("sha256")
    .update(
      `persona-nudge:${personaId}:${JSON.stringify([
        content.category,
        content.title,
        content.brief,
        content.agenda_hint,
        content.prerequisites,
        content.recommended_tools,
      ])}`,
    )
    .digest("base64url")
    .slice(0, 8);
}

export function computePersonaNudgeListFingerprint(
  personaId: number,
  idleNudges: readonly PersonaAuthoredIdleNudge[],
): string {
  return createHash("sha256")
    .update(
      `persona-nudges:${personaId}:${JSON.stringify(
        idleNudges.map((nudge) => [
          nudge.id,
          nudge.category,
          nudge.title,
          nudge.brief,
          nudge.agenda_hint,
          nudge.prerequisites,
          nudge.recommended_tools,
        ]),
      )}`,
    )
    .digest("base64url")
    .slice(0, 8);
}

export const personaNaturalNudgeConfigSchema = z.object({
  persona_id: z.number().int(),
  talkativeness: naturalNudgeTalkativenessSchema,
  interests: naturalNudgeInterestsSchema,
  idle_nudges: personaAuthoredIdleNudgesSchema,
  disabled_idle_nudge_ids: z.preprocess(parseJsonbText, z.array(personaAuthoredIdleNudgeIdSchema)),
  /** The persona has its own row; an unforked pointer still inherits a null authored list. */
  has_override: z.boolean(),
  /** The row holds an explicit authored list; `false` on a pointer reads the preset list live. */
  idle_nudges_override: z.boolean(),
  idle_nudges_inherited: z.boolean(),
});
export type PersonaNaturalNudgeConfig = z.infer<typeof personaNaturalNudgeConfigSchema>;

export const CUSTOM_IDLE_NUDGE_KEY_PREFIX = "custom:";

/** Fire rows and persona scopes store this key, so it must stay stable for a custom idle nudge's lifetime. */
export function customIdleNudgeKey(customIdleNudgeId: number): string {
  return `${CUSTOM_IDLE_NUDGE_KEY_PREFIX}${customIdleNudgeId}`;
}

export const PERSONA_AUTHORED_IDLE_NUDGE_KEY_PREFIX = "persona:";

/** Runtime keys also carry the persona instance ID, so one local ID can exist on several servers. */
export function personaAuthoredIdleNudgeKey(personaId: number, idleNudgeId: string): string {
  return `${PERSONA_AUTHORED_IDLE_NUDGE_KEY_PREFIX}${personaId}:${idleNudgeId}`;
}

export const personaScopeRowSchema = z.object({
  idle_nudge_key: z.string(),
  persona_ids: z.preprocess(parseJsonbText, z.array(z.number().int()).min(1)),
});

/** Persona IDs each scoped idle nudge is limited to; a key without an entry is open to every persona. */
export type IdleNudgePersonaScopes = ReadonlyMap<string, readonly number[]>;

/** A `null` scope opens the idle nudge to every persona, including ones created later. */
export type IdleNudgeAvailability = { enabled: false } | { enabled: true; scope: readonly number[] | null };

export const runtimeStateSchema = z.object({
  server_id: z.number().int(),
  idle_nudge_jitter: z.number(),
  consecutive_failures: z.number().int(),
  stopped_at: z.date().nullable(),
});
export type NaturalNudgeRuntimeState = z.infer<typeof runtimeStateSchema>;

export const fireRowSchema = z.object({
  fire_id: z.coerce.number().int(),
  server_id: z.number().int(),
  channel_disc_id: z.string(),
  persona_id: z.number().int(),
  mode: z.enum(["active", "idle"]),
  category: z.enum(NATURAL_NUDGE_CATEGORIES).nullable(),
  idle_nudge_key: z.string().nullable(),
  target_user_id: z.number().int().nullable(),
  opener_message_disc_id: z.string(),
  answered: z.boolean().nullable(),
  fired_at: z.date(),
});
export type NaturalNudgeFireRow = z.infer<typeof fireRowSchema>;

export interface NewFireRow {
  serverId: number;
  channelDiscId: string;
  personaId: number;
  category: NaturalNudgeCategory;
  idleNudgeKey: string;
  targetUserId: number | null;
  openerMessageDiscId: string;
}

export interface NewActiveNudgeFireRow {
  serverId: number;
  channelDiscId: string;
  personaId: number;
  openerMessageDiscId: string;
  detour: boolean;
}

export const pingUserCandidateSchema = z.object({
  user_id: z.number().int(),
  user_disc_id: z.string(),
  privacy_level: z.number().int(),
  local_turns: z.coerce.number().int(),
  ltm_recent: z.coerce.number().int(),
});
export type PingUserCandidate = z.infer<typeof pingUserCandidateSchema>;

/** Agenda length the DB CHECK allows; the planner schema enforces the same bound. */
export const NATURAL_NUDGE_AGENDA_MAX = 500;

export const enabledIdleNudgeServerSchema = z.object({
  server_id: z.number().int(),
  server_disc_id: z.string(),
  timezone_offset: z.number().nullable(),
  config: serverNaturalNudgeConfigSchema,
});
export type EnabledIdleNudgeServer = z.infer<typeof enabledIdleNudgeServerSchema>;
