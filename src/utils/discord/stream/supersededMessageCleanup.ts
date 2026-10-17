import type { Message, Webhook } from "discord.js";
import type { DeliveredStreamMessage } from "@/types/tool/interfaces";
import { log } from "@/utils/misc/logger";
import { resolveAuthoringWebhook } from "@/utils/discord/webhook/fallback";

/**
 * Deletes the Discord messages a superseded generation attempt already committed to the channel.
 *
 * When a primary model stalls and its `streamToDiscord` call is aborted by the SDK-call-timeout
 * watchdog, any segments it had already flushed remain in the channel as real messages. If a
 * fallback model then produces its own complete response, the channel would show two conflicting
 * messages. This helper removes the superseded attempt's partial output so only the surviving
 * response is left visible.
 *
 * Deletion is best-effort: a failure to delete one message (already gone, missing permissions,
 * expired webhook token) is logged and skipped rather than aborting the turn.
 *
 * @param refs - Messages delivered by the superseded attempt (order preserved).
 * @param options.channel - The channel the turn is streaming into; used for bot-native deletes,
 *   for the webhook-delete fallback, and to resolve the thread ID webhook deletion needs in threads.
 *   for webhook-delivered messages because it needs no Manage Messages permission.
 */
export async function deleteSupersededStreamMessages(
  refs: DeliveredStreamMessage[],
  options: {
    channel: Message["channel"];
    webhook?: Webhook;
  },
): Promise<void> {
  if (refs.length === 0) {
    return;
  }

  const { channel, webhook } = options;
  // Webhook deletion inside a thread needs the thread ID; a whole turn streams into one
  //    channel, so resolve it once from the shared channel rather than per message.
  const threadId = "isThread" in channel && channel.isThread() ? channel.id : undefined;

  for (const ref of refs) {
    if (ref.webhookId) {
      try {
        const author = await resolveAuthoringWebhook(channel, ref.webhookId, webhook);
        if (author && (await tryWebhookDelete(author, ref.messageId, threadId))) continue;
      } catch (error) {
        log.warn("Failed to resolve authoring webhook for superseded message", {
          messageId: ref.messageId,
          webhookId: ref.webhookId,
          error,
        });
      }
    }

    if ("messages" in channel) {
      try {
        await channel.messages.delete(ref.messageId);
      } catch (error) {
        log.warn(
          `Failed to delete superseded stream message ${ref.messageId} in channel ${ref.channelId}`,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }
  }
}

/**
 * Attempts to delete a webhook-delivered message through the supplied webhook.
 * @returns `true` on success; `false` if the delete failed (caller should fall back to a
 *   channel-level delete: e.g. the webhook was recreated mid-stream and no longer owns the message).
 */
async function tryWebhookDelete(webhook: Webhook, messageId: string, threadId: string | undefined): Promise<boolean> {
  try {
    await webhook.deleteMessage(messageId, threadId);
    return true;
  } catch (error) {
    log.warn(
      `Webhook delete failed for superseded message ${messageId}; falling back to a channel delete.`,
      error instanceof Error ? error : new Error(String(error)),
    );
    return false;
  }
}
