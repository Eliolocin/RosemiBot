/**
 * Web-search dispatcher.
 *
 * Walks an ordered list of engines and returns the first successful result.
 * For non-text categories, returns a friendly "category unavailable" message
 * when no engine in the chain supports/serves the request.
 *
 * Chain order: Brave → SearXNG → OpenRouter → DuckDuckGo.
 *   - Brave first (lowest latency, best quality when keyed).
 *   - SearXNG plugs in for self-hosted operators without a Brave key.
 *   - DuckDuckGo is the keyless text-only fallback.
 */

import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { log } from "@/utils/misc/logger";
import { reportProviderFailure } from "@/utils/provider/providerErrorMetrics";
import { localizer } from "@/utils/text/localizer";
import { BraveEngine } from "./braveEngine";
import { SearxngEngine } from "./searxngEngine";
import { DuckDuckGoEngine } from "./duckduckgoEngine";
import { OpenRouterEngine } from "@/tools/webSearch/openrouterEngine";
import { getSearchCategoryLabel } from "./categoryMetadata";
import type { SearchCategory, WebSearchEngine, WebSearchEngineFailure } from "./types";

/** Rate limits, bot challenges, credential and credit refusals, and empty results are not outages. */
const REFUSAL_FAILURES = new Set(["missing_key", "challenge", "rate_limited", "empty_results"]);
const REFUSAL_STATUSES = new Set([401, 402, 403, 429]);

function isEngineRefusal(data: unknown): boolean {
  if (!data || typeof data !== "object" || !("failure" in data)) return false;
  const { failure, status } = data as WebSearchEngineFailure;
  return REFUSAL_FAILURES.has(failure) || (status !== undefined && REFUSAL_STATUSES.has(status));
}

// Singleton chain : engines are stateless so a single instance is reusable
//    across all tool invocations.
const ENGINE_CHAIN: readonly WebSearchEngine[] = [
  new BraveEngine(),
  new SearxngEngine(),
  new OpenRouterEngine(),
  new DuckDuckGoEngine(),
];

/**
 * Execute a web search, walking the chain until one engine returns a
 * `success: true` result. Engines that are unavailable or that fail are
 * skipped silently and the next chain member is tried.
 */
export async function executeWebSearchWithFallback(
  query: string,
  category: SearchCategory,
  context: ToolContext,
  count?: number,
): Promise<ToolResult> {
  let lastError: string | undefined;
  const failures: Array<{ engine: string; error: string; refusal: boolean }> = [];
  const searchContext: ToolContext = { ...context, progressNoticeState: { attempted: false } };

  for (const engine of ENGINE_CHAIN) {
    if (context.abortSignal?.aborted) break;
    // Filter: must support the category and be available right now.
    if (!engine.supportsCategory(category)) continue;
    if (!(await engine.available(context))) continue;
    if (context.abortSignal?.aborted) break;

    log.info(`web_search dispatch: trying engine "${engine.name}" for category="${category}"`);

    try {
      const result = await engine.search(query, category, searchContext, count);
      if (context.abortSignal?.aborted) break;
      if (result.success) {
        log.success(`web_search dispatch: engine "${engine.name}" succeeded`);
        return result;
      }
      lastError = result.error ?? result.message ?? `${engine.name} returned unsuccessful result`;
      log.warn(`web_search dispatch: engine "${engine.name}" failed: ${lastError}`);
      failures.push({ engine: engine.name, error: lastError, refusal: isEngineRefusal(result.data) });
    } catch (error) {
      lastError = (error as Error).message;
      log.warn(`web_search dispatch: engine "${engine.name}" threw: ${lastError}`);
      failures.push({ engine: engine.name, error: lastError, refusal: false });
    }
  }

  if (context.abortSignal?.aborted) {
    return { success: false, error: "Web search was cancelled." };
  }

  // A category no available engine serves is the expected "unavailable" reply, so only a chain whose
  // every attempted engine failed is reported.
  if (failures.length > 0) {
    await reportProviderFailure({
      summary: "Every web search engine failed",
      errorType: "WebSearchFailed",
      error: undefined,
      expected: failures.every(({ refusal }) => refusal),
      detail: failures.map(({ engine, error }) => `${engine}: ${error}`).join("; "),
      serverId: context.tomoriState.server_id,
      userId: context.internalUserId ?? null,
      dimensions: { operation: "web-search", category, attempted: failures.length },
    });
  }

  // All engines exhausted , so return a localized "category unavailable" message.
  //    For text, this means the entire chain is down; for image/video/news, this
  //    is the typical "no provider supports this category" path.
  const description = localizer(context.locale, "tools.search.category_unavailable_description", {
    category: getSearchCategoryLabel(context.locale, category),
  });

  return {
    success: false,
    error: lastError ?? `No engine available for category "${category}"`,
    message: description,
  };
}
