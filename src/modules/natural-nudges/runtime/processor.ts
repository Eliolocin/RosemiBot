import type { Client, Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import type {
  EnabledIdleNudgeServer,
  NaturalNudgeFireRow,
  PersonaNaturalNudgeConfig,
} from "@/modules/natural-nudges/db/types";
import { drawPingUserTarget } from "@/modules/natural-nudges/runtime/targets";
import { drawScenePartners, hasScenePartner, type PartnerCandidate } from "@/modules/natural-nudges/runtime/partners";
import { NATURAL_NUDGE_CATEGORIES } from "@/modules/natural-nudges/db/types";
import {
  idleNudgeNeedsTarget,
  isIdleNudgeEligible,
  isInPersonaScope,
  listRunnableIdleNudges,
  type IdleNudgeDefinition,
  type PrerequisiteFacts,
} from "@/modules/natural-nudges/runtime/idleNudges";
import {
  buildPlannerTranscript,
  fetchRecentMessages,
  hasHumanReplyAfter,
  isHangingConversation,
  resolveAllowedChannels,
  resolveEffectiveChannelIds,
  type NudgeChannel,
} from "@/modules/natural-nudges/runtime/channels";
import {
  computeIdleNudgeDueAt,
  computeHeat,
  countUnansweredStreak,
  drawRaffle,
  idleNudgesPerDay,
  idleNudgeTickets,
  heatWindowStart,
  isWithinWakingHours,
  resolveWakingHours,
  restedShare,
  rollIdleNudgeJitter,
  rollLullHours,
  serverDayStart,
} from "@/modules/natural-nudges/runtime/meters";
import {
  AGENDA_RETENTION_MS,
  CATEGORY_REST_MS,
  DAY_MS,
  IDLE_NUDGE_CATEGORY_WEIGHTS,
  IDLE_NUDGE_DAILY_CAPS,
  IDLE_NUDGE_REST_MS,
  FIRE_RETENTION_MS,
  HOUR_MS,
  MAX_PLANNER_CHANNELS,
  MAX_SCANNED_CHANNELS,
  PENDING_WINDOW_MS,
  PERSONA_REST_MS,
  PING_USER_REPEAT_REST_MS,
  PLANNER_HISTORY_MESSAGES,
  TALKATIVENESS_TICKETS,
  UNANSWERED_STOP_STREAK,
  WAKING_HOURS_WINDOW_DAYS,
} from "@/modules/natural-nudges/runtime/tuning";
import { isFailureStopped } from "@/modules/natural-nudges/runtime/failureStop";
import { claimNudgeServer, isNudgeServerBusy, releaseNudgeServer } from "@/modules/natural-nudges/runtime/inFlight";
import { resolvePlannerModel } from "@/modules/natural-nudges/runtime/model";
import { runIdleNudgeAttempt, type IdleNudgeAttempt } from "@/modules/natural-nudges/runtime/runner";
import { recordIdleNudgeSample } from "@/modules/natural-nudges/runtime/telemetry";
import { loadAvailableToolNames } from "@/modules/natural-nudges/runtime/tools";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { statRepository } from "@/utils/db/repositories";
import { whitelistRepository } from "@/utils/db/repositories/WhitelistRepository";
import { log } from "@/utils/misc/logger";
import { runWithErrorContext } from "@/utils/misc/errorContextStore";
import type { WhitelistCheckResult } from "@/types/misc/channelWhitelist";

/** Heat and waking hours move over days, so re-reading them every minute would only cost queries. */
const METER_CACHE_TTL_MS = 15 * 60 * 1000;
/** A pending verdict needs a Discord read, so it is checked at most this often per server. */
const VERDICT_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const PRUNE_INTERVAL_MS = HOUR_MS;
/** Idle nudge rows kept in view beyond the rest window: enough for the unanswered streak and the pending row. */
const LATEST_IDLE_NUDGE_ROWS = UNANSWERED_STOP_STREAK + 2;

type NudgePersona = TomoriState & { persona_id: number };

interface ServerMeters {
  expiresAt: number;
  heat: number;
  awake: boolean[];
  lastMessageSentAt: Date | null;
}

function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function lastFireBy(fires: readonly NaturalNudgeFireRow[], key: (fire: NaturalNudgeFireRow) => string | null) {
  const latest = new Map<string, Date>();
  for (const fire of fires) {
    const value = key(fire);
    if (value === null) continue;
    const seen = latest.get(value);
    if (!seen || seen < fire.fired_at) latest.set(value, fire.fired_at);
  }
  return latest;
}

/**
 * Phase A of Natural Nudges idle nudges: plain code with no model call. It decides whether a server is
 * due, finds a quiet channel, and draws the persona, category, and idle nudge, then hands the attempt
 * to the detached runner.
 */
export class NaturalNudgeProcessor {
  private readonly client: Client;
  /** After an abort the idle nudge waits a fresh lull before trying again, so it cannot loop every cycle. */
  private readonly retryNotBefore = new Map<number, number>();
  private readonly lullHours = new Map<number, number>();
  private readonly verdictCheckedAt = new Map<number, number>();
  private readonly meters = new Map<number, ServerMeters>();
  private lastPruneAt = 0;

  constructor(client: Client) {
    this.client = client;
  }

  public async processDueIdleNudges(): Promise<void> {
    if (!this.client.isReady()) return;
    await this.pruneIfDue();
    let servers: EnabledIdleNudgeServer[];
    try {
      servers = await naturalNudgeRepository.listEnabledIdleNudgeServers(heatWindowStart(new Date()));
    } catch (error) {
      log.error("Natural Nudges: failed to list enabled servers", error);
      return;
    }
    for (const server of servers) {
      if (isNudgeServerBusy(server.server_id)) continue;
      try {
        await runWithErrorContext({ source: "natural_nudge", serverId: server.server_id }, () =>
          this.evaluateServer(server),
        );
      } catch (error) {
        await log.error("Natural Nudges: idle nudge evaluation failed", error, { serverId: server.server_id });
      }
    }
  }

  private async pruneIfDue(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPruneAt < PRUNE_INTERVAL_MS) return;
    this.lastPruneAt = now;
    try {
      await naturalNudgeRepository.pruneBefore(new Date(now - FIRE_RETENTION_MS), new Date(now - AGENDA_RETENTION_MS));
    } catch (error) {
      log.warn("Natural Nudges: pruning failed", error);
    }
  }

  private async loadMeters(serverId: number, timezoneOffset: number, now: Date): Promise<ServerMeters> {
    const cached = this.meters.get(serverId);
    if (cached && cached.expiresAt > now.getTime()) return cached;
    const [dailyCounts, histogram, lastMessageSentAt] = await Promise.all([
      statRepository.getServerDailyMessageCounts({ serverId, from: heatWindowStart(now) }),
      statRepository.getServerActiveHourHistogram({
        serverId,
        from: new Date(now.getTime() - WAKING_HOURS_WINDOW_DAYS * DAY_MS),
      }),
      statRepository.getServerMetricLastAt({ serverId, metric: "message_sent" }),
    ]);
    const meters = {
      expiresAt: now.getTime() + METER_CACHE_TTL_MS,
      heat: computeHeat(dailyCounts, now),
      awake: resolveWakingHours(histogram, timezoneOffset),
      lastMessageSentAt,
    };
    this.meters.set(serverId, meters);
    return meters;
  }

  /** An abort leaves the idle nudge due; the next try waits a fresh lull roll from now. */
  private deferRetry(serverId: number, now: Date): void {
    const hours = rollLullHours();
    this.lullHours.set(serverId, hours);
    this.retryNotBefore.set(serverId, now.getTime() + hours * HOUR_MS);
  }

  private abortInPhaseA(server: EnabledIdleNudgeServer, now: Date, reason: string, heat: number): void {
    recordIdleNudgeSample({ serverId: server.server_id, outcome: "aborted", phase: "a", reason, heat });
    this.deferRetry(server.server_id, now);
  }

  private async resolvePending(fire: NaturalNudgeFireRow, now: Date): Promise<void> {
    const checkedAt = this.verdictCheckedAt.get(fire.server_id) ?? 0;
    if (now.getTime() - checkedAt < VERDICT_CHECK_INTERVAL_MS) return;
    this.verdictCheckedAt.set(fire.server_id, now.getTime());
    const channel = this.client.channels.cache.get(fire.channel_disc_id);
    const answered =
      channel?.isTextBased() && !channel.isDMBased()
        ? await hasHumanReplyAfter(channel, fire.opener_message_disc_id)
        : false;
    if (answered) await naturalNudgeRepository.setFireAnswered(fire.fire_id, true);
    else if (now.getTime() - fire.fired_at.getTime() >= PENDING_WINDOW_MS)
      await naturalNudgeRepository.setFireAnswered(fire.fire_id, false);
  }

  private async evaluateServer(server: EnabledIdleNudgeServer): Promise<void> {
    const now = new Date();
    const serverId = server.server_id;
    const { config } = server;
    if ((this.retryNotBefore.get(serverId) ?? 0) > now.getTime()) return;

    const history = await naturalNudgeRepository.loadFireHistory(
      serverId,
      new Date(now.getTime() - IDLE_NUDGE_REST_MS),
      LATEST_IDLE_NUDGE_ROWS,
    );
    const pending = history.latestIdleNudges.find((fire) => fire.answered === null);
    if (pending) {
      await this.resolvePending(pending, now);
      return;
    }

    const runtime = await naturalNudgeRepository.loadRuntimeState(serverId);
    if (await isFailureStopped(serverId, runtime.stopped_at)) return;

    const timezoneOffset = server.timezone_offset ?? 0;
    const meters = await this.loadMeters(serverId, timezoneOffset, now);
    const streak = countUnansweredStreak(history.latestIdleNudges, meters.lastMessageSentAt);
    if (streak >= UNANSWERED_STOP_STREAK) return;
    const perDay = idleNudgesPerDay(meters.heat, config.idle_nudge_frequency);
    const dueAt = computeIdleNudgeDueAt({
      lastIdleNudgeAt: history.latestIdleNudges[0]?.fired_at ?? null,
      perDay,
      jitter: runtime.idle_nudge_jitter,
      unansweredStreak: streak,
    });
    if (!dueAt || now < dueAt) return;
    const dayStart = serverDayStart(now, timezoneOffset);
    const firedToday = history.recent.filter((fire) => fire.mode === "idle" && fire.fired_at >= dayStart).length;
    if (firedToday >= IDLE_NUDGE_DAILY_CAPS[config.idle_nudge_frequency]) return;
    if (!isWithinWakingHours(meters.awake, now, serverId)) return;

    const personas = (await getCachedAllPersonas(server.server_disc_id)).filter(
      (persona): persona is NudgePersona => typeof persona.persona_id === "number",
    );
    // Skipped under user BYOK because no server key exists to pay for a turn nobody requested.
    if (personas.length === 0 || personas[0].config.user_byok_mode) return;

    let lull = this.lullHours.get(serverId);
    if (lull === undefined) {
      lull = rollLullHours();
      this.lullHours.set(serverId, lull);
    }
    const lullMs = lull * HOUR_MS;
    const channelIds = await resolveEffectiveChannelIds(serverId, config, now);
    const quiet = (await resolveAllowedChannels(this.client, channelIds)).filter(
      (channel) => channel.quietSinceMs === null || now.getTime() - channel.quietSinceMs >= lullMs,
    );
    if (quiet.length === 0) return;
    // Resolving decrypts the server key in Postgres, so it waits for a quiet channel and backs off on failure.
    const plannerModel = await resolvePlannerModel(personas[0], config.llm_id);
    if (plannerModel.kind !== "ready") {
      this.abortInPhaseA(server, now, "no_model", meters.heat);
      return;
    }

    const attempt = await this.drawAttempt(server, personas, quiet, history.recent, meters, plannerModel.llmId, now);
    if (typeof attempt === "string") {
      this.abortInPhaseA(server, now, attempt, meters.heat);
      return;
    }

    if (!claimNudgeServer(serverId)) return;
    void runIdleNudgeAttempt(attempt)
      .then((result) => {
        if (result === "fired") {
          this.lullHours.delete(serverId);
          this.retryNotBefore.delete(serverId);
          return naturalNudgeRepository.setIdleNudgeJitter(serverId, rollIdleNudgeJitter());
        }
        this.deferRetry(serverId, new Date());
      })
      .catch(async (error) => {
        this.deferRetry(serverId, new Date());
        await log.error("Natural Nudges: idle nudge attempt failed", error, { serverId });
      })
      .finally(() => releaseNudgeServer(serverId));
  }

  /** Persona first, then category and idle nudge for that persona, so identity never depends on opportunity. */
  private async drawAttempt(
    server: EnabledIdleNudgeServer,
    personas: NudgePersona[],
    quiet: NudgeChannel[],
    recentFires: readonly NaturalNudgeFireRow[],
    meters: ServerMeters,
    plannerLlmId: number,
    now: Date,
  ): Promise<IdleNudgeAttempt | string> {
    const scanned = shuffled(quiet).slice(0, MAX_SCANNED_CHANNELS);
    const whitelists = new Map<string, WhitelistCheckResult>();
    for (const channel of scanned) {
      whitelists.set(
        channel.channel.id,
        await whitelistRepository.checkChannelWhitelist(server.server_disc_id, channel.channel.id),
      );
    }
    const channelsFor = (personaId: number) =>
      scanned.filter((channel) =>
        whitelistRepository.isPersonaAllowedByWhitelistStatus(whitelists.get(channel.channel.id), personaId),
      );

    const personaConfigs = await naturalNudgeRepository.loadPersonaConfigs(personas.map((p) => p.persona_id));
    const personaFiredAt = lastFireBy(recentFires, (fire) => String(fire.persona_id));
    const personaTickets = (candidate: NudgePersona) =>
      (TALKATIVENESS_TICKETS[personaConfigs.get(candidate.persona_id)?.talkativeness ?? 0] ?? 0) *
      restedShare(personaFiredAt.get(String(candidate.persona_id)), now, PERSONA_REST_MS);
    const persona = drawRaffle(
      personas.map((candidate) => ({
        item: candidate,
        tickets: channelsFor(candidate.persona_id).length > 0 ? personaTickets(candidate) : 0,
      })),
    );
    if (!persona) return "no_eligible_persona";
    const personaConfig = personaConfigs.get(persona.persona_id) as PersonaNaturalNudgeConfig;

    const personaChannels = channelsFor(persona.persona_id);
    const partnerCandidates: PartnerCandidate<NudgePersona>[] = personas
      .filter((candidate) => candidate.persona_id !== persona.persona_id)
      .map((candidate) => ({
        persona: candidate,
        tickets: personaTickets(candidate),
        channelIds: new Set(channelsFor(candidate.persona_id).map((channel) => channel.channel.id)),
      }));
    const histories = new Map<string, Message[]>();
    for (const channel of personaChannels) {
      histories.set(channel.channel.id, await fetchRecentMessages(channel.channel, PLANNER_HISTORY_MESSAGES));
    }
    const hanging = personaChannels.filter((channel) =>
      isHangingConversation(histories.get(channel.channel.id) ?? [], personas, this.client.user?.id, now),
    );
    const [customs, scopes] = await Promise.all([
      naturalNudgeRepository.listCustomIdleNudges(server.server_id),
      naturalNudgeRepository.loadPersonaScopes(server.server_id),
    ]);
    const runnable = listRunnableIdleNudges(server.config.disabled_builtin_idle_nudges, customs).filter((idleNudge) =>
      isInPersonaScope(idleNudge.key, persona.persona_id, scopes),
    );
    const guild = this.client.guilds.cache.get(server.server_disc_id);
    if (!guild) return "guild_unavailable";
    // The draw reads memories and fetches members, so it waits until some runnable idle nudge could ping.
    const target = runnable.some(idleNudgeNeedsTarget)
      ? await drawPingUserTarget({
          client: this.client,
          guild,
          serverId: server.server_id,
          persona,
          channels: personaChannels,
          recentFires,
          now,
        })
      : null;
    const facts: PrerequisiteFacts = {
      hasHangingConversation: hanging.length > 0,
      hasScenePartner: hasScenePartner(
        partnerCandidates,
        personaChannels.map((channel) => channel.channel.id),
      ),
      availableTools: await loadAvailableToolNames(persona),
      target: target && { hasRecentMemories: target.recentMemories.length > 0, isActive: target.activity !== null },
    };

    const idleNudges = runnable.filter((idleNudge) => isIdleNudgeEligible(idleNudge, facts));
    const categoryFiredAt = lastFireBy(recentFires, (fire) => fire.category);
    const category = drawRaffle(
      NATURAL_NUDGE_CATEGORIES.map((candidate) => ({
        item: candidate,
        tickets: idleNudges.some((idleNudge) => idleNudge.category === candidate)
          ? IDLE_NUDGE_CATEGORY_WEIGHTS[candidate] * restedShare(categoryFiredAt.get(candidate), now, CATEGORY_REST_MS)
          : 0,
      })),
    );
    if (!category) return "no_eligible_idle_nudge";
    const categoryIdleNudges = idleNudges.filter((candidate) => candidate.category === category);
    const idleNudgeFiredAt = lastFireBy(recentFires, (fire) => fire.idle_nudge_key);
    const targetFiredAt =
      target && categoryIdleNudges.some(idleNudgeNeedsTarget)
        ? await naturalNudgeRepository.loadTargetIdleNudgeFires(
            server.server_id,
            persona.persona_id,
            target.userId,
            new Date(now.getTime() - PING_USER_REPEAT_REST_MS),
          )
        : new Map<string, Date>();
    const idleNudge = drawRaffle<IdleNudgeDefinition>(
      categoryIdleNudges.map((candidate) => ({
        item: candidate,
        tickets: idleNudgeTickets(
          candidate,
          idleNudgeFiredAt.get(candidate.key),
          targetFiredAt.get(candidate.key),
          now,
        ),
      })),
    );
    if (!idleNudge) return "no_eligible_idle_nudge";

    const idleNudgeTarget = idleNudgeNeedsTarget(idleNudge) ? target : null;
    let pool = idleNudgeTarget
      ? personaChannels.filter((channel) => idleNudgeTarget.channelIds.includes(channel.channel.id))
      : category === "revive_topic"
        ? hanging
        : personaChannels;
    let partners: NudgePersona[] = [];
    if (category === "play_scene") {
      const scene = drawScenePartners(
        partnerCandidates,
        pool.map((channel) => channel.channel.id),
      );
      if (!scene) return "no_scene_partner";
      partners = scene.partners;
      pool = pool.filter((channel) => scene.channelIds.includes(channel.channel.id));
    }
    const plannerChannels = await this.choosePlannerChannels(pool, persona, histories, server.server_disc_id, now);
    if (plannerChannels.length === 0) return "no_planner_channel";

    return {
      client: this.client,
      serverId: server.server_id,
      serverDiscId: server.server_disc_id,
      timezoneOffset: server.timezone_offset ?? 0,
      heat: meters.heat,
      awake: meters.awake,
      persona,
      interests: personaConfig.interests,
      idleNudge,
      plannerLlmId,
      availableTools: facts.availableTools,
      plannerChannels,
      target: idleNudgeTarget,
      partners: partners.map((partner) => ({
        persona: partner,
        interests: personaConfigs.get(partner.persona_id)?.interests ?? [],
      })),
    };
  }

  /**
   * Up to three channels for the planner to choose from. A private channel is offered alone, because
   * its content may only feed a nudge in that same channel.
   */
  private async choosePlannerChannels(
    pool: readonly NudgeChannel[],
    persona: TomoriState,
    histories: ReadonlyMap<string, Message[]>,
    guildId: string,
    now: Date,
  ): Promise<Array<NudgeChannel & { transcript: string }>> {
    const privateIds = new Set(persona.config.private_channel_ids ?? []);
    const [first, ...rest] = shuffled(pool);
    if (!first) return [];
    const chosen = privateIds.has(first.channel.id)
      ? [first]
      : [first, ...rest.filter((channel) => !privateIds.has(channel.channel.id))].slice(0, MAX_PLANNER_CHANNELS);
    return Promise.all(
      chosen.map(async (channel) => ({
        ...channel,
        transcript: await buildPlannerTranscript(histories.get(channel.channel.id) ?? [], guildId, now),
      })),
    );
  }
}
