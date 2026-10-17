/**
 * Half keeps a retry funded: a stalled attempt otherwise consumes the whole deadline,
 * and at a 5s budget the retry still has about 1.5s after the first backoff step.
 */
const ATTEMPT_BUDGET_SHARE = 0.5;

/**
 * Also caps every retry sleep, so a retry always keeps a usable slice of the deadline
 * and a transport that fails instantly cannot spin attempts inside the same millisecond.
 */
export const MIN_ATTEMPT_TIMEOUT_MS = 500;

export function attemptCapMs(lookupTimeoutMs: number): number {
  return Math.max(Math.floor(lookupTimeoutMs * ATTEMPT_BUDGET_SHARE), MIN_ATTEMPT_TIMEOUT_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** An unread body holds its connection open until it is garbage collected. */
export async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {});
}

/** Zero is rejected: PluralKit's rate limiter can send `Retry-After: 0`, which would retry a limited endpoint immediately. */
export function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number.parseFloat(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/** The delay is trimmed so the retry keeps `MIN_ATTEMPT_TIMEOUT_MS` of its own. */
export async function waitBeforeRetry(deadline: number, delayMs: number): Promise<boolean> {
  const availableMs = deadline - Date.now() - MIN_ATTEMPT_TIMEOUT_MS;
  if (availableMs <= 0) return false;
  await sleep(Math.min(delayMs, availableMs));
  return true;
}
