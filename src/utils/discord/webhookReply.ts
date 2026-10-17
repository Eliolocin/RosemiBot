import { EmbedBuilder, type Message, type Webhook, type WebhookMessageCreateOptions } from "discord.js";
import { stripBridgePrefix } from "@/utils/bridges";
import { localizer } from "@/utils/text/localizer";
import {
  dispatchWebhookWithIdentity,
  sendSelectedWebhookMessage,
  type WebhookIdentityDelivery,
} from "@/utils/discord/webhook/personaDispatch";
import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import { verifyMessageWebhook, isManagedWebhookMessage } from "@/utils/chat/webhookIdentity";

/**
 * Resolves the author label for a historic message in the reply-context embed.
 *
 * Main personas and alters carry identity through different Discord primitives, so this
 * function has to branch on send mechanism. See
 * `docs/ai/multi-persona.md` → "Identity Resolution for Historic Messages" for the full
 * rationale and the resolution order.
 */
export function getReplyContextAuthorName(message: Message, botUserId?: string, botName?: string): string {
  // Webhook-delivered messages: the per-message `username` override captures the
  //    persona identity at send time.
  if (message.webhookId) {
    return isManagedWebhookMessage(message) ? stripBridgePrefix(message.author.username) : message.author.username;
  }
  // Non-webhook bot-authored messages (direct reply fallback). Discord snapshots the
  //    author's guild member on each message, so `message.member.displayName` reflects
  //    the bot's nickname *at send time* which, for persona-aware bots that rename
  //    themselves per persona, is the persona that actually sent that message. Prefer it
  //    over `botName` (the *currently* active persona), which is stale whenever an alter
  //    switch happened between send and now.
  if (botUserId && message.author.id === botUserId) {
    return message.member?.displayName ?? botName ?? stripBridgePrefix(message.author.username);
  }
  return message.member?.displayName ?? message.author.globalName ?? stripBridgePrefix(message.author.username);
}

function buildReplyContextEmbed(
  targetMessage: Message,
  locale: string,
  botUserId?: string,
  botName?: string,
): EmbedBuilder {
  const authorIconUrl =
    targetMessage.member?.displayAvatarURL({
      size: 64,
      extension: "png",
      forceStatic: true,
    }) ??
    targetMessage.author.displayAvatarURL({
      size: 64,
      extension: "png",
      forceStatic: true,
    });

  return new EmbedBuilder().setURL(targetMessage.url).setAuthor({
    name: localizer(locale, "genai.message_interaction.reply_context_author", {
      user: getReplyContextAuthorName(targetMessage, botUserId, botName),
    }),
    url: targetMessage.url,
    iconURL: authorIconUrl,
  });
}

export async function sendWebhookReplyWithContext(
  webhook: Webhook,
  targetMessage: Message,
  locale: string,
  content: string,
  identity: ResolvedWebhookIdentity,
  options?: {
    threadId?: string;
  },
): Promise<WebhookIdentityDelivery<Message>> {
  const noticePayload = await buildWebhookReplyNoticePayload(targetMessage, locale, options);
  return await dispatchWebhookWithIdentity(webhook, identity, async (selected) => {
    const replyNoticeMessage = await sendSelectedWebhookMessage(selected, noticePayload);
    try {
      return await sendSelectedWebhookMessage(selected, {
        content,
        allowedMentions: {
          parse: ["users", "roles"],
          repliedUser: false,
        },
        ...(options?.threadId ? { threadId: options.threadId } : {}),
      });
    } catch (error) {
      await selected.webhook.deleteMessage(replyNoticeMessage.id, options?.threadId).catch(() => undefined);
      throw error;
    }
  });
}

export async function buildWebhookReplyNoticePayload(
  targetMessage: Message,
  locale: string,
  options?: {
    threadId?: string;
    botUserId?: string;
    botName?: string;
  },
): Promise<WebhookMessageCreateOptions> {
  await verifyMessageWebhook(targetMessage);
  return {
    embeds: [buildReplyContextEmbed(targetMessage, locale, options?.botUserId, options?.botName)],
    ...(options?.threadId ? { threadId: options.threadId } : {}),
  };
}
