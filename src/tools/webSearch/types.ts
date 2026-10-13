/**
 * Web Search engine-abstraction types.
 *
 * Defines the uniform interface implemented by each search engine
 * (Brave, SearXNG, and DuckDuckGo). The dispatcher
 * walks an ordered chain of engines per category, calling `search()`
 * on the first one whose `available()` returns true.
 */

import type { ToolContext, ToolResult } from "@/types/tool/interfaces";

/**
 * Search categories supported by the unified `web_search` tool across the
 * common Brave/SearXNG surface.
 */
export const BASE_SEARCH_CATEGORIES = ["text", "image", "video", "news"] as const;

/**
 * SearXNG-only vertical categories. The dispatcher will skip engines that
 * don't support these and return the normal category-unavailable message when
 * no SearXNG server is configured.
 */
const SEARXNG_ONLY_SEARCH_CATEGORIES = ["papers", "code", "files", "music"] as const;

export const SEARCH_CATEGORIES = [...BASE_SEARCH_CATEGORIES, ...SEARXNG_ONLY_SEARCH_CATEGORIES] as const;

/**
 * Search categories supported by the unified `web_search` tool.
 *
 * Only `text` has a keyless fallback (DuckDuckGo). Brave supports the base four.
 * SearXNG supports the base four plus the SearXNG-only verticals above.
 */
export type SearchCategory = (typeof SEARCH_CATEGORIES)[number];

/**
 * Canonical engine identifiers. Used for logging and embed labelling.
 */
export type WebSearchEngineName = "brave" | "searxng" | "duckduckgo";

/**
 * Uniform contract every web-search engine implements so the dispatcher
 * can route opaque `web_search(query, category)` calls without caring
 * which engine handles them.
 */
export interface WebSearchEngine {
  /** Stable identifier : used for logs, telemetry, and embed provider labels. */
  readonly name: WebSearchEngineName;

  /**
   * Async because some engines (e.g. Brave) consult cache/DB to discover
   * whether a per-server API key is configured.
   *
   * @param context - Tool execution context (provides serverId for key lookup).
   * @returns True if the engine is currently usable.
   */
  available(context: ToolContext): Promise<boolean>;

  /**
   * Whether this engine can handle the given category.
   * DuckDuckGo returns true only for `text`; Brave supports the base four;
   * SearXNG supports the base four plus its specialty verticals.
   */
  supportsCategory(category: SearchCategory): boolean;

  /**
   * Execute the search. Implementations are expected to return a fully
   * formed ToolResult : including any Discord side-effects (embeds /
   * attachments) the engine wants to surface.
   *
   * @param count - Optional result count hint from the LLM. Engines that
   *   support it (Brave, SearXNG) use it; others silently ignore it.
   */
  search(query: string, category: SearchCategory, context: ToolContext, count?: number): Promise<ToolResult>;
}
