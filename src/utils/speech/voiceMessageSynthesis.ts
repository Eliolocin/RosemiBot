import { withProviderUsageContext } from "@/utils/provider/providerUsage";
import {
  findProviderRequestDeniedError,
  type ProviderRequestDeniedError,
  reportProviderUsage,
} from "@/utils/provider/providerUsage";
import type { CustomEndpointRow } from "@/types/db/schema";
import type { ElevenLabsTtsErrorKind } from "@/utils/audio/elevenLabsTts";
import { synthesizeSpeechViaElevenLabsAdapter } from "@/providers/custom/styles/elevenLabsAdapter";
import {
  synthesizeSpeechViaTtsClone,
  synthesizeSpeechViaTtsCloneBuffer,
  type TtsCloneErrorKind,
} from "@/providers/custom/styles/ttsCloningAdapter";
import { synthesizeSpeechViaTtsVoiceDesign } from "@/providers/custom/styles/ttsVoiceDesignAdapter";
import { resolveVoiceSourceCapabilities } from "@/utils/speech/voiceSourceCapabilities";
import { synthesizeOpenRouterSpeech } from "@/providers/openrouter/openrouterSpeech";
import { createGoogleSpeechTransport } from "@/providers/google/googleSpeech";
import { cleanupPendingGoogleVoices, synthesizeGoogleVoice } from "@/utils/speech/googleVoiceLifecycle";
import {
  HOSTED_SPEECH_LIMITS,
  HostedSpeechError,
  type HostedSpeechErrorKind,
  type SpeechOperation,
} from "@/utils/speech/hostedSpeech";
import {
  loadSpeechRoutingPolicy,
  loadVoiceSampleById,
  SpeechBindingChangedError,
} from "@/utils/db/repositories/SpeechRepository";
import {
  resolveSpeechTargets,
  speechTargetLabel,
  type SpeechTargetResult,
} from "@/utils/provider/speechEndpointResolver";
import { loadStoredVoiceSampleBuffer } from "@/utils/storage/voiceSampleStorage";
import {
  normalizeVoiceSampleToWav,
  SPEECH_SAMPLE_MAX_MB,
  SPEECH_SAMPLE_MAX_DURATION_SECS,
} from "@/utils/speech/voiceSampleAddOperation";
import { parseBuffer } from "music-metadata";
import { resolveVoiceSourceCandidates, type VoiceSourcePersona } from "@/utils/speech/voiceSourceResolution";
import {
  elevenLabsFailureDetail,
  reportElevenLabsFailure,
  stripElevenLabsExpressionTags,
} from "@/utils/audio/elevenLabsShared";
import { ZodError } from "zod";
import { ResponseSizeError } from "@/utils/security/boundedResponse";
import { resolveSupporterCapabilityCredentials } from "@/modules/supporter-billing/runtime/managedProvider";
import {
  getSupporterFundingFromUsageContext,
  getSupporterUsageContext,
} from "@/modules/supporter-billing/runtime/types";
import { reportProviderFailure } from "@/utils/provider/providerErrorMetrics";

/** Metric key recorded against the `audio_generated` stat. */
export type VoiceBackendKey =
  | "elevenlabs"
  | "tts-clone"
  | "tts-voice-design"
  | "openrouter-speech"
  | "google-speech"
  | "vertex-speech";

type VoiceSynthesisErrorKind = TtsCloneErrorKind | ElevenLabsTtsErrorKind | HostedSpeechErrorKind;

/**
 * Which voice the caller wants this message synthesized from.
 *
 * A clone source carries either a stored sample id or raw audio: `/generate voice-message`
 * accepts an ad-hoc upload that has no `voice_samples` row, so a sample id alone cannot
 * express every clone request.
 */
export type ResolvedVoiceSource =
  | { kind: "design"; designPrompt: string; personaId?: number }
  | { kind: "clone"; voiceSampleId: number }
  | { kind: "clone-buffer"; refAudio: Buffer; refText: string | null }
  | { kind: "elevenlabs"; voiceId: string };

export interface VoiceMessageSynthesisResult {
  success: boolean;
  audioBuffer?: Buffer;
  /** Bare MIME type (no parameters), e.g. "audio/wav". */
  contentType?: string;
  extension?: string;
  /** Script text with markup stripped, suitable for transcript display. */
  cleanedCaptionText?: string;
  errorKind?: VoiceSynthesisErrorKind;
  details?: string;
  /**
   * The provider's status and response body exactly as logged. It stays off `attempts` because the
   * voice tool returns those to the model.
   */
  providerDetail?: string;
  /** The backend that produced the audio, already resolved for `audio_generated`. */
  backendKey: VoiceBackendKey;
  attempts?: VoiceSynthesisAttempt[];
  effectiveSource?: ResolvedVoiceSource["kind"];
  targetLabel?: string;
  usedServerFallback?: boolean;
  cleanupPending?: boolean;
  requestDenied?: ProviderRequestDeniedError;
}

interface VoiceSynthesisAttempt {
  provider: string;
  model: string;
  owner: SpeechTargetResult["owner"];
  source: ResolvedVoiceSource["kind"];
  synthesisSuccess: boolean;
  operations: SpeechOperation[];
  errorKind?: VoiceSynthesisErrorKind;
}

export interface VoiceMessageSynthesisRequest {
  target?: SpeechTargetResult;
  maxOutputBytes?: number;
  routing?: {
    serverId: number;
    userId: number;
    persona: VoiceSourcePersona & { persona_id: number };
    sourceIsExplicit: boolean;
  };
  endpoint: CustomEndpointRow | null;
  /** Credential for the active speech endpoint; empty for unauthenticated local servers. */
  endpointApiKey: string;
  /** Credential for the ElevenLabs fallback, consulted only when that path is taken. */
  elevenLabsApiKey: string;
  source: ResolvedVoiceSource;
  script: string;
  /** Per-message delivery direction for design-shaped or instruction-capable clone sources. */
  voiceInstructions?: string;
  /** Chatterbox delivery overrides for this invocation, clone sources only. */
  chatterbox?: {
    turboEnabled: boolean;
    cfgWeight: number;
    exaggeration: number;
  };
  /** ElevenLabs voice settings for this invocation, `elevenlabs` sources only. */
  elevenLabsVoiceSettings?: Record<string, unknown>;
  /** Turn-level cancellation from /kill, forwarded to whichever backend runs. */
  abortSignal?: AbortSignal;
}

const EXPECTED_HOSTED_SPEECH_KINDS: ReadonlySet<HostedSpeechErrorKind> = new Set([
  "cancelled",
  "timeout",
  "script_too_long",
  "authentication",
  "quota",
]);

function speechFailureOwner(
  request: VoiceMessageSynthesisRequest,
  owner: SpeechTargetResult["owner"],
): { serverId: number | null; userId: number | null } {
  return {
    serverId: request.routing?.serverId ?? (owner.kind === "server" ? owner.ownerId : null),
    userId: request.routing?.userId ?? (owner.kind === "personal" ? owner.ownerId : null),
  };
}

function hostedFailureDetail(error: unknown, aborted: boolean): string | undefined {
  if (error instanceof HostedSpeechError) return error.providerDetail;
  if (aborted) return undefined;
  return error instanceof Error ? error.message : String(error);
}

function failure(
  backendKey: VoiceBackendKey,
  details: string,
  errorKind: TtsCloneErrorKind = "invalid_request",
): VoiceMessageSynthesisResult {
  return { success: false, errorKind, details, backendKey };
}

async function synthesizeLocalVoiceMessage(
  request: VoiceMessageSynthesisRequest,
): Promise<VoiceMessageSynthesisResult> {
  const { endpoint, endpointApiKey, elevenLabsApiKey, source, script, chatterbox, abortSignal } = request;
  // Single source of truth for which request shapes the endpoint takes, shared with the modal's
  // source table so the two can never disagree about what an `auto` endpoint accepts.
  const capabilities = resolveVoiceSourceCapabilities(endpoint);

  if (source.kind === "design") {
    if (!endpoint) {
      return failure("tts-voice-design", "No active speech endpoint is configured for this server.");
    }

    // `auto` accepts design bodies too. Gating this on the dedicated-endpoint check instead is what
    // silently disables voice design on every mixed deployment, which is the one mode the modal's
    // voice-source radio exists to serve.
    if (!capabilities.acceptsDesignShape) {
      return failure(
        "tts-voice-design",
        "The active persona has a voice design prompt, but the active speech endpoint does not support instruct-based voice design. Select a VoiceDesign speech endpoint or assign a different voice.",
      );
    }

    const result = await synthesizeSpeechViaTtsVoiceDesign({
      endpoint,
      script,
      designPrompt: source.designPrompt,
      voiceInstructions: request.voiceInstructions,
      apiKey: endpointApiKey,
      ...(abortSignal ? { abortSignal } : {}),
    });
    return {
      success: result.success,
      audioBuffer: result.audioBuffer,
      contentType: result.contentType,
      extension: result.extension,
      cleanedCaptionText: result.cleanedCaptionText,
      errorKind: result.errorKind,
      details: result.details || "Failed to generate voice message via local voice-design TTS server.",
      backendKey: "tts-voice-design",
    };
  }

  if (source.kind === "clone" || source.kind === "clone-buffer") {
    if (!endpoint) {
      return failure(
        "tts-clone",
        "No speech clone endpoint is configured for this server. A server manager can add one with /providers.",
      );
    }

    // Capability, not `api_style` alone: a voice-design-only endpoint rejects a clone body even
    // though it is still a `tts-clone` endpoint, so posting one would reach the server and fail
    // there instead of here.
    if (!capabilities.acceptsCloneShape) {
      return failure(
        "tts-clone",
        "No speech clone endpoint is configured for this server. A server manager can add one with /providers.",
      );
    }

    const result =
      source.kind === "clone"
        ? await synthesizeSpeechViaTtsClone({
            endpoint,
            voiceSampleId: source.voiceSampleId,
            script,
            apiKey: endpointApiKey,
            ...(request.voiceInstructions ? { voiceInstructions: request.voiceInstructions } : {}),
            ...(chatterbox ? { chatterbox } : {}),
            ...(abortSignal ? { abortSignal } : {}),
          })
        : await synthesizeSpeechViaTtsCloneBuffer({
            endpoint,
            refAudio: source.refAudio,
            refText: source.refText,
            script,
            apiKey: endpointApiKey,
            ...(request.voiceInstructions ? { voiceInstructions: request.voiceInstructions } : {}),
            ...(chatterbox ? { chatterbox } : {}),
            ...(abortSignal ? { abortSignal } : {}),
          });

    return {
      success: result.success,
      audioBuffer: result.audioBuffer,
      contentType: result.contentType,
      extension: result.extension,
      cleanedCaptionText: result.cleanedCaptionText,
      errorKind: result.errorKind,
      details: result.details || "Failed to generate voice message via local TTS server.",
      backendKey: "tts-clone",
    };
  }

  if (!elevenLabsApiKey) {
    return failure(
      "elevenlabs",
      "No speech API key is available for this server. A server manager can configure one with /providers.",
    );
  }

  const result = await synthesizeSpeechViaElevenLabsAdapter({
    apiKey: elevenLabsApiKey,
    voiceId: source.voiceId,
    script,
    ...(request.elevenLabsVoiceSettings ? { voiceSettings: request.elevenLabsVoiceSettings } : {}),
    ...(abortSignal ? { abortSignal } : {}),
  });

  if (!result.success) {
    await reportElevenLabsFailure("voice-synthesis", result, {
      serverId: request.routing?.serverId ?? request.target?.owner.ownerId ?? null,
      userId: request.routing?.userId ?? null,
      cancelled: !!abortSignal?.aborted,
    });
  }

  return {
    success: result.success,
    audioBuffer: result.audioBuffer,
    contentType: result.contentType,
    extension: result.extension,
    cleanedCaptionText: result.cleanedCaptionText,
    errorKind: result.errorKind,
    details: result.details || "Failed to generate the ElevenLabs voice message.",
    providerDetail: result.success ? undefined : elevenLabsFailureDetail(result),
    backendKey: "elevenlabs",
  };
}

async function synthesizeHostedVoiceMessage(
  request: VoiceMessageSynthesisRequest,
  target: Extract<SpeechTargetResult, { kind: "hosted-model" }>,
  attempt: VoiceSynthesisAttempt,
): Promise<VoiceMessageSynthesisResult> {
  const backendKey: VoiceBackendKey = `${target.model.provider}-speech`;
  const source = request.source;
  const signal = AbortSignal.any([
    AbortSignal.timeout(HOSTED_SPEECH_LIMITS.generationTimeoutMs),
    ...(request.abortSignal ? [request.abortSignal] : []),
  ]);
  const maxBytes = Math.min(
    request.maxOutputBytes ?? HOSTED_SPEECH_LIMITS.outputBytes,
    HOSTED_SPEECH_LIMITS.outputBytes,
  );
  const startedAt = Date.now();
  let cleanupPending = false;
  let usageContext = target.usageContext;
  try {
    signal.throwIfAborted();
    if (
      !request.script.trim() ||
      request.script.length > HOSTED_SPEECH_LIMITS.scriptCharacters ||
      (request.voiceInstructions?.length ?? 0) > HOSTED_SPEECH_LIMITS.directionCharacters ||
      maxBytes <= 0
    )
      throw new HostedSpeechError("invalid_request");
    const validDesign =
      source.kind === "design" &&
      !!source.designPrompt.trim() &&
      source.designPrompt.length <= HOSTED_SPEECH_LIMITS.descriptionCharacters;
    let audio: Buffer;
    const targetFunding = getSupporterFundingFromUsageContext(target.usageContext);
    if (target.model.provider === "openrouter" && targetFunding) {
      const credentials = await resolveSupporterCapabilityCredentials({
        scope:
          target.owner.kind === "personal"
            ? { kind: "personal", userId: target.owner.ownerId }
            : { kind: "server", serverId: target.owner.ownerId },
        capability: "voice",
        modelId: target.model.speech_model_id,
      }).catch((error: unknown) => {
        const denied = findProviderRequestDeniedError(error);
        if (denied) usageContext = denied.usageContext;
        throw error;
      });
      if (
        credentials.funding.sponsorIdentityId !== targetFunding.sponsorIdentityId ||
        credentials.apiKey !== target.apiKey
      )
        throw new HostedSpeechError("invalid_request");
      usageContext = getSupporterUsageContext(credentials.funding);
    }
    if (target.model.provider === "openrouter" && source.kind === "design") {
      if (!validDesign) throw new HostedSpeechError("invalid_request");
      audio = await withProviderUsageContext(usageContext, async () =>
        synthesizeOpenRouterSpeech({
          shape: "design",
          model: target.model.codename,
          apiKey: target.apiKey,
          description: source.designPrompt,
          script: request.script,
          direction: request.voiceInstructions,
          signal,
          maxBytes,
          operations: attempt.operations,
        }),
      );
    } else if (target.model.provider === "openrouter") {
      if (source.kind !== "clone" && source.kind !== "clone-buffer") throw new HostedSpeechError("invalid_request");
      const sample = source.kind === "clone" ? await loadVoiceSampleById(source.voiceSampleId) : null;
      const reference =
        source.kind === "clone-buffer"
          ? source.refAudio
          : sample
            ? await loadStoredVoiceSampleBuffer(sample.file_path, signal)
            : null;
      const transcript = source.kind === "clone-buffer" ? source.refText : (sample?.ref_text ?? null);
      const referenceLimit = Math.min(SPEECH_SAMPLE_MAX_MB * 1024 * 1024, HOSTED_SPEECH_LIMITS.referenceBytes);
      if (
        !reference?.length ||
        reference.length > referenceLimit ||
        (transcript?.length ?? 0) > HOSTED_SPEECH_LIMITS.transcriptCharacters
      )
        throw new HostedSpeechError("invalid_request");
      let wav: Buffer;
      try {
        wav = await normalizeVoiceSampleToWav(reference, signal, referenceLimit);
      } catch {
        signal.throwIfAborted();
        throw new HostedSpeechError("invalid_request");
      }
      if (!wav.length || wav.length > referenceLimit) throw new HostedSpeechError("invalid_request");
      const { format } = await parseBuffer(wav, { mimeType: "audio/wav" });
      if (!format.duration || format.duration > SPEECH_SAMPLE_MAX_DURATION_SECS)
        throw new HostedSpeechError("invalid_request");
      audio = await withProviderUsageContext(usageContext, async () =>
        synthesizeOpenRouterSpeech({
          shape: "clone",
          model: target.model.codename,
          apiKey: target.apiKey,
          script: request.script,
          direction: request.voiceInstructions,
          reference: wav,
          transcript,
          signal,
          maxBytes,
          operations: attempt.operations,
        }),
      );
    } else {
      if (source.kind !== "design" || !validDesign) throw new HostedSpeechError("invalid_request");
      const transport = createGoogleSpeechTransport(target.model.provider, target.apiKey);
      cleanupPending = !(await cleanupPendingGoogleVoices(
        target.owner,
        target.credentialId,
        target.credentialRevision,
        target.apiKey,
        attempt.operations,
      ));
      const result = await synthesizeGoogleVoice({
        transport,
        owner: target.owner,
        credentialId: target.credentialId,
        credentialRevision: target.credentialRevision,
        personaId: source.personaId,
        prompt: source.designPrompt.trim(),
        script: request.script,
        direction: request.voiceInstructions,
        model: target.model.codename,
        signal,
        maxBytes,
        operations: attempt.operations,
      });
      audio = result.audio;
      cleanupPending ||= result.cleanupPending;
    }
    request.abortSignal?.throwIfAborted();
    attempt.synthesisSuccess = true;
    if (target.model.provider === "openrouter") {
      const synthesis = attempt.operations.find((operation) => operation.operation === "synthesize");
      reportProviderUsage(usageContext, {
        modelCodename: target.model.codename,
        costUsd: attempt.operations.find((operation) => operation.operation === "cost")?.actualCost,
        providerRequestId: synthesis?.generationId,
      });
    }
    return {
      success: true,
      audioBuffer: audio,
      contentType: target.model.provider === "openrouter" ? "audio/mpeg" : "audio/wav",
      extension: target.model.provider === "openrouter" ? "mp3" : "wav",
      cleanedCaptionText: stripElevenLabsExpressionTags(request.script),
      backendKey,
      cleanupPending,
    };
  } catch (error) {
    const requestDenied = findProviderRequestDeniedError(error, usageContext);
    if (requestDenied) {
      return { success: false, backendKey, requestDenied, cleanupPending };
    }
    const errorKind: HostedSpeechErrorKind = request.abortSignal?.aborted
      ? "cancelled"
      : signal.aborted
        ? "timeout"
        : error instanceof SpeechBindingChangedError
          ? "invalid_request"
          : error instanceof HostedSpeechError
            ? error.kind
            : error instanceof ZodError || error instanceof ResponseSizeError
              ? "malformed_response"
              : "provider_error";
    attempt.errorKind = errorKind;
    const providerStatus = error instanceof HostedSpeechError ? error.providerStatus : undefined;
    const providerDetail = hostedFailureDetail(error, signal.aborted);
    await reportProviderFailure({
      summary: "Hosted speech failed",
      errorType: "SpeechOperationFailed",
      error,
      expected:
        EXPECTED_HOSTED_SPEECH_KINDS.has(errorKind) ||
        (errorKind === "invalid_request" && providerStatus === undefined),
      detail: providerDetail,
      ...speechFailureOwner(request, target.owner),
      dimensions: {
        operation: "voice-synthesis",
        provider: target.model.provider,
        model: target.model.codename,
        owner: target.owner.kind,
        errorKind,
        origin: providerStatus === undefined ? "local" : "provider",
        ...(providerStatus !== undefined ? { providerStatus } : {}),
      },
      metadata: {
        sourceKind: source.kind,
        operations: attempt.operations.map(({ operation, status, success }) => ({ operation, status, success })),
        elapsedMs: Date.now() - startedAt,
      },
    });
    return {
      success: false,
      backendKey,
      errorKind,
      details: `Hosted speech failed: ${errorKind}.`,
      providerDetail,
      cleanupPending:
        cleanupPending ||
        attempt.operations.some((operation) => operation.operation === "delete" && !operation.success),
    };
  }
}

export async function synthesizeVoiceMessage(
  request: VoiceMessageSynthesisRequest,
): Promise<VoiceMessageSynthesisResult> {
  const attempts: VoiceSynthesisAttempt[] = [];
  async function run(current: VoiceMessageSynthesisRequest): Promise<VoiceMessageSynthesisResult> {
    if (!current.target) return synthesizeLocalVoiceMessage(current);
    const target = current.target;
    const attempt: VoiceSynthesisAttempt = {
      provider: target.kind === "hosted-model" ? target.model.provider : target.endpoint.api_style,
      model: target.kind === "hosted-model" ? target.model.codename : (target.endpoint.model_name ?? ""),
      owner: target.owner,
      source: current.source.kind,
      synthesisSuccess: false,
      operations: [],
    };
    attempts.push(attempt);
    const capabilities = resolveVoiceSourceCapabilities(
      target.kind === "hosted-model" ? target.model : target.endpoint,
    );
    if (
      current.source.kind === "design"
        ? !capabilities.acceptsDesignShape
        : current.source.kind === "elevenlabs"
          ? target.endpoint?.api_style !== "elevenlabs"
          : !capabilities.acceptsCloneShape
    ) {
      attempt.errorKind = "invalid_request";
      return {
        success: false,
        backendKey:
          target.kind === "hosted-model"
            ? `${target.model.provider}-speech`
            : current.source.kind === "design"
              ? "tts-voice-design"
              : "tts-clone",
        errorKind: "invalid_request",
        attempts,
      };
    }
    const result =
      target.kind === "hosted-model"
        ? await synthesizeHostedVoiceMessage(current, target, attempt)
        : await synthesizeLocalVoiceMessage({
            ...current,
            endpoint: target.endpoint,
            endpointApiKey: target.apiKey,
            elevenLabsApiKey: target.endpoint.api_style === "elevenlabs" ? target.apiKey : current.elevenLabsApiKey,
          });
    attempt.synthesisSuccess =
      result.success ||
      attempt.operations.some((operation) => operation.operation === "synthesize" && operation.success);
    attempt.errorKind = result.errorKind;
    return { ...result, attempts, effectiveSource: current.source.kind, targetLabel: speechTargetLabel(target) };
  }
  if (request.abortSignal?.aborted)
    return { success: false, backendKey: "tts-clone", errorKind: "cancelled", attempts };
  let policy: Awaited<ReturnType<typeof loadSpeechRoutingPolicy>> | undefined;
  if (request.routing) {
    policy = await loadSpeechRoutingPolicy(request.routing.serverId, request.routing.userId);
    if ((!request.target || request.target.owner.kind === "server") && !policy.serverAllowed)
      return { success: false, backendKey: "tts-clone", errorKind: "invalid_request", attempts };
  }
  const result = await run(request);
  if (
    result.success ||
    request.abortSignal?.aborted ||
    !request.routing ||
    request.target?.owner.kind !== "personal" ||
    !policy?.fallbackEnabled ||
    !policy.serverAllowed ||
    !result.errorKind ||
    !["authentication", "quota", "timeout", "provider_error", "malformed_response", "request_failed"].includes(
      result.errorKind,
    )
  )
    return result;
  policy = await loadSpeechRoutingPolicy(request.routing.serverId, request.routing.userId);
  if (!policy.serverAllowed || !policy.fallbackEnabled) return result;
  const targets = await resolveSpeechTargets(request.routing.serverId);
  let source = request.source;
  if (!request.routing.sourceIsExplicit) {
    const [candidate] = resolveVoiceSourceCandidates({
      targets: {
        design: targets.design?.kind === "hosted-model" ? targets.design.model : (targets.design?.endpoint ?? null),
        clone: targets.clone?.kind === "hosted-model" ? targets.clone.model : (targets.clone?.endpoint ?? null),
      },
      persona: request.routing.persona,
    });
    if (!candidate) return result;
    source =
      candidate.shape === "design"
        ? { kind: "design", designPrompt: candidate.designPrompt ?? "", personaId: request.routing.persona.persona_id }
        : candidate.shape === "elevenlabs"
          ? { kind: "elevenlabs", voiceId: candidate.voiceId ?? "" }
          : { kind: "clone", voiceSampleId: candidate.sampleId ?? 0 };
  }
  const target = source.kind === "design" ? targets.design : targets.clone;
  if (!target) return result;
  const capabilities = resolveVoiceSourceCapabilities(target.kind === "hosted-model" ? target.model : target.endpoint);
  if (
    source.kind === "design"
      ? !capabilities.acceptsDesignShape
      : source.kind === "elevenlabs"
        ? target.endpoint?.api_style !== "elevenlabs"
        : !capabilities.acceptsCloneShape
  )
    return result;
  const fallback = await run({ ...request, target, source });
  return {
    ...fallback,
    usedServerFallback: true,
    requestDenied: fallback.requestDenied ?? result.requestDenied,
    cleanupPending: result.cleanupPending || fallback.cleanupPending,
  };
}
