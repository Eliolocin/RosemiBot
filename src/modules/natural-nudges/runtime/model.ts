import type { ErrorContext, TomoriState } from "@/types/db/schema";
import { llmModelRepo } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import { resolveCustomTextEndpointTarget } from "@/utils/provider/customEndpointService";
import { resolveChatMaxOutputTokens } from "@/utils/provider/maxOutputTokens";
import { resolveModelLimits } from "@/utils/provider/modelLimits";
import { normalizeProviderName } from "@/utils/provider/providerInfoRegistry";
import type { ProviderOptionCapability } from "@/utils/provider/providerOptionRegistry";
import { findProviderRequestDeniedError, reportProviderUsage } from "@/utils/provider/providerUsage";
import {
  resolveServerStructuredModel,
  type ResolvedServerStructuredModel,
} from "@/utils/provider/serverStructuredOutput";
import type { TokenUsage } from "@/utils/text/tokenEstimate";

/**
 * The provider-option slot that pays for a Natural Nudges call: a pinned model has its own slot,
 * while the server's chat model is paid as chat (`text`).
 */
export type NudgeModelSlot = Extract<ProviderOptionCapability, "text" | "nudge-planner" | "nudge-checker">;

export interface NudgeModelRef {
  llmId: number;
  slot: NudgeModelSlot;
}

export type NudgeModelResolution =
  | { kind: "ready"; resolved: ResolvedServerStructuredModel }
  | { kind: "unavailable"; reason: "model_unavailable" | "credentials" | "denied" };

/**
 * Resolves who pays for one Natural Nudges call. A provider option's refusal is an expected outcome
 * with no member to tell, so it is a warning and an `unavailable` result, never an error.
 */
export async function resolveNudgeModel(
  state: TomoriState,
  ref: NudgeModelRef,
  failureContext: ErrorContext,
): Promise<NudgeModelResolution> {
  try {
    const resolved = await resolveServerStructuredModel(state, ref.llmId, failureContext, ref.slot);
    if (!resolved) return { kind: "unavailable", reason: "model_unavailable" };
    if ("errorLogged" in resolved) return { kind: "unavailable", reason: "credentials" };
    return { kind: "ready", resolved };
  } catch (error) {
    if (!findProviderRequestDeniedError(error)) throw error;
    log.warn(`Natural Nudges: provider option refused ${ref.slot} model ${ref.llmId}`, undefined, failureContext);
    return { kind: "unavailable", reason: "denied" };
  }
}

/** True when a failed call was refused by the provider option paying for it. */
export function isNudgeCallDenied(resolved: ResolvedServerStructuredModel, cause: unknown): boolean {
  return findProviderRequestDeniedError(cause, resolved.usageContext) !== null;
}

/** Reports one call's usage to whoever pays for it and adds it to the running total. */
export function recordNudgeUsage(
  resolved: ResolvedServerStructuredModel,
  model: string,
  total: TokenUsage | null | undefined,
  reported: TokenUsage,
): TokenUsage {
  reportProviderUsage(resolved.usageContext, {
    modelCodename: model,
    costUsd: reported.costUsd,
    inputTokens: reported.inputTokens,
    outputTokens: reported.outputTokens,
  });
  return {
    inputTokens: (total?.inputTokens ?? 0) + reported.inputTokens,
    outputTokens: (total?.outputTokens ?? 0) + reported.outputTokens,
  };
}

/** Where one out-of-turn structured call goes and how long its answer may be. */
export async function resolveStructuredCallTarget(resolved: ResolvedServerStructuredModel) {
  const provider = resolved.state.llm.llm_provider;
  const target = provider.startsWith("custom:") ? await resolveCustomTextEndpointTarget(resolved.state) : null;
  const limits = await resolveModelLimits(resolved.state);
  return {
    model: resolved.state.llm.llm_codename,
    endpointUrl: target?.endpointUrl ?? undefined,
    maxOutputTokens: resolveChatMaxOutputTokens({
      provider: normalizeProviderName(provider),
      configured: resolved.state.config.llm_max_output_tokens,
      modelMaxOutputTokens: limits.maxOutputTokens,
      contextWindow: limits.contextWindow,
    }),
  };
}

export type PlannerModelSource = "pinned" | "chat";

export type PlannerModelStatus =
  | ({ kind: "ready"; source: PlannerModelSource } & NudgeModelRef)
  | { kind: "unusable"; llmId: number; source: PlannerModelSource; reason: "no_structured_output" | "unavailable" }
  | { kind: "none" };

/** The slot a planner-model call bills to: the pin's own slot, else the chat model's. */
export function plannerModelRef(state: TomoriState, pinnedLlmId: number | null): NudgeModelRef {
  return pinnedLlmId === null
    ? { llmId: state.llm.llm_id ?? 0, slot: "text" }
    : { llmId: pinnedLlmId, slot: "nudge-planner" };
}

/**
 * The planner model is the pinned `llm_id`, else the server's chat model (`state.llm`, never a
 * persona override). Either one must pass `resolveServerStructuredModel`; a pinned model that fails
 * does not fall back, because the admin chose it.
 */
export async function resolvePlannerModel(state: TomoriState, pinnedLlmId: number | null): Promise<PlannerModelStatus> {
  const source: PlannerModelSource = pinnedLlmId === null ? "chat" : "pinned";
  const ref = plannerModelRef(state, pinnedLlmId);
  // llm_id 0 is the unconfigured-model sentinel (`getUnconfiguredLlm`), not a real row.
  if (ref.llmId <= 0) return { kind: "none" };
  const resolution = await resolveNudgeModel(state, ref, { serverId: state.server_id });
  if (resolution.kind === "ready") return { kind: "ready", source, ...ref };
  const model = await llmModelRepo.loadById(ref.llmId);
  const reason = model && !model.supports_structoutput ? "no_structured_output" : "unavailable";
  return { kind: "unusable", llmId: ref.llmId, source, reason };
}
