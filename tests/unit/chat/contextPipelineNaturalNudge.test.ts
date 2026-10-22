import { describe, expect, it, spyOn } from "bun:test";
import type { Message } from "discord.js";
import { buildChatTurnContext, resolveTurnDeliberateToolMode } from "@/utils/chat/contextPipeline";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import type { ChatTurn, ChatTurnContext, NaturalNudgeTurn } from "@/utils/chat/types";
import { PrivacyLevel } from "@/types/db/schema";
import * as blockCache from "@/utils/cache/personaUserBlockCache";
import * as userCache from "@/utils/cache/userCache";
import * as reunionPresence from "@/utils/chat/reunionPresence";
import * as dbClient from "@/utils/db/client";
import * as contextBuilder from "@/utils/text/contextBuilder";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { createPersona, createUserRow } from "../../helpers/fixtures";

const BOT_ID = "fixture-bot";

async function buildTurnContext(naturalNudge: NaturalNudgeTurn | undefined): Promise<{
  context: ChatTurnContext;
  reunionCalls: number;
}> {
  const persona = createPersona({
    persona_nickname: "Tomori",
    config: {
      deliberate_tool_mode: true,
      time_awareness_enabled: true,
      personal_memories_enabled: false,
      emoji_usage_enabled: false,
      sticker_usage_enabled: false,
    },
  });
  const channel = {
    id: "fixture-channel",
    isThread: () => false,
    messages: {
      cache: new Map(),
      fetch: async () => new Map(messages.map((message) => [message.id, message])),
    },
  };
  const client = {
    user: { id: BOT_ID, username: "Tomori" },
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
    reference: null,
  };
  // Newest first, as Discord returns history; the persona spoke last before the lull.
  const messages = [
    { ...base, id: "persona-last", author: { id: BOT_ID, username: "Tomori", bot: true }, content: "see you later" },
    { ...base, id: "human", author: { id: "fixture-juno", username: "Juno", bot: false }, content: "bye" },
  ] as unknown as Message[];
  const incoming = normalizeChatInvocation({
    client: messages[0].client,
    message: messages[0],
    isFromQueue: false,
    isManuallyTriggered: true,
    naturalNudge,
  });
  const turn = {
    persona,
    tomoriState: persona,
    mainPersona: persona,
    allPersonas: [persona],
    userRow: createUserRow({ personal_deliberate_tool_mode: "follow" }),
    userDiscId: BOT_ID,
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
  const reunion = spyOn(reunionPresence, "resolveReunionNote").mockResolvedValue({ note: null, presence: null });
  try {
    return { context: await buildChatTurnContext(turn), reunionCalls: reunion.mock.calls.length };
  } finally {
    for (const spy of [...spies, reunion]) spy.mockRestore();
  }
}

const CONTINUE_DIRECTIVE = "Continue your last message without repeating it";

describe("Natural Nudges turn context", () => {
  it("admits the idle nudge's tools under Deliberate Tool Mode", async () => {
    const { context } = await buildTurnContext({ toolNames: ["web_search"] });
    expect(context.streamingContext.disableAllTools).not.toBe(true);
    expect(context.streamingContext.deliberateToolAllowedNames).toContain("web_search");
  });

  it("skips the trigger author's reunion and the continuation directive", async () => {
    const manual = await buildTurnContext(undefined);
    expect(manual.reunionCalls).toBe(1);
    expect(JSON.stringify(manual.context.contextItems)).toContain(CONTINUE_DIRECTIVE);

    const nudge = await buildTurnContext({ toolNames: [] });
    expect(nudge.reunionCalls).toBe(0);
    expect(JSON.stringify(nudge.context.contextItems)).not.toContain(CONTINUE_DIRECTIVE);
  });

  it("lets a Ping User nudge ping only its target, and leaves other nudges unrestricted", async () => {
    const pingUser = await buildTurnContext({ toolNames: [], targetUserDiscId: "fixture-mirri" });
    expect(pingUser.context.streamingContext.mentionableUserIds).toEqual(["fixture-mirri"]);
    expect(pingUser.context.streamingContext.forcedMentions?.map((mention) => mention.userId)).toContain(
      "fixture-mirri",
    );

    const plainNudge = await buildTurnContext({ toolNames: [] });
    expect(plainNudge.context.streamingContext.mentionableUserIds).toBeUndefined();
  });
});

describe("borrowed-trigger Deliberate Tool Mode", () => {
  it("follows the server setting, never the anchor message author's personal override", () => {
    const turnFor = (borrowsTriggerMessage: boolean) =>
      ({
        persona: createPersona({ config: { deliberate_tool_mode: false } }),
        userRow: createUserRow({ personal_deliberate_tool_mode: "on" }),
        lockedTurn: { admission: { incoming: { borrowsTriggerMessage } } },
      }) as unknown as ChatTurn;
    expect(resolveTurnDeliberateToolMode(turnFor(false))).toBe(true);
    expect(resolveTurnDeliberateToolMode(turnFor(true))).toBe(false);
  });
});
