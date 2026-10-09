import { beforeEach, describe, expect, it } from "bun:test";
import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import type { StreamMessageDelivery } from "@/utils/discord/stream/messageDelivery";
import { StreamSegmentProcessor } from "@/utils/discord/stream/segmentProcessor";
import {
  clearAllChannelDeliveryContinuity,
  recordChannelDeliveredBotMessage,
  recordChannelDeliveredWebhookIdentity,
} from "@/utils/discord/stream/channelDeliveryContinuity";

// `resolveSpriteGroupBreakIdentity` is private; we exercise it through a typed cast
// so the toggle behavior is pinned without standing up the full resolver/delivery
// chain. The method keys its alternation off the channel id alone, so the processor's
// dependencies can be inert stubs.
type SpriteGroupBreakFn = (
  identity: ResolvedWebhookIdentity,
  fallbackDecoratedUsername: string,
  spriteKey: string,
  channelId: string,
  channelLastMessageId: string | null,
) => ResolvedWebhookIdentity;

function makeResolver(): SpriteGroupBreakFn {
  const processor = new StreamSegmentProcessor({
    delivery: {} as StreamMessageDelivery,
    requestStop: () => false,
  });
  return (
    processor as unknown as { resolveSpriteGroupBreakIdentity: SpriteGroupBreakFn }
  ).resolveSpriteGroupBreakIdentity.bind(processor);
}

const CLEAN = "Touko Fukawa";
const CHANNEL = "1382235263668846612";
const cleanIdentity: ResolvedWebhookIdentity = {
  username: CLEAN,
  avatarUrl: "https://example.com/sprites/clean.png",
};
const decoratedFor = (sprite: string) => `${CLEAN} (${sprite})`;
// Last swappable letter of the last word: the final Latin "a" of "Fukawa" becomes Cyrillic U+0430.
const GROUP_BREAK = `Touko Fukaw${String.fromCodePoint(0x0430)}`;

/**
 * Stands in for the Discord channel the alternation reads adjacency from. Ids must be real
 * snowflakes because the adjacency test compares magnitude, not equality.
 */
function makeChannel(channelId: string = CHANNEL) {
  const BASE = 1400000000000000000n;
  let counter = 0n;
  let lastMessageId: string | null = null;

  const nextId = (): string => {
    counter += 1n;
    return (BASE + counter).toString();
  };

  return {
    get lastMessageId(): string | null {
      return lastMessageId;
    },
    /** A webhook send by us landing in the channel, as `recordSuccessfulSend` would report it. */
    deliverWebhook(identity: ResolvedWebhookIdentity): void {
      const id = nextId();
      lastMessageId = id;
      recordChannelDeliveredWebhookIdentity(channelId, identity, id);
    },
    /** A bot-user fallback send, which is a different Discord author than the webhook. */
    deliverBotMessage(): void {
      lastMessageId = nextId();
      recordChannelDeliveredBotMessage(channelId);
    },
    /** Anyone else posting: a user, or another persona's webhook. */
    foreignMessage(): void {
      lastMessageId = nextId();
    },
  };
}

describe("StreamSegmentProcessor sprite group-break naming", () => {
  // Continuity is module-level and channel-scoped, so it deliberately outlives any one
  // stream which means tests must clear it explicitly rather than rely on fresh state.
  beforeEach(() => {
    clearAllChannelDeliveryContinuity();
  });

  it("keeps the first sprite clean so the group-break name never appears unnecessarily", () => {
    const resolve = makeResolver();
    const channel = makeChannel();

    const result = resolve(cleanIdentity, decoratedFor("imagining"), "imagining", CHANNEL, channel.lastMessageId);

    expect(result.username).toBe(CLEAN);
  });

  it("alternates clean/group-break so adjacent different sprites never share a username", () => {
    const resolve = makeResolver();
    const channel = makeChannel();
    const send = (sprite: string): string | undefined => {
      const identity = resolve(cleanIdentity, decoratedFor(sprite), sprite, CHANNEL, channel.lastMessageId);
      channel.deliverWebhook(identity);
      return identity.username;
    };

    // First sprite stays clean.
    expect(send("imagining")).toBe(CLEAN);
    // Sprite change collides with the previous clean name, so it takes the group-break name.
    expect(send("mad")).toBe(GROUP_BREAK);
    // Another change flips back to clean (still distinct from the prior group-break name).
    expect(send("imagining")).toBe(CLEAN);
    // And back to the group-break name.
    expect(send("mad")).toBe(GROUP_BREAK);
  });

  it("keeps a consecutive run of the same sprite on one identical username so Discord still groups it", () => {
    const resolve = makeResolver();
    const channel = makeChannel();
    const send = (sprite: string): string | undefined => {
      const identity = resolve(cleanIdentity, decoratedFor(sprite), sprite, CHANNEL, channel.lastMessageId);
      channel.deliverWebhook(identity);
      return identity.username;
    };

    // Same sprite twice: both clean, identical → they group under one avatar.
    expect(send("mad")).toBe(CLEAN);
    expect(send("mad")).toBe(CLEAN);

    // Switch sprite to the group-break name, then repeat it: identical names still group.
    expect(send("imagining")).toBe(GROUP_BREAK);
    expect(send("imagining")).toBe(GROUP_BREAK);
  });

  it("only rewrites the username, leaving the resolved avatar untouched", () => {
    const resolve = makeResolver();
    const channel = makeChannel();

    const primed = resolve(cleanIdentity, decoratedFor("imagining"), "imagining", CHANNEL, channel.lastMessageId);
    channel.deliverWebhook(primed);
    const groupBreak = resolve(cleanIdentity, decoratedFor("mad"), "mad", CHANNEL, channel.lastMessageId);

    expect(groupBreak.username).toBe(GROUP_BREAK);
    expect(groupBreak.avatarUrl).toBe(cleanIdentity.avatarUrl);
    // The clean source identity must not be mutated in place.
    expect(cleanIdentity.username).toBe(CLEAN);
  });

  /**
   * Regression: the alternation used to live in StreamState, which is rebuilt for every SDK
   * call. A queued turn therefore saw its first sprite as "the channel's first" and kept the
   * clean name, so colliding with the previous turn's final sprite, which Discord then grouped
   * under one avatar. A separate resolver instance stands in for the new turn's stream.
   */
  it("carries the alternation across turn boundaries in the same channel", () => {
    const channel = makeChannel();

    const firstTurn = makeResolver();
    const first = firstTurn(cleanIdentity, decoratedFor("mad"), "mad", CHANNEL, channel.lastMessageId);
    expect(first.username).toBe(CLEAN);
    channel.deliverWebhook(first);

    // New turn, new processor/stream, but the same channel with our message still last, so a
    // sprite CHANGE must still break the group rather than restart on the clean name.
    const queuedTurn = makeResolver();
    expect(queuedTurn(cleanIdentity, decoratedFor("shy"), "shy", CHANNEL, channel.lastMessageId).username).toBe(
      GROUP_BREAK,
    );
  });

  /**
   * Regression: the suffix is a collision breaker, not an emotion display. Discord groups a
   * message only with the one directly above it, so once anyone else has posted there is
   * nothing to collide with and the group-break name is unnecessary.
   */
  it("restarts on the clean name when another author posted since our last delivery", () => {
    const resolve = makeResolver();
    const channel = makeChannel();

    const first = resolve(cleanIdentity, decoratedFor("mad"), "mad", CHANNEL, channel.lastMessageId);
    expect(first.username).toBe(CLEAN);
    channel.deliverWebhook(first);

    channel.foreignMessage();

    expect(resolve(cleanIdentity, decoratedFor("shy"), "shy", CHANNEL, channel.lastMessageId).username).toBe(CLEAN);
  });

  it("still breaks the group for a sprite change directly following our own message", () => {
    const resolve = makeResolver();
    const channel = makeChannel();

    const first = resolve(cleanIdentity, decoratedFor("mad"), "mad", CHANNEL, channel.lastMessageId);
    channel.deliverWebhook(first);
    channel.foreignMessage();

    // Someone spoke, so this one restarts clean...
    const afterForeign = resolve(cleanIdentity, decoratedFor("shy"), "shy", CHANNEL, channel.lastMessageId);
    expect(afterForeign.username).toBe(CLEAN);
    channel.deliverWebhook(afterForeign);

    // ...but the next sprite change is adjacent to our own message and must still break.
    expect(resolve(cleanIdentity, decoratedFor("mad"), "mad", CHANNEL, channel.lastMessageId).username).toBe(
      GROUP_BREAK,
    );
  });

  /**
   * A bot-user message is a different Discord author than the webhook, so it breaks the webhook
   * group just as a foreign message does even though we sent it.
   */
  it("restarts on the clean name after our own bot-user fallback message", () => {
    const resolve = makeResolver();
    const channel = makeChannel();

    const first = resolve(cleanIdentity, decoratedFor("mad"), "mad", CHANNEL, channel.lastMessageId);
    channel.deliverWebhook(first);
    channel.deliverBotMessage();

    expect(resolve(cleanIdentity, decoratedFor("shy"), "shy", CHANNEL, channel.lastMessageId).username).toBe(CLEAN);
  });

  /**
   * `channel.lastMessageId` is maintained from the gateway MESSAGE_CREATE dispatch, which can lag
   * a send we just made. Reading a stale (older) id must not be mistaken for a broken group, or
   * back-to-back sprites in one reply would collapse under a single avatar.
   */
  it("treats a lagging lastMessageId as adjacent rather than as a foreign message", () => {
    const resolve = makeResolver();
    const channel = makeChannel();

    const staleId = channel.lastMessageId;
    const first = resolve(cleanIdentity, decoratedFor("mad"), "mad", CHANNEL, staleId);
    channel.deliverWebhook(first);

    // The gateway has not caught up, so the channel still reports the pre-send id.
    expect(resolve(cleanIdentity, decoratedFor("shy"), "shy", CHANNEL, staleId).username).toBe(GROUP_BREAK);
  });

  it("tracks channels independently so one channel's sprite run cannot skew another's", () => {
    const resolve = makeResolver();
    const otherChannelId = "1382235263668846613";
    const channel = makeChannel();
    const otherChannel = makeChannel(otherChannelId);

    const first = resolve(cleanIdentity, decoratedFor("mad"), "mad", CHANNEL, channel.lastMessageId);
    expect(first.username).toBe(CLEAN);
    channel.deliverWebhook(first);

    // A different channel starts its own run: first sprite there is still clean.
    const otherFirst = resolve(cleanIdentity, decoratedFor("shy"), "shy", otherChannelId, otherChannel.lastMessageId);
    expect(otherFirst.username).toBe(CLEAN);
    otherChannel.deliverWebhook(otherFirst);

    // The original channel's alternation is unaffected by the interleaved channel.
    expect(resolve(cleanIdentity, decoratedFor("shy"), "shy", CHANNEL, channel.lastMessageId).username).toBe(
      GROUP_BREAK,
    );
  });

  it("falls back to the visible suffix when the name has no swappable letter", () => {
    const resolve = makeResolver();
    const channel = makeChannel();
    const kanaIdentity: ResolvedWebhookIdentity = { ...cleanIdentity, username: "ともり" };
    const kanaDecorated = "ともり (mad)";

    channel.deliverWebhook(resolve(kanaIdentity, "ともり (shy)", "shy", CHANNEL, channel.lastMessageId));

    expect(resolve(kanaIdentity, kanaDecorated, "mad", CHANNEL, channel.lastMessageId).username).toBe(kanaDecorated);
  });
});
