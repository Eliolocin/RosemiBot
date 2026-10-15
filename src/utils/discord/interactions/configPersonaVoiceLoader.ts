import { resolveVoiceSourceCandidates } from "@/utils/speech/voiceSourceResolution";
import type { CustomEndpointApiStyle, CustomEndpointRow, TomoriState, VoiceSampleRow } from "@/types/db/schema";
import { loadActiveEndpoint, loadVoiceSamples } from "@/utils/db/repositories/SpeechRepository";
import { ELEVENLABS_SERVICE_NAME } from "@/utils/audio/elevenLabsAccount";
import { hasOptApiKey } from "@/utils/security/crypto";
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
}

export interface ConfigPersonaVoiceResolverDependencies {
  loadActiveEndpoint: (serverId: number, capability: "design" | "clone") => Promise<CustomEndpointRow | null>;
  hasOptApiKey: (serverId: number, serviceName: string) => Promise<boolean>;
}

export interface ConfigPersonaVoiceLoaderDependencies extends ConfigPersonaVoiceResolverDependencies {
  loadVoiceSamples: (serverId: number) => Promise<VoiceSampleRow[]>;
}

const defaultResolverDependencies: ConfigPersonaVoiceResolverDependencies = {
  loadActiveEndpoint: (serverId, capability) => loadActiveEndpoint(serverId, capability),
  hasOptApiKey,
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
  let endpoint: CustomEndpointRow | null;
  try {
    endpoint = await deps.loadActiveEndpoint(serverId, "clone");
  } catch {
    log.warn(`[PersonaVoice] Failed to resolve speech capability for server ${serverId}`);
    return unavailableCapability();
  }

  if (endpoint) {
    const apiStyle = endpoint.api_style;
    return {
      apiStyle,
      assignable: true,
      supportsVoiceDesign: true,
    };
  }

  let hasLegacyElevenLabsKey: boolean;
  try {
    hasLegacyElevenLabsKey = await deps.hasOptApiKey(serverId, ELEVENLABS_SERVICE_NAME);
  } catch {
    log.warn(`[PersonaVoice] Failed to check legacy speech capability for server ${serverId}`);
    return unavailableCapability();
  }

  if (!hasLegacyElevenLabsKey) {
    return unavailableCapability();
  }

  return {
    apiStyle: "elevenlabs",
    assignable: true,
    supportsVoiceDesign: true,
  };
}

function projectVoiceSample(sample: VoiceSampleRow): ConfigPersonaVoiceSampleView {
  return {
    sample_id: sample.sample_id,
    name: sample.name,
    ref_text: sample.ref_text,
    duration_ms: sample.duration_ms,
  };
}

/** Loads the future Persona > Voice view only when that page asks for it. */
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
    legacyElevenLabsAvailable: !clone && capability.apiStyle === "elevenlabs",
  })[0];
  const effectiveSource = source ? (source.shape === "design" ? "design" : "clone") : null;
  const effectiveTarget = !effectiveSource
    ? null
    : effectiveSource === "design"
      ? design?.label
      : (clone?.label ?? (source?.id === "elevenlabs" ? "ElevenLabs" : null));
  if (capability.apiStyle === "elevenlabs") {
    return { capability, samples: [], effectiveSource, effectiveTarget };
  }

  try {
    const samples = await deps.loadVoiceSamples(state.server_id);
    return {
      capability,
      samples: samples.map(projectVoiceSample),
      effectiveSource,
      effectiveTarget,
    };
  } catch {
    log.warn(`[PersonaVoice] Failed to load voice samples for server ${state.server_id}`);
    return { capability, samples: [], effectiveSource, effectiveTarget };
  }
}
