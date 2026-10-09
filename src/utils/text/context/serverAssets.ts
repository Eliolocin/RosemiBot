import type { Client } from "discord.js";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type {
  CustomExpressionRow,
  ServerEmojiRow,
  ServerStickerRow,
  AssembledServerConfig,
  TomoriState,
} from "@/types/db/schema";
import type { ToolPromptMacroResolver } from "@/utils/tools/toolPromptMacros";
import type { MentionConverter } from "./templates";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { projectStickerCandidates } from "@/utils/discord/stickerCandidates";

type EmojiMetadata =
  | ServerEmojiRow
  | {
      emoji_disc_id: string;
      emoji_name: string;
      emoji_desc: string | null;
      emotion_key: string | null;
      is_animated: boolean;
      created_at: Date | null;
      updated_at: Date | null;
    };

export async function buildServerEmojiContextItem(params: {
  client: Client;
  guildId: string;
  serverName: string;
  botName: string;
  isDMChannel: boolean;
  isUserImpersonation: boolean;
  tomoriConfig: AssembledServerConfig;
  tomoriState: TomoriState | null;
  preloadedEmojis?: ServerEmojiRow[] | null;
  snapshot?: import("@/types/misc/context").RequestSnapshot;
  convertMentions: MentionConverter;
}): Promise<StructuredContextItem | null> {
  if (params.isDMChannel || !params.tomoriConfig.emoji_usage_enabled || !params.tomoriState) {
    return null;
  }

  const guildEmojisCache = params.client.guilds.cache.get(params.guildId)?.emojis.cache;
  if (!guildEmojisCache || guildEmojisCache.size === 0) {
    return null;
  }

  const emojiMetadata =
    params.preloadedEmojis && params.preloadedEmojis.length > 0
      ? params.preloadedEmojis
      : (await serverRepository.loadEmojis(params.tomoriState.server_id)) || [];

  const emojiMetadataByName = new Map<string, EmojiMetadata>();
  const hasEmojiMetadata = (metadata: EmojiMetadata) =>
    (metadata.emotion_key && metadata.emotion_key !== "unset") ||
    (metadata.emoji_desc && metadata.emoji_desc.trim().length > 0);
  const getMetadataTimestamp = (metadata: EmojiMetadata) =>
    Math.max(metadata.updated_at?.getTime() ?? 0, metadata.created_at?.getTime() ?? 0);

  for (const metadata of emojiMetadata) {
    if (!metadata.emoji_name) continue;
    const nameKey = metadata.emoji_name.toLowerCase();
    const existing = emojiMetadataByName.get(nameKey);
    if (
      !existing ||
      (hasEmojiMetadata(metadata) && !hasEmojiMetadata(existing)) ||
      (hasEmojiMetadata(metadata) === hasEmojiMetadata(existing) &&
        getMetadataTimestamp(metadata) >= getMetadataTimestamp(existing))
    ) {
      emojiMetadataByName.set(nameKey, metadata);
    }
  }

  const sortedEmojis = Array.from(guildEmojisCache.values()).sort(
    (a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0),
  );
  const latestEmojiByName = new Map<string, (typeof sortedEmojis)[number]>();
  for (const emoji of sortedEmojis) {
    if (emoji.name) latestEmojiByName.set(emoji.name.toLowerCase(), emoji);
  }

  const emojiLines = sortedEmojis
    .filter((emoji) => emoji.name && latestEmojiByName.get(emoji.name.toLowerCase())?.id === emoji.id)
    .map((emoji) => {
      const emojiName = emoji.name ?? "";
      const metadata = emojiMetadataByName.get(emojiName.toLowerCase());
      const emotionKey = metadata?.emotion_key === "unset" ? null : (metadata?.emotion_key ?? null);
      if (!metadata || (!metadata.emoji_desc && !emotionKey)) {
        return `:${emojiName}:`;
      }

      const labelParts: string[] = [];
      if (emotionKey) labelParts.push(`Expresses ${emotionKey}`);
      if (metadata.emoji_desc) labelParts.push(metadata.emoji_desc);
      return `:${emojiName}: (${labelParts.join("; ")})`;
    });

  const emojiContent = `## ${params.serverName}'s Emojis\n- ${emojiLines.join("\n- ")}.`;
  const emojiUsage = params.isUserImpersonation
    ? `\nTo use ${params.serverName}'s emojis, write :name: (name only, no IDs). Names are case-insensitive.\n`
    : `\nTo use ${params.serverName}'s emojis, just write :name: (name only, no IDs). Names are case-insensitive. {bot} only uses server emojis when it matches their actual mood.\n`;

  return {
    role: "system",
    parts: [
      {
        type: "text",
        text: await params.convertMentions(
          emojiContent + emojiUsage,
          params.client,
          params.guildId,
          "User",
          params.botName,
          params.tomoriConfig.personal_memories_enabled,
          params.snapshot,
        ),
      },
    ],
    metadataTag: ContextItemTag.KNOWLEDGE_SERVER_EMOJIS,
  };
}

export async function buildServerStickerContextItem(params: {
  client: Client;
  guildId: string;
  serverName: string;
  botName: string;
  isDMChannel: boolean;
  isUserImpersonation: boolean;
  tomoriConfig: AssembledServerConfig;
  tomoriState: TomoriState | null;
  preloadedStickers?: ServerStickerRow[] | null;
  preloadedCustomExpressions?: CustomExpressionRow[] | null;
  toolPromptMacroResolver: ToolPromptMacroResolver;
  convertMentions: MentionConverter;
}): Promise<StructuredContextItem | null> {
  if (
    !params.tomoriConfig.sticker_usage_enabled ||
    params.isDMChannel ||
    params.isUserImpersonation ||
    !params.tomoriState
  ) {
    return null;
  }

  const guild = params.client.guilds.cache.get(params.guildId);
  if (!guild) return null;
  const [metadata, customs] = await Promise.all([
    params.preloadedStickers ?? serverRepository.loadStickersByInternalId(params.tomoriState.server_id),
    params.preloadedCustomExpressions ?? serverRepository.loadCustomExpressions(params.tomoriState.server_id),
  ]);
  const candidates = projectStickerCandidates(guild, params.tomoriState.persona_id ?? 0, metadata, customs);
  if (!candidates.length) return null;
  let stickerContent = `## ${params.serverName}'s Stickers\nThis server has the following stickers available for ${params.botName} to use with the '{sticker_tool}' function:\n`;
  for (const sticker of candidates) {
    const labelParts: string[] = [];
    if (sticker.emotionKey) labelParts.push(`Expresses ${sticker.emotionKey}`);
    if (sticker.description) labelParts.push(sticker.description);
    stickerContent += `- "${sticker.name}"${labelParts.length ? ` (${labelParts.join("; ")})` : ""}\n`;
  }
  stickerContent += "To use a sticker, call '{sticker_tool}' with the sticker's name (case-insensitive).\n";

  const expandedContent = await params.toolPromptMacroResolver.expand(
    `{{if tool:select_sticker_for_response}}${stickerContent}{{/if}}`,
  );
  if (!expandedContent.trim()) return null;

  return {
    role: "system",
    parts: [
      {
        type: "text",
        text: await params.convertMentions(
          expandedContent,
          params.client,
          params.guildId,
          "User",
          params.botName,
          params.tomoriConfig.personal_memories_enabled,
        ),
      },
    ],
    metadataTag: ContextItemTag.KNOWLEDGE_SERVER_STICKERS,
  };
}
