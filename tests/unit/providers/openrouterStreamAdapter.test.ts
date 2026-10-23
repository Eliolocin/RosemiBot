import { afterEach, describe, expect, it, mock } from "bun:test";
import { findOpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import { OpenrouterStreamAdapter, type OpenrouterStreamConfig } from "@/providers/openrouter/openrouterStreamAdapter";
import { HumanizerDegree } from "@/types/db/schema";
import type { RawStreamChunk, StreamContext } from "@/types/stream/interfaces";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { sumTurnUsage } from "@/utils/text/tokenEstimate";
import { createPersona } from "../../helpers/fixtures";
import { stubGlobalFetch } from "../../helpers/fetchStub";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeSseResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function makeStreamConfig(): OpenrouterStreamConfig {
  return {
    model: "example/model",
    apiKey: "test-key",
    temperature: 0.8,
    topP: 0.9,
    minP: 0.1,
    logitBias: { "123": -100 },
    inactivityTimeoutMs: 5_000,
    maxMessageLength: 2000,
    flushBufferSize: 1000,
    flushBufferSizeCodeBlock: 15000,
    baseTypeSpeedMsPerChar: 0,
    maxTypingTimeMs: 0,
    minVisibleTypingDurationMs: 0,
    humanizerDegree: HumanizerDegree.NONE,
    emojiUsageEnabled: true,
  };
}

function makeStreamContext(): StreamContext {
  return {
    channel: {},
    client: {},
    tomoriState: {
      persona_nickname: "Tomori",
      trigger_words: [],
      config: {
        llm_stop_speaker_pattern_enabled: false,
        llm_stop_strings: null,
        thinking_level: "none",
      },
    },
    contextItems: [],
    currentTurnModelParts: [],
    provider: "openrouter",
    locale: "en-US",
  } as unknown as StreamContext;
}

async function collectRawChunks(adapter: OpenrouterStreamAdapter): Promise<RawStreamChunk[]> {
  const chunks: RawStreamChunk[] = [];
  for await (const chunk of adapter.startStream(makeStreamConfig(), makeStreamContext())) {
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * Consumes a stream to completion and discards the chunks.
 *
 * Request assembly and provider-side processing run inside the generator, so a test that asserts on
 * what the adapter sent has to pull every chunk first. Use `collectRawChunks` when the chunks
 * themselves are what the test is about.
 */
async function drainStream(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of stream) {
    // Discarded: the assertion reads state the generator wrote while producing them.
  }
}

/**
 * Builds a RawStreamChunk wrapping an OpenRouter-shaped data object.
 * chunk.data is typed as unknown so no type assertion is needed in the fixture.
 */
function makeOpenrouterChunk(data: Record<string, unknown>): RawStreamChunk {
  return { data, provider: "openrouter", metadata: { timestamp: Date.now() } };
}

describe("OpenrouterStreamAdapter.processChunk", () => {
  it("retains HTTP limit metadata and retry timing in the provider error cause", async () => {
    for (const status of [402, 403]) {
      const fetchStub = stubGlobalFetch(() =>
        Response.json(
          {
            error: { code: status, message: "Fixture key limit", metadata: { limit_source: "openrouter_key_limit" } },
          },
          { status, headers: { "Retry-After": "2" } },
        ),
      );
      try {
        const adapter = new OpenrouterStreamAdapter();
        const chunks = await collectRawChunks(adapter);
        const raw = chunks.at(-1);
        if (!raw) throw new Error("Missing provider error chunk");
        const error = adapter.processChunk(raw).error?.originalError;
        expect(error).toBeInstanceOf(Error);
        if (error instanceof Error)
          expect(error.cause).toMatchObject({ limitSource: "openrouter_key_limit", status, retryAfterMs: 2_000 });
      } finally {
        fetchStub.mockRestore();
      }
    }
  });

  it("preserves usage with empty or missing choices in both wire formats", () => {
    const adapter = new OpenrouterStreamAdapter();
    for (const usage of [
      { prompt_tokens: 321, completion_tokens: 18, total_tokens: 339 },
      { promptTokens: 321, completionTokens: 18, totalTokens: 339 },
    ]) {
      for (const choices of [undefined, [], [{ index: 0, delta: { content: "Hi" } }]]) {
        const result = adapter.processChunk(makeOpenrouterChunk({ usage, choices }));
        expect(result.type).toBe("text");
        expect(result.content).toBe(choices?.length ? "Hi" : "");
        expect(result.metadata?.usage).toMatchObject({ promptTokens: 321, completionTokens: 18, totalTokens: 339 });
      }
    }
    expect(adapter.processChunk(makeOpenrouterChunk({ choices: [] })).metadata).toBeUndefined();
  });

  it("carries trailing SSE usage into a held response and turn token totals", async () => {
    const fetchStub = stubGlobalFetch(() =>
      makeSseResponse([
        { choices: [{ index: 0, delta: { content: "Hi" } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 321, completion_tokens: 18, total_tokens: 339, cost: 0.0012 } },
        "[DONE]",
      ]),
    );
    try {
      const context = makeStreamContext();
      Object.assign(context.channel, { id: "openrouter_usage_fixture", isThread: () => false });
      context.tomoriState = createPersona({
        persona_nickname: "Mirri",
        config: { thinking_level: "none", llm_stop_speaker_pattern_enabled: false },
      });
      context.holdResponseText = true;
      const result = await new StreamOrchestrator().streamToDiscord(
        new OpenrouterStreamAdapter(),
        makeStreamConfig(),
        context,
      );
      expect(result.status).toBe("completed");
      expect(result.pendingResponse?.text).toBe("Hi");
      expect(result.usage).toEqual({ inputTokens: 321, outputTokens: 18, costUsd: 0.0012 });
      expect(sumTurnUsage([result])).toEqual({ inputTokens: 321, outputTokens: 18 });
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("retains tool-call usage when it follows the finish signal and preserves the completed arguments", async () => {
    const usage = { prompt_tokens: 321, completion_tokens: 18, total_tokens: 339, cost: 0.0012 };
    for (const placement of ["trailing", "bundled", "missing"] as const) {
      const fetchStub = stubGlobalFetch(() =>
        makeSseResponse([
          {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_fixture",
                      type: "function",
                      function: { name: "analyze_image", arguments: '{"message_' },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                index: 0,
                delta: { tool_calls: [{ index: 0, function: { arguments: 'id":"synthetic-message"}' } }] },
                finish_reason: "tool_calls",
              },
            ],
            ...(placement === "bundled" ? { usage } : {}),
          },
          ...(placement === "trailing" ? [{ choices: [], usage }] : []),
          "[DONE]",
        ]),
      );
      try {
        const context = makeStreamContext();
        Object.assign(context.channel, { id: `openrouter_tool_usage_${placement}`, isThread: () => false });
        context.tomoriState = createPersona({
          config: { thinking_level: "none", llm_stop_speaker_pattern_enabled: false },
        });
        context.holdResponseText = true;
        const result = await new StreamOrchestrator().streamToDiscord(
          new OpenrouterStreamAdapter(),
          makeStreamConfig(),
          context,
        );
        expect(result.status).toBe("function_call");
        expect(result.data).toMatchObject({ name: "analyze_image", args: { message_id: "synthetic-message" } });
        expect(result.usage).toEqual(
          placement === "missing" ? undefined : { inputTokens: 321, outputTokens: 18, costUsd: 0.0012 },
        );
      } finally {
        fetchStub.mockRestore();
      }
    }
  });

  it("releases a tool call without usage at the SSE end marker and cancels the remaining body", async () => {
    const response = makeCancelObservableSseResponse([
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_fixture",
                  type: "function",
                  function: { name: "analyze_image", arguments: "{}" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
      "[DONE]",
    ]);
    const fetchStub = stubGlobalFetch(() => response.response);
    try {
      const context = makeStreamContext();
      Object.assign(context.channel, { id: "openrouter_tool_usage_missing", isThread: () => false });
      context.tomoriState = createPersona({
        config: { thinking_level: "none", llm_stop_speaker_pattern_enabled: false },
      });
      const result = await new StreamOrchestrator().streamToDiscord(
        new OpenrouterStreamAdapter(),
        makeStreamConfig(),
        context,
      );
      expect(result.status).toBe("function_call");
      expect(result.data).toMatchObject({ name: "analyze_image", args: {} });
      expect(result.usage).toBeUndefined();
      expect(response.wasCancelled()).toBe(true);
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("defers a subscription spending-limit rejection to the turn's notice and keeps its limit source", async () => {
    for (const status of [402, 403]) {
      const fetchStub = stubGlobalFetch(
        () =>
          new Response(
            JSON.stringify({
              error: {
                code: status,
                message: "Key limit exceeded",
                metadata: { limit_source: "openrouter_key_limit" },
              },
            }),
            { status },
          ),
      );
      try {
        const send = mock(async () => ({ id: "message_1" }));
        const context = makeStreamContext();
        Object.assign(context.channel, { id: `openrouter_limit_${status}`, isThread: () => false, send });
        context.tomoriState = createPersona({
          persona_nickname: "Mirri",
          config: { thinking_level: "none", llm_stop_speaker_pattern_enabled: false },
        });
        context.textCredentialSource = "supporter";
        const result = await new StreamOrchestrator().streamToDiscord(
          new OpenrouterStreamAdapter(),
          makeStreamConfig(),
          context,
        );
        expect(result.status).toBe("error");
        expect(findOpenRouterLimitError(result.data)).toMatchObject({ limitSource: "openrouter_key_limit", status });
        expect(send).not.toHaveBeenCalled();
      } finally {
        fetchStub.mockRestore();
      }
    }
  });

  it("preserves visible text from delta.content exactly", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(
      makeOpenrouterChunk({
        choices: [{ index: 0, delta: { content: "Hello, world!" } }],
      }),
    );

    expect(result.type).toBe("text");
    expect(result.content).toBe("Hello, world!");
    expect(result.thoughts).toBeUndefined();
  });

  it("captures delta.reasoning in thoughts and emits empty visible content", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(
      makeOpenrouterChunk({
        choices: [{ index: 0, delta: { reasoning: "internal chain-of-thought" } }],
      }),
    );

    expect(result.type).toBe("text");
    // Reasoning must not surface as visible Discord text
    expect(result.content).toBe("");
    expect(result.thoughts).toBeDefined();
    expect(result.thoughts?.[0]).toMatchObject({ kind: "raw", content: "internal chain-of-thought" });
  });

  it("keeps reasoning in thoughts and visible text in content when both are present", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(
      makeOpenrouterChunk({
        choices: [{ index: 0, delta: { content: "Visible reply.", reasoning: "hidden thought" } }],
      }),
    );

    expect(result.type).toBe("text");
    expect(result.content).toBe("Visible reply.");
    // Reasoning must not be mixed into visible content
    expect(result.content).not.toContain("hidden thought");
    expect(result.thoughts?.[0]).toMatchObject({ kind: "raw", content: "hidden thought" });
  });

  it("maps SSE-injected 429 error to rate_limit, retryable true", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(makeOpenrouterChunk({ error: { code: 429, message: "Rate limit exceeded" } }));

    expect(result.type).toBe("error");
    expect(result.error?.type).toBe("rate_limit");
    expect(result.error?.retryable).toBe(true);
  });

  it("maps SSE-injected 503 error to provider_overloaded, retryable true", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(makeOpenrouterChunk({ error: { code: 503, message: "Service overloaded" } }));

    expect(result.type).toBe("error");
    expect(result.error?.type).toBe("provider_overloaded");
    expect(result.error?.retryable).toBe(true);
  });

  it("maps SSE-injected 401 error to api_error, not retryable", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(makeOpenrouterChunk({ error: { code: 401, message: "Invalid API key" } }));

    expect(result.type).toBe("error");
    expect(result.error?.type).toBe("api_error");
    expect(result.error?.retryable).toBe(false);
  });

  it("passes through a pre-formed ProviderError from error field unchanged", () => {
    const adapter = new OpenrouterStreamAdapter();
    const preFormed = {
      type: "rate_limit",
      message: "quota exceeded",
      retryable: true,
      code: "429",
    };
    const result = adapter.processChunk(makeOpenrouterChunk({ error: preFormed }));

    expect(result.type).toBe("error");
    expect(result.error?.type).toBe("rate_limit");
    expect(result.error?.retryable).toBe(true);
  });

  it("returns empty text for a keepalive chunk with no choices", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(makeOpenrouterChunk({}));

    expect(result.type).toBe("text");
    expect(result.content).toBe("");
  });

  it("returns done for finishReason stop with no delta content", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(
      makeOpenrouterChunk({
        choices: [{ index: 0, finishReason: "stop", delta: {} }],
      }),
    );

    expect(result.type).toBe("done");
  });

  it("returns text containing last fragment for finishReason stop with delta content", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(
      makeOpenrouterChunk({
        choices: [{ index: 0, finishReason: "stop", delta: { content: "final fragment" } }],
      }),
    );

    expect(result.type).toBe("text");
    expect(result.content).toBe("final fragment");
  });

  it("assembles a function_call with correct name and args on finishReason tool_calls", () => {
    const adapter = new OpenrouterStreamAdapter();

    const result = adapter.processChunk(
      makeOpenrouterChunk({
        choices: [
          {
            index: 0,
            finishReason: "tool_calls",
            delta: {
              toolCalls: [
                {
                  index: 0,
                  id: "call_abc",
                  type: "function",
                  function: { name: "search_web", arguments: '{"query":"TomoriBot changelog"}' },
                },
              ],
            },
          },
        ],
      }),
    );

    expect(result.type).toBe("function_call");
    expect(result.functionCall?.name).toBe("search_web");
    expect(result.functionCall?.args).toEqual({ query: "TomoriBot changelog" });
    expect(result.content).toBeUndefined();
  });

  it("accumulates split tool-call chunks and resolves on the finish chunk", () => {
    const adapter = new OpenrouterStreamAdapter();

    adapter.processChunk(
      makeOpenrouterChunk({
        choices: [
          {
            index: 0,
            delta: {
              toolCalls: [
                { index: 0, id: "call_xyz", type: "function", function: { name: "get_time", arguments: "" } },
              ],
            },
          },
        ],
      }),
    );

    adapter.processChunk(
      makeOpenrouterChunk({
        choices: [
          {
            index: 0,
            delta: { toolCalls: [{ index: 0, function: { arguments: '{"tz":"UTC"}' } }] },
          },
        ],
      }),
    );

    const result = adapter.processChunk(
      makeOpenrouterChunk({
        choices: [{ index: 0, finishReason: "tool_calls", delta: {} }],
      }),
    );

    expect(result.type).toBe("function_call");
    expect(result.functionCall?.name).toBe("get_time");
    expect(result.functionCall?.args).toEqual({ tz: "UTC" });
  });

  it("returns done for finishReason error (mid-stream unified error format)", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(
      makeOpenrouterChunk({
        choices: [{ index: 0, finishReason: "error", delta: {} }],
      }),
    );

    expect(result.type).toBe("error");
    expect(result.error?.retryable).toBe(false);
  });
});

describe("OpenrouterStreamAdapter.handleProviderError", () => {
  it("maps statusCode 429 to rate_limit, retryable true", () => {
    const adapter = new OpenrouterStreamAdapter();
    const error = { statusCode: 429, message: "Too Many Requests" };
    const result = adapter.handleProviderError(error);

    expect(result.type).toBe("rate_limit");
    expect(result.retryable).toBe(true);
  });

  it("maps statusCode 503 to provider_overloaded, retryable true", () => {
    const adapter = new OpenrouterStreamAdapter();
    const error = { statusCode: 503, message: "Service Temporarily Unavailable" };
    const result = adapter.handleProviderError(error);

    expect(result.type).toBe("provider_overloaded");
    expect(result.retryable).toBe(true);
  });

  it("maps statusCode 401 to api_error, not retryable", () => {
    const adapter = new OpenrouterStreamAdapter();
    const error = { statusCode: 401, message: "Unauthorized — invalid API key" };
    const result = adapter.handleProviderError(error);

    expect(result.type).toBe("api_error");
    expect(result.retryable).toBe(false);
  });

  it("maps statusCode 404 to api_error, not retryable", () => {
    const adapter = new OpenrouterStreamAdapter();
    const error = { statusCode: 404, message: "Model not found" };
    const result = adapter.handleProviderError(error);

    expect(result.type).toBe("api_error");
    expect(result.retryable).toBe(false);
  });

  it("extracts error code from body JSON when statusCode is absent", () => {
    const adapter = new OpenrouterStreamAdapter();
    const error = {
      body: JSON.stringify({ error: { code: 429, message: "Rate limit hit" } }),
      message: "Request failed",
    };
    const result = adapter.handleProviderError(error);

    expect(result.type).toBe("rate_limit");
    expect(result.retryable).toBe(true);
  });

  it("extracts error code from nested error.code field", () => {
    const adapter = new OpenrouterStreamAdapter();
    const error = { error: { code: 503, message: "Server overloaded" }, message: "OpenRouter error" };
    const result = adapter.handleProviderError(error);

    expect(result.type).toBe("provider_overloaded");
    expect(result.retryable).toBe(true);
  });

  it("returns a fully-formed ProviderError with required fields", () => {
    const adapter = new OpenrouterStreamAdapter();
    const error = new Error("Unexpected network failure");
    const result = adapter.handleProviderError(error);

    expect(typeof result.type).toBe("string");
    expect(typeof result.message).toBe("string");
    expect(typeof result.retryable).toBe("boolean");
    expect(result.originalError).toBe(error);
  });
});

describe("OpenrouterStreamAdapter tool history", () => {
  it("does not duplicate a text-only tool response as a user message", async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return makeSseResponse(["[DONE]"]);
    }) as typeof fetch;

    const context = makeStreamContext();
    context.functionInteractionHistory = [
      {
        functionCall: { name: "fetch_url", args: { url: "https://example.com" } },
        functionResponse: {
          functionResponse: {
            name: "fetch_url",
            response: { result: { summary: "Fetched page content" } },
          },
        },
      },
    ];

    await drainStream(new OpenrouterStreamAdapter().startStream(makeStreamConfig(), context));

    const messages = requestBody?.messages as Array<Record<string, unknown>>;
    expect(messages.map((message) => message.role)).toEqual(["assistant", "tool"]);
    expect(String(messages[1]?.content)).toContain("Fetched page content");
  });

  it("replays a tool-returned image as inline data", async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (input, init) => {
      if (String(input).startsWith("data:")) {
        return await originalFetch(input, init);
      }
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return makeSseResponse(["[DONE]"]);
    }) as typeof fetch;

    const pngBytes = Buffer.from("89504e470d0a1a0a00000000", "hex");
    const context = makeStreamContext();
    context.functionInteractionHistory = [
      {
        functionCall: { name: "web_search", args: { query: "birds" } },
        functionResponse: {
          functionResponse: { name: "web_search", response: { result: "sent" } },
        },
        imageMetadata: {
          imageUrls: [
            {
              url: `data:image/jpeg;base64,${pngBytes.toString("base64")}`,
              mimeType: "image/jpeg",
              originalUrl: "https://media.discordapp.net/proxy-image.jpg",
            },
          ],
          totalSent: 1,
          totalValidated: 1,
        },
      },
    ];
    const config = { ...makeStreamConfig(), seesImages: true };

    await drainStream(new OpenrouterStreamAdapter().startStream(config, context));

    const messages = requestBody?.messages as Array<Record<string, unknown>>;
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${pngBytes.toString("base64")}` },
        },
      ],
    });
  });
});

describe("OpenrouterStreamAdapter parameter degradation", () => {
  it("restarts an uncommitted SSE error with all named parameters removed", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (requestBodies.length === 1) {
        return makeSseResponse([
          {
            error: {
              code: 502,
              message: "Provider returned error",
              metadata: {
                raw: "The min_p and logit_bias sampling parameters are not yet supported with speculative decoding.",
              },
            },
          },
        ]);
      }
      return makeSseResponse([{ choices: [{ index: 0, delta: { content: "Recovered" } }] }, "[DONE]"]);
    }) as typeof fetch;

    const chunks = await collectRawChunks(new OpenrouterStreamAdapter());

    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[1]).not.toHaveProperty("min_p");
    expect(requestBodies[1]).not.toHaveProperty("logit_bias");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.data).toMatchObject({ choices: [{ delta: { content: "Recovered" } }] });
  });

  it("does not restart an SSE error after visible content commits the stream", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
      fetchCalls += 1;
      return makeSseResponse([
        { choices: [{ index: 0, delta: { content: "Partial output" } }] },
        { error: { code: 502, message: "Unsupported parameter: min_p" } },
      ]);
    }) as typeof fetch;

    const chunks = await collectRawChunks(new OpenrouterStreamAdapter());

    expect(fetchCalls).toBe(1);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.data).toMatchObject({ error: { code: 502, message: "Unsupported parameter: min_p" } });
  });

  it("caps message-targeted retries at three before returning to the static ladder", async () => {
    const namedParams = ["min_p", "logit_bias", "temperature", "top_p"];
    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const namedParam = namedParams[requestBodies.length - 1];
      return makeSseResponse([
        {
          error: {
            code: 502,
            message: namedParam ? `Unsupported parameter: ${namedParam}` : "Bad gateway",
          },
        },
      ]);
    }) as typeof fetch;

    const chunks = await collectRawChunks(new OpenrouterStreamAdapter());

    expect(requestBodies[1]).not.toHaveProperty("min_p");
    expect(requestBodies[2]).not.toHaveProperty("min_p");
    expect(requestBodies[2]).not.toHaveProperty("logit_bias");
    expect(requestBodies[3]).not.toHaveProperty("temperature");
    expect(requestBodies[3]).toHaveProperty("top_p");
    expect(requestBodies[4]).toHaveProperty("min_p");
    expect(requestBodies[4]).toHaveProperty("top_p");
    expect(chunks.at(-1)?.data).toMatchObject({ error: { code: 502 } });
  });
});

/**
 * Unlike `makeSseResponse`, this reports whether the body was cancelled and never closes the
 * stream, which is the state an abandoned response is really in: the server has not ended it.
 */
function makeCancelObservableSseResponse(events: unknown[]): {
  response: Response;
  wasCancelled: () => boolean;
} {
  let cancelled = false;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`));
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return {
    response: new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }),
    wasCancelled: () => cancelled,
  };
}

/**
 * A retained response body holds its buffers and its connection. Production heap snapshots showed
 * these accumulating one per abandoned request, so the teardown is load-bearing rather than tidiness.
 */
describe("OpenrouterStreamAdapter response body teardown", () => {
  it("cancels the body when the consumer stops iterating early", async () => {
    const { response, wasCancelled } = makeCancelObservableSseResponse([
      { choices: [{ index: 0, delta: { content: "Hello" } }] },
    ]);
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => response) as typeof fetch;

    for await (const _chunk of new OpenrouterStreamAdapter().startStream(makeStreamConfig(), makeStreamContext())) {
      break;
    }

    expect(wasCancelled()).toBe(true);
  });

  it("leaves a body that ended on its own alone", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })) as typeof fetch;

    await drainStream(new OpenrouterStreamAdapter().startStream(makeStreamConfig(), makeStreamContext()));

    expect(cancelled).toBe(false);
  });
});

describe("OpenrouterStreamAdapter strict chat-completion compatibility", () => {
  it("leaves representative same-role history unchanged when strict alternation is off by default", async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return makeSseResponse(["[DONE]"]);
    }) as typeof fetch;

    const context = makeStreamContext();
    context.contextItems = [
      { role: "user", parts: [{ type: "text", text: "First user message" }] },
      { role: "user", parts: [{ type: "text", text: "Second user message" }] },
      { role: "model", parts: [{ type: "text", text: "First model response" }] },
      { role: "model", parts: [{ type: "text", text: "Second model response" }] },
    ];

    await drainStream(new OpenrouterStreamAdapter().startStream(makeStreamConfig(), context));

    const messages = requestBody?.messages as Array<Record<string, unknown>>;
    expect(messages).toEqual([
      { role: "user", content: "First user message" },
      { role: "user", content: "Second user message" },
      { role: "assistant", content: "First model response" },
      { role: "assistant", content: "Second model response" },
    ]);
  });

  it("merges ordinary same-role turns and inserts leading user turn while preserving tool-call/tool-result wiring", async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return makeSseResponse(["[DONE]"]);
    }) as typeof fetch;

    const context = makeStreamContext();
    context.tomoriState.llm = {
      strict_role_alternation: true,
    } as unknown as import("@/types/db/schema").LlmRow;
    context.contextItems = [
      { role: "model", parts: [{ type: "text", text: "Hello! How can I help?" }] },
      { role: "user", parts: [{ type: "text", text: "Check this" }] },
      { role: "user", parts: [{ type: "text", text: "And that" }] },
    ];
    context.functionInteractionHistory = [
      {
        functionCall: { name: "lookup_data", args: { key: "abc" } },
        functionResponse: {
          functionResponse: {
            name: "lookup_data",
            response: { result: "found" },
          },
        },
      },
    ];

    await drainStream(new OpenrouterStreamAdapter().startStream(makeStreamConfig(), context));

    const messages = requestBody?.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toEqual({ role: "user", content: "[System: Conversation start]" });
    expect(messages[1]).toEqual({ role: "assistant", content: "Hello! How can I help?" });
    expect(messages[2]).toEqual({ role: "user", content: "Check this\nAnd that" });
    expect(messages[3]?.role).toBe("assistant");
    expect(Array.isArray(messages[3]?.tool_calls)).toBe(true);
    expect(messages[4]?.role).toBe("tool");
    expect(messages[4]?.tool_call_id).toBe((messages[3]?.tool_calls as Array<{ id: string }>)[0]?.id);
    expect(messages).toHaveLength(5);
  });

  it("omits prefix when supports_prefix_completion is false and includes prefix only on matching trailing assistant prefill when true", async () => {
    const drainAndCapture = async (
      supportsPrefix: boolean,
      currentTurnParts: Array<Record<string, unknown>>,
      outputPrefill?: string,
    ): Promise<Record<string, unknown> | undefined> => {
      let capturedBody: Record<string, unknown> | undefined;
      globalThis.fetch = (async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return makeSseResponse(["[DONE]"]);
      }) as typeof fetch;

      const context = makeStreamContext();
      context.tomoriState.llm = {
        supports_prefix_completion: supportsPrefix,
      } as unknown as import("@/types/db/schema").LlmRow;
      context.contextItems = [{ role: "user", parts: [{ type: "text", text: "Tell me a story" }] }];
      context.currentTurnModelParts = currentTurnParts;
      context.outputPrefill = outputPrefill;

      await drainStream(new OpenrouterStreamAdapter().startStream(makeStreamConfig(), context));
      return capturedBody;
    };

    const bodyOff = await drainAndCapture(false, [{ text: "Once upon a time" }], "Once upon a time");
    const messagesOff = bodyOff?.messages as Array<Record<string, unknown>>;
    expect(messagesOff.at(-1)).toEqual({ role: "assistant", content: "Once upon a time" });
    expect(messagesOff.at(-1)?.prefix).toBeUndefined();

    const bodyMismatched = await drainAndCapture(true, [{ text: "Once upon a time" }], "Different prefill");
    const messagesMismatched = bodyMismatched?.messages as Array<Record<string, unknown>>;
    expect(messagesMismatched.at(-1)?.prefix).toBeUndefined();

    const bodyOn = await drainAndCapture(true, [{ text: "Once upon a time" }], "Once upon a time");
    const messagesOn = bodyOn?.messages as Array<Record<string, unknown>>;
    expect(messagesOn.at(-1)).toEqual({ role: "assistant", content: "Once upon a time", prefix: true });
  });

  it("composes strict role alternation and assistant prefix completion", async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return makeSseResponse(["[DONE]"]);
    }) as typeof fetch;

    const context = makeStreamContext();
    context.tomoriState.llm = {
      strict_role_alternation: true,
      supports_prefix_completion: true,
    } as unknown as import("@/types/db/schema").LlmRow;
    context.contextItems = [
      { role: "model", parts: [{ type: "text", text: "Opening line" }] },
      { role: "user", parts: [{ type: "text", text: "First question" }] },
      { role: "user", parts: [{ type: "text", text: "Second question" }] },
    ];
    context.currentTurnModelParts = [{ text: "Let me explain:" }];
    context.outputPrefill = "Let me explain:";

    await drainStream(new OpenrouterStreamAdapter().startStream(makeStreamConfig(), context));

    const messages = requestBody?.messages as Array<Record<string, unknown>>;
    expect(messages).toEqual([
      { role: "user", content: "[System: Conversation start]" },
      { role: "assistant", content: "Opening line" },
      { role: "user", content: "First question\nSecond question" },
      { role: "assistant", content: "Let me explain:", prefix: true },
    ]);
  });
});

/**
 * Streams OpenRouter's queue keepalive comments for `keepaliveMs`, then the given data events.
 * `contentFirst` sends one content chunk before the keepalives instead, to model a stall mid-reply.
 */
function makeQueuedSseResponse(keepaliveMs: number, contentFirst: boolean): Response {
  const encoder = new TextEncoder();
  const content = (text: string) =>
    encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`);
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (contentFirst) controller.enqueue(content("Hello"));
      const until = Date.now() + keepaliveMs;
      while (Date.now() < until) {
        controller.enqueue(encoder.encode(": OPENROUTER PROCESSING\n\n"));
        await Bun.sleep(10);
      }
      controller.enqueue(content(" world"));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function collectWithIdleBudget(response: Response, inactivityTimeoutMs: number): Promise<RawStreamChunk[]> {
  globalThis.fetch = (async () => response) as unknown as typeof fetch;
  const chunks: RawStreamChunk[] = [];
  const config = { ...makeStreamConfig(), inactivityTimeoutMs };
  for await (const chunk of new OpenrouterStreamAdapter().startStream(config, makeStreamContext())) {
    chunks.push(chunk);
  }
  return chunks;
}

function streamedText(chunks: RawStreamChunk[]): string {
  return chunks
    .map((chunk) => {
      const data = chunk.data as { choices?: Array<{ delta?: { content?: string } }> };
      return data.choices?.[0]?.delta?.content ?? "";
    })
    .join("");
}

describe("OpenrouterStreamAdapter first-token budget", () => {
  it("waits out a queue of keepalives longer than the idle budget before the first token", async () => {
    // A queued free model sends only keepalives; judging that wait by the idle budget cut the
    // request off before the model ever started.
    const chunks = await collectWithIdleBudget(makeQueuedSseResponse(150, false), 40);

    expect(streamedText(chunks)).toBe(" world");
  });

  it("still enforces the idle budget once the first token has arrived", async () => {
    const chunks = await collectWithIdleBudget(makeQueuedSseResponse(150, true), 40);
    const errors = chunks.map((chunk) => (chunk.data as { error?: { message?: string } }).error?.message);

    expect(streamedText(chunks)).toBe("Hello");
    expect(errors).toContainEqual(expect.stringContaining("timed out due to inactivity"));
  });
});
