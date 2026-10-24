import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { OpenrouterStreamAdapter, type OpenrouterStreamConfig } from "@/providers/openrouter/openrouterStreamAdapter";
import { synthesizeOpenRouterSpeech } from "@/providers/openrouter/openrouterSpeech";
import { HumanizerDegree } from "@/types/db/schema";
import type { StreamContext } from "@/types/stream/interfaces";
import type { SpeechOperation } from "@/utils/speech/hostedSpeech";
import { HOSTED_SPEECH_LIMITS } from "@/utils/speech/hostedSpeech";
import {
  beginProviderRequest,
  fetchWithProviderRequest,
  registerProviderRequestHook,
  type ProviderRequestContext,
} from "@/utils/provider/providerRequestHook";
import { createPersona } from "../../helpers/fixtures";
import { stubGlobalFetch } from "../../helpers/fetchStub";
import { createSpeechMp3 } from "../../helpers/speechAudio";

const CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const SPEECH_MODEL = "bytedance-seed/seed-audio-1-0";

interface RecordedHold {
  context: ProviderRequestContext;
  reports: number[];
  releases: Array<boolean | undefined>;
  released: boolean;
}

const restores: Array<() => void> = [];
let mp3: Buffer;

beforeAll(async () => {
  mp3 = await createSpeechMp3();
});

afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore();
});

function installTestHook(onBegin?: (context: ProviderRequestContext) => void): RecordedHold[] {
  const holds: RecordedHold[] = [];
  restores.push(
    registerProviderRequestHook((context) => {
      const hold: RecordedHold = { context, reports: [], releases: [], released: false };
      holds.push(hold);
      onBegin?.(context);
      return {
        reportCost(cost) {
          if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) hold.reports.push(cost);
        },
        release(retainEstimate) {
          hold.releases.push(retainEstimate);
          hold.released = true;
        },
      };
    }),
  );
  return holds;
}

function makeStreamConfig(): OpenrouterStreamConfig {
  return {
    model: "example/model",
    apiKey: "fixture-key",
    temperature: 0.8,
    maxMessageLength: 2_000,
    flushBufferSize: 1_000,
    flushBufferSizeCodeBlock: 15_000,
    inactivityTimeoutMs: 5_000,
    baseTypeSpeedMsPerChar: 0,
    maxTypingTimeMs: 0,
    minVisibleTypingDurationMs: 0,
    humanizerDegree: HumanizerDegree.NONE,
    emojiUsageEnabled: false,
  };
}

function makeStreamContext(abortSignal?: AbortSignal): StreamContext {
  return {
    channel: {},
    client: {},
    tomoriState: createPersona({
      persona_nickname: "Mirri",
      trigger_words: [],
      config: {
        llm_stop_speaker_pattern_enabled: false,
        llm_stop_strings: [],
        thinking_level: "none",
      },
    }),
    contextItems: [],
    currentTurnModelParts: [],
    provider: "openrouter",
    locale: "en-US",
    ...(abortSignal ? { abortSignal } : {}),
  } as unknown as StreamContext;
}

function sseResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function drainStream(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const chunk of stream) void chunk;
}

function speechRequest(apiKey: string, signal: AbortSignal, operations: SpeechOperation[] = []) {
  return {
    shape: "design" as const,
    model: SPEECH_MODEL,
    apiKey,
    description: "fixture voice",
    script: "A fixture line",
    signal,
    maxBytes: HOSTED_SPEECH_LIMITS.outputBytes,
    operations,
  };
}

describe("provider request hook in the stream adapter", () => {
  it("takes the hold before the HTTP call and settles the stream's usage cost", async () => {
    const holds = installTestHook();
    const fetchStub = stubGlobalFetch(() => {
      expect(holds).toHaveLength(1);
      expect(holds[0].released).toBe(false);
      return sseResponse([
        { choices: [{ index: 0, delta: { content: "Hi" } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, cost: 0.03 } },
        "[DONE]",
      ]);
    });
    try {
      await drainStream(new OpenrouterStreamAdapter().startStream(makeStreamConfig(), makeStreamContext()));
      expect(holds[0].context).toEqual({
        apiKey: "fixture-key",
        path: "/chat/completions",
        body: expect.objectContaining({ model: "example/model" }),
      });
      expect(holds[0].reports).toEqual([0.03]);
      expect(holds[0].releases).toEqual([true]);
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("reports zero and releases the hold when the stream request fails", async () => {
    const holds = installTestHook();
    const fetchStub = stubGlobalFetch(() => Response.json({ error: { message: "fixture failure" } }, { status: 500 }));
    try {
      await drainStream(new OpenrouterStreamAdapter().startStream(makeStreamConfig(), makeStreamContext()));
      expect(holds[0].reports).toEqual([0]);
      expect(holds[0].releases).toEqual([false]);
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("reports zero and releases the hold when the request is aborted after the hold is taken", async () => {
    const controller = new AbortController();
    const holds = installTestHook(() => controller.abort());
    const fetchStub = stubGlobalFetch(() => {
      throw new Error("Unexpected request");
    });
    try {
      await drainStream(
        new OpenrouterStreamAdapter().startStream(makeStreamConfig(), makeStreamContext(controller.signal)),
      );
      expect(fetchStub).not.toHaveBeenCalled();
      expect(holds[0].reports).toEqual([0]);
      expect(holds[0].releases).toEqual([false]);
    } finally {
      fetchStub.mockRestore();
    }
  });
});

describe("provider request hook in the speech adapter", () => {
  it("takes the hold before the HTTP call and reports the generation's actual cost", async () => {
    const holds = installTestHook();
    const fetchStub = stubGlobalFetch((input) => {
      if (String(input).includes("/generation?")) return Response.json({ data: { total_cost: 0.12 } });
      expect(holds).toHaveLength(1);
      expect(holds[0].released).toBe(false);
      return new Response(new Uint8Array(mp3), {
        headers: { "Content-Type": "audio/mpeg", "X-Generation-Id": "fixture-generation" },
      });
    });
    try {
      const operations: SpeechOperation[] = [];
      const audio = await synthesizeOpenRouterSpeech(
        speechRequest("fixture-key", AbortSignal.timeout(5_000), operations),
      );
      expect(audio).toEqual(mp3);
      expect(holds[0].context).toEqual({
        apiKey: "fixture-key",
        path: "/audio/speech",
        body: expect.objectContaining({ model: SPEECH_MODEL }),
      });
      expect(holds[0].reports).toEqual([0.12]);
      expect(holds[0].releases).toEqual([true]);
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("reports zero and releases the hold when speech fails", async () => {
    const holds = installTestHook();
    const fetchStub = stubGlobalFetch(() => Response.json({ error: { message: "fixture failure" } }, { status: 500 }));
    try {
      await expect(
        synthesizeOpenRouterSpeech(speechRequest("fixture-key", AbortSignal.timeout(5_000))),
      ).rejects.toThrow();
      expect(holds[0].reports).toEqual([0]);
      expect(holds[0].releases).toEqual([false]);
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("reports zero and releases the hold when speech is aborted after the hold is taken", async () => {
    const controller = new AbortController();
    const holds = installTestHook(() => controller.abort());
    const fetchStub = stubGlobalFetch(() => {
      throw new Error("Unexpected request");
    });
    try {
      await expect(synthesizeOpenRouterSpeech(speechRequest("fixture-key", controller.signal))).rejects.toThrow();
      expect(fetchStub).not.toHaveBeenCalled();
      expect(holds[0].reports).toEqual([0]);
      expect(holds[0].releases).toEqual([false]);
    } finally {
      fetchStub.mockRestore();
    }
  });
});

describe("provider request fetch wrapper", () => {
  it("takes the hold before the HTTP call and settles the response's usage cost", async () => {
    const holds = installTestHook();
    const fetchStub = stubGlobalFetch(() => {
      expect(holds).toHaveLength(1);
      expect(holds[0].released).toBe(false);
      return Response.json({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 1, cost: 0.02 } });
    });
    try {
      const response = await fetchWithProviderRequest(CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: { Authorization: "Bearer fixture-key", "Content-Type": "application/json" },
        body: JSON.stringify({ model: "fixture/text-model", messages: [] }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        choices: [],
        usage: { prompt_tokens: 3, completion_tokens: 1, cost: 0.02 },
      });
      expect(holds[0].context).toEqual({
        apiKey: "fixture-key",
        path: "/api/v1/chat/completions",
        body: { model: "fixture/text-model", messages: [] },
      });
      expect(holds[0].reports).toEqual([0.02]);
      expect(holds[0].releases).toEqual([true]);
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("reports zero and preserves the response when the request fails", async () => {
    const holds = installTestHook();
    const fetchStub = stubGlobalFetch(() =>
      Response.json({ error: "fixture failure" }, { status: 502, statusText: "Bad Gateway" }),
    );
    try {
      const response = await fetchWithProviderRequest(CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: { Authorization: "Bearer fixture-key" },
        body: JSON.stringify({ model: "fixture/text-model" }),
      });
      expect(response.status).toBe(502);
      expect(response.statusText).toBe("Bad Gateway");
      expect(await response.json()).toEqual({ error: "fixture failure" });
      expect(holds[0].reports).toEqual([0]);
      expect(holds[0].releases).toEqual([false]);
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("reports zero and releases the hold when the request is aborted after the hold is taken", async () => {
    const controller = new AbortController();
    const holds = installTestHook(() => controller.abort());
    const fetchStub = stubGlobalFetch(() => {
      throw new Error("Unexpected request");
    });
    try {
      await expect(
        fetchWithProviderRequest(CHAT_COMPLETIONS_URL, {
          method: "POST",
          headers: { Authorization: "Bearer fixture-key" },
          body: JSON.stringify({ model: "fixture/text-model" }),
          signal: controller.signal,
        }),
      ).rejects.toThrow();
      expect(fetchStub).not.toHaveBeenCalled();
      expect(holds[0].reports).toEqual([0]);
      expect(holds[0].releases).toEqual([false]);
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("releases the hold when the transport throws without spending", async () => {
    const holds = installTestHook();
    const fetchStub = stubGlobalFetch(() => {
      throw new Error("fixture transport failure");
    });
    try {
      await expect(
        fetchWithProviderRequest(CHAT_COMPLETIONS_URL, {
          method: "POST",
          headers: { Authorization: "Bearer fixture-key" },
          body: JSON.stringify({ model: "fixture/text-model" }),
        }),
      ).rejects.toThrow("fixture transport failure");
      expect(holds[0].reports).toEqual([]);
      expect(holds[0].releases).toEqual([false]);
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("only applies a registered hook to POST requests", async () => {
    const holds = installTestHook();
    const original = Response.json({ choices: [] });
    const fetchStub = stubGlobalFetch(() => original);
    try {
      const response = await fetchWithProviderRequest(CHAT_COMPLETIONS_URL);
      expect(response).toBe(original);
      expect(holds).toHaveLength(0);
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("returns no hold and the same response when nothing is registered", async () => {
    expect(await beginProviderRequest({ apiKey: "fixture-key", path: "/chat/completions", body: {} })).toBeUndefined();
    const original = Response.json({ choices: [] });
    const fetchStub = stubGlobalFetch(() => original);
    try {
      const response = await fetchWithProviderRequest(CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: { Authorization: "Bearer fixture-key" },
        body: JSON.stringify({ model: "fixture/text-model" }),
      });
      expect(response).toBe(original);
    } finally {
      fetchStub.mockRestore();
    }
  });
});
