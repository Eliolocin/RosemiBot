/**
 * The voice-source table is what decides which voice a `/generate voice-message` invocation can
 * use, and in what order the modal pre-selects them. Two properties matter enough to pin here:
 * an option that the active endpoint cannot accept must never be offered, and the user's own
 * input must outrank stored persona configuration.
 */
import { describe, expect, it } from "bun:test";
import { speechModelSchema, type CustomEndpointRow } from "@/types/db/schema";
import { createPersona } from "../../helpers/fixtures";
import {
  formatVoiceSourceOptionDescription,
  resolveVoiceSourceCandidates,
  resolveVoiceSourceCapabilities,
  selectDefaultVoiceSource,
  VOICE_SOURCE_OPTION_TEXT_LIMIT,
  type VoiceSourceCandidate,
  type VoiceSourcePersona,
} from "@/utils/speech/voiceSourceResolution";

type VoiceMode = "clone" | "voice-design" | "auto";

function makeEndpoint(
  apiStyle: CustomEndpointRow["api_style"],
  voiceMode?: VoiceMode,
  supportsInstruct = false,
): CustomEndpointRow {
  return {
    label: "Test Speech",
    api_style: apiStyle,
    endpoint_url: "https://speech.example.test",
    extra_config: { ...(voiceMode ? { voice_mode: voiceMode } : {}), supports_instruct: supportsInstruct },
  } as unknown as CustomEndpointRow;
}

const PERSONA_WITH_BOTH: VoiceSourcePersona = {
  speech_voice_sample_id: 12,
  speech_voice_design_prompt: "Warm, wholesome and very dark-toned",
};

const PERSONA_WITH_SAMPLE: VoiceSourcePersona = { speech_voice_sample_id: 12 };

const PERSONA_WITH_DESIGN: VoiceSourcePersona = {
  speech_voice_design_prompt: "Warm, wholesome and very dark-toned",
};

const PERSONA_WITH_ELEVENLABS_VOICE: VoiceSourcePersona = { speech_voice_id: "voice-abc" };

function ids(candidates: readonly VoiceSourceCandidate[]): string[] {
  return candidates.map((candidate) => candidate.id);
}

describe("resolveVoiceSourceCapabilities", () => {
  it("treats a missing endpoint as accepting neither shape", () => {
    expect(resolveVoiceSourceCapabilities(null)).toEqual({
      acceptsCloneShape: false,
      acceptsDesignShape: false,
      cloneInstructionsAvailable: false,
    });
  });

  it("defaults an unset voice_mode to clone", () => {
    expect(resolveVoiceSourceCapabilities(makeEndpoint("tts-clone"))).toEqual({
      acceptsCloneShape: true,
      acceptsDesignShape: false,
      cloneInstructionsAvailable: false,
    });
  });

  it("gives auto both shapes", () => {
    expect(resolveVoiceSourceCapabilities(makeEndpoint("tts-clone", "auto", true))).toEqual({
      acceptsCloneShape: true,
      acceptsDesignShape: true,
      cloneInstructionsAvailable: true,
    });
  });

  it("only enables clone delivery direction when the endpoint opts into it", () => {
    expect(resolveVoiceSourceCapabilities(makeEndpoint("tts-clone", "clone", true)).cloneInstructionsAvailable).toBe(
      true,
    );
    expect(resolveVoiceSourceCapabilities(makeEndpoint("tts-clone", "clone", false)).cloneInstructionsAvailable).toBe(
      false,
    );
  });

  it("gives voice-design endpoints only the design shape", () => {
    expect(resolveVoiceSourceCapabilities(makeEndpoint("tts-clone", "voice-design"))).toEqual({
      acceptsCloneShape: false,
      acceptsDesignShape: true,
      cloneInstructionsAvailable: false,
    });
  });

  it("gives ElevenLabs neither shape", () => {
    expect(resolveVoiceSourceCapabilities(makeEndpoint("elevenlabs"))).toEqual({
      acceptsCloneShape: false,
      acceptsDesignShape: false,
      cloneInstructionsAvailable: false,
    });
  });
});

describe("resolveVoiceSourceCandidates", () => {
  it("resolves saved priority across hosted pairs and a shared Auto target as inputs or selections disappear", () => {
    const hosted = {
      design: speechModelSchema.parse({
        speech_model_id: 1,
        provider: "google",
        codename: "gemini-3.8-flash-tts",
        voice_mode: "design",
      }),
      clone: speechModelSchema.parse({
        speech_model_id: 2,
        provider: "openrouter",
        codename: "fish-audio/s2.1-pro",
        voice_mode: "clone",
      }),
    };
    const auto = makeEndpoint("tts-clone", "auto");
    for (const targets of [hosted, { design: auto, clone: auto }]) {
      for (const priority of ["design", "clone"] as const) {
        const persona = createPersona({
          speech_voice_design_prompt: "Warm narration",
          speech_voice_sample_id: 12,
          speech_voice_id: "unused-preset-id",
          voice_source_priority: priority,
        });
        expect(resolveVoiceSourceCandidates({ targets, persona }).map(({ shape }) => shape)).toEqual(
          priority === "design" ? ["design", "clone"] : ["clone", "design"],
        );
        const secondary = priority === "design" ? "clone" : "design";
        expect(resolveVoiceSourceCandidates({ targets: { ...targets, [priority]: null }, persona })[0]?.shape).toBe(
          secondary,
        );
        const missingPreferred = {
          ...persona,
          ...(priority === "design" ? { speech_voice_design_prompt: "  " } : { speech_voice_sample_id: null }),
        };
        expect(resolveVoiceSourceCandidates({ targets, persona: missingPreferred })[0]?.shape).toBe(secondary);
        expect(
          resolveVoiceSourceCandidates({
            targets,
            persona: { ...missingPreferred, speech_voice_design_prompt: null, speech_voice_sample_id: null },
          }),
        ).toEqual([]);
      }
    }
  });

  it("offers both clone sources on a clone endpoint, upload first", () => {
    const candidates = resolveVoiceSourceCandidates({
      targets: { design: makeEndpoint("tts-clone", "clone"), clone: makeEndpoint("tts-clone", "clone") },
      persona: PERSONA_WITH_BOTH,
      personaSampleName: "millie.wav",
      uploadFilename: "mesu.wav",
    });

    expect(ids(candidates)).toEqual(["upload", "persona-sample"]);
    expect(candidates[0]?.displayText).toBe("mesu.wav");
    expect(candidates[1]?.sampleId).toBe(12);
  });

  it("offers both design sources on a voice-design endpoint, typed first", () => {
    const candidates = resolveVoiceSourceCandidates({
      targets: { design: makeEndpoint("tts-clone", "voice-design"), clone: makeEndpoint("tts-clone", "voice-design") },
      persona: PERSONA_WITH_BOTH,
      personaSampleName: "millie.wav",
      uploadFilename: "mesu.wav",
      typedDesignPrompt: "Very happy and kind",
    });

    expect(ids(candidates)).toEqual(["typed-design", "persona-design"]);
    expect(candidates[0]?.designPrompt).toBe("Very happy and kind");
  });

  it("offers all four sources on an auto endpoint, in pre-selection order", () => {
    const candidates = resolveVoiceSourceCandidates({
      targets: { design: makeEndpoint("tts-clone", "auto"), clone: makeEndpoint("tts-clone", "auto") },
      persona: PERSONA_WITH_BOTH,
      personaSampleName: "millie.wav",
      uploadFilename: "mesu.wav",
      typedDesignPrompt: "Very happy and kind",
    });

    expect(ids(candidates)).toEqual(["upload", "typed-design", "persona-design", "persona-sample"]);
  });

  it("offers only the single available source on an auto endpoint", () => {
    const candidates = resolveVoiceSourceCandidates({
      targets: { design: makeEndpoint("tts-clone", "auto"), clone: makeEndpoint("tts-clone", "auto") },
      persona: PERSONA_WITH_SAMPLE,
      personaSampleName: "millie.wav",
    });

    expect(ids(candidates)).toEqual(["persona-sample"]);
  });

  it("ignores both user-supplied options on ElevenLabs", () => {
    const candidates = resolveVoiceSourceCandidates({
      targets: { design: makeEndpoint("elevenlabs"), clone: makeEndpoint("elevenlabs") },
      persona: PERSONA_WITH_ELEVENLABS_VOICE,
      uploadFilename: "mesu.wav",
      typedDesignPrompt: "Very happy and kind",
    });

    expect(ids(candidates)).toEqual(["elevenlabs"]);
  });

  it("returns nothing when the persona has no voice and nothing was supplied", () => {
    expect(
      resolveVoiceSourceCandidates({
        targets: { design: makeEndpoint("tts-clone", "auto"), clone: makeEndpoint("tts-clone", "auto") },
        persona: {},
      }),
    ).toEqual([]);
  });

  it("returns nothing when there is no endpoint and the persona only has a sample", () => {
    expect(
      resolveVoiceSourceCandidates({
        targets: { design: null, clone: null },
        persona: PERSONA_WITH_SAMPLE,
        personaSampleName: "millie.wav",
      }),
    ).toEqual([]);
  });

  it("does not offer an upload on a voice-design-only endpoint", () => {
    const candidates = resolveVoiceSourceCandidates({
      targets: { design: makeEndpoint("tts-clone", "voice-design"), clone: makeEndpoint("tts-clone", "voice-design") },
      persona: PERSONA_WITH_DESIGN,
      uploadFilename: "mesu.wav",
    });

    expect(ids(candidates)).toEqual(["persona-design"]);
  });

  it("treats whitespace-only option and prompt values as absent", () => {
    expect(
      resolveVoiceSourceCandidates({
        targets: { design: makeEndpoint("tts-clone", "auto"), clone: makeEndpoint("tts-clone", "auto") },
        persona: PERSONA_WITH_DESIGN,
        uploadFilename: "   ",
        typedDesignPrompt: "  ",
      }),
    ).toEqual([
      {
        id: "persona-design",
        shape: "design",
        designPrompt: "Warm, wholesome and very dark-toned",
      },
    ]);
  });
});

describe("selectDefaultVoiceSource", () => {
  it("pre-selects the uploaded clip over every stored persona voice", () => {
    const candidates = resolveVoiceSourceCandidates({
      targets: { design: makeEndpoint("tts-clone", "auto"), clone: makeEndpoint("tts-clone", "auto") },
      persona: PERSONA_WITH_BOTH,
      personaSampleName: "millie.wav",
      uploadFilename: "mesu.wav",
      typedDesignPrompt: "Very happy and kind",
    });

    expect(selectDefaultVoiceSource(candidates)?.id).toBe("upload");
  });

  it("pre-selects the typed design prompt over the persona design prompt", () => {
    const candidates = resolveVoiceSourceCandidates({
      targets: { design: makeEndpoint("tts-clone", "auto"), clone: makeEndpoint("tts-clone", "auto") },
      persona: PERSONA_WITH_DESIGN,
      typedDesignPrompt: "Very happy and kind",
    });

    expect(selectDefaultVoiceSource(candidates)?.id).toBe("typed-design");
  });

  it("pre-selects Design by default when both stored sources are usable", () => {
    const candidates = resolveVoiceSourceCandidates({
      targets: { design: makeEndpoint("tts-clone", "auto"), clone: makeEndpoint("tts-clone", "auto") },
      persona: PERSONA_WITH_BOTH,
      personaSampleName: "millie.wav",
    });

    expect(selectDefaultVoiceSource(candidates)?.id).toBe("persona-design");
  });

  it("returns null for an empty candidate list", () => {
    expect(selectDefaultVoiceSource([])).toBeNull();
  });
});

describe("formatVoiceSourceOptionDescription", () => {
  it("prefixes the shape that the option changes the request to", () => {
    expect(formatVoiceSourceOptionDescription("Clone", "mesu.wav")).toBe("Clone | mesu.wav");
    expect(formatVoiceSourceOptionDescription("Design", "Very kind")).toBe("Design | Very kind");
  });

  it("keeps the prefix and stays within Discord's 100-character cap for a long prompt", () => {
    const longPrompt = "Warm, wholesome and very dark-toned, ".repeat(10);
    const formatted = formatVoiceSourceOptionDescription("Design", longPrompt);

    expect(formatted.length).toBeLessThanOrEqual(VOICE_SOURCE_OPTION_TEXT_LIMIT);
    expect(formatted.startsWith("Design | ")).toBe(true);
    // The budget is the limit minus the prefix, and the tail is what gets dropped.
    expect(formatted.startsWith(`Design | ${longPrompt.slice(0, 60)}`)).toBe(true);
    expect(formatted.endsWith("...")).toBe(true);
  });

  it("keeps the 9-character clone prefix budgeted against the same cap", () => {
    const longName = "a".repeat(200);
    const formatted = formatVoiceSourceOptionDescription("Clone", longName);

    expect(formatted.length).toBe(VOICE_SOURCE_OPTION_TEXT_LIMIT);
    expect(formatted.startsWith("Clone | ")).toBe(true);
  });
});
