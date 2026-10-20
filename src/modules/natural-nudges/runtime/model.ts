import type { TomoriState } from "@/types/db/schema";
import { llmModelRepo } from "@/utils/db/repositories";
import { resolveCustomTextEndpointTarget } from "@/utils/provider/customEndpointService";
import { resolveChatMaxOutputTokens } from "@/utils/provider/maxOutputTokens";
import { resolveModelLimits } from "@/utils/provider/modelLimits";
import { normalizeProviderName } from "@/utils/provider/providerInfoRegistry";
import {
  resolveServerStructuredModel,
  type ResolvedServerStructuredModel,
} from "@/utils/provider/serverStructuredOutput";

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
  | { kind: "ready"; llmId: number; source: PlannerModelSource }
  | { kind: "unusable"; llmId: number; source: PlannerModelSource; reason: "no_structured_output" | "unavailable" }
  | { kind: "none" };

/**
 * The planner model is the pinned `llm_id`, else the server's chat model (`state.llm`, never a
 * persona override). Either one must pass `resolveServerStructuredModel`; a pinned model that fails
 * does not fall back, because the admin chose it.
 */
export async function resolvePlannerModel(state: TomoriState, pinnedLlmId: number | null): Promise<PlannerModelStatus> {
  const source: PlannerModelSource = pinnedLlmId === null ? "chat" : "pinned";
  const llmId = pinnedLlmId ?? state.llm.llm_id ?? 0;
  // llm_id 0 is the unconfigured-model sentinel (`getUnconfiguredLlm`), not a real row.
  if (llmId <= 0) return { kind: "none" };
  const resolved = await resolveServerStructuredModel(state, llmId, { serverId: state.server_id });
  if (resolved && !("errorLogged" in resolved)) return { kind: "ready", llmId, source };
  const model = await llmModelRepo.loadById(llmId);
  const reason = model && !model.supports_structoutput ? "no_structured_output" : "unavailable";
  return { kind: "unusable", llmId, source, reason };
}
