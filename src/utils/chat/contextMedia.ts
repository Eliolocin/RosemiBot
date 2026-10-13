import type { Attachment, Embed, Message } from "discord.js";
import { ComponentType, MessageReferenceType } from "discord.js";
import { getCachedVoiceTranscript } from "@/utils/audio/voiceTranscriptCache";
import { isAudioAttachment } from "@/utils/audio/audioAttachmentTranscription";
import type { SimplifiedMessageForContext } from "@/utils/text/contextBuilder";
import { getCachedRenderedMarkdownTable } from "@/utils/text/markdownTableCache";
import { YOUTUBE_URL_PATTERNS } from "@/utils/text/youTubeUrlCleaner";
import type { MessageIdMap } from "@/utils/text/messageIdMap";
import { formatInlineSystemContent } from "@/utils/chat/contextAnnotations";
import { processEmbedsFromMessage } from "@/utils/chat/contextEmbeds";
import { resolveForwardChain } from "@/utils/discord/forwardChain";

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

function buildEmojiCdnUrl(emojiId: string): string {
  return `https://cdn.discordapp.com/emojis/${emojiId}.png`;
}

export function extractEmojiImageAttachments(content: string): SimplifiedMessageForContext["imageAttachments"] {
  const attachments: SimplifiedMessageForContext["imageAttachments"] = [];
  if (!content) return attachments;

  const emojiPattern = /<(a?):([^:]+):(\d{17,20})>/g;
  const seenEmojiIds = new Set<string>();
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: Regex exec loop mirrors the pre-drain helper.
  while ((match = emojiPattern.exec(content)) !== null) {
    const emojiName = match[2];
    const emojiId = match[3];

    if (seenEmojiIds.has(emojiId)) {
      continue;
    }

    seenEmojiIds.add(emojiId);
    const emojiUrl = buildEmojiCdnUrl(emojiId);

    attachments.push({
      url: emojiUrl,
      proxyUrl: emojiUrl,
      mimeType: "image/png",
      filename: `emoji_${emojiName}_${emojiId}.png`,
      isEmoji: true,
    });
  }

  return attachments;
}

export function isSupportedImageAttachmentContentType(contentType: string | null | undefined): boolean {
  return (
    contentType?.startsWith("image/png") ||
    contentType?.startsWith("image/jpeg") ||
    contentType?.startsWith("image/webp") ||
    contentType?.startsWith("image/heic") ||
    contentType?.startsWith("image/heif") ||
    contentType?.startsWith("image/gif") ||
    false
  );
}

export function isSupportedVideoAttachmentContentType(contentType: string | null | undefined): boolean {
  return Boolean(contentType && SUPPORTED_VIDEO_MIME_TYPES.some((type) => contentType.startsWith(type)));
}

function inferMimeTypeFromFilename(filename: string | null | undefined): string | null {
  const lower = (filename ?? "").split(/[?#]/, 1)[0].toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/mov";
  return null;
}

export function getEffectiveAttachmentContentType(attachment: Pick<Attachment, "contentType" | "name">): string | null {
  return attachment.contentType ?? inferMimeTypeFromFilename(attachment.name);
}

type ComponentMediaCandidate = {
  url: string;
  proxyUrl?: string;
  contentType?: string | null;
  attachmentId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toComponentRecord(component: unknown): Record<string, unknown> | null {
  if (!isRecord(component)) return null;

  const toJson = component.toJSON;
  if (typeof toJson === "function") {
    const json = toJson.call(component);
    if (isRecord(json)) return json;
  }

  return component;
}

function getStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function collectMediaCandidatesFromComponent(component: unknown, candidates: ComponentMediaCandidate[]): void {
  const data = toComponentRecord(component);
  if (!data) return;

  const type = data.type;
  if (type === ComponentType.MediaGallery && Array.isArray(data.items)) {
    for (const item of data.items) {
      if (!isRecord(item) || !isRecord(item.media)) continue;
      pushMediaCandidate(item.media, candidates);
    }
  }

  if ((type === ComponentType.Thumbnail || type === ComponentType.File) && isRecord(data.media)) {
    pushMediaCandidate(data.media, candidates);
  }

  if (type === ComponentType.File && isRecord(data.file)) {
    pushMediaCandidate(data.file, candidates);
  }

  if (type === ComponentType.Section && isRecord(data.accessory)) {
    collectMediaCandidatesFromComponent(data.accessory, candidates);
  }

  if (Array.isArray(data.components)) {
    for (const child of data.components) {
      collectMediaCandidatesFromComponent(child, candidates);
    }
  }
}

function pushMediaCandidate(media: Record<string, unknown>, candidates: ComponentMediaCandidate[]): void {
  const url = getStringField(media, "url");
  if (!url) return;

  candidates.push({
    url,
    proxyUrl: getStringField(media, "proxy_url"),
    contentType: typeof media.content_type === "string" || media.content_type === null ? media.content_type : undefined,
    attachmentId: getStringField(media, "attachment_id"),
  });
}

function getAttachmentFilenameFromUrl(url: string): string | null {
  if (url.startsWith("attachment://")) {
    return decodeURIComponent(url.slice("attachment://".length));
  }

  try {
    const parsed = new URL(url);
    const filename = parsed.pathname.split("/").filter(Boolean).pop();
    return filename ? decodeURIComponent(filename) : null;
  } catch {
    const fallback = url.split(/[/?#]/).filter(Boolean).pop();
    return fallback ? decodeURIComponent(fallback) : null;
  }
}

function resolveComponentMediaUrl(
  message: Pick<Message, "attachments">,
  candidate: ComponentMediaCandidate,
): {
  url: string;
  proxyUrl: string;
  mimeType: string | null;
  filename: string;
} | null {
  const attachmentFilename = getAttachmentFilenameFromUrl(candidate.url);
  const attachment = message.attachments.find(
    (item) =>
      (candidate.attachmentId && item.id === candidate.attachmentId) ||
      (attachmentFilename !== null && item.name === attachmentFilename),
  );

  const rawUrlIsFetchable = candidate.url.startsWith("http://") || candidate.url.startsWith("https://");
  const proxyUrlIsFetchable =
    typeof candidate.proxyUrl === "string" &&
    (candidate.proxyUrl.startsWith("http://") || candidate.proxyUrl.startsWith("https://"));
  const fetchableProxyUrl = proxyUrlIsFetchable ? candidate.proxyUrl : undefined;
  const url = attachment?.url ?? (rawUrlIsFetchable ? candidate.url : (fetchableProxyUrl ?? null));
  if (!url) return null;

  const proxyUrl = attachment?.proxyURL ?? fetchableProxyUrl ?? url;
  const filename = attachment?.name ?? attachmentFilename ?? "media";
  const mimeType =
    candidate.contentType ??
    (attachment ? getEffectiveAttachmentContentType(attachment) : null) ??
    inferMimeTypeFromFilename(filename) ??
    inferMimeTypeFromFilename(url);

  return { url, proxyUrl, mimeType, filename };
}

function hasExistingMediaAttachment(
  attachments: Array<{ url: string; proxyUrl: string }>,
  url: string,
  proxyUrl: string,
): boolean {
  return attachments.some(
    (attachment) =>
      attachment.url === url ||
      attachment.proxyUrl === url ||
      attachment.url === proxyUrl ||
      attachment.proxyUrl === proxyUrl,
  );
}

export function appendSupportedMediaFromMessage(
  sourceMessage: Pick<Message, "attachments">,
  imageAttachments: SimplifiedMessageForContext["imageAttachments"],
  videoAttachments: SimplifiedMessageForContext["videoAttachments"],
): { imageCount: number; videoCount: number } {
  let imageCount = 0;
  let videoCount = 0;

  for (const attachment of sourceMessage.attachments.values()) {
    // Some Discord message types (e.g. IsComponentsV2) may omit contentType in the
    // API response. Fall back to filename-based inference so attachments aren't
    // silently dropped, which would cause the whole message to be skipped.
    const effectiveContentType = getEffectiveAttachmentContentType(attachment);

    if (isSupportedImageAttachmentContentType(effectiveContentType)) {
      imageAttachments.push({
        url: attachment.url,
        proxyUrl: attachment.proxyURL,
        mimeType: effectiveContentType,
        filename: attachment.name,
      });
      imageCount++;
      continue;
    }

    if (isSupportedVideoAttachmentContentType(effectiveContentType)) {
      videoAttachments.push({
        url: attachment.url,
        proxyUrl: attachment.proxyURL,
        mimeType: effectiveContentType,
        filename: attachment.name,
        isYouTubeLink: false,
      });
      videoCount++;
    }
  }

  return { imageCount, videoCount };
}

export function appendComponentMediaFromMessage(
  sourceMessage: Pick<Message, "attachments" | "components">,
  imageAttachments: SimplifiedMessageForContext["imageAttachments"],
  videoAttachments: SimplifiedMessageForContext["videoAttachments"],
): { imageCount: number; videoCount: number } {
  let imageCount = 0;
  let videoCount = 0;
  const candidates: ComponentMediaCandidate[] = [];

  for (const component of sourceMessage.components) {
    collectMediaCandidatesFromComponent(component, candidates);
  }

  for (const candidate of candidates) {
    const resolved = resolveComponentMediaUrl(sourceMessage, candidate);
    if (!resolved?.mimeType) continue;

    if (isSupportedImageAttachmentContentType(resolved.mimeType)) {
      if (hasExistingMediaAttachment(imageAttachments, resolved.url, resolved.proxyUrl)) continue;
      imageAttachments.push({
        url: resolved.url,
        proxyUrl: resolved.proxyUrl,
        mimeType: resolved.mimeType,
        filename: resolved.filename,
      });
      imageCount++;
      continue;
    }

    if (isSupportedVideoAttachmentContentType(resolved.mimeType)) {
      if (hasExistingMediaAttachment(videoAttachments, resolved.url, resolved.proxyUrl)) continue;
      videoAttachments.push({
        url: resolved.url,
        proxyUrl: resolved.proxyUrl,
        mimeType: resolved.mimeType,
        filename: resolved.filename,
        isYouTubeLink: false,
      });
      videoCount++;
    }
  }

  return { imageCount, videoCount };
}

/** Anything that is not image, video, or audio media falls to `read_file`, which rejects what it cannot parse. */
function isDocumentAttachment(attachment: Attachment): boolean {
  const effectiveContentType = getEffectiveAttachmentContentType(attachment);
  return (
    !isSupportedImageAttachmentContentType(effectiveContentType) &&
    !isSupportedVideoAttachmentContentType(effectiveContentType) &&
    !isAudioAttachment(attachment)
  );
}

export function appendDocumentAttachmentsFromMessage(
  message: Pick<Message, "attachments">,
  documentAttachments: NonNullable<SimplifiedMessageForContext["documentAttachments"]>,
  sourceMessageId?: string,
): void {
  for (const attachment of message.attachments.values()) {
    if (!isDocumentAttachment(attachment)) continue;
    documentAttachments.push({ filename: attachment.name ?? "file", ...(sourceMessageId && { sourceMessageId }) });
  }
}

function formatAudioAttachmentHint(filename: string): string {
  return `[System: An audio file named \`${filename}\` was sent here but was not transcribed.]`;
}

export function appendStickersFromMessage(
  message: Pick<Message, "stickers">,
  imageAttachments: SimplifiedMessageForContext["imageAttachments"],
): number {
  let stickerCount = 0;
  for (const sticker of message.stickers.values()) {
    const stickerUrl = `https://cdn.discordapp.com/stickers/${sticker.id}.png`;
    imageAttachments.push({
      url: stickerUrl,
      proxyUrl: stickerUrl,
      mimeType: "image/png",
      filename: `${sticker.name}.png`,
    });
    stickerCount++;
  }
  return stickerCount;
}

type ForwardedMessageSnapshot = {
  channelId?: string | null;
  content?: string | null;
  attachments: Message["attachments"];
  components?: Message["components"];
  embeds: readonly Embed[];
  author: Message["author"] | null;
  member: Message["member"] | null;
};

/**
 * Render a forwarded message into context text and harvest its media.
 *
 * Resolves nested forwards first (see {@link resolveForwardChain}), so a forward of a
 * forward still yields the original's text and attachments instead of an empty block.
 *
 * @param args - Wrapper message, in-progress context content, and media collectors
 */
export async function buildForwardContext(args: {
  message: Message;
  content: string;
  imageAttachments: SimplifiedMessageForContext["imageAttachments"];
  videoAttachments: SimplifiedMessageForContext["videoAttachments"];
  messageIdMap: MessageIdMap;
  forwarderName: string;
  clientUserId: string | undefined;
  tomoriNickname: string | null | undefined;
  selfDebugEnabled: boolean;
}): Promise<{
  content: string;
  mediaSourceMessageIds: string[];
  remoteMediaSourceKind?: SimplifiedMessageForContext["remoteMediaSourceKind"];
}> {
  if (args.message.reference?.type !== MessageReferenceType.Forward || args.message.messageSnapshots.size === 0) {
    return { content: args.content, mediaSourceMessageIds: [] };
  }

  // Chase forwards-of-forwards: Discord flattens nested snapshots to nothing, so an
  // unresolved chain must say so explicitly. Staying silent leaves the model asserting
  // a forward it cannot see, which invites it to invent a media ID.
  const chain = await resolveForwardChain(args.message);
  if (chain.unresolved) {
    return {
      content: `[System: ${args.forwarderName} forwarded a message that was itself a forward. Discord does not include the original message's contents in a nested forward, so its text and any attached media cannot be seen.]${args.content ? `\n${args.content}` : ""}`,
      mediaSourceMessageIds: [],
    };
  }

  const blocks: string[] = [];
  const mediaSourceMessageIds: string[] = [];
  let remoteMediaSourceKind: SimplifiedMessageForContext["remoteMediaSourceKind"];
  for (const rawSnapshot of chain.snapshots) {
    const snapshot = rawSnapshot as ForwardedMessageSnapshot;
    const preForwardImageCount = args.imageAttachments.length;
    const preForwardVideoCount = args.videoAttachments.length;
    const forwardedTextSegments: string[] = [];

    if (snapshot.content?.trim()) {
      forwardedTextSegments.push(snapshot.content.trim());
    }

    appendSupportedMediaFromMessage(snapshot, args.imageAttachments, args.videoAttachments);
    if (snapshot.components) {
      appendComponentMediaFromMessage(
        { attachments: snapshot.attachments, components: snapshot.components },
        args.imageAttachments,
        args.videoAttachments,
      );
    }
    if (snapshot.content) {
      args.imageAttachments.push(...extractEmojiImageAttachments(snapshot.content));
    }

    const isForwardedTomoriAuthoredMessage = snapshot.author?.id === args.clientUserId;
    const embedResult = processEmbedsFromMessage({
      embeds: snapshot.embeds,
      components: snapshot.components,
      content: forwardedTextSegments.join("\n"),
      imageAttachments: args.imageAttachments,
      isTomoriAuthoredMessage: isForwardedTomoriAuthoredMessage,
      selfDebugEnabled: args.selfDebugEnabled,
      tomoriNickname: args.tomoriNickname,
    });
    if (embedResult.content) {
      forwardedTextSegments.splice(0, forwardedTextSegments.length, embedResult.content);
    }

    const imageCount = args.imageAttachments.length - preForwardImageCount;
    const videoCount = args.videoAttachments.length - preForwardVideoCount;
    let attachmentInfo = "";
    if (imageCount > 0) {
      attachmentInfo += ` (with ${imageCount} image${imageCount > 1 ? "s" : ""})`;
    }
    if (videoCount > 0) {
      attachmentInfo += ` (with ${videoCount} video${videoCount > 1 ? "s" : ""})`;
    }

    const forwardedSourceChannel = snapshot.channelId ? `<#${snapshot.channelId}>` : "another channel";
    const authorName = formatForwardedAuthorName(snapshot, args.tomoriNickname || "Bot", args.clientUserId);
    const forwardedContent = formatInlineSystemContent(forwardedTextSegments.join("\n"));
    blocks.push(
      `[System: ${args.forwarderName} forwarded a message by ${authorName} from ${forwardedSourceChannel} saying: ${forwardedContent}${attachmentInfo}]`,
    );

    if (args.imageAttachments.length > preForwardImageCount || args.videoAttachments.length > preForwardVideoCount) {
      // Register the WRAPPER message id, not the original's: the original message
      // lives in the source channel, so tools resolving media IDs against the
      // current channel could never fetch it. The wrapper resolves in-channel and
      // carries the same media inside its messageSnapshots.
      if (!mediaSourceMessageIds.includes(args.message.id)) {
        mediaSourceMessageIds.push(args.message.id);
      }
      remoteMediaSourceKind = "forwarded";
      args.messageIdMap.register(args.message.id, "media");
    }
  }

  return {
    content: blocks.length > 0 ? `${blocks.join("\n")}${args.content ? `\n${args.content}` : ""}` : args.content,
    mediaSourceMessageIds,
    remoteMediaSourceKind,
  };
}

export function appendDirectMediaFromMessage(args: {
  message: Message;
  imageAttachments: SimplifiedMessageForContext["imageAttachments"];
  videoAttachments: SimplifiedMessageForContext["videoAttachments"];
  documentAttachments: NonNullable<SimplifiedMessageForContext["documentAttachments"]>;
  voiceTranscriptChatMode: boolean;
  appendTextHint: (hint: string) => void;
}): void {
  const cachedRenderedTable = getCachedRenderedMarkdownTable(args.message.id);
  if (cachedRenderedTable) {
    args.appendTextHint(`[System: This was sent as a rendered markdown table image.]\n${cachedRenderedTable}`);
    return;
  }

  appendSupportedMediaFromMessage(args.message, args.imageAttachments, args.videoAttachments);
  appendComponentMediaFromMessage(args.message, args.imageAttachments, args.videoAttachments);
  appendDocumentAttachmentsFromMessage(args.message, args.documentAttachments);
  if (args.voiceTranscriptChatMode) return;
  for (const attachment of args.message.attachments.values()) {
    if (!isAudioAttachment(attachment)) continue;
    const effectiveContentType = getEffectiveAttachmentContentType(attachment);
    if (
      isSupportedImageAttachmentContentType(effectiveContentType) ||
      isSupportedVideoAttachmentContentType(effectiveContentType)
    ) {
      continue;
    }
    const cached = getCachedVoiceTranscript(args.message.id);
    args.appendTextHint(
      cached?.source === "user_stt"
        ? `[System: This was sent as a voice message.]\n${cached.transcript}`
        : formatAudioAttachmentHint(attachment.name ?? "audio"),
    );
  }
}

function formatForwardedAuthorName(
  forwardedMessage: Pick<ForwardedMessageSnapshot, "author" | "member">,
  tomoriNickname: string,
  clientUserId: string | undefined,
): string {
  if (clientUserId && forwardedMessage.author?.id === clientUserId) {
    return tomoriNickname;
  }

  return (
    forwardedMessage.member?.displayName ??
    forwardedMessage.author?.globalName ??
    forwardedMessage.author?.username ??
    "Unknown user"
  );
}

export function appendYouTubeVideosFromContent(
  content: string,
  videoAttachments: SimplifiedMessageForContext["videoAttachments"],
): void {
  for (const pattern of YOUTUBE_URL_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(content);
    pattern.lastIndex = 0;
    if (!match) {
      continue;
    }
    const youtubeUrl = match[0];
    const videoId = match[1];
    videoAttachments.push({
      url: youtubeUrl,
      proxyUrl: youtubeUrl,
      mimeType: "video/youtube",
      filename: `youtube_video_${videoId}.mp4`,
      isYouTubeLink: true,
    });
    return;
  }
}
