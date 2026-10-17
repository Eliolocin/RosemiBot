import { describe, expect, it } from "bun:test";
import type { Message, Webhook } from "discord.js";
import type { DeliveredStreamMessage } from "@/types/tool/interfaces";
import { deleteSupersededStreamMessages } from "@/utils/discord/stream/supersededMessageCleanup";

/**
 * Builds a fake channel that records the message IDs passed to `messages.delete`.
 * `isThread` toggles the thread-ID resolution path used for webhook deletion.
 */
function makeChannel(options?: { isThread?: boolean; channelId?: string }) {
  const channelDeletes: string[] = [];
  const channel = {
    id: options?.channelId ?? "channel_1",
    isThread: () => Boolean(options?.isThread),
    messages: {
      delete: async (messageId: string) => {
        channelDeletes.push(messageId);
      },
    },
  } as unknown as Message["channel"];
  return { channel, channelDeletes };
}

/** Builds a fake webhook that records delete calls and can be told to reject (recreated webhook). */
function makeWebhook(options?: { throwOnDelete?: boolean }) {
  const webhookDeletes: Array<{ messageId: string; threadId: string | undefined }> = [];
  const webhook = {
    id: "webhook_1",
    token: "synthetic_token",
    deleteMessage: async (messageId: string, threadId?: string) => {
      webhookDeletes.push({ messageId, threadId });
      if (options?.throwOnDelete) {
        throw new Error("Unknown Webhook (recreated mid-stream)");
      }
    },
  } as unknown as Webhook;
  return { webhook, webhookDeletes };
}

function webhookRef(messageId: string): DeliveredStreamMessage {
  return { messageId, channelId: "channel_1", webhookId: "webhook_1" };
}

describe("deleteSupersededStreamMessages", () => {
  it("deletes a webhook message through the webhook without touching the channel", async () => {
    const { channel, channelDeletes } = makeChannel();
    const { webhook, webhookDeletes } = makeWebhook();

    await deleteSupersededStreamMessages([webhookRef("partial_1")], { channel, webhook });

    expect(webhookDeletes).toEqual([{ messageId: "partial_1", threadId: undefined }]);
    expect(channelDeletes).toEqual([]);
  });

  it("falls back to a channel delete when the webhook delete fails (webhook recreated mid-stream)", async () => {
    const { channel, channelDeletes } = makeChannel();
    const { webhook, webhookDeletes } = makeWebhook({ throwOnDelete: true });

    await deleteSupersededStreamMessages([webhookRef("partial_1")], { channel, webhook });

    // Webhook was attempted first, then the channel-level delete recovered it.
    expect(webhookDeletes).toEqual([{ messageId: "partial_1", threadId: undefined }]);
    expect(channelDeletes).toEqual(["partial_1"]);
  });

  it("deletes bot-native messages via the channel and passes the thread ID to webhook deletes", async () => {
    const { channel, channelDeletes } = makeChannel({ isThread: true, channelId: "thread_1" });
    const { webhook, webhookDeletes } = makeWebhook();

    await deleteSupersededStreamMessages(
      [{ messageId: "bot_native_1", channelId: "thread_1", webhookId: null }, webhookRef("webhook_1")],
      { channel, webhook },
    );

    expect(channelDeletes).toEqual(["bot_native_1"]);
    expect(webhookDeletes).toEqual([{ messageId: "webhook_1", threadId: "thread_1" }]);
  });

  it("is a no-op for an empty ref list", async () => {
    const { channel, channelDeletes } = makeChannel();
    const { webhook, webhookDeletes } = makeWebhook();

    await deleteSupersededStreamMessages([], { channel, webhook });

    expect(channelDeletes).toEqual([]);
    expect(webhookDeletes).toEqual([]);
  });

  it("falls back to a channel delete for a webhook message when no webhook handle is available", async () => {
    const { channel, channelDeletes } = makeChannel();

    await deleteSupersededStreamMessages([webhookRef("partial_1")], { channel });

    expect(channelDeletes).toEqual(["partial_1"]);
  });
});
