import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Message } from "discord.js";
import { buildReplyReferenceContextAnnotation } from "@/utils/chat/contextAnnotations";
import { cacheUserImpersonationWebhook, clearWebhookIdentityCache } from "@/utils/chat/webhookIdentity";
import * as userCache from "@/utils/cache/userCache";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { collectPersonaNameAliases } from "@/utils/discord/stream/textConfig";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { cleanLLMOutput } from "@/utils/text/processors/llmOutputProcessor";
import { createPersona, createUserRow } from "../../helpers/fixtures";

const IMPERSONATED_USER_ID = "fixture-impersonated";

function replyingUserMessage(): Message {
  return {
    id: "reply-message",
    type: 19,
    content: "ehhh",
    attachments: new Map(),
    embeds: [],
    author: { id: IMPERSONATED_USER_ID, username: "quasont", bot: false },
    member: null,
  } as unknown as Message;
}

function impersonationWebhookMessage(): Message {
  return {
    id: "webhook-message",
    type: 0,
    content: "hello",
    attachments: new Map(),
    embeds: [],
    guildId: "fixture-guild",
    channelId: "fixture-channel",
    webhookId: "temp-hook",
    channel: { id: "fixture-channel", isThread: () => false },
    author: { id: "temp-hook", username: "bured", bot: true },
    member: null,
  } as unknown as Message;
}

describe("user impersonation naming", () => {
  beforeEach(() => {
    clearWebhookIdentityCache();
    cacheUserImpersonationWebhook("temp-hook", IMPERSONATED_USER_ID, "fixture-guild", "fixture-channel");
    spyOn(serverRepository, "loadManagedWebhookByChannelAndWebhookId").mockResolvedValue(null);
    spyOn(userCache, "getCachedBlacklistStatus").mockResolvedValue(false);
    spyOn(userCache, "getCachedUserRow").mockImplementation(async (id: string) =>
      id === IMPERSONATED_USER_ID ? createUserRow({ user_nickname: "Quasont" }) : null,
    );
  });
  afterEach(() => {
    clearWebhookIdentityCache();
    spyOn(serverRepository, "loadManagedWebhookByChannelAndWebhookId").mockRestore();
    spyOn(userCache, "getCachedBlacklistStatus").mockRestore();
    spyOn(userCache, "getCachedUserRow").mockRestore();
  });

  it("names an impersonation webhook's speaker by their saved nickname, not the webhook's Discord name", async () => {
    const annotation = await buildReplyReferenceContextAnnotation({
      replyMessage: replyingUserMessage(),
      referencedMessage: impersonationWebhookMessage(),
      clientUserId: "fixture-bot",
      botDisplayName: "Tomori",
      personaByNickname: new Map([["tomori", createPersona()]]),
      serverDiscId: "fixture-guild",
      serverPersonalizationDisabled: false,
      messageIdMap: new MessageIdMap(),
    });
    expect(annotation).toContain("by Quasont is referring");
    expect(annotation).toContain("previous message (ID: ref_2) by Quasont saying");
    expect(annotation).not.toContain("bured");
  });

  it("strips an opening label that is the nickname even when the webhook is named after the Discord name", () => {
    const aliases = collectPersonaNameAliases(createPersona(), "bured", "Quasont");
    expect(aliases).toContain("Quasont");
    expect(cleanLLMOutput("Quasont: ehhh", "bured", [], true, undefined, undefined, undefined, aliases)).toBe("ehhh");
  });

  it("does not repeat the webhook name as an alias", () => {
    expect(collectPersonaNameAliases(createPersona(), "bured", "BURED")).not.toContain("BURED");
  });
});
