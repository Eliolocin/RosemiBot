import {
  ELEVENLABS_API_BASE_URL,
  ELEVENLABS_SERVICE_NAME,
  getElevenLabsTtsConfig,
  reportElevenLabsFailure,
} from "@/utils/audio/elevenLabsShared";

export { ELEVENLABS_SERVICE_NAME };

type ElevenLabsAccountValidationErrorKind = "missing_api_key" | "timeout" | "request_failed" | "invalid_response";

export interface ElevenLabsAccountValidationResult {
  success: boolean;
  tier?: string | null;
  characterLimit?: number | null;
  characterCount?: number | null;
  canUseInstantVoiceCloning?: boolean | null;
  errorKind?: ElevenLabsAccountValidationErrorKind;
  statusCode?: number;
  details?: string;
}

export async function validateElevenLabsApiKey(apiKey: string): Promise<ElevenLabsAccountValidationResult> {
  if (!apiKey.trim()) {
    return {
      success: false,
      errorKind: "missing_api_key",
      details: "Missing ElevenLabs API key.",
    };
  }

  const { timeoutMs } = getElevenLabsTtsConfig();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Use /v1/voices for validation , so accessible with TTS permissions alone,
    // unlike /v1/user/subscription which requires account:read scope and
    // returns 401 (not 403) for fine-grained STT/TTS-only keys.
    const response = await fetch(`${ELEVENLABS_API_BASE_URL}/v1/voices`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "xi-api-key": apiKey,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    let responseJson: Record<string, unknown> | null = null;
    try {
      responseJson = (await response.json()) as Record<string, unknown>;
    } catch {
      responseJson = null;
    }

    // Only 401 means the key itself is invalid or revoked. Any other status
    // (including 403) means the key authenticated but lacks this specific scope,
    // which is still a valid key.
    if (response.status === 401) {
      const detail = typeof responseJson?.detail === "string" ? responseJson.detail : `HTTP 401`;
      return {
        success: false,
        errorKind: "request_failed",
        statusCode: response.status,
        details: `Invalid or revoked ElevenLabs API key. (${detail})`,
      };
    }

    return {
      success: true,
      tier: null,
      characterLimit: null,
      characterCount: null,
      canUseInstantVoiceCloning: null,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        errorKind: "timeout",
        details: `ElevenLabs validation request timed out after ${timeoutMs}ms.`,
      };
    }

    const failure = {
      success: false,
      errorKind: "request_failed",
      details: error instanceof Error ? error.message : String(error),
    } as const;
    await reportElevenLabsFailure("key-validation", failure);
    return failure;
  }
}
