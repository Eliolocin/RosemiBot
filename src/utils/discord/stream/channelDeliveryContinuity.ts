import { formatRenderModifierWebhookName, NEUTRAL_APPEARANCE_MODIFIER } from "@/utils/discord/renderModifierParser";
import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import { log } from "@/utils/misc/logger";
import { toGroupBreakName } from "@/utils/text/groupBreakName";

/**
 * Cross-turn Discord delivery continuity, keyed by channel.
 *
 * Discord groups consecutive webhook messages by `webhook_id` + `username` and ignores the
 * per-message avatar. Two things depend on that, and both need state that outlives a single
 * stream: `StreamState` is rebuilt for every SDK call, so anything held there is reset at
 * every turn boundary (queued chain, follow-up, persona job, tool-loop continuation):
 *
 * - **Sprite group-break alternation**: adjacent *different* sprites must not share a
 *    username, or the second renders under the first one's avatar. Held per channel because
 *    grouping spans turns, and reset whenever a foreign message lands between our own
 *    deliveries, since Discord only ever groups a message with the one directly above it.
 * - **Last delivered webhook identity**: artifacts that follow text (expressions, the
 *    "Fallback Used" notice) should be posted as the identity that delivered that text, so
 *    they group with it instead of splitting off under a different name.
 *
 * Every webhook send that can sit next to a sprite must take part, including tool notices and media
 * sent outside the stream (`utils/discord/webhook/personaPost.ts`): an unrecorded send looks like a
 * foreign message to the adjacency test, so the sprite after it restarts on the clean name and
 * merges under that post's avatar.
 *
 * Entries expire once messages are far enough apart that Discord would not group them anyway.
 * Runtime-authoritative state with no database behind it: mirrors `utils/chat/selfReplyState.ts`.
 */

// Discord stops grouping consecutive same-author messages after a few minutes, so continuity
// beyond that window is pointless, so an expired entry is equivalent to a fresh channel.
const CONTINUITY_TTL_MS = 10 * 60 * 1000;

// Sprite keys can never contain parentheses (validatePersonaSpriteName rejects them), so this key
// cannot collide with a real sprite named "neutral" in the channel's group alternation.
const NEUTRAL_APPEARANCE_GROUP_KEY = "(neutral)";

// Housekeeping (not an operational limit): channels are unbounded, so sweep expired entries
// once the map grows past this size rather than wiring up a timer.
const SWEEP_SIZE_THRESHOLD = 2000;

/**
 * How a delivered message presented its speaker. `appearance` is an ordinary sprite or the base
 * appearance: the persona as itself, so a stale expression still names the right speaker. An
 * identity sprite or a copied identity is a different speaker on screen even when the same
 * persona produced it.
 */
type DeliveredSpeakerKind = "appearance" | "identity_sprite" | "copied";

export interface DeliveredSpeaker {
  /** Null when the speaker cannot be tied to one persona, which never matches another speaker. */
  personaId: number | null;
  kind: DeliveredSpeakerKind;
}

export type ChannelLastDelivery =
  | { via: "webhook"; identity: ResolvedWebhookIdentity; speaker: DeliveredSpeaker | null; webhookId: string }
  | { via: "bot"; speaker: DeliveredSpeaker | null };

interface ChannelDeliveryState {
  /** Sprite key of the most recent non-identity sprite delivered in this channel. */
  lastSpriteKey: string | null;
  /** Current half of the clean/group-break username alternation. */
  groupParity: boolean;
  /**
   * Identity of the most recent WEBHOOK delivery, or null when the last delivery was an
   * ordinary bot message. Null is meaningful: it means following artifacts must also go out
   * as the bot, since that is what they would group with.
   */
  lastWebhookIdentity: ResolvedWebhookIdentity | null;
  lastWebhookId: string | null;
  /**
   * Message id of the most recent WEBHOOK delivery, or null when the last delivery was an
   * ordinary bot message. Null blocks adjacency outright: a bot-user message is a different
   * Discord author, so no webhook group can continue through it.
   */
  lastDeliveredMessageId: string | null;
  /** Null on a fresh entry, which is what separates "nothing recorded" from a bot-user delivery. */
  lastDeliveryVia: "webhook" | "bot" | null;
  lastSpeaker: DeliveredSpeaker | null;
  updatedAt: number;
}

const channelDeliveryStates = new Map<string, ChannelDeliveryState>();

function sweepExpiredEntries(now: number): void {
  for (const [channelId, entry] of channelDeliveryStates) {
    if (now - entry.updatedAt >= CONTINUITY_TTL_MS) {
      channelDeliveryStates.delete(channelId);
    }
  }
}

/**
 * Returns the channel's live entry, creating a fresh one when absent or stale. A stale entry is
 * discarded rather than revived: past the grouping window nothing collides, so the channel
 * should start over on the clean name with no inherited identity.
 */
function getLiveEntry(channelId: string, now: number): ChannelDeliveryState {
  if (channelDeliveryStates.size >= SWEEP_SIZE_THRESHOLD) {
    sweepExpiredEntries(now);
  }

  const existing = channelDeliveryStates.get(channelId);
  if (existing && now - existing.updatedAt < CONTINUITY_TTL_MS) {
    return existing;
  }

  const fresh: ChannelDeliveryState = {
    lastSpriteKey: null,
    groupParity: false,
    lastWebhookIdentity: null,
    lastWebhookId: null,
    lastDeliveredMessageId: null,
    lastDeliveryVia: null,
    lastSpeaker: null,
    updatedAt: now,
  };
  channelDeliveryStates.set(channelId, fresh);
  return fresh;
}

/**
 * Reports whether a message from someone else landed after our last webhook delivery, which
 * means Discord has already broken the group and the next sprite cannot collide with anything.
 *
 * Compares snowflake magnitude rather than equality because `channel.lastMessageId` is
 * maintained from the gateway `MESSAGE_CREATE` dispatch, which can lag a send we just made: an
 * equality check would read our own back-to-back segments as non-adjacent and drop the group
 * break that keeps them from merging. Snowflakes are time-ordered, so only a strictly greater
 * id proves a later message exists; a lagging (smaller) read falls through to "adjacent", whose
 * worst case is a redundant suffix rather than two sprites collapsing under one avatar.
 */
function hasForeignMessageSinceDelivery(
  deliveredMessageId: string | null,
  channelLastMessageId: string | null,
): boolean {
  if (deliveredMessageId === null) return true;
  if (channelLastMessageId === null) return false;

  try {
    return BigInt(channelLastMessageId) > BigInt(deliveredMessageId);
  } catch {
    // A non-numeric id should be impossible, so assume adjacency and keep the group break.
    return false;
  }
}

/**
 * Advances the channel's sprite alternation for a sprite about to be delivered, and reports
 * which username representation it must use.
 *
 * Parity flips only when the sprite differs from the previous one delivered in this channel, so
 * same-sprite runs keep an identical username and still group naturally, while adjacent
 * different-sprite messages are guaranteed to differ.
 *
 * The run restarts whenever anything else spoke since our last delivery (a user, another
 * persona's webhook, our own bot-user fallback). Discord groups a message only with the one
 * directly above it, so a broken group means the decorated name would be noise rather than a
 * collision break.
 *
 * @param channelLastMessageId - The channel's current `lastMessageId`, used for the adjacency test
 */
export function advanceChannelSpriteGroupParity(
  channelId: string,
  spriteKey: string,
  channelLastMessageId: string | null,
): boolean {
  const now = Date.now();
  const entry = getLiveEntry(channelId, now);
  entry.updatedAt = now;

  if (hasForeignMessageSinceDelivery(entry.lastDeliveredMessageId, channelLastMessageId)) {
    entry.lastSpriteKey = null;
    entry.groupParity = false;
  }

  // A null previous key means this sprite is the channel's first in the current window, so it
  // stays on the clean name, so there is nothing before it to collide with.
  if (entry.lastSpriteKey !== null && entry.lastSpriteKey !== spriteKey) {
    entry.groupParity = !entry.groupParity;
  }
  entry.lastSpriteKey = spriteKey;
  return entry.groupParity;
}

/**
 * Returns `identity` with its webhook username chosen to avoid Discord's consecutive-message
 * grouping collapsing different appearances under one avatar.
 *
 * Discord strips zero-width/blank characters from usernames, so two adjacent appearances need names
 * that differ in a character Discord keeps. The "true" half of the parity uses the lookalike-letter
 * variant from {@link toGroupBreakName}, which reads as the clean name; only a name with no
 * swappable letter (kana, hanzi, very short words) falls back to `fallbackDecoratedUsername`.
 *
 * @param groupKey - Sprite key of the appearance, or the neutral key for the base appearance
 * @param channelLastMessageId - The channel's current `lastMessageId`, used for the adjacency test
 */
export function resolveChannelGroupBreakIdentity(
  channelId: string,
  identity: ResolvedWebhookIdentity,
  fallbackDecoratedUsername: string,
  groupKey: string,
  channelLastMessageId: string | null,
): ResolvedWebhookIdentity {
  if (!advanceChannelSpriteGroupParity(channelId, groupKey, channelLastMessageId)) {
    return identity;
  }
  const groupBreakName = identity.username ? toGroupBreakName(identity.username) : null;
  return { ...identity, username: groupBreakName ?? fallbackDecoratedUsername };
}

/**
 * Base appearance counterpart of the sprite alternation, for lines that show the persona's own
 * avatar under the same clean username its sprites use.
 *
 * @param channelLastMessageId - The channel's current `lastMessageId`, used for the adjacency test
 */
export function resolveChannelBaseAppearanceIdentity(
  channelId: string,
  baseIdentity: ResolvedWebhookIdentity,
  sourceDisplayName: string,
  channelLastMessageId: string | null,
): ResolvedWebhookIdentity {
  return resolveChannelGroupBreakIdentity(
    channelId,
    baseIdentity,
    formatRenderModifierWebhookName(sourceDisplayName, NEUTRAL_APPEARANCE_MODIFIER),
    NEUTRAL_APPEARANCE_GROUP_KEY,
    channelLastMessageId,
  );
}

/**
 * Picks the identity a persona post outside the response stream (tool notice, generated media) is
 * sent under.
 *
 * Directly after the same persona's own line, the post reuses that line's identity verbatim so it
 * stays inside the speaker's block instead of splitting it. Anywhere else it shows the base
 * appearance, which joins the sprite alternation so a following sprite cannot merge under the
 * post's avatar.
 *
 * @param personaId - Persona the post speaks for; null never matches a previous speaker
 * @param channelLastMessageId - The channel's current `lastMessageId`, used for the adjacency test
 */
export function resolveChannelPersonaPostIdentity(
  channelId: string,
  baseIdentity: ResolvedWebhookIdentity & { username: string },
  personaId: number | null,
  channelLastMessageId: string | null,
): ResolvedWebhookIdentity {
  const entry = getLiveEntry(channelId, Date.now());
  const previousIdentity = entry.lastDeliveryVia === "webhook" ? entry.lastWebhookIdentity : null;
  const continuesOwnLine =
    previousIdentity !== null &&
    personaId !== null &&
    entry.lastSpeaker?.kind === "appearance" &&
    entry.lastSpeaker.personaId === personaId &&
    !hasForeignMessageSinceDelivery(entry.lastDeliveredMessageId, channelLastMessageId);
  if (previousIdentity && continuesOwnLine) {
    return { ...previousIdentity };
  }
  return resolveChannelBaseAppearanceIdentity(channelId, baseIdentity, baseIdentity.username, channelLastMessageId);
}

/**
 * Records the identity a webhook message was just delivered under, so later sends in the same
 * channel can reuse it verbatim and group with it.
 *
 * The stored username is the one actually sent, which may be the lookalike-letter group-break
 * name (or its `Persona (sprite)` fallback) chosen by the alternation. Re-resolving the sprite from
 * scratch would produce the clean name instead and split the group, which is exactly what this
 * avoids.
 *
 * @param identity - Identity used for the send
 * @param messageId - Id of the sent message, which anchors the sprite alternation's adjacency test
 * @param speaker - Who the message presented, or null when unknown
 */
export function recordChannelDeliveredWebhookIdentity(
  channelId: string,
  identity: ResolvedWebhookIdentity,
  messageId: string,
  speaker: DeliveredSpeaker | null,
  webhookId: string,
): void {
  const now = Date.now();
  const entry = getLiveEntry(channelId, now);
  entry.lastWebhookIdentity = { ...identity };
  entry.lastWebhookId = webhookId;
  entry.lastDeliveredMessageId = messageId;
  entry.lastDeliveryVia = "webhook";
  entry.lastSpeaker = speaker ? { ...speaker } : null;
  entry.updatedAt = now;
}

/**
 * Records that the channel's most recent delivery was an ordinary bot message, clearing any
 * remembered webhook identity. Without this a stale identity would be reused after the persona
 * had already reverted to the bot, putting artifacts under a name nothing else is using.
 *
 * @param speaker - Who the message presented, or null when unknown
 */
export function recordChannelDeliveredBotMessage(channelId: string, speaker: DeliveredSpeaker | null = null): void {
  const now = Date.now();
  const entry = getLiveEntry(channelId, now);
  entry.lastWebhookIdentity = null;
  entry.lastWebhookId = null;
  entry.lastDeliveredMessageId = null;
  entry.lastDeliveryVia = "bot";
  entry.lastSpeaker = speaker ? { ...speaker } : null;
  entry.updatedAt = now;
}

/**
 * Returns the identity of the channel's most recent webhook delivery, or null when the last
 * delivery was an ordinary bot message, nothing has been delivered, or the window has expired.
 * Callers should send as the bot when this is null.
 *
 */
export function getChannelDeliveredWebhookIdentity(channelId: string): ResolvedWebhookIdentity | null {
  const entry = channelDeliveryStates.get(channelId);
  if (!entry || Date.now() - entry.updatedAt >= CONTINUITY_TTL_MS) {
    return null;
  }
  return entry.lastWebhookIdentity;
}

/**
 * Returns how the channel's most recent message was delivered and who it presented, or null when
 * nothing is recorded in the current window.
 */
export function getChannelLastDelivery(channelId: string): ChannelLastDelivery | null {
  const entry = channelDeliveryStates.get(channelId);
  if (!entry || Date.now() - entry.updatedAt >= CONTINUITY_TTL_MS) {
    return null;
  }
  if (entry.lastDeliveryVia === "bot") {
    return { via: "bot", speaker: entry.lastSpeaker };
  }
  if (entry.lastDeliveryVia === "webhook" && entry.lastWebhookIdentity && entry.lastWebhookId) {
    return {
      via: "webhook",
      identity: entry.lastWebhookIdentity,
      speaker: entry.lastSpeaker,
      webhookId: entry.lastWebhookId,
    };
  }
  return null;
}

/** Test seam: drops all continuity state. */
export function clearAllChannelDeliveryContinuity(): void {
  const cleared = channelDeliveryStates.size;
  channelDeliveryStates.clear();
  if (cleared > 0) {
    log.info(`Cleared delivery continuity for ${cleared} channel(s).`);
  }
}
