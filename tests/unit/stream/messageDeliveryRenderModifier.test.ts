import { describe, expect, it, spyOn } from "bun:test";
import { HumanizerDegree } from "@/types/db/schema";
import type { StreamContext } from "@/types/stream/interfaces";
import {
  createDefaultStreamState,
  type TextProcessingConfig,
  type TypingSimulationConfig,
  VisibleDeliveryMode,
} from "@/types/stream/types";
import { StreamMessageDelivery } from "@/utils/discord/stream/messageDelivery";
import { StreamUiUpdater, type StreamSendPayload } from "@/utils/discord/stream/uiUpdater";

function textConfig(visibleDeliveryMode = VisibleDeliveryMode.STREAMING): TextProcessingConfig {
  return {
    humanizerDegree: HumanizerDegree.NONE,
    visibleDeliveryMode,
    emojiUsageEnabled: true,
    emojiStrings: [],
    botName: "Ren",
    botNameAliases: [],
    registeredSpeakerNamesLower: new Set(),
    maxMessageLength: 2000,
  };
}

const typingConfig: TypingSimulationConfig = {
  enabled: false,
  baseSpeedMsPerChar: 0,
  maxTypingTimeMs: 0,
  minVisibleDurationMs: 0,
  randomPauseEnabled: false,
  thinkingPauseChance: 0,
};

const context = {
  channel: { id: "channel_1" },
  tomoriState: {
    config: {},
  },
} as StreamContext;

/**
 * The real updater with only the send intercepted: the delivery calls nothing else on it, so the
 * recorded calls are exactly what production would have handed to Discord.
 */
function makeDelivery(onPayload: (payload: StreamSendPayload, textForState: string) => void): StreamMessageDelivery {
  const uiUpdater = new StreamUiUpdater({
    hasStopRequest: () => false,
    requestStop: () => true,
    notifyStreamProgress: () => undefined,
  });
  uiUpdater.sendSinglePayload = async (payload, textForState) => {
    onPayload(payload, textForState);
    return null;
  };
  return new StreamMessageDelivery({ hasStopRequest: () => false, uiUpdater });
}

describe("StreamMessageDelivery copied-render options", () => {
  it("passes identity overrides and accumulated text prefixes to the UI updater", async () => {
    const sentPayloads: Array<{ payload: StreamSendPayload; textForState: string }> = [];
    const delivery = makeDelivery((payload, textForState) => {
      sentPayloads.push({ payload, textForState });
    });

    // Copied identities flip the Discord display name ("Obonya (Ren)") while
    // the accumulated-text prefix stays source-persona-first for the model.
    await delivery.sendSegment("hi", "period", textConfig(), typingConfig, context, createDefaultStreamState(), {
      identityOverride: {
        username: "Obonya (Ren)",
        avatarUrl: "https://example.com/avatar.png",
      },
      accumulatedTextPrefix: "Ren (Obonya): ",
    });

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0].payload.identityOverride?.username).toBe("Obonya (Ren)");
    expect(sentPayloads[0].payload.identityOverride?.avatarUrl).toBe("https://example.com/avatar.png");
    expect(sentPayloads[0].payload.accumulatedTextPrefix).toBe("Ren (Obonya): ");
    expect(sentPayloads[0].textForState).toBe("hi");
  });

  it("passes sprite records with a clean username and decorated accumulated prefix", async () => {
    const sentPayloads: Array<{ payload: StreamSendPayload; textForState: string }> = [];
    const delivery = makeDelivery((payload, textForState) => {
      sentPayloads.push({ payload, textForState });
    });

    // Sprite renders keep the webhook username clean ("Ren"); the decorated
    // label only appears in the accumulated-text prefix, and the sprite record
    // rides along for post-send persistence.
    await delivery.sendSegment("grr", "period", textConfig(), typingConfig, context, createDefaultStreamState(), {
      identityOverride: {
        username: "Ren",
        avatarUrl: "https://example.com/sprites/mad.png",
      },
      accumulatedTextPrefix: "Ren (mad): ",
      spriteRecord: { personaId: 42, spriteName: "mad", isIdentity: false },
    });

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0].payload.identityOverride?.username).toBe("Ren");
    expect(sentPayloads[0].payload.accumulatedTextPrefix).toBe("Ren (mad): ");
    expect(sentPayloads[0].payload.spriteRecord).toEqual({ personaId: 42, spriteName: "mad", isIdentity: false });
  });

  it("flushes aggregate-mode bot text before sending a copied-render override", async () => {
    const sentPayloads: StreamSendPayload[] = [];
    const delivery = makeDelivery((payload) => {
      sentPayloads.push(payload);
    });
    const state = createDefaultStreamState();
    state.pendingAggregatedText = "plain bot text";

    await delivery.sendSegment(
      "copied text",
      "period",
      textConfig(VisibleDeliveryMode.AGGREGATED_PHASE),
      typingConfig,
      context,
      state,
      {
        identityOverride: {
          username: "Obonya (Ren)",
        },
        accumulatedTextPrefix: "Ren (Obonya): ",
      },
    );

    expect(sentPayloads).toHaveLength(2);
    expect(sentPayloads[0]).toMatchObject({ content: "plain bot text" });
    expect(sentPayloads[0].identityOverride).toBeUndefined();
    expect(sentPayloads[1]).toMatchObject({
      content: "copied text",
      accumulatedTextPrefix: "Ren (Obonya): ",
    });
    expect(sentPayloads[1].identityOverride?.username).toBe("Obonya (Ren)");
  });

  it("marks message-length and heavy-humanizer splits at the delivery boundary", async () => {
    const sentPayloads: StreamSendPayload[] = [];
    const delivery = makeDelivery((payload) => sentPayloads.push(payload));
    const shortConfig = textConfig();
    shortConfig.maxMessageLength = 30;

    await delivery.sendSegment(
      "A long sentence about apples and pears that continues past the message limit.",
      "final",
      shortConfig,
      typingConfig,
      context,
      createDefaultStreamState(),
    );
    expect(sentPayloads.length).toBeGreaterThan(1);
    expect(sentPayloads[0]?.diagnosticReason).toBe("stream_segment");
    expect(sentPayloads.slice(1).every((payload) => payload.diagnosticReason === "length_split")).toBe(true);

    sentPayloads.length = 0;
    const heavyConfig = textConfig();
    heavyConfig.humanizerDegree = HumanizerDegree.HEAVY;
    // Emphasis flushing in humanizeString rolls against EMPHASIS_FLUSH_PROBABILITY (0.5), so mock below the threshold for deterministic splits.
    const randomSpy = spyOn(Math, "random").mockReturnValue(0);
    try {
      await delivery.sendSegment(
        "really? ok! bye",
        "final",
        heavyConfig,
        typingConfig,
        context,
        createDefaultStreamState(),
      );
      expect(sentPayloads.length).toBeGreaterThan(1);
      expect(sentPayloads[0]?.diagnosticReason).toBe("stream_segment");
      expect(sentPayloads.slice(1).every((payload) => payload.diagnosticReason === "humanizer_split")).toBe(true);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
