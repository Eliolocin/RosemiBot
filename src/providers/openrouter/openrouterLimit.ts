import { parseRetryAfterMs } from "@/utils/messageProxy/lookupRetry";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { z } from "zod";

const OPENROUTER_LIMIT_ERROR_MAX_BYTES = 64 * 1024;

const OPENROUTER_LIMIT_SOURCES = ["openrouter_key_limit", "openrouter_in_flight_budget", "openrouter_credits"] as const;
const limitResponseSchema = z.object({
  error: z.object({
    message: z.string().optional().catch(undefined),
    metadata: z.object({ limit_source: z.enum(OPENROUTER_LIMIT_SOURCES) }),
  }),
});

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
    public readonly minimumBalanceUsd?: number,
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
  try {
    const parsed = limitResponseSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return null;
    const limitSource = parsed.data.error.metadata.limit_source;
    // OpenRouter exposes the media minimum only in this message, so metadata still owns the limit classification.
    const minimum = parsed.data.error.message?.match(
      /^This request requires at least \$(\d+(?:\.\d+)?) in balance for image or video output$/,
    );
    const amount = minimum ? Number(minimum[1]) : undefined;
    const minimumBalanceUsd =
      amount !== undefined && Number.isFinite(amount) && amount > 0 && amount <= Number.MAX_SAFE_INTEGER
        ? amount
        : undefined;
    return new OpenRouterLimitError(
      limitSource,
      status,
      parseRetryAfterMs(headers.get("Retry-After")),
      minimumBalanceUsd,
    );
  } catch {
    return null;
  }
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
