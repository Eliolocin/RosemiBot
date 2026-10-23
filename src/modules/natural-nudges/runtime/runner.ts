import type { Client, GuildTextBasedChannel, Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import type { NaturalNudgeCategory, NaturalNudgeInterest } from "@/modules/natural-nudges/db/types";
import { availableIdleNudgeTools, type IdleNudgeDefinition } from "@/modules/natural-nudges/runtime/idleNudges";
import {
  hasActivitySince,
  resolveEffectiveChannelIds,
  type NudgeChannel,
} from "@/modules/natural-nudges/runtime/channels";
import { type NudgeModelRef, resolvePlannerModel } from "@/modules/natural-nudges/runtime/model";
import { isWithinWakingHours, serverDayStart } from "@/modules/natural-nudges/runtime/meters";
import { IDLE_NUDGE_DAILY_CAPS } from "@/modules/natural-nudges/runtime/tuning";
import { planIdleNudge, type IdleNudgePlan, type ScenePartner } from "@/modules/natural-nudges/runtime/planner";
import { isTargetStillReachable, type PingUserTarget } from "@/modules/natural-nudges/runtime/targets";
import { recordIdleNudgeSample, type IdleNudgeSample } from "@/modules/natural-nudges/runtime/telemetry";
import { isChannelProcessingLocked, tomoriChat } from "@/events/messageCreate/tomoriChat";
import { isDeliveredTurnResult } from "@/utils/chat/postTurnEffects";
import { buildSceneTurnDirective } from "@/utils/chat/sceneTurn";
import type { ChatAdmissionDisposition, GenerationTurnResult, SceneTurnMetadata } from "@/utils/chat/types";
import { verifyMessageWebhook, isManagedWebhookMessage } from "@/utils/chat/webhookIdentity";
import { personaRepository } from "@/utils/db/repositories/PersonaRepository";
import { whitelistRepository } from "@/utils/db/repositories/WhitelistRepository";
import { ensureDiscordUserMention, sendAlterPersonaMention } from "@/utils/discord/mentionHelper";
import { seedTurnAnchor } from "@/utils/discord/turnAnchor";
import { log } from "@/utils/misc/logger";

/** Messages scanned after the anchor when a tool delivered the opener and no stream reported its ID. */
const OPENER_LOOKUP_LIMIT = 10;
const LATEST_IDLE_NUDGE_ROWS = 1;

export interface IdleNudgeAttempt {
  client: Client;
  serverId: number;
  serverDiscId: string;
  timezoneOffset: number;
  heat: number;
  awake: readonly boolean[];
  persona: TomoriState;
  interests: readonly NaturalNudgeInterest[];
  idleNudge: IdleNudgeDefinition;
  plannerModel: NudgeModelRef;
  availableTools: ReadonlySet<string>;
  plannerChannels: Array<NudgeChannel & { transcript: string }>;
  /** The member the idle nudge is about. Outside a scene, the opener pings them. */
  target: PingUserTarget | null;
  /** Play Scene partners; empty for every other category. */
  partners: ScenePartner[];
}

export type AttemptResult = "fired" | "aborted" | "failed";

function sample(attempt: IdleNudgeAttempt, extra: Omit<IdleNudgeSample, "serverId">): void {
  recordIdleNudgeSample({
    serverId: attempt.serverId,
    heat: attempt.heat,
    category: attempt.idleNudge.category,
    idleNudgeKey: attempt.idleNudge.key,
    ...extra,
  });
}

/**
 * The cheap checks again, read fresh, right before sending. Any doubt resolves to saying nothing,
 * so each failing check names the reason and the caller aborts.
 */
async function recheckBeforeSend(attempt: IdleNudgeAttempt, target: NudgeChannel, now: Date): Promise<string | null> {
  const config = await naturalNudgeRepository.loadServerConfig(attempt.serverId);
  if (!config.idle_nudges_enabled) return "disabled";
  const channelIds = await resolveEffectiveChannelIds(attempt.serverId, config, now);
  if (!channelIds.includes(target.channel.id)) return "channel_removed";
  if ((await naturalNudgeRepository.loadRuntimeState(attempt.serverId)).stopped_at) return "stopped";

  const dayStart = serverDayStart(now, attempt.timezoneOffset);
  const history = await naturalNudgeRepository.loadFireHistory(attempt.serverId, dayStart, LATEST_IDLE_NUDGE_ROWS);
  if (history.latestIdleNudges.some((fire) => fire.answered === null)) return "pending";
  if (
    history.recent.filter((fire) => fire.mode === "idle").length >= IDLE_NUDGE_DAILY_CAPS[config.idle_nudge_frequency]
  )
    return "cap_reached";

  const personaId = attempt.persona.persona_id;
  if (typeof personaId !== "number") return "persona_removed";
  const personas = await personaRepository.loadAllForServer(attempt.serverDiscId);
  if (!personas.some((persona) => persona.persona_id === personaId)) return "persona_removed";
  if ((await resolvePlannerModel(personas[0], config.llm_id)).kind !== "ready") return "no_model";
  const personaConfig = (await naturalNudgeRepository.loadPersonaConfigs([personaId])).get(personaId);
  if (!personaConfig || personaConfig.talkativeness === 0) return "persona_silenced";
  const whitelist = await whitelistRepository.checkChannelWhitelist(attempt.serverDiscId, target.channel.id);
  if (!whitelistRepository.isPersonaAllowedByWhitelistStatus(whitelist, personaId)) return "persona_not_allowed";
  for (const { persona: partner } of attempt.partners) {
    if (!personas.some((persona) => persona.persona_id === partner.persona_id)) return "partner_removed";
    if (
      typeof partner.persona_id !== "number" ||
      !whitelistRepository.isPersonaAllowedByWhitelistStatus(whitelist, partner.persona_id)
    )
      return "partner_not_allowed";
  }
  if (attempt.target) {
    const guild = attempt.client.guilds.cache.get(attempt.serverDiscId);
    const persona = { ...attempt.persona, persona_id: personaId };
    if (
      !guild ||
      !(await isTargetStillReachable({
        guild,
        serverId: attempt.serverId,
        persona,
        target: attempt.target,
        channel: target.channel,
        now,
      }))
    ) {
      return "target_unavailable";
    }
  }

  if (hasActivitySince(target.channel, target.lastMessageId)) return "channel_activity";
  if (!isWithinWakingHours(attempt.awake, now, attempt.serverId)) return "waking_hours_ended";
  if (isChannelProcessingLocked(target.channel.id)) return "channel_busy";
  return null;
}

export function systemContextItem(sentences: readonly string[]): StructuredContextItem {
  return {
    role: "user",
    metadataTag: ContextItemTag.DIALOGUE_HISTORY,
    parts: [{ type: "text", text: `[System: ${sentences.filter(Boolean).join(" ")}]` }],
  };
}

/**
 * Says what the persona sets out to do rather than "nobody asked", which personas echoed back; the turn
 * borrows the channel's last message as its trigger, so the lead must still mark it as unprompted.
 */
const OPENER_LEADS: Record<NaturalNudgeCategory, (name: string) => string> = {
  start_topic: (name) => `${name} decided to bring up a new topic in this channel on their own.`,
  revive_topic: (name) => `${name} decided to pick an earlier conversation in this channel back up on their own.`,
  ping_user: (name) => `${name} decided to reach out to one member on their own.`,
  play_scene: (name) => `${name} decided to open a short scene on their own.`,
};

function targetSentence(target: PingUserTarget | null, isScene: boolean): string {
  if (!target) return "";
  if (isScene) return `The scene is about the member @{${target.userDiscId}}.`;
  return `The message mentions them as @{${target.userDiscId}}.`;
}

function toolSentence(name: string, tools: readonly string[]): string {
  return tools.length > 0 ? `If it fits, ${name} may use: ${tools.join(", ")}.` : "";
}

function buildOpenerContextItem(
  attempt: IdleNudgeAttempt,
  plan: IdleNudgePlan,
  tools: readonly string[],
): StructuredContextItem {
  const name = attempt.persona.persona_nickname;
  const partnerNames = attempt.partners.map((partner) => partner.persona.persona_nickname).join(" and ");
  return systemContextItem([
    OPENER_LEADS[attempt.idleNudge.category](name),
    plan.scene ? `${partnerNames} will answer next.` : "",
    targetSentence(attempt.target, plan.scene !== null),
    plan.openerDirection,
    `${name}'s private goal, which nobody else can see: ${plan.agenda}`,
    toolSentence(name, tools),
  ]);
}

function buildPartnerContextItem(
  attempt: IdleNudgeAttempt,
  partner: TomoriState,
  agenda: string,
  tools: readonly string[],
): StructuredContextItem {
  const name = partner.persona_nickname;
  return systemContextItem([
    `${attempt.persona.persona_nickname} just opened a short scene with ${name}.`,
    targetSentence(attempt.target, true),
    `${name}'s private goal, which nobody else can see: ${agenda}`,
    toolSentence(name, tools),
  ]);
}

/**
 * The scripted scene for a Play Scene plan. Each partner's goal also rides on its first turn, so the
 * partner still has it when the opener's agenda rows could not be written or anchored.
 */
function buildNudgeScene(
  attempt: IdleNudgeAttempt,
  plan: IdleNudgePlan,
  anchorId: string,
  tools: readonly string[],
): SceneTurnMetadata | undefined {
  if (!plan.scene) return undefined;
  const { script, partnerAgendas } = plan.scene;
  const speakers = [attempt.persona, ...attempt.partners.map((partner) => partner.persona)];
  const sequence = script.map((speaker) => ({
    personaId: speakers[speaker - 1].persona_id as number,
    personaName: speakers[speaker - 1].persona_nickname,
  }));
  return {
    commandId: `nudge:${attempt.serverId}:${anchorId}`,
    sequence,
    turnIndex: 0,
    totalTurns: sequence.length,
    turnContextItems: script.map((speaker, index) =>
      speaker > 1 && script.indexOf(speaker) === index
        ? [buildPartnerContextItem(attempt, speakers[speaker - 1], partnerAgendas[speaker - 2], tools)]
        : [],
    ),
  };
}

/** One agenda row per speaker, all anchored to the opener. */
function idleNudgeAgendas(
  attempt: IdleNudgeAttempt,
  plan: IdleNudgePlan,
): Array<{ personaId: number; agenda: string }> {
  const partnerAgendas = plan.scene?.partnerAgendas ?? [];
  return [
    { personaId: attempt.persona.persona_id as number, agenda: plan.agenda },
    ...attempt.partners.map((partner, index) => ({
      personaId: partner.persona.persona_id as number,
      agenda: partnerAgendas[index],
    })),
  ];
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
  const placeholder = await seedTurnAnchor(channel, "a Natural Nudges idle nudge");
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

export function isGenerationFailure(result: GenerationTurnResult): boolean {
  return result.status === "error" || result.status === "timeout" || result.status === "empty_response";
}

/**
 * Phases B and C for one attempt. Runs detached from the coordinator cycle so model calls never
 * delay reminders; a restart mid-flight loses only this attempt, and the idle nudge stays due.
 */
export async function runIdleNudgeAttempt(attempt: IdleNudgeAttempt): Promise<AttemptResult> {
  const planned = await planIdleNudge({
    persona: attempt.persona,
    interests: attempt.interests,
    idleNudge: attempt.idleNudge,
    channels: attempt.plannerChannels.map((channel) => ({
      name: channel.channel.name,
      transcript: channel.transcript,
    })),
    plannerModel: attempt.plannerModel,
    target: attempt.target,
    partners: attempt.partners,
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
  const idleNudgeTools = availableIdleNudgeTools(attempt.idleNudge, attempt.availableTools);
  const personaId = attempt.persona.persona_id as number;
  let outcome: AttemptResult | null = null;
  const settle = async (result: GenerationTurnResult): Promise<void> => {
    if (!isDeliveredTurnResult(result)) {
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
    const recorded = await naturalNudgeRepository.recordIdleNudgeFire(
      {
        serverId: attempt.serverId,
        channelDiscId: target.channel.id,
        personaId,
        category: attempt.idleNudge.category,
        idleNudgeKey: attempt.idleNudge.key,
        targetUserId: attempt.target?.userId ?? null,
        openerMessageDiscId: openerId ?? anchor.id,
      },
      openerId ? idleNudgeAgendas(attempt, planned.plan) : [],
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

  const scene = buildNudgeScene(attempt, planned.plan, anchor.id, idleNudgeTools);
  const triggerStartTime = Date.now();
  const disposition: ChatAdmissionDisposition = await tomoriChat({
    client: attempt.client,
    message: anchor,
    isFromQueue: false,
    isManuallyTriggered: true,
    forceReason: false,
    isStopResponse: false,
    selectedPersonaId: personaId,
    triggeredPersonaIds: scene?.sequence.map((speaker) => speaker.personaId),
    isPersonaJob: false,
    isUserImpersonation: false,
    textQuotaSource: "system",
    textQuotaTriggerKey: `nudge:${attempt.serverId}:${anchor.id}`,
    shouldSurfaceUserErrors: false,
    injectedContextItems: [buildOpenerContextItem(attempt, planned.plan, idleNudgeTools)],
    manualSystemPrompt: scene && buildSceneTurnDirective(scene),
    sceneTurn: scene,
    naturalNudge: { toolNames: idleNudgeTools, targetUserDiscId: attempt.target?.userDiscId },
    borrowsTriggerMessage: true,
    onGenerationResult: settle,
  });
  // A scene only talks about its target, so only a lone opener must ping them.
  const pingUserTarget = scene ? null : attempt.target;
  if (outcome === "fired" && pingUserTarget) {
    await ensureDiscordUserMention({
      client: attempt.client,
      channel: target.channel,
      targetUserId: pingUserTarget.userDiscId,
      afterMessageId: anchor.id,
      triggerStartTime,
      contextLabel: `Ping User nudge in server ${attempt.serverId}`,
      fallbackSender: (content) =>
        sendAlterPersonaMention(target.channel, attempt.persona, pingUserTarget.userDiscId, content),
    });
  }
  if (outcome) return outcome;
  log.info(`Natural Nudges: idle nudge not delivered for server ${attempt.serverId} (disposition ${disposition})`);
  sample(attempt, { outcome: "aborted", phase: "c", reason: `admission_${disposition}`, plannerModel, ...usage });
  return "aborted";
}
