import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Client, TextChannel } from "discord.js";
import { HumanizerDegree } from "@/types/db/schema";
import type { ProcessedChunk, StreamConfig, StreamContext, StreamProvider } from "@/types/stream/interfaces";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { createPersona } from "../../helpers/fixtures";

const config: StreamConfig = {
  model: "fixture",
  apiKey: "",
  temperature: 1,
  maxMessageLength: 1950,
  flushBufferSize: 1000,
  flushBufferSizeCodeBlock: 15000,
  inactivityTimeoutMs: 10000,
  baseTypeSpeedMsPerChar: 0,
  maxTypingTimeMs: 0,
  minVisibleTypingDurationMs: 0,
  humanizerDegree: HumanizerDegree.NONE,
  emojiUsageEnabled: true,
};

function fixture(chunks: ProcessedChunk[], holdResponseText = true) {
  const send = mock(async (_payload: unknown) => ({ id: "sent_1", url: "", author: { id: "bot_1" } }));
  const context: StreamContext = {
    channel: { id: "pending_fixture", send, isThread: () => false } as unknown as TextChannel,
    client: {} as Client,
    tomoriState: createPersona({ persona_nickname: "Mirri", config: { humanizer_degree: HumanizerDegree.NONE } }),
    contextItems: [],
    currentTurnModelParts: [],
    provider: "fixture",
    locale: "en-US",
    holdResponseText,
    deliveredMessageRefs: [],
    suppressUserErrors: true,
  };
  const provider: StreamProvider = {
    async *startStream() {
      for (const chunk of chunks) yield { provider: "fixture", data: chunk };
    },
    processChunk: (raw) => raw.data as ProcessedChunk,
    handleProviderError: () => ({ type: "unknown", retryable: false, message: "Fixture failure" }),
    createErrorDescription: () => null,
    getProviderInfo: () => ({ name: "fixture", version: "1", supportsStreaming: true, supportsFunctionCalling: true }),
  };
  return { context, provider, send };
}

afterEach(() => StreamOrchestrator.clearStopRequest("pending_fixture"));

/** Records how far the provider stream was consumed and whether early teardown closed it. */
function trackConsumption(provider: StreamProvider) {
  const progress = { yielded: 0, closed: false };
  const startStream = provider.startStream.bind(provider);
  provider.startStream = async function* (streamConfig, streamContext) {
    try {
      for await (const raw of startStream(streamConfig, streamContext)) {
        progress.yielded++;
        yield raw;
      }
    } finally {
      progress.closed = true;
    }
  };
  return progress;
}

/** Numbered so the stream's overlap de-duplication keeps every chunk. */
function textChunks(count: number, content: string): ProcessedChunk[] {
  return [
    ...Array.from({ length: count }, (_, index) => ({
      type: "text" as const,
      content: `${index} ${content}`,
      metadata: index === 0 ? { usage: { prompt_tokens: 40, completion_tokens: 1 } } : undefined,
    })),
    { type: "done" },
  ];
}

describe("held collection ceiling", () => {
  it("stops the upstream stream once many normal chunks reach the byte ceiling", async () => {
    const { context, provider, send } = fixture(textChunks(400, "Mirri hums a quiet tune.\n"));
    context.pendingResponseLimit = { maxBytes: 2000, maxSegments: 4096 };
    const progress = trackConsumption(provider);
    const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);
    expect(result.status).toBe("completed");
    expect(result.stopReason).toBe("pending_response_limit");
    expect(result.pendingResponse?.truncation).toBe("retention_limit");
    expect(result.pendingResponse?.retainedBytes).toBeLessThanOrEqual(2000);
    expect(result.pendingResponse?.text).toContain("quiet tune");
    expect(progress.closed).toBe(true);
    expect(progress.yielded).toBeLessThan(400);
    expect(result.usage).toEqual({ inputTokens: 40, outputTokens: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(StreamOrchestrator.hasStopRequest(context.channel.id)).toBe(false);
  });

  it("cuts multibyte text on a character boundary within the byte ceiling", async () => {
    const { context, provider } = fixture(textChunks(80, "静かな夜に灯りがともる。🌙\n"));
    context.pendingResponseLimit = { maxBytes: 301, maxSegments: 4096 };
    const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);
    const pending = result.pendingResponse;
    expect(pending?.truncation).toBe("retention_limit");
    expect(pending?.retainedBytes).toBeLessThanOrEqual(301);
    expect(pending?.text).not.toContain("�");
    expect(pending?.text).toMatch(/^[\s\S]*[灯夜静🌙。\n]/u);
  });

  it("counts blank and discarded segments against the segment ceiling", async () => {
    const { context, provider } = fixture([{ type: "text", content: "Mirri nods.\n" }, ...textChunks(200, "\n.\n")]);
    context.pendingResponseLimit = { maxBytes: 64 * 1024, maxSegments: 12 };
    const progress = trackConsumption(provider);
    const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);
    expect(result.status).toBe("completed");
    expect(result.pendingResponse?.truncation).toBe("retention_limit");
    expect(result.pendingResponse?.segments).toBe(12);
    expect(result.pendingResponse?.text).toContain("Mirri nods.");
    expect(progress.yielded).toBeLessThan(200);
  });

  it("bounds a single oversized chunk and an unterminated code fence that never flushes", async () => {
    for (const content of ["soft words ".repeat(20000), `\`\`\`ts\n${"const x = 1;\n".repeat(20000)}`]) {
      const { context, provider } = fixture([{ type: "text", content }, { type: "done" }]);
      context.pendingResponseLimit = { maxBytes: 4096, maxSegments: 4096 };
      const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);
      expect(result.status).toBe("completed");
      expect(result.pendingResponse?.truncation).toBe("retention_limit");
      expect(result.pendingResponse?.retainedBytes).toBeLessThanOrEqual(4096);
      expect(Buffer.byteLength(result.pendingResponse?.text ?? "", "utf8")).toBeLessThanOrEqual(4096 * 2);
    }
  });

  it("stops a LIGHT-humanizer one-message reply near what delivery can send", async () => {
    const sentence = `${"soft words ".repeat(97)}end.\n`;
    const { context, provider, send } = fixture(textChunks(121, sentence));
    context.tomoriState.config.humanizer_degree = HumanizerDegree.LIGHT;
    context.tomoriState.config.send_message_limit = 1;
    const progress = trackConsumption(provider);
    const result = await new StreamOrchestrator().streamToDiscord(
      provider,
      { ...config, humanizerDegree: HumanizerDegree.LIGHT },
      context,
    );
    expect(result.status).toBe("completed");
    expect(result.pendingResponse?.truncation).toBe("send_message_limit");
    expect(progress.closed).toBe(true);
    expect(progress.yielded).toBeLessThanOrEqual(3);
    expect(result.pendingResponse?.retainedBytes).toBeLessThan(121 * sentence.length);
    expect(send).not.toHaveBeenCalled();
    const delivered = await result.pendingResponse?.deliver();
    expect(send).toHaveBeenCalledTimes(1);
    expect(delivered?.accumulatedText).toContain("soft words");
  });

  it("keeps an under-limit reply whole with no truncation marker", async () => {
    const { context, provider } = fixture(textChunks(5, "Mirri hums a quiet tune.\n"));
    context.pendingResponseLimit = { maxBytes: 64 * 1024, maxSegments: 4096 };
    const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);
    expect(result.status).toBe("completed");
    expect(result.stopReason).toBeUndefined();
    expect(result.pendingResponse?.truncation).toBeUndefined();
    expect(result.pendingResponse?.text.match(/quiet tune/g)).toHaveLength(5);
  });
});

describe("pending stream presentation", () => {
  it("holds early flushes and pre-tool prose, strips reasoning and keeps terminal usage", async () => {
    const { context, provider, send } = fixture([
      { type: "text", content: "<think>private thought</think>Mirri: I will check.\n" },
      {
        type: "function_call",
        functionCall: { name: "lookup", args: {} },
        metadata: { usage: { prompt_tokens: 15, completion_tokens: 8 } },
      },
    ]);
    const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);
    expect(result.status).toBe("function_call");
    expect(result.pendingResponse?.text).toContain("I will check.");
    expect(result.pendingResponse?.text).not.toContain("private thought");
    expect(result.accumulatedText).toBe("");
    expect(context.deliveredMessageRefs).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(result.usage).toEqual({ inputTokens: 15, outputTokens: 8 });
    const delivered = await result.pendingResponse?.deliver();
    expect(delivered?.accumulatedText).toContain("I will check.");
    expect(send).toHaveBeenCalledTimes(1);
    expect(context.deliveredMessageRefs).toHaveLength(1);
    await result.pendingResponse?.deliver();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("preserves code fences, Discord length splitting and aggregated humanizer presentation", async () => {
    const body = `Mirri: ${"soft words ".repeat(400)}\n\`\`\`ts\nconst x = 1;\n\`\`\``;
    const { context, provider, send } = fixture([{ type: "text", content: body }, { type: "done" }]);
    const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);
    expect(result.status).toBe("completed");
    expect(send).not.toHaveBeenCalled();
    await result.pendingResponse?.deliver();
    const payloads = send.mock.calls.map(([payload]) => payload as { content: string });
    expect(payloads.length).toBeGreaterThan(1);
    expect(payloads.every((payload) => payload.content.length <= 1950)).toBe(true);
    expect(payloads.map((payload) => payload.content).join("\n")).toContain("const x = 1;");
  });

  it("retains ordinary immediate streaming when collection is off", async () => {
    const { context, provider, send } = fixture([{ type: "text", content: "A quiet nod.\n" }, { type: "done" }], false);
    const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);
    expect(result.pendingResponse).toBeUndefined();
    expect(result.accumulatedText).toContain("A quiet nod.");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("discards held text on user cancellation instead of flushing it", async () => {
    const { context, provider, send } = fixture([
      {
        type: "text",
        content: "Unapproved sentence.",
        metadata: { usage: { prompt_tokens: 12, completion_tokens: 2 } },
      },
      { type: "done" },
    ]);
    const processChunk = provider.processChunk;
    provider.processChunk = (raw) => {
      const chunk = processChunk(raw);
      if (chunk.type === "done") StreamOrchestrator.requestStop(context.channel.id, "fixture_user");
      return chunk;
    };
    const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);
    expect(result.status).toBe("stopped_by_user");
    expect(result.pendingResponse).toBeUndefined();
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 2 });
    expect(send).not.toHaveBeenCalled();
  });

  it("retains usage for empty responses and preserves a completed character reply before a foreign speaker", async () => {
    const empty = fixture([{ type: "done", metadata: { usage: { prompt_tokens: 10, completion_tokens: 1 } } }]);
    const result = await new StreamOrchestrator().streamToDiscord(empty.provider, config, empty.context);
    expect(result.status).toBe("empty_response");
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 1 });
    const { context, provider, send } = fixture([
      { type: "text", content: "Mirri: A quiet nod.\nJuno: A foreign reply.\n" },
      { type: "done" },
    ]);
    context.tomoriState.config.llm_stop_speaker_pattern_enabled = true;
    const held = await new StreamOrchestrator().streamToDiscord(provider, config, context);
    expect(held.status).toBe("completed");
    expect(held.pendingResponse?.text).toContain("A quiet nod.");
    expect(held.pendingResponse?.text).not.toContain("A foreign reply.");
    expect(StreamOrchestrator.hasStopRequest(context.channel.id)).toBe(false);
    await held.pendingResponse?.deliver();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("refuses delivery after the turn signal is aborted", async () => {
    const { context, provider, send } = fixture([{ type: "text", content: "Still pending." }, { type: "done" }]);
    const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);
    const controller = new AbortController();
    controller.abort();
    expect((await result.pendingResponse?.deliver(controller.signal))?.status).toBe("stopped_by_user");
    expect(send).not.toHaveBeenCalled();
  });

  it("discards an approved candidate when a follow-up stops the turn before delivery", async () => {
    const { context, provider, send } = fixture([{ type: "text", content: "Still pending." }, { type: "done" }]);
    const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);
    StreamOrchestrator.requestStop(context.channel.id, "fixture_user");
    expect((await result.pendingResponse?.deliver())?.status).toBe("stopped_by_user");
    expect(context.deliveredMessageRefs).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("retains only accepted text when cancellation interrupts split presentation", async () => {
    const { context, provider, send } = fixture([
      { type: "text", content: "quiet words ".repeat(400) },
      { type: "done" },
    ]);
    send.mockImplementation(async () => {
      StreamOrchestrator.requestStop(context.channel.id, "fixture_user");
      return { id: "sent_1", url: "", author: { id: "bot_1" } };
    });
    const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);
    const delivered = await result.pendingResponse?.deliver();
    expect(delivered?.status).toBe("stopped_by_user");
    expect(send).toHaveBeenCalledTimes(1);
    const accepted = send.mock.calls[0][0] as { content: string };
    expect(delivered?.accumulatedText).toBe(accepted.content);
    expect(context.deliveredMessageRefs).toHaveLength(1);
    expect(accepted.content.length).toBeLessThanOrEqual(config.maxMessageLength);
  });
});
