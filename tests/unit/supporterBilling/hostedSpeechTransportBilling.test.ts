import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { synthesizeOpenRouterSpeech } from "@/providers/openrouter/openrouterSpeech";
import { HOSTED_SPEECH_LIMITS, HostedSpeechError } from "@/utils/speech/hostedSpeech";
import { findOpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import { createSpeechWav } from "../../helpers/speechAudio";

const wav = createSpeechWav();
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
const originalAttributionSetting = process.env.OPENROUTER_APP_ATTRIBUTION_ENABLED;
const signal = () => AbortSignal.timeout(5_000);

function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => handler(String(input), init ?? {}),
      { preconnect: () => undefined },
    ),
  );
}

afterEach(() => {
  fetchSpy?.mockRestore();
  if (originalAttributionSetting === undefined) delete process.env.OPENROUTER_APP_ATTRIBUTION_ENABLED;
  else process.env.OPENROUTER_APP_ATTRIBUTION_ENABLED = originalAttributionSetting;
});

describe("hosted speech transports", () => {
  it("preserves redacted OpenRouter speech failure detail alongside limit classification", async () => {
    const apiKey = "fixture-credential-without-a-recognizable-prefix";
    for (const status of [400, 403, 500]) {
      stubFetch(async () => Response.json({ error: { message: `PROVIDER_DETAIL_CANARY ${apiKey}` } }, { status }));
      const failure = await synthesizeOpenRouterSpeech({
        shape: "clone",
        model: "fish-audio/s2.1-pro",
        apiKey,
        script: "Hello",
        reference: wav,
        transcript: null,
        signal: signal(),
        maxBytes: HOSTED_SPEECH_LIMITS.outputBytes,
        operations: [],
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(HostedSpeechError);
      if (!(failure instanceof HostedSpeechError)) throw new Error("Missing hosted speech failure");
      expect(failure.providerStatus).toBe(status);
      expect(failure.providerDetail).toContain("PROVIDER_DETAIL_CANARY");
      expect(failure.providerDetail).not.toContain(apiKey);
      fetchSpy?.mockRestore();
    }
  });

  it("reports a spending-limit refusal as quota with its limit source, apart from a bare 403", async () => {
    const limited = Response.json(
      { error: { code: 402, message: "Key limit exceeded", metadata: { limit_source: "openrouter_key_limit" } } },
      { status: 402 },
    );
    for (const [response, kind, limitSource] of [
      [limited, "quota", "openrouter_key_limit"],
      [new Response(null, { status: 403 }), "authentication", undefined],
    ] as const) {
      stubFetch(async () => response);
      const failure = await synthesizeOpenRouterSpeech({
        shape: "clone",
        model: "fish-audio/s2.1-pro",
        apiKey: "synthetic",
        script: "Hello",
        reference: wav,
        transcript: null,
        signal: signal(),
        maxBytes: HOSTED_SPEECH_LIMITS.outputBytes,
        operations: [],
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(HostedSpeechError);
      expect(failure).toMatchObject({ kind });
      expect(findOpenRouterLimitError(failure)?.limitSource).toBe(limitSource);
      fetchSpy?.mockRestore();
    }
  });
});
