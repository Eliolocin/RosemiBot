import { verifyMessageWebhook } from "@/utils/chat/webhookIdentity";
/**
 * Matrix Relay Handler
 * Auto-discovered by eventHandler.ts via messageCreate folder scanning.
 *
 * Relays TomoriBot's own messages (main persona + alter persona webhooks) to
 * the linked Matrix room, if one exists for the channel.
 *
 * Each message is sent as the persona's own Matrix virtual user
 * (e.g., @_tomori_lilya:yourdomain.com), so Matrix users see the correct
 * display name and avatar without any text prefix.
 *
 * Exit conditions (checked first to minimize overhead):
 *   - Matrix bridge not configured → immediate return
 *   - Message not from a guild
 *   - Message is NOT from TomoriBot itself (checked via isSelfTriggerMessage)
 *   - Channel has no linked Matrix room
 */

import type { Client, Embed, Message } from "discord.js";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { isSelfTriggerMessage } from "@/utils/chat/triggerProcessor";
import {
  isMatrixConfigured,
  getLinkedMatrixRoom,
  sendToMatrixRoom,
  sendAttachmentToMatrixRoom,
  ensureRoomRelayable,
  getMatrixSettings,
  getMatrixIdForDisplayName,
} from "@/utils/bridges/matrix";
import { log } from "@/utils/misc/logger";
import type { TomoriState } from "@/types/db/schema";
import { resolvePersonaAvatarPublicUrl } from "@/utils/storage/avatarStorage";
import { normalizeRenderModifierName, resolveRenderModifierSourcePersona } from "@/utils/discord/renderModifierParser";
import { safeDownload } from "@/utils/security/safeDownload";

const MATRIX_EMBED_CHUNK_MAX_CHARS = 3500;
const BYTES_PER_MIB = 1024 * 1024;

/**
 * Strip Discord inline markdown from a string for plain-text Matrix relay.
 * Removes **bold**, *italic*, __underline__, ~~strikethrough~~, and `code` spans.
 *
 * @param text - Raw Discord markdown string
 */
function stripDiscordMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1") // **bold**
    .replace(/__(.+?)__/g, "$1") // __underline__
    .replace(/~~(.+?)~~/g, "$1") // ~~strikethrough~~
    .replace(/\*(.+?)\*/g, "$1") // *italic*
    .replace(/`(.+?)`/g, "$1") // `code`
    .trim();
}

/**
 * Append a non-empty text fragment to the embed serialization output.
 */
function pushEmbedTextPart(parts: string[], value: string | null | undefined): void {
  if (!value) return;
  const normalized = stripDiscordMarkdown(value);
  if (!normalized) return;
  parts.push(normalized);
}

/**
 * Append a URL-like fragment once while preserving source order.
 */
function pushEmbedUrlPart(parts: string[], seen: Set<string>, value: string | null | undefined): void {
  if (!value) return;
  const normalized = value.trim();
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  parts.push(normalized);
}

/**
 * Serialize a Discord embed to plain text so Matrix can receive all useful content
 * without relying on per-embed title detection.
 */
function serializeEmbedToText(embed: Embed): string {
  const parts: string[] = [];
  const seenUrls = new Set<string>();

  pushEmbedTextPart(parts, embed.author?.name);
  pushEmbedUrlPart(parts, seenUrls, embed.author?.url);
  pushEmbedTextPart(parts, embed.title);
  pushEmbedUrlPart(parts, seenUrls, embed.url);
  pushEmbedTextPart(parts, embed.description);

  for (const field of embed.fields) {
    const name = stripDiscordMarkdown(field.name ?? "");
    const value = stripDiscordMarkdown(field.value ?? "");
    if (name && value) {
      parts.push(`${name}\n${value}`);
      continue;
    }
    if (name) parts.push(name);
    if (value) parts.push(value);
  }

  pushEmbedUrlPart(parts, seenUrls, embed.image?.url);
  pushEmbedUrlPart(parts, seenUrls, embed.thumbnail?.url);
  pushEmbedUrlPart(parts, seenUrls, embed.video?.url);

  if (embed.timestamp) {
    const parsed = new Date(embed.timestamp);
    parts.push(Number.isNaN(parsed.getTime()) ? embed.timestamp : parsed.toISOString());
  }

  pushEmbedTextPart(parts, embed.footer?.text);
  pushEmbedUrlPart(parts, seenUrls, embed.footer?.iconURL);

  return parts.join("\n\n").trim();
}

/**
 * Split a long text block into newline-aware chunks so each Matrix event stays
 * within the configured per-message size target.
 */
function splitTextIntoChunks(text: string, maxChars: number): string[] {
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let current = "";

  for (const line of text.split("\n")) {
    if (line.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let index = 0; index < line.length; index += maxChars) {
        chunks.push(line.slice(index, index + maxChars));
      }
      continue;
    }

    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    chunks.push(current);
    current = line;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * Escape special HTML characters in a string for safe embedding in HTML attributes
 * or element content (e.g., inside Matrix mention anchor tags).
 *
 * @param text - Raw string that may contain HTML-special characters
 * @returns HTML-safe string with &, <, >, " replaced by their entity equivalents
 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Resolve all mention formats in a Discord message body to proper Matrix equivalents,
 * building both a plain-text `body` and an HTML `formatted_body` in a single pass.
 *
 * Handles two mention formats that appear in TomoriBot's Discord messages:
 *
 *   `<@userId>` / `<@!userId>`: Discord snowflake mentions (already resolved by Discord.js
 *     before matrixRelay.ts sees the message). The guild member's display name is used to
 *     look up a corresponding Matrix ID; if found, rendered as a Matrix mention anchor.
 *     If the user is Discord-only, rendered as plain display name.
 *
 *   `@{name}`: TomoriBot's internal mention format injected by contextBuilder.ts.
 *     Resolved the same way as above using the display name directly.
 *
 * Resolution rules (same for both formats):
 *   - Known Matrix user → `@user:server` (plain) + `<a href="...">` (HTML) + `m.mentions` entry
 *   - Discord/unknown user → display name only (no ping, no anchor tag)
 *
 * @param text    - Raw Discord message content (may contain `<@id>` and/or `@{name}` patterns)
 *          mentions were resolved), and `mentionedIds` (Matrix user IDs for MSC3952 `m.mentions`)
 */
function resolveDiscordTextForMatrix(
  text: string,
  message: Message,
): { body: string; formattedBody: string | undefined; mentionedIds: string[] } {
  // Matches both Discord snowflakes (<@id>, <@!id>) and internal @{name} placeholders
  const pattern = /<@!?(\d+)>|@\{([^}]+)\}/g;

  // Fast path: skip expensive processing when no mention patterns are present
  if (!pattern.test(text)) {
    return { body: text, formattedBody: undefined, mentionedIds: [] };
  }
  pattern.lastIndex = 0;

  const mentionedIds: string[] = [];
  let hasMatrixMentions = false;

  // Build body (plain text) and htmlParts (formatted_body) in a single pass
  // so we traverse the string once regardless of the number of patterns found
  const bodyParts: string[] = [];
  const htmlParts: string[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const literal = text.slice(lastIndex, match.index);
    bodyParts.push(literal);
    htmlParts.push(escapeHtml(literal));
    lastIndex = (match.index ?? 0) + match[0].length;

    const [, snowflake, internalName] = match;

    if (snowflake) {
      const user = message.mentions.users.get(snowflake);
      const displayName =
        message.guild?.members.cache.get(snowflake)?.displayName ?? user?.displayName ?? user?.username ?? snowflake;
      const matrixId = getMatrixIdForDisplayName(displayName);

      if (matrixId) {
        mentionedIds.push(matrixId);
        hasMatrixMentions = true;
        bodyParts.push(matrixId);
        htmlParts.push(`<a href="https://matrix.to/#/${matrixId}">${escapeHtml(displayName)}</a>`);
      } else {
        // Discord-only user, so strip <@id>, keep their display name
        bodyParts.push(displayName);
        htmlParts.push(escapeHtml(displayName));
      }
    } else if (internalName) {
      const matrixId = getMatrixIdForDisplayName(internalName);

      if (matrixId) {
        mentionedIds.push(matrixId);
        hasMatrixMentions = true;
        bodyParts.push(matrixId);
        htmlParts.push(`<a href="https://matrix.to/#/${matrixId}">${escapeHtml(internalName)}</a>`);
      } else {
        // Discord-only or unknown user, so strip @{} wrapper, keep name
        bodyParts.push(internalName);
        htmlParts.push(escapeHtml(internalName));
      }
    }
  }

  const tail = text.slice(lastIndex);
  bodyParts.push(tail);
  htmlParts.push(escapeHtml(tail));

  return {
    body: bodyParts.join(""),
    // Only include formatted_body when at least one Matrix mention anchor was produced;
    // plain name substitutions (Discord-only users) don't require HTML rendering
    formattedBody: hasMatrixMentions ? htmlParts.join("") : undefined,
    mentionedIds,
  };
}

/**
 * Convert a Discord embed to one or more Matrix text payloads.
 * All embed types are relayed by serializing visible content to plain text.
 */
function embedToMatrixTextChunks(embed: Embed): string[] {
  const serialized = serializeEmbedToText(embed);
  if (!serialized) return [];

  const chunks = splitTextIntoChunks(serialized, MATRIX_EMBED_CHUNK_MAX_CHARS);
  if (chunks.length <= 1) return chunks;

  return chunks.map((chunk, index) => `[${index + 1}/${chunks.length}]\n${chunk}`);
}

/**
 * Handler function auto-discovered and invoked by eventHandler.ts on each messageCreate event.
 * Relays TomoriBot's responses to the linked Matrix room (if any).
 *
 */
const handler = async (client: Client, message: Message): Promise<void> => {
  // Fast exit: skip if Matrix bridge is not configured (common case)
  if (!isMatrixConfigured()) return;

  // Only process guild messages (Matrix bridge is server-scoped)
  if (!message.guild) return;

  // Only relay messages that originate from TomoriBot itself
  //    (main persona bot account OR alter persona webhook messages)
  const allPersonas: TomoriState[] = await getCachedAllPersonas(message.guild.id);
  await verifyMessageWebhook(message);
  if (!isSelfTriggerMessage(message, allPersonas)) return;

  const roomId = await getLinkedMatrixRoom(message.channelId);
  if (!roomId) return;
  if (!(await ensureRoomRelayable(roomId, client))) return;

  // Identify which persona sent this message and retrieve its avatar URL.
  //    The persona's virtual Matrix user will be provisioned with this identity.
  let persona: TomoriState | undefined;
  let avatarUrl: string | null;

  if (message.author.id === client.user?.id) {
    persona = allPersonas.find((p) => !p.is_alter);

    // The main persona sends as the bot account, not a webhook, so webhook_avatar_url
    // is not set. Prefer the guild member avatar (set via /server avatar or persona swap),
    // which is per-server and overrides the global Developer Portal avatar.
    // GuildMember.displayAvatarURL() handles the priority chain automatically:
    // guild avatar → global avatar.
    avatarUrl =
      message.guild?.members.me?.displayAvatarURL({
        size: 256,
        extension: "png",
      }) ?? message.author.displayAvatarURL({ size: 256, extension: "png" });
  } else {
    const personaByNickname = new Map(allPersonas.map((p) => [normalizeRenderModifierName(p.persona_nickname), p]));
    persona =
      resolveRenderModifierSourcePersona(message.author.username, personaByNickname)?.persona ??
      personaByNickname.get(normalizeRenderModifierName(message.author.username));

    // Warn if no persona matched, because the fallback uses the webhook username as the
    // virtual user localpart, which may create an orphaned Matrix user
    if (!persona) {
      log.warn(
        `Matrix relay: no persona found for alter webhook "${message.author.username}" ` +
          `— using webhook username as Matrix virtual user fallback`,
      );
    }

    avatarUrl = resolvePersonaAvatarPublicUrl(persona?.webhook_avatar_url) ?? null;
  }

  const personaName = persona?.persona_nickname ?? message.author.username;

  // Identity is conveyed by the virtual Matrix user, so no bold prefix needed.
  // @{name} placeholders are transformed to proper Matrix mention links so
  // Matrix clients highlight and notify the mentioned user (MSC3952).
  const rawText = message.content.trim();
  if (rawText) {
    const { body, formattedBody, mentionedIds } = resolveDiscordTextForMatrix(rawText, message);
    try {
      await sendToMatrixRoom(
        roomId,
        body,
        personaName,
        avatarUrl,
        formattedBody,
        mentionedIds.length > 0 ? mentionedIds : undefined,
      );
    } catch (error) {
      log.warn(`Matrix relay: failed to relay message to room ${roomId}`, error);
    }
  }

  // proxyURL avoids the expiry that signed CDN URLs hit.
  const { maxAttachmentBytes, mediaTimeoutMs } = getMatrixSettings();

  for (const attachment of message.attachments.values()) {
    if (attachment.size > maxAttachmentBytes) {
      log.warn(
        `Matrix relay: skipping oversized attachment "${attachment.name}" ` +
          `(${(attachment.size / (1024 * 1024)).toFixed(1)} MB) for room ${roomId}`,
      );
      continue;
    }

    try {
      const download = await safeDownload(attachment.proxyURL, {
        maxSizeMB: maxAttachmentBytes / BYTES_PER_MIB,
        timeoutMs: mediaTimeoutMs,
        knownSize: attachment.size,
      });
      if (!download.success || !download.buffer) {
        log.warn(`Matrix relay: failed to fetch attachment "${attachment.name}" (${download.error ?? "unknown"})`);
        continue;
      }

      const mimeType = attachment.contentType ?? "application/octet-stream";
      const filename = attachment.name ?? "attachment";

      await sendAttachmentToMatrixRoom(
        roomId,
        download.buffer,
        filename,
        mimeType,
        attachment.size,
        personaName,
        avatarUrl,
      );
    } catch (error) {
      log.warn(`Matrix relay: failed to relay attachment "${attachment.name}" to room ${roomId}`, error);
    }
  }

  // Relay all embeds by serializing visible content (title/description/fields/urls)
  //    into plain text Matrix messages. This avoids per-embed whitelists and prevents
  //    silent drops when new embed shapes are introduced.
  for (const embed of message.embeds) {
    const chunks = embedToMatrixTextChunks(embed);
    if (chunks.length === 0) continue;

    for (const [chunkIndex, chunk] of chunks.entries()) {
      const { body, formattedBody, mentionedIds } = resolveDiscordTextForMatrix(chunk, message);
      try {
        await sendToMatrixRoom(
          roomId,
          body,
          personaName,
          avatarUrl,
          formattedBody,
          mentionedIds.length > 0 ? mentionedIds : undefined,
        );
      } catch (error) {
        log.warn(
          `Matrix relay: failed to relay embed chunk ${chunkIndex + 1}/${chunks.length} to room ${roomId}`,
          error,
        );
      }
    }
  }
};

export default handler;
