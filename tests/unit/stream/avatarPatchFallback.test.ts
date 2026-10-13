import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { RateLimitError, type RateLimitData, type Webhook } from "discord.js";
import type { StreamContext } from "@/types/stream/interfaces";
import { createDefaultStreamState } from "@/types/stream/types";
import { personaSpriteMessageRepository } from "@/utils/db/repositories/PersonaSpriteMessageRepository";
import { resolveAvatarPatchFallback } from "@/utils/discord/stream/avatarPatchFallback";
import {
  type ChannelLastDelivery,
  clearAllChannelDeliveryContinuity,
  type DeliveredSpeaker,
  getChannelLastDelivery,
  recordChannelDeliveredBotMessage,
  recordChannelDeliveredWebhookIdentity,
} from "@/utils/discord/stream/channelDeliveryContinuity";
import { StreamUiUpdater } from "@/utils/discord/stream/uiUpdater";
import { shouldRejectWebhookRateLimit } from "@/utils/discord/webhook/avatarEditRateLimit";
import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import { clearWebhookCache } from "@/utils/discord/webhook/webhookCore";

const LOCKE = 666;
const OTHER_PERSONA = 777;
const CHANNEL = "1489193833840377856";
const BOT_AVATAR = "https://cdn.discordapp.com/avatars/1/bot.png";
const COMPOSED = "data:image/png;base64,Q09NUE9TRUQ=";
const MAD = "data:image/png;base64,TUFE";
const VOICE = "data:image/png;base64,Vk9JQ0U=";

const appearance = (personaId: number | null): DeliveredSpeaker => ({ personaId, kind: "appearance" });
const identitySprite = (personaId: number): DeliveredSpeaker => ({ personaId, kind: "identity_sprite" });
const copied = (personaId: number): DeliveredSpeaker => ({ personaId, kind: "copied" });

const viaWebhook = (speaker: DeliveredSpeaker | null, identity: ResolvedWebhookIdentity): ChannelLastDelivery => ({
  via: "webhook",
  identity,
  speaker,
});

const intended = { username: "Locke", avatarDataUri: MAD };

describe("resolveAvatarPatchFallback eligibility", () => {
  it("falls back between two ordinary appearances of the same persona", () => {
    const previous = viaWebhook(appearance(LOCKE), { username: "Locke", avatarDataUri: COMPOSED });

    expect(resolveAvatarPatchFallback(intended, appearance(LOCKE), previous, COMPOSED, BOT_AVATAR)).toEqual({
      identity: { username: "Locke", avatarDataUri: COMPOSED },
      source: "stored_avatar",
    });
  });

  it("falls back to the bot's own avatar after a main-persona bot-user line", () => {
    const previous: ChannelLastDelivery = { via: "bot", speaker: appearance(LOCKE) };

    expect(resolveAvatarPatchFallback(intended, appearance(LOCKE), previous, undefined, BOT_AVATAR)).toEqual({
      identity: { username: "Locke", avatarUrl: BOT_AVATAR },
      source: "bot_avatar",
    });
  });

  it("waits for an identity sprite, whatever came before", () => {
    const previous = viaWebhook(appearance(LOCKE), { username: "Locke", avatarDataUri: COMPOSED });
    const voice = { username: "The Voice (Locke)", avatarDataUri: VOICE };

    expect(resolveAvatarPatchFallback(voice, identitySprite(LOCKE), previous, COMPOSED, BOT_AVATAR)).toBeNull();
  });

  it("waits when reverting from an identity sprite to an ordinary appearance", () => {
    const previous = viaWebhook(identitySprite(LOCKE), { username: "The Voice (Locke)", avatarDataUri: VOICE });

    expect(resolveAvatarPatchFallback(intended, appearance(LOCKE), previous, VOICE, BOT_AVATAR)).toBeNull();
  });

  it("waits after a copied identity, even one whose avatar was a free https URL", () => {
    const previous = viaWebhook(copied(LOCKE), {
      username: "Obonya (Locke)",
      avatarUrl: "https://cdn.discordapp.com/avatars/2/user.png",
    });

    expect(resolveAvatarPatchFallback(intended, appearance(LOCKE), previous, COMPOSED, BOT_AVATAR)).toBeNull();
  });

  it("never uses a copied identity as the line being rescued", () => {
    const previous = viaWebhook(appearance(LOCKE), { username: "Locke", avatarDataUri: COMPOSED });
    const copiedPersona = { username: "Ren (Locke)", avatarDataUri: MAD };

    expect(resolveAvatarPatchFallback(copiedPersona, copied(LOCKE), previous, COMPOSED, BOT_AVATAR)).toBeNull();
  });

  /** Two alters deliver through one channel webhook, so A's face would sit under B's name. */
  it("waits between two different personas sharing the webhook", () => {
    const previous = viaWebhook(appearance(OTHER_PERSONA), { username: "Locke", avatarDataUri: COMPOSED });

    expect(resolveAvatarPatchFallback(intended, appearance(LOCKE), previous, COMPOSED, BOT_AVATAR)).toBeNull();
  });

  it("compares personas by id, not by a username that happens to match", () => {
    const previous = viaWebhook(appearance(OTHER_PERSONA), { username: "Locke", avatarUrl: "https://x.invalid/a.png" });

    expect(resolveAvatarPatchFallback(intended, appearance(LOCKE), previous, undefined, BOT_AVATAR)).toBeNull();
  });

  it("waits when nothing is recorded or the record names no persona", () => {
    expect(resolveAvatarPatchFallback(intended, appearance(LOCKE), null, COMPOSED, BOT_AVATAR)).toBeNull();

    const unknownPrevious: ChannelLastDelivery = { via: "bot", speaker: appearance(null) };
    expect(resolveAvatarPatchFallback(intended, appearance(null), unknownPrevious, undefined, BOT_AVATAR)).toBeNull();
    expect(resolveAvatarPatchFallback(intended, appearance(LOCKE), unknownPrevious, undefined, BOT_AVATAR)).toBeNull();
  });

  it("resends a previous https avatar per message", () => {
    const previous = viaWebhook(appearance(LOCKE), { username: "Locke", avatarUrl: "https://x.invalid/joy.png" });

    expect(resolveAvatarPatchFallback(intended, appearance(LOCKE), previous, COMPOSED, BOT_AVATAR)).toEqual({
      identity: { username: "Locke", avatarUrl: "https://x.invalid/joy.png" },
      source: "previous_url",
    });
  });

  /** Sending without an avatar shows whatever the webhook stores, which is no longer the last face. */
  it("waits when the previous data URI is not what the webhook stores", () => {
    const previous = viaWebhook(appearance(LOCKE), { username: "Locke", avatarDataUri: COMPOSED });

    expect(resolveAvatarPatchFallback(intended, appearance(LOCKE), previous, VOICE, BOT_AVATAR)).toBeNull();
    expect(resolveAvatarPatchFallback(intended, appearance(LOCKE), previous, undefined, BOT_AVATAR)).toBeNull();
  });
});

describe("channel last delivery", () => {
  beforeEach(() => {
    clearAllChannelDeliveryContinuity();
  });

  it("tells a bot-user delivery apart from a channel with nothing recorded", () => {
    expect(getChannelLastDelivery(CHANNEL)).toBeNull();

    recordChannelDeliveredBotMessage(CHANNEL, appearance(LOCKE));
    expect(getChannelLastDelivery(CHANNEL)).toEqual({ via: "bot", speaker: appearance(LOCKE) });
  });

  /** Continuity is per channel and spans turns, so a queued alter chain still sees the previous alter. */
  it("carries the previous speaker across turns until replaced", () => {
    recordChannelDeliveredWebhookIdentity(CHANNEL, { username: "Alter A" }, "1", appearance(OTHER_PERSONA));
    expect(getChannelLastDelivery(CHANNEL)).toMatchObject({ via: "webhook", speaker: appearance(OTHER_PERSONA) });

    recordChannelDeliveredWebhookIdentity(CHANNEL, { username: "Locke" }, "2", appearance(LOCKE));
    expect(getChannelLastDelivery(CHANNEL)).toMatchObject({ via: "webhook", speaker: appearance(LOCKE) });
  });
});

describe("stream sends under a rate-limited avatar edit", () => {
  const LONG_LIMIT: RateLimitData = {
    global: false,
    method: "PATCH",
    url: "https://discord.com/api/v10/webhooks/1/token",
    route: "/webhooks/:id/:token",
    majorParameter: "1/token",
    hash: "hash",
    limit: 2,
    timeToReset: 60_000,
    retryAfter: 60_000,
    sublimitTimeout: 0,
    scope: "user",
  };

  let recordSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    clearAllChannelDeliveryContinuity();
    clearWebhookCache();
    recordSpy = spyOn(personaSpriteMessageRepository, "record").mockResolvedValue(false);
  });

  afterEach(() => {
    recordSpy.mockRestore();
    clearWebhookCache();
  });

  /**
   * The edit consults the real client predicate, so it rejects inside a deferrable scope and
   * otherwise resolves, which is what discord.js does after waiting out the bucket.
   */
  function makeHarness(options: { isAlter?: boolean; personaId?: number } = {}) {
    const rate = { limited: false };
    const edits: unknown[] = [];
    const webhookSends: Array<Record<string, unknown>> = [];
    let nextId = 1500000000000000000n;
    const webhook = {
      id: "1600000000000000000",
      channelId: CHANNEL,
      avatar: null,
      async edit(editOptions: unknown) {
        if (rate.limited && shouldRejectWebhookRateLimit(LONG_LIMIT)) throw new RateLimitError(LONG_LIMIT);
        edits.push(editOptions);
        return webhook;
      },
      async send(payload: Record<string, unknown>) {
        webhookSends.push(payload);
        nextId++;
        return { id: nextId.toString(), channelId: CHANNEL, webhookId: webhook.id };
      },
    };
    const botSends: unknown[] = [];
    const context = {
      channel: {
        id: CHANNEL,
        lastMessageId: null,
        guild: { members: { me: { displayAvatarURL: () => BOT_AVATAR } } },
        send: async (payload: unknown) => {
          botSends.push(payload);
          nextId++;
          return { id: nextId.toString(), channelId: CHANNEL, webhookId: null };
        },
      },
      client: { user: { id: "1" } },
      webhook: webhook as unknown as Webhook,
      locale: "en-US",
      suppressUserErrors: false,
      tomoriState: { persona_id: options.personaId ?? LOCKE, is_alter: options.isAlter ?? false, config: {} },
    } as unknown as StreamContext;
    const updater = new StreamUiUpdater({
      hasStopRequest: () => false,
      requestStop: () => true,
      notifyStreamProgress: () => undefined,
    });
    const state = createDefaultStreamState();
    state.hasRepliedToOriginalMessage = true;

    const sendSprite = (spriteName: string, avatarDataUri: string, isIdentity = false, username = "Locke") =>
      updater.sendSinglePayload(
        {
          content: `${spriteName} line`,
          identityOverride: { username, avatarDataUri },
          spriteRecord: { personaId: options.personaId ?? LOCKE, spriteName, isIdentity },
        },
        `${spriteName} line`,
        context,
        state,
      );

    return { rate, edits, webhookSends, botSends, updater, context, state, sendSprite };
  }

  it("delivers an ordinary sprite change under the previous sprite instead of waiting", async () => {
    const harness = makeHarness();
    await harness.sendSprite("composed", COMPOSED);
    harness.rate.limited = true;

    await harness.sendSprite("mad", MAD);

    expect(harness.edits).toHaveLength(1);
    expect(harness.webhookSends).toHaveLength(2);
    expect(harness.webhookSends[1]).toMatchObject({ username: "Locke" });
    expect(harness.webhookSends[1]).not.toHaveProperty("avatarURL");
    // The recorded delivery is what Discord showed; the sprite record keeps the sprite the model chose.
    expect(getChannelLastDelivery(CHANNEL)).toMatchObject({ via: "webhook", identity: { avatarDataUri: COMPOSED } });
    expect(harness.state.spritesShown.at(-1)).toEqual({ name: "mad", isIdentity: false });
    expect(recordSpy.mock.calls.at(-1)?.[0]).toMatchObject({ spriteName: "mad" });
  });

  it("waits for an identity sprite rather than show the persona's face under its name", async () => {
    const harness = makeHarness();
    await harness.sendSprite("composed", COMPOSED);
    harness.rate.limited = true;

    await harness.sendSprite("the voice", VOICE, true, "The Voice (Locke)");

    expect(harness.edits).toHaveLength(2);
    expect(harness.edits[1]).toMatchObject({ avatar: VOICE });
    expect(getChannelLastDelivery(CHANNEL)).toMatchObject({ identity: { avatarDataUri: VOICE } });
  });

  it("falls back to the bot's avatar after a main-persona plain line", async () => {
    const harness = makeHarness();
    await harness.updater.sendSinglePayload({ content: "plain" }, "plain", harness.context, harness.state);
    harness.rate.limited = true;

    await harness.sendSprite("mad", MAD);

    expect(harness.botSends).toHaveLength(1);
    expect(harness.edits).toHaveLength(0);
    expect(harness.webhookSends[0]).toMatchObject({ username: "Locke", avatarURL: BOT_AVATAR });
  });

  it("waits when the channel has no recorded delivery", async () => {
    const harness = makeHarness();
    harness.rate.limited = true;

    await harness.sendSprite("mad", MAD);

    expect(harness.edits).toHaveLength(1);
    expect(harness.webhookSends[0]).not.toHaveProperty("avatarURL");
  });

  it("waits when a different persona delivered last through the same webhook", async () => {
    const alterA = makeHarness({ isAlter: true, personaId: OTHER_PERSONA });
    await alterA.sendSprite("composed", COMPOSED);

    const alterB = makeHarness({ isAlter: true });
    // Both harnesses stand for one channel webhook, so B's webhook stores A's avatar.
    alterB.context.webhook = alterA.context.webhook;
    alterA.rate.limited = true;

    await alterB.sendSprite("mad", MAD);

    expect(alterA.edits).toHaveLength(2);
    expect(alterA.edits[1]).toMatchObject({ avatar: MAD });
  });
});
