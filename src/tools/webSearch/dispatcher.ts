/**
 * Web-search dispatcher.
 *
 * Walks an ordered list of engines and returns the first successful result.
 * For non-text categories, returns a friendly "category unavailable" message
 * when no engine in the chain supports/serves the request.
 *
 * Chain order: Brave → SearXNG → DuckDuckGo.
 *   - Brave first (lowest latency, best quality when keyed).
 *   - SearXNG plugs in for self-hosted operators without a Brave key.
 *   - DuckDuckGo is the keyless text-only fallback.
 */

import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { BraveEngine } from "./braveEngine";
import { SearxngEngine } from "./searxngEngine";
import { DuckDuckGoEngine } from "./duckduckgoEngine";
import { getSearchCategoryLabel } from "./categoryMetadata";
import type { SearchCategory, WebSearchEngine } from "./types";

// Singleton chain : engines are stateless so a single instance is reusable
//    across all tool invocations.
const ENGINE_CHAIN: readonly WebSearchEngine[] = [new BraveEngine(), new SearxngEngine(), new DuckDuckGoEngine()];

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

  for (const engine of ENGINE_CHAIN) {
    // Filter: must support the category and be available right now.
    if (!engine.supportsCategory(category)) continue;
    if (!(await engine.available(context))) continue;

    log.info(`web_search dispatch: trying engine "${engine.name}" for category="${category}"`);

    try {
      const result = await engine.search(query, category, context, count);
      if (result.success) {
        log.success(`web_search dispatch: engine "${engine.name}" succeeded`);
        return result;
      }
      lastError = result.error ?? result.message ?? `${engine.name} returned unsuccessful result`;
      log.warn(`web_search dispatch: engine "${engine.name}" failed: ${lastError}`);
    } catch (error) {
      lastError = (error as Error).message;
      log.warn(`web_search dispatch: engine "${engine.name}" threw: ${lastError}`);
    }
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
