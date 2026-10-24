import { ChannelType, SnowflakeUtil, type Client, type GuildTextBasedChannel, type Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { getCachedBlacklistStatus, getCachedPrivacyLevel } from "@/utils/cache/userCache";
import { PrivacyLevel } from "@/types/db/schema";
import { verifyMessageWebhook } from "@/utils/chat/webhookIdentity";
import { findLastPersonaTurnBlock } from "@/utils/discord/personaTurnDetection";
import { classifySendFailure, getBlockedSendReason, noteSendFailure } from "@/utils/discord/stream/sendFailureCache";
import { log } from "@/utils/misc/logger";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import type { ServerNaturalNudgeConfig } from "@/modules/natural-nudges/db/types";
import { automaticChannelWindowStart } from "@/modules/natural-nudges/runtime/meters";
import { HANGING_MAX_AGE_MS, HANGING_MIN_HUMAN_MESSAGES } from "@/modules/natural-nudges/runtime/tuning";

const TRANSCRIPT_MESSAGE_MAX_CHARS = 300;

export interface NudgeChannel {
  channel: GuildTextBasedChannel;
  quietSinceMs: number | null;
}

/** The admin's list when it has any channel, otherwise the automatic set from recent turns. */
export async function resolveEffectiveChannelIds(
  serverId: number,
  config: Pick<ServerNaturalNudgeConfig, "channel_disc_ids">,
  now: Date,
): Promise<string[]> {
  if (config.channel_disc_ids.length > 0) return config.channel_disc_ids;
  return naturalNudgeRepository.loadAutomaticChannelIds(serverId, automaticChannelWindowStart(now));
}

/**
 * Phase A re-reads its channel list every minute, so a deleted or inaccessible channel that stays in the
 * automatic window (or the pinned list) would otherwise cost a REST fetch each tick.
 */
async function fetchUncachedChannel(client: Client, channelId: string) {
  if (getBlockedSendReason(channelId)) return null;
  try {
    return await client.channels.fetch(channelId);
  } catch (error) {
    const reason = classifySendFailure(error);
    if (reason) noteSendFailure(channelId, reason);
    return null;
  }
}

/** Listed guild text channels the bot can still see, with their last activity from the gateway cache. */
export async function resolveAllowedChannels(client: Client, channelIds: readonly string[]): Promise<NudgeChannel[]> {
  const channels: NudgeChannel[] = [];
  for (const channelId of channelIds) {
    const channel = client.channels.cache.get(channelId) ?? (await fetchUncachedChannel(client, channelId));
    if (!channel || channel.type !== ChannelType.GuildText) continue;
    const lastMessageId = channel.lastMessageId ?? null;
    channels.push({
      channel,
      quietSinceMs: lastMessageId ? SnowflakeUtil.timestampFrom(lastMessageId) : null,
    });
  }
  return channels;
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
export function isHumanMessage(message: Message): boolean {
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

/** Member-written text must not close the data block it sits in or open a tag of its own. */
export function escapeDataText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function relativeAge(createdTimestamp: number, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - createdTimestamp) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

interface TranscriptEntry {
  message: Message;
  author: string;
  text: string;
}

/**
 * Messages a model outside the turn may read. Fully private and server-blacklisted authors are
 * dropped, as the main context does, so it never reads what the persona could not.
 */
async function readableEntries(messages: readonly Message[], guildId: string): Promise<TranscriptEntry[]> {
  const entries: TranscriptEntry[] = [];
  for (const message of messages) {
    if (!message.webhookId && !message.author.bot) {
      if ((await getCachedPrivacyLevel(message.author.id)) === PrivacyLevel.FULL) continue;
      if (await getCachedBlacklistStatus(guildId, message.author.id)) continue;
    }
    const content = message.content.trim().replace(/\s+/g, " ").slice(0, TRANSCRIPT_MESSAGE_MAX_CHARS);
    const attachments = message.attachments.size > 0 ? ` [${message.attachments.size} attachment(s)]` : "";
    if (!content && !attachments) continue;
    const author = message.member?.displayName ?? message.author.displayName ?? message.author.username;
    entries.push({ message, author, text: `${content}${attachments}` });
  }
  return entries;
}

export async function buildPlannerTranscript(
  messages: readonly Message[],
  guildId: string,
  now: Date,
): Promise<string> {
  return (await readableEntries(messages, guildId))
    .map((entry) => `[${relativeAge(entry.message.createdTimestamp, now)}] ${entry.author}: ${entry.text}`)
    .join("\n");
}

/** `Name: text` lines, the shape the Active Nudge matcher was evaluated on. */
export async function buildMatcherEvidence(messages: readonly Message[], guildId: string): Promise<string> {
  return (await readableEntries(messages, guildId)).map((entry) => `${entry.author}: ${entry.text}`).join("\n");
}
