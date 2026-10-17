import { afterAll, afterEach, describe, expect, it } from "bun:test";
import type { Message } from "discord.js";
import {
  applyMessageProxyReference,
  beginMessageProxyLookup,
  cancelPendingMessageProxyExpectation,
  clearMessageProxyExpectationStateForTests,
  consumeVerifiedRepostExpectation,
  createMessageProxyExpectation,
  findMatchingMessageProxyExpectation,
  findVerifiedRepostExpectation,
  getMessageProxyExpectationTtlMs,
  getMessageProxyLookupTimeoutMs,
  getMessageProxyWaitMs,
  getLiveMessageProxyExpectationInstances,
  getSupersededMessageProxyOriginalMessageIds,
  hasLiveMessageProxyExpectations,
  isKnownMessageProxyMessage,
  markMessageProxyExpectationProxied,
  markMessageProxyOriginalDeleted,
  rememberMessageProxyMessage,
  waitForMessageProxyExpectation,
} from "@/utils/messageProxy/proxyExpectation";
import type { ProxyMessageAttestation } from "@/utils/messageProxy/types";

const originalProxyWaitMs = process.env.MESSAGE_PROXY_WAIT_MS;
const originalExpectationTtlMs = process.env.MESSAGE_PROXY_EXPECTATION_TTL_MS;
process.env.MESSAGE_PROXY_WAIT_MS = "15";
process.env.MESSAGE_PROXY_EXPECTATION_TTL_MS = "45";

afterAll(() => {
  if (originalProxyWaitMs === undefined) delete process.env.MESSAGE_PROXY_WAIT_MS;
  else process.env.MESSAGE_PROXY_WAIT_MS = originalProxyWaitMs;
  if (originalExpectationTtlMs === undefined) delete process.env.MESSAGE_PROXY_EXPECTATION_TTL_MS;
  else process.env.MESSAGE_PROXY_EXPECTATION_TTL_MS = originalExpectationTtlMs;
});

afterEach(() => {
  clearMessageProxyExpectationStateForTests();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attestation(
  originalMessageId: string,
  senderDiscordId: string,
  serviceId = "service_a",
): ProxyMessageAttestation {
  return {
    serviceId,
    instanceId: `${serviceId}:official`,
    proxyMessageId: "proxy_1",
    originalMessageId,
    senderDiscordId,
    identity: null,
  };
}

function createExpectation(overrides: Partial<Parameters<typeof createMessageProxyExpectation>[0]> = {}) {
  return createMessageProxyExpectation({
    instance: { serviceId: "service_a", instanceId: "service_a:official", origin: "https://example.com" },
    channelId: "channel_1",
    originalMessageId: "original_1",
    senderDiscId: "sender_1",
    originalMessage: { id: "original_1" } as Message,
    originalReference: null,
    ...overrides,
  });
}

describe("message-proxy lookup budget", () => {
  const originalLookupTimeoutMs = process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS;

  afterEach(() => {
    if (originalLookupTimeoutMs === undefined) delete process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS;
    else process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS = originalLookupTimeoutMs;
    process.env.MESSAGE_PROXY_EXPECTATION_TTL_MS = "45";
  });

  it("defaults to 5000ms, honors a smaller value, and falls back on garbage", () => {
    process.env.MESSAGE_PROXY_EXPECTATION_TTL_MS = "10000";
    delete process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS;
    expect(getMessageProxyLookupTimeoutMs()).toBe(5000);
    process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS = "1200";
    expect(getMessageProxyLookupTimeoutMs()).toBe(1200);
    process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS = "not-a-number";
    expect(getMessageProxyLookupTimeoutMs()).toBe(5000);
  });

  it("never outlasts half the expectation TTL, which would expire the match mid-lookup", () => {
    process.env.MESSAGE_PROXY_EXPECTATION_TTL_MS = "10000";
    process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS = "9000";
    expect(getMessageProxyLookupTimeoutMs()).toBe(5000);
    process.env.MESSAGE_PROXY_EXPECTATION_TTL_MS = "4000";
    expect(getMessageProxyLookupTimeoutMs()).toBe(2000);
  });
});

describe("message-proxy expectations", () => {
  it("keeps a PluralBuddy host candidate briefly after the original wait without inventing an original link", async () => {
    const first = createExpectation({
      instance: { serviceId: "pluralbuddy", instanceId: "pluralbuddy:official", origin: "https://pluralbuddy.app" },
    });
    expect(await waitForMessageProxyExpectation(first)).toBe("timeout");
    expect(findVerifiedRepostExpectation("channel_1", "pluralbuddy", "pluralbuddy:official", "sender_1")).toBe(first);
    createExpectation({
      instance: { serviceId: "pluralbuddy", instanceId: "pluralbuddy:official", origin: "https://pluralbuddy.app" },
      originalMessageId: "original_2",
    });
    expect(findVerifiedRepostExpectation("channel_1", "pluralbuddy", "pluralbuddy:official", "sender_1")).toBeNull();
    consumeVerifiedRepostExpectation(first);
    const second = findVerifiedRepostExpectation("channel_1", "pluralbuddy", "pluralbuddy:official", "sender_1");
    expect(second?.originalMessageId).toBe("original_2");
    if (!second) return;
    const record = rememberMessageProxyMessage({
      messageDiscId: "proxy_pb",
      channelId: "channel_1",
      expectation: second,
      verifiedRepostOnly: true,
    });
    expect(record.originalMessageId).toBeNull();
    expect(record.originalSuppressed).toBe(false);
    expect(getSupersededMessageProxyOriginalMessageIds("channel_1")).toEqual(new Set());
  });
  it("cancels only a still-pending expectation and releases its wait as a timeout", async () => {
    const expectation = createExpectation({ originalMessageId: "original_cancel" });
    const wait = waitForMessageProxyExpectation(expectation);

    expect(cancelPendingMessageProxyExpectation(expectation)).toBe(true);
    expect(await wait).toBe("timeout");
    expect(cancelPendingMessageProxyExpectation(expectation)).toBe(false);
    expect(findMatchingMessageProxyExpectation("channel_1", attestation("original_cancel", "sender_1"))).toBeNull();
  });

  it("does not let a late cancellation undo an expectation that already became proxied", async () => {
    const expectation = createExpectation({ originalMessageId: "original_confirmed" });
    const wait = waitForMessageProxyExpectation(expectation);

    markMessageProxyExpectationProxied(expectation);
    expect(cancelPendingMessageProxyExpectation(expectation)).toBe(false);
    expect(await wait).toBe("proxied");
    expect(findMatchingMessageProxyExpectation("channel_1", attestation("original_confirmed", "sender_1"))).toBe(
      expectation,
    );
  });

  it("resolves the original speedbump when the original message is deleted", async () => {
    const expectation = createExpectation();
    const wait = waitForMessageProxyExpectation(expectation);

    expect(markMessageProxyOriginalDeleted("channel_1", "original_1")).toBe(true);
    expect(await wait).toBe("proxied");
    expect(expectation.state).toBe("proxied");
  });

  it("times out normally when no delete arrives inside the wait window", async () => {
    const expectation = createExpectation({ originalMessageId: "original_timeout" });

    expect(await waitForMessageProxyExpectation(expectation)).toBe("timeout");
    expect(hasLiveMessageProxyExpectations("channel_1")).toBe(false);
    expect(findMatchingMessageProxyExpectation("channel_1", attestation("original_timeout", "sender_1"))).toBeNull();
  });

  it("pauses original timeout while a channel lookup is in flight", async () => {
    const expectation = createExpectation({ channelId: "channel_lookup", originalMessageId: "original_lookup" });
    const endLookup = beginMessageProxyLookup("channel_lookup");
    let waitResult: string | null = null;
    const wait = waitForMessageProxyExpectation(expectation).then((result) => {
      waitResult = result;
    });

    await sleep(getMessageProxyWaitMs() + 10);
    expect(waitResult).toBeNull();

    endLookup();
    await wait;
    expect(waitResult as string | null).toBe("timeout");
  });

  it("cleans up expired expectations after the TTL", async () => {
    createExpectation({ channelId: "channel_ttl", originalMessageId: "original_ttl" });

    await sleep(getMessageProxyExpectationTtlMs() + 10);

    expect(hasLiveMessageProxyExpectations("channel_ttl")).toBe(false);
  });

  it("matches exact service, original, sender, and channel attestations", () => {
    const first = createExpectation();
    const second = createExpectation({
      instance: { serviceId: "service_b", instanceId: "service_b:official", origin: "https://example.com" },
      originalMessageId: "original_2",
      senderDiscId: "sender_2",
    });

    expect(findMatchingMessageProxyExpectation("channel_1", attestation("original_2", "sender_2", "service_b"))).toBe(
      second,
    );
    expect(findMatchingMessageProxyExpectation("channel_1", attestation("original_1", "sender_2"))).toBeNull();
    expect(
      findMatchingMessageProxyExpectation("channel_1", attestation("original_1", "sender_1", "service_b")),
    ).toBeNull();
    expect(findMatchingMessageProxyExpectation("other_channel", attestation("original_1", "sender_1"))).toBeNull();
    expect(findMatchingMessageProxyExpectation("channel_1", attestation("original_1", "sender_1"))).toBe(first);
    expect(
      getLiveMessageProxyExpectationInstances("channel_1")
        .map(({ serviceId }) => serviceId)
        .sort(),
    ).toEqual(["service_a", "service_b"]);
  });

  it("marks repost-before-delete races and remembers the proxy message", async () => {
    const reference = { messageId: "bot_reply_target" } as Message["reference"];
    const expectation = createExpectation({ originalReference: reference });
    const wait = waitForMessageProxyExpectation(expectation);
    markMessageProxyExpectationProxied(expectation);
    const record = rememberMessageProxyMessage({
      messageDiscId: "proxy_1",
      channelId: "channel_1",
      expectation,
    });

    expect(await wait).toBe("proxied");
    expect(record.serviceId).toBe("service_a");
    expect(record.originalSuppressed).toBe(true);
    expect(record.senderDiscId).toBe("sender_1");
    expect(isKnownMessageProxyMessage({ id: "proxy_1", webhookId: "webhook_1" } as Message)).toBe(true);

    const proxyMessage = { id: "proxy_1", webhookId: "webhook_1", reference: null } as Message;
    expect(applyMessageProxyReference(proxyMessage)).toBe(true);
    expect(proxyMessage.reference).toBe(reference);
  });

  it("reports superseded originals per channel without collapsing split proxies", () => {
    for (const [channelId, originalMessageId, messageDiscId] of [
      ["channel_1", "original_1", "proxy_1"],
      ["channel_1", "original_2", "proxy_2"],
      ["other_channel", "original_3", "proxy_3"],
    ] as const) {
      rememberMessageProxyMessage({
        messageDiscId,
        channelId,
        expectation: createExpectation({ channelId, originalMessageId }),
      });
    }

    rememberMessageProxyMessage({
      messageDiscId: "proxy_1b",
      channelId: "channel_1",
      expectation: createExpectation(),
    });

    expect(getSupersededMessageProxyOriginalMessageIds("channel_1")).toEqual(new Set(["original_1", "original_2"]));
    expect(getSupersededMessageProxyOriginalMessageIds("other_channel")).toEqual(new Set(["original_3"]));
    expect(getSupersededMessageProxyOriginalMessageIds("empty_channel").size).toBe(0);
  });
});
