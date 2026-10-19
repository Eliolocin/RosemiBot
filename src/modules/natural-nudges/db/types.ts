import { z } from "zod";

const NATURAL_NUDGE_CATEGORIES = ["reach_out", "revive", "new_topic", "alter_talk"] as const;
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

/** Bun returns JSONB as text from some query shapes, so stored interests are parsed before validation. */
export const naturalNudgeInterestsSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}, z.array(naturalNudgeInterestSchema).max(NATURAL_NUDGE_INTEREST_LIMIT));

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

export const EPISODE_FREQUENCY_LEVELS = [0, 1, 2, 3] as const;
export type EpisodeFrequencyLevel = (typeof EPISODE_FREQUENCY_LEVELS)[number];
const frequencyLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const DAILY_EPISODE_CAP_MAX = 10;

export const serverNaturalNudgeConfigSchema = z.object({
  server_id: z.number().int(),
  episodes_enabled: z.boolean(),
  channel_disc_ids: z.array(z.string()),
  llm_id: z.number().int().nullable(),
  reach_out_weight: z.number().int().min(0).max(100),
  revive_weight: z.number().int().min(0).max(100),
  new_topic_weight: z.number().int().min(0).max(100),
  alter_talk_weight: z.number().int().min(0).max(100),
  daily_episode_cap: z.number().int().min(1).max(DAILY_EPISODE_CAP_MAX),
  episode_frequency: frequencyLevelSchema,
  disabled_builtin_episodes: z.array(z.string()),
});
export type ServerNaturalNudgeConfig = z.infer<typeof serverNaturalNudgeConfigSchema>;

/** Column defaults from migration 110, used when a server has never saved Natural Nudges settings. */
export function defaultServerNaturalNudgeConfig(serverId: number): ServerNaturalNudgeConfig {
  return {
    server_id: serverId,
    episodes_enabled: true,
    channel_disc_ids: [],
    llm_id: null,
    reach_out_weight: 35,
    revive_weight: 25,
    new_topic_weight: 25,
    alter_talk_weight: 15,
    daily_episode_cap: 3,
    episode_frequency: 1,
    disabled_builtin_episodes: [],
  };
}

export type ServerNaturalNudgeConfigPatch = Partial<Omit<ServerNaturalNudgeConfig, "server_id">>;

export const CUSTOM_EPISODE_LIMIT = 25;
export const CUSTOM_EPISODE_TITLE_MAX = 80;
export const CUSTOM_EPISODE_BRIEF_MAX = 1000;
export const CUSTOM_EPISODE_AGENDA_HINT_MAX = 500;

export const customEpisodeInputSchema = z.object({
  category: z.enum(NATURAL_NUDGE_CATEGORIES),
  title: trimmedText(CUSTOM_EPISODE_TITLE_MAX),
  brief: trimmedText(CUSTOM_EPISODE_BRIEF_MAX),
  agenda_hint: z.string().trim().max(CUSTOM_EPISODE_AGENDA_HINT_MAX).nullable(),
  prerequisites: z.array(z.string().min(1).max(64)).max(8),
  recommended_tools: z.array(z.string().min(1).max(64)).max(8),
  enabled: z.boolean(),
});
export type CustomEpisodeInput = z.infer<typeof customEpisodeInputSchema>;

export const customEpisodeRowSchema = customEpisodeInputSchema.extend({
  episode_id: z.number().int(),
  server_id: z.number().int(),
});
export type CustomEpisodeRow = z.infer<typeof customEpisodeRowSchema>;

export const runtimeStateSchema = z.object({
  server_id: z.number().int(),
  episode_jitter: z.number(),
  consecutive_failures: z.number().int(),
  stopped_at: z.date().nullable(),
});
export type NaturalNudgeRuntimeState = z.infer<typeof runtimeStateSchema>;

export const fireRowSchema = z.object({
  fire_id: z.coerce.number().int(),
  server_id: z.number().int(),
  channel_disc_id: z.string(),
  persona_id: z.number().int(),
  mode: z.enum(["chime_in", "episode"]),
  category: z.enum(NATURAL_NUDGE_CATEGORIES).nullable(),
  episode_key: z.string().nullable(),
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
  episodeKey: string;
  openerMessageDiscId: string;
}

/** Agenda length the DB CHECK allows; the planner schema enforces the same bound. */
export const NATURAL_NUDGE_AGENDA_MAX = 500;

export const enabledEpisodeServerSchema = z.object({
  server_id: z.number().int(),
  server_disc_id: z.string(),
  timezone_offset: z.number().nullable(),
  config: serverNaturalNudgeConfigSchema,
});
export type EnabledEpisodeServer = z.infer<typeof enabledEpisodeServerSchema>;
