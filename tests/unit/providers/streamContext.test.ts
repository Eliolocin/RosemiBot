import { describe, expect, it } from "bun:test";
import type { Client, TextChannel, Webhook } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import type { StreamingContext } from "@/types/tool/interfaces";
import type { MessageIdMap } from "@/utils/text/messageIdMap";
import { type BuildStreamContextParams, buildStreamContext } from "@/utils/provider/streamContext";

// Minimal Discord/Tomori stand-ins: the helper only shuttles references, never invokes them.
const CHANNEL = { id: "channel_1" } as unknown as TextChannel;
const CLIENT = {} as Client;
const TOMORI_STATE = { server_id: 1, config: {} } as unknown as TomoriState;

/**
 * Build the minimal required params, letting each test override specifics.
 */
function makeParams(overrides: Partial<BuildStreamContextParams> = {}): BuildStreamContextParams {
  return {
    provider: "google",
    channel: CHANNEL,
    client: CLIENT,
    tomoriState: TOMORI_STATE,
    contextItems: [],
    currentTurnModelParts: [],
    ...overrides,
  };
}

describe("buildStreamContext", () => {
  it("copies common copy-through fields from the streaming context", () => {
    const messageIdMap = { resolve: () => undefined } as unknown as MessageIdMap;
    const replyNoticeState = { attempted: false, sent: false };
    const forcedMentions = [{ handle: "@alice", userId: "42" }];
    const abortSignal = new AbortController().signal;

    const streamingContext: StreamingContext = {
      disableYouTubeProcessing: false,
      suppressUserErrors: true,
      suppressTextOutput: true,
      rotationKeyRetriesUsed: true,
      outputPrefill: "prefix ",
      replyNoticeState,
      forcedMentions,
      naiContinuationPrefill: "…mid-sentence",
      abortSignal,
      messageIdMap,
    };

    const ctx = buildStreamContext(makeParams({ provider: "novelai", streamingContext }));

    expect(ctx.provider).toBe("novelai");
    expect(ctx.suppressUserErrors).toBe(true);
    expect(ctx.suppressTextOutput).toBe(true);
    expect(ctx.rotationKeyRetriesUsed).toBe(true);
    expect(ctx.outputPrefill).toBe("prefix ");
    expect(ctx.replyNoticeState).toBe(replyNoticeState);
    expect(ctx.forcedMentions).toBe(forcedMentions);
    expect(ctx.naiContinuationPrefill).toBe("…mid-sentence");
    expect(ctx.abortSignal).toBe(abortSignal);
    expect(ctx.messageIdMap).toBe(messageIdMap);
  });

  it("applies the en-US locale fallback when userLocale is absent", () => {
    expect(buildStreamContext(makeParams()).locale).toBe("en-US");
    expect(buildStreamContext(makeParams({ userLocale: "ja" })).locale).toBe("ja");
  });

  it("preserves webhook and persona identity fields", () => {
    const webhook = { id: "wh_1" } as unknown as Webhook;

    const ctx = buildStreamContext(
      makeParams({
        webhook,
        personaAvatarUrl: "https://example.test/avatar.png",
        personaUsername: "Alter",
        prefixStrippingName: "Alter Prime",
      }),
    );

    expect(ctx.webhook).toBe(webhook);
    expect(ctx.personaAvatarUrl).toBe("https://example.test/avatar.png");
    expect(ctx.personaUsername).toBe("Alter");
    expect(ctx.prefixStrippingName).toBe("Alter Prime");
  });

  it("leaves optional fields undefined when no streaming context is supplied", () => {
    const ctx = buildStreamContext(makeParams());

    expect(ctx.suppressUserErrors).toBeUndefined();
    expect(ctx.suppressTextOutput).toBeUndefined();
    expect(ctx.rotationKeyRetriesUsed).toBeUndefined();
    expect(ctx.outputPrefill).toBeUndefined();
    expect(ctx.replyNoticeState).toBeUndefined();
    expect(ctx.forcedMentions).toBeUndefined();
    expect(ctx.naiContinuationPrefill).toBeUndefined();
    expect(ctx.abortSignal).toBeUndefined();
    expect(ctx.messageIdMap).toBeUndefined();
    expect(ctx.webhook).toBeUndefined();
    expect(ctx.personaUsername).toBeUndefined();
  });

  it("passes through Discord and application context by reference", () => {
    const contextItems: BuildStreamContextParams["contextItems"] = [];
    const currentTurnModelParts = [{ text: "hi" }];

    const ctx = buildStreamContext(makeParams({ contextItems, currentTurnModelParts }));

    expect(ctx.channel).toBe(CHANNEL);
    expect(ctx.client).toBe(CLIENT);
    expect(ctx.tomoriState).toBe(TOMORI_STATE);
    expect(ctx.contextItems).toBe(contextItems);
    expect(ctx.currentTurnModelParts).toBe(currentTurnModelParts);
  });
});
