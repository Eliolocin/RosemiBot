import { parseRetryAfterMs } from "@/utils/messageProxy/lookupRetry";
import { readBoundedResponse } from "@/utils/security/boundedResponse";

const OPENROUTER_LIMIT_ERROR_MAX_BYTES = 64 * 1024;

const OPENROUTER_LIMIT_SOURCES = ["openrouter_key_limit", "openrouter_in_flight_budget", "openrouter_credits"] as const;

export type OpenRouterLimitSource = (typeof OPENROUTER_LIMIT_SOURCES)[number];

/**
 * Identified by `error.metadata.limit_source`, because the status alone cannot separate an exhausted
 * key cap from the account balance or in-flight budget, and OpenRouter documents the key cap as both
 * 402 and 403.
 */
export class OpenRouterLimitError extends Error {
  constructor(
    public readonly limitSource: OpenRouterLimitSource,
    public readonly status: number,
    public readonly retryAfterMs: number | null,
  ) {
    super(`OpenRouter rejected the request at its ${limitSource} limit (HTTP ${status}).`);
    this.name = "OpenRouterLimitError";
  }
}

export function readOpenRouterLimitError(
  status: number,
  headers: Pick<Headers, "get">,
  body: string,
): OpenRouterLimitError | null {
  if (status !== 402 && status !== 403) return null;
  let limitSource: unknown;
  try {
    limitSource = (JSON.parse(body) as { error?: { metadata?: { limit_source?: unknown } } })?.error?.metadata
      ?.limit_source;
  } catch {
    return null;
  }
  return OPENROUTER_LIMIT_SOURCES.includes(limitSource as OpenRouterLimitSource)
    ? new OpenRouterLimitError(
        limitSource as OpenRouterLimitSource,
        status,
        parseRetryAfterMs(headers.get("Retry-After")),
      )
    : null;
}

export async function readOpenRouterLimitResponse(response: Response): Promise<OpenRouterLimitError | null> {
  if (response.status !== 402 && response.status !== 403) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  try {
    const body = (await readBoundedResponse(response, OPENROUTER_LIMIT_ERROR_MAX_BYTES)).toString("utf8");
    return readOpenRouterLimitError(response.status, response.headers, body);
  } catch {
    return null;
  }
}

export function findOpenRouterLimitError(error: unknown): OpenRouterLimitError | null {
  for (let depth = 0; depth < 5 && error && typeof error === "object"; depth++) {
    if (error instanceof OpenRouterLimitError) return error;
    const next: unknown = "originalError" in error ? error.originalError : undefined;
    error = next && typeof next === "object" ? next : "cause" in error ? error.cause : null;
  }
  return null;
}
