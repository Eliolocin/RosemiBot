import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import ffmpegPath from "ffmpeg-static";
import { createGoogleSpeechTransport } from "@/providers/google/googleSpeech";
import { synthesizeOpenRouterSpeech } from "@/providers/openrouter/openrouterSpeech";
import { createVertexClient } from "@/providers/vertex/vertexClient";
import { HOSTED_SPEECH_LIMITS, validateSpeechAudio, type SpeechOperation } from "@/utils/speech/hostedSpeech";
import { normalizeVoiceSampleToWav } from "@/utils/speech/voiceSampleAddOperation";
import { synthesizeVoiceMessage } from "@/utils/speech/voiceMessageSynthesis";
import { speechModelSchema } from "@/types/db/schema";
import { SPEECH_SAMPLE_MAX_DURATION_SECS } from "@/utils/speech/voiceSampleAddOperation";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { createSpeechWav } from "../../helpers/speechAudio";

const wav = createSpeechWav();
let mp3: Buffer;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
const signal = () => AbortSignal.timeout(5_000);

function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => handler(String(input), init ?? {}),
      { preconnect: () => undefined },
    ),
  );
}

const googleAudio = (data = wav.toString("base64"), mime = "audio/wav") => ({
  status: "completed",
  usage: { total_output_tokens: 5, secret: "discard" },
  steps: [{ type: "model_output", content: [{ type: "audio", mime_type: mime, data }] }],
});

beforeAll(async () => {
  if (!ffmpegPath) throw new Error("Missing bundled audio converter");
  const proc = Bun.spawn([ffmpegPath, "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "mp3", "pipe:1"], {
    stdin: new Blob([new Uint8Array(wav)]),
    stdout: "pipe",
    stderr: "pipe",
  });
  mp3 = Buffer.from(await new Response(proc.stdout).arrayBuffer());
  expect(await proc.exited).toBe(0);
});

afterEach(() => fetchSpy?.mockRestore());

describe("hosted speech transports", () => {
  it("keeps prompted identity, spoken text, and direction in separate Gemini fields and preserves only usage fields", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    stubFetch(async (url, init) => {
      calls.push({ url, init });
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      return Response.json(
        url.endsWith("/voices")
          ? { id: "voice_test", expire_time: "2027-01-01T00:00:00Z", usage: { total_input_tokens: 7 } }
          : googleAudio(),
      );
    });
    const transport = createGoogleSpeechTransport("google", "synthetic-google-key");
    const operations: SpeechOperation[] = [];
    const voice = await transport.create("Warm narration", "gemini-3.8-flash-tts", signal(), operations);
    const audio = await transport.synthesize(
      voice.voiceId,
      "Hello",
      "Quietly",
      "gemini-3.8-flash-lite-tts",
      signal(),
      HOSTED_SPEECH_LIMITS.outputBytes,
      operations,
    );
    await transport.delete(voice.voiceId, signal(), operations);
    expect(audio).toEqual(wav);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      store: true,
      voice: { type: "prompted", prompted: { input: "Warm narration" } },
    });
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({
      input: [{ content: [{ text: "Hello", annotations: [{ type: "speech_metadata", style: "Quietly" }] }] }],
      generation_config: { speech_config: [{ voice: "voice_test" }] },
    });
    for (const { url, init } of calls) {
      expect(new URL(url).origin).toBe("https://generativelanguage.googleapis.com");
      expect(init.redirect).toBe("error");
      expect(new Headers(init.headers).get("x-goog-api-key")).toBe("synthetic-google-key");
    }
    expect(operations.map((operation) => operation.operation)).toEqual(["create", "synthesize", "delete"]);
    expect(operations[1].usage).toEqual({ total_output_tokens: 5 });
  });

  it("uses Vertex ADC and project-scoped REST without sending its composite config as a key", async () => {
    const client = createVertexClient({ projectId: "sample-project", location: "global" });
    const authSpy = spyOn(
      Object.getPrototypeOf(client) as { getAuthHeaders(): Promise<Headers> },
      "getAuthHeaders",
    ).mockResolvedValue(new Headers({ Authorization: "Bearer synthetic-adc" }));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    stubFetch(async (url, init) => {
      calls.push({ url, init });
      return Response.json(
        url.endsWith("/voices")
          ? { id: "voice_cloud" }
          : {
              candidates: [
                {
                  finishReason: "STOP",
                  content: { parts: [{ inlineData: { mimeType: "audio/wav", data: wav.toString("base64") } }] },
                },
              ],
              usageMetadata: { totalTokenCount: 8 },
            },
      );
    });
    try {
      const transport = createGoogleSpeechTransport("vertex", "sample-project::global");
      const operations: SpeechOperation[] = [];
      const voice = await transport.create("Warm narration", "gemini-3.8-flash-tts", signal(), operations);
      expect(
        await transport.synthesize(
          voice.voiceId,
          "Hello",
          undefined,
          "gemini-3.8-flash-tts",
          signal(),
          wav.length,
          operations,
        ),
      ).toEqual(wav);
      expect(calls[1].url).toContain(
        "/projects/sample-project/locations/global/publishers/google/models/gemini-3.8-flash-tts:generateContent",
      );
      expect(JSON.parse(String(calls[1].init.body))).toMatchObject({
        contents: [{ role: "user" }],
        generationConfig: { speechConfig: { voiceConfig: { voice: "voice_cloud" } } },
      });
      expect(new Headers(calls[0].init.headers).has("x-goog-api-key")).toBe(false);
      expect(new Headers(calls[0].init.headers).get("Authorization")).toBe("Bearer synthetic-adc");
      expect(operations[1].usage?.totalTokenCount).toBe(8);
    } finally {
      authSpy.mockRestore();
    }
  });

  it("rejects malformed, empty, truncated, oversized, refused, and non-audio Gemini responses", async () => {
    const transport = createGoogleSpeechTransport("google", "synthetic");
    const cases = [
      googleAudio(""),
      googleAudio("%%%="),
      googleAudio(wav.subarray(0, -2).toString("base64")),
      googleAudio(wav.toString("base64"), "audio/mpeg"),
      { status: "failed", steps: [] },
      { status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "refused" }] }] },
    ];
    for (const body of cases) {
      stubFetch(async () => Response.json(body));
      await expect(
        transport.synthesize("voice_test", "Hello", undefined, "gemini-3.8-flash-tts", signal(), wav.length, []),
      ).rejects.toThrow();
      fetchSpy?.mockRestore();
    }
    stubFetch(async () => Response.json(googleAudio()));
    await expect(
      transport.synthesize("voice_test", "Hello", undefined, "gemini-3.8-flash-tts", signal(), 20, []),
    ).rejects.toThrow();
  });

  it("distinguishes confirmed missing voices from missing models and preserves failure usage", async () => {
    const transport = createGoogleSpeechTransport("google", "synthetic");
    for (const [status, kind] of [
      [401, "authentication"],
      [429, "quota"],
      [500, "provider_error"],
    ] as const) {
      stubFetch(async () =>
        Response.json(
          { usage: { total_input_tokens: 3 }, error: { message: "sensitive upstream content" } },
          { status },
        ),
      );
      const operations: SpeechOperation[] = [];
      await expect(
        transport.synthesize(
          "voice_test",
          "Hello",
          undefined,
          "gemini-3.8-flash-tts",
          signal(),
          wav.length,
          operations,
        ),
      ).rejects.toMatchObject({ kind });
      expect(operations[0].usage?.total_input_tokens).toBe(3);
      fetchSpy?.mockRestore();
    }
    for (const missing of [true, false]) {
      stubFetch(async (_url, init) =>
        init.method === "GET" && !missing ? Response.json({ id: "voice_test" }) : new Response(null, { status: 404 }),
      );
      await expect(
        transport.synthesize("voice_test", "Hello", undefined, "gemini-3.8-flash-tts", signal(), wav.length, []),
      ).rejects.toMatchObject({ kind: missing ? "missing_voice" : "provider_error" });
      fetchSpy?.mockRestore();
    }
  });

  it("clones with inline WAV and returns MP3 while cost lookup failure preserves audio and unknown cost", async () => {
    for (const cost of [null, 0.12]) {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      stubFetch(async (url, init) => {
        calls.push({ url, init });
        return url.includes("/generation?")
          ? cost === null
            ? new Response(null, { status: 404 })
            : Response.json({ data: { total_cost: cost, tokens_prompt: 12, native_tokens_completion: null } })
          : new Response(new Uint8Array(mp3), {
              headers: { "Content-Type": "audio/mpeg", "X-Generation-Id": "gen_synthetic" },
            });
      });
      const operations: SpeechOperation[] = [];
      expect(
        await synthesizeOpenRouterSpeech({
          model: "fish-audio/s2.1-pro-free:free",
          apiKey: "synthetic-fish",
          script: "Hello",
          direction: "Quietly",
          reference: wav,
          transcript: "Test reference",
          signal: signal(),
          maxBytes: HOSTED_SPEECH_LIMITS.outputBytes,
          operations,
        }),
      ).toEqual(mp3);
      expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
        model: "fish-audio/s2.1-pro-free:free",
        response_format: "mp3",
        input_references: [
          { type: "input_audio", input_audio: { data: `data:audio/wav;base64,${wav.toString("base64")}` } },
          { type: "text", text: "Test reference" },
        ],
      });
      expect(operations[0].generationId).toBe("gen_synthetic");
      expect(operations[1].actualCost).toBe(cost ?? undefined);
      if (cost !== null) expect(operations[0].usage).toEqual({ tokens_prompt: 12, native_tokens_completion: null });
      expect(calls.every(({ init }) => init.redirect === "error")).toBe(true);
      fetchSpy?.mockRestore();
    }
  });

  it("rejects wrong MIME, invalid MP3, byte overflow, and provider refusal without a cost request", async () => {
    for (const response of [
      new Response(new Uint8Array(mp3), { headers: { "Content-Type": "text/plain" } }),
      new Response("invalid", { headers: { "Content-Type": "audio/mpeg" } }),
      new Response(new Uint8Array(mp3), { headers: { "Content-Type": "audio/mpeg" } }),
      new Response(null, { status: 403 }),
    ]) {
      stubFetch(async () => response);
      await expect(
        synthesizeOpenRouterSpeech({
          model: "fish-audio/s2.1-pro",
          apiKey: "synthetic",
          script: "Hello",
          reference: wav,
          transcript: null,
          signal: signal(),
          maxBytes: 100,
          operations: [],
        }),
      ).rejects.toThrow();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      fetchSpy?.mockRestore();
    }
  });

  it("aborts pending response reads and rejects pre-cancelled transport calls before fetch", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
    );
    const read = readBoundedResponse(response, 100, controller.signal);
    controller.abort();
    await expect(read).rejects.toThrow();
    expect(cancelled).toBe(true);
    stubFetch(async () => {
      throw new Error("Unexpected request");
    });
    await expect(
      createGoogleSpeechTransport("google", "synthetic").create("Warm", "gemini-3.8-flash-tts", controller.signal, []),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a truncated MP3 frame and refuses oversized conversion without trimming audio", async () => {
    await expect(
      validateSpeechAudio(mp3.subarray(0, -1), "audio/mpeg", HOSTED_SPEECH_LIMITS.outputBytes),
    ).rejects.toThrow();
    await expect(normalizeVoiceSampleToWav(wav, signal(), 100)).rejects.toThrow();
    const normalized = await normalizeVoiceSampleToWav(wav, signal(), HOSTED_SPEECH_LIMITS.referenceBytes);
    await expect(
      validateSpeechAudio(normalized, "audio/wav", HOSTED_SPEECH_LIMITS.referenceBytes),
    ).resolves.toBeUndefined();
  });

  it("enforces hosted text and reference limits before sending a synthesis request", async () => {
    stubFetch(async () => {
      throw new Error("Unexpected synthesis");
    });
    const target = {
      kind: "hosted-model" as const,
      endpoint: null,
      owner: { kind: "server" as const, ownerId: 1 },
      model: speechModelSchema.parse({
        speech_model_id: 1,
        provider: "openrouter",
        codename: "fish-audio/s2.1-pro",
        voice_mode: "clone",
      }),
      apiKey: "synthetic",
      credentialId: 1,
      credentialRevision: 1,
    };
    const base = {
      target,
      endpoint: null,
      endpointApiKey: "",
      elevenLabsApiKey: "",
      script: "Hello",
      source: { kind: "clone-buffer" as const, refAudio: wav, refText: null },
    };
    for (const overrides of [
      { script: "x".repeat(HOSTED_SPEECH_LIMITS.scriptCharacters + 1) },
      { voiceInstructions: "x".repeat(HOSTED_SPEECH_LIMITS.directionCharacters + 1) },
      {
        source: {
          kind: "clone-buffer" as const,
          refAudio: wav,
          refText: "x".repeat(HOSTED_SPEECH_LIMITS.transcriptCharacters + 1),
        },
      },
      {
        source: {
          kind: "clone-buffer" as const,
          refAudio: createSpeechWav(SPEECH_SAMPLE_MAX_DURATION_SECS + 1),
          refText: null,
        },
      },
      { source: { kind: "design" as const, designPrompt: "Warm narration" } },
    ]) {
      expect((await synthesizeVoiceMessage({ ...base, ...overrides })).errorKind).toBe("invalid_request");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
