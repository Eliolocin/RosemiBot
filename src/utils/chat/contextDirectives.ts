import type { Message } from "discord.js";
import type { MessageIdMap } from "@/utils/text/messageIdMap";
import type { ChatIncoming } from "@/utils/chat/types";
import { stripBridgePrefix } from "@/utils/bridges";

const QUEUED_REPLY_DIRECTIVE_MAX_CONTENT_LENGTH = 280;
const SUPPORTED_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/mpeg",
  "video/mov",
  "video/avi",
  "video/x-flv",
  "video/mpg",
  "video/webm",
  "video/wmv",
  "video/3gpp",
];

export function normalizeTailDirective(text: string): string {
  let trimmed = text.trim();
  if (!trimmed) return "";
  if (/^\[System:/i.test(trimmed)) {
    trimmed = trimmed.replace(/^\[System:\s*/i, "");
    if (trimmed.endsWith("]")) {
      trimmed = trimmed.slice(0, -1).trim();
    }
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function truncateForSystemContext(text: string, maxLength: number): string {
  const compacted = compactWhitespace(text);
  if (compacted.length <= maxLength) {
    return compacted;
  }
  return `${compacted.slice(0, Math.max(0, maxLength - 3))}...`;
}

function buildQueuedReplyAttachmentSummary(message: Message): string | null {
  let imageCount = 0;
  let videoCount = 0;
  let fileCount = 0;

  for (const attachment of message.attachments.values()) {
    const contentType = attachment.contentType?.toLowerCase() ?? "";
    if (contentType.startsWith("image/")) {
      imageCount++;
      continue;
    }
    if (SUPPORTED_VIDEO_MIME_TYPES.some((type) => contentType.startsWith(type))) {
      videoCount++;
      continue;
    }
    fileCount++;
  }

  const stickerCount = message.stickers.size;
  const parts: string[] = [];
  if (imageCount > 0) {
    parts.push(`${imageCount} image${imageCount === 1 ? "" : "s"}`);
  }
  if (videoCount > 0) {
    parts.push(`${videoCount} video${videoCount === 1 ? "" : "s"}`);
  }
  if (stickerCount > 0) {
    parts.push(`${stickerCount} sticker${stickerCount === 1 ? "" : "s"}`);
  }
  if (fileCount > 0) {
    parts.push(`${fileCount} file${fileCount === 1 ? "" : "s"}`);
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Whether a queued turn is answering its trigger message, which earns it the reply directive
 * and a native Discord reply to that message.
 *
 * Scene turns all share one trigger message, so pointing each of them at it would make every
 * persona answer the same unrelated line. System triggers (welcome, random trigger, reminder,
 * cross-channel task, boomerang) anchor on whatever the channel's latest message happened to be,
 * so answering it would make the model address that author: a queued welcome once pinged the
 * newcomer while replying to someone else's message. The stop response is also system-sourced
 * but genuinely answers the stop message.
 */
export function answersQueuedTriggerMessage(
  incoming: Pick<ChatIncoming, "isFromQueue" | "isStopResponse" | "sceneTurn" | "textQuotaSource">,
): boolean {
  if (!incoming.isFromQueue || incoming.sceneTurn) return false;
  return incoming.isStopResponse === true || incoming.textQuotaSource !== "system";
}

/**
 * Builds the system directive injected on queued turns, telling the model which earlier
 * message it is now answering and how to open its reply.
 *
 * @param message - The queued message being answered
 * @param replyTargetName - Display name of whoever sent that message
 * @param activePersonaName - Nickname of the persona answering
 * @param idMap - Optional opaque message-ID map for LLM-visible references
 * @param allowSpriteLabel - True when the persona-sprite prompt was injected for this same
 *   turn, in which case the directive must also permit the sprite opening form
 */
export function buildQueuedReplyDirective(
  message: Message,
  replyTargetName: string,
  activePersonaName: string | null | undefined,
  idMap?: MessageIdMap,
  allowSpriteLabel = false,
): string {
  const normalizedTargetName = compactWhitespace(stripBridgePrefix(replyTargetName)) || "User";
  const normalizedPersonaName =
    compactWhitespace(stripBridgePrefix(activePersonaName ?? "")) || process.env.DEFAULT_BOTNAME || "Tomori";
  const contentPreview = truncateForSystemContext(
    message.cleanContent || message.content || "",
    QUEUED_REPLY_DIRECTIVE_MAX_CONTENT_LENGTH,
  );
  const attachmentSummary = buildQueuedReplyAttachmentSummary(message);
  const normalizedPreview = contentPreview.replaceAll('"', "'");
  const normalizedPersonaLabel = normalizedPersonaName.replaceAll('"', "'");

  let directive = `Create a reply as ${normalizedPersonaLabel} to ${normalizedTargetName}'s message from earlier (ID: ${idMap?.register(message.id, "ref") ?? message.id})`;
  if (attachmentSummary) {
    directive += `, which has ${attachmentSummary} attached`;
  }
  if (normalizedPreview) {
    directive += ` saying: "${normalizedPreview}"`;
  }

  // The persona-sprite prompt teaches `Name (sprite):` as the opening line format. Anchoring
  // the reply to a bare `Name:` here contradicts it on precisely the turns this directive
  // fires on (queued ones), and models resolve the conflict by dropping the sprite tag :
  // which is why sprites silently stopped working mid-chain. Offer both forms whenever the
  // sprite prompt is present, so neither instruction has to be violated to satisfy the other.
  const openingInstruction = allowSpriteLabel
    ? `Start your next reply with "${normalizedPersonaLabel}:", or with "${normalizedPersonaLabel} ({sprite label}):" if you are using a sprite`
    : `Start your next reply with "${normalizedPersonaLabel}:"`;

  return `${directive}. ${openingInstruction}`;
}
