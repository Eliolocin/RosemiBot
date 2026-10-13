import type { TomoriState } from "@/types/db/schema";
import type { StructuredContextItem } from "@/types/misc/context";
import { getNovelAITokenLimits } from "@/utils/cache/novelaiCapabilityCache";
import { getCachedContextTokens, refreshNovelAISubscription } from "@/utils/cache/novelaiSubscriptionCache";
import { log } from "@/utils/misc/logger";
import { resolveChatMaxOutputTokens, resolveMaxOutputTokens } from "@/utils/provider/maxOutputTokens";
import { resolveModelLimits } from "@/utils/provider/modelLimits";
import { normalizeProviderName, providerUsesApiFamily } from "@/utils/provider/providerInfoRegistry";
import { decryptApiKey } from "@/utils/security/crypto";
import { truncateDialogueHistory } from "@/utils/text/contextTruncator";

/**
 * The context window history truncation works against, and the reply budget it reserves first.
 * NovelAI's `contextLength` is virtual (pre-scaled for the 4 chars/token estimator), so it is
 * comparable to estimated input tokens rather than to the model's published window.
 */
export interface ContextBudget {
  contextLength: number;
  outputReserve: number;
}

/**
 * Resolves the budget the live pipeline truncates against, or null for a provider whose window
 * TomoriBot does not know (truncation is then skipped).
 */
export async function resolveContextBudget(
  tomoriState: TomoriState,
  serverDiscId: string,
): Promise<ContextBudget | null> {
  if (providerUsesApiFamily(tomoriState.llm.llm_provider, "novelai")) {
    let naiSubscriptionTokens = getCachedContextTokens(serverDiscId);
    if (naiSubscriptionTokens === undefined && tomoriState.config.api_key) {
      try {
        const tempKey = await decryptApiKey(tomoriState.config.api_key, tomoriState.config.key_version || 1);
        naiSubscriptionTokens = await refreshNovelAISubscription(serverDiscId, tempKey);
      } catch (error) {
        log.warn("Failed to refresh NovelAI subscription for context truncation; using default token limits.", error);
      }
    }
    const tokenLimits = getNovelAITokenLimits(tomoriState.llm.llm_codename, naiSubscriptionTokens);
    if (!tokenLimits || tokenLimits.contextLength <= 0 || !tokenLimits.maxCompletionTokens) return null;
    // NovelAI has no dedicated output-token env cap, so the reserve falls back to the
    // subscription-tier ceiling unless the server set a `/model parameters` override.
    return {
      contextLength: tokenLimits.contextLength,
      outputReserve: resolveMaxOutputTokens({
        configured: tomoriState.config.llm_max_output_tokens,
        envRaw: undefined,
        fallback: tokenLimits.maxCompletionTokens,
        providerReportedMax: tokenLimits.maxCompletionTokens,
      }),
    };
  }

  const limits = await resolveModelLimits(tomoriState);
  if (!limits.contextWindow) return null;
  // Reserve exactly what the request builder sends: over-reserving drops history that would have fit.
  // The one exception is an OpenRouter model with no known ceiling, whose request omits max_tokens:
  // the default reply budget is reserved so a long channel still trims instead of overflowing.
  return {
    contextLength: limits.contextWindow,
    outputReserve: resolveChatMaxOutputTokens({
      provider: normalizeProviderName(tomoriState.llm.llm_provider),
      configured: tomoriState.config.llm_max_output_tokens,
      modelMaxOutputTokens: limits.maxOutputTokens,
      contextWindow: limits.contextWindow,
    }),
  };
}

/**
 * Drops the oldest history exchanges until the context fits the provider's budget.
 */
export async function applyProviderContextTruncation(
  contextItems: StructuredContextItem[],
  tomoriState: TomoriState,
  serverDiscId: string,
): Promise<StructuredContextItem[]> {
  const budget = await resolveContextBudget(tomoriState, serverDiscId);
  if (!budget) return contextItems;

  const { truncated, historyPairsDropped, sampleItemsDropped, totalDropped } = truncateDialogueHistory(
    contextItems,
    budget.contextLength,
    budget.outputReserve,
  );
  if (totalDropped === 0) return contextItems;

  log.warn(
    `History truncation: dropped ${historyPairsDropped} history exchange pair(s) and ${sampleItemsDropped} sample dialogue item(s) for ${tomoriState.llm.llm_codename} to preserve output budget`,
  );
  return truncated;
}
