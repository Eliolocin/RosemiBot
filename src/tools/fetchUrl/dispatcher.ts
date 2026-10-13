import { isCrawl4aiConfigured } from "@/tools/restAPIs/crawl4ai/crawl4aiService";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { localizer } from "@/utils/text/localizer";
import { log } from "@/utils/misc/logger";
import { Crawl4aiEngine } from "./crawl4aiEngine";
import { SafeHttpFetchEngine } from "./safeHttpFetchEngine";
import type { FetchEngine, FetchEngineName, FetchOpts } from "./types";
import { isPrivateNetworkFetchAllowed } from "./urlSafety";

function createEngine(name: FetchEngineName): FetchEngine {
  switch (name) {
    case "crawl4ai":
      return new Crawl4aiEngine();
    case "safe_http":
      return new SafeHttpFetchEngine();
  }
}

/**
 * Setting `CRAWL4AI_BASE_URL` is the opt-in. `safe_http` always ends the chain, so a stopped or
 * failing crawler degrades to the guarded in-process fetch.
 */
export function getFetchUrlEngineOrder(): FetchEngineName[] {
  if (!isCrawl4aiConfigured()) return ["safe_http"];

  // Crawl4AI follows redirects outside this process, so it is only admitted
  // where private-network fetches are permitted: any non-production runtime,
  // or production with an explicit FETCH_URL_ALLOW_PRIVATE_NETWORK opt-in.
  if (!isPrivateNetworkFetchAllowed()) {
    log.warn(
      "Ignoring Crawl4AI for fetch_url: private-network fetching is disabled (production without FETCH_URL_ALLOW_PRIVATE_NETWORK)",
    );
    return ["safe_http"];
  }

  return ["crawl4ai", "safe_http"];
}

function buildEngineChain(): FetchEngine[] {
  return getFetchUrlEngineOrder().map((name) => createEngine(name));
}

export async function executeFetchUrlWithFallback(
  url: string,
  opts: FetchOpts,
  context: ToolContext,
): Promise<ToolResult> {
  let lastError: string | undefined;

  for (const engine of buildEngineChain()) {
    if (!(await engine.available(context))) {
      continue;
    }

    log.info(`fetch_url dispatch: trying engine "${engine.name}" for url="${url}"`);

    try {
      const result = await engine.fetch(url, opts, context);
      if (result.success) {
        log.success(`fetch_url dispatch: engine "${engine.name}" succeeded`);
        return result;
      }

      lastError = result.error ?? result.message ?? `${engine.name} returned unsuccessful result`;
      log.warn(`fetch_url dispatch: engine "${engine.name}" failed: ${lastError}`);
    } catch (error) {
      lastError = (error as Error).message;
      log.warn(`fetch_url dispatch: engine "${engine.name}" threw: ${lastError}`);
    }
  }

  return {
    success: false,
    error: lastError ?? "No URL fetch engine is available",
    message: localizer(context.locale, "tools.fetch.fetch_failed_description", {
      error: lastError ?? "No URL fetch engine is available",
    }),
  };
}
