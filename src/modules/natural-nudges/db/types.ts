import { z } from "zod";

export const NATURAL_NUDGE_CATEGORIES = ["ping_user", "revive_topic", "start_topic", "play_scene"] as const;
export type NaturalNudgeCategory = (typeof NATURAL_NUDGE_CATEGORIES)[number];

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

export const personaNaturalNudgeConfigSchema = z.object({
  persona_id: z.number().int(),
  talkativeness: naturalNudgeTalkativenessSchema,
  interests: naturalNudgeInterestsSchema,
  /** The persona has its own row, so a pointer persona no longer reads the preset's defaults live. */
  has_override: z.boolean(),
});
export type PersonaNaturalNudgeConfig = z.infer<typeof personaNaturalNudgeConfigSchema>;

export const IDLE_NUDGE_FREQUENCY_LEVELS = [0, 1, 2, 3] as const;
export type IdleNudgeFrequencyLevel = (typeof IDLE_NUDGE_FREQUENCY_LEVELS)[number];
const frequencyLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const serverNaturalNudgeConfigSchema = z.object({
  server_id: z.number().int(),
  idle_nudges_enabled: z.boolean(),
  active_nudges_enabled: z.boolean(),
  channel_disc_ids: z.array(z.string()),
  llm_id: z.number().int().nullable(),
  idle_nudge_frequency: frequencyLevelSchema,
  active_nudge_frequency: frequencyLevelSchema,
  disabled_builtin_idle_nudges: z.array(z.string()),
});
export type ServerNaturalNudgeConfig = z.infer<typeof serverNaturalNudgeConfigSchema>;

/** Column defaults from migrations 110 and 114, used when a server has never saved Natural Nudges settings. */
export function defaultServerNaturalNudgeConfig(serverId: number): ServerNaturalNudgeConfig {
  return {
    server_id: serverId,
    idle_nudges_enabled: true,
    active_nudges_enabled: true,
    channel_disc_ids: [],
    llm_id: null,
    idle_nudge_frequency: 1,
    active_nudge_frequency: 1,
    disabled_builtin_idle_nudges: [],
  };
}

export type ServerNaturalNudgeConfigPatch = Partial<Omit<ServerNaturalNudgeConfig, "server_id">>;

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

export const CUSTOM_IDLE_NUDGE_KEY_PREFIX = "custom:";

/** Fire rows and persona scopes store this key, so it must stay stable for a custom idle nudge's lifetime. */
export function customIdleNudgeKey(customIdleNudgeId: number): string {
  return `${CUSTOM_IDLE_NUDGE_KEY_PREFIX}${customIdleNudgeId}`;
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
