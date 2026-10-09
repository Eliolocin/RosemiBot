import { afterEach, describe, expect, it } from "bun:test";
import { type RateLimitData, REST, type Webhook } from "discord.js";
import {
  runDeferrableWebhookAvatarEdit,
  shouldRejectWebhookRateLimit,
  WEBHOOK_AVATAR_PATCH_MAX_WAIT_MS,
  WebhookAvatarEditDeferredError,
} from "@/utils/discord/webhook/avatarEditRateLimit";
import { clearWebhookCache, sendWebhookMessageWithIdentity } from "@/utils/discord/webhook/webhookCore";

const LONG_WAIT_MS = 60_000;

function rateLimitData(overrides: Partial<RateLimitData> = {}): RateLimitData {
  return {
    global: false,
    method: "PATCH",
    url: "https://discord.com/api/v10/webhooks/1/token",
    route: "/webhooks/:id/:token",
    majorParameter: "1/token",
    hash: "hash",
    limit: 2,
    timeToReset: LONG_WAIT_MS,
    retryAfter: LONG_WAIT_MS,
    sublimitTimeout: 0,
    scope: "user",
    ...overrides,
  };
}

describe("shouldRejectWebhookRateLimit", () => {
  it("rejects a long webhook edit wait only inside a deferrable edit", async () => {
    expect(shouldRejectWebhookRateLimit(rateLimitData())).toBe(false);
    const inScope = await runDeferrableWebhookAvatarEdit("1", async () =>
      shouldRejectWebhookRateLimit(rateLimitData()),
    );
    expect(inScope).toBe(true);
  });

  it("keeps waiting for message edits, other methods, and short waits", async () => {
    const decisions = await runDeferrableWebhookAvatarEdit("1", async () => [
      shouldRejectWebhookRateLimit(rateLimitData({ route: "/webhooks/:id/:token/messages/:id" })),
      shouldRejectWebhookRateLimit(rateLimitData({ method: "POST" })),
      shouldRejectWebhookRateLimit(
        rateLimitData({ timeToReset: WEBHOOK_AVATAR_PATCH_MAX_WAIT_MS, retryAfter: WEBHOOK_AVATAR_PATCH_MAX_WAIT_MS }),
      ),
    ]);
    expect(decisions).toEqual([false, false, false]);
  });

  it("rejects the tokenless webhook edit route as well", async () => {
    const decision = await runDeferrableWebhookAvatarEdit("1", async () =>
      shouldRejectWebhookRateLimit(rateLimitData({ route: "/webhooks/:id" })),
    );
    expect(decision).toBe(true);
  });

  /**
   * A 429 without bucket headers leaves `timeToReset` near zero while discord.js still sleeps for
   * `Retry-After`, so judging on `timeToReset` alone would wait out the very stall this exists for.
   */
  it("judges the wait by the larger of timeToReset and retryAfter", async () => {
    const decision = await runDeferrableWebhookAvatarEdit("1", async () =>
      shouldRejectWebhookRateLimit(rateLimitData({ timeToReset: 0 })),
    );
    expect(decision).toBe(true);
  });
});

describe("a deferrable edit through the real REST client", () => {
  function makeRateLimitedRest(): { rest: REST; networkCalls: () => number } {
    let calls = 0;
    const rest = new REST({
      makeRequest: async () => {
        calls++;
        return new Response("{}", {
          status: 429,
          headers: {
            "Retry-After": "60",
            "X-RateLimit-Limit": "2",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset-After": "60",
            "X-RateLimit-Bucket": "bucket",
            "content-type": "application/json",
          },
        }) as never;
      },
      rejectOnRateLimit: shouldRejectWebhookRateLimit,
    }).setToken("token");
    return { rest, networkCalls: () => calls };
  }

  it("throws a deferral on a 429 without queueing a retry", async () => {
    const { rest, networkCalls } = makeRateLimitedRest();
    const edit = () => rest.patch("/webhooks/123456789012345678/token", { body: {} });

    const first = runDeferrableWebhookAvatarEdit("123456789012345678", edit);
    await expect(first).rejects.toBeInstanceOf(WebhookAvatarEditDeferredError);
    await expect(first).rejects.toMatchObject({ webhookId: "123456789012345678" });
    expect(networkCalls()).toBe(1);
  });

  it("throws a deferral for an edit queued behind a rate-limited one", async () => {
    const { rest, networkCalls } = makeRateLimitedRest();
    const edit = () => rest.patch("/webhooks/123456789012345678/token", { body: {} });

    const results = await Promise.allSettled([
      runDeferrableWebhookAvatarEdit("123456789012345678", edit),
      runDeferrableWebhookAvatarEdit("123456789012345678", edit),
    ]);

    for (const result of results) {
      expect(result.status).toBe("rejected");
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(WebhookAvatarEditDeferredError);
    }
    // The queued edit saw the depleted bucket and was rejected before reaching the network.
    expect(networkCalls()).toBe(1);
  });
});

describe("sendWebhookMessageWithIdentity avatar edits under a rate limit", () => {
  afterEach(() => {
    clearWebhookCache();
  });

  /**
   * Stands in for discord.js: the edit consults the same client predicate, so it rejects only
   * inside a deferrable scope and otherwise "waits" (resolves) as discord.js would.
   */
  function makeRateLimitedWebhook(id: string) {
    const edits: unknown[] = [];
    const sends: unknown[] = [];
    const webhook = {
      id,
      channelId: "1400000000000000000",
      avatar: null,
      async edit(options: unknown) {
        const data = rateLimitData();
        if (shouldRejectWebhookRateLimit(data)) {
          const { RateLimitError } = await import("discord.js");
          throw new RateLimitError(data);
        }
        edits.push(options);
        return webhook;
      },
      async send(payload: unknown) {
        sends.push(payload);
        return { id: "1400000000000000001", webhookId: id };
      },
    };
    return { webhook: webhook as unknown as Webhook, edits, sends };
  }

  it("defers instead of editing or sending when the caller opts in", async () => {
    const { webhook, edits, sends } = makeRateLimitedWebhook("1500000000000000001");

    const sending = sendWebhookMessageWithIdentity(
      webhook,
      { content: "hi" },
      { username: "Locke", avatarDataUri: "data:image/png;base64,AAAA" },
      undefined,
      { deferAvatarEditOnRateLimit: true },
    );

    await expect(sending).rejects.toBeInstanceOf(WebhookAvatarEditDeferredError);
    expect(edits).toEqual([]);
    expect(sends).toEqual([]);
  });

  it("keeps waiting for every caller that does not opt in", async () => {
    const { webhook, edits, sends } = makeRateLimitedWebhook("1500000000000000002");

    await sendWebhookMessageWithIdentity(
      webhook,
      { content: "hi" },
      { username: "Locke", avatarDataUri: "data:image/png;base64,AAAA" },
    );

    expect(edits).toHaveLength(1);
    expect(sends).toHaveLength(1);
  });
});
