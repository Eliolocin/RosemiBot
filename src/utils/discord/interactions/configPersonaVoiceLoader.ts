import type { CustomEndpointRow, SpeechModelRow } from "@/types/db/schema";
import { resolveVoiceSourceCandidates } from "@/utils/speech/voiceSourceResolution";
import type { CustomEndpointApiStyle, TomoriState, VoiceSampleRow } from "@/types/db/schema";
import {
  loadActiveEndpoint,
  loadHostedSpeechSelection,
  loadVoiceSamples,
} from "@/utils/db/repositories/SpeechRepository";
import { log } from "@/utils/misc/logger";

export interface ConfigPersonaVoiceCapabilityView {
  apiStyle: CustomEndpointApiStyle | null;
  assignable: boolean;
  supportsVoiceDesign: boolean;
}

/** The render-facing sample projection deliberately excludes server-local storage details. */
type ConfigPersonaVoiceSampleView = Pick<VoiceSampleRow, "sample_id" | "name" | "ref_text" | "duration_ms">;

export interface ConfigPersonaVoiceView {
  capability: ConfigPersonaVoiceCapabilityView;
  samples: ConfigPersonaVoiceSampleView[];
  effectiveSource?: "design" | "clone" | null;
  effectiveTarget?: string | null;
  hasTargets?: boolean;
  preferredUnavailableReason?: "target" | "input";
}

export interface ConfigPersonaVoiceResolverDependencies {
  loadActiveEndpoint: (
    serverId: number,
    capability: "design" | "clone",
  ) => Promise<CustomEndpointRow | SpeechModelRow | null>;
}

export interface ConfigPersonaVoiceLoaderDependencies extends ConfigPersonaVoiceResolverDependencies {
  loadVoiceSamples: (serverId: number) => Promise<VoiceSampleRow[]>;
}

const defaultResolverDependencies: ConfigPersonaVoiceResolverDependencies = {
  loadActiveEndpoint: async (serverId, capability) =>
    (await loadHostedSpeechSelection(serverId, capability))?.model ?? (await loadActiveEndpoint(serverId, capability)),
};

const defaultLoaderDependencies: ConfigPersonaVoiceLoaderDependencies = {
  ...defaultResolverDependencies,
  loadVoiceSamples,
};

function unavailableCapability(): ConfigPersonaVoiceCapabilityView {
  return {
    apiStyle: null,
    assignable: false,
    supportsVoiceDesign: true,
  };
}

/**
 * Resolves the speech capability needed by Persona > Voice without loading endpoint credentials.
 */
export async function resolveActiveSpeechCapability(
  serverId: number,
  deps: ConfigPersonaVoiceResolverDependencies = defaultResolverDependencies,
): Promise<ConfigPersonaVoiceCapabilityView> {
  let endpoint: CustomEndpointRow | SpeechModelRow | null;
  try {
    endpoint = await deps.loadActiveEndpoint(serverId, "clone");
  } catch {
    log.warn(`[PersonaVoice] Failed to resolve speech capability for server ${serverId}`);
    return unavailableCapability();
  }

  if (endpoint) {
    const apiStyle = "api_style" in endpoint ? endpoint.api_style : "tts-clone";
    return {
      apiStyle,
      assignable: true,
      supportsVoiceDesign: true,
    };
  }

  return unavailableCapability();
}

function projectVoiceSample(sample: VoiceSampleRow): ConfigPersonaVoiceSampleView {
  return {
    sample_id: sample.sample_id,
    name: sample.name,
    ref_text: sample.ref_text,
    duration_ms: sample.duration_ms,
  };
}

export async function loadConfigPersonaVoiceView(
  state: TomoriState,
  deps: ConfigPersonaVoiceLoaderDependencies = defaultLoaderDependencies,
): Promise<ConfigPersonaVoiceView> {
  const capability = await resolveActiveSpeechCapability(state.server_id, deps);
  const [design, clone] = await Promise.all([
    deps.loadActiveEndpoint(state.server_id, "design"),
    deps.loadActiveEndpoint(state.server_id, "clone"),
  ]);
  const source = resolveVoiceSourceCandidates({
    targets: { design, clone },
    persona: state,
  })[0];
  const effectiveSource = source ? (source.shape === "design" ? "design" : "clone") : null;
  const effectiveTarget = !effectiveSource
    ? null
    : effectiveSource === "design"
      ? design && "speech_model_id" in design
        ? design.codename
        : design?.label
      : ((clone && "speech_model_id" in clone ? clone.codename : clone?.label) ??
        (source?.id === "elevenlabs" ? "ElevenLabs" : null));
  const priority = state.voice_source_priority ?? "design";
  const preferredTarget = priority === "design" ? design : clone;
  const hasTargets = Boolean(design || clone);
  const preferredUnavailableReason = preferredTarget ? ("input" as const) : ("target" as const);
  if (capability.apiStyle === "elevenlabs") {
    return { capability, samples: [], effectiveSource, effectiveTarget, hasTargets, preferredUnavailableReason };
  }

  try {
    const samples = await deps.loadVoiceSamples(state.server_id);
    return {
      capability,
      samples: samples.map(projectVoiceSample),
      effectiveSource,
      effectiveTarget,
      hasTargets,
      preferredUnavailableReason,
    };
  } catch {
    log.warn(`[PersonaVoice] Failed to load voice samples for server ${state.server_id}`);
    return { capability, samples: [], effectiveSource, effectiveTarget, hasTargets, preferredUnavailableReason };
  }
}
