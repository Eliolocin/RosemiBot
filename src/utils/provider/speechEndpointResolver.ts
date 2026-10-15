import type { VoiceSourceMode } from "@/utils/speech/voiceSourceCapabilities";
import type { CustomEndpointRow } from "@/types/db/schema";
import { log } from "@/utils/misc/logger";
import { buildCustomProviderName } from "@/utils/provider/customProviderUtils";
import { decryptApiKey } from "@/utils/security/crypto";
import { loadActiveEndpoint, loadEndpointCredentials } from "@/utils/db/repositories/SpeechRepository";

export interface SpeechEndpointResult {
  endpoint: CustomEndpointRow;
  /** Empty string when requires_auth = false (local endpoint with no auth). */
  apiKey: string;
}

async function resolveActiveEndpointByCapability(
  serverId: number,
  capability: VoiceSourceMode | "transcription",
): Promise<SpeechEndpointResult | null> {
  try {
    const endpoint = await loadActiveEndpoint(serverId, capability);

    if (!endpoint?.connection_id) {
      return null;
    }

    // Endpoints that don't require auth (local servers) need no key lookup.
    if (!endpoint.requires_auth) {
      return { endpoint, apiKey: "" };
    }

    // Credentials are stored in saved_provider_configs keyed by the internal provider name via repository
    const providerName = buildCustomProviderName(endpoint.connection_id);
    const configRow = await loadEndpointCredentials(serverId, providerName);

    if (!configRow?.api_key) {
      log.warn(
        `[SpeechResolver] No credentials found for ${capability} endpoint "${endpoint.label}" on server ${serverId}`,
      );
      return null;
    }

    let apiKey: string;
    try {
      apiKey = await decryptApiKey(configRow.api_key, configRow.key_version);
    } catch {
      log.warn(`[SpeechResolver] Failed to decrypt credentials for ${capability} endpoint on server ${serverId}`);
      return null;
    }

    if (!apiKey) {
      return null;
    }

    return { endpoint, apiKey };
  } catch (error) {
    log.warn(`[SpeechResolver] Error resolving ${capability} endpoint for server ${serverId}`, error);
    return null;
  }
}

/**
 * Resolves the active speech (TTS) endpoint and credentials for a server.
 * Returns null when no speech endpoint is registered.
 */
export async function resolveActiveSpeechEndpoint(
  serverId: number,
  mode: VoiceSourceMode,
): Promise<SpeechEndpointResult | null> {
  return resolveActiveEndpointByCapability(serverId, mode);
}

/**
 * Resolves the active transcription (STT) endpoint and credentials for a server.
 * Returns null when no transcription endpoint is registered.
 */
export async function resolveActiveTranscriptionEndpoint(serverId: number): Promise<SpeechEndpointResult | null> {
  return resolveActiveEndpointByCapability(serverId, "transcription");
}

export async function resolveSpeechTargets(
  serverId: number,
): Promise<{ design: SpeechEndpointResult | null; clone: SpeechEndpointResult | null }> {
  const [design, clone] = await Promise.all([
    resolveActiveSpeechEndpoint(serverId, "design"),
    resolveActiveSpeechEndpoint(serverId, "clone"),
  ]);
  return { design, clone };
}
