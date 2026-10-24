import { computePersonaNudgeFingerprint, computePersonaNudgeListFingerprint } from "@/modules/natural-nudges/db/types";
import { createHash } from "node:crypto";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import {
  NATURAL_NUDGE_INTEREST_LIMIT,
  PERSONA_AUTHORED_IDLE_NUDGE_LIMIT,
  naturalNudgeInterestSchema,
  supportsCheckerChoice,
  type IdleNudgeFrequencyLevel,
  type NaturalNudgeCategory,
  type NaturalNudgeInterest,
  type NaturalNudgeRuntimeState,
  type PersonaNaturalNudgeConfig,
  type ServerNaturalNudgeConfig,
} from "@/modules/natural-nudges/db/types";
import {
  idleNudgeContentFromAuthored,
  loadPersonaNudgeBlockerView,
  parseIdleNudgeForm,
  type IdleNudgeForm,
  type PersonaNudgeBlockerView,
} from "@/modules/natural-nudges/discord/studioOperations";
import {
  activeNudgeTripRange,
  computeHeat,
  idleNudgesPerDay,
  heatWindowStart,
} from "@/modules/natural-nudges/runtime/meters";
import {
  loadConfigModelProviders,
  loadStructuredOutputModelGroups,
  type ConfigModelChoice,
  type StructuredOutputModelGroup,
} from "@/utils/discord/interactions/configModelOperations";
import { statRepository } from "@/utils/db/repositories";
import { resolveDescription } from "@/utils/text/localizer";
import type { TomoriState } from "@/types/db/schema";
import { resolveEffectiveChannelIds } from "@/modules/natural-nudges/runtime/channels";
import { invalidateNaturalNudgeConfigCache } from "@/modules/natural-nudges/runtime/configCache";
import { resolveMatcherBackend, type ResolvedChecker } from "@/modules/natural-nudges/runtime/matcher";
import {
  GENERATED_INTEREST_BATCH,
  generatePersonaInterests,
  mergeGeneratedInterests,
} from "@/modules/natural-nudges/runtime/interests";
import {
  type NudgeModelSlot,
  resolvePlannerModel,
  type PlannerModelStatus,
} from "@/modules/natural-nudges/runtime/model";
import { loadDecisionModelsForScope } from "@/providers/utils/providerFeatureExecutors";
import {
  claimProviderModelSelection,
  clearProviderModelSelection,
  findProviderOption,
} from "@/utils/provider/providerOptionRegistry";

export type NudgeWriteResult =
  | "success"
  | "unchanged"
  | "stale"
  | "invalid"
  | "limit"
  | "write-failed"
  | "no-model"
  | "generate-failed";

/** What the timer would use right now, which the page shows next to the saved settings. */
interface NaturalNudgesStatus {
  effectiveChannelIds: string[];
  plannerModel: PlannerModelStatus;
  chatModel: { codename: string; provider: string } | null;
  /** The model that would check Active Nudges right now; `model` is null when none can. */
  checker: { source: ResolvedChecker["source"]; model: string | null };
}

/** Decision models one provider offers the server that can answer the checker's `choice` question. */
interface CheckerDecisionModelGroup {
  provider: string;
  models: ConfigModelChoice[];
}

export interface NaturalNudgesSettingsView {
  config: ServerNaturalNudgeConfig;
  runtime: NaturalNudgeRuntimeState;
  /** Structured-output text models, which serve both the planner and a text-model checker. */
  plannerModels: StructuredOutputModelGroup[];
  checkerDecisionModels: CheckerDecisionModelGroup[];
  trackingEnabled: boolean;
  heat: number;
  perDay: number;
  /** Human messages between Active Nudge checks at the current heat and level; null below the heat floor. */
  activeNudgeRange: { min: number; max: number } | null;
  /** Null on modal paths, which must acknowledge within 3 seconds and never render it. */
  status: NaturalNudgesStatus | null;
}

/** Binds an interest edit to the interest at that position when the modal opened. */
export function computeInterestFingerprint(personaId: number, index: number, interest: NaturalNudgeInterest): string {
  return createHash("sha256")
    .update(`nudge-interest:${personaId}:${index}:${interest.label}\u0000${interest.description}`)
    .digest("base64url")
    .slice(0, 8);
}

/**
 * Binds an interest removal to the exact list its modal presented. Unchecked-means-remove derives the
 * removal set from positions, so a concurrent add or edit must invalidate the submit rather than
 * delete a different interest.
 */
export function computeInterestListFingerprint(personaId: number, interests: readonly NaturalNudgeInterest[]): string {
  return createHash("sha256")
    .update(`nudge-interests:${personaId}:${JSON.stringify(interests)}`)
    .digest("base64url")
    .slice(0, 8);
}

async function loadSettingsStatus(
  state: TomoriState,
  config: ServerNaturalNudgeConfig,
  now: Date,
): Promise<NaturalNudgesStatus> {
  const [effectiveChannelIds, plannerModel, checker] = await Promise.all([
    resolveEffectiveChannelIds(state.server_id, config, now),
    resolvePlannerModel(state, config.llm_id),
    resolveMatcherBackend(state, config),
  ]);
  const chatModel =
    (state.llm.llm_id ?? 0) > 0 ? { codename: state.llm.llm_codename, provider: state.llm.llm_provider } : null;
  return {
    effectiveChannelIds,
    plannerModel,
    chatModel,
    checker: { source: checker.source, model: checker.backend?.model ?? null },
  };
}

async function loadCheckerDecisionModels(serverId: number, locale: string): Promise<CheckerDecisionModelGroup[]> {
  const [options, providers] = await Promise.all([
    loadDecisionModelsForScope({ kind: "server", ownerId: serverId }),
    loadConfigModelProviders(serverId, "decision"),
  ]);
  const groups = new Map<string, ConfigModelChoice[]>();
  for (const provider of providers) {
    const catalogProvider = findProviderOption(provider)?.catalogProvider ?? provider;
    const models = options
      .filter(({ model }) => model.provider === catalogProvider && supportsCheckerChoice(model))
      .map(({ model }) => ({
        id: model.decision_model_id,
        name: model.codename,
        description: resolveDescription(model.descriptions, locale),
      }));
    if (models.length > 0) groups.set(provider, models);
  }
  return [...groups].map(([provider, models]) => ({ provider, models }));
}

async function loadSettingsView(
  serverId: number,
  locale: string,
  chatState: TomoriState | null,
): Promise<NaturalNudgesSettingsView> {
  const now = new Date();
  const [config, runtime, plannerModels, checkerDecisionModels, dailyCounts] = await Promise.all([
    naturalNudgeRepository.loadServerConfig(serverId),
    naturalNudgeRepository.loadRuntimeState(serverId),
    loadStructuredOutputModelGroups(serverId, locale),
    loadCheckerDecisionModels(serverId, locale),
    statRepository.getServerDailyMessageCounts({ serverId, from: heatWindowStart(now) }),
  ]);
  const heat = computeHeat(dailyCounts, now);
  return {
    config,
    runtime,
    plannerModels,
    checkerDecisionModels,
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

/**
 * Gives a pinned slot to the provider its model was picked under, or releases it when unpinned, so the
 * same catalog model bills whichever provider the admin chose.
 */
async function settleSlotOwner(
  state: TomoriState,
  slot: Extract<NudgeModelSlot, "nudge-planner" | "nudge-checker">,
  provider: string | null,
): Promise<NudgeWriteResult> {
  const scope = { kind: "server" as const, ownerId: state.server_id, state };
  const settled =
    provider === null
      ? await clearProviderModelSelection({ scope, capability: slot })
      : await claimProviderModelSelection({ scope, provider, capability: slot });
  return settled ? "success" : "write-failed";
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

  async setPlannerModel(state: TomoriState, provider: string, llmId: number | null): Promise<NudgeWriteResult> {
    const serverId = state.server_id;
    if (llmId !== null) {
      const groups = await loadStructuredOutputModelGroups(serverId, "en-US");
      if (!groups.some((group) => group.provider === provider && group.models.some((model) => model.id === llmId)))
        return "stale";
    }
    const written = await patchConfig(serverId, { llm_id: llmId });
    if (written !== "success") return written;
    return settleSlotOwner(state, "nudge-planner", llmId === null ? null : provider);
  },

  /** Pins a text or Decision model as the Active Nudge Checker; null returns to the recommended checker. */
  async setCheckerModel(
    state: TomoriState,
    choice: { kind: "llm" | "decision"; provider: string; id: number } | null,
  ): Promise<NudgeWriteResult> {
    const serverId = state.server_id;
    if (choice !== null) {
      const groups =
        choice.kind === "llm"
          ? await loadStructuredOutputModelGroups(serverId, "en-US")
          : await loadCheckerDecisionModels(serverId, "en-US");
      if (
        !groups.some(
          (group) => group.provider === choice.provider && group.models.some((model) => model.id === choice.id),
        )
      )
        return "stale";
    }
    const written = await patchConfig(
      serverId,
      choice === null
        ? { checker_llm_id: null, checker_decision_model_id: null }
        : choice.kind === "llm"
          ? { checker_llm_id: choice.id, checker_decision_model_id: null }
          : { checker_llm_id: null, checker_decision_model_id: choice.id },
    );
    if (written !== "success") return written;
    return settleSlotOwner(state, "nudge-checker", choice?.provider ?? null);
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

  /** Adds up to a batch of generated interests that are new to the persona, using the Idle Nudge Planner model. */
  async generateInterests(persona: TomoriState): Promise<NudgeWriteResult> {
    const personaId = persona.persona_id as number;
    const current = await loadPersonaNudgeConfig(personaId);
    if (!current) return "stale";
    const room = Math.min(GENERATED_INTEREST_BATCH, NATURAL_NUDGE_INTEREST_LIMIT - current.interests.length);
    if (room <= 0) return "limit";
    const serverConfig = await naturalNudgeRepository.loadServerConfig(persona.server_id);
    const model = await resolvePlannerModel(persona, serverConfig.llm_id);
    if (model.kind !== "ready") return "no-model";
    const outcome = await generatePersonaInterests(persona, model, current.interests, room);
    if (outcome.status === "unavailable") return "no-model";
    if (outcome.status === "failed") return "generate-failed";
    // The call takes seconds, so merge onto a fresh read rather than overwrite an edit made meanwhile.
    const latest = await loadPersonaNudgeConfig(personaId);
    if (!latest) return "stale";
    const added = mergeGeneratedInterests(latest.interests, outcome.interests).slice(0, room);
    if (added.length === 0)
      return latest.interests.length >= NATURAL_NUDGE_INTEREST_LIMIT ? "limit" : "generate-failed";
    return (await naturalNudgeRepository.savePersonaConfig(personaId, {
      ...latest,
      interests: [...latest.interests, ...added],
    }))
      ? "success"
      : "write-failed";
  },

  async editInterest(
    personaId: number,
    index: number,
    fp: string,
    raw: NaturalNudgeInterest,
  ): Promise<NudgeWriteResult> {
    const current = await loadPersonaNudgeConfig(personaId);
    const existing = current?.interests[index];
    if (!current || !existing || computeInterestFingerprint(personaId, index, existing) !== fp) return "stale";
    const parsed = naturalNudgeInterestSchema.safeParse(raw);
    if (!parsed.success) return "invalid";
    const interests = [...current.interests];
    interests[index] = parsed.data;
    return (await naturalNudgeRepository.savePersonaConfig(personaId, { ...current, interests }))
      ? "success"
      : "write-failed";
  },

  async removeInterests(personaId: number, fp: string, keptIndices: ReadonlySet<number>): Promise<NudgeWriteResult> {
    const current = await loadPersonaNudgeConfig(personaId);
    if (!current || computeInterestListFingerprint(personaId, current.interests) !== fp) return "stale";
    const interests = current.interests.filter((_, index) => keptIndices.has(index));
    // Saving an unchanged list would still give a preset pointer its own override row.
    if (interests.length === current.interests.length) return "success";
    return (await naturalNudgeRepository.savePersonaConfig(personaId, { ...current, interests }))
      ? "success"
      : "write-failed";
  },

  /** Adds one owned definition; the repository snapshots an inherited preset list on this first content edit. */
  async addPersonaNudge(
    personaId: number,
    category: NaturalNudgeCategory,
    form: IdleNudgeForm,
  ): Promise<NudgeWriteResult> {
    const current = await loadPersonaNudgeConfig(personaId);
    if (!current) return "stale";
    if (current.idle_nudges.length >= PERSONA_AUTHORED_IDLE_NUDGE_LIMIT) return "limit";
    const draft = parseIdleNudgeForm(category, form);
    if (!draft) return "invalid";
    return naturalNudgeRepository.addPersonaIdleNudge(personaId, draft);
  },

  /** Edits the definition a fingerprint still matches, preserving its stable local ID and availability. */
  async editPersonaNudge(
    personaId: number,
    idleNudgeId: string,
    fp: string,
    form: IdleNudgeForm,
  ): Promise<NudgeWriteResult> {
    const current = await loadPersonaNudgeConfig(personaId);
    const authored = current?.idle_nudges.find((nudge) => nudge.id === idleNudgeId);
    if (
      !current ||
      !authored ||
      computePersonaNudgeFingerprint(personaId, idleNudgeContentFromAuthored(authored)) !== fp
    )
      return "stale";
    const draft = parseIdleNudgeForm(authored.category, form);
    if (!draft) return "invalid";
    return naturalNudgeRepository.updatePersonaIdleNudge(personaId, idleNudgeId, draft);
  },

  async setPersonaNudgeAvailability(
    personaId: number,
    idleNudgeId: string,
    enabled: boolean,
  ): Promise<NudgeWriteResult> {
    const current = await loadPersonaNudgeConfig(personaId);
    if (!current?.idle_nudges.some((nudge) => nudge.id === idleNudgeId)) return "stale";
    return naturalNudgeRepository.setPersonaIdleNudgeAvailability(personaId, idleNudgeId, enabled);
  },

  /** Removes only unchecked entries that still belong to the frozen list the modal presented. */
  async removePersonaNudges(
    personaId: number,
    fp: string,
    presentedIds: readonly string[],
    keptIds: ReadonlySet<string>,
  ): Promise<NudgeWriteResult> {
    const current = await loadPersonaNudgeConfig(personaId);
    if (!current || computePersonaNudgeListFingerprint(personaId, current.idle_nudges) !== fp) return "stale";
    const targets = presentedIds.filter(
      (id) => !keptIds.has(id) && current.idle_nudges.some((nudge) => nudge.id === id),
    );
    if (targets.length === 0) return "unchanged";
    for (const id of targets) {
      const nudge = current.idle_nudges.find((nudge) => nudge.id === id);
      if (!nudge) return "stale";
      const result = await naturalNudgeRepository.removePersonaIdleNudge(
        personaId,
        id,
        computePersonaNudgeFingerprint(personaId, nudge),
      );
      if (result !== "success") return result;
    }
    return "success";
  },

  async restorePersonaNudgeList(personaId: number, expectedFingerprint: string): Promise<NudgeWriteResult> {
    const current = await loadPersonaNudgeConfig(personaId);
    if (!current) return "stale";
    return naturalNudgeRepository.restorePersonaIdleNudgeList(personaId, expectedFingerprint);
  },
};

type NaturalNudgeOperations = typeof naturalNudgeOperations;

/** What a repaint carries between Natural Nudges routes; views missing here are loaded fresh. */
export interface NaturalNudgesPanelState {
  personaConfig?: PersonaNaturalNudgeConfig | null;
  personaNudges?: PersonaNudgeBlockerView;
  settings?: NaturalNudgesSettingsView;
}

export interface NaturalNudgePanelDependencies {
  loadSettings(serverId: number, locale: string, chatState: TomoriState | null): Promise<NaturalNudgesSettingsView>;
  loadPersonaConfig(personaId: number): Promise<PersonaNaturalNudgeConfig | null>;
  loadPersonaNudges(
    persona: TomoriState,
    personas: readonly TomoriState[],
    config: PersonaNaturalNudgeConfig,
  ): Promise<PersonaNudgeBlockerView>;
  operations: NaturalNudgeOperations;
}

export const naturalNudgePanelDependencies: NaturalNudgePanelDependencies = {
  loadSettings: loadSettingsView,
  loadPersonaConfig: loadPersonaNudgeConfig,
  loadPersonaNudges: loadPersonaNudgeBlockerView,
  operations: naturalNudgeOperations,
};
