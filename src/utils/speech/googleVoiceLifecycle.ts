import { createHash } from "node:crypto";
import {
  createGoogleSpeechTransport,
  GoogleVoiceCreationError,
  type GoogleSpeechTransport,
} from "@/providers/google/googleSpeech";
import type { OpenRouterModelScope } from "@/utils/db/repositories/LlmModelRepository";
import * as speechRepo from "@/utils/db/repositories/SpeechRepository";
import type { SpeechVoiceBindingRow } from "@/types/db/schema";
import { decryptApiKey } from "@/utils/security/crypto";
import { log } from "@/utils/misc/logger";
import { HOSTED_SPEECH_LIMITS, HostedSpeechError, type SpeechOperation } from "@/utils/speech/hostedSpeech";

function reportCleanupFailure(credentialId: number, scope: OpenRouterModelScope["kind"], error: unknown): void {
  const providerDetail = error instanceof HostedSpeechError ? error.providerDetail : undefined;
  log.error(
    `Speech voice cleanup failed; remove unused voices in the provider console before removing or replacing credentials.${providerDetail ? ` ${providerDetail}` : ""}`,
    error,
    {
      errorType: "SpeechVoiceCleanupFailed",
      metadata: {
        credentialId,
        scope,
        ...(error instanceof HostedSpeechError && error.providerStatus !== undefined
          ? { providerStatus: error.providerStatus }
          : {}),
      },
    },
  );
}

async function deleteBinding(
  binding: SpeechVoiceBindingRow,
  transport: GoogleSpeechTransport,
  operations: SpeechOperation[],
  signal = AbortSignal.timeout(HOSTED_SPEECH_LIMITS.cleanupTimeoutMs),
): Promise<boolean> {
  try {
    await speechRepo.markSpeechVoiceBindingForDeletion(binding.speech_voice_binding_id);
    await transport.delete(binding.voice_id, signal, operations);
    await speechRepo.deleteSpeechVoiceBinding(binding.speech_voice_binding_id);
    return true;
  } catch (error) {
    reportCleanupFailure(
      binding.saved_config_id ?? binding.user_saved_config_id ?? 0,
      binding.saved_config_id ? "server" : "personal",
      error,
    );
    return false;
  }
}

export async function cleanupPendingGoogleVoices(
  owner: OpenRouterModelScope,
  credentialId: number,
  credentialRevision: number,
  apiKey: string,
  operations: SpeechOperation[],
): Promise<boolean> {
  let success = true;
  const signal = AbortSignal.timeout(HOSTED_SPEECH_LIMITS.cleanupTimeoutMs);
  const bindings = await speechRepo.loadPendingSpeechVoiceDeletions(credentialId, owner.kind);
  for (const binding of bindings) {
    if (binding.credential_revision !== credentialRevision) continue;
    try {
      const transport = createGoogleSpeechTransport(binding.transport, apiKey);
      if (transport.project !== binding.project || transport.location !== binding.location) continue;
      if (signal.aborted) {
        success = false;
        break;
      }
      success = (await deleteBinding(binding, transport, operations, signal)) && success;
    } catch (error) {
      reportCleanupFailure(credentialId, owner.kind, error);
      success = false;
    }
  }
  return success;
}

export async function cleanupSpeechCredentialBeforeChange(
  owner: OpenRouterModelScope,
  provider: string,
  nextCiphertext?: Buffer | null,
): Promise<void> {
  if (provider !== "google" && provider !== "vertex") return;
  try {
    const credential = await speechRepo.loadSpeechCredentialForCleanup(owner, provider);
    if (!credential || (nextCiphertext && credential.apiKey.equals(nextCiphertext))) return;
    await speechRepo.retireSpeechCredentialBindings(credential.credentialId, owner.kind);
    const apiKey = await decryptApiKey(credential.apiKey, credential.keyVersion);
    await cleanupPendingGoogleVoices(owner, credential.credentialId, credential.credentialRevision, apiKey, []);
  } catch (error) {
    reportCleanupFailure(owner.ownerId, owner.kind, error);
  }
}

export async function synthesizeGoogleVoice(request: {
  transport: GoogleSpeechTransport;
  owner: OpenRouterModelScope;
  credentialId: number;
  credentialRevision: number;
  personaId?: number;
  prompt: string;
  script: string;
  direction?: string;
  model: string;
  signal: AbortSignal;
  maxBytes: number;
  operations: SpeechOperation[];
}): Promise<{ audio: Buffer; cleanupPending: boolean }> {
  const { transport, operations } = request;
  const identity: speechRepo.SpeechBindingIdentity = {
    persona_id: request.personaId ?? null,
    saved_config_id: request.owner.kind === "server" ? request.credentialId : null,
    user_saved_config_id: request.owner.kind === "personal" ? request.credentialId : null,
    credential_revision: request.credentialRevision,
    transport: transport.transport,
    project: transport.project,
    location: transport.location,
    prompt_hash: createHash("sha256").update(request.prompt.trim()).digest("hex"),
  };
  let temporaryVoiceId: string | null = null;
  let cleanupPending = false;
  let result: { audio: Buffer; cleanupPending: boolean } | undefined;

  async function discardCreated(voiceId: string): Promise<void> {
    let pending: SpeechVoiceBindingRow | null = null;
    try {
      pending = await speechRepo.savePendingSpeechVoiceDeletion(identity, voiceId);
    } catch (error) {
      reportCleanupFailure(request.credentialId, request.owner.kind, error);
    }
    if (pending) {
      cleanupPending = !(await deleteBinding(pending, transport, operations)) || cleanupPending;
      return;
    }
    try {
      await transport.delete(voiceId, AbortSignal.timeout(HOSTED_SPEECH_LIMITS.cleanupTimeoutMs), operations);
    } catch (error) {
      cleanupPending = true;
      reportCleanupFailure(request.credentialId, request.owner.kind, error);
    }
  }

  async function createBinding(): Promise<{ voiceId: string; binding?: SpeechVoiceBindingRow }> {
    request.signal.throwIfAborted();
    let created: Awaited<ReturnType<GoogleSpeechTransport["create"]>>;
    try {
      created = await transport.create(request.prompt, request.model, request.signal, operations);
    } catch (error) {
      if (error instanceof GoogleVoiceCreationError) await discardCreated(error.voiceId);
      throw error;
    }
    try {
      request.signal.throwIfAborted();
      if (identity.persona_id === null) {
        temporaryVoiceId = created.voiceId;
        return { voiceId: created.voiceId };
      }
      const retained = await speechRepo.saveSpeechVoiceBinding(identity, created.voiceId, created.expiresAt);
      if (retained.voice_id !== created.voiceId) await discardCreated(created.voiceId);
      return { voiceId: retained.voice_id, binding: retained };
    } catch (error) {
      await discardCreated(created.voiceId);
      throw error;
    }
  }

  try {
    let binding = identity.persona_id === null ? null : await speechRepo.loadSpeechVoiceBinding(identity);
    if (binding?.expires_at && binding.expires_at.getTime() <= Date.now()) {
      await speechRepo.markSpeechVoiceBindingForDeletion(binding.speech_voice_binding_id);
      cleanupPending = !(await deleteBinding(binding, transport, operations));
      binding = null;
    }
    let voice = binding ? { voiceId: binding.voice_id, binding } : await createBinding();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        request.signal.throwIfAborted();
        const audio = await transport.synthesize(
          voice.voiceId,
          request.script,
          request.direction,
          request.model,
          request.signal,
          request.maxBytes,
          operations,
        );
        if (voice.binding) {
          // Synthesis extends provider expiry, so an old creation timestamp must not force recreation.
          try {
            await speechRepo.refreshSpeechVoiceBinding(voice.binding.speech_voice_binding_id, null);
          } catch {
            log.error("Speech voice expiry refresh failed.", undefined, { personaId: identity.persona_id });
          }
        }
        result = { audio, cleanupPending };
        return result;
      } catch (error) {
        if (!(error instanceof HostedSpeechError) || error.kind !== "missing_voice" || attempt !== 0) throw error;
        if (temporaryVoiceId) await discardCreated(temporaryVoiceId);
        else if (voice.binding)
          cleanupPending = !(await deleteBinding(voice.binding, transport, operations)) || cleanupPending;
        temporaryVoiceId = null;
        voice = await createBinding();
      }
    }
    throw new HostedSpeechError("provider_error");
  } finally {
    if (temporaryVoiceId) await discardCreated(temporaryVoiceId);
    if (result) result.cleanupPending = cleanupPending;
  }
}
