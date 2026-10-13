import type { TomoriState } from "@/types/db/schema";
import {
  getLiveModelLimits,
  isLiveModelLimitsRefreshDue,
  type LiveLimitsProvider,
  refreshLiveModelLimits,
} from "@/utils/cache/liveModelLimitsCache";
import { getOpenRouterTokenLimits } from "@/utils/cache/openrouterCapabilityCache";
import { log } from "@/utils/misc/logger";
import { resolveCustomTextEndpointTarget } from "@/utils/provider/customEndpointService";
import { resolveChatMaxOutputTokens } from "@/utils/provider/maxOutputTokens";
import { normalizeProviderName } from "@/utils/provider/providerInfoRegistry";
import { decryptApiKey } from "@/utils/security/crypto";

/** Null means unknown: an unknown window skips history truncation, an unknown ceiling skips clamping. */
export interface ModelLimits {
  contextWindow: number | null;
  maxOutputTokens: number | null;
}

function positiveOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

function isLiveLimitsProvider(provider: string): provider is LiveLimitsProvider {
  return provider === "anthropic" || provider === "google";
}

/**
 * Starts a background lookup with the key this request would use. The current call keeps the
 * catalog limits, so no message waits on the provider's models API.
 */
function scheduleLiveModelLimitsLookup(tomoriState: TomoriState, provider: LiveLimitsProvider): void {
  const codename = tomoriState.llm.llm_codename;
  const encryptedKey = tomoriState.config.api_key;
  if (!encryptedKey || !isLiveModelLimitsRefreshDue(provider, codename)) return;
  void decryptApiKey(encryptedKey, tomoriState.config.key_version || 1)
    .then((apiKey) => refreshLiveModelLimits(provider, codename, apiKey))
    .catch(() => log.metric("live_model_limits_key_unavailable", { provider, codename }));
}

/**
 * Limits a provider reports at runtime, which outrank the catalog because they track model changes
 * the catalog has not been reviewed for yet, and they cover scoped registrations the catalog never lists.
 */
function resolveLiveModelLimits(tomoriState: TomoriState, provider: string): Partial<ModelLimits> {
  const codename = tomoriState.llm.llm_codename;
  if (provider === "openrouter") {
    const tokenLimits = getOpenRouterTokenLimits(codename);
    return {
      contextWindow: positiveOrNull(tokenLimits?.contextLength),
      maxOutputTokens: positiveOrNull(tokenLimits?.maxCompletionTokens),
    };
  }
  if (isLiveLimitsProvider(provider)) {
    scheduleLiveModelLimitsLookup(tomoriState, provider);
    return getLiveModelLimits(provider, codename) ?? {};
  }
  return {};
}

/**
 * The active model's context window and output ceiling: a live provider value first, then the
 * catalog column, each field on its own. A custom endpoint's window is the `num_ctx` its request
 * sends, so an unset `num_ctx` stays unknown. NovelAI windows depend on the subscription tier and are
 * resolved by its own capability cache instead.
 */
export async function resolveModelLimits(tomoriState: TomoriState): Promise<ModelLimits> {
  const provider = normalizeProviderName(tomoriState.llm.llm_provider);
  if (provider === "custom") {
    const { numCtx } = await resolveCustomTextEndpointTarget(tomoriState);
    return { contextWindow: positiveOrNull(numCtx), maxOutputTokens: null };
  }

  const live = resolveLiveModelLimits(tomoriState, provider);
  return {
    contextWindow: live.contextWindow ?? positiveOrNull(tomoriState.llm.context_window),
    maxOutputTokens: live.maxOutputTokens ?? positiveOrNull(tomoriState.llm.max_output_tokens),
  };
}

/**
 * The `max_tokens` a chat request sends, shared by the provider request builders and the prompt
 * snapshot so the snapshot shows what is actually sent.
 *
 * Undefined only for an OpenRouter model with no reported ceiling (`other-model` or a cache miss):
 * the request omits max_tokens so the model self-manages. An explicit `/model parameters` override
 * is still sent there, because the "lower output tokens" tip on 402/400 errors depends on it.
 */
export async function resolveRequestMaxOutputTokens(tomoriState: TomoriState): Promise<number | undefined> {
  const provider = normalizeProviderName(tomoriState.llm.llm_provider);
  const configured = tomoriState.config.llm_max_output_tokens;
  const { contextWindow, maxOutputTokens } = await resolveModelLimits(tomoriState);
  if (provider === "openrouter" && !maxOutputTokens) {
    return typeof configured === "number" && configured > 0 ? configured : undefined;
  }
  return resolveChatMaxOutputTokens({ provider, configured, modelMaxOutputTokens: maxOutputTokens, contextWindow });
}
