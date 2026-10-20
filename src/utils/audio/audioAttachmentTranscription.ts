import type { Attachment, Message } from "discord.js";
import { safeDownload } from "@/utils/security/safeDownload";
import { getElevenLabsSttConfig, reportElevenLabsFailure } from "@/utils/audio/elevenLabsShared";
import { transcribeViaElevenLabsAdapter } from "@/providers/custom/styles/transcriptionElevenLabsAdapter";
import { transcribeViaOpenAIAdapter } from "@/providers/custom/styles/transcriptionOpenAIAdapter";
import { resolveActiveTranscriptionEndpoint } from "@/utils/provider/speechEndpointResolver";

const AUDIO_EXTENSION_REGEX = /\.(aac|flac|m4a|mp3|mpga|oga|ogg|opus|wav)$/i;

type AudioAttachmentFailureReason =
  | "no_endpoint"
  | "missing_api_key"
  | "download_failed"
  | "stt_failed"
  | "empty_transcript";

export interface AudioAttachmentTranscriptionResult {
  hasAudio: boolean;
  transcriptText: string | null;
  attachmentName: string | null;
  mimeType: string | null;
  failureReason?: AudioAttachmentFailureReason;
  failureDetails?: string;
}

/** Returns true if the attachment is an audio file by MIME type or extension. */
export function isAudioAttachment(attachment: Pick<Attachment, "contentType" | "name">): boolean {
  const mimeType = attachment.contentType?.toLowerCase() ?? "";
  if (mimeType.startsWith("audio/")) {
    return true;
  }
  if (mimeType.startsWith("video/") || mimeType.startsWith("image/")) {
    return false;
  }

  return AUDIO_EXTENSION_REGEX.test(attachment.name ?? "");
}

function getFirstAudioAttachment(message: Message): Attachment | null {
  for (const attachment of message.attachments.values()) {
    if (isAudioAttachment(attachment)) {
      return attachment;
    }
  }

  return null;
}

export async function transcribeMessageAudioAttachment(
  message: Message,
  serverId: number,
): Promise<AudioAttachmentTranscriptionResult> {
  const attachment = getFirstAudioAttachment(message);
  if (!attachment) {
    return {
      hasAudio: false,
      transcriptText: null,
      attachmentName: null,
      mimeType: null,
    };
  }

  // Resolution order:
  // Active transcription endpoint via custom_endpoints.
  // Skip transcription silently if none is configured.
  const transcriptionEndpoint = await resolveActiveTranscriptionEndpoint(serverId);
  if (!transcriptionEndpoint) {
    return {
      hasAudio: true,
      transcriptText: null,
      attachmentName: attachment.name ?? null,
      mimeType: attachment.contentType ?? null,
      failureReason: "no_endpoint",
    };
  }

  const apiKey = transcriptionEndpoint.apiKey;
  const endpointApiStyle = transcriptionEndpoint.endpoint.api_style;
  const requiresApiKey =
    endpointApiStyle === "elevenlabs-transcription" || transcriptionEndpoint.endpoint.requires_auth;

  if (requiresApiKey && !apiKey) {
    return {
      hasAudio: true,
      transcriptText: null,
      attachmentName: attachment.name ?? null,
      mimeType: attachment.contentType ?? null,
      failureReason: "missing_api_key",
    };
  }

  const config = getElevenLabsSttConfig();
  const downloadResult = await safeDownload(attachment.url, {
    maxSizeMB: config.maxSizeMb,
    timeoutMs: config.timeoutMs,
    knownSize: attachment.size,
  });
  if (!downloadResult.success || !downloadResult.buffer) {
    return {
      hasAudio: true,
      transcriptText: null,
      attachmentName: attachment.name ?? null,
      mimeType: attachment.contentType ?? null,
      failureReason: "download_failed",
      failureDetails: downloadResult.details,
    };
  }

  // Route to the appropriate adapter based on api_style of the active endpoint.
  // openai-compatible-transcription covers local WhisperX, whisper.cpp, etc.
  const transcriptionResult =
    endpointApiStyle === "openai-compatible-transcription"
      ? await transcribeViaOpenAIAdapter({
          endpoint: transcriptionEndpoint.endpoint,
          apiKey,
          audioBuffer: downloadResult.buffer,
          filename: attachment.name ?? "audio",
          mimeType: attachment.contentType ?? undefined,
        })
      : await transcribeViaElevenLabsAdapter({
          apiKey,
          audioBuffer: downloadResult.buffer,
          filename: attachment.name ?? "audio",
          mimeType: attachment.contentType ?? undefined,
        });
  if (!transcriptionResult.success) {
    // An unreachable user-run OpenAI-compatible endpoint is an expected refusal, so only hosted ElevenLabs is reported.
    if (endpointApiStyle !== "openai-compatible-transcription") {
      await reportElevenLabsFailure("transcription", transcriptionResult, { serverId });
    }
    return {
      hasAudio: true,
      transcriptText: null,
      attachmentName: attachment.name ?? null,
      mimeType: attachment.contentType ?? null,
      failureReason: "stt_failed",
      failureDetails: transcriptionResult.details,
    };
  }

  if (!transcriptionResult.transcriptText) {
    return {
      hasAudio: true,
      transcriptText: null,
      attachmentName: attachment.name ?? null,
      mimeType: attachment.contentType ?? null,
      failureReason: "empty_transcript",
    };
  }

  return {
    hasAudio: true,
    transcriptText: transcriptionResult.transcriptText,
    attachmentName: attachment.name ?? null,
    mimeType: attachment.contentType ?? null,
  };
}
