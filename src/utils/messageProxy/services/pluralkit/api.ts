import { z } from "zod";
import { canonicalMessageProxyOrigin, type MessageProxyInstanceContext } from "@/utils/messageProxy/instances";
import { log } from "@/utils/misc/logger";
import { fetchUserRemoteUrl, RemoteUrlPolicyError } from "@/utils/security/userRemoteFetch";
import { readBoundedMessageProxyResponse } from "@/utils/messageProxy/boundedResponse";
import {
  attemptCapMs,
  discardBody,
  MIN_ATTEMPT_TIMEOUT_MS,
  parseRetryAfterMs,
  waitBeforeRetry,
} from "@/utils/messageProxy/lookupRetry";
import { getMessageProxyLookupTimeoutMs } from "@/utils/messageProxy/proxyExpectation";

/** PK's message index lags ~2s behind proxied sends. */
const RETRY_DELAYS_MS = [800, 1600, 3200];

const IDENTITY_CACHE_MAX_ENTRIES = 2000;

/**
 * Thrown when PluralKit could not answer; resolving `null` instead means it answered that it has no
 * such message. The router reports this as timeout/error rather than as a confirmed miss.
 */
export class PluralKitLookupUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "PluralKitLookupUnavailableError";
  }
}

const pkSystemInfoSchema = z.object({
  id: z.string().min(1),
  uuid: z.string().uuid(),
  name: z.string().nullable().optional(),
  tag: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

const pkMemberInfoSchema = z.object({
  id: z.string().min(1),
  uuid: z.string().uuid(),
  name: z.string().min(1),
  display_name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  // Public pronouns only. PluralKit omits or nulls this key when the member keeps
  // pronouns private, so a value here is always the member's own public claim.
  pronouns: z.string().nullable().optional(),
});

export type PkSystemInfo = z.infer<typeof pkSystemInfoSchema>;
export type PkMemberInfo = z.infer<typeof pkMemberInfoSchema>;

export interface PkMessageLookup {
  original: string;
  /** Authorization keys off this host account, never the member. */
  sender: string;
  /** Null when the member, and so its system, was deleted. */
  system: PkSystemInfo | null;
  /** Null when deleted; treat as an unproxied webhook with no identity claims. */
  member: PkMemberInfo | null;
}

const pkApiMessageResponseSchema = z.object({
  original: z
    .string()
    .regex(/^\d{17,20}$/)
    .optional(),
  sender: z.string().regex(/^\d{17,20}$/),
  system: pkSystemInfoSchema.nullable().optional(),
  member: pkMemberInfoSchema.nullable().optional(),
});

type PkApiMessageResponse = z.infer<typeof pkApiMessageResponseSchema>;

// A resolved identity is immutable, so it is cached for good. Failures are deliberately NOT cached:
// that would poison a message PK could resolve on a later attempt, such as after an outage clears.
const identityCache = new Map<string, PkMessageLookup>();
const inFlightLookups = new Map<string, Promise<PkMessageLookup | null>>();

/** Entries are never re-set once cached, so insertion order doubles as recency for the eviction cap. */
function rememberIdentity(messageId: string, lookup: PkMessageLookup): void {
  if (identityCache.size >= IDENTITY_CACHE_MAX_ENTRIES) {
    const oldestKey = identityCache.keys().next().value;
    if (oldestKey !== undefined) identityCache.delete(oldestKey);
  }
  identityCache.set(messageId, lookup);
}

function toMessageLookup(raw: PkApiMessageResponse, messageId: string): PkMessageLookup {
  return {
    original: raw.original ?? messageId,
    sender: raw.sender,
    system: raw.system ?? null,
    member: raw.member ?? null,
  };
}

/** Logs the failure and reports it to the router as a transport error, never as a miss. */
function failLookup(messageId: string, reason: string, cause?: unknown): never {
  log.warn(`PluralKit lookup for message ${messageId} ${reason}`, cause);
  throw new PluralKitLookupUnavailableError(`PluralKit lookup for message ${messageId} ${reason}`, cause);
}

/**
 * PK's last authoritative answer decides the outcome: a 404 already said the message is unknown,
 * so that miss stands, while any other exhaustion leaves the message unresolved.
 */
function endExhaustedLookup(
  messageId: string,
  lastAnswerWasMiss: boolean,
  reason: string,
  cause?: unknown,
): PkMessageLookup | null {
  if (lastAnswerWasMiss) {
    log.warn(`PluralKit lookup for message ${messageId} ${reason}; PK reports no such message`);
    return null;
  }
  return failLookup(messageId, reason, cause);
}

function backoffMsForAttempt(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

async function fetchWithRetry(
  instance: MessageProxyInstanceContext,
  messageId: string,
  deadline: number,
  lookupTimeoutMs: number,
): Promise<PkMessageLookup | null> {
  const perAttemptCapMs = attemptCapMs(lookupTimeoutMs);
  const headers: Record<string, string> = { "User-Agent": "TomoriBot" };
  // Optional bot-owned PK token, sent as-is (no "Bearer" prefix: PluralKit's own
  // convention, not OAuth). It raises the base rate limit for all lookups and grants
  // no access to other users' private data.
  const apiToken = instance.instanceId === "pluralkit:official" ? process.env.PLURALKIT_API_TOKEN?.trim() : null;
  if (apiToken) headers.Authorization = apiToken;

  let attempt = 0;
  /** PK's most recent authoritative answer. Only a 404 is one. */
  let lastAnswerWasMiss = false;

  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return endExhaustedLookup(messageId, lastAnswerWasMiss, `exceeded the ${lookupTimeoutMs}ms budget`);
    }

    let response: Response;
    const signal = AbortSignal.timeout(Math.min(remainingMs, perAttemptCapMs));
    try {
      response = await fetchUserRemoteUrl(
        `${instance.origin}/v2/messages/${messageId}`,
        {
          headers,
          redirect: "manual",
          signal,
        },
        { strict: true },
      );
    } catch (error) {
      if (error instanceof RemoteUrlPolicyError) return failLookup(messageId, "was blocked by the outbound URL policy");
      if (!(await waitBeforeRetry(deadline, backoffMsForAttempt(attempt)))) {
        return endExhaustedLookup(
          messageId,
          lastAnswerWasMiss,
          `exceeded the ${lookupTimeoutMs}ms budget after a stalled attempt`,
          error,
        );
      }
      attempt++;
      continue;
    }

    if (response.ok) {
      let raw: unknown;
      try {
        raw = JSON.parse(await readBoundedMessageProxyResponse(response));
      } catch (error) {
        if (signal.aborted) {
          if (!(await waitBeforeRetry(deadline, backoffMsForAttempt(attempt)))) {
            return endExhaustedLookup(
              messageId,
              lastAnswerWasMiss,
              `exceeded the ${lookupTimeoutMs}ms budget after a stalled response body`,
              error,
            );
          }
          attempt++;
          continue;
        }
        return failLookup(messageId, "returned malformed JSON", error);
      }
      const parsed = pkApiMessageResponseSchema.safeParse(raw);
      if (!parsed.success) {
        return failLookup(messageId, "returned an invalid payload");
      }
      return toMessageLookup(parsed.data, messageId);
    }

    // A 404 can be index lag, so it retries within budget.
    if (response.status === 404 || response.status === 429) {
      await discardBody(response);
      lastAnswerWasMiss = response.status === 404;
      const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response.headers.get("Retry-After")) : null;
      // A Retry-After the budget cannot absorb fails the lookup: retrying early would ignore the limit.
      if (retryAfterMs !== null && retryAfterMs > deadline - Date.now() - MIN_ATTEMPT_TIMEOUT_MS) {
        return failLookup(messageId, `was rate limited for ${Math.round(retryAfterMs)}ms, beyond its remaining budget`);
      }
      if (!(await waitBeforeRetry(deadline, retryAfterMs ?? backoffMsForAttempt(attempt)))) {
        return endExhaustedLookup(
          messageId,
          lastAnswerWasMiss,
          `exceeded the ${lookupTimeoutMs}ms budget while retrying after status ${response.status}`,
        );
      }
      attempt++;
      continue;
    }

    await discardBody(response);
    return failLookup(messageId, `failed with status ${response.status}`);
  }
}

/**
 * Resolves the identity behind a proxied message via `GET /v2/messages/{messageId}`.
 *
 * Returns null only once PK reports that it has no such message, because callers must fall through
 * to plain-webhook behavior in that case. Any other unresolved outcome throws
 * `PluralKitLookupUnavailableError`, which the router counts as timeout/error instead of a miss.
 */
export async function fetchMessage(
  instance: MessageProxyInstanceContext,
  messageId: string,
): Promise<PkMessageLookup | null> {
  if (instance.serviceId !== "pluralkit" || canonicalMessageProxyOrigin(instance.origin) !== instance.origin)
    return null;
  const key = `${instance.instanceId}\0${instance.origin}\0${messageId}`;
  const cached = identityCache.get(key);
  if (cached) return cached;

  const existing = inFlightLookups.get(key);
  if (existing) return existing;

  const lookupTimeoutMs = getMessageProxyLookupTimeoutMs();
  const deadline = Date.now() + lookupTimeoutMs;
  const lookupPromise = fetchWithRetry(instance, messageId, deadline, lookupTimeoutMs)
    .then((lookup) => {
      if (lookup) rememberIdentity(key, lookup);
      return lookup;
    })
    .finally(() => {
      inFlightLookups.delete(key);
    });

  inFlightLookups.set(key, lookupPromise);
  return lookupPromise;
}

/** Context rebuilding reads this before the durable DB index, so it must never reach the PluralKit API. */
export function getCachedMessageLookup(
  instance: MessageProxyInstanceContext,
  messageId: string,
): PkMessageLookup | null {
  return identityCache.get(`${instance.instanceId}\0${instance.origin}\0${messageId}`) ?? null;
}

export function clearPluralKitApiStateForTests(): void {
  identityCache.clear();
  inFlightLookups.clear();
}
