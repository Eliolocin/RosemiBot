import {
  ELEVENLABS_API_BASE_URL,
  getElevenLabsSttConfig,
  normalizeTranscriptText,
  readElevenLabsErrorDetail,
} from "@/utils/audio/elevenLabsShared";

type ElevenLabsSttErrorKind = "missing_api_key" | "timeout" | "request_failed" | "invalid_response";

export interface ElevenLabsSttRequest {
  apiKey: string;
  audioBuffer: Buffer;
  filename: string;
  mimeType?: string | null;
  modelId?: string;
}

export interface ElevenLabsSttResult {
  success: boolean;
  transcriptText?: string;
  modelUsed?: string;
  detectedLanguage?: string | null;
  errorKind?: ElevenLabsSttErrorKind;
  statusCode?: number;
  details?: string;
  /** ElevenLabs' status and response body, for the operator log. */
  providerDetail?: string;
}

export async function transcribeWithElevenLabs(request: ElevenLabsSttRequest): Promise<ElevenLabsSttResult> {
  if (!request.apiKey.trim()) {
    return {
      success: false,
      errorKind: "missing_api_key",
      details: "Missing ElevenLabs API key.",
    };
  }

  const config = getElevenLabsSttConfig();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([new Uint8Array(request.audioBuffer)], {
        type: request.mimeType ?? "application/octet-stream",
      }),
      request.filename,
    );
    formData.append("model_id", request.modelId ?? config.modelId);

    const response = await fetch(`${ELEVENLABS_API_BASE_URL}/v1/speech-to-text`, {
      method: "POST",
      headers: {
        "xi-api-key": request.apiKey,
      },
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        errorKind: "request_failed",
        statusCode: response.status,
        details: `HTTP ${response.status}`,
        providerDetail: await readElevenLabsErrorDetail(response, request.apiKey),
      };
    }

    let responseJson: Record<string, unknown> | null = null;
    try {
      responseJson = (await response.json()) as Record<string, unknown>;
    } catch {
      responseJson = null;
    }

    const rawTranscript =
      typeof responseJson?.text === "string"
        ? responseJson.text
        : typeof responseJson?.transcript === "string"
          ? responseJson.transcript
          : null;

    if (!rawTranscript) {
      return {
        success: false,
        errorKind: "invalid_response",
        statusCode: response.status,
        details: "ElevenLabs STT response did not include transcript text.",
      };
    }

    const transcriptText = normalizeTranscriptText(rawTranscript, config.maxTranscriptChars);
    if (!transcriptText) {
      return {
        success: false,
        errorKind: "invalid_response",
        statusCode: response.status,
        details: "Transcript was empty after normalization.",
      };
    }

    return {
      success: true,
      transcriptText,
      modelUsed:
        typeof responseJson?.model_id === "string" ? responseJson.model_id : (request.modelId ?? config.modelId),
      detectedLanguage:
        typeof responseJson?.language_code === "string"
          ? responseJson.language_code
          : typeof responseJson?.language === "string"
            ? responseJson.language
            : null,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        errorKind: "timeout",
        details: `ElevenLabs STT request timed out after ${config.timeoutMs}ms.`,
      };
    }

    return {
      success: false,
      errorKind: "request_failed",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}
