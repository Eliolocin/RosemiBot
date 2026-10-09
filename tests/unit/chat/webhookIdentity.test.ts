import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Message } from "discord.js";
import { ChannelType } from "discord.js";
import {
  resolvePersonaForMessage,
  resolveReferencedWebhookTarget,
  verifyMessageWebhook,
  clearWebhookIdentityCache,
  cacheUserImpersonationWebhook,
} from "@/utils/chat/webhookIdentity";
import { isSelfTriggerMessage, isMatrixRelayMessage } from "@/utils/chat/triggerProcessor";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { evaluateChatAdmission, normalizeChatInvocation } from "@/utils/chat/admission";
import { getSelfReplyChainState, setSelfReplyChainOriginUser } from "@/utils/chat/selfReplyState";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import * as stateCache from "@/utils/cache/tomoriStateCache";
import * as userCache from "@/utils/cache/userCache";
import { PrivacyLevel } from "@/types/db/schema";
import { resolveContextAuthorLabel } from "@/utils/discord/contextAuthorLabel";
import { buildChatTurnContext } from "@/utils/chat/contextPipeline";
import type { ChatTurn } from "@/utils/chat/types";
import * as contextBuilder from "@/utils/text/contextBuilder";
import * as dbClient from "@/utils/db/client";
import * as blockCache from "@/utils/cache/personaUserBlockCache";
import { MessageIdMap } from "@/utils/text/messageIdMap";

function webhookMessage(username: string, webhookId = "managed-hook"): Message {
  return {
    id: "fixture-message",
    guildId: "fixture-guild",
    channelId: "fixture-channel",
    webhookId,
    channel: { id: "fixture-channel", isThread: () => false },
    client: { user: { id: "fixture-bot" } },
    author: { id: webhookId, username, bot: true },
    content: "hello",
    reference: null,
  } as unknown as Message;
}

const main = createPersona({ persona_nickname: "Tomori" });
const alter = createPersona({ persona_id: 2, persona_nickname: "Mirri", is_alter: true });
const personas = [main, alter];
const names = new Map([["mirri", alter]]);

describe("verified managed webhook identity", () => {
  let lookup: ReturnType<typeof spyOn<typeof serverRepository, "loadManagedWebhookByChannelAndWebhookId">>;
  beforeEach(() => {
    clearWebhookIdentityCache();
    lookup = spyOn(serverRepository, "loadManagedWebhookByChannelAndWebhookId").mockImplementation(
      async (channelId, webhookId) =>
        webhookId === "managed-hook"
          ? {
              managed_webhook_id: 1,
              guild_disc_id: "fixture-guild",
              channel_disc_id: channelId,
              webhook_disc_id: webhookId,
              kind: "shared_channel",
              webhook_token: Buffer.from("fixture"),
              key_version: 1,
            }
          : null,
    );
  });
  afterEach(() => {
    lookup.mockRestore();
    clearWebhookIdentityCache();
  });

  it("keeps direct bot output and copied render names bound to their source persona", async () => {
    const direct = { ...webhookMessage("Tomori"), webhookId: null, author: { id: "fixture-bot" } } as Message;
    expect(resolvePersonaForMessage(direct, personas, "fixture-bot")).toBe(main);
    const message = webhookMessage("Mirri (Juno)");
    await verifyMessageWebhook(message);
    expect(resolvePersonaForMessage(message, personas, "fixture-bot")).toBe(alter);
    expect(resolveReferencedWebhookTarget(message, names, null).replyPersona).toBe(alter);
    expect(isSelfTriggerMessage(message, personas)).toBe(true);
  });

  it("rejects foreign same-name and Matrix-looking webhooks and lookup failures", async () => {
    for (const username of ["Mirri", "Mirri (Juno)", "[Matrix|@mirri:example.org] Mirri"]) {
      const message = webhookMessage(username, "foreign-hook");
      await verifyMessageWebhook(message);
      expect(resolvePersonaForMessage(message, personas, "fixture-bot")).toBeNull();
      expect(resolveReferencedWebhookTarget(message, names, null).replyPersona).toBeNull();
      expect(isSelfTriggerMessage(message, personas)).toBe(false);
      expect(isMatrixRelayMessage(message)).toBe(false);
    }
    lookup.mockRejectedValue(new Error("lookup unavailable"));
    const message = webhookMessage("Mirri");
    expect(await verifyMessageWebhook(message)).toBe(false);
    expect(isSelfTriggerMessage(message, personas)).toBe(false);
  });

  it("keeps Matrix relays and trusted user impersonation while checking guild/channel binding", async () => {
    const matrix = webhookMessage("[Matrix|@mirri:example.org] Mirri");
    await verifyMessageWebhook(matrix);
    expect(isMatrixRelayMessage(matrix)).toBe(true);
    expect(resolvePersonaForMessage(matrix, personas, "fixture-bot")).toBeNull();
    cacheUserImpersonationWebhook("managed-hook", "fixture-user");
    const impersonated = webhookMessage("Juno");
    await verifyMessageWebhook(impersonated);
    expect(resolveReferencedWebhookTarget(impersonated, names, null).impersonatedUserId).toBe("fixture-user");
    const foreignGuild = { ...webhookMessage("Mirri"), guildId: "another-guild" } as Message;
    expect(await verifyMessageWebhook(foreignGuild)).toBe(false);
    expect(resolveReferencedWebhookTarget(foreignGuild, names, null).impersonatedUserId).toBeNull();
    const threaded = {
      ...webhookMessage("Mirri"),
      channel: { isThread: () => true, parentId: "fixture-parent" },
    } as unknown as Message;
    await verifyMessageWebhook(threaded);
    expect(lookup).toHaveBeenCalledWith("fixture-parent", "managed-hook");
    expect(isSelfTriggerMessage(threaded, personas)).toBe(true);
  });

  it("does not assign persona jobs, propagate origin users, or reset cascade counters for foreign webhooks", async () => {
    const message = webhookMessage("Mirri", "foreign-hook");
    setSelfReplyChainOriginUser(message.channelId, "fixture-origin");
    getSelfReplyChainState(message.channelId).triggerCount = 2;
    const incoming = normalizeChatInvocation({ client: message.client, message, isFromQueue: false });
    const admission = await evaluateChatAdmission(incoming);
    expect(admission.disposition).toBe("ignore");
    expect(incoming.isPersonaJob).toBe(false);
    expect(getSelfReplyChainState(message.channelId).originUserDiscId).toBe("fixture-origin");
    expect(getSelfReplyChainState(message.channelId).triggerCount).toBe(2);
  });

  it("keeps managed cascades bound to the originating user's metering identity", async () => {
    const message = webhookMessage("Mirri");
    Object.assign(message.channel, { type: ChannelType.PublicThread });
    Object.assign(message, { guild: { id: message.guildId, members: { me: null } } });
    const read = spyOn(stateCache, "getCachedAllPersonas").mockResolvedValue(personas);
    const privacy = spyOn(userCache, "getCachedPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL);
    const blacklist = spyOn(userCache, "getCachedBlacklistStatus").mockResolvedValue(false);
    setSelfReplyChainOriginUser(message.channelId, "fixture-origin");
    getSelfReplyChainState(message.channelId).triggerCount = 2;
    try {
      const incoming = normalizeChatInvocation({ client: message.client, message, skipLock: true, isFromQueue: false });
      const admission = await evaluateChatAdmission(incoming);
      expect(admission.disposition).toBe("run");
      expect(incoming.isPersonaJob).toBe(true);
      if (admission.disposition !== "run") throw new Error("Expected managed cascade admission");
      expect(admission.userDiscId).toBe("fixture-origin");
      expect(admission.cooldownUserDiscId).toBe("fixture-origin");
      expect(getSelfReplyChainState(message.channelId).triggerCount).toBe(2);
    } finally {
      read.mockRestore();
      privacy.mockRestore();
      blacklist.mockRestore();
    }
  });

  it("does not resolve a foreign context author through the persona roster", async () => {
    const read = spyOn(stateCache, "getCachedAllPersonas").mockResolvedValue(personas);
    try {
      const foreign = webhookMessage("[Matrix|@mirri:example.org] Mirri", "foreign-hook");
      expect(await resolveContextAuthorLabel(foreign)).toBe(foreign.author.username);
      expect(read).not.toHaveBeenCalled();
      const trusted = webhookMessage("Mirri (Juno)");
      expect(await resolveContextAuthorLabel(trusted)).toBe(trusted.author.username);
      expect(read).toHaveBeenCalledWith(trusted.guildId);
    } finally {
      read.mockRestore();
    }
  });

  it("keeps foreign persona names and debug prefixes out of assembled persona history", async () => {
    const persona = createPersona({
      config: {
        time_awareness_enabled: false,
        personal_memories_enabled: false,
        emoji_usage_enabled: false,
        sticker_usage_enabled: false,
      },
    });
    const channel = {
      id: "fixture-channel",
      isThread: () => false,
      messages: { fetch: async () => new Map(messages.map((message) => [message.id, message])) },
    };
    const client = {
      user: { id: "fixture-bot", username: "Tomori" },
      guilds: { cache: new Map() },
      users: { fetch: async (id: string) => ({ id, username: id }) },
    };
    const messages = [
      { ...webhookMessage("Mirri", "foreign-hook"), id: "foreign", content: "$: copied", channel, client },
      { ...webhookMessage("Mirri (Juno)"), id: "managed", channel, client },
    ].map((message) => ({
      ...message,
      embeds: [],
      components: [],
      attachments: new Map(),
      stickers: new Map(),
      reactions: { cache: new Map() },
      createdTimestamp: 1700000000000,
      type: 0,
    })) as unknown as Message[];
    const incoming = normalizeChatInvocation({ client: messages[0].client, message: messages[0], isFromQueue: false });
    const turn = {
      persona,
      tomoriState: persona,
      mainPersona: persona,
      allPersonas: [persona, alter],
      userRow: createUserRow(),
      userDiscId: "fixture-user",
      serverDiscId: "fixture-guild",
      isDMChannel: false,
      guild: null,
      triggeredPersonaIds: [persona.persona_id],
      requestSnapshot: { tomoriState: persona },
      lockedTurn: {
        channelId: channel.id,
        admission: {
          incoming,
          client: messages[0].client,
          message: messages[0],
          channel: messages[0].channel,
          locale: "en-US",
        },
      },
    } as unknown as ChatTurn;
    const sql = spyOn(dbClient, "sql").mockImplementation((async () => []) as unknown as typeof dbClient.sql);
    const read = spyOn(userCache, "getCachedUserRow").mockResolvedValue(null);
    const privacy = spyOn(userCache, "getCachedPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL);
    const blocks = spyOn(blockCache, "getCachedActiveBlocksForPersona").mockResolvedValue([]);
    const builder = spyOn(contextBuilder, "buildContext").mockResolvedValue({
      contextItems: [],
      tailDirectives: [],
      lowerPriorityTailDirectives: [],
      nudgeInjectionDepth: 0,
      messageIdMap: new MessageIdMap(),
    });
    try {
      const result = await buildChatTurnContext(turn);
      const foreign = result.simplifiedMessages.find((message) => message.id === "foreign");
      const managed = result.simplifiedMessages.find((message) => message.id === "managed");
      expect(foreign?.authorType).toBe("user");
      expect(foreign?.authorPersonaId).toBeNull();
      expect(foreign?.content).toContain("$:");
      expect(managed?.authorType).toBe("persona");
      expect(managed?.authorPersonaId).toBe(alter.persona_id);
    } finally {
      for (const spy of [sql, read, privacy, blocks, builder]) spy.mockRestore();
    }
  });
});
