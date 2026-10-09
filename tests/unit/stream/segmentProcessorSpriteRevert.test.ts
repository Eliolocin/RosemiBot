import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HumanizerDegree, type PersonaSpriteRow } from "@/types/db/schema";
import type { StreamContext } from "@/types/stream/interfaces";
import {
  createDefaultStreamState,
  type StreamState,
  type TextProcessingConfig,
  type TypingSimulationConfig,
  VisibleDeliveryMode,
} from "@/types/stream/types";
import { clearPersonaSpriteCache, setPersonaSpriteCache } from "@/utils/cache/personaSpriteCacheStore";
import {
  clearAllChannelDeliveryContinuity,
  recordChannelDeliveredBotMessage,
  recordChannelDeliveredWebhookIdentity,
} from "@/utils/discord/stream/channelDeliveryContinuity";
import type {
  BufferedDeliveryBoundary,
  StreamDeliveryOptions,
  StreamMessageDelivery,
} from "@/utils/discord/stream/messageDelivery";
import { StreamSegmentProcessor } from "@/utils/discord/stream/segmentProcessor";

const PERSONA_ID = 7;
const BASE_AVATAR = "https://example.com/locke.png";
// The final Latin "e" of "Locke" swapped for Cyrillic U+0435.
const LOCKE_GROUP_BREAK = `Lock${String.fromCodePoint(0x0435)}`;

function sprite(name: string, isIdentity = false): PersonaSpriteRow {
  const key = name.toLowerCase();
  return {
    sprite_id: key.length,
    persona_id: PERSONA_ID,
    sprite_name: name,
    sprite_key: key,
    avatar_url: `https://example.com/sprites/${key.replaceAll(" ", "-")}.png`,
    usage_instructions: "",
    is_identity: isIdentity,
  };
}

const textConfig: TextProcessingConfig = {
  humanizerDegree: HumanizerDegree.NONE,
  visibleDeliveryMode: VisibleDeliveryMode.STREAMING,
  emojiUsageEnabled: true,
  emojiStrings: [],
  botName: "Locke",
  botNameAliases: ["Lockie"],
  registeredSpeakerNamesLower: new Set(),
  maxMessageLength: 2000,
};

const typingConfig: TypingSimulationConfig = {
  enabled: false,
  baseSpeedMsPerChar: 0,
  maxTypingTimeMs: 0,
  minVisibleDurationMs: 0,
  randomPauseEnabled: false,
  thinkingPauseChance: 0,
};

type Sent = { text: string; options?: StreamDeliveryOptions };

/**
 * Runs segments through the real processor against a delivery stub that records what would reach
 * Discord. Each send is reported to the channel continuity the way recordSuccessfulSend reports it,
 * with a fresh snowflake, so the sprite group alternation sees real adjacency.
 */
function makeHarness(options: { isAlter: boolean }) {
  const channel = { id: "1382235263668846612", lastMessageId: null as string | null };
  let snowflake = 1400000000000000000n;
  const context = {
    channel,
    contextItems: [],
    tomoriState: {
      persona_id: PERSONA_ID,
      persona_nickname: "Locke",
      is_alter: options.isAlter,
      config: {},
    },
    ...(options.isAlter ? { webhook: {}, personaUsername: "Locke", personaAvatarUrl: BASE_AVATAR } : {}),
  } as unknown as StreamContext;

  const sent: Sent[] = [];
  const delivery = {
    sendSegment: async (
      text: string,
      _boundary: BufferedDeliveryBoundary | undefined,
      _textConfig: TextProcessingConfig,
      _typingConfig: TypingSimulationConfig,
      _context: StreamContext,
      state: StreamState,
      deliveryOptions?: StreamDeliveryOptions,
    ) => {
      sent.push({ text, options: deliveryOptions });
      // Non-empty accumulated text keeps the opening-label leak guard (which reads the database for
      // participant names) out of these runs; only the very first segment can reach it.
      state.accumulatedText += text;
      snowflake += 1n;
      channel.lastMessageId = snowflake.toString();
      const webhookIdentity =
        deliveryOptions?.identityOverride ??
        (options.isAlter ? { username: "Locke", avatarUrl: BASE_AVATAR } : undefined);
      if (webhookIdentity) {
        recordChannelDeliveredWebhookIdentity(channel.id, webhookIdentity, channel.lastMessageId);
      } else {
        recordChannelDeliveredBotMessage(channel.id);
      }
    },
  } as unknown as StreamMessageDelivery;

  const processor = new StreamSegmentProcessor({ delivery, requestStop: () => false });
  const state = createDefaultStreamState();

  return {
    sent,
    state,
    send: (segment: string, boundary: BufferedDeliveryBoundary = "newline") =>
      processor.sendBufferSegment(segment, boundary, textConfig, typingConfig, context, state),
  };
}

describe("StreamSegmentProcessor plain-label sprite revert", () => {
  beforeEach(() => {
    clearAllChannelDeliveryContinuity();
    setPersonaSpriteCache(PERSONA_ID, [sprite("smug"), sprite("mad"), sprite("The Voice", true)]);
  });

  afterEach(() => {
    clearPersonaSpriteCache();
    clearAllChannelDeliveryContinuity();
  });

  it("returns to the base persona when a line opens with the plain own-name label", async () => {
    const harness = makeHarness({ isAlter: false });

    await harness.send("Locke (smug): heh, nice try\n");
    await harness.send("Locke: I was *speaking*.\n");
    await harness.send("anyway\n");

    expect(harness.sent[0]?.options?.spriteRecord?.spriteName).toBe("smug");
    expect(harness.sent[1]?.text).toBe("I was *speaking*.");
    expect(harness.sent[1]?.options).toBeUndefined();
    expect(harness.sent[2]?.options).toBeUndefined();
    expect(harness.state.activeRenderModifier).toBeUndefined();
  });

  it("keeps the sprite across newlines when no plain label appears", async () => {
    const harness = makeHarness({ isAlter: false });

    await harness.send("Locke (mad): ARGH!\n");
    await harness.send("Fine...\n");

    expect(harness.sent[1]?.options?.spriteRecord?.spriteName).toBe("mad");
  });

  it("reverts from an identity sprite to the plain persona", async () => {
    const harness = makeHarness({ isAlter: false });

    await harness.send("Locke (The Voice): ||we want to be next.||\n");
    await harness.send("Locke: I was *speaking*.\n");

    expect(harness.sent[0]?.options?.identityOverride?.username).toBe("The Voice (Locke)");
    expect(harness.sent[1]?.text).toBe("I was *speaking*.");
    expect(harness.sent[1]?.options).toBeUndefined();
  });

  it("accepts alias and bold label forms", async () => {
    for (const label of ["Lockie:", "**Locke:**", "**Locke**:"]) {
      const harness = makeHarness({ isAlter: false });

      await harness.send("Locke (smug): heh\n");
      await harness.send(`${label} back to normal\n`);

      expect(harness.sent[1]?.text).toBe("back to normal");
      expect(harness.sent[1]?.options).toBeUndefined();
    }
  });

  it("does not revert on a label that is not at the start of a line", async () => {
    const harness = makeHarness({ isAlter: false });

    await harness.send("Locke (smug): heh\n");
    await harness.send("Note: Locke: is still smug\n");
    // A sentence flush leaves the next segment mid-line, so its leading label is prose.
    await harness.send("Right. ", "period");
    await harness.send("Locke: still smug\n");

    expect(harness.sent[1]?.options?.spriteRecord?.spriteName).toBe("smug");
    expect(harness.sent[3]?.options?.spriteRecord?.spriteName).toBe("smug");
  });

  it("keeps the active sprite on code-block segments sent while the block is still open", async () => {
    for (const isAlter of [false, true]) {
      const harness = makeHarness({ isAlter });

      await harness.send("Locke (smug): here you go\n");
      // The flusher sends closing-fence and overflow segments before it clears isInsideCodeBlock.
      harness.state.isInsideCodeBlock = true;
      await harness.send("```js\nconsole.log(1);\n", "overflow");
      await harness.send("Locke: not a revert\n```", "code_close");
      harness.state.isInsideCodeBlock = false;
      await harness.send("done\n");

      expect(harness.sent.map((entry) => entry.options?.spriteRecord?.spriteName)).toEqual([
        "smug",
        "smug",
        "smug",
        "smug",
      ]);
      expect(harness.state.activeRenderModifier?.spriteRecord?.spriteName).toBe("smug");
    }
  });

  it("delivers an alter's revert under the group-break name when the sprite held the clean name", async () => {
    const harness = makeHarness({ isAlter: true });

    await harness.send("Locke (smug): heh\n");
    await harness.send("Locke: I was speaking.\n");
    await harness.send("still me\n");
    await harness.send("Locke (smug): heh again\n");

    expect(harness.sent[0]?.options?.identityOverride?.username).toBe("Locke");
    expect(harness.sent[1]?.options?.identityOverride).toEqual({
      username: LOCKE_GROUP_BREAK,
      avatarUrl: BASE_AVATAR,
      avatarDataUri: undefined,
    });
    expect(harness.sent[1]?.options?.spriteRecord).toBeUndefined();
    expect(harness.sent[2]?.options?.identityOverride?.username).toBe(LOCKE_GROUP_BREAK);
    expect(harness.sent[3]?.options?.identityOverride?.username).toBe("Locke");
  });

  it("delivers an alter's revert on the plain base identity when the sprite already used the group-break name", async () => {
    const harness = makeHarness({ isAlter: true });

    await harness.send("Locke (smug): heh\n");
    await harness.send("Locke (mad): grr\n");
    await harness.send("Locke: calm now\n");

    expect(harness.sent[1]?.options?.identityOverride?.username).toBe(LOCKE_GROUP_BREAK);
    expect(harness.sent[2]?.options).toBeUndefined();
  });
});
