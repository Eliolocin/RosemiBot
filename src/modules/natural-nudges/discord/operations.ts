import { createHash } from "node:crypto";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import {
  CUSTOM_EPISODE_LIMIT,
  customEpisodeInputSchema,
  DAILY_CHIME_IN_CAP_MAX,
  DAILY_EPISODE_CAP_MAX,
  NATURAL_NUDGE_INTEREST_LIMIT,
  naturalNudgeInterestSchema,
  type CustomEpisodeInput,
  type CustomEpisodeRow,
  type EpisodeFrequencyLevel,
  type NaturalNudgeInterest,
  type NaturalNudgeRuntimeState,
  type PersonaNaturalNudgeConfig,
  type ServerNaturalNudgeConfig,
} from "@/modules/natural-nudges/db/types";
import {
  BUILTIN_EPISODES,
  customEpisodeDefinition,
  isKnownPrerequisite,
  isNudgeToolName,
  type EpisodeDefinition,
} from "@/modules/natural-nudges/runtime/episodes";
import {
  chimeInTripRange,
  computeHeat,
  episodesPerDay,
  heatWindowStart,
} from "@/modules/natural-nudges/runtime/meters";
import {
  loadStructuredOutputModelGroups,
  type StructuredOutputModelGroup,
} from "@/utils/discord/interactions/configModelOperations";
import { statRepository } from "@/utils/db/repositories";
import type { TomoriState } from "@/types/db/schema";
import { resolveEffectiveChannelIds } from "@/modules/natural-nudges/runtime/channels";
import { invalidateNaturalNudgeConfigCache } from "@/modules/natural-nudges/runtime/configCache";
import { resolveMatcherBackend } from "@/modules/natural-nudges/runtime/matcher";
import { resolvePlannerModel, type PlannerModelStatus } from "@/modules/natural-nudges/runtime/model";

export type NudgeWriteResult = "success" | "stale" | "invalid" | "limit" | "write-failed";

/** What the timer would use right now, which the page shows next to the saved settings. */
interface NaturalNudgesStatus {
  effectiveChannelIds: string[];
  plannerModel: PlannerModelStatus;
  chatModel: { codename: string; provider: string } | null;
  /** Which model would match Chime-ins right now, or null when none can. */
  matcher: { kind: "decision"; model: string } | { kind: "llm" } | null;
}

export interface NaturalNudgesSettingsView {
  config: ServerNaturalNudgeConfig;
  runtime: NaturalNudgeRuntimeState;
  plannerModels: StructuredOutputModelGroup[];
  trackingEnabled: boolean;
  heat: number;
  perDay: number;
  /** Human messages between Chime-in checks at the current heat and level; null below the heat floor. */
  chimeInRange: { min: number; max: number } | null;
  /** Null on modal paths, which must acknowledge within 3 seconds and never render it. */
  status: NaturalNudgesStatus | null;
}

export interface NudgeEpisodeEntry {
  definition: EpisodeDefinition;
  enabled: boolean;
  /** Present for custom episodes, whose rows the edit routes address. */
  custom?: CustomEpisodeRow;
}

export interface NudgeEpisodesView {
  config: ServerNaturalNudgeConfig;
  entries: NudgeEpisodeEntry[];
  fingerprint: string;
}

/** Binds an index-addressed episode write to the exact list the control rendered. */
export function computeEpisodeListFingerprint(entries: readonly NudgeEpisodeEntry[]): string {
  return createHash("sha256")
    .update(`nudge-episodes:${entries.map((entry) => entry.definition.key).join("\u0000")}`)
    .digest("base64url")
    .slice(0, 8);
}

/** Binds an interest edit or removal to the interest at that position when the control rendered. */
export function computeInterestFingerprint(personaId: number, index: number, interest: NaturalNudgeInterest): string {
  return createHash("sha256")
    .update(`nudge-interest:${personaId}:${index}:${interest.label}\u0000${interest.description}`)
    .digest("base64url")
    .slice(0, 8);
}

async function loadSettingsStatus(
  state: TomoriState,
  config: ServerNaturalNudgeConfig,
  now: Date,
): Promise<NaturalNudgesStatus> {
  const [effectiveChannelIds, plannerModel, backend] = await Promise.all([
    resolveEffectiveChannelIds(state.server_id, config, now),
    resolvePlannerModel(state, config.llm_id),
    resolveMatcherBackend(state, config.llm_id),
  ]);
  const chatModel =
    (state.llm.llm_id ?? 0) > 0 ? { codename: state.llm.llm_codename, provider: state.llm.llm_provider } : null;
  const matcher = !backend
    ? null
    : backend.kind === "decision"
      ? { kind: "decision" as const, model: backend.model }
      : { kind: "llm" as const };
  return { effectiveChannelIds, plannerModel, chatModel, matcher };
}

async function loadSettingsView(
  serverId: number,
  locale: string,
  chatState: TomoriState | null,
): Promise<NaturalNudgesSettingsView> {
  const now = new Date();
  const [config, runtime, plannerModels, dailyCounts] = await Promise.all([
    naturalNudgeRepository.loadServerConfig(serverId),
    naturalNudgeRepository.loadRuntimeState(serverId),
    loadStructuredOutputModelGroups(serverId, locale),
    statRepository.getServerDailyMessageCounts({ serverId, from: heatWindowStart(now) }),
  ]);
  const heat = computeHeat(dailyCounts, now);
  return {
    config,
    runtime,
    plannerModels,
    trackingEnabled: statRepository.isTrackingEnabled,
    heat,
    perDay: episodesPerDay(heat, config.episode_frequency, config.daily_episode_cap),
    chimeInRange: chimeInTripRange(heat, config.chime_in_frequency),
    status: chatState ? await loadSettingsStatus(chatState, config, now) : null,
  };
}

async function loadEpisodesView(serverId: number): Promise<NudgeEpisodesView> {
  const [config, customEpisodes] = await Promise.all([
    naturalNudgeRepository.loadServerConfig(serverId),
    naturalNudgeRepository.listCustomEpisodes(serverId),
  ]);
  const entries: NudgeEpisodeEntry[] = [
    ...BUILTIN_EPISODES.map((definition) => ({
      definition,
      enabled: !config.disabled_builtin_episodes.includes(definition.key),
    })),
    ...customEpisodes.map((custom) => ({
      definition: customEpisodeDefinition(custom),
      enabled: custom.enabled,
      custom,
    })),
  ];
  return { config, entries, fingerprint: computeEpisodeListFingerprint(entries) };
}

async function loadPersonaNudgeConfig(personaId: number): Promise<PersonaNaturalNudgeConfig | null> {
  return (await naturalNudgeRepository.loadPersonaConfigs([personaId])).get(personaId) ?? null;
}

async function patchConfig(
  serverId: number,
  patch: Parameters<typeof naturalNudgeRepository.saveServerConfig>[1],
): Promise<NudgeWriteResult> {
  if (!(await naturalNudgeRepository.saveServerConfig(serverId, patch))) return "write-failed";
  invalidateNaturalNudgeConfigCache(serverId);
  return "success";
}

/** Discord's channel select returns at most 25 IDs, so a longer list cannot come from the panel. */
const MAX_ALLOWED_CHANNELS = 25;
const SNOWFLAKE_RE = /^\d{17,20}$/;

interface NudgeLimitsInput {
  reach_out_weight: number;
  revive_weight: number;
  new_topic_weight: number;
  alter_talk_weight: number;
  daily_episode_cap: number;
}

function isWeight(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}

/** Text fields for a custom episode; prerequisites and tools are edited on the detail view. */
interface CustomEpisodeTextInput {
  category: string;
  title: string;
  brief: string;
  agendaHint: string;
}

function parseEpisodeText(input: CustomEpisodeTextInput, existing?: CustomEpisodeRow): CustomEpisodeInput | null {
  const parsed = customEpisodeInputSchema.safeParse({
    category: input.category,
    title: input.title,
    brief: input.brief,
    agenda_hint: input.agendaHint.trim() ? input.agendaHint : null,
    prerequisites: existing?.prerequisites ?? [],
    recommended_tools: existing?.recommended_tools ?? [],
    enabled: existing?.enabled ?? true,
  });
  return parsed.success ? parsed.data : null;
}

function findCustom(view: NudgeEpisodesView, index: number, fp: string): CustomEpisodeRow | "stale" {
  if (view.fingerprint !== fp) return "stale";
  return view.entries[index]?.custom ?? "stale";
}

const naturalNudgeOperations = {
  setEpisodesEnabled(serverId: number, enabled: boolean): Promise<NudgeWriteResult> {
    return patchConfig(serverId, { episodes_enabled: enabled });
  },

  setChannels(serverId: number, channelIds: readonly string[]): Promise<NudgeWriteResult> {
    const unique = [...new Set(channelIds)];
    if (unique.length > MAX_ALLOWED_CHANNELS || !unique.every((id) => SNOWFLAKE_RE.test(id)))
      return Promise.resolve("invalid");
    return patchConfig(serverId, { channel_disc_ids: unique });
  },

  async setPlannerModel(serverId: number, provider: string, llmId: number | null): Promise<NudgeWriteResult> {
    if (llmId !== null) {
      const groups = await loadStructuredOutputModelGroups(serverId, "en-US");
      if (!groups.some((group) => group.provider === provider && group.models.some((model) => model.id === llmId)))
        return "stale";
    }
    return patchConfig(serverId, { llm_id: llmId });
  },

  setFrequency(serverId: number, level: EpisodeFrequencyLevel): Promise<NudgeWriteResult> {
    return patchConfig(serverId, { episode_frequency: level });
  },

  setChimeInEnabled(serverId: number, enabled: boolean): Promise<NudgeWriteResult> {
    return patchConfig(serverId, { chime_in_enabled: enabled });
  },

  setChimeInFrequency(serverId: number, level: EpisodeFrequencyLevel): Promise<NudgeWriteResult> {
    return patchConfig(serverId, { chime_in_frequency: level });
  },

  setChimeInCap(serverId: number, cap: number): Promise<NudgeWriteResult> {
    if (!Number.isInteger(cap) || cap < 1 || cap > DAILY_CHIME_IN_CAP_MAX) return Promise.resolve("invalid");
    return patchConfig(serverId, { daily_chime_in_cap: cap });
  },

  setLimits(serverId: number, limits: NudgeLimitsInput): Promise<NudgeWriteResult> {
    if (
      !isWeight(limits.reach_out_weight) ||
      !isWeight(limits.revive_weight) ||
      !isWeight(limits.new_topic_weight) ||
      !isWeight(limits.alter_talk_weight) ||
      !Number.isInteger(limits.daily_episode_cap) ||
      limits.daily_episode_cap < 1 ||
      limits.daily_episode_cap > DAILY_EPISODE_CAP_MAX
    )
      return Promise.resolve("invalid");
    return patchConfig(serverId, limits);
  },

  async setEpisodeEnabled(serverId: number, index: number, fp: string, enabled: boolean): Promise<NudgeWriteResult> {
    const view = await loadEpisodesView(serverId);
    if (view.fingerprint !== fp) return "stale";
    const entry = view.entries[index];
    if (!entry) return "stale";
    if (entry.custom) {
      const ok = await naturalNudgeRepository.updateCustomEpisode(serverId, entry.custom.episode_id, {
        ...entry.custom,
        enabled,
      });
      return ok ? "success" : "write-failed";
    }
    const disabled = new Set(view.config.disabled_builtin_episodes);
    if (enabled) disabled.delete(entry.definition.key);
    else disabled.add(entry.definition.key);
    return patchConfig(serverId, { disabled_builtin_episodes: [...disabled] });
  },

  async addCustomEpisode(serverId: number, input: CustomEpisodeTextInput): Promise<NudgeWriteResult> {
    const parsed = parseEpisodeText(input);
    if (!parsed) return "invalid";
    const id = await naturalNudgeRepository.insertCustomEpisode(serverId, parsed, CUSTOM_EPISODE_LIMIT);
    return id === null ? "limit" : "success";
  },

  async updateCustomEpisodeText(
    serverId: number,
    index: number,
    fp: string,
    input: CustomEpisodeTextInput,
  ): Promise<NudgeWriteResult> {
    const custom = findCustom(await loadEpisodesView(serverId), index, fp);
    if (custom === "stale") return "stale";
    const parsed = parseEpisodeText(input, custom);
    if (!parsed) return "invalid";
    return (await naturalNudgeRepository.updateCustomEpisode(serverId, custom.episode_id, parsed))
      ? "success"
      : "write-failed";
  },

  async setCustomEpisodeLists(
    serverId: number,
    index: number,
    fp: string,
    patch: { prerequisites?: readonly string[]; recommendedTools?: readonly string[] },
  ): Promise<NudgeWriteResult> {
    const custom = findCustom(await loadEpisodesView(serverId), index, fp);
    if (custom === "stale") return "stale";
    const prerequisites = patch.prerequisites ? [...new Set(patch.prerequisites)] : custom.prerequisites;
    const recommendedTools = patch.recommendedTools ? [...new Set(patch.recommendedTools)] : custom.recommended_tools;
    if (!prerequisites.every(isKnownPrerequisite) || !recommendedTools.every(isNudgeToolName)) return "invalid";
    const parsed = customEpisodeInputSchema.safeParse({
      ...custom,
      prerequisites,
      recommended_tools: recommendedTools,
    });
    if (!parsed.success) return "invalid";
    return (await naturalNudgeRepository.updateCustomEpisode(serverId, custom.episode_id, parsed.data))
      ? "success"
      : "write-failed";
  },

  async removeCustomEpisode(serverId: number, index: number, fp: string): Promise<NudgeWriteResult> {
    const custom = findCustom(await loadEpisodesView(serverId), index, fp);
    if (custom === "stale") return "stale";
    return (await naturalNudgeRepository.deleteCustomEpisode(serverId, custom.episode_id)) ? "success" : "stale";
  },

  /** Resync of a preset pointer: dropping the row makes it read the preset's defaults live again. */
  async clearPersonaOverride(personaId: number): Promise<NudgeWriteResult> {
    const current = await loadPersonaNudgeConfig(personaId);
    if (!current?.has_override) return "stale";
    return (await naturalNudgeRepository.deletePersonaConfig(personaId)) ? "success" : "write-failed";
  },

  async setTalkativeness(personaId: number, level: number): Promise<NudgeWriteResult> {
    const current = await loadPersonaNudgeConfig(personaId);
    if (!current) return "stale";
    if (!Number.isInteger(level) || level < 0 || level > 4) return "invalid";
    return (await naturalNudgeRepository.savePersonaConfig(personaId, { ...current, talkativeness: level }))
      ? "success"
      : "write-failed";
  },

  async addInterest(personaId: number, raw: NaturalNudgeInterest): Promise<NudgeWriteResult> {
    const current = await loadPersonaNudgeConfig(personaId);
    if (!current) return "stale";
    const parsed = naturalNudgeInterestSchema.safeParse(raw);
    if (!parsed.success) return "invalid";
    if (current.interests.length >= NATURAL_NUDGE_INTEREST_LIMIT) return "limit";
    return (await naturalNudgeRepository.savePersonaConfig(personaId, {
      ...current,
      interests: [...current.interests, parsed.data],
    }))
      ? "success"
      : "write-failed";
  },

  async editInterest(
    personaId: number,
    index: number,
    fp: string,
    raw: NaturalNudgeInterest | null,
  ): Promise<NudgeWriteResult> {
    const current = await loadPersonaNudgeConfig(personaId);
    const existing = current?.interests[index];
    if (!current || !existing || computeInterestFingerprint(personaId, index, existing) !== fp) return "stale";
    const interests = [...current.interests];
    if (raw === null) interests.splice(index, 1);
    else {
      const parsed = naturalNudgeInterestSchema.safeParse(raw);
      if (!parsed.success) return "invalid";
      interests[index] = parsed.data;
    }
    return (await naturalNudgeRepository.savePersonaConfig(personaId, { ...current, interests }))
      ? "success"
      : "write-failed";
  },
};

type NaturalNudgeOperations = typeof naturalNudgeOperations;

/** What a repaint carries between Natural Nudges routes; views missing here are loaded fresh. */
export interface NaturalNudgesPanelState {
  personaConfig?: PersonaNaturalNudgeConfig | null;
  settings?: NaturalNudgesSettingsView;
  episodes?: NudgeEpisodesView;
  selectedInterestIndex?: number;
  episodeStart?: number;
  selectedEpisodeIndex?: number;
  removeConfirmNonce?: string;
}

export interface NaturalNudgePanelDependencies {
  loadSettings(serverId: number, locale: string, chatState: TomoriState | null): Promise<NaturalNudgesSettingsView>;
  loadEpisodes(serverId: number): Promise<NudgeEpisodesView>;
  loadPersonaConfig(personaId: number): Promise<PersonaNaturalNudgeConfig | null>;
  operations: NaturalNudgeOperations;
}

export const naturalNudgePanelDependencies: NaturalNudgePanelDependencies = {
  loadSettings: loadSettingsView,
  loadEpisodes: loadEpisodesView,
  loadPersonaConfig: loadPersonaNudgeConfig,
  operations: naturalNudgeOperations,
};
