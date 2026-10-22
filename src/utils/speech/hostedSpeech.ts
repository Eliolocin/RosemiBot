import { parseBuffer } from "music-metadata";
import { MAX_VOICE_DESIGN_PROMPT_LENGTH } from "@/constants/speech";
import { z } from "zod";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { redactLogString } from "@/utils/misc/logger";

export const HOSTED_SPEECH_LIMITS = {
  scriptCharacters: 2_000,
  descriptionCharacters: MAX_VOICE_DESIGN_PROMPT_LENGTH,
  directionCharacters: 300,
  generationTimeoutMs: 240_000,
  outputBytes: 10 * 1024 * 1024,
  referenceBytes: 15 * 1024 * 1024,
  transcriptCharacters: 10_000,
  cleanupTimeoutMs: 10_000,
  metadataBytes: 64 * 1024,
  costTimeoutMs: 5_000,
} as const;

const modalityUsage = z.object({ modality: z.string(), tokens: z.number().nonnegative() });
export const speechUsageSchema = z.object({
  total_tokens: z.number().nonnegative().optional(),
  total_input_tokens: z.number().nonnegative().optional(),
  total_output_tokens: z.number().nonnegative().optional(),
  total_cached_tokens: z.number().nonnegative().optional(),
  total_tool_use_tokens: z.number().nonnegative().optional(),
  total_thought_tokens: z.number().nonnegative().optional(),
  input_tokens_by_modality: z.array(modalityUsage).optional(),
  output_tokens_by_modality: z.array(modalityUsage).optional(),
  promptTokenCount: z.number().nonnegative().optional(),
  candidatesTokenCount: z.number().nonnegative().optional(),
  totalTokenCount: z.number().nonnegative().optional(),
  cachedContentTokenCount: z.number().nonnegative().optional(),
  thoughtsTokenCount: z.number().nonnegative().optional(),
  promptTokensDetails: z.array(z.object({ modality: z.string(), tokenCount: z.number().nonnegative() })).optional(),
  candidatesTokensDetails: z.array(z.object({ modality: z.string(), tokenCount: z.number().nonnegative() })).optional(),
  tokens_prompt: z.number().nonnegative().nullable().optional(),
  tokens_completion: z.number().nonnegative().nullable().optional(),
  native_tokens_prompt: z.number().nonnegative().nullable().optional(),
  native_tokens_completion: z.number().nonnegative().nullable().optional(),
  native_tokens_reasoning: z.number().nonnegative().nullable().optional(),
  native_tokens_cached: z.number().nonnegative().nullable().optional(),
  num_input_audio_prompt: z.number().nonnegative().nullable().optional(),
});

export interface SpeechOperation {
  operation: "create" | "synthesize" | "delete" | "lookup" | "cost";
  success: boolean;
  status?: number;
  usage?: z.infer<typeof speechUsageSchema>;
  generationId?: string;
  actualCost?: number;
}

export type HostedSpeechErrorKind =
  | "invalid_request"
  | "script_too_long"
  | "authentication"
  | "quota"
  | "provider_error"
  | "malformed_response"
  | "missing_voice"
  | "cancelled"
  | "timeout";

export class HostedSpeechError extends Error {
  /**
   * @param providerStatus - Set only when the provider answered, which separates a provider 400 from
   *   the local checks that also throw `invalid_request`.
   */
  constructor(
    readonly kind: HostedSpeechErrorKind,
    readonly providerStatus?: number,
    readonly providerBody?: string,
    options?: ErrorOptions,
  ) {
    super(`Hosted speech failed: ${kind}`, options);
  }

  /** The provider's status and body as logged and shown behind "Show Full Error". */
  get providerDetail(): string | undefined {
    if (this.providerStatus === undefined) return undefined;
    return this.providerBody ? `HTTP ${this.providerStatus}: ${this.providerBody}` : `HTTP ${this.providerStatus}`;
  }
}

/** Provider error bodies can echo the request's credential in a form pattern redaction misses. */
export function speechErrorBody(body: unknown, apiKey: string): string {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return redactLogString(apiKey ? text.replaceAll(apiKey, "[REDACTED]") : text);
}

export function checkSpeechStatus(response: Response, body?: string): void {
  if (response.ok) return;
  const kind =
    response.status === 401 || response.status === 403
      ? "authentication"
      : response.status === 429 || response.status === 402
        ? "quota"
        : response.status === 400 || response.status === 422
          ? "invalid_request"
          : "provider_error";
  throw new HostedSpeechError(kind, response.status, body);
}

export async function readSpeechJson(
  response: Response,
  signal: AbortSignal,
  audioBytes = HOSTED_SPEECH_LIMITS.outputBytes,
): Promise<unknown> {
  const buffer = await readBoundedResponse(
    response,
    Math.ceil(audioBytes / 3) * 4 + HOSTED_SPEECH_LIMITS.metadataBytes,
    signal,
  );
  signal.throwIfAborted();
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new HostedSpeechError("malformed_response");
  }
}

export async function validateSpeechAudio(buffer: Buffer, mime: string, maxBytes: number): Promise<void> {
  if (!buffer.length || buffer.length > maxBytes) throw new HostedSpeechError("malformed_response");
  if (mime === "audio/wav") {
    if (
      buffer.length < 44 ||
      buffer.toString("ascii", 0, 4) !== "RIFF" ||
      buffer.toString("ascii", 8, 12) !== "WAVE" ||
      buffer.readUInt32LE(4) + 8 !== buffer.length
    ) {
      throw new HostedSpeechError("malformed_response");
    }
    let offset = 12;
    let dataBytes = 0;
    while (offset + 8 <= buffer.length) {
      const size = buffer.readUInt32LE(offset + 4);
      if (offset + 8 + size > buffer.length) throw new HostedSpeechError("malformed_response");
      if (buffer.toString("ascii", offset, offset + 4) === "data") dataBytes += size;
      offset += 8 + size + (size % 2);
    }
    if (!dataBytes || offset !== buffer.length) throw new HostedSpeechError("malformed_response");
  } else if (mime === "audio/mpeg") {
    validateMp3Frames(buffer);
  } else {
    throw new HostedSpeechError("malformed_response");
  }
  try {
    const metadata = await parseBuffer(buffer, { mimeType: mime }, { duration: true });
    if (!metadata.format.duration || metadata.format.duration <= 0) {
      throw new HostedSpeechError("malformed_response");
    }
  } catch {
    throw new HostedSpeechError("malformed_response");
  }
}

// music-metadata accepts truncated MPEG frames, so provider audio also needs frame boundary checks.
function validateMp3Frames(buffer: Buffer): void {
  let offset = 0;
  if (buffer.toString("ascii", 0, 3) === "ID3") {
    if (buffer.length < 10 || buffer.subarray(6, 10).some((byte) => byte > 127))
      throw new HostedSpeechError("malformed_response");
    offset = 10 + (buffer[6] * 2 ** 21 + buffer[7] * 2 ** 14 + buffer[8] * 2 ** 7 + buffer[9]);
    if (buffer[3] === 4 && buffer[5] & 0x10) offset += 10;
  }
  const mpeg1Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const mpeg2Bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  let frames = 0;
  while (offset + 4 <= buffer.length) {
    if (buffer.length - offset === 128 && buffer.toString("ascii", offset, offset + 3) === "TAG") {
      offset += 128;
      break;
    }
    const version = (buffer[offset + 1] >> 3) & 3;
    const layer = (buffer[offset + 1] >> 1) & 3;
    const rateIndex = (buffer[offset + 2] >> 2) & 3;
    const bitrateIndex = buffer[offset + 2] >> 4;
    if (
      buffer[offset] !== 255 ||
      (buffer[offset + 1] & 0xe0) !== 0xe0 ||
      version === 1 ||
      layer !== 1 ||
      rateIndex === 3 ||
      bitrateIndex === 0 ||
      bitrateIndex === 15
    )
      throw new HostedSpeechError("malformed_response");
    const rate = [44100, 48000, 32000][rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const bitrate = (version === 3 ? mpeg1Bitrates : mpeg2Bitrates)[bitrateIndex] * 1000;
    const size = Math.floor(((version === 3 ? 144 : 72) * bitrate) / rate) + ((buffer[offset + 2] >> 1) & 1);
    offset += size;
    frames++;
  }
  if (!frames || offset !== buffer.length) throw new HostedSpeechError("malformed_response");
}

export function decodeSpeechAudio(data: string, maxBytes: number): Buffer {
  if (
    !data ||
    data.length > Math.ceil(maxBytes / 3) * 4 ||
    data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  ) {
    throw new HostedSpeechError("malformed_response");
  }
  const buffer = Buffer.from(data, "base64");
  if (buffer.length > maxBytes || buffer.toString("base64") !== data) throw new HostedSpeechError("malformed_response");
  return buffer;
}
