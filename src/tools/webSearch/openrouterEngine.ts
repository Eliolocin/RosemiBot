import { resolveSupporterMemberKey } from "@/modules/supporter-billing/runtime/managedProvider";
import { fetchWithSupporterSpend } from "@/modules/supporter-billing/runtime/spendGuard";
import { recordSupporterUsage } from "@/modules/supporter-billing/runtime/usageStatistics";
import { normalizeProviderUsage } from "@/utils/text/tokenEstimate";
import { findSupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import { getSupporterRequestFailureCopy } from "@/modules/supporter-billing/discord/requestFailure";
import { z } from "zod";
import { addFetchCapabilityReminder } from "@/tools/restAPIs/brave/braveSearchService";
import { getSearchNoticeKey, getSearchNoticeTitleVars } from "@/tools/webSearch/categoryMetadata";
import type { SearchCategory, WebSearchEngine, WebSearchEngineFailure } from "@/tools/webSearch/types";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { sendToolNotice } from "@/utils/discord/toolProgressNotice";
import { log } from "@/utils/misc/logger";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { decryptApiKey } from "@/utils/security/crypto";

const SEARCH_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.WEB_SEARCH_TIMEOUT_MS ?? "5000", 10) || 5000);
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_RESULT_COUNT = 10;
const MAX_RESULT_COUNT = 20;
const MAX_QUERY_CHARS = 500;
const MAX_TITLE_CHARS = 300;
const MAX_CONTENT_CHARS = 4000;
const CATEGORY_QUERY_PREFIXES: Partial<Record<SearchCategory, string>> = {
  news: "News",
  papers: "Research papers",
  code: "Source code and programming documentation",
};

const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ annotations: z.array(z.unknown()) }) })).min(1),
});
const citationSchema = z.object({
  type: z.literal("url_citation"),
  url_citation: z.object({
    url: z.string().url(),
    title: z.string().optional(),
    content: z.string().optional(),
  }),
});

export class OpenRouterEngine implements WebSearchEngine {
  readonly name = "openrouter" as const;

  async available(context: ToolContext): Promise<boolean> {
    return (
      context.provider === "openrouter" &&
      (Boolean(context.supporterFunding) || context.tomoriState.config.api_key !== null)
    );
  }

  supportsCategory(category: SearchCategory): boolean {
    return category === "text" || category === "news" || category === "papers" || category === "code";
  }

  async search(query: string, category: SearchCategory, context: ToolContext, count?: number): Promise<ToolResult> {
    const startTime = Date.now();
    const boundedQuery = Array.from(query.trim()).slice(0, MAX_QUERY_CHARS).join("");
    const boundedCount = Math.max(1, Math.min(Math.floor(count ?? DEFAULT_RESULT_COUNT), MAX_RESULT_COUNT));
    const prefix = CATEGORY_QUERY_PREFIXES[category];
    const searchQuery = prefix ? `${prefix}: ${boundedQuery}` : boundedQuery;

    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = context.abortSignal ? AbortSignal.any([context.abortSignal, timeoutSignal]) : timeoutSignal;

    try {
      signal.throwIfAborted();
      const { api_key: encryptedKey, key_version: keyVersion } = context.tomoriState.config;
      const apiKey = context.supporterFunding
        ? await resolveSupporterMemberKey(context.supporterFunding)
        : encryptedKey
          ? await decryptApiKey(encryptedKey, keyVersion)
          : null;
      if (!apiKey) return this.fail("missing_key");
      signal.throwIfAborted();

      await sendToolNotice(
        context,
        getSearchNoticeKey(category),
        {
          titleKey: "tools.search.category_search_title",
          titleVars: getSearchNoticeTitleVars(context.locale, category, boundedQuery),
          descriptionKey: "tools.search.disclaimer_description",
        },
        "OpenRouterEngine",
      );
      signal.throwIfAborted();

      const model = context.tomoriState.llm.llm_codename;
      const response = await fetchWithSupporterSpend(SEARCH_ENDPOINT, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...buildOpenRouterAttributionHeaders(),
        },
        body: JSON.stringify({
          ...(model !== "other-model" ? { model } : {}),
          stream: false,
          // The plugin attaches excerpts independently of completion length, so one token avoids paying for synthesis.
          plugins: [{ id: "web", engine: "exa", max_results: boundedCount }],
          max_tokens: 1,
          messages: [{ role: "user", content: `List search results for: ${searchQuery}` }],
        }),
        signal,
      });

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return this.fail("http_error", response.status);
      }

      const body = await readBoundedResponse(response, MAX_RESPONSE_BYTES, signal);
      const payload: unknown = JSON.parse(body.toString("utf8"));
      const metadata = z.object({ usage: z.unknown().optional(), id: z.string().optional() }).safeParse(payload);
      const usage = metadata.success ? normalizeProviderUsage(metadata.data.usage) : null;
      if (usage)
        recordSupporterUsage(context.supporterFunding, {
          modelCodename: model,
          ...usage,
          costUsd: usage.costUsd,
          providerRequestId: metadata.success ? metadata.data.id : undefined,
        });
      const parsed = responseSchema.safeParse(payload);
      if (!parsed.success) return this.fail("malformed");

      const results: string[] = [];
      const seen = new Set<string>();
      for (const annotation of parsed.data.choices[0].message.annotations) {
        const citation = citationSchema.safeParse(annotation);
        if (!citation.success) continue;
        const { url: rawUrl, title, content } = citation.data.url_citation;
        const url = new URL(rawUrl);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || seen.has(url.href)) continue;
        seen.add(url.href);
        results.push(
          `**${results.length + 1}. ${(title?.trim() || url.hostname).slice(0, MAX_TITLE_CHARS)}**\n${url.href}\n${content?.trim().slice(0, MAX_CONTENT_CHARS) ?? ""}`,
        );
        if (results.length >= boundedCount) break;
      }
      if (results.length === 0) return this.fail("empty_results");

      const formatted = `**Web Search Results for "${boundedQuery}"** (via OpenRouter Search)\n\n${results.join("\n\n")}`;
      const enhanced = addFetchCapabilityReminder(formatted);
      const summary = `${enhanced.enhancedMessage}\n\n${enhanced.fetchReminder}`;
      return {
        success: true,
        message: summary,
        data: {
          summary,
          source: "http",
          functionName: "openrouter_web_search",
          serverName: "openrouter",
          executionTime: Date.now() - startTime,
          urlsFound: results.length,
          status: "completed",
        },
      };
    } catch (error) {
      const denied = findSupporterRequestDeniedError(error, context.supporterFunding);
      if (denied) return { success: false, error: getSupporterRequestFailureCopy(denied, context.locale).description };
      return this.fail(signal.aborted ? "aborted" : "request_failed", undefined, error);
    }
  }

  private fail(failure: string, status?: number, error?: unknown): ToolResult {
    log.warn("OpenRouter search failed", error, { errorType: "OpenRouterSearchFailed", metadata: { failure, status } });
    return {
      success: false,
      error: `OpenRouter search failed: ${failure}${status ? ` (HTTP ${status})` : ""}`,
      data: { failure, status } satisfies WebSearchEngineFailure,
    };
  }
}
