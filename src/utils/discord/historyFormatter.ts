import { isManagedWebhookMessage } from "@/utils/chat/webhookIdentity";
/**
 * Formats Discord messages into a text representation suitable for LLM fact extraction.
 * Also detects which bot personas participated (via webhook author matching)
 * for the "automatic" scope in /memory history import.
 */

import type { Message } from "discord.js";
import { MessageType } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { isRefreshMarkerEmbed } from "@/utils/discord/embedDetection";
import { isMatrixBridgeWebhookUsername, stripBridgePrefix } from "@/utils/bridges";
import { isAudioAttachment } from "@/utils/audio/audioAttachmentTranscription";
import { getCachedVoiceTranscript } from "@/utils/audio/voiceTranscriptCache";
import { getCachedRenderedMarkdownTable } from "@/utils/text/markdownTableCache";
import { normalizeRenderModifierName, parseRenderModifierWebhookName } from "@/utils/discord/renderModifierParser";

/** Result of formatting messages for extraction */
export interface FormattedHistoryResult {
  /** Formatted dialogue text for the extraction prompt */
  text: string;

  /**
   * Unique persona IDs detected in the batch (for automatic scope): from webhook-authored
   * messages, plus the main persona when the bot posted under its own account.
   */
  detectedPersonaTomoriIds: number[];

  /** Number of messages that made it into the formatted text */
  messageCount: number;
}

/** System message types that should be skipped (joins, boosts, pins, etc.) */
const SKIPPED_MESSAGE_TYPES = new Set([
  MessageType.UserJoin,
  MessageType.GuildBoost,
  MessageType.GuildBoostTier1,
  MessageType.GuildBoostTier2,
  MessageType.GuildBoostTier3,
  MessageType.ChannelPinnedMessage,
  MessageType.RecipientAdd,
  MessageType.RecipientRemove,
  MessageType.Call,
  MessageType.ChannelNameChange,
  MessageType.ChannelIconChange,
  MessageType.ThreadCreated,
  MessageType.ThreadStarterMessage,
  MessageType.GuildInviteReminder,
  MessageType.AutoModerationAction,
]);

/**
 * Resolves Discord mention formats to human-readable names using guild cache.
 *
 * @param content - Raw message content with Discord mention syntax
 * @param msg - The Discord message (for guild access)
 * @returns Content with resolved mentions
 */
function resolveMentions(content: string, msg: Message): string {
  let resolved = content;

  // Resolve user mentions: <@123456> or <@!123456> → @Username
  resolved = resolved.replace(/<@!?(\d+)>/g, (_match, userId: string) => {
    const member = msg.guild?.members.cache.get(userId);
    if (member) return `@${member.displayName}`;
    const user = msg.client.users.cache.get(userId);
    if (user) return `@${user.username}`;
    return `@UnknownUser`;
  });

  // Resolve channel mentions: <#123456> → #channel-name
  resolved = resolved.replace(/<#(\d+)>/g, (_match, channelId: string) => {
    const channel = msg.guild?.channels.cache.get(channelId);
    if (channel) return `#${channel.name}`;
    return `#unknown-channel`;
  });

  // Resolve role mentions: <@&123456> → @RoleName
  resolved = resolved.replace(/<@&(\d+)>/g, (_match, roleId: string) => {
    const role = msg.guild?.roles.cache.get(roleId);
    if (role) return `@${role.name}`;
    return `@unknown-role`;
  });

  return resolved;
}

/**
 * Formats an array of Discord messages into a text representation
 * suitable for LLM fact extraction, and detects which bot personas
 * participated via webhook author name matching.
 *
 * Format per message: `[ISO timestamp] Username: content`
 *
 * Skips:
 * - System messages (joins, boosts, pins)
 * - Empty messages with no content and no attachments
 * - Bot refresh/system embeds
 *
 * Includes:
 * - Bot messages (they contain conversation context)
 * - Attachment indicators: `[Attachment: filename.ext]`
 * - Non-system embed indicators: `[Embed: title]`
 *
 * @param messages - Array of Discord messages in chronological order
 * @param serverPersonas - All personas for the server (for webhook author matching)
 * @param clientUserId - The bot's own user id, so replies it sent directly (rather than
 *        through a persona webhook) can still be attributed to the main persona
 * @returns Formatted text, detected persona IDs, and message count
 */
export function formatMessagesForExtraction(
  messages: Message[],
  serverPersonas: TomoriState[],
  clientUserId?: string,
): FormattedHistoryResult {
  const lines: string[] = [];
  const detectedTomoriIds = new Set<number>();

  const nicknameToTomoriId = new Map<string, number>();
  for (const persona of serverPersonas) {
    if (persona.persona_id !== undefined) {
      nicknameToTomoriId.set(normalizeRenderModifierName(persona.persona_nickname), persona.persona_id);
    }
  }

  // The main (non-alter) persona owns any message the bot account posted itself. Webhook
  // delivery is not guaranteed it is skipped when webhooks are unavailable for the
  // channel so keying detection purely off `webhookId` misses those turns entirely.
  const mainPersonaId = serverPersonas.find((persona) => !persona.is_alter)?.persona_id;

  for (const msg of messages) {
    // Skip system messages
    if (SKIPPED_MESSAGE_TYPES.has(msg.type)) continue;

    let content = msg.content ? resolveMentions(msg.content, msg) : "";
    const cachedRenderedTable = getCachedRenderedMarkdownTable(msg.id);
    if (cachedRenderedTable) {
      content += ` [Rendered markdown table]\n${cachedRenderedTable}`;
    }

    // Append attachment indicators (or cached voice transcript for audio)
    let audioTranscriptAppended = false;
    for (const attachment of msg.attachments.values()) {
      if (cachedRenderedTable) continue;

      if (isAudioAttachment(attachment)) {
        // A cached transcript avoids re-running STT on history audio.
        // "tts" source = Tomori's own voice message; caption text is already
        // included in msg.content (sent alongside the attachment), so we just
        // skip the [Attachment] tag to avoid duplication.
        // "user_stt" source = user-sent audio; inline the transcript so the
        // extraction LLM sees the spoken words rather than just a filename.
        const cached = getCachedVoiceTranscript(msg.id);
        if (cached) {
          if (cached.source === "user_stt" && !audioTranscriptAppended) {
            content += ` [Voice message: ${cached.transcript}]`;
            audioTranscriptAppended = true;
          }
          // Either way, skip the generic [Attachment: ...] tag
          continue;
        }
      }
      content += ` [Attachment: ${attachment.name ?? "file"}]`;
    }

    // Append non-system embed indicators
    for (const embed of msg.embeds) {
      // Skip refresh/system embeds
      if (isRefreshMarkerEmbed(embed)) continue;
      if (embed.title) {
        content += ` [Embed: ${embed.title}]`;
      }
    }

    // Skip empty messages (no content, no attachments, no meaningful embeds)
    content = content.trim();
    if (!content) continue;

    // Format timestamp
    const timestamp = msg.createdAt.toISOString();

    // Determine author name
    //    Strip "[Matrix|@user:host] " prefix from Matrix bridge webhook messages
    //    so TomoriBot sees just the display name (e.g., "Neko Neechan") in context
    const rawAuthorName = msg.member?.displayName ?? msg.author?.username ?? "Unknown";
    const authorName =
      msg.webhookId && !isManagedWebhookMessage(msg) ? rawAuthorName : stripBridgePrefix(rawAuthorName);

    lines.push(`[${timestamp}] ${authorName}: ${content}`);

    // Persona detection: match webhook-authored messages by name.
    //    Decorated names carry the persona in either part: flipped copied
    //    identities ("impersonated (SourcePersona)") put it inside the parens,
    //    legacy decorations ("SourcePersona (modifier)") put it first.
    if (isManagedWebhookMessage(msg) && msg.author) {
      // Matrix bridge messages also arrive as webhooks; a bridged user whose display name
      // happens to match a persona nickname must not register as that persona.
      if (isMatrixBridgeWebhookUsername(msg.author.username)) continue;

      const renderModifierName = parseRenderModifierWebhookName(msg.author.username);
      const authorKeys = renderModifierName
        ? [renderModifierName.modifier, renderModifierName.sourceName]
        : [msg.author.username];
      for (const authorKey of authorKeys) {
        const matchedTomoriId = nicknameToTomoriId.get(normalizeRenderModifierName(authorKey));
        if (matchedTomoriId !== undefined) {
          detectedTomoriIds.add(matchedTomoriId);
          break;
        }
      }
      continue;
    }

    // Non-webhook turns the bot posted under its own account belong to the main persona.
    if (mainPersonaId !== undefined && clientUserId && msg.author?.id === clientUserId) {
      detectedTomoriIds.add(mainPersonaId);
    }
  }

  return {
    text: lines.join("\n"),
    detectedPersonaTomoriIds: [...detectedTomoriIds],
    messageCount: lines.length,
  };
}
