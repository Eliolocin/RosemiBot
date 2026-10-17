import { createPersona } from "../../helpers/fixtures";
import { describe, expect, it } from "bun:test";
import {
  speechModelSchema,
  type CustomEndpointApiStyle,
  type CustomEndpointRow,
  type TomoriState,
  type VoiceSampleRow,
} from "@/types/db/schema";
import {
  loadConfigPersonaVoiceView,
  resolveActiveSpeechCapability,
  type ConfigPersonaVoiceLoaderDependencies,
  type ConfigPersonaVoiceResolverDependencies,
} from "@/utils/discord/interactions/configPersonaVoiceLoader";

function endpoint(apiStyle: CustomEndpointApiStyle, extraConfig: Record<string, unknown> = {}): CustomEndpointRow {
  return {
    connection_id: 73,
    server_id: 42,
    user_id: null,
    label: "private speech endpoint",
    capability: "speech",
    api_style: apiStyle,
    endpoint_url: "https://credentials.example.invalid/private",
    requires_auth: true,
    extra_config: extraConfig,
    custom_endpoint_id: 91,
    model_name: null,
    model_ref_id: null,
    num_ctx: null,
    has_tools: false,
    sees_images: false,
    sees_videos: false,
    supports_structoutput: false,
    strict_role_alternation: false,
    supports_prefix_completion: false,
    supports_assistant_prefill: false,
    verbatim_tool_calling: false,
    is_default: true,
  };
}

function resolverDependencies(activeEndpoint: CustomEndpointRow | null): ConfigPersonaVoiceResolverDependencies {
  return {
    loadActiveEndpoint: async () => activeEndpoint,
  };
}

function state(): TomoriState {
  return createPersona({ server_id: 42 });
}

describe("Persona > Voice speech capability loading", () => {
  it("keeps a clone endpoint assignable and allows Design authoring independently of instruct support", async () => {
    const supported = await resolveActiveSpeechCapability(
      42,
      resolverDependencies(endpoint("tts-clone", { supports_instruct: true })),
    );
    const unsupported = await resolveActiveSpeechCapability(
      42,
      resolverDependencies(endpoint("tts-clone", { supports_instruct: false })),
    );

    expect(supported).toEqual({ apiStyle: "tts-clone", assignable: true, supportsVoiceDesign: true });
    expect(unsupported).toEqual({ apiStyle: "tts-clone", assignable: true, supportsVoiceDesign: true });
  });

  it("reports an ElevenLabs endpoint as assignable without loading credentials", async () => {
    const result = await resolveActiveSpeechCapability(42, resolverDependencies(endpoint("elevenlabs")));

    expect(result).toEqual({ apiStyle: "elevenlabs", assignable: true, supportsVoiceDesign: true });
    expect(result).not.toHaveProperty("endpoint_url");
    expect(result).not.toHaveProperty("connection_id");
    expect(result).not.toHaveProperty("apiKey");
    expect(result).not.toHaveProperty("api_key");
    expect(result).not.toHaveProperty("encryptedApiKey");
    expect(result).not.toHaveProperty("endpoint");
    expect(JSON.stringify(result)).not.toContain("credentials.example.invalid");
  });

  it("reports missing endpoint and key as unavailable", async () => {
    const result = await resolveActiveSpeechCapability(42, resolverDependencies(null));

    expect(result).toEqual({ apiStyle: null, assignable: false, supportsVoiceDesign: true });
  });

  it("treats a rejecting endpoint dependency as unavailable without falling back", async () => {
    const result = await resolveActiveSpeechCapability(42, {
      loadActiveEndpoint: async () => {
        throw new Error("endpoint lookup failed with credential-shaped details");
      },
    });

    expect(result).toEqual({ apiStyle: null, assignable: false, supportsVoiceDesign: true });
  });

  it("keeps the complete reference library available with hosted Design, hosted Clone, or no Clone target", async () => {
    const design = speechModelSchema.parse({
      speech_model_id: 1,
      provider: "google",
      codename: "gemini-3.8-flash-tts",
      voice_mode: "design",
    });
    const clone = speechModelSchema.parse({
      speech_model_id: 2,
      provider: "openrouter",
      codename: "fish-audio/s2.1-pro",
      voice_mode: "clone",
    });
    const samples: VoiceSampleRow[] = [
      {
        sample_id: 5,
        server_id: 42,
        name: "Synthetic sample",
        file_path: "private.wav",
        ref_text: null,
        duration_ms: 200,
      },
    ];
    for (const [designTarget, cloneTarget] of [
      [null, null],
      [design, null],
      [design, clone],
    ] as const) {
      const view = await loadConfigPersonaVoiceView(
        createPersona({
          server_id: 42,
          speech_voice_design_prompt: "Warm narration",
          speech_voice_sample_id: 5,
          voice_source_priority: "clone",
        }),
        {
          loadActiveEndpoint: async (_serverId, mode) => (mode === "design" ? designTarget : cloneTarget),
          loadVoiceSamples: async () => samples,
        },
      );
      expect(view.samples.map((sample) => sample.sample_id)).toEqual([5]);
      expect(view.capability.apiStyle).not.toBe("elevenlabs");
      expect(view.effectiveSource).toBe(cloneTarget ? "clone" : designTarget ? "design" : null);
      expect(view.hasTargets).toBe(Boolean(designTarget || cloneTarget));
    }
  });

  it("loads and projects local samples only for a clone capability", async () => {
    const sample: VoiceSampleRow = {
      sample_id: 5,
      server_id: 42,
      name: "demo",
      file_path: "data/voice-samples/secret.wav",
      ref_text: "Hello",
      duration_ms: 1200,
      created_at: new Date(0),
    };
    let sampleLoadCalls = 0;
    const dependencies: ConfigPersonaVoiceLoaderDependencies = {
      ...resolverDependencies(endpoint("tts-clone", { supports_instruct: false })),
      loadVoiceSamples: async () => {
        sampleLoadCalls += 1;
        return [sample];
      },
    };

    const cloneView = await loadConfigPersonaVoiceView(state(), dependencies);
    expect(cloneView).toMatchObject({
      effectiveSource: null,
      effectiveTarget: null,
      capability: { apiStyle: "tts-clone", assignable: true, supportsVoiceDesign: true },
      samples: [{ sample_id: 5, name: "demo", ref_text: "Hello", duration_ms: 1200 }],
    });
    expect(cloneView).not.toHaveProperty("endpoint_url");
    expect(JSON.stringify(cloneView)).not.toContain("secret.wav");
    expect(sampleLoadCalls).toBe(1);

    const elevenLabsView = await loadConfigPersonaVoiceView(state(), {
      ...resolverDependencies(endpoint("elevenlabs")),
      loadVoiceSamples: async () => {
        sampleLoadCalls += 1;
        return [sample];
      },
    });
    expect(elevenLabsView.samples).toEqual([]);
    expect(sampleLoadCalls).toBe(1);
  });
});
