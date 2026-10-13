import type { Message, Webhook } from "discord.js";
import {
  recordChannelDeliveredWebhookIdentity,
  resolveChannelPersonaPostIdentity,
} from "@/utils/discord/stream/channelDeliveryContinuity";
import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import { sendWebhookMessageWithIdentity } from "@/utils/discord/webhook/webhookCore";

/**
 * Persona webhook posts made outside the response stream: tool notices, generated media, voice
 * messages. Each one is resolved and recorded through the channel's delivery continuity, because a
 * post the continuity never saw reads as someone else's message and lets the next sprite line keep
 * a username that merges under the post's avatar.
 */

export interface PersonaPostSpeaker {
  username: string;
  /** URL or data URI of the persona's base appearance. */
  avatarUrl?: string | null;
  /** Lets the post continue this persona's adjacent line; without it the post shows the base appearance. */
  personaId?: number;
}

/** The channel the message lands in: a thread, not its webhook-hosting parent. */
export interface PersonaPostChannel {
  id: string;
  lastMessageId: string | null;
}

export function resolvePersonaPostIdentity(
  channel: PersonaPostChannel,
  speaker: PersonaPostSpeaker,
): ResolvedWebhookIdentity {
  const isLocalAvatar = speaker.avatarUrl?.startsWith("data:image/") === true;
  return resolveChannelPersonaPostIdentity(
    channel.id,
    {
      username: speaker.username,
      avatarUrl: speaker.avatarUrl ?? undefined,
      avatarDataUri: isLocalAvatar ? (speaker.avatarUrl ?? undefined) : undefined,
    },
    speaker.personaId ?? null,
    channel.lastMessageId,
  );
}

export function recordPersonaPostDelivery(
  channel: PersonaPostChannel,
  identity: ResolvedWebhookIdentity,
  messageId: string,
  speaker: PersonaPostSpeaker,
): void {
  recordChannelDeliveredWebhookIdentity(channel.id, identity, messageId, {
    personaId: speaker.personaId ?? null,
    kind: "appearance",
  });
}

export async function sendPersonaPostViaWebhook(
  webhook: Webhook,
  payload: Parameters<typeof sendWebhookMessageWithIdentity>[1],
  speaker: PersonaPostSpeaker,
  channel: PersonaPostChannel,
): Promise<Message> {
  const identity = resolvePersonaPostIdentity(channel, speaker);
  const message = await sendWebhookMessageWithIdentity(webhook, payload, identity);
  recordPersonaPostDelivery(channel, identity, message.id, speaker);
  return message;
}
