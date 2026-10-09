/**
 * Crawl4AI REST API service.
 *
 * Hidden HTTP client used by the unified `fetch_url` dispatcher. Availability
 * requires `CRAWL4AI_BASE_URL` plus a successful cached `/health` probe.
 */

import { log } from "@/utils/misc/logger";
import { readBoundedResponse, ResponseSizeError } from "@/utils/security/boundedResponse";
import { FETCH_LIMITS } from "@/utils/security/rateLimiter";
import type {
  Crawl4aiApiResult,
  Crawl4aiCookie,
  Crawl4aiCrawlRequest,
  Crawl4aiCrawlResponse,
  Crawl4aiFilterMode,
  Crawl4aiMarkdownRequest,
  Crawl4aiMarkdownResponse,
  Crawl4aiRequestConfig,
} from "./types";

const SERVICE_NAME = "crawl4ai";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 TomoriBot";

const REQUEST_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.FETCH_URL_TIMEOUT_MS ?? "15000", 10) || 15000);
const HEALTHCHECK_CACHE_MS = 60_000;
const HEALTHCHECK_TIMEOUT_MS = Math.min(3000, REQUEST_TIMEOUT_MS);

const FILTER_MODES = new Set<Crawl4aiFilterMode>(["raw", "fit", "bm25", "llm"]);

const BYTES_PER_MIB = 1024 * 1024;
const MARKDOWN_RESPONSE_MAX_BYTES = FETCH_LIMITS.MAX_FETCH_SIZE_MB * BYTES_PER_MIB;
// /crawl repeats the page as raw HTML, cleaned HTML, and several Markdown variants in one body.
const CRAWL_RESPONSE_MAX_BYTES = 4 * MARKDOWN_RESPONSE_MAX_BYTES;
// Error bodies are only logged, so a short prefix is enough to diagnose the failure.
const ERROR_BODY_MAX_BYTES = 4 * 1024;

interface HealthcheckCache {
  available: boolean;
  expiresAt: number;
}

let healthcheckCache: HealthcheckCache | null = null;
let warnedInvalidFilterMode = false;

function getCrawl4aiBaseUrl(): string | null {
  const raw = process.env.CRAWL4AI_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function getCrawl4aiToken(): string | null {
  const raw = process.env.CRAWL4AI_TOKEN?.trim();
  return raw || null;
}

/**
 * Parse CRAWL4AI_COOKIES_JSON into a cookie array. Returns an empty array if
 * the env var is unset or malformed (logs a warning on parse failure).
 */
export function getCrawl4aiCookies(): Crawl4aiCookie[] {
  const raw = process.env.CRAWL4AI_COOKIES_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      log.warn("CRAWL4AI_COOKIES_JSON must be a JSON array — ignoring");
      return [];
    }
    return parsed as Crawl4aiCookie[];
  } catch {
    log.warn("CRAWL4AI_COOKIES_JSON is not valid JSON — ignoring");
    return [];
  }
}

export function getCrawl4aiFilterMode(raw = process.env.FETCH_URL_FILTER_MODE): Crawl4aiFilterMode {
  const normalized = raw?.trim().toLowerCase();
  if (normalized && FILTER_MODES.has(normalized as Crawl4aiFilterMode)) {
    return normalized as Crawl4aiFilterMode;
  }

  if (normalized && !warnedInvalidFilterMode) {
    warnedInvalidFilterMode = true;
    log.warn(`Invalid FETCH_URL_FILTER_MODE "${normalized}"; defaulting to "fit"`);
  }

  return "fit";
}

function buildHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip",
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };

  const token = getCrawl4aiToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function createAbortController(
  timeoutMs: number,
  signal?: AbortSignal,
): { controller: AbortController; timeoutId: ReturnType<typeof setTimeout> } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  return { controller, timeoutId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

async function readJsonBody(response: Response, maxBytes: number): Promise<unknown> {
  return JSON.parse((await readBoundedResponse(response, maxBytes)).toString("utf8"));
}

async function readErrorSummary(response: Response): Promise<string> {
  try {
    return (await readBoundedResponse(response, ERROR_BODY_MAX_BYTES)).toString("utf8");
  } catch (error) {
    return error instanceof ResponseSizeError ? `[error body exceeded ${ERROR_BODY_MAX_BYTES} bytes]` : "Unknown error";
  }
}

function toMarkdownResponse(body: unknown): Crawl4aiMarkdownResponse | null {
  if (!isRecord(body) || typeof body.success !== "boolean" || typeof body.url !== "string") return null;
  if (typeof body.markdown !== "string" || typeof body.filter !== "string") return null;
  if (!FILTER_MODES.has(body.filter as Crawl4aiFilterMode)) return null;
  if (!isOptionalString(body.query) || !isOptionalString(body.cache)) return null;
  return body as unknown as Crawl4aiMarkdownResponse;
}

function toCrawlResponse(body: unknown): Crawl4aiCrawlResponse | null {
  if (!isRecord(body) || typeof body.success !== "boolean" || !Array.isArray(body.results)) return null;
  const [result] = body.results as unknown[];
  if (result === undefined) return body as unknown as Crawl4aiCrawlResponse;
  if (!isRecord(result) || typeof result.success !== "boolean" || typeof result.url !== "string") return null;
  if (!isOptionalString(result.error_message)) return null;
  const markdown = result.markdown;
  if (markdown !== undefined && markdown !== null) {
    if (!isRecord(markdown) || !isOptionalString(markdown.raw_markdown) || !isOptionalString(markdown.fit_markdown)) {
      return null;
    }
  }
  return body as unknown as Crawl4aiCrawlResponse;
}

/**
 * Maps a bounded-read or JSON failure to the result shape both endpoints return.
 */
function describeBodyFailure(endpoint: string, error: unknown): Crawl4aiApiResult<never> | null {
  if (error instanceof ResponseSizeError) {
    log.warn(`${SERVICE_NAME} ${endpoint} response exceeded its byte limit`);
    return { success: false, error: `Crawl4AI ${endpoint} response exceeded the size limit` };
  }
  if (error instanceof SyntaxError) {
    log.warn(`${SERVICE_NAME} ${endpoint} returned malformed JSON`);
    return { success: false, error: `Crawl4AI ${endpoint} returned malformed JSON` };
  }
  return null;
}

/**
 * Returns a parenthesized log suffix naming the likely token problem for an auth rejection, or an
 * empty string for any other status.
 */
function authFailureHint(status: number): string {
  if (status !== 401 && status !== 403) return "";
  return getCrawl4aiToken()
    ? " (verify CRAWL4AI_TOKEN in .env matches CRAWL4AI_API_TOKEN on the container)"
    : " (CRAWL4AI_TOKEN is not set in .env)";
}

export async function isCrawl4aiAvailable(force = false): Promise<boolean> {
  const baseUrl = getCrawl4aiBaseUrl();
  if (!baseUrl) return false;

  const now = Date.now();
  if (!force && healthcheckCache && healthcheckCache.expiresAt > now) {
    return healthcheckCache.available;
  }

  const { controller, timeoutId } = createAbortController(HEALTHCHECK_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      signal: controller.signal,
      headers: buildHeaders(),
    });

    const available = response.ok;
    healthcheckCache = { available, expiresAt: now + HEALTHCHECK_CACHE_MS };
    if (!available) {
      log.warn(`${SERVICE_NAME} health check returned status ${response.status}${authFailureHint(response.status)}`);
    }
    return available;
  } catch (error) {
    healthcheckCache = { available: false, expiresAt: now + HEALTHCHECK_CACHE_MS };
    // A stopped container fails the same way, so the missing token is offered as a possibility, not the cause.
    const tokenHint = getCrawl4aiToken()
      ? ""
      : " (CRAWL4AI_TOKEN is unset; Crawl4AI 0.9.4 refuses outside connections without one)";
    log.warn(`${SERVICE_NAME} health check failed${tokenHint}:`, error as Error);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function crawl4aiMarkdown(
  request: Crawl4aiMarkdownRequest,
  config: Crawl4aiRequestConfig = {},
): Promise<Crawl4aiApiResult<Crawl4aiMarkdownResponse>> {
  const baseUrl = config.baseUrl ?? getCrawl4aiBaseUrl();
  if (!baseUrl) {
    return { success: false, error: "CRAWL4AI_BASE_URL is not configured", statusCode: 503 };
  }

  const timeoutMs = config.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const { controller, timeoutId } = createAbortController(timeoutMs, config.signal);

  try {
    log.info(`${SERVICE_NAME} /md request: url="${request.url}" filter="${request.f}"`);

    const response = await fetch(`${baseUrl}/md`, {
      method: "POST",
      headers: buildHeaders(),
      signal: controller.signal,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await readErrorSummary(response);
      log.warn(
        `${SERVICE_NAME} /md failed with status ${response.status}${authFailureHint(response.status)}: ${errorText}`,
      );
      return {
        success: false,
        error: `Crawl4AI request failed: ${response.statusText || response.status}`,
        statusCode: response.status,
      };
    }

    const data = toMarkdownResponse(await readJsonBody(response, MARKDOWN_RESPONSE_MAX_BYTES));
    if (!data) {
      return {
        success: false,
        error: "Crawl4AI /md returned an unexpected response shape",
        statusCode: response.status,
      };
    }
    if (!data.success) {
      return {
        success: false,
        error: "Crawl4AI returned an unsuccessful response",
        statusCode: response.status,
        data,
      };
    }

    return { success: true, data, statusCode: response.status };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      log.warn(`${SERVICE_NAME} /md timed out after ${timeoutMs}ms`);
      return { success: false, error: "Request timed out", statusCode: 408 };
    }
    const bodyFailure = describeBodyFailure("/md", error);
    if (bodyFailure) return bodyFailure;

    log.warn(`${SERVICE_NAME} /md request error:`, error as Error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch a URL via /crawl with browser-level cookie injection.
 * Used when CRAWL4AI_COOKIES_JSON is set, so /md does not support cookies.
 * Returns a normalised Crawl4aiMarkdownResponse so callers stay uniform.
 */
export async function crawl4aiCrawlWithCookies(
  request: Crawl4aiMarkdownRequest,
  cookies: Crawl4aiCookie[],
  config: Crawl4aiRequestConfig = {},
): Promise<Crawl4aiApiResult<Crawl4aiMarkdownResponse>> {
  const baseUrl = config.baseUrl ?? getCrawl4aiBaseUrl();
  if (!baseUrl) {
    return { success: false, error: "CRAWL4AI_BASE_URL is not configured", statusCode: 503 };
  }

  const timeoutMs = config.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const { controller, timeoutId } = createAbortController(timeoutMs, config.signal);

  try {
    log.info(`${SERVICE_NAME} /crawl request (cookies): url="${request.url}" filter="${request.f}"`);

    const response = await fetch(`${baseUrl}/crawl`, {
      method: "POST",
      headers: buildHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        urls: [request.url],
        // Playwright requires path alongside domain, so default to "/" when omitted.
        browser_config: { cookies: cookies.map((c) => ({ path: "/", ...c })) },
      } satisfies Crawl4aiCrawlRequest),
    });

    if (!response.ok) {
      const errorText = await readErrorSummary(response);
      log.warn(
        `${SERVICE_NAME} /crawl failed with status ${response.status}${authFailureHint(response.status)}: ${errorText}`,
      );
      return {
        success: false,
        error: `Crawl4AI /crawl request failed: ${response.statusText || response.status}`,
        statusCode: response.status,
      };
    }

    const data = toCrawlResponse(await readJsonBody(response, CRAWL_RESPONSE_MAX_BYTES));
    if (!data) {
      return {
        success: false,
        error: "Crawl4AI /crawl returned an unexpected response shape",
        statusCode: response.status,
      };
    }
    const result = data.results[0];

    if (!data.success || !result?.success) {
      return {
        success: false,
        error: result?.error_message ?? "Crawl4AI /crawl returned an unsuccessful response",
        statusCode: response.status,
      };
    }

    const fitLen = result.markdown?.fit_markdown?.length ?? 0;
    const rawLen = result.markdown?.raw_markdown?.length ?? 0;
    log.info(`${SERVICE_NAME} /crawl response: fit_markdown=${fitLen}chars raw_markdown=${rawLen}chars`);

    // Respect the requested filter mode: raw requests read raw_markdown directly;
    // fit (default) prefers fit_markdown and falls back to raw_markdown.
    // Use || (not ??) because /crawl returns fit_markdown as "" (not null) when
    // pruning removes all content, and ?? does not fall through on empty strings.
    const markdown =
      request.f === "raw"
        ? result.markdown?.raw_markdown || ""
        : result.markdown?.fit_markdown || result.markdown?.raw_markdown || "";

    return {
      success: true,
      statusCode: response.status,
      data: {
        url: result.url,
        filter: request.f,
        query: request.q ?? null,
        cache: request.c ?? null,
        markdown,
        success: true,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      log.warn(`${SERVICE_NAME} /crawl timed out after ${timeoutMs}ms`);
      return { success: false, error: "Request timed out", statusCode: 408 };
    }
    const bodyFailure = describeBodyFailure("/crawl", error);
    if (bodyFailure) return bodyFailure;
    log.warn(`${SERVICE_NAME} /crawl request error:`, error as Error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
