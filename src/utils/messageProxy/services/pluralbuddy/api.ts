import { z } from "zod";
import { canonicalMessageProxyOrigin, type MessageProxyInstanceContext } from "@/utils/messageProxy/instances";
import {
  getPluralBuddyAccessToken,
  rejectPluralBuddyAccessToken,
} from "@/utils/messageProxy/services/pluralbuddy/oauthTokens";
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

const RETRY_DELAYS_MS = [500, 1000, 1500] as const;
const CACHE_LIMIT = 2000;
const snowflake = z.string().regex(/^\d{17,20}$/);
const responseSchema = z.object({
  message: z
    .object({
      messageId: snowflake,
      systemId: snowflake,
      alterId: z.number().positive(),
      channelId: snowflake,
      referencedMessage: snowflake.nullish(),
    })
    .nullable(),
});

export type PluralBuddyMessage = NonNullable<z.infer<typeof responseSchema>["message"]> & {
  alterIdKey: string;
};

/** Resolving `null` instead means PluralBuddy said it has no such message; the router counts this as timeout/error, not a miss. */
export class PluralBuddyLookupUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "PluralBuddyLookupUnavailableError";
  }
}

const cache = new Map<string, PluralBuddyMessage>();
const pending = new Map<string, Promise<PluralBuddyMessage | null>>();

function validInstance(instance: MessageProxyInstanceContext): boolean {
  return instance.serviceId === "pluralbuddy" && canonicalMessageProxyOrigin(instance.origin) === instance.origin;
}

function lookupKey(instance: MessageProxyInstanceContext, messageId: string): string {
  return `${instance.instanceId}\0${instance.origin}\0${messageId}`;
}

function backoffMsForAttempt(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

function failLookup(
  instance: MessageProxyInstanceContext,
  reason: string,
  metadata: Record<string, unknown> = {},
  cause?: unknown,
): never {
  log.warn(`PluralBuddy message lookup ${reason}`, undefined, {
    metadata: { instanceId: instance.instanceId, ...metadata },
  });
  throw new PluralBuddyLookupUnavailableError(`PluralBuddy message lookup ${reason}`, cause);
}

/** A miss PluralBuddy already answered stands when the budget ends; any other exhaustion is unresolved. */
function endExhaustedLookup(instance: MessageProxyInstanceContext, lastAnswerWasMiss: boolean, cause?: unknown): null {
  if (lastAnswerWasMiss) return null;
  return failLookup(instance, "timed out", { errorClass: cause instanceof Error ? cause.name : "unknown" }, cause);
}

/** Null also covers no connected bot host, which is a state to report quietly rather than an outage. */
async function lookUp(instance: MessageProxyInstanceContext, messageId: string): Promise<PluralBuddyMessage | null> {
  const lookupTimeoutMs = getMessageProxyLookupTimeoutMs();
  const deadline = Date.now() + lookupTimeoutMs;
  const perAttemptCapMs = attemptCapMs(lookupTimeoutMs);
  let attempt = 0;
  // PluralBuddy reports an unknown message as 200 with a null message, so that counts as a miss alongside 404.
  let lastAnswerWasMiss = false;

  while (true) {
    if (Date.now() >= deadline) return endExhaustedLookup(instance, lastAnswerWasMiss);
    const accessToken = await getPluralBuddyAccessToken(instance);
    if (!accessToken) return null;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return endExhaustedLookup(instance, lastAnswerWasMiss);

    let response: Response;
    const signal = AbortSignal.timeout(Math.min(remainingMs, perAttemptCapMs));
    try {
      response = await fetchUserRemoteUrl(
        `${instance.origin}/api/v1/messages/${messageId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          redirect: "manual",
          signal,
        },
        { strict: true },
      );
    } catch (error) {
      if (error instanceof RemoteUrlPolicyError) {
        return failLookup(instance, "was blocked by the outbound URL policy", { failureCode: error.failureCode });
      }
      if (!(await waitBeforeRetry(deadline, backoffMsForAttempt(attempt)))) {
        return endExhaustedLookup(instance, lastAnswerWasMiss, error);
      }
      attempt++;
      continue;
    }

    let retryDelayMs = backoffMsForAttempt(attempt);
    if (response.status === 401) {
      await discardBody(response);
      await rejectPluralBuddyAccessToken(instance, accessToken);
      return failLookup(instance, "was rejected as unauthorized", { status: 401 });
    }
    if (response.ok) {
      let rawText: string;
      let raw: unknown;
      try {
        rawText = await readBoundedMessageProxyResponse(response);
        raw = JSON.parse(rawText);
      } catch (error) {
        if (!signal.aborted) {
          return failLookup(instance, "returned an unreadable payload", {
            errorClass: error instanceof Error ? error.name : "unknown",
          });
        }
        if (!(await waitBeforeRetry(deadline, retryDelayMs))) {
          return endExhaustedLookup(instance, lastAnswerWasMiss, error);
        }
        attempt++;
        continue;
      }
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) {
        return failLookup(instance, "returned an invalid payload", {
          // Paths and codes only: issue messages can echo response values.
          issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}:${issue.code}`),
        });
      }
      const { message } = parsed.data;
      if (message) {
        // JSON.parse rounds ids above 2^53, so the key comes from the raw text.
        const exactAlterId = rawText.match(/"alterId"\s*:\s*(\d{1,20})\b/)?.[1];
        if (!exactAlterId || Number(exactAlterId) !== message.alterId || message.messageId !== messageId) {
          return failLookup(instance, "returned an inconsistent message");
        }
        return { ...message, alterIdKey: exactAlterId };
      }
      lastAnswerWasMiss = true;
    } else if (response.status === 404 || response.status === 429) {
      await discardBody(response);
      lastAnswerWasMiss = response.status === 404;
      const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response.headers.get("Retry-After")) : null;
      if (retryAfterMs !== null) {
        // Retrying early would ignore the rate limit, and sleeping it out would only stall this admission.
        if (retryAfterMs > deadline - Date.now() - MIN_ATTEMPT_TIMEOUT_MS) {
          return failLookup(instance, "was rate limited beyond its remaining budget", { retryAfterMs });
        }
        retryDelayMs = retryAfterMs;
      }
    } else {
      await discardBody(response);
      return failLookup(instance, "failed", { status: response.status });
    }

    if (!(await waitBeforeRetry(deadline, retryDelayMs))) return endExhaustedLookup(instance, lastAnswerWasMiss);
    attempt++;
  }
}

export async function fetchPluralBuddyMessage(
  instance: MessageProxyInstanceContext,
  messageId: string,
): Promise<PluralBuddyMessage | null> {
  if (!validInstance(instance) || !snowflake.safeParse(messageId).success) return null;
  const key = lookupKey(instance, messageId);
  const cached = cache.get(key);
  if (cached) return cached;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const lookup = lookUp(instance, messageId)
    .then((result) => {
      if (result) {
        if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value ?? "");
        cache.set(key, result);
      }
      return result;
    })
    .finally(() => pending.delete(key));
  pending.set(key, lookup);
  return lookup;
}

export function getCachedPluralBuddyMessage(
  instance: MessageProxyInstanceContext,
  messageId: string,
): PluralBuddyMessage | null {
  if (!validInstance(instance)) return null;
  return cache.get(lookupKey(instance, messageId)) ?? null;
}

export function clearPluralBuddyApiStateForTests(): void {
  cache.clear();
  pending.clear();
}
