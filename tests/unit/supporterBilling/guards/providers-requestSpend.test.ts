import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as spendEstimates from "@/modules/supporter-billing/runtime/spendEstimates";
import { synthesizeOpenRouterSpeech } from "@/providers/openrouter/openrouterSpeech";
import * as videoGeneration from "@/providers/openrouter/openrouterVideoGeneration";
import { OpenrouterStreamAdapter, type OpenrouterStreamConfig } from "@/providers/openrouter/openrouterStreamAdapter";
import type { StreamContext } from "@/types/stream/interfaces";
import * as safeDownload from "@/utils/security/safeDownload";
import * as videoModelCache from "@/utils/cache/openrouterVideoModelCache";
import { HOSTED_SPEECH_LIMITS } from "@/utils/speech/hostedSpeech";
import { createPersona } from "../../../helpers/fixtures";
import { stubGlobalFetch } from "../../../helpers/fetchStub";
import { createSpeechMp3 } from "../../../helpers/speechAudio";
import { installSpendHarness, type SpendHarness } from "./utils-fundingFixtures";

const FIXTURE_ESTIMATE = 0.05;
const SPEECH_MODEL = "bytedance-seed/seed-audio-1-0";
const VIDEO_MODEL = "fixture/video-model";

function mockEstimate() {
  return spyOn(spendEstimates, "estimateSupporterRequestCost").mockResolvedValue(FIXTURE_ESTIMATE);
}

let harness: SpendHarness;
let mp3: Buffer;
let estimateSpy: ReturnType<typeof mockEstimate> | undefined;

beforeAll(async () => {
  harness = installSpendHarness();
  mp3 = await createSpeechMp3();
});

afterAll(() => {
  harness.restore();
});

beforeEach(() => {
  estimateSpy = mockEstimate();
});

afterEach(() => {
  estimateSpy?.mockRestore();
  estimateSpy = undefined;
});

function speechRequest(apiKey: string, signal: AbortSignal) {
  return {
    shape: "design" as const,
    model: SPEECH_MODEL,
    apiKey,
    description: "fixture voice",
    script: "A fixture line",
    signal,
    maxBytes: HOSTED_SPEECH_LIMITS.outputBytes,
    operations: [],
  };
}

function speechAudioResponse() {
  return new Response(new Uint8Array(mp3), {
    headers: { "Content-Type": "audio/mpeg", "X-Generation-Id": "fixture-generation" },
  });
}

function videoRequest(apiKey: string, abortSignal?: AbortSignal) {
  return {
    apiKey,
    model: VIDEO_MODEL,
    prompt: "A fixture video",
    ...(abortSignal ? { abortSignal } : {}),
  };
}

function mockVideoApi(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return spyOn(videoGeneration, "fetchOpenRouterVideoApi").mockImplementation(async (url, init) => handler(url, init));
}

function mockVideoCapabilities() {
  return spyOn(videoModelCache, "getOrFetchOpenRouterVideoModelCapabilities").mockResolvedValue(undefined);
}

function streamConfig(apiKey: string): OpenrouterStreamConfig {
  return {
    model: "fixture/stream-model",
    apiKey,
    temperature: 0.8,
    maxMessageLength: 2_000,
    flushBufferSize: 1_000,
    flushBufferSizeCodeBlock: 15_000,
    inactivityTimeoutMs: 5_000,
    baseTypeSpeedMsPerChar: 0,
    maxTypingTimeMs: 0,
    minVisibleTypingDurationMs: 0,
    humanizerDegree: 0,
    emojiUsageEnabled: false,
  };
}

function streamContext(abortSignal?: AbortSignal): StreamContext {
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

describe("synthesizeOpenRouterSpeech spend guard", () => {
  it("holds spend before the provider call and reports the generation cost", async () => {
    const key = harness.register();
    const fetchStub = stubGlobalFetch((input) => {
      if (String(input).includes("/generation?")) return Response.json({ data: { total_cost: 0.12 } });
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      return speechAudioResponse();
    });
    try {
      await expect(synthesizeOpenRouterSpeech(speechRequest(key.apiKey, AbortSignal.timeout(5_000)))).resolves.toEqual(
        mp3,
      );
      expect(harness.observed(key.keyHash)).toBe(0.12);
      expect(harness.pending(key.identityId)).toBe(0);
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("reports zero and releases the hold when speech fails", async () => {
    const key = harness.register();
    const fetchStub = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      return Response.json({ error: { message: "fixture failure" } }, { status: 500 });
    });
    try {
      await expect(synthesizeOpenRouterSpeech(speechRequest(key.apiKey, AbortSignal.timeout(5_000)))).rejects.toThrow();
      expect(harness.observed(key.keyHash)).toBe(0);
      expect(harness.pending(key.identityId)).toBe(0);
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("reports zero and releases the hold when speech is aborted", async () => {
    const key = harness.register();
    const controller = new AbortController();
    const fetchStub = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      controller.abort();
      throw controller.signal.reason;
    });
    try {
      await expect(synthesizeOpenRouterSpeech(speechRequest(key.apiKey, controller.signal))).rejects.toThrow();
      expect(harness.observed(key.keyHash)).toBe(0);
      expect(harness.pending(key.identityId)).toBe(0);
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("takes no hold for an unregistered key and still sends the request", async () => {
    const key = harness.register();
    const fetchStub = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBe(0);
      return Response.json({ error: { message: "fixture failure" } }, { status: 500 });
    });
    try {
      await expect(
        synthesizeOpenRouterSpeech(speechRequest("fixture-unfunded-key", AbortSignal.timeout(5_000))),
      ).rejects.toThrow();
      expect(fetchStub).toHaveBeenCalledTimes(1);
      expect(harness.observed(key.keyHash)).toBe(0);
      expect(harness.pending(key.identityId)).toBe(0);
    } finally {
      fetchStub.mockRestore();
    }
  });
});

describe("generateOpenRouterNativeVideo spend guard", () => {
  it("holds spend before submission and reports the submitted job cost after the request fails", async () => {
    const key = harness.register();
    const capabilities = mockVideoCapabilities();
    const calls: string[] = [];
    const api = mockVideoApi((url, init) => {
      calls.push(`${init.method} ${url}`);
      if (init.method === "POST") {
        expect(harness.pending(key.identityId)).toBeGreaterThan(0);
        return Response.json({
          id: "fixture-job",
          polling_url: "/api/v1/videos/fixture-job",
          status: "pending",
          usage: { cost: 0.25 },
        });
      }
      return Response.json({ id: "fixture-job", status: "failed", error: "fixture failure" });
    });
    try {
      await expect(videoGeneration.generateOpenRouterNativeVideo(videoRequest(key.apiKey))).rejects.toThrow();
      expect(calls).toHaveLength(2);
      expect(harness.observed(key.keyHash)).toBe(0.25);
      expect(harness.pending(key.identityId)).toBe(0);
    } finally {
      api.mockRestore();
      capabilities.mockRestore();
    }
  });

  it("reports completed job cost and releases the hold after downloading the video", async () => {
    estimateSpy?.mockResolvedValue(0.5);
    const key = harness.register();
    const capabilities = mockVideoCapabilities();
    const videoData = Buffer.from("fixture video data");
    const download = spyOn(safeDownload, "safeDownload").mockImplementation(async () => {
      expect(harness.observed(key.keyHash)).toBe(0.3);
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      return { success: true, buffer: videoData };
    });
    const api = mockVideoApi((_url, init) => {
      if (init.method === "POST") expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      return Response.json(
        init.method === "POST"
          ? {
              id: "fixture-completed-job",
              polling_url: "/api/v1/videos/fixture-completed-job",
              status: "pending",
              usage: { cost: 0.1 },
            }
          : {
              id: "fixture-completed-job",
              status: "completed",
              usage: { cost: 0.3 },
              unsigned_urls: ["https://media.example.com/fixture.mp4"],
            },
      );
    });
    try {
      const result = await videoGeneration.generateOpenRouterNativeVideo(videoRequest(key.apiKey));
      expect(result.videoData).toEqual(videoData);
      expect(download).toHaveBeenCalledTimes(1);
      expect(harness.observed(key.keyHash)).toBe(0.3);
      expect(harness.pending(key.identityId)).toBe(0);
    } finally {
      api.mockRestore();
      download.mockRestore();
      capabilities.mockRestore();
    }
  });

  it("reports zero and releases the hold when submission fails", async () => {
    const key = harness.register();
    const capabilities = mockVideoCapabilities();
    const api = mockVideoApi(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      return Response.json({ error: { message: "fixture failure" } }, { status: 500 });
    });
    try {
      await expect(videoGeneration.generateOpenRouterNativeVideo(videoRequest(key.apiKey))).rejects.toThrow();
      expect(harness.observed(key.keyHash)).toBe(0);
      expect(harness.pending(key.identityId)).toBe(0);
    } finally {
      api.mockRestore();
      capabilities.mockRestore();
    }
  });

  it("reports zero and releases the hold when submission is aborted", async () => {
    const key = harness.register();
    const controller = new AbortController();
    const capabilities = mockVideoCapabilities();
    const api = mockVideoApi(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      controller.abort();
      throw controller.signal.reason;
    });
    try {
      await expect(
        videoGeneration.generateOpenRouterNativeVideo(videoRequest(key.apiKey, controller.signal)),
      ).rejects.toThrow();
      expect(harness.observed(key.keyHash)).toBe(0);
      expect(harness.pending(key.identityId)).toBe(0);
    } finally {
      api.mockRestore();
      capabilities.mockRestore();
    }
  });

  it("takes no hold for an unregistered key and still sends the request", async () => {
    const key = harness.register();
    const capabilities = mockVideoCapabilities();
    const api = mockVideoApi(() => {
      expect(harness.pending(key.identityId)).toBe(0);
      return Response.json({ error: { message: "fixture failure" } }, { status: 500 });
    });
    try {
      await expect(
        videoGeneration.generateOpenRouterNativeVideo(videoRequest("fixture-unfunded-key")),
      ).rejects.toThrow();
      expect(api).toHaveBeenCalledTimes(1);
      expect(harness.observed(key.keyHash)).toBe(0);
      expect(harness.pending(key.identityId)).toBe(0);
    } finally {
      api.mockRestore();
      capabilities.mockRestore();
    }
  });
});

describe("OpenrouterStreamAdapter spend guard", () => {
  it("holds spend before the stream request and reports its usage cost", async () => {
    const key = harness.register();
    const fetchStub = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      return sseResponse([
        { choices: [{ index: 0, delta: { content: "Hi" } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, cost: 0.03 } },
        "[DONE]",
      ]);
    });
    try {
      await drainStream(new OpenrouterStreamAdapter().startStream(streamConfig(key.apiKey), streamContext()));
      expect(harness.observed(key.keyHash)).toBe(0.03);
      expect(harness.pending(key.identityId)).toBe(0);
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("reports zero and releases the hold when the stream request fails", async () => {
    const key = harness.register();
    const fetchStub = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      return Response.json({ error: { message: "fixture failure" } }, { status: 500 });
    });
    try {
      await drainStream(new OpenrouterStreamAdapter().startStream(streamConfig(key.apiKey), streamContext()));
      expect(fetchStub).toHaveBeenCalledTimes(1);
      expect(harness.observed(key.keyHash)).toBe(0);
      expect(harness.pending(key.identityId)).toBe(0);
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("reports zero and releases the hold when the stream request is aborted", async () => {
    const key = harness.register();
    const controller = new AbortController();
    const fetchStub = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      controller.abort();
      throw controller.signal.reason;
    });
    try {
      await drainStream(
        new OpenrouterStreamAdapter().startStream(streamConfig(key.apiKey), streamContext(controller.signal)),
      );
      expect(harness.observed(key.keyHash)).toBe(0);
      expect(harness.pending(key.identityId)).toBe(0);
    } finally {
      fetchStub.mockRestore();
    }
  });

  it("takes no hold for an unregistered key and still sends the request", async () => {
    const key = harness.register();
    const fetchStub = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBe(0);
      return sseResponse([
        { choices: [{ index: 0, delta: { content: "Hi" } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        "[DONE]",
      ]);
    });
    try {
      await drainStream(
        new OpenrouterStreamAdapter().startStream(streamConfig("fixture-unfunded-key"), streamContext()),
      );
      expect(fetchStub).toHaveBeenCalledTimes(1);
      expect(harness.observed(key.keyHash)).toBe(0);
      expect(harness.pending(key.identityId)).toBe(0);
    } finally {
      fetchStub.mockRestore();
    }
  });
});
