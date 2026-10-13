import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Collection, type Message, MessageType } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import * as realUserCache from "@/utils/cache/userCache";
import {
  ensureMessageProxyMessageIdentity,
  type MessageProxyHistoryAttributionDependencies,
  type MessageProxyHistoryIdentity,
} from "@/utils/messageProxy/historyAttribution";
import type { MessageProxyIndexedMessageIdentity } from "@/utils/messageProxy/types";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { createScopedModuleMocker } from "../../helpers/mockSurface";

/**
 * Reply annotations name an author outside the dialogue-history label path, so a verified proxy
 * author has to be recovered from its indexed attribution rather than from the webhook name.
 * These cases pin that recovery, including the bounded index read used when the referenced
 * message sits outside the fetched history window.
 */

const MEMBER_UUID = "11111111-2222-4333-8444-555555555555";
const MEMBER_USER_DISC_ID = `pk:${MEMBER_UUID}`;

/** Saved TomoriBot nicknames the mocked user cache answers with, keyed by Discord ID. */
const savedNicknames = new Map<string, string>();

const cacheMocker = createScopedModuleMocker(mock, {
  "@/utils/cache/userCache": realUserCache,
});

cacheMocker.module("@/utils/cache/userCache", () => ({
  ...realUserCache,
  getCachedUserRow: async (userDiscId: string) => {
    const nickname = savedNicknames.get(userDiscId);
    if (!nickname) return null;
    return { user_disc_id: userDiscId, user_nickname: nickname } as unknown as UserRow;
  },
  // This lane has no migrated schema, so the real lookup fails closed to "blacklisted" and would
  // replace every saved nickname with the Discord display name. Naming is what these cases pin.
  getCachedBlacklistStatus: async () => false,
}));

let buildReplyReferenceContextAnnotation: typeof import("@/utils/chat/contextAnnotations").buildReplyReferenceContextAnnotation;

beforeAll(async () => {
  ({ buildReplyReferenceContextAnnotation } = await import("@/utils/chat/contextAnnotations"));
});

beforeEach(() => {
  savedNicknames.clear();
});

function webhookMessage(params: { id: string; webhookName: string; content?: string }): Message {
  return {
    id: params.id,
    webhookId: `webhook-${params.id}`,
    author: { id: `webhook-user-${params.id}`, username: params.webhookName },
    member: null,
    content: params.content ?? "field notes",
    attachments: new Collection(),
    type: MessageType.Default,
  } as unknown as Message;
}

function humanMessage(params: { id: string; authorId?: string; displayName: string }): Message {
  return {
    id: params.id,
    webhookId: null,
    author: { id: params.authorId ?? `human-${params.id}`, username: params.displayName.toLowerCase() },
    member: { displayName: params.displayName },
    content: "morning",
    attachments: new Collection(),
    type: MessageType.Default,
  } as unknown as Message;
}

function proxyIdentity(displayName: string): MessageProxyHistoryIdentity {
  return {
    serviceId: "pluralkit",
    userDiscId: MEMBER_USER_DISC_ID,
    displayName,
    senderDiscId: "host-1",
  };
}

function indexedIdentity(messageDiscId: string, displayName: string): MessageProxyIndexedMessageIdentity {
  return {
    serviceId: "pluralkit",
    instanceId: "pluralkit:official",
    userDiscId: MEMBER_USER_DISC_ID,
    externalIdentityId: 1,
    externalKey: MEMBER_UUID,
    identityShortId: "Mirri",
    displayName,
    namespaceId: 2,
    namespaceKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    namespaceShortId: "light",
    namespaceDisplayName: "Lighthouse",
    namespaceTag: "[light]",
    namespaceDescription: null,
    hostUserDiscIds: ["host-1"],
    messageDiscId,
    senderDiscId: "host-1",
  };
}

function annotate(params: {
  reply: Message;
  referenced: Message;
  identities?: Map<string, MessageProxyHistoryIdentity>;
}): Promise<string> {
  return buildReplyReferenceContextAnnotation({
    replyMessage: params.reply,
    referencedMessage: params.referenced,
    clientUserId: "bot-1",
    botDisplayName: "Tomori",
    personaByNickname: new Map(),
    serverDiscId: "guild-1",
    serverPersonalizationDisabled: false,
    messageIdMap: new MessageIdMap(),
    messageProxyIdentitiesByMessageId: params.identities,
  });
}

describe("reply reference annotations for verified proxy messages", () => {
  it("names the member instead of a webhook name carrying the system tag", async () => {
    const identities = new Map([["proxied", proxyIdentity("Mirri")]]);

    const annotation = await annotate({
      reply: webhookMessage({ id: "proxied", webhookName: "Mirri [light]", content: "the tag is not my name" }),
      referenced: humanMessage({ id: "human-1", displayName: "Mirri" }),
      identities,
    });

    expect(annotation).toContain("by Mirri is referring");
    expect(annotation).not.toContain("[light]");
  });

  it("prefers the saved TomoriBot nickname over the stored member name", async () => {
    savedNicknames.set(MEMBER_USER_DISC_ID, "Birdy");
    const identities = new Map([["proxied", proxyIdentity("Mirri")]]);

    const annotation = await annotate({
      reply: humanMessage({ id: "human-1", displayName: "Mirri" }),
      referenced: webhookMessage({ id: "proxied", webhookName: "Mirri [light]" }),
      identities,
    });

    expect(annotation).toContain("by Birdy saying");
  });

  it("uses the refreshed member name when the webhook still carries the old one", async () => {
    const identities = new Map([["proxied", proxyIdentity("Mirri Updated")]]);

    const annotation = await annotate({
      reply: webhookMessage({ id: "proxied", webhookName: "Mirri", content: "renamed last week" }),
      referenced: humanMessage({ id: "human-1", displayName: "Mirri" }),
      identities,
    });

    expect(annotation).toContain("by Mirri Updated is referring");
  });

  it("names a referenced message the history window excluded through its indexed attribution", async () => {
    const dependencies: MessageProxyHistoryAttributionDependencies = {
      getMessageRecord: () => null,
      getDescriptor: () => null,
      loadMessageIdentities: async (ids) => new Map(ids.map((id) => [id, indexedIdentity(id, "Mirri")] as const)),
    };
    const identities = new Map<string, MessageProxyHistoryIdentity>();
    const referenced = webhookMessage({ id: "older", webhookName: "Mirri [light]" });
    await ensureMessageProxyMessageIdentity(referenced, identities, dependencies);

    const annotation = await annotate({
      reply: humanMessage({ id: "human-1", displayName: "Mirri" }),
      referenced,
      identities,
    });

    expect(annotation).toMatch(/previous message \(ID: ref_\d+\) by Mirri saying/);
  });

  it("keeps the webhook presentation for an unverified webhook", async () => {
    const annotation = await annotate({
      reply: humanMessage({ id: "human-1", displayName: "Mirri" }),
      referenced: webhookMessage({ id: "unverified", webhookName: "Mirri [light]" }),
      identities: new Map(),
    });

    expect(annotation).toContain("by Mirri [light] saying");
  });

  it("leaves an annotated human author on the saved nickname path", async () => {
    savedNicknames.set("human-9", "Mirri");
    const identities = new Map([["proxied", proxyIdentity("Mirri")]]);

    const annotation = await annotate({
      reply: humanMessage({ id: "message-9", authorId: "human-9", displayName: "Mirri Live" }),
      referenced: webhookMessage({ id: "proxied", webhookName: "Mirri [light]" }),
      identities,
    });

    expect(annotation).toContain("by Mirri is referring");
    expect(annotation).toContain("by Mirri saying");
  });
});
