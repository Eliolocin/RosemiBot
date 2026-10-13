import type { Embed } from "discord.js";
import type { ProxyReplyTarget } from "@/utils/messageProxy/types";

const PLURALKIT_REPLY_AUTHOR_SUFFIX_PATTERN = /↩️?$/;
const DISCORD_MESSAGE_LINK_PATTERN = /discord(?:app)?\.com\/channels\/(?:@me|\d+)\/(\d+)\/(\d+)/;

export function extractPluralKitReplyTarget(embed: Pick<Embed, "author" | "description">): ProxyReplyTarget | null {
  const authorName = embed.author?.name?.trim() ?? "";
  if (!PLURALKIT_REPLY_AUTHOR_SUFFIX_PATTERN.test(authorName)) return null;
  const match = `${embed.author?.url ?? ""}\n${embed.description ?? ""}`.match(DISCORD_MESSAGE_LINK_PATTERN);
  return match ? { channelId: match[1], messageId: match[2] } : null;
}

export function isPluralKitReplyEmbed(embed: Pick<Embed, "author" | "description">): boolean {
  return extractPluralKitReplyTarget(embed) !== null;
}
