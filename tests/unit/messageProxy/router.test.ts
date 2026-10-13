import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import type { Message } from "discord.js";
import {
  clearMessageProxyExpectationStateForTests,
  createMessageProxyExpectation,
  getLiveMessageProxyExpectationInstances,
  getMessageProxyMessageRecord,
  markMessageProxyExpectationProxied,
  markMessageProxyOriginalDeleted,
  rememberMessageProxyMessage,
  waitForMessageProxyExpectation,
} from "@/utils/messageProxy/proxyExpectation";
import { createProxyServiceRegistry } from "@/utils/messageProxy/registry";
import {
  clearMessageProxyRouteMetricsForTests,
  getMessageProxyRouteMetricsSnapshot,
  routeMessageProxyMessage,
} from "@/utils/messageProxy/router";
import { clearPluralKitApiStateForTests } from "@/utils/messageProxy/services/pluralkit/api";
import type { MessageProxyInstanceContext } from "@/utils/messageProxy/instances";
import type {
  ProxyIdentityUpsertInput,
  ProxyMessageAttestation,
  ProxyServiceDescriptor,
  ProxyServicePresentation,
} from "@/utils/messageProxy/types";
import { stallUntilAborted } from "../../helpers/fetchStub";
import { officialMessageProxyInstanceFixture } from "../../helpers/messageProxyInstance";

const originalLookupTimeoutMs = process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS;
const originalProxyWaitMs = process.env.MESSAGE_PROXY_WAIT_MS;

afterAll(() => {
  if (originalLookupTimeoutMs === undefined) delete process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS;
  else process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS = originalLookupTimeoutMs;
  if (originalProxyWaitMs === undefined) delete process.env.MESSAGE_PROXY_WAIT_MS;
  else process.env.MESSAGE_PROXY_WAIT_MS = originalProxyWaitMs;
});

/** Runs one test under timing other than the production defaults it would otherwise wait out. */
async function withTiming(
  timing: { lookupTimeoutMs?: number; proxyWaitMs?: number },
  body: () => Promise<void>,
): Promise<void> {
  try {
    if (timing.lookupTimeoutMs !== undefined)
      process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS = String(timing.lookupTimeoutMs);
    if (timing.proxyWaitMs !== undefined) process.env.MESSAGE_PROXY_WAIT_MS = String(timing.proxyWaitMs);
    await body();
  } finally {
    if (originalLookupTimeoutMs === undefined) delete process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS;
    else process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS = originalLookupTimeoutMs;
    if (originalProxyWaitMs === undefined) delete process.env.MESSAGE_PROXY_WAIT_MS;
    else process.env.MESSAGE_PROXY_WAIT_MS = originalProxyWaitMs;
  }
}

/** A valid PluralKit lookup payload whose original and sender match the standard expectation. */
function pluralKitPayload(): Record<string, unknown> {
  return {
    original: "123456789012345678",
    sender: "234567890123456789",
    system: { id: "abcdef", uuid: "11111111-2222-4333-8444-555555555555", name: "Lighthouse", tag: null },
    member: { id: "ghijkl", uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: "Mirri" },
  };
}

const presentation: ProxyServicePresentation = {
  identityMembershipLine: (context) => `- Linked to ${context.namespaceDisplayName ?? "an account"}`,
  namespacePresentation: (context) => ({
    sectionHeading: "Linked profiles:",
    entry: `- ${context.namespaceDisplayName ?? "Profile"}`,
  }),
};

function identity(serviceId: string): ProxyIdentityUpsertInput {
  return {
    serviceId,
    instanceId: testInstance(serviceId).instanceId,
    externalIdentityKind: `${serviceId}_profile`,
    externalKey: "profile-1",
    shortId: "p1",
    displayName: "Mirri",
    bio: null,
    namespace: {
      namespaceKey: "account-1",
      shortId: "a1",
      displayName: "Lighthouse",
      tag: null,
      description: null,
    },
  };
}

function claim(serviceId: string, overrides: Partial<ProxyMessageAttestation> = {}): ProxyMessageAttestation {
  return {
    serviceId,
    instanceId: testInstance(serviceId).instanceId,
    proxyMessageId: "proxy-1",
    originalMessageId: "original-1",
    senderDiscordId: "sender-1",
    identity: null,
    ...overrides,
  };
}

function testInstance(serviceId: string): MessageProxyInstanceContext {
  if (serviceId === "pluralkit" || serviceId === "pluralbuddy") return officialMessageProxyInstanceFixture(serviceId);
  return { serviceId, instanceId: `${serviceId}:official`, origin: "https://example.com" };
}

function descriptor(
  serviceId: string,
  attestMessage: (messageId: string, instance: MessageProxyInstanceContext) => Promise<ProxyMessageAttestation | null>,
  stableIdentity = false,
): ProxyServiceDescriptor<string> {
  const base = {
    serviceId,
    settingsLocaleKey: `${serviceId}_option`,
    enabledSuccessDescriptionLocaleKey: `commands.personal.message-proxy.${serviceId}_enabled_success_description`,
    syntheticUserPrefix: `${serviceId}:` as `${string}:`,
    externalIdentityKind: `${serviceId}_profile`,
    validateExternalKey: (key: string) => key.length > 0,
    presentation,
    attestMessage,
  };
  return stableIdentity
    ? {
        ...base,
        capabilities: {
          correlation: "attested" as const,
          identity: "stable" as const,
          identityBio: "none" as const,
          namespaceBio: "none" as const,
        },
      }
    : { ...base, capabilities: { correlation: "attested" as const, identity: "none" as const } };
}

const noCorrelationDescriptor = {
  serviceId: "uncorrelated",
  settingsLocaleKey: "uncorrelated_option",
  enabledSuccessDescriptionLocaleKey: "commands.personal.message-proxy.uncorrelated_enabled_success_description",
  syntheticUserPrefix: "uncorrelated:",
  externalIdentityKind: "uncorrelated_profile",
  validateExternalKey: (key: string) => key.length > 0,
  presentation,
  capabilities: { correlation: "none", identity: "none" },
} as const satisfies ProxyServiceDescriptor<"uncorrelated">;

function message(): Message {
  return { id: "proxy-1", channelId: "channel-1", webhookId: "webhook-1", author: { username: "Juno" } } as Message;
}

function expectation(serviceId: string) {
  const originalMessageId = serviceId === "pluralkit" ? "123456789012345678" : "original-1";
  const senderDiscId = serviceId === "pluralkit" ? "234567890123456789" : "sender-1";
  return createMessageProxyExpectation({
    instance: testInstance(serviceId),
    channelId: "channel-1",
    originalMessageId,
    senderDiscId,
    originalMessage: { id: originalMessageId } as Message,
    originalReference: null,
  });
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearMessageProxyExpectationStateForTests();
  clearMessageProxyRouteMetricsForTests();
  clearPluralKitApiStateForTests();
});

describe("message-proxy attestation router", () => {
  it("accepts a verified repost without claiming an original ID", async () => {
    const service = {
      serviceId: "best_effort",
      settingsLocaleKey: "best_effort_option",
      enabledSuccessDescriptionLocaleKey: "commands.personal.message-proxy.best_effort_enabled_success_description",
      syntheticUserPrefix: "best_effort:" as const,
      externalIdentityKind: "best_effort_profile",
      validateExternalKey: (key: string) => key.length > 0,
      presentation,
      attestMessage: async () =>
        claim("best_effort", {
          originalMessageId: null,
          senderDiscordId: "sender-1",
          identity: identity("best_effort"),
        }),
      capabilities: {
        correlation: "verified-repost" as const,
        identity: "stable" as const,
        identityBio: "none" as const,
        namespaceBio: "none" as const,
      },
    } satisfies ProxyServiceDescriptor<"best_effort">;
    const expected = expectation("best_effort");
    const result = await routeMessageProxyMessage(
      { message: message(), candidateInstances: ["best_effort"].map((serviceId) => testInstance(serviceId)) },
      { registry: createProxyServiceRegistry([service]) },
    );
    expect(result.status).toBe("matched_stable_identity");
    if (result.status === "matched_stable_identity") {
      expect(result.expectation).toBe(expected);
      expect(result.attestation.originalMessageId).toBeNull();
      expect(result.attestation.identity?.displayName).toBe("Juno");
    }
  });
  it("reports unsupported correlation without invoking transport", async () => {
    const registry = createProxyServiceRegistry([noCorrelationDescriptor]);

    expect(
      await routeMessageProxyMessage(
        { message: message(), candidateInstances: ["uncorrelated"].map((serviceId) => testInstance(serviceId)) },
        { registry },
      ),
    ).toEqual({
      status: "unsupported_correlation",
    });
    expect(getMessageProxyRouteMetricsSnapshot()).toMatchObject({
      unsupported_correlation: 1,
      unmatched: 0,
      matched_stable_identity: 0,
    });
  });

  it("skips transport for an instance whose adapter says it cannot have sent the message", async () => {
    let calls = 0;
    const seen: string[] = [];
    const service = {
      ...descriptor("picky", async () => {
        calls += 1;
        return claim("picky");
      }),
      canAttestMessage: (_message: Message, instance: MessageProxyInstanceContext) => {
        seen.push(instance.instanceId);
        return false;
      },
    } as ProxyServiceDescriptor<string>;

    expect(
      await routeMessageProxyMessage(
        { message: message(), candidateInstances: [testInstance("picky")] },
        { registry: createProxyServiceRegistry([service]) },
      ),
    ).toEqual({ status: "unsupported_correlation" });
    expect(calls).toBe(0);
    expect(seen).toEqual([testInstance("picky").instanceId]);
  });

  it("tells the adapter about a message only once its claim is accepted", async () => {
    const recorded: string[] = [];
    const withHook = (serviceId: string, answer: () => ProxyMessageAttestation | null) =>
      ({
        ...descriptor(serviceId, async () => answer()),
        recordAttestedMessage: (_message: Message, instance: MessageProxyInstanceContext) => {
          recorded.push(instance.instanceId);
        },
      }) as ProxyServiceDescriptor<string>;

    const accepted = withHook("accepted", () => claim("accepted"));
    await routeMessageProxyMessage(
      { message: message(), candidateInstances: [testInstance("accepted")] },
      { registry: createProxyServiceRegistry([accepted]) },
    );
    expect(recorded).toEqual([testInstance("accepted").instanceId]);

    recorded.length = 0;
    const first = withHook("first", () => claim("first"));
    const second = withHook("second", () => claim("second"));
    await routeMessageProxyMessage(
      { message: message(), candidateInstances: [testInstance("first"), testInstance("second")] },
      { registry: createProxyServiceRegistry([first, second]) },
    );
    expect(recorded).toEqual([]);

    const miss = withHook("miss", () => null);
    await routeMessageProxyMessage(
      { message: message(), candidateInstances: [testInstance("miss")] },
      { registry: createProxyServiceRegistry([miss]) },
    );
    expect(recorded).toEqual([]);
  });

  it("invokes each distinct eligible adapter once and fails closed on zero claims", async () => {
    let calls = 0;
    const empty = descriptor("empty", async () => {
      calls += 1;
      return null;
    });
    const registry = createProxyServiceRegistry([empty]);

    expect(
      await routeMessageProxyMessage(
        { message: message(), candidateInstances: ["empty", "empty"].map((serviceId) => testInstance(serviceId)) },
        { registry },
      ),
    ).toEqual({ status: "unmatched" });
    expect(calls).toBe(1);
  });

  it("fails closed when two services claim one webhook message", async () => {
    const first = descriptor("first", async () => claim("first"));
    const second = descriptor("second", async () => claim("second"));
    const registry = createProxyServiceRegistry([first, second]);

    expect(
      await routeMessageProxyMessage(
        { message: message(), candidateInstances: ["first", "second"].map((serviceId) => testInstance(serviceId)) },
        { registry },
      ),
    ).toEqual({ status: "conflicting_attestations" });
  });

  it("admits an exact correlated identity-free claim without inventing identity", async () => {
    const service = descriptor("trigger_only", async () => claim("trigger_only"));
    const registry = createProxyServiceRegistry([service]);
    const expected = expectation("trigger_only");

    const result = await routeMessageProxyMessage(
      { message: message(), candidateInstances: ["trigger_only"].map((serviceId) => testInstance(serviceId)) },
      { registry },
    );

    expect(result).toEqual({
      status: "matched_trigger_only",
      attestation: claim("trigger_only"),
      expectation: expected,
    });
  });

  it("rejects stable identity data from an identity-free adapter", async () => {
    const service = descriptor("trigger_only", async () =>
      claim("trigger_only", { identity: identity("trigger_only") }),
    );
    const registry = createProxyServiceRegistry([service]);
    expectation("trigger_only");

    expect(
      await routeMessageProxyMessage(
        { message: message(), candidateInstances: ["trigger_only"].map((serviceId) => testInstance(serviceId)) },
        { registry },
      ),
    ).toEqual({ status: "unmatched" });
  });

  it("admits an exact stable identity claim", async () => {
    const attestation = claim("stable", { identity: identity("stable") });
    const service = descriptor("stable", async () => attestation, true);
    const registry = createProxyServiceRegistry([service]);
    const expected = expectation("stable");

    expect(
      await routeMessageProxyMessage(
        { message: message(), candidateInstances: ["stable"].map((serviceId) => testInstance(serviceId)) },
        { registry },
      ),
    ).toEqual({
      status: "matched_stable_identity",
      attestation,
      expectation: expected,
    });
    expect(getMessageProxyRouteMetricsSnapshot().matched_stable_identity).toBe(1);
  });

  it("suppresses a delete-first original and admits only its exact repost", async () => {
    const service = descriptor("exact", async () => claim("exact"));
    const registry = createProxyServiceRegistry([service]);
    const expected = expectation("exact");
    const originalWait = waitForMessageProxyExpectation(expected);

    expect(markMessageProxyOriginalDeleted("channel-1", "original-1")).toBe(true);
    const result = await routeMessageProxyMessage(
      { message: message(), candidateInstances: ["exact"].map((serviceId) => testInstance(serviceId)) },
      { registry },
    );
    expect(result.status).toBe("matched_trigger_only");
    if (result.status !== "matched_trigger_only") throw new Error("Expected an exact trigger-only match");

    markMessageProxyExpectationProxied(result.expectation);
    const record = rememberMessageProxyMessage({
      messageDiscId: "proxy-1",
      channelId: "channel-1",
      expectation: result.expectation,
    });
    expect(await originalWait).toBe("proxied");
    expect(record.originalMessageId).toBe("original-1");
  });

  it("keeps a late repost after a suppressed original identity-free and silent", async () => {
    const failing = descriptor("failing", async () => {
      throw new Error("transport unavailable");
    });
    const registry = createProxyServiceRegistry([failing]);
    const expected = expectation("failing");
    const originalWait = waitForMessageProxyExpectation(expected);

    expect(markMessageProxyOriginalDeleted("channel-1", "original-1")).toBe(true);
    expect(
      await routeMessageProxyMessage(
        { message: message(), candidateInstances: ["failing"].map((serviceId) => testInstance(serviceId)) },
        { registry },
      ),
    ).toEqual({
      status: "timeout_or_error",
    });
    expect(await originalWait).toBe("proxied");
    expect(getMessageProxyMessageRecord("proxy-1")).toBeNull();
    expect(getMessageProxyRouteMetricsSnapshot()).toMatchObject({ timeout_or_error: 1, unmatched: 0 });
  });

  it("releases a paused original wait after a failed lookup so the channel keeps working", async () => {
    await withTiming({ proxyWaitMs: 80 }, async () => {
      const failing = descriptor("failing", async () => {
        throw new Error("transport unavailable");
      });
      const registry = createProxyServiceRegistry([failing]);
      const expected = expectation("failing");
      const originalWait = waitForMessageProxyExpectation(expected);

      expect(
        await routeMessageProxyMessage(
          { message: message(), candidateInstances: ["failing"].map((serviceId) => testInstance(serviceId)) },
          { registry },
        ),
      ).toEqual({ status: "timeout_or_error" });

      // The lookup pauses this channel's wait timers. A failed lookup must resume them,
      // or every original in the channel is held until its TTL expires.
      const waitResult = await Promise.race([
        originalWait,
        new Promise<"stuck">((resolve) => setTimeout(() => resolve("stuck"), 1000)),
      ]);
      expect(waitResult).toBe("timeout");
      expect(getLiveMessageProxyExpectationInstances("channel-1")).toEqual([]);
    });
  });

  it("counts a confirmed miss as unmatched and a transport failure as timeout_or_error", async () => {
    const missing = descriptor("missing", async () => null);
    const failing = descriptor("failing", async () => {
      throw new Error("transport unavailable");
    });

    expect(
      await routeMessageProxyMessage(
        { message: message(), candidateInstances: ["missing"].map((serviceId) => testInstance(serviceId)) },
        { registry: createProxyServiceRegistry([missing]) },
      ),
    ).toEqual({ status: "unmatched" });
    expect(
      await routeMessageProxyMessage(
        { message: message(), candidateInstances: ["failing"].map((serviceId) => testInstance(serviceId)) },
        { registry: createProxyServiceRegistry([failing]) },
      ),
    ).toEqual({ status: "timeout_or_error" });

    expect(getMessageProxyRouteMetricsSnapshot()).toMatchObject({ unmatched: 1, timeout_or_error: 1 });
  });

  it("recovers a PluralKit repost whose first lookup attempt stalls", async () => {
    await withTiming({ lookupTimeoutMs: 3000, proxyWaitMs: 5000 }, async () => {
      let calls = 0;
      globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls++;
        if (calls === 1) return stallUntilAborted(init?.signal);
        return new Response(JSON.stringify(pluralKitPayload()), { status: 200 });
      }) as unknown as typeof fetch;
      const expected = expectation("pluralkit");

      const result = await routeMessageProxyMessage({
        message: message(),
        candidateInstances: getLiveMessageProxyExpectationInstances("channel-1"),
      });

      expect(calls).toBe(2);
      expect(result.status).toBe("matched_stable_identity");
      if (result.status === "matched_stable_identity") {
        expect(result.expectation).toBe(expected);
        expect(result.attestation.identity?.externalKey).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
      }
    });
  }, 10_000);

  it("counts a stalled PluralKit lookup as timeout_or_error, not a miss", async () => {
    await withTiming({ lookupTimeoutMs: 600 }, async () => {
      globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) =>
        stallUntilAborted(init?.signal),
      ) as unknown as typeof fetch;
      expectation("pluralkit");

      expect(
        await routeMessageProxyMessage({
          message: message(),
          candidateInstances: getLiveMessageProxyExpectationInstances("channel-1"),
        }),
      ).toEqual({ status: "timeout_or_error" });
      expect(getMessageProxyRouteMetricsSnapshot()).toMatchObject({ timeout_or_error: 1, unmatched: 0 });
    });
  });

  it("counts a PluralKit 404 as an unmatched miss rather than an error", async () => {
    await withTiming({ lookupTimeoutMs: 600 }, async () => {
      globalThis.fetch = mock(async () => new Response(JSON.stringify({}), { status: 404 })) as unknown as typeof fetch;
      expectation("pluralkit");

      expect(
        await routeMessageProxyMessage({
          message: message(),
          candidateInstances: getLiveMessageProxyExpectationInstances("channel-1"),
        }),
      ).toEqual({ status: "unmatched" });
      expect(getMessageProxyRouteMetricsSnapshot()).toMatchObject({ unmatched: 1, timeout_or_error: 0 });
    });
  });

  it("rejects stable identity metadata that does not belong to the claiming descriptor", async () => {
    const service = descriptor(
      "stable",
      async () =>
        claim("stable", {
          identity: {
            ...identity("stable"),
            externalIdentityKind: "other_profile",
          },
        }),
      true,
    );
    const registry = createProxyServiceRegistry([service]);
    expectation("stable");

    expect(
      await routeMessageProxyMessage(
        { message: message(), candidateInstances: ["stable"].map((serviceId) => testInstance(serviceId)) },
        { registry },
      ),
    ).toEqual({
      status: "unmatched",
    });
  });

  for (const [label, overrides] of [
    ["original", { originalMessageId: "wrong-original" }],
    ["sender", { senderDiscordId: "wrong-sender" }],
    ["service", { serviceId: "wrong-service" }],
  ] as const) {
    it(`rejects a claim with the wrong ${label}`, async () => {
      const service = descriptor("exact", async () => claim("exact", overrides));
      const registry = createProxyServiceRegistry([service]);
      expectation("exact");

      expect(
        await routeMessageProxyMessage(
          { message: message(), candidateInstances: ["exact"].map((serviceId) => testInstance(serviceId)) },
          { registry },
        ),
      ).toEqual({
        status: "unmatched",
      });
    });
  }

  it("rejects malformed proxy message IDs and reports adapter errors", async () => {
    const malformed = descriptor("malformed", async () => claim("malformed", { proxyMessageId: "other-message" }));
    const failing = descriptor("failing", async () => {
      throw new Error("transport unavailable");
    });

    expect(
      await routeMessageProxyMessage(
        { message: message(), candidateInstances: ["malformed"].map((serviceId) => testInstance(serviceId)) },
        { registry: createProxyServiceRegistry([malformed]) },
      ),
    ).toEqual({ status: "unmatched" });
    expect(
      await routeMessageProxyMessage(
        { message: message(), candidateInstances: ["failing"].map((serviceId) => testInstance(serviceId)) },
        { registry: createProxyServiceRegistry([failing]) },
      ),
    ).toEqual({ status: "timeout_or_error" });
  });

  it("routes two instances of one service without crossing their expectations", async () => {
    const official = testInstance("pluralkit");
    const custom = {
      serviceId: "pluralkit",
      instanceId: "pluralkit:11111111-2222-4333-8444-555555555555",
      origin: "https://example.org",
    };
    createMessageProxyExpectation({
      instance: official,
      channelId: "channel-1",
      originalMessageId: "other-original",
      senderDiscId: "sender-1",
      originalMessage: { id: "other-original" } as Message,
      originalReference: null,
    });
    const expected = createMessageProxyExpectation({
      instance: custom,
      channelId: "channel-1",
      originalMessageId: "original-1",
      senderDiscId: "sender-1",
      originalMessage: { id: "original-1" } as Message,
      originalReference: null,
    });
    const calls: string[] = [];
    const service = descriptor("pluralkit", async (_messageId, instance) => {
      calls.push(instance.instanceId);
      return instance.instanceId === custom.instanceId ? claim("pluralkit", { instanceId: custom.instanceId }) : null;
    });
    const result = await routeMessageProxyMessage(
      { message: message(), candidateInstances: getLiveMessageProxyExpectationInstances("channel-1") },
      { registry: createProxyServiceRegistry([service]) },
    );
    expect(calls).toEqual([official.instanceId, custom.instanceId]);
    expect(result.status).toBe("matched_trigger_only");
    if (result.status === "matched_trigger_only") expect(result.expectation).toBe(expected);
  });

  it("verifies overlapping reposts in one channel independently", async () => {
    const firstExpectation = expectation("overlap");
    const secondExpectation = createMessageProxyExpectation({
      instance: testInstance("overlap"),
      channelId: "channel-1",
      originalMessageId: "original-2",
      senderDiscId: "sender-1",
      originalMessage: { id: "original-2" } as Message,
      originalReference: null,
    });
    let release!: () => void;
    const transportGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const service = descriptor("overlap", async (messageId) => {
      calls.push(messageId);
      await transportGate;
      return claim("overlap", {
        proxyMessageId: messageId,
        originalMessageId: messageId === "proxy-1" ? "original-1" : "original-2",
      });
    });
    const registry = createProxyServiceRegistry([service]);
    const candidateInstances = getLiveMessageProxyExpectationInstances("channel-1");
    const first = routeMessageProxyMessage({ message: message(), candidateInstances }, { registry });
    const second = routeMessageProxyMessage(
      { message: { ...message(), id: "proxy-2" } as Message, candidateInstances },
      { registry },
    );
    const callsWhileFirstWasInFlight = [...calls];
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(callsWhileFirstWasInFlight).toEqual(["proxy-1", "proxy-2"]);
    expect(firstResult.status).toBe("matched_trigger_only");
    expect(secondResult.status).toBe("matched_trigger_only");
    if (firstResult.status === "matched_trigger_only") expect(firstResult.expectation).toBe(firstExpectation);
    if (secondResult.status === "matched_trigger_only") expect(secondResult.expectation).toBe(secondExpectation);
    expect(getMessageProxyRouteMetricsSnapshot().timeout_or_error).toBe(0);
  });

  it("fails closed before transport when one channel has too many candidate instances", async () => {
    let calls = 0;
    const service = descriptor("pluralkit", async () => {
      calls++;
      return null;
    });
    const candidateInstances = Array.from({ length: 5 }, (_, index) => ({
      serviceId: "pluralkit",
      instanceId: `pluralkit:${index}`,
      origin: "https://example.org",
    }));
    expect(
      await routeMessageProxyMessage(
        { message: message(), candidateInstances },
        { registry: createProxyServiceRegistry([service]) },
      ),
    ).toEqual({ status: "timeout_or_error" });
    expect(calls).toBe(0);
  });

  it("rejects an attestation whose instance differs from the lookup target", async () => {
    const service = descriptor("exact", async () => claim("exact", { instanceId: "exact:other" }));
    expectation("exact");
    expect(
      await routeMessageProxyMessage(
        { message: message(), candidateInstances: [testInstance("exact")] },
        { registry: createProxyServiceRegistry([service]) },
      ),
    ).toEqual({ status: "unmatched" });
  });
});
