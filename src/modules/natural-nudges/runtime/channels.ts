import { ChannelType, SnowflakeUtil, type Client, type GuildTextBasedChannel, type Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { getCachedBlacklistStatus, getCachedPrivacyLevel } from "@/utils/cache/userCache";
import { PrivacyLevel } from "@/types/db/schema";
import { verifyMessageWebhook } from "@/utils/chat/webhookIdentity";
import { findLastPersonaTurnBlock } from "@/utils/discord/personaTurnDetection";
import { log } from "@/utils/misc/logger";

/** Messages per channel read for hanging detection and handed to the planner. */
export const PLANNER_HISTORY_MESSAGES = 15;
/** A conversation older than this is history, not something to pick back up. */
const HANGING_MAX_AGE_MS = 48 * 60 * 60 * 1000;
/** Fewer human messages than this is not a conversation that could be left hanging. */
const HANGING_MIN_HUMAN_MESSAGES = 2;
const TRANSCRIPT_MESSAGE_MAX_CHARS = 300;

export interface NudgeChannel {
  channel: GuildTextBasedChannel;
  /** Newest message ID when the lull was measured; any later message aborts the nudge. */
  lastMessageId: string | null;
  quietSinceMs: number | null;
}

/** Listed guild text channels the bot can still see, with their last activity from the gateway cache. */
export async function resolveAllowedChannels(client: Client, channelIds: readonly string[]): Promise<NudgeChannel[]> {
  const channels: NudgeChannel[] = [];
  for (const channelId of channelIds) {
    const channel = client.channels.cache.get(channelId) ?? (await client.channels.fetch(channelId).catch(() => null));
    if (!channel || channel.type !== ChannelType.GuildText) continue;
    const lastMessageId = channel.lastMessageId ?? null;
    channels.push({
      channel,
      lastMessageId,
      quietSinceMs: lastMessageId ? SnowflakeUtil.timestampFrom(lastMessageId) : null,
    });
  }
  return channels;
}

/** Whether any message landed in the channel after the one recorded when the lull was measured. */
export function hasActivitySince(channel: GuildTextBasedChannel, recordedLastMessageId: string | null): boolean {
  return (channel.lastMessageId ?? null) !== recordedLastMessageId;
}

export async function fetchRecentMessages(channel: GuildTextBasedChannel, limit: number): Promise<Message[]> {
  try {
    const fetched = await channel.messages.fetch({ limit });
    const messages = [...fetched.values()].sort((left, right) => left.createdTimestamp - right.createdTimestamp);
    await Promise.all(messages.filter((message) => message.webhookId).map((message) => verifyMessageWebhook(message)));
    return messages;
  } catch (error) {
    log.warn(`Natural Nudges: failed to read history for channel ${channel.id}`, error);
    return [];
  }
}

/** PluralKit-style proxied messages arrive as webhooks, so they read as non-human here; accepted. */
function isHumanMessage(message: Message): boolean {
  return !message.author.bot && !message.webhookId && !message.system;
}

/**
 * A recent conversation with real participants that ended on a human or a persona, never on another
 * bot, so announcement and log traffic is not mistaken for a conversation.
 */
export function isHangingConversation(
  messages: readonly Message[],
  allPersonas: TomoriState[],
  clientUserId: string | undefined,
  now: Date,
): boolean {
  const newest = messages.at(-1);
  if (!newest || now.getTime() - newest.createdTimestamp > HANGING_MAX_AGE_MS) return false;
  if (messages.filter(isHumanMessage).length < HANGING_MIN_HUMAN_MESSAGES) return false;
  if (isHumanMessage(newest)) return true;
  const block = findLastPersonaTurnBlock({ messages: [...messages], allPersonas, clientUserId });
  return block.blockMessages.includes(newest);
}

/** Any human message after the opener answers it. */
export async function hasHumanReplyAfter(channel: GuildTextBasedChannel, openerMessageId: string): Promise<boolean> {
  if (!channel.lastMessageId || BigInt(channel.lastMessageId) <= BigInt(openerMessageId)) return false;
  try {
    const after = await channel.messages.fetch({ after: openerMessageId, limit: 50 });
    return after.some(isHumanMessage);
  } catch (error) {
    log.warn(`Natural Nudges: failed to read replies in channel ${channel.id}`, error);
    return false;
  }
}

function relativeAge(createdTimestamp: number, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - createdTimestamp) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/**
 * Plain transcript for the planner. Fully private and server-blacklisted authors are dropped, as the
 * main context does, so the planner never reads what the persona could not.
 */
export async function buildPlannerTranscript(
  messages: readonly Message[],
  guildId: string,
  now: Date,
): Promise<string> {
  const lines: string[] = [];
  for (const message of messages) {
    if (!message.webhookId && !message.author.bot) {
      if ((await getCachedPrivacyLevel(message.author.id)) === PrivacyLevel.FULL) continue;
      if (await getCachedBlacklistStatus(guildId, message.author.id)) continue;
    }
    const content = message.content.trim().replace(/\s+/g, " ").slice(0, TRANSCRIPT_MESSAGE_MAX_CHARS);
    const attachments = message.attachments.size > 0 ? ` [${message.attachments.size} attachment(s)]` : "";
    if (!content && !attachments) continue;
    const author = message.member?.displayName ?? message.author.displayName ?? message.author.username;
    lines.push(`[${relativeAge(message.createdTimestamp, now)}] ${author}: ${content}${attachments}`);
  }
  return lines.join("\n");
}
