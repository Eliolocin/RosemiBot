import { describe, expect, it, mock, spyOn } from "bun:test";
import type { Message } from "discord.js";
import { MessageReferenceType } from "discord.js";
import { buildChatTurnContext } from "@/utils/chat/contextPipeline";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import type { ChatTurn } from "@/utils/chat/types";
import { PrivacyLevel } from "@/types/db/schema";
import * as blockCache from "@/utils/cache/personaUserBlockCache";
import * as userCache from "@/utils/cache/userCache";
import * as dbClient from "@/utils/db/client";
import * as contextBuilder from "@/utils/text/contextBuilder";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { createPersona, createUserRow } from "../../helpers/fixtures";

describe("history reply context", () => {
  it("resolves a reply target inside the fetched window without a per-message fetch", async () => {
    const persona = createPersona({
      config: {
        time_awareness_enabled: false,
        personal_memories_enabled: false,
        emoji_usage_enabled: false,
        sticker_usage_enabled: false,
      },
    });
    const fetchById = mock(async (_id: string) => {
      throw new Error("reply target fetched individually");
    });
    const channel = {
      id: "fixture-channel",
      isThread: () => false,
      messages: {
        cache: new Map(),
        fetch: async (options: string | { limit: number }) =>
          typeof options === "string" ? fetchById(options) : new Map(messages.map((message) => [message.id, message])),
      },
    };
    const client = {
      user: { id: "fixture-bot", username: "Tomori" },
      guilds: { cache: new Map() },
      users: { fetch: async (id: string) => ({ id, username: id }) },
    };
    const base = {
      guildId: "fixture-guild",
      channelId: channel.id,
      webhookId: null,
      channel,
      client,
      embeds: [],
      components: [],
      attachments: new Map(),
      stickers: new Map(),
      reactions: { cache: new Map() },
      createdTimestamp: 1700000000000,
      type: 0,
    };
    // The history fetch returns newest first, as Discord does.
    const messages = [
      {
        ...base,
        id: "reply",
        author: { id: "fixture-juno", username: "Juno", bot: false },
        content: "what did you mean?",
        reference: { messageId: "target", channelId: channel.id, type: MessageReferenceType.Default },
      },
      {
        ...base,
        id: "target",
        author: { id: "fixture-mirri", username: "Mirri", bot: false },
        content: "the second option",
        reference: null,
      },
    ] as unknown as Message[];
    const incoming = normalizeChatInvocation({ client: messages[0].client, message: messages[0], isFromQueue: false });
    const turn = {
      persona,
      tomoriState: persona,
      mainPersona: persona,
      allPersonas: [persona],
      userRow: createUserRow(),
      userDiscId: "fixture-juno",
      serverDiscId: "fixture-guild",
      isDMChannel: false,
      guild: null,
      triggeredPersonaIds: [persona.persona_id],
      requestSnapshot: { tomoriState: persona },
      lockedTurn: {
        channelId: channel.id,
        admission: { incoming, client, message: messages[0], channel, locale: "en-US" },
      },
    } as unknown as ChatTurn;
    const sql = spyOn(dbClient, "sql").mockImplementation((async () => []) as unknown as typeof dbClient.sql);
    const read = spyOn(userCache, "getCachedUserRow").mockResolvedValue(null);
    const privacy = spyOn(userCache, "getCachedPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL);
    const blacklist = spyOn(userCache, "getCachedBlacklistStatus").mockResolvedValue(false);
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
      const reply = result.simplifiedMessages.find((message) => message.id === "reply");
      expect(fetchById).not.toHaveBeenCalled();
      expect(reply?.content).toContain("the second option");
      expect(reply?.content).toContain("what did you mean?");
    } finally {
      for (const spy of [sql, read, privacy, blacklist, blocks, builder]) spy.mockRestore();
    }
  });
});
