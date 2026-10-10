import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { NovelaiStreamAdapter } from "@/providers/novelai/novelaiStreamAdapter";
import type { RawStreamChunk, StreamConfig, StreamContext } from "@/types/stream/interfaces";
import { log } from "@/utils/misc/logger";
import { isContextLengthError } from "@/utils/provider/providerErrorClassification";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeChunk(data: Record<string, unknown>): RawStreamChunk {
  return { data, provider: "novelai", metadata: { timestamp: Date.now() } };
}

function makeStreamConfig(model = "glm-4-6"): StreamConfig {
  return {
    model,
    apiKey: "test-key",
    temperature: 0.8,
    inactivityTimeoutMs: 5_000,
  } as StreamConfig;
}

function makeStreamContext(): StreamContext {
  return {
    channel: {
      id: "channel-1",
      isDMBased: () => false,
      guildId: "guild-1",
    },
    client: {},
    tomoriState: {
      persona_nickname: "Tomori",
      config: {
        thinking_level: "none",
        llm_stop_speaker_pattern_enabled: false,
        llm_stop_strings: null,
      },
    },
    contextItems: [],
    currentTurnModelParts: [],
    provider: "novelai",
    locale: "en-US",
  } as unknown as StreamContext;
}

describe("NovelaiStreamAdapter.handleProviderError", () => {
  const adapter = new NovelaiStreamAdapter();

  it.each([
    [400, "api_error", false],
    [401, "api_error", false],
    [402, "api_error", false],
    [408, "timeout", true],
    [429, "rate_limit", true],
    [500, "api_error", true],
    [502, "api_error", true],
    [503, "provider_overloaded", true],
    [504, "timeout", true],
  ] as const)("maps HTTP %i to %s with retryable=%s", (statusCode, expectedType, expectedRetryable) => {
    const error = new Error(`NovelAI API request failed with status ${statusCode}: Bad request`);
    const normalized = adapter.handleProviderError(error);

    expect(normalized.type).toBe(expectedType);
    expect(normalized.code).toBe(String(statusCode));
    expect(normalized.retryable).toBe(expectedRetryable);
  });

  it("extracts statusCode from error object property", () => {
    const error = Object.assign(new Error("Request rejected"), { statusCode: 429 });
    const normalized = adapter.handleProviderError(error);

    expect(normalized.type).toBe("rate_limit");
    expect(normalized.code).toBe("429");
    expect(normalized.retryable).toBe(true);
  });

  it("extracts status from error object property", () => {
    const error = Object.assign(new Error("Request rejected"), { status: 503 });
    const normalized = adapter.handleProviderError(error);

    expect(normalized.type).toBe("provider_overloaded");
    expect(normalized.code).toBe("503");
    expect(normalized.retryable).toBe(true);
  });

  it.each([
    ["status: 429 Too Many Requests", "429"],
    ["HTTP 502 Bad Gateway", "502"],
    ["Internal Server Error (500)", "500"],
  ])("extracts a standalone status code from %p", (message, expectedCode) => {
    expect(adapter.handleProviderError(new Error(message)).code).toBe(expectedCode);
  });

  it.each([
    "too much context (32826 tokens), max is 16384",
    "input too long (8192 > 2048)",
    "user status 2002 blocked",
  ])("does not read a status code out of a longer number in %p", (message) => {
    const normalized = adapter.handleProviderError(new Error(message));

    expect(normalized.code).toBe("unknown");
    expect(normalized.retryable).toBe(false);
  });

  it("does not duplicate the NovelAI API error prefix if already present", () => {
    const error = new Error("NovelAI API error (400): bad request: invalid prompt");
    const normalized = adapter.handleProviderError(error);

    expect(normalized.message).toBe("NovelAI API error (400): bad request: invalid prompt");
  });
});

describe("NovelaiStreamAdapter.processChunk error delegation", () => {
  const adapter = new NovelaiStreamAdapter();

  it("normalizes a string error chunk through handleProviderError", () => {
    const processed = adapter.processChunk(
      makeChunk({
        error: "NovelAI API request failed with status 429: Too Many Requests",
      }),
    );

    expect(processed.type).toBe("error");
    expect(processed.error?.type).toBe("rate_limit");
    expect(processed.error?.code).toBe("429");
    expect(processed.error?.retryable).toBe(true);
  });

  it("passes through an existing typed ProviderError directly", () => {
    const providerError = {
      type: "timeout" as const,
      message: "Request timed out",
      code: "504",
      retryable: true,
    };
    const processed = adapter.processChunk(makeChunk({ error: providerError }));

    expect(processed.type).toBe("error");
    expect(processed.error).toEqual(providerError);
  });
});

describe("NovelAI context length error classification", () => {
  it("recognizes NovelAI prompt overflow as a context length error", () => {
    const adapter = new NovelaiStreamAdapter();
    const error = new Error(
      'NovelAI API request failed with status 400: {"statusCode":400,"message":"bad request: invalid prompt, too much context. got 32826 + 50, max is 16384"}',
    );
    const normalized = adapter.handleProviderError(error);

    expect(isContextLengthError(normalized)).toBe(true);
  });
});

describe("NovelaiStreamAdapter.startStream error propagation", () => {
  it("yields a normalized ProviderError chunk when the GLM OpenAI endpoint returns HTTP 400 without logging to error_logs", async () => {
    const errorSpy = spyOn(log, "error");
    const warnSpy = spyOn(log, "warn");

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          statusCode: 400,
          message: "bad request: invalid prompt, too much context. got 32826 + 50, max is 16384",
        }),
        { status: 400, statusText: "Bad Request" },
      );
    }) as unknown as typeof fetch;

    const adapter = new NovelaiStreamAdapter();
    const chunks: RawStreamChunk[] = [];

    for await (const chunk of adapter.startStream(makeStreamConfig("glm-4-6"), makeStreamContext())) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    const first = chunks[0];
    expect(first.provider).toBe("novelai");
    expect(first.metadata?.error).toBe(true);

    const processed = adapter.processChunk(first);
    expect(processed.type).toBe("error");
    expect(processed.error?.type).toBe("api_error");
    expect(processed.error?.code).toBe("400");
    expect(processed.error?.retryable).toBe(false);
    expect(processed.error ? isContextLengthError(processed.error) : false).toBe(true);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("yields a retryable rate_limit chunk when the native endpoint returns HTTP 429", async () => {
    globalThis.fetch = (async () => {
      return new Response("Too Many Requests", { status: 429, statusText: "Too Many Requests" });
    }) as unknown as typeof fetch;

    const adapter = new NovelaiStreamAdapter();
    const chunks: RawStreamChunk[] = [];

    for await (const chunk of adapter.startStream(makeStreamConfig("kayra-v1"), makeStreamContext())) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    const first = chunks[0];
    expect(first.metadata?.error).toBe(true);

    const processed = adapter.processChunk(first);
    expect(processed.type).toBe("error");
    expect(processed.error?.type).toBe("rate_limit");
    expect(processed.error?.code).toBe("429");
    expect(processed.error?.retryable).toBe(true);
  });

  it("handles mid-stream error event on native endpoint without echoing error JSON as persona text", async () => {
    const warnSpy = spyOn(log, "warn");

    globalThis.fetch = (async () => {
      const sseBody = 'data: {"token":"Hello"}\n\ndata: {"error":"out of anlas"}\n\n';
      return new Response(sseBody, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

    const adapter = new NovelaiStreamAdapter();
    const chunks: RawStreamChunk[] = [];

    for await (const chunk of adapter.startStream(makeStreamConfig("kayra-v1"), makeStreamContext())) {
      chunks.push(chunk);
    }

    // Must yield the initial token chunk, then the error chunk, NEVER the raw error JSON as text
    expect(chunks).toHaveLength(2);

    const tokenChunk = adapter.processChunk(chunks[0]);
    expect(tokenChunk.type).toBe("text");
    expect(tokenChunk.content).toBe("Hello");

    const errorRaw = chunks[1];
    expect(errorRaw.metadata?.error).toBe(true);
    const errorProcessed = adapter.processChunk(errorRaw);
    expect(errorProcessed.type).toBe("error");
    expect(errorProcessed.error?.message).toContain("out of anlas");

    // The raw error JSON must never be emitted as text content
    const textContents = chunks.map((c) => (c.data as { token?: string })?.token).filter(Boolean);
    expect(textContents).not.toContain('{"error":"out of anlas"}');

    // The response body is trace for whoever runs the bot; the provider_error counter carries the count
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("out of anlas"), undefined, expect.anything());
  });

  it("handles mid-stream error event on OpenAI endpoint without echoing error payload", async () => {
    const warnSpy = spyOn(log, "warn");

    globalThis.fetch = (async () => {
      const sseBody =
        'data: {"choices":[{"index":0,"text":"Hello"}]}\n\ndata: {"error":{"message":"too much context"}}\n\n';
      return new Response(sseBody, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

    const adapter = new NovelaiStreamAdapter();
    const chunks: RawStreamChunk[] = [];

    for await (const chunk of adapter.startStream(makeStreamConfig("glm-4-6"), makeStreamContext())) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);

    // GLM holds an unfinished sentence in its boundary buffer, so assert on the raw token
    // rather than processed content, which is empty until the sentence completes.
    expect((chunks[0].data as { token?: string }).token).toBe("Hello");

    const errorRaw = chunks[1];
    expect(errorRaw.metadata?.error).toBe(true);
    const errorProcessed = adapter.processChunk(errorRaw);
    expect(errorProcessed.type).toBe("error");
    expect(errorProcessed.error?.message).toContain("too much context");

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("too much context"), undefined, expect.anything());
  });
});
