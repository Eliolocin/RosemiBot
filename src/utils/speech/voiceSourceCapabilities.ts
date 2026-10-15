import type { CustomEndpointRow, SpeechModelRow } from "@/types/db/schema";

export type VoiceSourceTarget = Pick<CustomEndpointRow, "api_style" | "extra_config"> | SpeechModelRow;

export type VoiceSourceMode = "design" | "clone";

export function supportsSpeechMode(endpoint: VoiceSourceTarget, mode: VoiceSourceMode): boolean {
  const capabilities = resolveVoiceSourceCapabilities(endpoint);
  return mode === "design"
    ? capabilities.acceptsDesignShape
    : capabilities.acceptsCloneShape || ("api_style" in endpoint && endpoint.api_style === "elevenlabs");
}

export interface VoiceSourceCapabilities {
  /** Endpoint accepts clone-shaped bodies (`ref_audio` + `ref_text`). */
  acceptsCloneShape: boolean;
  /** Endpoint accepts design-shaped bodies (`instruct`). */
  acceptsDesignShape: boolean;
  /** Clone-shaped bodies may carry a one-off delivery instruction in `instruct`. */
  cloneInstructionsAvailable: boolean;
}

function getVoiceMode(
  endpoint: Pick<CustomEndpointRow, "api_style" | "extra_config"> | null | undefined,
): "clone" | "voice-design" | "auto" {
  const rawMode = endpoint?.extra_config.voice_mode;
  return rawMode === "voice-design" || rawMode === "auto" ? rawMode : "clone";
}

export function resolveVoiceSourceCapabilities(
  endpoint: VoiceSourceTarget | null | undefined,
): VoiceSourceCapabilities {
  if (endpoint && "speech_model_id" in endpoint) {
    return {
      acceptsCloneShape: endpoint.voice_mode !== "design",
      acceptsDesignShape: endpoint.voice_mode !== "clone",
      cloneInstructionsAvailable: endpoint.voice_mode !== "design",
    };
  }
  if (endpoint?.api_style !== "tts-clone") {
    return { acceptsCloneShape: false, acceptsDesignShape: false, cloneInstructionsAvailable: false };
  }

  const mode = getVoiceMode(endpoint);
  const acceptsCloneShape = mode === "clone" || mode === "auto";
  const acceptsDesignShape = mode === "voice-design" || mode === "auto";
  return {
    acceptsCloneShape,
    acceptsDesignShape,
    cloneInstructionsAvailable: acceptsCloneShape && endpoint.extra_config.supports_instruct === true,
  };
}
