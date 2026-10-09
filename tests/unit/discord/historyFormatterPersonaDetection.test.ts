import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import { MessageType } from "discord.js";
import type { Message } from "discord.js";
import { formatMessagesForExtraction } from "@/utils/discord/historyFormatter";
import { createPersona } from "../../helpers/fixtures";
import { verifyMessageWebhook, clearWebhookIdentityCache } from "@/utils/chat/webhookIdentity";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";

/**
 * Regression guard for `/memory history import` automatic scope.
 *
 * Detection used to fire only for `msg.webhookId`, so a server whose Tomori replied under
 * the bot's own account reported "No personas detected" and fell back to serverwide, even
 * with the persona plainly present in the fetched messages. `personaTurnDetection.ts`
 * already attributed those turns to the main persona; this formatter did not.
 */

const BOT_USER_ID = "900000000000000001";

/** Minimal Discord message stand-in for the formatter's read surface. */
function makeMessage(options: { content: string; authorId: string; username: string; webhookId?: string }): Message {
  return {
    type: MessageType.Default,
    content: options.content,
    createdAt: new Date("2026-07-28T15:59:00Z"),
    id: "1",
    webhookId: options.webhookId ?? null,
    guildId: "fixture-guild",
    channelId: "fixture-channel",
    channel: { isThread: () => false },
    author: { id: options.authorId, username: options.username },
    member: null,
    attachments: new Map(),
    embeds: [],
  } as unknown as Message;
}

describe("formatMessagesForExtraction persona detection", () => {
  let lookup: ReturnType<typeof spyOn<typeof serverRepository, "loadManagedWebhookByChannelAndWebhookId">>;
  beforeEach(() => {
    clearWebhookIdentityCache();
    lookup = spyOn(serverRepository, "loadManagedWebhookByChannelAndWebhookId").mockImplementation(
      async (channelId, webhookId) =>
        webhookId === "wh-1"
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
  const personas = [
    createPersona({ persona_id: 11, persona_nickname: "Tomori", is_alter: false }),
    createPersona({ persona_id: 22, persona_nickname: "Locke", is_alter: true }),
  ];

  test("detects the main persona from messages the bot posted directly", () => {
    const messages = [
      makeMessage({ content: "Hello there!", authorId: BOT_USER_ID, username: "TomoriBot" }),
      makeMessage({ content: "Hi Tomori", authorId: "5", username: "Eri" }),
    ];

    const result = formatMessagesForExtraction(messages, personas, BOT_USER_ID);

    // The non-alter persona owns the bot's own turns.
    expect(result.detectedPersonaTomoriIds).toEqual([11]);
  });

  test("still detects personas from verified webhook-authored messages", async () => {
    const messages = [makeMessage({ content: "Alter speaking", authorId: "77", username: "Locke", webhookId: "wh-1" })];

    await Promise.all(messages.map(verifyMessageWebhook));
    const result = formatMessagesForExtraction(messages, personas, BOT_USER_ID);

    expect(result.detectedPersonaTomoriIds).toEqual([22]);
  });

  test("detects both delivery styles in one batch without duplicating", async () => {
    const messages = [
      makeMessage({ content: "Direct reply", authorId: BOT_USER_ID, username: "TomoriBot" }),
      makeMessage({ content: "Another direct reply", authorId: BOT_USER_ID, username: "TomoriBot" }),
      makeMessage({ content: "Alter reply", authorId: "77", username: "Locke", webhookId: "wh-1" }),
    ];

    await Promise.all(messages.map(verifyMessageWebhook));
    const result = formatMessagesForExtraction(messages, personas, BOT_USER_ID);

    expect([...result.detectedPersonaTomoriIds].sort()).toEqual([11, 22]);
  });

  test("does not attribute ordinary user messages to a persona", () => {
    const messages = [makeMessage({ content: "Just a human talking", authorId: "5", username: "Eri" })];

    const result = formatMessagesForExtraction(messages, personas, BOT_USER_ID);

    expect(result.detectedPersonaTomoriIds).toEqual([]);
  });
  test("does not import a copied persona name as a persona turn", async () => {
    const message = makeMessage({ content: "copied", authorId: "foreign", username: "Locke", webhookId: "foreign" });
    await verifyMessageWebhook(message);
    expect(formatMessagesForExtraction([message], personas, BOT_USER_ID).detectedPersonaTomoriIds).toEqual([]);
  });

  test("ignores the bot's own turns when no client id is supplied", () => {
    const messages = [makeMessage({ content: "Hello there!", authorId: BOT_USER_ID, username: "TomoriBot" })];

    // Callers that cannot resolve the client id keep the old webhook-only behaviour
    //    rather than guessing.
    const result = formatMessagesForExtraction(messages, personas);

    expect(result.detectedPersonaTomoriIds).toEqual([]);
  });
});
