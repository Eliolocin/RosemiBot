import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";
import { redactToolParametersForStorage } from "@/utils/tools/toolParameterRedaction";
import * as realCrypto from "@/utils/security/crypto";
import { createPersona } from "../../helpers/fixtures";
/**
 * The tool's source-selection ladder.
 *
 * This is the layer that had no test across two rounds of review, and both regressions lived here
 * rather than in the dispatcher below it. The ladder answers "which voice does this persona use,
 * and is it usable against this endpoint", and its two failure modes so far were:
 *
 *   - a design prompt unconditionally outranking a perfectly good clone sample, and
 *   - a shape capability asked of the fallback *list* instead of its members, which made the list
 *     unusable on exactly the servers where ElevenLabs is the only voice (an ElevenLabs endpoint,
 *     or no endpoint at all).
 *
 * Every collaborator below is stubbed, including delivery, so that `execute()` runs all the way to
 * a success result: a stub that fails would replace the tool's own refusal message with its own and
 * silently make every refusal assertion vacuous, which is the trap this file walked into once.
 */
import { beforeAll, describe, expect, it, mock } from "bun:test";
import { speechModelSchema, type CustomEndpointRow } from "@/types/db/schema";
import type { ToolContext, ToolAssemblyState } from "@/types/tool/interfaces";
import type { ResolvedVoiceSource } from "@/utils/speech/voiceMessageSynthesis";
import * as realSpeechEndpointResolver from "@/utils/provider/speechEndpointResolver";
import * as realVoiceMessageSynthesis from "@/utils/speech/voiceMessageSynthesis";
import * as realVoiceMessageDelivery from "@/utils/discord/webhook/voiceMessageDelivery";
import * as realVoiceMessageMetadata from "@/utils/audio/voiceMessageMetadata";
import { createScopedModuleMocker } from "../../helpers/mockSurface";
import { GenerateVoiceMessageTool } from "@/tools/functionCalls/generateVoiceMessageTool";

beforeAll(initializeLocalizer);

type VoiceMode = "clone" | "voice-design" | "auto";

let activeEndpoint: CustomEndpointRow | null = null;
let hostedTargets: Awaited<ReturnType<typeof realSpeechEndpointResolver.resolveSpeechTargets>> | null = null;
const resolvedOwners: Array<number | undefined> = [];
const synthesisRequests: realVoiceMessageSynthesis.VoiceMessageSynthesisRequest[] = [];
let synthesisResultOverride: Partial<realVoiceMessageSynthesis.VoiceMessageSynthesisResult> = {};
function hostedTarget(mode: "design" | "clone"): realSpeechEndpointResolver.SpeechTargetResult {
  return {
    kind: "hosted-model",
    endpoint: null,
    owner: { kind: mode === "design" ? "personal" : "server", ownerId: 1 },
    credentialId: 12,
    credentialRevision: 1,
    apiKey: "synthetic-key",
    model: speechModelSchema.parse({
      speech_model_id: 1,
      voice_mode: mode,
      provider: mode === "design" ? "google" : "openrouter",
      codename: mode === "design" ? "gemini-3.8-flash-tts" : "fish-audio/s2.1-pro",
    }),
  };
}
/** Sources the tool handed to the dispatcher, most recent last. */
const dispatchedSources: ResolvedVoiceSource[] = [];
const dispatchedSignals: Array<AbortSignal | undefined> = [];
let deliveryCount = 0;

const endpointResolverMock = mock(async () =>
  activeEndpoint ? { endpoint: activeEndpoint, apiKey: "endpoint-key" } : null,
);

const synthesizeMock = mock(async (request: realVoiceMessageSynthesis.VoiceMessageSynthesisRequest) => {
  synthesisRequests.push(request);
  dispatchedSources.push(request.source);
  dispatchedSignals.push(request.abortSignal);
  return {
    success: true,
    backendKey: "tts-clone" as const,
    audioBuffer: Buffer.from("audio"),
    contentType: "audio/wav",
    extension: "wav",
    cleanedCaptionText: "",
    ...synthesisResultOverride,
  };
});

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/security/crypto": realCrypto,
  "@/utils/provider/speechEndpointResolver": realSpeechEndpointResolver,
  "@/utils/speech/voiceMessageSynthesis": realVoiceMessageSynthesis,
  "@/utils/discord/webhook/voiceMessageDelivery": realVoiceMessageDelivery,
  "@/utils/audio/voiceMessageMetadata": realVoiceMessageMetadata,
});

scopedMock.module("@/utils/provider/speechEndpointResolver", () => ({
  ...realSpeechEndpointResolver,
  resolveSpeechTargets: async (_serverId: number, userId?: number) => {
    resolvedOwners.push(userId);
    if (hostedTargets) return hostedTargets;
    const target = await endpointResolverMock();
    return { design: target, clone: target };
  },
}));

scopedMock.module("@/utils/security/crypto", () => ({ ...realCrypto, getOptApiKey: async () => "legacy-key" }));

scopedMock.module("@/utils/speech/voiceMessageSynthesis", () => ({
  ...realVoiceMessageSynthesis,
  synthesizeVoiceMessage: synthesizeMock,
}));

// A null waveform metadata result is the tool's own supported path: it falls back to a plain
// attachment. Stubbing it at null keeps delivery out of the picture without pretending the tool
// took a branch it did not.
scopedMock.module("@/utils/audio/voiceMessageMetadata", () => ({
  ...realVoiceMessageMetadata,
  generateVoiceMessageMetadata: async () => null,
}));

scopedMock.module("@/utils/discord/webhook/voiceMessageDelivery", () => ({
  ...realVoiceMessageDelivery,
  deliverVoiceMessage: async () => {
    deliveryCount += 1;
    return "message-id";
  },
  postVoiceTranscriptCaption: async () => undefined,
}));

function makeEndpoint(voiceMode: VoiceMode): CustomEndpointRow {
  return {
    label: "Speech",
    api_style: "tts-clone",
    endpoint_url: "https://speech.example.test",
    extra_config: { voice_mode: voiceMode },
  } as unknown as CustomEndpointRow;
}

const ELEVENLABS_ENDPOINT = {
  label: "ElevenLabs",
  api_style: "elevenlabs",
  endpoint_url: "https://api.elevenlabs.io",
  extra_config: {},
} as unknown as CustomEndpointRow;

interface PersonaVoiceFields {
  speech_voice_sample_id?: number | null;
  speech_voice_design_prompt?: string | null;
  speech_voice_id?: string | null;
  speech_voice_name?: string | null;
  voice_source_priority?: "design" | "clone";
}

function makeContext(fields: PersonaVoiceFields): ToolContext {
  return {
    channel: {},
    tomoriState: createPersona(fields),
  } as unknown as ToolContext;
}

/** Runs execute() and reports either the dispatched source or the refusal message. */
async function runTool(
  fields: PersonaVoiceFields,
  endpoint: CustomEndpointRow | null,
): Promise<{ source: ResolvedVoiceSource | null; error: string | null }> {
  activeEndpoint = endpoint;
  hostedTargets = null;
  dispatchedSources.length = 0;

  const result = await new GenerateVoiceMessageTool().execute(
    { title: "test", script: "Good morning" },
    makeContext(fields),
  );

  return {
    source: dispatchedSources[0] ?? null,
    error: result.success ? null : (result.error ?? null),
  };
}

const SAMPLE = { speech_voice_sample_id: 12 };
const DESIGN_PROMPT = { speech_voice_design_prompt: "Warm and unhurried" };
const ELEVENLABS_VOICE = { speech_voice_id: "voice-abc" };

describe("GenerateVoiceMessageTool source ladder", () => {
  it("returns the final target label instead of empty model metadata after fallback", async () => {
    activeEndpoint = makeEndpoint("voice-design");
    hostedTargets = null;
    synthesisResultOverride = {
      targetLabel: "Fallback speech",
      usedServerFallback: true,
      attempts: [
        {
          provider: "tts-clone",
          model: "",
          owner: { kind: "server", ownerId: 1 },
          source: "design",
          synthesisSuccess: true,
          operations: [],
        },
      ],
    };
    try {
      const result = await new GenerateVoiceMessageTool().execute(
        { title: "invitation", script: "Hello" },
        makeContext(DESIGN_PROMPT),
      );
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ target: synthesisResultOverride.targetLabel, usedServerFallback: true });
    } finally {
      synthesisResultOverride = {};
    }
  });

  it("keeps speech input values out of execution history and thought-log details", () => {
    const script = "Synthetic private script";
    const direction = "Synthetic private direction";
    const redacted = redactToolParametersForStorage("generate_voice_message", {
      title: "Private title",
      script,
      voice_instructions: direction,
    });
    expect(redacted).toEqual({ script_characters: script.length, instruction_characters: direction.length });
    expect(JSON.stringify(redacted)).not.toContain(script);
    expect(JSON.stringify(redacted)).not.toContain(direction);
  });
  it("assembles and executes hosted voices for the triggering owner and rejects stale selections", async () => {
    const tool = new GenerateVoiceMessageTool();
    for (const mode of ["design", "clone"] as const) {
      const persona = createPersona(mode === "design" ? DESIGN_PROMPT : SAMPLE);
      const speechToolState: NonNullable<ToolAssemblyState["speechToolState"]> = { userId: 1 };
      const state: ToolAssemblyState = {
        server_id: "1",
        speechToolState,
        activePersonaHasElevenlabsVoice: true,
        activePersonaVoiceDesignPrompt: persona.speech_voice_design_prompt,
        activePersonaVoiceSampleId: persona.speech_voice_sample_id,
        activePersonaVoiceId: null,
        activePersonaVoiceSourcePriority: "design",
        llm: persona.llm,
        config: persona.config,
      };
      hostedTargets = { design: hostedTarget("design"), clone: hostedTarget("clone") };
      resolvedOwners.length = 0;
      synthesisRequests.length = 0;
      expect(await tool.assembleForContext({ provider: "google", state })).not.toBeNull();
      const context = {
        ...makeContext(mode === "design" ? DESIGN_PROMPT : SAMPLE),
        internalUserId: 1,
        streamContext: { speechToolState },
        locale: "en-US",
      } as ToolContext;
      const result = await tool.execute({ title: "test", script: "Hello" }, context);
      expect(result.success).toBe(true);
      expect(synthesisRequests[0]?.target).toEqual(hostedTargets[mode] ?? undefined);
      expect(synthesisRequests[0]?.routing?.sourceIsExplicit).toBe(false);
      expect(resolvedOwners).toEqual([1, 1]);
      const target = hostedTargets[mode];
      if (target?.kind !== "hosted-model") throw new Error("Missing hosted fixture");
      for (const changed of [
        { ...target, credentialRevision: 2 },
        { ...target, apiKey: "synthetic-rotated-member-key" },
      ]) {
        hostedTargets[mode] = changed;
        synthesisRequests.length = 0;
        const stale = await tool.execute({ title: "test", script: "Hello" }, context);
        expect(stale.success).toBe(false);
        expect(stale.error).toBe(localizedCopy("en-US", "tools.generate_voice_message.stale"));
        expect(synthesisRequests).toHaveLength(0);
      }
    }
    hostedTargets = null;
  });
  it("uses an ElevenLabs voice when the persona has one and no endpoint is registered", async () => {
    // The legacy opt_api_keys deployment: no speech endpoint at all.
    const { source, error } = await runTool(ELEVENLABS_VOICE, null);

    expect(error).toBeNull();
    expect(source).toEqual({ kind: "elevenlabs", voiceId: "voice-abc" });
  });

  it("uses an ElevenLabs voice when the active endpoint is ElevenLabs", async () => {
    const { source, error } = await runTool(ELEVENLABS_VOICE, ELEVENLABS_ENDPOINT);

    expect(error).toBeNull();
    expect(source).toEqual({ kind: "elevenlabs", voiceId: "voice-abc" });
  });

  it("falls past a sample to the ElevenLabs voice on an ElevenLabs endpoint", async () => {
    // The union-guard regression: the sample is preferred and then discarded, and the voice id has
    // to remain reachable afterwards. A list-wide capability check stranded this persona.
    const { source, error } = await runTool({ ...SAMPLE, ...ELEVENLABS_VOICE }, ELEVENLABS_ENDPOINT);

    expect(error).toBeNull();
    expect(source).toEqual({ kind: "elevenlabs", voiceId: "voice-abc" });
  });

  it("prefers the sample over the ElevenLabs voice on a clone endpoint", async () => {
    const { source, error } = await runTool({ ...SAMPLE, ...ELEVENLABS_VOICE }, makeEndpoint("clone"));

    expect(error).toBeNull();
    expect(source).toEqual({ kind: "clone", voiceSampleId: 12 });
  });

  it("uses Clone priority even when both sources exist", async () => {
    // A design prompt is present too, but the sentinel is what selects the design branch. Without
    // it the sample must stay in play.
    const { source, error } = await runTool(
      { ...SAMPLE, ...DESIGN_PROMPT, speech_voice_name: "VoiceDesign", voice_source_priority: "clone" },
      makeEndpoint("auto"),
    );

    expect(error).toBeNull();
    expect(source).toEqual({ kind: "clone", voiceSampleId: 12 });
  });

  it("uses Design priority independently of the voice name", async () => {
    const { source, error } = await runTool(
      { ...SAMPLE, ...DESIGN_PROMPT, speech_voice_name: "VoiceDesign" },
      makeEndpoint("auto"),
    );

    expect(error).toBeNull();
    expect(source).toEqual({ kind: "design", designPrompt: "Warm and unhurried", personaId: 1 });
  });

  it("uses the design prompt on a dedicated voice-design endpoint", async () => {
    const { source, error } = await runTool(DESIGN_PROMPT, makeEndpoint("voice-design"));

    expect(error).toBeNull();
    expect(source).toEqual({ kind: "design", designPrompt: "Warm and unhurried", personaId: 1 });
  });

  it("falls past a design prompt to the sample on a clone endpoint", async () => {
    const { source, error } = await runTool({ ...SAMPLE, ...DESIGN_PROMPT }, makeEndpoint("clone"));

    expect(error).toBeNull();
    expect(source).toEqual({ kind: "clone", voiceSampleId: 12 });
  });

  it("falls past a design prompt to the ElevenLabs voice on an ElevenLabs endpoint", async () => {
    const { source, error } = await runTool({ ...DESIGN_PROMPT, ...ELEVENLABS_VOICE }, ELEVENLABS_ENDPOINT);

    expect(error).toBeNull();
    expect(source).toEqual({ kind: "elevenlabs", voiceId: "voice-abc" });
  });

  it("uses the Design default when both sources exist", async () => {
    const { source, error } = await runTool(
      { ...SAMPLE, ...DESIGN_PROMPT, speech_voice_name: "Millie" },
      makeEndpoint("auto"),
    );

    expect(error).toBeNull();
    expect(source).toEqual({ kind: "design", designPrompt: "Warm and unhurried", personaId: 1 });
  });
});

describe("GenerateVoiceMessageTool refusals", () => {
  it("does not synthesize when no saved source matches its selected target", async () => {
    for (const [fields, endpoint] of [
      [{}, makeEndpoint("clone")],
      [DESIGN_PROMPT, makeEndpoint("clone")],
      [SAMPLE, makeEndpoint("voice-design")],
      [SAMPLE, ELEVENLABS_ENDPOINT],
      [SAMPLE, null],
    ] as const) {
      const { source, error } = await runTool(fields, endpoint);
      expect(source).toBeNull();
      expect(Boolean(error)).toBe(true);
    }
  });
  it("never retries the other slot after synthesis failure", async () => {
    synthesizeMock.mockImplementationOnce(async (request) => {
      dispatchedSources.push(request.source);
      return {
        success: false,
        backendKey: "tts-clone" as const,
        audioBuffer: Buffer.alloc(0),
        contentType: "audio/wav",
        extension: "wav",
        cleanedCaptionText: "",
      };
    });
    const { error } = await runTool({ ...SAMPLE, ...DESIGN_PROMPT }, makeEndpoint("auto"));
    expect(Boolean(error)).toBe(true);
    expect(dispatchedSources).toEqual([
      { kind: "design", designPrompt: DESIGN_PROMPT.speech_voice_design_prompt, personaId: 1 },
    ]);
  });
});

describe("GenerateVoiceMessageTool /kill cancellation", () => {
  it("forwards the turn abort signal and never delivers audio once the turn is killed", async () => {
    activeEndpoint = makeEndpoint("clone");
    dispatchedSignals.length = 0;
    deliveryCount = 0;
    const controller = new AbortController();
    // The kill lands while synthesis is in flight, which is the window where the backend has
    // already produced audio that nothing will await.
    synthesizeMock.mockImplementationOnce(async (request) => {
      dispatchedSignals.push(request.abortSignal);
      controller.abort();
      return {
        success: true,
        backendKey: "tts-clone" as const,
        audioBuffer: Buffer.from("audio"),
        contentType: "audio/wav",
        extension: "wav",
        cleanedCaptionText: "",
      };
    });

    const result = await new GenerateVoiceMessageTool().execute({ title: "test", script: "Good morning" }, {
      ...makeContext(SAMPLE),
      abortSignal: controller.signal,
    } as ToolContext);

    expect(dispatchedSignals[0]).toBe(controller.signal);
    expect(result.success).toBe(false);
    expect(result.error).toContain("cancelled");
    expect(deliveryCount).toBe(0);
  });
});
