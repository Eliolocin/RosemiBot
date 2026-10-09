import { beforeAll, describe, expect, test } from "bun:test";
import { MessageFlags, type ChatInputCommandInteraction, type Client, type EmbedBuilder } from "discord.js";
import { execute } from "@/commands/troubleshoot/chat";
import type { ChatIncoming } from "@/utils/chat/types";
import { initializeLocalizer } from "@/utils/text/localizer";
import {
  getChatDiagnostic,
  recordChatAttemptStarted,
  recordChatContextHistory,
  recordChatDiagnostic,
  recordChatMessageSent,
  recordChatProviderContext,
  runWithChatDiagnostic,
  runWithChatDiagnosticStage,
} from "@/utils/chat/diagnosticTimeline";
import { createUserRow } from "../../helpers/fixtures";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import { localizedCopy } from "../../helpers/localeCases";
import { localizedStatusTitle } from "@/utils/discord/ui/statusTitle";
import { ColorCode } from "@/utils/misc/logger";

const guildId = "1750000000000000001";
const channelId = "1750000000000000002";
const ownerId = "1750000000000000003";
const otherUserId = "1750000000000000004";
const triggerId = "1750000000000000005";
const laterMessageId = "1750000000000000006";
const replyId = "1750000000000000007";
const nextTriggerId = "1750000000000000009";

beforeAll(async () => initializeLocalizer());

function incoming(
  overrides: { isFromQueue?: boolean; messageId?: string; createdTimestamp?: number } = {},
): ChatIncoming {
  return {
    message: {
      id: overrides.messageId ?? triggerId,
      channelId,
      guildId,
      createdTimestamp: overrides.createdTimestamp ?? Date.now() - 1_000,
      webhookId: null,
      author: { id: ownerId, bot: false },
    },
    retryCount: 0,
    isFromQueue: overrides.isFromQueue ?? false,
  } as ChatIncoming;
}

describe("chat troubleshooting timeline", () => {
  test("attributes each sent message to its generation and delivery path", async () => {
    const attributedTriggerId = "1750000000000000013";
    await runWithChatDiagnostic(incoming({ messageId: attributedTriggerId }), async () => {
      await runWithChatDiagnosticStage({ turn: 1 }, async () => {
        await runWithChatDiagnosticStage({ attempt: 1, keyAttempt: 1 }, async () => {
          await runWithChatDiagnosticStage({ toolIteration: 1 }, async () => {
            recordChatMessageSent("1750000000000000014", "webhook", "stream_segment", 1);
            recordChatMessageSent("1750000000000000015", "webhook", "length_split", 2);
          });
          await runWithChatDiagnosticStage({ toolIteration: 2 }, async () => {
            recordChatMessageSent("1750000000000000016", "bot", "stream_segment", 1, "bot_fallback");
          });
        });
      });
      await runWithChatDiagnosticStage({ turn: 2 }, async () => {
        await runWithChatDiagnosticStage({ attempt: 2, keyAttempt: 2, toolIteration: 1 }, async () => {
          recordChatMessageSent("1750000000000000017", "bot", "table_attachment", 1);
        });
      });
    });

    const report = getChatDiagnostic({ ownerId, channelId, guildId, messageId: attributedTriggerId });
    expect(report?.schemaVersion).toBe(2);
    const sends = report?.events.flatMap(({ event }) => (event.kind === "message_sent" ? [event] : []));
    expect(sends).toMatchObject([
      { origins: ["initial_generation"], streamMessage: 1, reason: "stream_segment", turn: 1, attempt: 1 },
      { origins: ["initial_generation"], streamMessage: 2, reason: "length_split", turn: 1, attempt: 1 },
      { origins: ["tool_continuation"], streamMessage: 1, route: "bot_fallback", toolIteration: 2 },
      {
        origins: ["additional_persona", "model_fallback", "key_retry"],
        reason: "table_attachment",
        turn: 2,
        attempt: 2,
        keyAttempt: 2,
      },
    ]);
  });

  test("keeps context ordering and timing without publishing Discord IDs or chat text", async () => {
    const trigger = incoming();
    await runWithChatDiagnostic(trigger, async () => {
      recordChatDiagnostic({ kind: "admission", disposition: "run" });
      recordChatContextHistory(
        [
          { id: triggerId, authorId: ownerId, isBot: false, createdAt: trigger.message.createdTimestamp },
          {
            id: laterMessageId,
            authorId: otherUserId,
            isBot: false,
            createdAt: trigger.message.createdTimestamp + 250,
          },
          {
            id: nextTriggerId,
            authorId: ownerId,
            isBot: false,
            createdAt: trigger.message.createdTimestamp + 500,
          },
        ],
        new Set([triggerId, laterMessageId]),
      );
      recordChatProviderContext(1, [triggerId, laterMessageId]);
      recordChatAttemptStarted(1, "server", "private-provider:private-model");
      recordChatAttemptStarted(2, "server", "private-provider:private-model");
      recordChatAttemptStarted(3, "server", "private-provider:other-model");
      recordChatMessageSent(replyId, "bot");
    });
    await runWithChatDiagnostic(incoming({ isFromQueue: true }), async () => {
      recordChatDiagnostic({ kind: "turns_planned", count: 1 });
    });

    const report = getChatDiagnostic({ ownerId, channelId, guildId });
    expect(report?.invocationCount).toBe(2);
    expect(report?.events.some(({ event }) => event.kind === "tool_continuation")).toBe(false);
    const context = report?.events.find(({ event }) => event.kind === "context_history")?.event;
    expect(context?.kind).toBe("context_history");
    if (context?.kind === "context_history") {
      expect(context.messages[1]).toMatchObject({ author: "other_user", afterTriggerMs: 250, included: true });
    }
    const file = JSON.stringify(report);
    expect(file).not.toContain("private-provider");
    expect(report?.events.flatMap(({ event }) => (event.kind === "attempt_started" ? [event.model] : []))).toEqual([
      "model-1",
      "model-1",
      "model-2",
    ]);
    for (const id of [ownerId, otherUserId, guildId, channelId, triggerId, laterMessageId, nextTriggerId, replyId]) {
      expect(file).not.toContain(id);
    }
    expect(report?.events.every(({ afterTriggerMs }) => Number.isFinite(afterTriggerMs))).toBe(true);
    expect(report?.triggeredAt).toEndWith("Z");

    expect(getChatDiagnostic({ ownerId: otherUserId, channelId, guildId, messageId: replyId })).toBeNull();
    expect(getChatDiagnostic({ ownerId, channelId, guildId, messageId: replyId })?.reportId).toBe(report?.reportId);
    expect(getChatDiagnostic({ ownerId, channelId: "1750000000000000008", guildId })).toBeNull();

    await runWithChatDiagnostic(incoming({ messageId: nextTriggerId }), async () => {
      recordChatContextHistory(
        [{ id: triggerId, authorId: ownerId, isBot: false, createdAt: trigger.message.createdTimestamp }],
        new Set([triggerId]),
      );
    });
    expect(getChatDiagnostic({ ownerId, channelId, guildId, messageId: nextTriggerId })?.reportId).not.toBe(
      report?.reportId,
    );
  });

  test("delivers a report privately and rejects a link outside the channel", async () => {
    await runWithChatDiagnostic(incoming(), async () => {
      recordChatDiagnostic({ kind: "admission", disposition: "run" });
      recordChatMessageSent(replyId, "bot");
    });
    const sent: unknown[] = [];
    const fakeUser = {
      id: ownerId,
      displayName: "Mirri",
      globalName: "Mirri",
      username: "mirri",
      displayAvatarURL: () => "https://cdn.example.com/avatar.png",
      send: async (payload: unknown) => {
        sent.push(payload);
      },
    };
    const { interaction, calls } = makeFakeInteraction({
      channelId,
      guildId,
      user: fakeUser,
    });
    await execute({} as Client, interaction as unknown as ChatInputCommandInteraction, createUserRow(), "en-US");
    expect(calls.map(({ method }) => method)).toEqual(["deferReply", "editReply"]);
    expect(calls[0]?.args[0]).toMatchObject({ flags: MessageFlags.Ephemeral });
    expect(sent).toHaveLength(1);
    const dm = sent[0] as { embeds: EmbedBuilder[] };
    expect(dm.embeds[0]?.toJSON().description).toBe(
      localizedCopy("en-US", "commands.troubleshoot.chat.dm_description"),
    );
    const receipt = calls.at(-1)?.args[0] as { embeds: EmbedBuilder[] };
    expect(receipt.embeds[0]?.toJSON().title).toBe(
      localizedStatusTitle("en-US", "commands.troubleshoot.chat.success_title", ColorCode.SUCCESS),
    );
    expect(receipt).not.toHaveProperty("content");

    for (const host of ["canary.discord.com", "ptb.discord.com"]) {
      const sentBefore = sent.length;
      const linked = makeFakeInteraction({
        channelId,
        guildId,
        user: fakeUser,
        options: {
          getString: () => `https://${host}/channels/${guildId}/${channelId}/${triggerId}`,
          getInteger: () => null,
          getBoolean: () => null,
        },
      });
      await execute(
        {} as Client,
        linked.interaction as unknown as ChatInputCommandInteraction,
        createUserRow(),
        "en-US",
      );
      expect(linked.calls.map(({ method }) => method)).toEqual(["deferReply", "editReply"]);
      expect(sent).toHaveLength(sentBefore + 1);
    }

    const bad = makeFakeInteraction({
      channelId,
      guildId,
      user: interaction.user,
      options: {
        getString: () => `https://discord.com/channels/${guildId}/1750000000000000008/${triggerId}`,
        getInteger: () => null,
        getBoolean: () => null,
      },
    });
    await execute({} as Client, bad.interaction as unknown as ChatInputCommandInteraction, createUserRow(), "en-US");
    expect(bad.calls.map(({ method }) => method)).toEqual(["deferReply", "editReply"]);
    expect(sent).toHaveLength(3);
    expect(bad.calls.at(-1)?.args[0]).toHaveProperty("embeds");

    const outsideDiscord = makeFakeInteraction({
      channelId,
      guildId,
      user: fakeUser,
      options: {
        getString: () => `https://discord.com.evil.example/channels/${guildId}/${channelId}/${triggerId}`,
        getInteger: () => null,
        getBoolean: () => null,
      },
    });
    await execute(
      {} as Client,
      outsideDiscord.interaction as unknown as ChatInputCommandInteraction,
      createUserRow(),
      "en-US",
    );
    expect(sent).toHaveLength(3);

    const blockedUser = {
      ...fakeUser,
      send: async () => {
        throw new Error("DMs closed");
      },
    };
    const fallback = makeFakeInteraction({
      channelId,
      guildId,
      user: blockedUser,
      options: {
        getString: () => `https://discord.com/channels/${guildId}/${channelId}/${replyId}`,
        getInteger: () => null,
        getBoolean: () => null,
      },
    });
    await execute(
      {} as Client,
      fallback.interaction as unknown as ChatInputCommandInteraction,
      createUserRow(),
      "en-US",
    );
    expect(fallback.calls.map(({ method }) => method)).toEqual(["deferReply", "editReply"]);
    expect(fallback.calls.at(-1)?.args[0]).toHaveProperty("files");
    expect(fallback.calls.at(-1)?.args[0]).toHaveProperty("embeds");

    const afterDefaultWindow = Date.now() + 16 * 60 * 1000;
    expect(getChatDiagnostic({ ownerId, channelId, guildId, now: afterDefaultWindow })).toBeNull();
    expect(
      getChatDiagnostic({ ownerId, channelId, guildId, messageId: replyId, now: afterDefaultWindow }),
    ).not.toBeNull();
    expect(
      getChatDiagnostic({ ownerId, channelId, guildId, messageId: replyId, now: Date.now() + 61 * 60 * 1000 }),
    ).toBeNull();
  });

  test("keeps bot reply links searchable after the event timeline reaches its limit", async () => {
    const crowdedTriggerId = "1750000000000000011";
    const crowdedReplyId = "1750000000000000012";
    await runWithChatDiagnostic(incoming({ messageId: crowdedTriggerId }), async () => {
      for (let index = 0; index < 100; index++) {
        recordChatDiagnostic({ kind: "turns_planned", count: index });
      }
      recordChatMessageSent(crowdedReplyId, "bot");
    });
    const report = getChatDiagnostic({ ownerId, channelId, guildId, messageId: crowdedReplyId });
    expect(report?.triggerMessage).toBe("message-1");
    expect(report?.droppedEvents).toBeGreaterThan(0);
    expect(report?.events.some(({ event }) => event.kind === "message_sent")).toBe(false);
  });

  test("selects the closest trigger when the user supplies an approximate time", async () => {
    const earlierMessageId = "1750000000000000010";
    await runWithChatDiagnostic(
      incoming({ messageId: earlierMessageId, createdTimestamp: Date.now() - 5 * 60 * 1000 }),
      async () => recordChatDiagnostic({ kind: "admission", disposition: "run" }),
    );
    expect(getChatDiagnostic({ ownerId, channelId, guildId, minutesAgo: 5 })?.invocationCount).toBe(1);
    expect(getChatDiagnostic({ ownerId, channelId, guildId, minutesAgo: 45 })).toBeNull();
  });
});
