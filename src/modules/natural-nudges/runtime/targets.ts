import {
  ActivityType,
  type Client,
  GatewayIntentBits,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  PermissionFlagsBits,
} from "discord.js";
import { PrivacyLevel, type TomoriState } from "@/types/db/schema";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import type { NaturalNudgeFireRow, ReachOutCandidate } from "@/modules/natural-nudges/db/types";
import type { NudgeChannel } from "@/modules/natural-nudges/runtime/channels";
import { drawRaffle } from "@/modules/natural-nudges/runtime/meters";
import {
  DAY_MS,
  REACH_OUT_ACTIVITY_POINTS,
  REACH_OUT_ANY_PERSONA_PENALTY,
  AUTOMATIC_CHANNEL_DAYS,
  REACH_OUT_MEMORY_CAP,
  REACH_OUT_MEMORY_DAYS,
  REACH_OUT_MIN_TICKETS,
  REACH_OUT_PLANNER_MEMORIES,
  REACH_OUT_POINTS_PER_MEMORY,
  REACH_OUT_POINTS_PER_STM_CHANNEL,
  REACH_OUT_SAME_PERSONA_PENALTY,
  REACH_OUT_STM_CHANNEL_CAP,
} from "@/modules/natural-nudges/runtime/tuning";
import { getShortTermMemoriesForUser } from "@/utils/cache/shortTermMemoryCache";
import { personalMemoryRepository } from "@/utils/db/repositories";
import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
import { resolvePreferredDiscordDisplayName } from "@/utils/discord/displayName";
import { isExternalUserId } from "@/utils/externalIdentityUserId";
import { formatPresenceActivity } from "@/utils/text/context/history";

export interface ReachOutTarget {
  userId: number;
  userDiscId: string;
  displayName: string;
  /** Planner channels the target can read; a ping in any other would reach someone who cannot answer. */
  channelIds: string[];
  /** Empty when the target's privacy level or the persona's settings keep memories out of prompts. */
  recentMemories: string[];
  /** Null when presence is unavailable, private, or the target is not doing anything. */
  activity: string | null;
}

/** A recent memory or any live short-term memory proves a relationship; activity alone never does. */
export function isRelationshipEligible(recentMemories: number, stmChannels: number): boolean {
  return recentMemories > 0 || stmChannels > 0;
}

export interface ReachOutScoreInput {
  memories: number;
  stmChannels: number;
  active: boolean;
  firedBySamePersona: boolean;
  firedByAnyPersona: boolean;
}

/** Full memory history counts here, unlike the eligibility gate, so a close user keeps weight from old memories. */
export function reachOutTickets(input: ReachOutScoreInput): number {
  const score =
    REACH_OUT_POINTS_PER_MEMORY * Math.min(input.memories, REACH_OUT_MEMORY_CAP) +
    REACH_OUT_POINTS_PER_STM_CHANNEL * Math.min(input.stmChannels, REACH_OUT_STM_CHANNEL_CAP) +
    (input.active ? REACH_OUT_ACTIVITY_POINTS : 0) -
    (input.firedBySamePersona ? REACH_OUT_SAME_PERSONA_PENALTY : 0) -
    (input.firedByAnyPersona ? REACH_OUT_ANY_PERSONA_PENALTY : 0);
  return Math.max(score, REACH_OUT_MIN_TICKETS);
}

/** Presence reaches prompts only at minimal privacy, matching what a normal turn shows about the user. */
function currentActivity(client: Client, guild: Guild, candidate: ReachOutCandidate): string | null {
  if (candidate.privacy_level !== PrivacyLevel.MINIMAL) return null;
  if (!client.options.intents.has(GatewayIntentBits.GuildPresences)) return null;
  const activity = guild.presences.cache
    .get(candidate.user_disc_id)
    ?.activities.find((entry) => entry.type !== ActivityType.Custom);
  return activity ? formatPresenceActivity(activity) : null;
}

function countStmChannels(candidate: ReachOutCandidate, guildId: string, lineageId: number): number {
  const channels = new Set(
    getShortTermMemoriesForUser(candidate.user_disc_id, undefined, lineageId)
      .filter((entry) => entry.serverId === guildId)
      .map((entry) => entry.channelId),
  );
  return channels.size;
}

async function loadRecentMemories(
  candidate: ReachOutCandidate,
  persona: TomoriState,
  memorySince: Date,
): Promise<string[]> {
  if (candidate.ltm_recent === 0) return [];
  if (candidate.privacy_level !== PrivacyLevel.MINIMAL || persona.config.personal_memories_enabled === false) {
    return [];
  }
  const rows = await personalMemoryRepository.loadForUserLineage(candidate.user_id, persona.persona_lineage_id, true);
  const touchedAt = (row: (typeof rows)[number]) =>
    Math.max(row.created_at?.getTime() ?? 0, row.updated_at?.getTime() ?? 0);
  return rows
    .filter((row) => touchedAt(row) >= memorySince.getTime())
    .sort((left, right) => touchedAt(right) - touchedAt(left))
    .slice(0, REACH_OUT_PLANNER_MEMORIES)
    .map((row) => row.content);
}

function memorySinceFor(now: Date): Date {
  return new Date(now.getTime() - REACH_OUT_MEMORY_DAYS * DAY_MS);
}

function canView(member: GuildMember, channel: GuildTextBasedChannel): boolean {
  return channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel) ?? false;
}

/**
 * A weighted lottery rather than the closest user, so one close friend does not receive every ping.
 * A winner who left, is a bot, or can read none of the channels is dropped and the lottery redrawn,
 * because the stats that nominated them cannot tell any of that.
 */
export async function drawReachOutTarget(args: {
  client: Client;
  guild: Guild;
  serverId: number;
  persona: TomoriState & { persona_id: number };
  channels: readonly NudgeChannel[];
  recentFires: readonly NaturalNudgeFireRow[];
  now: Date;
}): Promise<ReachOutTarget | null> {
  const { client, guild, persona, now } = args;
  // A persona told not to use personal memories must not pick people by them either.
  const memoriesUsable = persona.config.personal_memories_enabled !== false;
  const memorySince = memorySinceFor(now);
  const candidates = await naturalNudgeRepository.listReachOutCandidates({
    serverId: args.serverId,
    personaId: persona.persona_id,
    personaLineageId: persona.persona_lineage_id,
    interactedSince: new Date(now.getTime() - AUTOMATIC_CHANNEL_DAYS * DAY_MS),
    memorySince,
  });
  const pingedBy = new Map<number, Set<number>>();
  for (const fire of args.recentFires) {
    if (fire.target_user_id === null) continue;
    const personas = pingedBy.get(fire.target_user_id) ?? new Set<number>();
    personas.add(fire.persona_id);
    pingedBy.set(fire.target_user_id, personas);
  }

  const reachable = candidates.filter((candidate) => !isExternalUserId(candidate.user_disc_id));
  // Short-term memory lives in a cache that starts empty after a restart, so it is warmed before counting.
  await shortTermMemoryRepository.preWarmUsers(reachable.map((candidate) => candidate.user_disc_id));
  let entries = reachable.flatMap((candidate) => {
    const stmChannels = countStmChannels(candidate, guild.id, persona.persona_lineage_id);
    const recentMemories = memoriesUsable ? candidate.ltm_recent : 0;
    if (!isRelationshipEligible(recentMemories, stmChannels)) return [];
    const activity = currentActivity(client, guild, candidate);
    const pingers = pingedBy.get(candidate.user_id);
    return [
      {
        item: { candidate, activity },
        tickets: reachOutTickets({
          memories: memoriesUsable ? candidate.ltm_total : 0,
          stmChannels,
          active: activity !== null,
          firedBySamePersona: pingers?.has(persona.persona_id) ?? false,
          firedByAnyPersona: pingers !== undefined,
        }),
      },
    ];
  });

  while (entries.length > 0) {
    const drawn = drawRaffle(entries);
    if (!drawn) return null;
    const member = await guild.members.fetch(drawn.candidate.user_disc_id).catch(() => null);
    const channelIds = member
      ? args.channels.filter((entry) => canView(member, entry.channel)).map((entry) => entry.channel.id)
      : [];
    if (member && !member.user.bot && channelIds.length > 0) {
      return {
        userId: drawn.candidate.user_id,
        userDiscId: drawn.candidate.user_disc_id,
        displayName: resolvePreferredDiscordDisplayName({ memberDisplayName: member.displayName, user: member.user }),
        channelIds,
        recentMemories: await loadRecentMemories(drawn.candidate, persona, memorySince),
        activity: drawn.activity,
      };
    }
    entries = entries.filter((entry) => entry.item !== drawn);
  }
  return null;
}

export async function isTargetStillReachable(args: {
  guild: Guild;
  serverId: number;
  persona: TomoriState & { persona_id: number };
  target: ReachOutTarget;
  channel: GuildTextBasedChannel;
  now: Date;
}): Promise<boolean> {
  const [candidate] = await naturalNudgeRepository.listReachOutCandidates({
    serverId: args.serverId,
    personaId: args.persona.persona_id,
    personaLineageId: args.persona.persona_lineage_id,
    interactedSince: new Date(args.now.getTime() - AUTOMATIC_CHANNEL_DAYS * DAY_MS),
    memorySince: memorySinceFor(args.now),
    onlyUserId: args.target.userId,
  });
  if (!candidate) return false;
  const member = await args.guild.members.fetch({ user: args.target.userDiscId, force: true }).catch(() => null);
  return member !== null && canView(member, args.channel);
}
