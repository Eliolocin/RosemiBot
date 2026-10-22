import { describe, expect, it, spyOn } from "bun:test";
import type { Message } from "discord.js";
import { buildChatTurnContext } from "@/utils/chat/contextPipeline";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import type { ChatTurn } from "@/utils/chat/types";
import { PrivacyLevel } from "@/types/db/schema";
import * as blockCache from "@/utils/cache/personaUserBlockCache";
import * as userCache from "@/utils/cache/userCache";
import * as dbClient from "@/utils/db/client";
import * as contextBuilder from "@/utils/text/contextBuilder";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { seedTurnAnchor } from "@/utils/discord/turnAnchor";
import { createPersona, createUserRow } from "../../helpers/fixtures";

const BOT_ID = "fixture-bot";
const PLACEHOLDER_ID = "1300000000000000900";
const HUMAN_ID = "1300000000000000800";

describe("seeded turn anchor in history", () => {
  it("keeps a queued turn's deleted placeholder out of the dialogue history", async () => {
    const persona = createPersona({
      config: {
        time_awareness_enabled: false,
        personal_memories_enabled: false,
        emoji_usage_enabled: false,
        sticker_usage_enabled: false,
      },
    });
    const client = {
      user: { id: BOT_ID, username: "Tomori" },
      guilds: { cache: new Map() },
      users: { fetch: async (id: string) => ({ id, username: id }) },
    } as unknown as Message["client"];
    let sendResult: Message;
    let deleteCount = 0;
    const channel = {
      id: "fixture-channel",
      isThread: () => false,
      send: async () => sendResult,
      messages: {
        cache: new Map(),
        fetch: async () => new Map([[HUMAN_ID, humanMessage]]),
      },
    };
    const base = {
      guildId: "fixture-guild",
      channelId: channel.id,
      channel,
      client,
      webhookId: null,
      embeds: [],
      components: [],
      attachments: new Map(),
      stickers: new Map(),
      reactions: { cache: new Map() },
      createdTimestamp: 1700000000000,
      type: 0,
      reference: null,
    };
    const placeholder = {
      ...base,
      id: PLACEHOLDER_ID,
      author: { id: BOT_ID, username: "Tomori", bot: true },
      content: "\u2800",
      delete: async () => {
        deleteCount += 1;
      },
    } as unknown as Message;
    const humanMessage = {
      ...base,
      id: HUMAN_ID,
      author: { id: "fixture-juno", username: "Juno", bot: false },
      content: "morning",
      delete: async () => {},
    } as unknown as Message;
    sendResult = placeholder;

    const seeded = await seedTurnAnchor(channel as unknown as Parameters<typeof seedTurnAnchor>[0], "fixture reminder");
    if (!seeded) throw new Error("Expected a placeholder to borrow as the trigger");
    expect(deleteCount).toBe(1);

    const incoming = normalizeChatInvocation({
      client,
      message: seeded,
      isFromQueue: true,
      isManuallyTriggered: true,
      textQuotaSource: "system",
    });
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
        admission: { incoming, client, message: seeded, channel, locale: "en-US" },
      },
    } as unknown as ChatTurn;

    const spies = [
      spyOn(dbClient, "sql").mockImplementation((async () => []) as unknown as typeof dbClient.sql),
      spyOn(userCache, "getCachedUserRow").mockResolvedValue(null),
      spyOn(userCache, "getCachedPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL),
      spyOn(userCache, "getCachedBlacklistStatus").mockResolvedValue(false),
      spyOn(blockCache, "getCachedActiveBlocksForPersona").mockResolvedValue([]),
      spyOn(naturalNudgeRepository, "loadAgendas").mockResolvedValue(new Map()),
      spyOn(contextBuilder, "buildContext").mockResolvedValue({
        contextItems: [],
        tailDirectives: [],
        lowerPriorityTailDirectives: [],
        nudgeInjectionDepth: 0,
        messageIdMap: new MessageIdMap(),
      }),
    ];
    try {
      const result = await buildChatTurnContext(turn);
      expect(result.simplifiedMessages.map((message) => message.id)).toContain(HUMAN_ID);
      expect(result.simplifiedMessages.some((message) => message.id === seeded.id)).toBeFalse();
      expect(result.simplifiedMessages.some((message) => message.content?.includes("\u2800"))).toBeFalse();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
