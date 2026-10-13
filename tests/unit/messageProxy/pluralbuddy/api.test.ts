import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { MessageProxyInstanceContext } from "@/utils/messageProxy/instances";
import { officialMessageProxyInstanceFixture } from "../../../helpers/messageProxyInstance";
import * as oauthTokens from "@/utils/messageProxy/services/pluralbuddy/oauthTokens";
import * as remoteFetch from "@/utils/security/userRemoteFetch";
import { log } from "@/utils/misc/logger";
import { stallUntilAborted } from "../../../helpers/fetchStub";
import {
  clearPluralBuddyApiStateForTests,
  fetchPluralBuddyMessage,
  getCachedPluralBuddyMessage,
  PluralBuddyLookupUnavailableError,
} from "@/utils/messageProxy/services/pluralbuddy/api";

const official = officialMessageProxyInstanceFixture("pluralbuddy");
const custom: MessageProxyInstanceContext = {
  serviceId: "pluralbuddy",
  instanceId: "pluralbuddy:11111111-2222-4333-8444-555555555555",
  origin: "https://example.org",
};
const messageId = "123456789012345678";
const hostId = "234567890123456789";
const channelId = "345678901234567890";

const originalLookupTimeoutMs = process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS;

afterEach(() => {
  mock.restore();
  clearPluralBuddyApiStateForTests();
  if (originalLookupTimeoutMs === undefined) delete process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS;
  else process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS = originalLookupTimeoutMs;
});

function setLookupBudget(ms: number): void {
  process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS = String(ms);
}

function messageResponse(id = messageId): Response {
  return new Response(
    `{"message":{"messageId":"${id}","systemId":"${hostId}","alterId":456789012345678901,"channelId":"${channelId}"}}`,
  );
}

describe("PluralBuddy message lookup", () => {
  it("does not request a message without bot host authorization", async () => {
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue(null);
    const fetch = spyOn(remoteFetch, "fetchUserRemoteUrl");
    expect(await fetchPluralBuddyMessage(official, messageId)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses each instance origin and keeps concurrent lookups and cached records separate", async () => {
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockImplementation(async (instance) => instance.instanceId);
    const fetch = spyOn(remoteFetch, "fetchUserRemoteUrl").mockImplementation(async (url, init) => {
      const origin = new URL(String(url)).origin;
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${origin === official.origin ? official.instanceId : custom.instanceId}`,
      );
      return messageResponse();
    });

    const [first, duplicate, second] = await Promise.all([
      fetchPluralBuddyMessage(official, messageId),
      fetchPluralBuddyMessage(official, messageId),
      fetchPluralBuddyMessage(custom, messageId),
    ]);
    expect(first?.alterIdKey).toBe("456789012345678901");
    expect(duplicate).toEqual(first);
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      `${official.origin}/api/v1/messages/${messageId}`,
      `${custom.origin}/api/v1/messages/${messageId}`,
    ]);
    expect(getCachedPluralBuddyMessage(official, messageId)).toEqual(first);
    expect(getCachedPluralBuddyMessage(custom, messageId)).toEqual(second);
  });

  it("reports a response for another repost ID as unavailable, not a miss", async () => {
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue("token");
    spyOn(remoteFetch, "fetchUserRemoteUrl").mockResolvedValue(messageResponse("999999999999999999"));
    spyOn(log, "warn").mockImplementation(() => {});
    await expect(fetchPluralBuddyMessage(official, messageId)).rejects.toThrow(PluralBuddyLookupUnavailableError);
  });

  it("accepts the null reply reference the live API sends for a non-reply", async () => {
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue("token");
    spyOn(remoteFetch, "fetchUserRemoteUrl").mockResolvedValue(
      new Response(
        `{"message":{"messageId":"${messageId}","systemId":"${hostId}","alterId":456789012345678901,"channelId":"${channelId}","referencedMessage":null}}`,
      ),
    );
    const message = await fetchPluralBuddyMessage(official, messageId);
    expect(message?.alterIdKey).toBe("456789012345678901");
    expect(message?.referencedMessage).toBeNull();
  });

  it("keeps a snowflake reply reference", async () => {
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue("token");
    spyOn(remoteFetch, "fetchUserRemoteUrl").mockResolvedValue(
      new Response(
        `{"message":{"messageId":"${messageId}","systemId":"${hostId}","alterId":456789012345678901,"channelId":"${channelId}","referencedMessage":"567890123456789012"}}`,
      ),
    );
    expect((await fetchPluralBuddyMessage(official, messageId))?.referencedMessage).toBe("567890123456789012");
  });

  it("logs the failing field path without echoing response values", async () => {
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue("token");
    spyOn(remoteFetch, "fetchUserRemoteUrl").mockResolvedValue(
      new Response(
        `{"message":{"messageId":"${messageId}","systemId":"${hostId}","alterId":"secret-alter","channelId":"${channelId}"}}`,
      ),
    );
    const warn = spyOn(log, "warn").mockImplementation(() => {});
    await expect(fetchPluralBuddyMessage(official, messageId)).rejects.toThrow(PluralBuddyLookupUnavailableError);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("message.alterId:invalid_type");
    expect(logged).not.toContain("secret-alter");
  });

  it("retries a rate limit without Retry-After on the backoff schedule", async () => {
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue("token");
    const fetch = spyOn(remoteFetch, "fetchUserRemoteUrl")
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(messageResponse());
    const start = Date.now();
    expect((await fetchPluralBuddyMessage(official, messageId))?.alterIdKey).toBe("456789012345678901");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(Date.now() - start).toBeGreaterThanOrEqual(450);
  });

  it("stops instead of retrying early when Retry-After outlasts the budget", async () => {
    setLookupBudget(2000);
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue("token");
    spyOn(log, "warn").mockImplementation(() => {});
    const fetch = spyOn(remoteFetch, "fetchUserRemoteUrl").mockImplementation(
      async () => new Response(null, { status: 429, headers: { "Retry-After": "30" } }),
    );
    const start = Date.now();
    await expect(fetchPluralBuddyMessage(official, messageId)).rejects.toThrow(PluralBuddyLookupUnavailableError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("reports a rejected token as unavailable without retrying the message", async () => {
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue("token");
    const reject = spyOn(oauthTokens, "rejectPluralBuddyAccessToken").mockResolvedValue();
    spyOn(log, "warn").mockImplementation(() => {});
    const fetch = spyOn(remoteFetch, "fetchUserRemoteUrl").mockResolvedValue(new Response(null, { status: 401 }));
    await expect(fetchPluralBuddyMessage(official, messageId)).rejects.toThrow(PluralBuddyLookupUnavailableError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(reject).toHaveBeenCalledWith(official, "token");
  });

  it("reports an unexpected status as unavailable rather than a miss", async () => {
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue("token");
    spyOn(log, "warn").mockImplementation(() => {});
    const fetch = spyOn(remoteFetch, "fetchUserRemoteUrl").mockResolvedValue(new Response(null, { status: 500 }));
    await expect(fetchPluralBuddyMessage(official, messageId)).rejects.toThrow(PluralBuddyLookupUnavailableError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a 404 (index lag) and succeeds once the message appears", async () => {
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue("token");
    const fetch = spyOn(remoteFetch, "fetchUserRemoteUrl")
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(messageResponse());
    expect((await fetchPluralBuddyMessage(official, messageId))?.messageId).toBe(messageId);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns null, not an error, once the budget ends on a 404 or an empty message", async () => {
    setLookupBudget(1200);
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue("token");
    const warn = spyOn(log, "warn").mockImplementation(() => {});
    const responses = [
      () => new Response(null, { status: 404 }),
      () => new Response('{"message":null}', { status: 200 }),
    ];
    for (const respond of responses) {
      spyOn(remoteFetch, "fetchUserRemoteUrl").mockImplementation(async () => respond());
      expect(await fetchPluralBuddyMessage(official, messageId)).toBeNull();
      clearPluralBuddyApiStateForTests();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("aborts a stalled attempt in time to recover on a second attempt", async () => {
    setLookupBudget(2000);
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue("token");
    let calls = 0;
    const fetch = spyOn(remoteFetch, "fetchUserRemoteUrl").mockImplementation(async (_url, init) => {
      calls++;
      return calls === 1 ? stallUntilAborted(init?.signal) : messageResponse();
    });
    const start = Date.now();
    expect((await fetchPluralBuddyMessage(official, messageId))?.alterIdKey).toBe("456789012345678901");
    const elapsed = Date.now() - start;
    expect(fetch).toHaveBeenCalledTimes(2);
    // Half the budget (1000ms): a whole-budget attempt would leave no time to retry.
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(elapsed).toBeLessThan(2000);
  });

  it("reports an unresolved stall as unavailable and omits the access token from its warning", async () => {
    setLookupBudget(2000);
    const secretToken = "sensitive-access-token";
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue(secretToken);
    const warning = spyOn(log, "warn").mockImplementation(() => {});
    const fetch = spyOn(remoteFetch, "fetchUserRemoteUrl").mockImplementation(async (_url, init) =>
      stallUntilAborted(init?.signal),
    );

    const start = Date.now();
    await expect(fetchPluralBuddyMessage(official, messageId)).rejects.toThrow(PluralBuddyLookupUnavailableError);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(Date.now() - start).toBeLessThan(2400);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warning.mock.calls)).not.toContain(secretToken);
  });

  it("does not cache a failed lookup, so a later call can still resolve the message", async () => {
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue("token");
    spyOn(log, "warn").mockImplementation(() => {});
    spyOn(remoteFetch, "fetchUserRemoteUrl").mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(fetchPluralBuddyMessage(official, messageId)).rejects.toThrow(PluralBuddyLookupUnavailableError);
    spyOn(remoteFetch, "fetchUserRemoteUrl").mockResolvedValue(messageResponse());
    expect((await fetchPluralBuddyMessage(official, messageId))?.messageId).toBe(messageId);
  });
});
