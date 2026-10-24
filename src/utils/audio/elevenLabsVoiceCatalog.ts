import {
  ELEVENLABS_API_BASE_URL,
  getElevenLabsTtsConfig,
  readElevenLabsErrorDetail,
  reportElevenLabsFailure,
} from "@/utils/audio/elevenLabsShared";

type ElevenLabsVoiceCatalogErrorKind = "missing_api_key" | "timeout" | "request_failed" | "invalid_response";

export interface ElevenLabsVoiceCatalogEntry {
  voiceId: string;
  name: string;
  category: string | null;
  description: string | null;
  previewUrl: string | null;
  labels: Record<string, string>;
}

export interface ElevenLabsVoiceCatalogResult {
  success: boolean;
  voices?: ElevenLabsVoiceCatalogEntry[];
  errorKind?: ElevenLabsVoiceCatalogErrorKind;
  statusCode?: number;
  details?: string;
  /** ElevenLabs' status and response body, for the operator log. */
  providerDetail?: string;
}

export async function fetchElevenLabsVoiceCatalog(apiKey: string): Promise<ElevenLabsVoiceCatalogResult> {
  const result = await requestElevenLabsVoiceCatalog(apiKey);
  if (!result.success) await reportElevenLabsFailure("voice-catalog", result);
  return result;
}

async function requestElevenLabsVoiceCatalog(
  apiKey: string,
): Promise<ElevenLabsVoiceCatalogResult & { providerDetail?: string }> {
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
    const response = await fetch(`${ELEVENLABS_API_BASE_URL}/v1/voices`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "xi-api-key": apiKey,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        errorKind: "request_failed",
        statusCode: response.status,
        details: `HTTP ${response.status}`,
        providerDetail: await readElevenLabsErrorDetail(response, apiKey),
      };
    }

    let responseJson: Record<string, unknown> | null = null;
    try {
      responseJson = (await response.json()) as Record<string, unknown>;
    } catch {
      responseJson = null;
    }

    const rawVoices = responseJson?.voices;
    if (!Array.isArray(rawVoices)) {
      return {
        success: false,
        errorKind: "invalid_response",
        statusCode: response.status,
        details: "ElevenLabs voice list response did not include a voices array.",
      };
    }

    const voices = rawVoices
      .flatMap((voice): ElevenLabsVoiceCatalogEntry[] => {
        if (!voice || typeof voice !== "object") {
          return [];
        }

        const voiceRecord = voice as Record<string, unknown>;
        const voiceId = typeof voiceRecord.voice_id === "string" ? voiceRecord.voice_id : null;
        if (!voiceId) {
          return [];
        }
        const labelsSource = voiceRecord.labels;
        const labels: Record<string, string> = {};
        if (labelsSource && typeof labelsSource === "object") {
          for (const [key, value] of Object.entries(labelsSource as Record<string, unknown>)) {
            if (typeof value === "string") {
              labels[key] = value;
            }
          }
        }

        const name = typeof voiceRecord.name === "string" ? voiceRecord.name.trim() : "";

        const category = typeof voiceRecord.category === "string" ? voiceRecord.category : null;
        const description = typeof voiceRecord.description === "string" ? voiceRecord.description : null;
        const previewUrl = typeof voiceRecord.preview_url === "string" ? voiceRecord.preview_url : null;

        return [
          {
            voiceId,
            name: name || voiceId,
            category,
            description,
            previewUrl,
            labels,
          },
        ];
      })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));

    return {
      success: true,
      voices,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        errorKind: "timeout",
        details: `ElevenLabs voice catalog request timed out after ${timeoutMs}ms.`,
      };
    }

    return {
      success: false,
      errorKind: "request_failed",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}
