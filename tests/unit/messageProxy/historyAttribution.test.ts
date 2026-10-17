import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Message } from "discord.js";
import {
  ensureMessageProxyMessageIdentity,
  resolveCachedMessageProxyIdentity,
  resolveMessageProxyMessageIdentitiesForHistory,
  type MessageProxyHistoryAttributionDependencies,
  type MessageProxyHistoryIdentity,
} from "@/utils/messageProxy/historyAttribution";
import { clearNegativeMessageProxyMessageIdentityCacheForTests } from "@/utils/messageProxy/messageIdentityNegativeCache";
import { pluralBuddyProxyService } from "@/utils/messageProxy/services/pluralbuddy/descriptor";
import type { MessageProxyMessageRecord } from "@/utils/messageProxy/proxyExpectation";
import type {
  MessageProxyIndexedMessageIdentity,
  ProxyMessageAttestation,
  ProxyServiceDescriptor,
} from "@/utils/messageProxy/types";

const MEMBER_UUID = "11111111-2222-4333-8444-555555555555";

function message(id: string, webhookId: string | null = "webhook-1"): Message {
  return {
    id,
    webhookId,
    author: { username: `Webhook ${id}` },
  } as Message;
}

function attestation(proxyMessageId: string): ProxyMessageAttestation {
  return {
    serviceId: "pluralkit",
    instanceId: "pluralkit:official",
    proxyMessageId,
    originalMessageId: "original-1",
    senderDiscordId: "host-1",
    identity: {
      serviceId: "pluralkit",
      externalIdentityKind: "pluralkit_member",
      externalKey: MEMBER_UUID,
      shortId: "Mirri",
      displayName: "Mirri",
      bio: null,
      namespace: {
        namespaceKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        shortId: "light",
        displayName: "Lighthouse",
        tag: null,
        description: null,
      },
    },
  };
}

function indexedIdentity(messageDiscId: string): MessageProxyIndexedMessageIdentity {
  return {
    serviceId: "pluralkit",
    instanceId: "pluralkit:official",
    userDiscId: `pk:${MEMBER_UUID}`,
    externalIdentityId: 1,
    externalKey: MEMBER_UUID,
    identityShortId: "Mirri",
    displayName: "Mirri from DB",
    namespaceId: 2,
    namespaceKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    namespaceShortId: "light",
    namespaceDisplayName: "Lighthouse",
    namespaceTag: null,
    namespaceDescription: null,
    hostUserDiscIds: ["host-1"],
    messageDiscId,
    senderDiscId: "host-2",
  };
}

afterEach(clearNegativeMessageProxyMessageIdentityCacheForTests);

describe("message-proxy history attribution", () => {
  it("uses the verified webhook member name when PluralBuddy omits it from the API", async () => {
    const proxyMessage = message("pluralbuddy-repost");
    proxyMessage.author.username = "Mirri [LH]";
    const cachedAttestation: ProxyMessageAttestation = {
      serviceId: "pluralbuddy",
      instanceId: "pluralbuddy:official",
      proxyMessageId: proxyMessage.id,
      originalMessageId: null,
      senderDiscordId: "host-1",
      identity: {
        serviceId: "pluralbuddy",
        externalIdentityKind: "pluralbuddy_alter",
        externalKey: "42",
        shortId: "42",
        displayName: null,
        bio: null,
        namespace: { namespaceKey: "host-1", shortId: null, displayName: null, tag: null, description: null },
      },
    };
    const record: MessageProxyMessageRecord = {
      serviceId: "pluralbuddy",
      instanceId: "pluralbuddy:official",
      instance: { serviceId: "pluralbuddy", instanceId: "pluralbuddy:official", origin: "https://pluralbuddy.app" },
      messageDiscId: proxyMessage.id,
      channelId: "channel-1",
      originalMessageId: null,
      senderDiscId: "host-1",
      createdAt: 1,
      expiresAt: 2,
      originalMessage: null,
      originalReference: null,
      identityUserDiscId: "pb:42",
      originalSuppressed: true,
    };
    const dependencies: MessageProxyHistoryAttributionDependencies = {
      getMessageRecord: () => record,
      getDescriptor: () => ({ ...pluralBuddyProxyService, getCachedAttestation: () => cachedAttestation }),
      loadMessageIdentities: mock(async () => new Map()),
    };

    expect(resolveCachedMessageProxyIdentity(proxyMessage, dependencies)).toMatchObject({
      userDiscId: "pb:42",
      displayName: "Mirri [LH]",
    });
    expect(
      (await resolveMessageProxyMessageIdentitiesForHistory([proxyMessage], dependencies)).get(proxyMessage.id),
    ).toMatchObject({ displayName: "Mirri [LH]" });
    expect(dependencies.loadMessageIdentities).not.toHaveBeenCalled();
  });

  it("uses cached attribution first and batches every remaining webhook into one DB read", async () => {
    const attestMessage = mock(async () => null);
    const descriptor = {
      serviceId: "pluralkit",
      settingsLocaleKey: "pluralkit_option",
      enabledSuccessDescriptionLocaleKey: "commands.personal.message-proxy.pluralkit_enabled_success_description",
      syntheticUserPrefix: "pk:",
      externalIdentityKind: "pluralkit_member",
      validateExternalKey: () => true,
      capabilities: {
        correlation: "attested",
        identity: "stable",
        identityBio: "inline",
        namespaceBio: "inline",
      },
      presentation: {
        identityMembershipLine: () => "membership",
        namespacePresentation: () => ({ sectionHeading: "Namespaces", entry: "- Namespace" }),
      },
      attestMessage,
      getCachedAttestation: (messageDiscId: string) => (messageDiscId === "cached" ? attestation(messageDiscId) : null),
    } as const satisfies ProxyServiceDescriptor<"pluralkit">;
    const loadMessageIdentities = mock(
      async (ids: string[]) => new Map(ids.includes("db") ? [["db", indexedIdentity("db")]] : []),
    );
    const dependencies: MessageProxyHistoryAttributionDependencies = {
      getMessageRecord: (id) =>
        id === "cached"
          ? ({ serviceId: "pluralkit" } as ReturnType<MessageProxyHistoryAttributionDependencies["getMessageRecord"]>)
          : null,
      getDescriptor: () => descriptor,
      loadMessageIdentities,
    };

    const resolved = await resolveMessageProxyMessageIdentitiesForHistory(
      [message("cached"), message("db"), message("miss"), message("human", null)],
      dependencies,
    );

    expect(attestMessage).not.toHaveBeenCalled();
    expect(loadMessageIdentities).toHaveBeenCalledTimes(1);
    expect(loadMessageIdentities).toHaveBeenCalledWith(["db", "miss"]);
    expect(resolved.get("cached")).toMatchObject({ userDiscId: `pk:${MEMBER_UUID}`, senderDiscId: "host-1" });
    expect(resolved.get("db")).toMatchObject({ displayName: "Mirri from DB", senderDiscId: "host-2" });
    expect(resolved.has("miss")).toBe(false);
  });

  it("does not repeat DB reads for a confirmed miss", async () => {
    const loadMessageIdentities = mock(async () => new Map<string, MessageProxyIndexedMessageIdentity>());
    const dependencies: MessageProxyHistoryAttributionDependencies = {
      getMessageRecord: () => null,
      getDescriptor: () => null,
      loadMessageIdentities,
    };

    await resolveMessageProxyMessageIdentitiesForHistory([message("miss")], dependencies);
    await resolveMessageProxyMessageIdentitiesForHistory([message("miss")], dependencies);

    expect(loadMessageIdentities).toHaveBeenCalledTimes(1);
  });
});

describe("message-proxy single-message attribution", () => {
  function indexedDependencies(
    loadMessageIdentities: MessageProxyHistoryAttributionDependencies["loadMessageIdentities"],
  ): MessageProxyHistoryAttributionDependencies {
    return { getMessageRecord: () => null, getDescriptor: () => null, loadMessageIdentities };
  }

  it("resolves a message outside the history window and merges it into the caller's map", async () => {
    const loadMessageIdentities = mock(
      async (ids: string[]) => new Map(ids.map((id) => [id, indexedIdentity(id)] as const)),
    );
    const identities = new Map<string, MessageProxyHistoryIdentity>();

    await ensureMessageProxyMessageIdentity(message("older"), identities, indexedDependencies(loadMessageIdentities));

    expect(loadMessageIdentities).toHaveBeenCalledTimes(1);
    expect(loadMessageIdentities).toHaveBeenCalledWith(["older"]);
    expect(identities.get("older")).toMatchObject({
      userDiscId: `pk:${MEMBER_UUID}`,
      displayName: "Mirri from DB",
      senderDiscId: "host-2",
    });
  });

  it("skips the index read for an attributed message and for a non-webhook message", async () => {
    const loadMessageIdentities = mock(async () => new Map<string, MessageProxyIndexedMessageIdentity>());
    const dependencies = indexedDependencies(loadMessageIdentities);
    const identities = new Map<string, MessageProxyHistoryIdentity>([
      ["known", { serviceId: "pluralkit", userDiscId: `pk:${MEMBER_UUID}`, displayName: "Mirri", senderDiscId: "h" }],
    ]);

    await ensureMessageProxyMessageIdentity(message("known"), identities, dependencies);
    await ensureMessageProxyMessageIdentity(message("human", null), identities, dependencies);

    expect(loadMessageIdentities).not.toHaveBeenCalled();
  });

  it("does not re-read an unindexed webhook message within the negative-cache window", async () => {
    const fresh = new Map<string, MessageProxyHistoryIdentity>();
    await ensureMessageProxyMessageIdentity(
      message("unverified"),
      fresh,
      indexedDependencies(mock(async () => new Map<string, MessageProxyIndexedMessageIdentity>())),
    );

    const loadMessageIdentities = mock(async () => new Map<string, MessageProxyIndexedMessageIdentity>());
    await ensureMessageProxyMessageIdentity(message("unverified"), fresh, indexedDependencies(loadMessageIdentities));

    expect(loadMessageIdentities).not.toHaveBeenCalled();
  });
});
