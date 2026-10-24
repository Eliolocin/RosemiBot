import { reportProviderFailure } from "@/utils/provider/providerErrorMetrics";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { speechErrorBody } from "@/utils/speech/hostedSpeech";
import { stripTtsUnsupportedEmojiAttempts } from "@/utils/text/emojiHelper";

const DEFAULT_STT_MODEL_ID = "scribe_v2";
const DEFAULT_STT_TIMEOUT_MS = 20_000;
const DEFAULT_STT_MAX_SIZE_MB = 20;
const DEFAULT_STT_MAX_TRANSCRIPT_CHARS = 1_500;

const DEFAULT_TTS_MODEL_ID = "eleven_v3";
const DEFAULT_TTS_TIMEOUT_MS = 20_000;
const DEFAULT_TTS_MAX_CHARS = 2_000;
const DEFAULT_TTS_OUTPUT_FORMAT = "mp3_44100_128";

export const ELEVENLABS_SERVICE_NAME = "elevenlabs";
export const ELEVENLABS_API_BASE_URL = "https://api.elevenlabs.io";
const ELEVENLABS_ERROR_BODY_BYTES = 64 * 1024;
const DISCORD_MESSAGE_MAX_CHARS = 2_000;

/** A rejected key, a missing permission, an exhausted quota, or a rate limit is the key owner's to fix. */
const EXPECTED_ELEVENLABS_STATUSES = new Set([401, 402, 403, 429]);

interface ElevenLabsFailure {
  errorKind?: string;
  statusCode?: number;
  details?: string;
  providerDetail?: string;
}

function isExpectedElevenLabsFailure({ errorKind, statusCode }: ElevenLabsFailure): boolean {
  if (errorKind === "invalid_response") return false;
  if (errorKind !== "request_failed") return true;
  return statusCode !== undefined && EXPECTED_ELEVENLABS_STATUSES.has(statusCode);
}

/** The status and response body behind a failed request, or the transport error when none arrived. */
export function elevenLabsFailureDetail(failure: ElevenLabsFailure): string | undefined {
  return failure.providerDetail ?? (failure.errorKind === "request_failed" ? failure.details : undefined);
}

export async function reportElevenLabsFailure(
  operation: "voice-synthesis" | "transcription" | "voice-catalog" | "key-validation",
  failure: ElevenLabsFailure,
  context: { serverId?: number | null; userId?: number | null; cancelled?: boolean } = {},
): Promise<void> {
  await reportProviderFailure({
    summary: "ElevenLabs request failed",
    errorType: "ElevenLabsOperationFailed",
    error: undefined,
    expected: !!context.cancelled || isExpectedElevenLabsFailure(failure),
    detail: elevenLabsFailureDetail(failure) ?? failure.details,
    serverId: context.serverId,
    userId: context.userId,
    dimensions: {
      operation,
      provider: ELEVENLABS_SERVICE_NAME,
      errorKind: failure.errorKind ?? "unknown",
      ...(failure.statusCode !== undefined ? { providerStatus: failure.statusCode } : {}),
    },
  });
}

/** ElevenLabs' status and response body, scrubbed of the key that sent the request. */
export async function readElevenLabsErrorDetail(response: Response, apiKey: string): Promise<string> {
  const body = await readBoundedResponse(response, ELEVENLABS_ERROR_BODY_BYTES).then(
    (buffer) => speechErrorBody(buffer.toString("utf8"), apiKey),
    () => "",
  );
  return body ? `HTTP ${response.status}: ${body}` : `HTTP ${response.status}`;
}

function parseNumberEnv(
  value: string | undefined,
  fallback: number,
  options?: {
    min?: number;
  },
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (options?.min !== undefined && parsed < options.min) {
    return fallback;
  }

  return parsed;
}

function isTruthyEnv(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export function getElevenLabsSttConfig(): {
  modelId: string;
  timeoutMs: number;
  maxSizeMb: number;
  maxTranscriptChars: number;
} {
  return {
    modelId: (process.env.ELEVENLABS_STT_MODEL_ID ?? DEFAULT_STT_MODEL_ID).trim(),
    timeoutMs: parseNumberEnv(process.env.ELEVENLABS_STT_TIMEOUT_MS, DEFAULT_STT_TIMEOUT_MS, { min: 1_000 }),
    maxSizeMb: parseNumberEnv(process.env.ELEVENLABS_STT_MAX_SIZE_MB, DEFAULT_STT_MAX_SIZE_MB, { min: 1 }),
    maxTranscriptChars: parseNumberEnv(
      process.env.ELEVENLABS_STT_MAX_TRANSCRIPT_CHARS,
      DEFAULT_STT_MAX_TRANSCRIPT_CHARS,
      { min: 50 },
    ),
  };
}

export function getElevenLabsTtsConfig(): {
  modelId: string;
  timeoutMs: number;
  maxChars: number;
  outputFormat: string;
  stripUnsupportedTags: boolean;
} {
  return {
    modelId: (process.env.ELEVENLABS_TTS_MODEL_ID ?? DEFAULT_TTS_MODEL_ID).trim(),
    timeoutMs: parseNumberEnv(process.env.ELEVENLABS_TTS_TIMEOUT_MS, DEFAULT_TTS_TIMEOUT_MS, { min: 1_000 }),
    maxChars: parseNumberEnv(process.env.ELEVENLABS_TTS_MAX_CHARS, DEFAULT_TTS_MAX_CHARS, { min: 50 }),
    outputFormat: (process.env.ELEVENLABS_TTS_OUTPUT_FORMAT ?? DEFAULT_TTS_OUTPUT_FORMAT).trim(),
    stripUnsupportedTags: isTruthyEnv(process.env.ELEVENLABS_TTS_STRIP_UNSUPPORTED_TAGS),
  };
}

function clampTextLength(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  return text.slice(0, maxChars).trimEnd();
}

export function normalizeTranscriptText(text: string, maxChars: number): string {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return clampTextLength(normalized, maxChars);
}

const VALID_EXPRESSION_TAG_REGEX = /\[([A-Za-z][A-Za-z0-9 _-]{0,30})\]/g;
const ANY_BRACKET_TAG_REGEX = /\[([^\]\r\n]{1,40})\]/g;

export function stripElevenLabsExpressionTags(text: string): string {
  return text
    .replace(VALID_EXPRESSION_TAG_REGEX, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

function normalizeTaggedScript(script: string, stripUnsupportedTags: boolean): string {
  const normalized = script.replace(/\r\n/g, "\n").trim();
  if (!stripUnsupportedTags) {
    return normalized;
  }

  return normalized.replace(ANY_BRACKET_TAG_REGEX, (_match, rawTag: string) => {
    const tag = rawTag.trim();
    return /^[A-Za-z][A-Za-z0-9 _-]{0,30}$/.test(tag) ? `[${tag}]` : "";
  });
}

export function sanitizeElevenLabsTaggedScript(
  script: string,
  maxChars: number,
  stripUnsupportedTags: boolean,
): {
  rawScript: string;
  captionText: string;
} {
  const normalizedScript = clampTextLength(
    stripTtsUnsupportedEmojiAttempts(normalizeTaggedScript(script, stripUnsupportedTags), {
      preserveUnicodeEmojis: false,
    }),
    maxChars,
  );
  const captionText = clampTextLength(stripElevenLabsExpressionTags(normalizedScript), DISCORD_MESSAGE_MAX_CHARS);

  return {
    rawScript: normalizedScript,
    captionText,
  };
}
