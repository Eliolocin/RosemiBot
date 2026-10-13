/**
 * Shared embed classification and link-preview extraction utilities.
 *
 * The title-only entry point supports historical and Components V2 notices.
 * Full embeds use the persisted marker before falling back to a legacy title.
 */

import type { Embed } from "discord.js";
import { isMessageProxyReplyEmbed } from "@/utils/messageProxy/registry";

import {
  classifyProtocolEmbed,
  classifyProtocolTitle,
  isTargetProtocolKind,
  type TargetEmbedType,
} from "./embedProtocol";

export type TargetEmbedCheck = { isTarget: true; type: TargetEmbedType } | { isTarget: false; type: null };

/**
 * Classifies a title-only notice using the lookup built during locale initialization.
 */
export function checkTargetEmbedTitle(embedTitle: string | null | undefined): TargetEmbedCheck {
  const kind = classifyProtocolTitle(embedTitle);
  return isTargetProtocolKind(kind) ? { isTarget: true, type: kind } : { isTarget: false, type: null };
}

export function checkTargetEmbed(embed: Pick<Embed, "title" | "footer">): TargetEmbedCheck {
  const kind = classifyProtocolEmbed(embed);
  return isTargetProtocolKind(kind) ? { isTarget: true, type: kind } : { isTarget: false, type: null };
}

type LinkPreviewImageInfo = {
  url: string;
  proxyUrl: string;
  mimeType: string | null;
  filename: string;
};

export type LinkPreviewResult = {
  isLinkPreview: boolean;
  textContent: string | null;
  imageInfo: LinkPreviewImageInfo | null;
  thumbnailInfo: LinkPreviewImageInfo | null;
};

/**
 * Extracts text + image content from an auto-generated Discord link preview
 * embed (e.g., Twitter, YouTube, article card). Returns `isLinkPreview: false`
 * for empty embeds or for embeds already classified as bot-produced (per
 * `checkTargetEmbedTitle`).
 *
 * Kept byte-for-byte consistent with `processLinkEmbed` in tomoriChat.ts so
 * snapshot output matches live-chat conversion.
 */
export function processLinkEmbed(embed: Embed): LinkPreviewResult {
  // Skip entirely empty embeds
  const hasContent = embed.url || embed.title || embed.description || embed.author?.name || embed.fields.length > 0;
  if (!hasContent) {
    return { isLinkPreview: false, textContent: null, imageInfo: null, thumbnailInfo: null };
  }

  // Skip bot-produced system embeds because those are handled separately
  const embedCheck = checkTargetEmbed(embed);
  if (embedCheck.isTarget) {
    return { isLinkPreview: false, textContent: null, imageInfo: null, thumbnailInfo: null };
  }

  // A message-proxy reply embed restates a reference the pipeline already annotates
  // from the pre-proxy original, so rendering it would duplicate the notice.
  if (isMessageProxyReplyEmbed(embed)) {
    return { isLinkPreview: false, textContent: null, imageInfo: null, thumbnailInfo: null };
  }

  // Assemble text content from available fields
  const contentParts: string[] = [];
  if (embed.author?.name) contentParts.push(embed.author.name);
  if (embed.title) contentParts.push(embed.title);
  if (embed.description) {
    const maxDescLength = 500;
    contentParts.push(
      embed.description.length > maxDescLength
        ? `${embed.description.substring(0, maxDescLength)}...`
        : embed.description,
    );
  }
  if (embed.fields.length > 0) {
    for (const field of embed.fields) {
      if (field.name || field.value) {
        contentParts.push(field.name && field.value ? `${field.name}: ${field.value}` : field.name || field.value);
      }
    }
  }

  const textContent =
    contentParts.length > 0 ? `[System: Link preview embed content: ${contentParts.join(" - ")}]` : "";

  // Derive image info from embed.image (preferred) or embed.thumbnail (fallback)
  const imageInfo = embed.image?.url ? deriveEmbedImageInfo(embed.image.url, embed.image.proxyURL ?? null) : null;
  const thumbnailInfo =
    !imageInfo && embed.thumbnail?.url
      ? deriveEmbedImageInfo(embed.thumbnail.url, embed.thumbnail.proxyURL ?? null)
      : null;

  return {
    isLinkPreview: true,
    textContent: textContent.trim() || null,
    imageInfo,
    thumbnailInfo,
  };
}

function deriveEmbedImageInfo(rawUrl: string, proxyUrl: string | null): LinkPreviewImageInfo | null {
  try {
    const parsed = new URL(rawUrl);
    let filename = parsed.pathname.split("/").pop() || "embed_image";
    // Strip social-media size suffixes (":large", ":medium", ":small", ":orig")
    filename = filename.replace(/:(large|medium|small|orig)$/, "");

    let mimeType = "image/jpeg";
    const extension = filename.split(".").pop()?.toLowerCase();
    switch (extension) {
      case "png":
        mimeType = "image/png";
        break;
      case "gif":
        mimeType = "image/gif";
        break;
      case "webp":
        mimeType = "image/webp";
        break;
      default:
        mimeType = "image/jpeg";
        break;
    }

    if (!filename.includes(".")) filename = `${filename}.jpg`;

    return {
      url: rawUrl,
      proxyUrl: proxyUrl || rawUrl,
      mimeType,
      filename,
    };
  } catch {
    return null;
  }
}

/**
 * Mirrors `formatSystemProducedEmbedHint` in tomoriChat.ts. Wraps an embed
 * body in the `[System: ...]`-adjacent form that prefixes system-produced
 * embeds before sending to the LLM.
 */
export function formatSystemProducedEmbedHint(embedBody: string): string {
  return `[System: The following content came from a system-produced embed]\n${embedBody}`;
}
