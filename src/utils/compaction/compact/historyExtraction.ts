import type { Embed, TextBasedChannel } from "discord.js";
import { PrivacyLevel } from "@/types/db/schema";
import { getCachedBlacklistStatus, getCachedPrivacyLevel } from "@/utils/cache/userCache";
import { extractNoticeTextFromComponents } from "@/utils/discord/componentNoticeReader";
import { MAX_MESSAGE_FETCH_LIMIT } from "@/utils/discord/messageFetchLimit";
import { classifyProtocolEmbed, classifyProtocolTitle, isMinimalTitleKind } from "@/utils/discord/embedProtocol";
import { resolveMinimalNoticeBodies } from "@/utils/discord/minimalNoticeBodies";
import type { ConversationContext, ImageReference } from "./types";

export async function buildConversationContext(
  channel: TextBasedChannel,
  includeImages: boolean,
): Promise<ConversationContext> {
  const fetchedMessages = await channel.messages.fetch({ limit: MAX_MESSAGE_FETCH_LIMIT });
  const messagesArray = Array.from(fetchedMessages.values()).reverse();
  const resetIndex = findLastResetIndex(messagesArray);
  const relevantMessages = messagesArray.slice(resetIndex === -1 ? 0 : resetIndex + 1);
  const minimalNoticeBodies = await resolveMinimalNoticeBodies(relevantMessages);
  const conversationLines: string[] = [];
  const imageReferences: ImageReference[] = [];
  const userIdSet = new Set<string>();
  let imageCounter = 1;
  const guildId = "guildId" in channel ? channel.guildId : null;

  for (const msg of relevantMessages) {
    const authorPrivacyLevel = await getCachedPrivacyLevel(msg.author.id);
    if (authorPrivacyLevel === PrivacyLevel.FULL) continue;
    if (guildId && !msg.author.bot && (await getCachedBlacklistStatus(guildId, msg.author.id))) continue;

    userIdSet.add(msg.author.id);
    const authorName = msg.member?.displayName || msg.author.username;
    let messageContent = msg.content?.trim() || "";

    for (const embed of msg.embeds) {
      messageContent = appendEmbedContent(
        messageContent,
        { title: embed.title, description: embed.description },
        classifyProtocolEmbed(embed),
      );
    }

    // Components V2 notices (memory-learning, scheduled-task) carry no embeds,
    // so their text has to be reconstructed from the component tree or they are
    // silently dropped from the compaction summary.
    const notice = extractNoticeTextFromComponents(msg.components);
    if (notice) {
      messageContent = appendEmbedContent(messageContent, {
        title: notice.title,
        description: notice.description ?? minimalNoticeBodies.get(msg.id) ?? null,
      });
    }

    const messageImages: ImageReference[] = [];
    if (includeImages) {
      for (const attachment of msg.attachments.values()) {
        if (!attachment.contentType?.startsWith("image/")) continue;
        messageImages.push({
          label: `Image ${imageCounter++}`,
          url: attachment.url,
          mimeType: attachment.contentType ?? undefined,
          source: `${authorName} attachment${attachment.name ? ` (${attachment.name})` : ""}`,
        });
      }

      for (const emoji of extractCustomEmojiImages(msg.content || "")) {
        messageImages.push({
          label: `Image ${imageCounter++}`,
          url: emoji.url,
          mimeType: "image/png",
          source: `${authorName} emoji (${emoji.name})`,
        });
      }

      for (const sticker of msg.stickers.values()) {
        messageImages.push({
          label: `Image ${imageCounter++}`,
          url: `https://cdn.discordapp.com/stickers/${sticker.id}.png`,
          mimeType: "image/png",
          source: `${authorName} sticker (${sticker.name})`,
        });
      }
    }

    const labels = messageImages.map((img) => img.label).join(", ");
    const line =
      messageImages.length > 0 ? `${messageContent || "(no text)"} [${labels}]` : messageContent || "(no text)";
    imageReferences.push(...messageImages);
    conversationLines.push(`${authorName}: ${line}`);
  }

  return {
    conversationText: conversationLines.join("\n"),
    imageReferences,
    userIds: Array.from(userIdSet),
  };
}

function findLastResetIndex(messagesArray: Array<{ embeds: Embed[] }>): number {
  for (let index = messagesArray.length - 1; index >= 0; index--) {
    if (
      messagesArray[index].embeds.some((embed) => {
        const kind = classifyProtocolEmbed(embed);
        return kind === "reset" || kind === "compact_refresh";
      })
    ) {
      return index;
    }
  }
  return -1;
}

function extractCustomEmojiImages(content: string): Array<{ url: string; name: string }> {
  const results: Array<{ url: string; name: string }> = [];
  const emojiPattern = /<(a?):([^:]+):(\d{17,20})>/g;
  const seenEmojiIds = new Set<string>();
  let match = emojiPattern.exec(content);
  while (match !== null) {
    const emojiName = match[2];
    const emojiId = match[3];
    if (!seenEmojiIds.has(emojiId)) {
      seenEmojiIds.add(emojiId);
      results.push({
        url: `https://cdn.discordapp.com/emojis/${emojiId}.png`,
        name: emojiName,
      });
    }
    match = emojiPattern.exec(content);
  }

  return results;
}

/**
 * Appends a classified system notice to the conversation line being built.
 *
 * Accepts a transport-agnostic {title, description} pair so real embeds and
 * Components V2 notices reconstructed by `extractNoticeTextFromComponents`
 * produce identical compaction input.
 *
 * @param baseContent - The message text accumulated so far.
 * @returns `baseContent` with the notice appended, or unchanged when the notice
 *          is not one of the classified system types.
 */
function appendEmbedContent(
  baseContent: string,
  source: { title: string | null; description: string | null },
  kind = classifyProtocolTitle(source.title),
): string {
  if (!source.title) return baseContent;

  if (
    kind !== "system_injection" &&
    kind !== "compact_summary" &&
    kind !== "compact_refresh" &&
    kind !== "memory_learning" &&
    kind !== "reminder_set"
  ) {
    return baseContent;
  }

  const description = source.description?.trim() ?? "";
  if (!description && !isMinimalTitleKind(kind)) return baseContent;

  const titledBody = [source.title, description].filter((part) => part.length > 0).join("\n");
  const systemContent =
    kind === "memory_learning"
      ? `[System: ${titledBody}]`
      : kind === "system_injection" || kind === "compact_summary" || kind === "compact_refresh"
        ? `[System: ${description}]`
        : `[The following is a system-produced embed]\n${titledBody}`;
  return baseContent ? `${baseContent}\n${systemContent}` : systemContent;
}
