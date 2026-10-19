import type { Client, GuildTextBasedChannel, Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import type { NaturalNudgeInterest } from "@/modules/natural-nudges/db/types";
import { availableEpisodeTools, type EpisodeDefinition } from "@/modules/natural-nudges/runtime/episodes";
import { hasActivitySince, type NudgeChannel } from "@/modules/natural-nudges/runtime/channels";
import { isWithinWakingHours, serverDayStart } from "@/modules/natural-nudges/runtime/meters";
import { planEpisode, type EpisodePlan } from "@/modules/natural-nudges/runtime/planner";
import { recordEpisodeSample, type EpisodeSample } from "@/modules/natural-nudges/runtime/telemetry";
import { isChannelProcessingLocked, suppressNextSelfReply, tomoriChat } from "@/events/messageCreate/tomoriChat";
import type { GenerationTurnResult } from "@/utils/chat/types";
import { verifyMessageWebhook, isManagedWebhookMessage } from "@/utils/chat/webhookIdentity";
import { personaRepository } from "@/utils/db/repositories/PersonaRepository";
import { whitelistRepository } from "@/utils/db/repositories/WhitelistRepository";
import { log } from "@/utils/misc/logger";

/** Messages scanned after the anchor when a tool delivered the opener and no stream reported its ID. */
const OPENER_LOOKUP_LIMIT = 10;
const LATEST_EPISODE_ROWS = 1;

export interface EpisodeAttempt {
  client: Client;
  serverId: number;
  serverDiscId: string;
  timezoneOffset: number;
  heat: number;
  awake: readonly boolean[];
  persona: TomoriState;
  interests: readonly NaturalNudgeInterest[];
  episode: EpisodeDefinition;
  plannerLlmId: number;
  availableTools: ReadonlySet<string>;
  plannerChannels: Array<NudgeChannel & { transcript: string }>;
}

export type AttemptResult = "fired" | "aborted" | "failed";

function sample(attempt: EpisodeAttempt, extra: Omit<EpisodeSample, "serverId">): void {
  recordEpisodeSample({
    serverId: attempt.serverId,
    heat: attempt.heat,
    category: attempt.episode.category,
    episodeKey: attempt.episode.key,
    ...extra,
  });
}

/**
 * The cheap checks again, read fresh, right before sending. Any doubt resolves to saying nothing,
 * so each failing check names the reason and the caller aborts.
 */
async function recheckBeforeSend(attempt: EpisodeAttempt, target: NudgeChannel, now: Date): Promise<string | null> {
  const config = await naturalNudgeRepository.loadServerConfig(attempt.serverId);
  if (!config.episodes_enabled) return "disabled";
  if (!config.channel_disc_ids.includes(target.channel.id)) return "channel_removed";
  if (config.llm_id === null) return "model_cleared";
  if ((await naturalNudgeRepository.loadRuntimeState(attempt.serverId)).stopped_at) return "stopped";

  const dayStart = serverDayStart(now, attempt.timezoneOffset);
  const history = await naturalNudgeRepository.loadFireHistory(attempt.serverId, dayStart, LATEST_EPISODE_ROWS);
  if (history.latestEpisodes.some((fire) => fire.answered === null)) return "pending";
  if (history.recent.filter((fire) => fire.mode === "episode").length >= config.daily_episode_cap) return "cap_reached";

  const personaId = attempt.persona.persona_id;
  if (typeof personaId !== "number") return "persona_removed";
  const personas = await personaRepository.loadAllForServer(attempt.serverDiscId);
  if (!personas.some((persona) => persona.persona_id === personaId)) return "persona_removed";
  const personaConfig = (await naturalNudgeRepository.loadPersonaConfigs([personaId])).get(personaId);
  if (!personaConfig || personaConfig.talkativeness === 0) return "persona_silenced";
  const whitelist = await whitelistRepository.checkChannelWhitelist(attempt.serverDiscId, target.channel.id);
  if (!whitelistRepository.isPersonaAllowedByWhitelistStatus(whitelist, personaId)) return "persona_not_allowed";

  if (hasActivitySince(target.channel, target.lastMessageId)) return "channel_activity";
  if (!isWithinWakingHours(attempt.awake, now, attempt.serverId)) return "waking_hours_ended";
  if (isChannelProcessingLocked(target.channel.id)) return "channel_busy";
  return null;
}

function buildOpenerContextItem(plan: EpisodePlan, tools: readonly string[]): StructuredContextItem {
  const sentences = [
    "You decided to speak up on your own; nobody asked you to.",
    plan.openerDirection,
    `Your private goal, which nobody else can see: ${plan.agenda}`,
    "Write it as one natural, short message for this channel, in your own voice.",
    tools.length > 0 ? `If it fits, you may use: ${tools.join(", ")}.` : "",
  ].filter(Boolean);
  return {
    role: "user",
    metadataTag: ContextItemTag.DIALOGUE_HISTORY,
    parts: [{ type: "text", text: `[System: ${sentences.join(" ")}]` }],
  };
}

/**
 * Last message to borrow as the turn's trigger; only a channel read as empty gets the placeholder
 * reminders use, so a failed read never posts a stray one.
 */
async function resolveAnchorMessage(
  channel: GuildTextBasedChannel,
): Promise<{ message: Message; seeded: boolean } | null> {
  let latest: Message | null;
  try {
    latest = (await channel.messages.fetch({ limit: 1 })).first() ?? null;
  } catch {
    return null;
  }
  if (latest) return { message: latest, seeded: false };
  const placeholder = await channel.send({ content: "⠀" }).catch(() => null);
  return placeholder ? { message: placeholder, seeded: true } : null;
}

function isNewerThan(messageId: string, recordedMessageId: string | null): boolean {
  return recordedMessageId === null || BigInt(messageId) > BigInt(recordedMessageId);
}

async function findOpenerAfter(
  client: Client,
  channel: GuildTextBasedChannel,
  anchorId: string,
): Promise<string | null> {
  const after = await channel.messages.fetch({ after: anchorId, limit: OPENER_LOOKUP_LIMIT }).catch(() => null);
  if (!after) return null;
  const chronological = [...after.values()].sort((left, right) => left.createdTimestamp - right.createdTimestamp);
  for (const message of chronological) {
    if (message.author.id === client.user?.id && !message.webhookId) return message.id;
    if (message.webhookId && ((await verifyMessageWebhook(message)) || isManagedWebhookMessage(message))) {
      return message.id;
    }
  }
  return null;
}

function isGenerationFailure(result: GenerationTurnResult): boolean {
  return result.status === "error" || result.status === "timeout" || result.status === "empty_response";
}

/**
 * Phases B and C for one attempt. Runs detached from the coordinator cycle so model calls never
 * delay reminders; a restart mid-flight loses only this attempt, and the episode stays due.
 */
export async function runEpisodeAttempt(attempt: EpisodeAttempt): Promise<AttemptResult> {
  const planned = await planEpisode({
    persona: attempt.persona,
    interests: attempt.interests,
    episode: attempt.episode,
    channels: attempt.plannerChannels.map((channel) => ({
      name: channel.channel.name,
      transcript: channel.transcript,
    })),
    plannerLlmId: attempt.plannerLlmId,
  });
  const usage =
    "usage" in planned && planned.usage
      ? { plannerInputTokens: planned.usage.inputTokens, plannerOutputTokens: planned.usage.outputTokens }
      : {};
  const plannerModel = "model" in planned ? planned.model : undefined;

  if (planned.status === "unavailable") {
    sample(attempt, { outcome: "aborted", phase: "b", reason: planned.reason });
    return "aborted";
  }
  if (planned.status === "failed") {
    await naturalNudgeRepository.recordFailure(attempt.serverId);
    sample(attempt, { outcome: "failed", phase: "b", reason: `planner_${planned.reason}`, plannerModel, ...usage });
    return "failed";
  }
  if (planned.status === "declined") {
    sample(attempt, { outcome: "aborted", phase: "b", reason: "planner_declined", plannerModel, ...usage });
    return "aborted";
  }

  const target = attempt.plannerChannels[planned.plan.channelIndex];
  const blocked = await recheckBeforeSend(attempt, target, new Date());
  if (blocked) {
    sample(attempt, { outcome: "aborted", phase: "c", reason: blocked, plannerModel, ...usage });
    return "aborted";
  }

  const resolvedAnchor = await resolveAnchorMessage(target.channel);
  // Compared by order rather than equality, because the gateway keeps a deleted newest message as `lastMessageId`.
  if (!resolvedAnchor || (!resolvedAnchor.seeded && isNewerThan(resolvedAnchor.message.id, target.lastMessageId))) {
    const reason = resolvedAnchor ? "channel_activity" : "anchor_unavailable";
    sample(attempt, { outcome: "aborted", phase: "c", reason, plannerModel, ...usage });
    return "aborted";
  }

  const anchor = resolvedAnchor.message;
  const episodeTools = availableEpisodeTools(attempt.episode, attempt.availableTools);
  const personaId = attempt.persona.persona_id as number;
  let outcome: AttemptResult | null = null;
  const settle = async (result: GenerationTurnResult): Promise<void> => {
    const delivered =
      result.status === "completed" && (result.personaResponses.length > 0 || result.toolResponseDelivered === true);
    if (!delivered) {
      if (isGenerationFailure(result)) {
        await naturalNudgeRepository.recordFailure(attempt.serverId);
        outcome = "failed";
      } else {
        outcome = "aborted";
      }
      sample(attempt, { outcome, phase: "c", reason: `generation_${result.status}`, plannerModel, ...usage });
      return;
    }
    const openerId =
      result.firstDeliveredMessageId ?? (await findOpenerAfter(attempt.client, target.channel, anchor.id));
    const recorded = await naturalNudgeRepository.recordEpisodeFire(
      {
        serverId: attempt.serverId,
        channelDiscId: target.channel.id,
        personaId,
        category: attempt.episode.category,
        episodeKey: attempt.episode.key,
        openerMessageDiscId: openerId ?? anchor.id,
      },
      openerId ? planned.plan.agenda : null,
    );
    outcome = "fired";
    sample(attempt, {
      outcome: "fired",
      phase: "c",
      reason: !recorded ? "fire_row_failed" : openerId ? "delivered" : "delivered_unanchored",
      plannerModel,
      ...usage,
    });
  };

  suppressNextSelfReply(target.channel.id);
  const disposition = await tomoriChat({
    client: attempt.client,
    message: anchor,
    isFromQueue: false,
    isManuallyTriggered: true,
    forceReason: false,
    isStopResponse: false,
    selectedPersonaId: personaId,
    isPersonaJob: false,
    isUserImpersonation: false,
    textQuotaSource: "system",
    textQuotaTriggerKey: `nudge:${attempt.serverId}:${anchor.id}`,
    shouldSurfaceUserErrors: false,
    injectedContextItems: [buildOpenerContextItem(planned.plan, episodeTools)],
    naturalNudge: { toolNames: episodeTools },
    onGenerationResult: settle,
  });
  if (outcome) return outcome;
  log.info(`Natural Nudges: episode not delivered for server ${attempt.serverId} (disposition ${disposition})`);
  sample(attempt, { outcome: "aborted", phase: "c", reason: `admission_${disposition}`, plannerModel, ...usage });
  return "aborted";
}
