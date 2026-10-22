import { createHash } from "node:crypto";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import {
  CUSTOM_IDLE_NUDGE_LIMIT,
  customIdleNudgeInputSchema,
  NATURAL_NUDGE_INTEREST_LIMIT,
  naturalNudgeInterestSchema,
  type CustomIdleNudgeInput,
  type CustomIdleNudgeRow,
  type IdleNudgeFrequencyLevel,
  type NaturalNudgeInterest,
  type NaturalNudgeRuntimeState,
  type PersonaNaturalNudgeConfig,
  type ServerNaturalNudgeConfig,
} from "@/modules/natural-nudges/db/types";
import {
  BUILTIN_IDLE_NUDGES,
  customIdleNudgeDefinition,
  isKnownPrerequisite,
  isNudgeToolName,
  type IdleNudgeDefinition,
} from "@/modules/natural-nudges/runtime/idleNudges";
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

export interface IdleNudgeEntry {
  definition: IdleNudgeDefinition;
  enabled: boolean;
  /** Present for custom idle nudges, whose rows the edit routes address. */
  custom?: CustomIdleNudgeRow;
}

export interface IdleNudgesView {
  config: ServerNaturalNudgeConfig;
  entries: IdleNudgeEntry[];
  fingerprint: string;
}

/** Binds an index-addressed idle nudge write to the exact list the control rendered. */
export function computeIdleNudgeListFingerprint(entries: readonly IdleNudgeEntry[]): string {
  return createHash("sha256")
    .update(`idle-nudges:${entries.map((entry) => entry.definition.key).join("\u0000")}`)
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
    perDay: idleNudgesPerDay(heat, config.idle_nudge_frequency),
    activeNudgeRange: activeNudgeTripRange(heat, config.active_nudge_frequency),
    status: chatState ? await loadSettingsStatus(chatState, config, now) : null,
  };
}

async function loadIdleNudgesView(serverId: number): Promise<IdleNudgesView> {
  const [config, customIdleNudges] = await Promise.all([
    naturalNudgeRepository.loadServerConfig(serverId),
    naturalNudgeRepository.listCustomIdleNudges(serverId),
  ]);
  const entries: IdleNudgeEntry[] = [
    ...BUILTIN_IDLE_NUDGES.map((definition) => ({
      definition,
      enabled: !config.disabled_builtin_idle_nudges.includes(definition.key),
    })),
    ...customIdleNudges.map((custom) => ({
      definition: customIdleNudgeDefinition(custom),
      enabled: custom.enabled,
      custom,
    })),
  ];
  return { config, entries, fingerprint: computeIdleNudgeListFingerprint(entries) };
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

/** Text fields for a custom idle nudge; prerequisites and tools are edited on the detail view. */
interface CustomIdleNudgeTextInput {
  category: string;
  title: string;
  brief: string;
  agendaHint: string;
}

function parseIdleNudgeText(
  input: CustomIdleNudgeTextInput,
  existing?: CustomIdleNudgeRow,
): CustomIdleNudgeInput | null {
  const parsed = customIdleNudgeInputSchema.safeParse({
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

function findCustom(view: IdleNudgesView, index: number, fp: string): CustomIdleNudgeRow | "stale" {
  if (view.fingerprint !== fp) return "stale";
  return view.entries[index]?.custom ?? "stale";
}

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

  async setIdleNudgeEnabled(serverId: number, index: number, fp: string, enabled: boolean): Promise<NudgeWriteResult> {
    const view = await loadIdleNudgesView(serverId);
    if (view.fingerprint !== fp) return "stale";
    const entry = view.entries[index];
    if (!entry) return "stale";
    if (entry.custom) {
      const ok = await naturalNudgeRepository.updateCustomIdleNudge(serverId, entry.custom.custom_idle_nudge_id, {
        ...entry.custom,
        enabled,
      });
      return ok ? "success" : "write-failed";
    }
    const disabled = new Set(view.config.disabled_builtin_idle_nudges);
    if (enabled) disabled.delete(entry.definition.key);
    else disabled.add(entry.definition.key);
    return patchConfig(serverId, { disabled_builtin_idle_nudges: [...disabled] });
  },

  async addCustomIdleNudge(serverId: number, input: CustomIdleNudgeTextInput): Promise<NudgeWriteResult> {
    const parsed = parseIdleNudgeText(input);
    if (!parsed) return "invalid";
    const id = await naturalNudgeRepository.insertCustomIdleNudge(serverId, parsed, CUSTOM_IDLE_NUDGE_LIMIT);
    return id === null ? "limit" : "success";
  },

  async updateCustomIdleNudgeText(
    serverId: number,
    index: number,
    fp: string,
    input: CustomIdleNudgeTextInput,
  ): Promise<NudgeWriteResult> {
    const custom = findCustom(await loadIdleNudgesView(serverId), index, fp);
    if (custom === "stale") return "stale";
    const parsed = parseIdleNudgeText(input, custom);
    if (!parsed) return "invalid";
    return (await naturalNudgeRepository.updateCustomIdleNudge(serverId, custom.custom_idle_nudge_id, parsed))
      ? "success"
      : "write-failed";
  },

  async setCustomIdleNudgeLists(
    serverId: number,
    index: number,
    fp: string,
    patch: { prerequisites?: readonly string[]; recommendedTools?: readonly string[] },
  ): Promise<NudgeWriteResult> {
    const custom = findCustom(await loadIdleNudgesView(serverId), index, fp);
    if (custom === "stale") return "stale";
    const prerequisites = patch.prerequisites ? [...new Set(patch.prerequisites)] : custom.prerequisites;
    const recommendedTools = patch.recommendedTools ? [...new Set(patch.recommendedTools)] : custom.recommended_tools;
    if (!prerequisites.every(isKnownPrerequisite) || !recommendedTools.every(isNudgeToolName)) return "invalid";
    const parsed = customIdleNudgeInputSchema.safeParse({
      ...custom,
      prerequisites,
      recommended_tools: recommendedTools,
    });
    if (!parsed.success) return "invalid";
    return (await naturalNudgeRepository.updateCustomIdleNudge(serverId, custom.custom_idle_nudge_id, parsed.data))
      ? "success"
      : "write-failed";
  },

  async removeCustomIdleNudge(serverId: number, index: number, fp: string): Promise<NudgeWriteResult> {
    const custom = findCustom(await loadIdleNudgesView(serverId), index, fp);
    if (custom === "stale") return "stale";
    return (await naturalNudgeRepository.deleteCustomIdleNudge(serverId, custom.custom_idle_nudge_id))
      ? "success"
      : "stale";
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
  idleNudges?: IdleNudgesView;
  selectedInterestIndex?: number;
  idleNudgeStart?: number;
  selectedIdleNudgeIndex?: number;
  removeConfirmNonce?: string;
}

export interface NaturalNudgePanelDependencies {
  loadSettings(serverId: number, locale: string, chatState: TomoriState | null): Promise<NaturalNudgesSettingsView>;
  loadIdleNudges(serverId: number): Promise<IdleNudgesView>;
  loadPersonaConfig(personaId: number): Promise<PersonaNaturalNudgeConfig | null>;
  operations: NaturalNudgeOperations;
}

export const naturalNudgePanelDependencies: NaturalNudgePanelDependencies = {
  loadSettings: loadSettingsView,
  loadIdleNudges: loadIdleNudgesView,
  loadPersonaConfig: loadPersonaNudgeConfig,
  operations: naturalNudgeOperations,
};
