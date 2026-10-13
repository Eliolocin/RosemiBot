/**
 * SearxngEngine : wraps the SearXNG REST service into a uniform WebSearchEngine.
 *
 * Supports the common search categories plus SearXNG-only verticals
 * (science/it/files/music).
 * Availability gates on SEARXNG_BASE_URL being configured AND the
 * instance responding healthy (cached probe : see `isSearxngAvailable`).
 *
 * Sits between Brave and DuckDuckGo in the dispatcher chain: when a Brave key
 * isn't configured but a self-hosted SearXNG server is, queries are routed
 * here instead of falling through to DuckDuckGo.
 */

import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { sendToolNotice } from "@/utils/discord/toolProgressNotice";
import { isSearxngAvailable } from "@/tools/restAPIs/searxng/searxngService";
import { searxng_category_search, searxng_image_search } from "@/tools/restAPIs/searxng/toolImplementations";
import type { SearxngCategory } from "@/tools/restAPIs/searxng/types";
import { getSearchNoticeKey, getSearchNoticeTitleVars } from "./categoryMetadata";
import type { SearchCategory, WebSearchEngine } from "./types";

export class SearxngEngine implements WebSearchEngine {
  readonly name = "searxng" as const;

  async available(_context: ToolContext): Promise<boolean> {
    // SEARXNG_BASE_URL must be set AND the /healthz probe must succeed (cached).
    return await isSearxngAvailable();
  }

  supportsCategory(_category: SearchCategory): boolean {
    return true;
  }

  async search(query: string, category: SearchCategory, context: ToolContext, count?: number): Promise<ToolResult> {
    // Surface a "searching..." notice in Discord ; parallel to the Brave engine's
    //    Internal*Tool classes that call sendToolNotice themselves.
    await sendToolNotice(
      context,
      getSearchNoticeKey(category),
      {
        titleKey: "tools.search.category_search_title",
        titleVars: getSearchNoticeTitleVars(context.locale, category, query),
        descriptionKey: "tools.search.disclaimer_description",
      },
      "SearxngEngine",
    );

    const args: Record<string, unknown> = { query, ...(count !== undefined && { count }) };
    if (category === "image") {
      return await searxng_image_search(args, context);
    }

    return await searxng_category_search(args, this.toTextLikeSearxngCategory(category), context);
  }

  private toTextLikeSearxngCategory(category: Exclude<SearchCategory, "image">): Exclude<SearxngCategory, "images"> {
    switch (category) {
      case "text":
        return "general";
      case "video":
        return "videos";
      case "news":
        return "news";
      case "papers":
        return "science";
      case "code":
        return "it";
      case "files":
        return "files";
      case "music":
        return "music";
    }
  }
}
