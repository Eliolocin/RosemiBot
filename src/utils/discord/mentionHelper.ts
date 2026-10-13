import type { Client, Guild, TextBasedChannel } from "discord.js";
import type { ForcedMention } from "@/types/discord/mentions";
import { getCachedUserRow } from "@/utils/cache/userCache";
import { isExternalUserId } from "@/utils/externalIdentityUserId";
import { log } from "@/utils/misc/logger";

type SendableChannel = TextBasedChannel & {
  send: (options: {
    content: string;
    allowedMentions: { users: string[]; roles: string[]; parse: string[] };
  }) => Promise<unknown>;
};

function normalizeMentionHandle(value?: string | null): string | null {
  if (!value) return null;
  let handle = value.trim();
  if (!handle) return null;
  if (handle.startsWith("<@")) return null;
  if (handle.startsWith("@")) {
    handle = handle.slice(1).trim();
  }
  return handle || null;
}

export async function buildForcedMentionsForUser(
  userId: string,
  client: Client,
  guild?: Guild | null,
): Promise<ForcedMention[]> {
  if (isExternalUserId(userId)) {
    return [];
  }

  const handles = new Set<string>();
  const addHandle = (value?: string | null) => {
    const normalized = normalizeMentionHandle(value);
    if (normalized) handles.add(normalized);
  };

  const userRow = await getCachedUserRow(userId);
  addHandle(userRow?.user_nickname);

  let member = null;
  if (guild) {
    member = await guild.members.fetch(userId).catch(() => null);
  }

  const fallbackUser = member ? null : await client.users.fetch(userId).catch(() => null);

  addHandle(member?.nickname);
  addHandle(member?.user.globalName ?? fallbackUser?.globalName);
  addHandle(member?.user.username ?? fallbackUser?.username);

  return Array.from(handles).map((handle) => ({
    handle,
    userId,
  }));
}

export async function ensureDiscordUserMention(params: {
  client: Client;
  channel: TextBasedChannel;
  targetUserId: string;
  afterMessageId: string;
  triggerStartTime: number;
  contextLabel: string;
  fallbackSender?: (content: string) => Promise<boolean>;
}): Promise<void> {
  const { client, channel, targetUserId, afterMessageId, triggerStartTime, contextLabel, fallbackSender } = params;
  if (isExternalUserId(targetUserId)) {
    log.warn(`Skipping fallback mention for ${contextLabel}: ${targetUserId} is not a Discord user snowflake`);
    return;
  }

  const botUserId = client.user?.id;
  if (!botUserId) {
    log.warn(`Cannot verify mention for ${contextLabel}: bot user not available`);
    return;
  }

  if (!("messages" in channel)) {
    log.warn(`Cannot verify mention for ${contextLabel}: channel does not support message fetching`);
    return;
  }

  try {
    const recentMessages = await channel.messages.fetch({
      after: afterMessageId,
      limit: 100,
    });

    const relevantMessages = recentMessages.filter(
      (message) =>
        (message.author.id === botUserId || message.webhookId) && message.createdTimestamp >= triggerStartTime - 1000,
    );

    if (relevantMessages.size === 0) {
      log.warn(`No bot or webhook messages found after ${contextLabel}; sending fallback mention`);

      if (!("send" in channel)) {
        log.warn(`Cannot send fallback mention for ${contextLabel}: channel does not support sending`);
        return;
      }

      const mentionToken = `<@${targetUserId}>`;
      const sentViaFallback = fallbackSender ? await fallbackSender(mentionToken) : false;

      if (!sentViaFallback) {
        await (channel as SendableChannel).send({
          content: mentionToken,
          allowedMentions: {
            users: [targetUserId],
            roles: [],
            parse: [],
          },
        });
      }

      log.info(`Added fallback mention for ${contextLabel}`);
      return;
    }

    const mentionToken = `<@${targetUserId}>`;
    const mentionTokenAlt = `<@!${targetUserId}>`;
    const hasMention = relevantMessages.some(
      (message) =>
        message.mentions.users.has(targetUserId) ||
        message.content.includes(mentionToken) ||
        message.content.includes(mentionTokenAlt),
    );

    if (hasMention) return;

    if (!("send" in channel)) {
      log.warn(`Cannot send fallback mention for ${contextLabel}: channel does not support sending`);
      return;
    }

    const sentViaFallback = fallbackSender ? await fallbackSender(mentionToken) : false;

    if (!sentViaFallback) {
      await (channel as SendableChannel).send({
        content: mentionToken,
        allowedMentions: {
          users: [targetUserId],
          roles: [],
          parse: [],
        },
      });
    }

    log.info(`Added fallback mention for ${contextLabel}`);
  } catch (error) {
    log.warn(`Failed to verify mention for ${contextLabel}:`, error);
  }
}
