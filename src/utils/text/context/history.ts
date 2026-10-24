import { type Activity, ActivityType, type Client, type PresenceStatus } from "discord.js";
import {
  ContextItemTag,
  type ContextPart,
  type MediaDescriptor,
  type StructuredContextItem,
} from "@/types/misc/context";
import type { SimplifiedMessageForContext } from "./types";
import { log } from "@/utils/misc/logger";

export const MEDIA_IMAGE_MESSAGE_LIMIT = (() => {
  const parsed = Number.parseInt(process.env.MEDIA_IMAGE_MESSAGE_LIMIT || "3", 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 3;
})();

export function buildMediaAttributionText(msg: SimplifiedMessageForContext, authorName: string): string {
  const imageCount = msg.imageAttachments.length;
  const videoCount = msg.videoAttachments.length;
  const hasGif = msg.imageAttachments.some((att) => att.mimeType?.includes("gif"));
  const isMixed = imageCount > 0 && videoCount > 0;

  const mediaParts: string[] = [];

  if (imageCount > 0) {
    if (hasGif && imageCount === 1) {
      mediaParts.push("this GIF");
    } else if (hasGif) {
      mediaParts.push(`these ${imageCount} images (including a GIF)`);
    } else if (imageCount === 1) {
      mediaParts.push("this image");
    } else {
      mediaParts.push(`these ${imageCount} images`);
    }
  }

  if (videoCount > 0) {
    if (isMixed) {
      mediaParts.push(videoCount === 1 ? "a video" : `${videoCount} videos`);
    } else {
      mediaParts.push(videoCount === 1 ? "this video" : `these ${videoCount} videos`);
    }
  }

  const mediaDescription = mediaParts.join(" and ") || "this media";
  return `[System: ${authorName} sent ${mediaDescription}]`;
}

function isStickerImageAttachment(attachment: SimplifiedMessageForContext["imageAttachments"][number]): boolean {
  return attachment.proxyUrl.includes("/stickers/") || attachment.url.includes("/stickers/");
}

export function isCountedRenderedImageAttachment(
  attachment: SimplifiedMessageForContext["imageAttachments"][number],
): boolean {
  return !attachment.isEmoji && !isStickerImageAttachment(attachment);
}

export function getRenderedImageMessageIdsWithinWindow(
  simplifiedMessageHistory: SimplifiedMessageForContext[],
  mediaWindowCutoff: number,
): Set<string> {
  const renderedMessageIds = new Set<string>();
  if (MEDIA_IMAGE_MESSAGE_LIMIT <= 0) {
    return renderedMessageIds;
  }

  for (let i = simplifiedMessageHistory.length - 1; i >= 0; i -= 1) {
    if (i < mediaWindowCutoff) {
      break;
    }

    const message = simplifiedMessageHistory[i];
    const hasCountedImages = message.imageAttachments.some(isCountedRenderedImageAttachment);
    if (!hasCountedImages) {
      continue;
    }

    renderedMessageIds.add(message.id);
    if (renderedMessageIds.size >= MEDIA_IMAGE_MESSAGE_LIMIT) {
      break;
    }
  }

  return renderedMessageIds;
}

export function getLastImageOccurrenceIndices(
  simplifiedMessageHistory: SimplifiedMessageForContext[],
  renderedImageMessageIds: Set<string>,
  mediaWindowCutoff: number,
): Map<string, number> {
  const urlToIndices = new Map<string, number[]>();

  for (let i = simplifiedMessageHistory.length - 1; i >= 0; i -= 1) {
    if (i < mediaWindowCutoff) {
      break;
    }

    const message = simplifiedMessageHistory[i];
    if (!renderedImageMessageIds.has(message.id)) {
      continue;
    }

    for (const attachment of message.imageAttachments) {
      if (!isCountedRenderedImageAttachment(attachment)) {
        continue;
      }

      const indices = urlToIndices.get(attachment.proxyUrl);
      if (indices) {
        indices.push(i);
      } else {
        urlToIndices.set(attachment.proxyUrl, [i]);
      }
    }
  }

  const lastOccurrence = new Map<string, number>();
  for (const [url, indices] of urlToIndices) {
    if (indices.length > 1) {
      lastOccurrence.set(url, Math.max(...indices));
    }
  }

  return lastOccurrence;
}

const UTC_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function formatRelativeTime(diffMs: number): string {
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

export function formatTimestampInline(createdAt: number): string {
  const date = new Date(createdAt);
  const diffMs = Math.max(0, Date.now() - createdAt);
  const month = UTC_MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day}, ${year} ${hours}:${minutes} UTC (${formatRelativeTime(diffMs)})`;
}

export function formatMessageTimestamp(createdAt: number): string {
  return `[System: Sent ${formatTimestampInline(createdAt)}]`;
}

export function pushDialogueHistoryContextItem(
  contextItems: StructuredContextItem[],
  role: "user" | "model",
  parts: ContextPart[],
  messageId: string,
  metadataTag?: ContextItemTag,
  sender?: StructuredContextItem["sender"],
  mediaDescriptors?: MediaDescriptor[],
  combinedMessageIds?: string[],
): void {
  if (parts.length === 0 && (!mediaDescriptors || mediaDescriptors.length === 0)) {
    return;
  }

  contextItems.push({
    role,
    parts,
    metadataTag: metadataTag ?? ContextItemTag.DIALOGUE_HISTORY,
    messageId,
    ...(combinedMessageIds && { combinedMessageIds }),
    ...(sender && { sender }),
    ...(mediaDescriptors && mediaDescriptors.length > 0 && { mediaDescriptors }),
  });
}

export async function getUserPresenceDetails(
  client: Client,
  userId: string,
  guildId: string,
  preloadedMember?: import("discord.js").GuildMember | null,
): Promise<string> {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      log.warn(`Guild ${guildId} not found in cache when fetching presence`);
      return "Status unknown";
    }

    // Log raw gateway presences cache before any member fetch, to diagnose
    // whether the Last.fm / RPC activity is in the cache at check time
    const rawPresence = guild.presences.cache.get(userId);
    log.info(
      `Presences cache for ${userId}: status=${rawPresence?.status ?? "none"} activities=[${rawPresence?.activities.map((a) => `${a.type}:${a.name}`).join(", ") ?? "none"}]`,
    );

    let member: import("discord.js").GuildMember | null = null;
    if (preloadedMember && preloadedMember.id === userId) {
      member = preloadedMember;
    } else {
      // force:true fetches fresh member metadata (roles, nickname) via REST,
      // but presence data is gateway-only and comes from guild.presences.cache
      member = await guild.members.fetch({ user: userId }).catch((error) => {
        log.warn(`Failed to fetch member ${userId}: ${error}`);
        return null;
      });
    }

    if (!member) {
      log.warn(`Member ${userId} not found in guild ${guild.name}`);
      return "Offline or status unknown";
    }

    if (!member.presence) {
      log.warn(`No presence data available for ${member.user.username} (${member.id})`);
      return "Offline or status unknown";
    }

    const statusMap: Record<PresenceStatus, string> = {
      online: "Online",
      idle: "Away/Idle",
      dnd: "Do Not Disturb",
      offline: "Offline",
      invisible: "Invisible",
    };

    const status = statusMap[member.presence.status] || "Status unknown";
    let result = status;

    if (member.presence.activities && member.presence.activities.length > 0) {
      const activityDetails = member.presence.activities.map((activity) => {
        // Diagnostic log so we can see exactly what the gateway delivered
        //    (useful for third-party RPC apps like Last.fm whose payload shape changes upstream)
        const largeText = activity.assets?.largeText?.trim() || null;
        const smallText = activity.assets?.smallText?.trim() || null;
        log.info(
          `Activity found for ${member?.user.username}: type=${activity.type} name="${activity.name}" details="${activity.details ?? ""}" state="${activity.state ?? ""}" emoji="${activity.emoji?.name ?? ""}" largeText="${largeText ?? ""}" smallText="${smallText ?? ""}" appId="${activity.applicationId ?? ""}"`,
        );

        return formatPresenceActivity(activity);
      });

      result += ` - ${activityDetails.join(", ")}`;
      log.info(`Final presence string: "${result}"`);
    } else {
      log.info(`User ${member.user.username} has no activities`);
    }

    return result;
  } catch (error) {
    log.error(`Error getting presence for user ${userId}:`, error);
    return "Status unknown";
  }
}

/** One gateway activity as the text the model reads, such as "Playing Elden Ring: Limgrave for 2 hours". */
export function formatPresenceActivity(activity: Activity): string {
  const largeText = activity.assets?.largeText?.trim() || null;
  const smallText = activity.assets?.smallText?.trim() || null;
  const timeSpent = getTimeSpent(activity.timestamps?.start, activity.timestamps?.end);
  const appendAssetText = (base: string): string => {
    const extras: string[] = [];
    if (largeText && !base.includes(largeText)) extras.push(largeText);
    if (smallText && !base.includes(smallText)) extras.push(smallText);
    return extras.length > 0 ? `${base} [${extras.join(" / ")}]` : base;
  };

  switch (activity.type) {
    case ActivityType.Playing: {
      const segments: string[] = [`Playing ${activity.name}`];
      if (activity.details) segments.push(activity.details);
      if (activity.state) segments.push(activity.state);
      return appendAssetText(segments.join(": ")) + timeSpent;
    }
    case ActivityType.Streaming:
      return appendAssetText(`Streaming ${activity.name}`) + timeSpent;
    case ActivityType.Listening:
      if (activity.name === "Spotify" && activity.details && activity.state) {
        return `Listening to ${activity.details} by ${activity.state} on Spotify${timeSpent}`;
      }

      if (activity.details && activity.state) {
        return appendAssetText(`Listening to ${activity.state} - ${activity.details} on ${activity.name}`) + timeSpent;
      }
      return appendAssetText(`Listening to ${activity.name}`) + timeSpent;
    case ActivityType.Watching:
      return appendAssetText(`Watching ${activity.name}`) + timeSpent;
    case ActivityType.Custom: {
      // Custom Status: some RPC clients (e.g. Last.fm) ride this slot with details/assets populated
      const parts: string[] = [];
      if (activity.emoji?.name) parts.push(activity.emoji.name);
      if (activity.state) parts.push(activity.state);
      if (activity.details && !parts.includes(activity.details)) parts.push(activity.details);
      if (largeText && !parts.includes(largeText)) parts.push(largeText);
      if (smallText && !parts.includes(smallText)) parts.push(smallText);
      return parts.length > 0 ? `Custom status: ${parts.join(": ")}` : "Custom status";
    }
    case ActivityType.Competing:
      return appendAssetText(`Competing in ${activity.name}`) + timeSpent;
    default:
      return appendAssetText(activity.name);
  }
}

function getTimeSpent(startTimestamp?: Date | null | number, endTimestamp?: Date | null | number): string {
  if (!startTimestamp) {
    return "";
  }

  const startTime =
    startTimestamp instanceof Date ? startTimestamp.getTime() : typeof startTimestamp === "number" ? startTimestamp : 0;

  if (startTime === 0) {
    return "";
  }

  const now = Date.now();
  const endTime =
    endTimestamp instanceof Date ? endTimestamp.getTime() : typeof endTimestamp === "number" ? endTimestamp : now;

  const timeDiff = endTime - startTime;
  const seconds = Math.floor((timeDiff / 1000) % 60);
  const minutes = Math.floor((timeDiff / (1000 * 60)) % 60);
  const hours = Math.floor(timeDiff / (1000 * 60 * 60));

  let timeSpent = "";

  if (hours > 0) {
    timeSpent += `${hours} hour${hours !== 1 ? "s" : ""}`;
  }

  if (minutes > 0) {
    if (timeSpent) timeSpent += ", ";
    timeSpent += `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }

  if (seconds > 0 && hours === 0) {
    if (timeSpent) timeSpent += ", ";
    timeSpent += `${seconds} second${seconds !== 1 ? "s" : ""}`;
  }

  return timeSpent ? ` for ${timeSpent}` : "";
}
