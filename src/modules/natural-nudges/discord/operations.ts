import { createHash } from "node:crypto";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import {
  NATURAL_NUDGE_INTEREST_LIMIT,
  naturalNudgeInterestSchema,
  type IdleNudgeFrequencyLevel,
  type NaturalNudgeInterest,
  type NaturalNudgeRuntimeState,
  type PersonaNaturalNudgeConfig,
  type ServerNaturalNudgeConfig,
} from "@/modules/natural-nudges/db/types";
import {
  activeNudgeTripRange,
  computeHeat,
  idleNudgesPerDay,
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
  /** Which model would match Active Nudges right now, or null when none can. */
  matcher: { kind: "decision"; model: string } | { kind: "llm" } | null;
}

export interface NaturalNudgesSettingsView {
  config: ServerNaturalNudgeConfig;
  runtime: NaturalNudgeRuntimeState;
  plannerModels: StructuredOutputModelGroup[];
  trackingEnabled: boolean;
  heat: number;
  perDay: number;
  /** Human messages between Active Nudge checks at the current heat and level; null below the heat floor. */
  activeNudgeRange: { min: number; max: number } | null;
  /** Null on modal paths, which must acknowledge within 3 seconds and never render it. */
  status: NaturalNudgesStatus | null;
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
    perDay: idleNudgesPerDay(heat, config.idle_nudge_frequency),
    activeNudgeRange: activeNudgeTripRange(heat, config.active_nudge_frequency),
    status: chatState ? await loadSettingsStatus(chatState, config, now) : null,
  };
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

const naturalNudgeOperations = {
  setIdleNudgesEnabled(serverId: number, enabled: boolean): Promise<NudgeWriteResult> {
    return patchConfig(serverId, { idle_nudges_enabled: enabled });
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

  setFrequency(serverId: number, level: IdleNudgeFrequencyLevel): Promise<NudgeWriteResult> {
    return patchConfig(serverId, { idle_nudge_frequency: level });
  },

  setActiveNudgesEnabled(serverId: number, enabled: boolean): Promise<NudgeWriteResult> {
    return patchConfig(serverId, { active_nudges_enabled: enabled });
  },

  setActiveNudgesFrequency(serverId: number, level: IdleNudgeFrequencyLevel): Promise<NudgeWriteResult> {
    return patchConfig(serverId, { active_nudge_frequency: level });
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
  selectedInterestIndex?: number;
}

export interface NaturalNudgePanelDependencies {
  loadSettings(serverId: number, locale: string, chatState: TomoriState | null): Promise<NaturalNudgesSettingsView>;
  loadPersonaConfig(personaId: number): Promise<PersonaNaturalNudgeConfig | null>;
  operations: NaturalNudgeOperations;
}

export const naturalNudgePanelDependencies: NaturalNudgePanelDependencies = {
  loadSettings: loadSettingsView,
  loadPersonaConfig: loadPersonaNudgeConfig,
  operations: naturalNudgeOperations,
};
