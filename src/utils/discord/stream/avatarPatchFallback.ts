import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import type { ChannelLastDelivery, DeliveredSpeaker } from "@/utils/discord/stream/channelDeliveryContinuity";

/** Which avatar a rate-limited line was delivered under instead of its own. */
type AvatarPatchFallbackSource = "previous_url" | "stored_avatar" | "bot_avatar";

export interface AvatarPatchFallback {
  identity: ResolvedWebhookIdentity;
  source: AvatarPatchFallbackSource;
}

const HTTPS_URL = /^https:\/\//i;

/**
 * Picks the avatar to deliver a line under when its own avatar edit is rate-limited, or null when
 * the line must wait for the edit instead.
 *
 * Falls back only when the previous delivery and this one are both the same persona in an
 * ordinary appearance (a non-identity sprite or the base), so the stale avatar still shows the
 * right speaker. Personas compare by id: nicknames can normalize equal and the group-break name
 * alters them on purpose, and alters can share a lineage while being different speakers.
 *
 * The fallback reproduces what was last DISPLAYED, which is not always what the webhook stores:
 * an `https` avatar travels per message and never touches the stored one, and a bot-user line
 * shows the bot's own avatar. A data URI only qualifies while the webhook still stores it, because
 * sending without an avatar shows whatever the webhook holds.
 *
 * @param intended - Identity the line was meant to use; its username is kept
 * @param current - Speaker the line presents
 * @param previous - The channel's last recorded delivery
 * @param storedAvatarDataUri - Data URI the webhook currently holds, if this process set one
 * @param botAvatarUrl - The bot's own avatar URL in this guild
 */
export function resolveAvatarPatchFallback(
  intended: ResolvedWebhookIdentity,
  current: DeliveredSpeaker,
  previous: ChannelLastDelivery | null,
  storedAvatarDataUri: string | undefined,
  botAvatarUrl: string | undefined,
): AvatarPatchFallback | null {
  if (current.kind !== "appearance" || current.personaId === null) return null;

  const previousSpeaker = previous?.speaker;
  if (!previous || !previousSpeaker) return null;
  if (previousSpeaker.kind !== "appearance" || previousSpeaker.personaId !== current.personaId) return null;

  const username = intended.username;
  if (previous.via === "bot") {
    return botAvatarUrl && HTTPS_URL.test(botAvatarUrl)
      ? { identity: { username, avatarUrl: botAvatarUrl }, source: "bot_avatar" }
      : null;
  }

  const { avatarDataUri, avatarUrl } = previous.identity;
  if (avatarDataUri) {
    return avatarDataUri === storedAvatarDataUri
      ? { identity: { username, avatarDataUri }, source: "stored_avatar" }
      : null;
  }
  if (avatarUrl && HTTPS_URL.test(avatarUrl)) {
    return { identity: { username, avatarUrl }, source: "previous_url" };
  }
  return null;
}
