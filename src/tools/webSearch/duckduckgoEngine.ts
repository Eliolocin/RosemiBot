/**
 * DuckDuckGoEngine: the keyless text-search fallback, read from DuckDuckGo's HTML results page.
 *
 * The page has no stable schema, so this adapter owns markup drift, rate limiting, and challenge
 * detection. It reads only titles, links, and snippets; it never follows a result link.
 */

import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { sendToolNotice } from "@/utils/discord/toolProgressNotice";
import { log } from "@/utils/misc/logger";
import { ResponseSizeError, readBoundedResponse } from "@/utils/security/boundedResponse";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";
import { getSearchNoticeTitleVars } from "./categoryMetadata";
import type { SearchCategory, WebSearchEngine } from "./types";

const DDG_HTML_ENDPOINT = "https://html.duckduckgo.com/html/";
const REQUEST_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.WEB_SEARCH_TIMEOUT_MS ?? "5000", 10) || 5000);
// A results page is tens of kilobytes; the cap only has to stop a hostile or broken upstream.
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_QUERY_CHARS = 500;
const MAX_TITLE_CHARS = 300;
const MAX_SNIPPET_CHARS = 600;
// DDG serves a few dozen blocks per page, so blocks past this count are ignored rather than collected.
const MAX_RESULT_BLOCKS = 50;
const DEFAULT_RESULT_COUNT = 10;
const MAX_RESULT_COUNT = 20;

interface DuckDuckGoResult {
  title: string;
  url: string;
  snippet: string;
}

type DuckDuckGoPage =
  | { kind: "results"; results: DuckDuckGoResult[] }
  | { kind: "empty" }
  | { kind: "challenge" }
  | { kind: "malformed" };

type DuckDuckGoFailure = "challenge" | "rate_limited" | "http_error" | "oversized" | "malformed";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** HTMLRewriter hands over text and attributes exactly as written in the source, entities included. */
function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body.startsWith("#")) {
      const codePoint = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
      const isScalarValue = codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff);
      return Number.isInteger(codePoint) && isScalarValue ? String.fromCodePoint(codePoint) : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

function cleanText(raw: string, maxChars: number): string {
  const text = decodeHtmlEntities(raw).replace(/\s+/g, " ").trim();
  const codePoints = Array.from(text);
  return codePoints.length > maxChars ? `${codePoints.slice(0, maxChars - 1).join("")}…` : text;
}

function isDuckDuckGoHost(hostname: string): boolean {
  return hostname === "duckduckgo.com" || hostname.endsWith(".duckduckgo.com");
}

/**
 * Unwraps DDG's `/l/?uddg=` click wrapper once. Other DDG-hosted links (ads under `/y.js`, internal
 * pages) are not organic results, and unwrapping their tracking parameters would follow ad routing.
 */
export function normalizeDuckDuckGoResultUrl(rawHref: string): string | null {
  let url: URL;
  try {
    url = new URL(decodeHtmlEntities(rawHref), DDG_HTML_ENDPOINT);
    if (isDuckDuckGoHost(url.hostname)) {
      const target = url.pathname === "/l/" ? url.searchParams.get("uddg") : null;
      if (!target) return null;
      url = new URL(target);
      if (isDuckDuckGoHost(url.hostname)) return null;
    }
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url.href;
}

/** Collected text stops growing well past its display cap, so a giant text node cannot balloon memory. */
function appendBounded(current: string, chunk: string, maxChars: number): string {
  return current.length > maxChars * 4 ? current : current + chunk;
}

export async function parseDuckDuckGoHtml(html: string): Promise<DuckDuckGoPage> {
  const blocks: { ad: boolean; href: string | null; title: string; snippet: string }[] = [];
  let current: (typeof blocks)[number] | null = null;
  let hasNoResultsMarker = false;
  let hasChallenge = false;

  await new HTMLRewriter()
    .on(".result", {
      element(element) {
        if (blocks.length >= MAX_RESULT_BLOCKS) {
          current = null;
          return;
        }
        current = {
          ad: /\bresult--ad\b/.test(element.getAttribute("class") ?? ""),
          href: null,
          title: "",
          snippet: "",
        };
        blocks.push(current);
      },
    })
    .on(".result__title a", {
      element(element) {
        if (current) current.href = element.getAttribute("href");
      },
      text(chunk) {
        if (current) current.title = appendBounded(current.title, chunk.text, MAX_TITLE_CHARS);
      },
    })
    .on(".result__snippet", {
      text(chunk) {
        if (current) current.snippet = appendBounded(current.snippet, chunk.text, MAX_SNIPPET_CHARS);
      },
    })
    .on(".no-results", {
      element() {
        hasNoResultsMarker = true;
      },
    })
    .on(".anomaly-modal, #challenge-form", {
      element() {
        hasChallenge = true;
      },
    })
    .transform(new Response(html))
    .text();

  if (hasChallenge) return { kind: "challenge" };

  const results: DuckDuckGoResult[] = [];
  const seen = new Set<string>();
  let organicBlocks = 0;
  for (const block of blocks) {
    if (block.ad || block.href === null) continue;
    organicBlocks++;
    const url = normalizeDuckDuckGoResultUrl(block.href);
    const title = cleanText(block.title, MAX_TITLE_CHARS);
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    results.push({ title, url, snippet: cleanText(block.snippet, MAX_SNIPPET_CHARS) });
  }

  if (results.length > 0) return { kind: "results", results };
  // Organic blocks that all fail to yield a usable link mean the markup changed, not that nothing matched.
  if (hasNoResultsMarker && organicBlocks === 0) return { kind: "empty" };
  return { kind: "malformed" };
}

export function formatDuckDuckGoResults(query: string, results: DuckDuckGoResult[], count?: number): string {
  if (results.length === 0) {
    return `No web results found for "${query}"`;
  }

  const limit = Math.min(count ?? DEFAULT_RESULT_COUNT, MAX_RESULT_COUNT);
  let formatted = `**Web Search Results for "${query}"** (via DuckDuckGo)\n\n`;
  results.slice(0, limit).forEach((result, index) => {
    formatted += `**${index + 1}. ${result.title}**\n${result.url}\n`;
    if (result.snippet) formatted += `${result.snippet}\n`;
    formatted += "\n";
  });
  return formatted;
}

export class DuckDuckGoEngine implements WebSearchEngine {
  readonly name = "duckduckgo" as const;

  async available(_context: ToolContext): Promise<boolean> {
    return true;
  }

  supportsCategory(category: SearchCategory): boolean {
    return category === "text";
  }

  async search(query: string, _category: SearchCategory, context: ToolContext, count?: number): Promise<ToolResult> {
    const startTime = Date.now();
    const boundedQuery = Array.from(query.trim()).slice(0, MAX_QUERY_CHARS).join("");

    await sendToolNotice(
      context,
      "web_search",
      {
        titleKey: "tools.search.category_search_title",
        titleVars: getSearchNoticeTitleVars(context.locale, "text", boundedQuery),
        descriptionKey: "tools.search.disclaimer_description",
      },
      "DuckDuckGoEngine",
    );

    const url = new URL(DDG_HTML_ENDPOINT);
    url.searchParams.set("q", boundedQuery);
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = context.abortSignal ? AbortSignal.any([context.abortSignal, timeoutSignal]) : timeoutSignal;

    // Only fixed public headers: no provider key, bot token, or guild MCP credential belongs on this request.
    const response = await fetchUserRemoteUrl(
      url,
      {
        headers: {
          Accept: "text/html",
          "User-Agent": "TomoriBot/1.0 (+https://github.com/Bredrumb/TomoriBot)",
        },
        signal,
      },
      { strict: true },
    );

    // DDG answers an automated-traffic challenge with 202 rather than an error status.
    if (response.status === 202 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      return await this.fail(context, "challenge", response.status);
    }
    if (response.status === 429) {
      await response.body?.cancel().catch(() => undefined);
      return await this.fail(context, "rate_limited", response.status);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return await this.fail(context, "http_error", response.status);
    }

    let html: string;
    try {
      html = (await readBoundedResponse(response, MAX_RESPONSE_BYTES)).toString("utf8");
    } catch (error) {
      if (error instanceof ResponseSizeError) return await this.fail(context, "oversized", response.status);
      throw error;
    }

    const page = await parseDuckDuckGoHtml(html);
    if (page.kind === "challenge") return await this.fail(context, "challenge", response.status);
    if (page.kind === "malformed") return await this.fail(context, "malformed", response.status);

    const results = page.kind === "results" ? page.results : [];
    const summary = formatDuckDuckGoResults(boundedQuery, results, count);
    return {
      success: true,
      message: summary,
      data: {
        // Provider adapters serialize `summary` in preference to the rest of `data`.
        summary,
        source: "http",
        functionName: "duckduckgo_web_search",
        serverName: "duckduckgo-html",
        executionTime: Date.now() - startTime,
        urlsFound: Math.min(results.length, count ?? DEFAULT_RESULT_COUNT, MAX_RESULT_COUNT),
        status: "completed",
      },
    };
  }

  private async fail(context: ToolContext, failure: DuckDuckGoFailure, status: number): Promise<ToolResult> {
    log.warn("DuckDuckGo search failed", { errorType: "DuckDuckGoSearchFailed", metadata: { failure, status } });

    if ((failure === "challenge" || failure === "rate_limited") && !context.suppressProgressNotices) {
      await sendStandardEmbed(
        context.channel,
        context.locale,
        {
          titleKey: "general.errors.duckduckgo_rate_limit.title",
          descriptionKey: "general.errors.duckduckgo_rate_limit.description",
          footerKey: "general.errors.duckduckgo_rate_limit.footer",
        },
        {
          webhook: context.webhook,
          personaUsername: context.personaUsername,
          personaAvatarUrl: context.personaAvatarUrl,
        },
      ).catch((error) => log.warn("Failed to send DuckDuckGo rate-limit notice (non-fatal)", error as Error));
    }

    return {
      success: false,
      error: `DuckDuckGo search failed: ${failure} (HTTP ${status})`,
    };
  }
}
