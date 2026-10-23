import { PermissionFlagsBits, type Client, type GuildTextBasedChannel, type Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import type { NaturalNudgeFireRow, PersonaNaturalNudgeConfig } from "@/modules/natural-nudges/db/types";
import {
  buildMatcherEvidence,
  fetchRecentMessages,
  isHumanMessage,
  resolveEffectiveChannelIds,
} from "@/modules/natural-nudges/runtime/channels";
import { readActiveNudgeGate } from "@/modules/natural-nudges/runtime/configCache";
import { isFailureStopped } from "@/modules/natural-nudges/runtime/failureStop";
import { claimNudgeServer, releaseNudgeServer } from "@/modules/natural-nudges/runtime/inFlight";
import {
  matchActiveNudge,
  matcherOptionId,
  resolveMatcherBackend,
  type MatcherBackend,
  type MatcherOption,
  type MatcherResult,
} from "@/modules/natural-nudges/runtime/matcher";
import {
  activeNudgeTripRange,
  drawRaffle,
  restedShare,
  serverDayStart,
  underdogBoost,
} from "@/modules/natural-nudges/runtime/meters";
import { isGenerationFailure, systemContextItem, type AttemptResult } from "@/modules/natural-nudges/runtime/runner";
import { recordActiveNudgeSample, type ActiveNudgeSample } from "@/modules/natural-nudges/runtime/telemetry";
import {
  ACTIVE_NUDGE_DAILY_CAPS,
  ACTIVE_NUDGE_DAILY_CHECK_CAPS,
  ACTIVE_NUDGE_DELAY_MAX_MS,
  ACTIVE_NUDGE_DELAY_MIN_MS,
  ACTIVE_NUDGE_DETOUR_CHANCE,
  ACTIVE_NUDGE_DETOUR_WARM_DAYS,
  ACTIVE_NUDGE_EMPTY_REST_MAX_MS,
  ACTIVE_NUDGE_EMPTY_REST_MS,
  ACTIVE_NUDGE_OPTION_BUDGET,
  ACTIVE_NUDGE_QUOTA_PAUSE_MS,
  ACTIVE_NUDGE_STALE_HUMAN_MESSAGES,
  ACTIVE_NUDGE_UNDERDOG_DAYS,
  ACTIVE_NUDGE_WINDOW_MESSAGES,
  DAY_MS,
  HOUR_MS,
  PERSONA_REST_MS,
  TALKATIVENESS_TICKETS,
} from "@/modules/natural-nudges/runtime/tuning";
import { isChannelProcessingLocked, tomoriChat } from "@/events/messageCreate/tomoriChat";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { isDeliveredTurnResult } from "@/utils/chat/postTurnEffects";
import type { GenerationTurnResult } from "@/utils/chat/types";
import {
  getCachedImpersonatedUserIdForWebhook,
  resolvePersonaForMessage,
  verifyMessageWebhook,
} from "@/utils/chat/webhookIdentity";
import { statRepository } from "@/utils/db/repositories";
import { personaRepository } from "@/utils/db/repositories/PersonaRepository";
import { whitelistRepository } from "@/utils/db/repositories/WhitelistRepository";
import { rollAutochatTarget } from "@/utils/discord/autoTriggerThreshold";
import { runWithErrorContext } from "@/utils/misc/errorContextStore";
import { log } from "@/utils/misc/logger";

type NudgePersona = TomoriState & { persona_id: number };

interface ChannelCounter {
  count: number;
  target: number;
  /** Nonzero while the channel rests after a check; counting starts over with a new roll afterwards. */
  restUntil: number;
}

/**
 * Human messages per listed channel since a persona last spoke there, a thread counting toward its
 * parent. Kept in memory, because a restart only resets the counts to 0, which delays the next check
 * slightly.
 */
class ActiveNudgeCounter {
  private readonly channels = new Map<string, ChannelCounter>();
  /** Empty checks in a row per channel, which double the next rest; a fire clears it. */
  private readonly emptyStreaks = new Map<string, number>();

  isTracking(channelId: string): boolean {
    return this.channels.has(channelId);
  }

  /** A persona spoke, so the conversation has Tomori in it again; a rest still runs out first. */
  reset(channelId: string, now: number): void {
    const counter = this.channels.get(channelId);
    if (!counter || counter.restUntil <= now) this.channels.delete(channelId);
  }

  /** True when this message trips a check; the next message then starts a fresh roll. */
  recordHuman(
    channelId: string,
    range: { min: number; max: number },
    now: number,
    roll: (min: number, max: number) => number = rollAutochatTarget,
  ): boolean {
    let counter = this.channels.get(channelId);
    if (counter && counter.restUntil > now) return false;
    if (!counter || counter.restUntil !== 0) {
      counter = { count: 0, target: roll(range.min, range.max), restUntil: 0 };
      this.channels.set(channelId, counter);
    }
    counter.count++;
    if (counter.count < counter.target) return false;
    this.channels.delete(channelId);
    return true;
  }

  rest(channelId: string, now: number): void {
    const streak = (this.emptyStreaks.get(channelId) ?? 0) + 1;
    this.emptyStreaks.set(channelId, streak);
    const restMs = Math.min(ACTIVE_NUDGE_EMPTY_REST_MS * 2 ** (streak - 1), ACTIVE_NUDGE_EMPTY_REST_MAX_MS);
    this.channels.set(channelId, { count: 0, target: 0, restUntil: now + restMs });
  }

  fired(channelId: string): void {
    this.emptyStreaks.delete(channelId);
  }
}

/**
 * Checker calls per server per server-day, and quota pauses. Kept in memory like the counter, so a
 * restart forgets the day's count; raise to a stored count if restarts ever become frequent enough to
 * matter for a key's daily quota.
 */
export class ActiveNudgeCheckBudget {
  private readonly days = new Map<number, { dayStart: number; used: number }>();
  private readonly pausedUntil = new Map<number, number>();

  /** Spends one checker call, or returns false when the server already spent its cap today. */
  take(serverId: number, dayStart: Date, cap: number): boolean {
    const start = dayStart.getTime();
    const day = this.days.get(serverId);
    const used = day?.dayStart === start ? day.used : 0;
    if (used >= cap) return false;
    this.days.set(serverId, { dayStart: start, used: used + 1 });
    return true;
  }

  pause(serverId: number, now: number): void {
    this.pausedUntil.set(serverId, now + ACTIVE_NUDGE_QUOTA_PAUSE_MS);
  }

  isPaused(serverId: number, now: number): boolean {
    const until = this.pausedUntil.get(serverId);
    if (until === undefined) return false;
    if (until > now) return true;
    this.pausedUntil.delete(serverId);
    return false;
  }
}

/** What happened in a channel after its check started, which decides whether the moment is still there. */
interface ChannelWatch {
  humans: number;
  personaSpoke: boolean;
}

const counter = new ActiveNudgeCounter();
const checkBudget = new ActiveNudgeCheckBudget();
const watches = new Map<string, ChannelWatch>();

async function isPersonaMessage(client: Client, message: Message): Promise<boolean> {
  if (!message.webhookId) return message.author.id === client.user?.id;
  return (await verifyMessageWebhook(message)) && !getCachedImpersonatedUserIdForWebhook(message.webhookId);
}

export interface ActiveNudgeCheck {
  client: Client;
  channel: GuildTextBasedChannel;
  /** The allow-listed channel: the channel itself, or a thread's parent. */
  listedChannelId: string;
  guildId: string;
  serverId: number;
  heat: number;
}

/**
 * The cheap part of Active Nudges, run on every guild message: count human messages in allowed channels,
 * reset on persona messages, and start one check when the rolled count trips.
 */
export async function observeActiveNudgeMessage(client: Client, message: Message): Promise<void> {
  if (!message.inGuild() || message.system) return;
  const channel = message.channel;
  const channelId = channel.id;
  const listedChannelId = channel.isThread() ? channel.parentId : channelId;
  if (!listedChannelId) return;
  if (!isHumanMessage(message)) {
    // Only a channel already counting or watched has anything to reset, so other bot traffic costs nothing.
    if (!counter.isTracking(listedChannelId) && !watches.has(channelId)) return;
    if (!(await isPersonaMessage(client, message))) return;
    counter.reset(listedChannelId, Date.now());
    const watch = watches.get(channelId);
    if (watch) watch.personaSpoke = true;
    return;
  }
  const watch = watches.get(channelId);
  if (watch) watch.humans++;

  const gate = await readActiveNudgeGate(message.guildId);
  if (!gate?.config.active_nudges_enabled || !gate.channelIds.has(listedChannelId)) return;
  if (checkBudget.isPaused(gate.serverId, Date.now())) return;
  const range = activeNudgeTripRange(gate.heat, gate.config.active_nudge_frequency);
  if (!range || !counter.recordHuman(listedChannelId, range, Date.now())) return;
  if (!claimNudgeServer(gate.serverId)) return;

  const check: ActiveNudgeCheck = {
    client,
    channel,
    listedChannelId,
    guildId: message.guildId,
    serverId: gate.serverId,
    heat: gate.heat,
  };
  void runWithErrorContext({ source: "natural_nudge", serverId: gate.serverId }, () => runActiveNudgeCheck(check))
    .then((result) => {
      if (result === "fired") counter.fired(listedChannelId);
      else counter.rest(listedChannelId, Date.now());
    })
    .catch(async (error) => {
      counter.rest(listedChannelId, Date.now());
      await log.error("Natural Nudges: Active Nudge check failed", error, { serverId: gate.serverId });
    })
    .finally(() => releaseNudgeServer(gate.serverId));
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

/**
 * Interests of the eligible personas as matcher options, one per distinct label, with every persona
 * that holds it. Personas whose new labels would overflow the budget sit this check out.
 */
export function buildMatcherOptions(
  personas: readonly NudgePersona[],
  configs: ReadonlyMap<number, PersonaNaturalNudgeConfig>,
  random: () => number = Math.random,
): { options: MatcherOption[]; owners: Map<string, NudgePersona[]> } {
  const byLabel = new Map<string, { option: MatcherOption; owners: NudgePersona[] }>();
  const labelKey = (label: string) => label.trim().toLowerCase();
  for (const persona of shuffled(personas, random)) {
    const interests = configs.get(persona.persona_id)?.interests ?? [];
    const added = new Set(interests.map((interest) => labelKey(interest.label)).filter((key) => !byLabel.has(key)));
    if (byLabel.size + added.size > ACTIVE_NUDGE_OPTION_BUDGET) continue;
    for (const interest of interests) {
      const key = labelKey(interest.label);
      let entry = byLabel.get(key);
      if (!entry) {
        entry = {
          option: { id: matcherOptionId(byLabel.size), text: `${interest.label}: ${interest.description}` },
          owners: [],
        };
        byLabel.set(key, entry);
      }
      if (!entry.owners.includes(persona)) entry.owners.push(persona);
    }
  }
  const entries = [...byLabel.values()];
  return {
    options: entries.map((entry) => entry.option),
    owners: new Map(entries.map((entry) => [entry.option.id, entry.owners])),
  };
}

/** Personas who already spoke in the matcher's window; none of them may take the turn. */
function spokeInWindow(
  window: readonly Message[],
  personas: readonly TomoriState[],
  clientUserId: string | undefined,
): Set<number> {
  const spoke = new Set<number>();
  for (const message of window) {
    const personaId = resolvePersonaForMessage(message, personas, clientUserId)?.persona_id;
    if (typeof personaId === "number") spoke.add(personaId);
  }
  return spoke;
}

/**
 * A fire row stores where it spoke, so a thread fire is mapped back to its parent. A thread that left
 * the cache counts on its own; one that fired within the hour is almost always still cached.
 */
function listedChannelOf(client: Client, channelId: string): string {
  const channel = client.channels.cache.get(channelId);
  return channel?.isThread() ? (channel.parentId ?? channelId) : channelId;
}

interface CheckSettings {
  backend: MatcherBackend;
  recentFires: NaturalNudgeFireRow[];
  dayStart: Date;
  checkCap: number;
}

/** The fresh-read checks Phase A and the re-check share; a string names the abort reason. */
async function checkSettingsAndCaps(
  check: ActiveNudgeCheck,
  personas: readonly NudgePersona[],
  now: Date,
): Promise<CheckSettings | string> {
  const config = await naturalNudgeRepository.loadServerConfig(check.serverId);
  if (!config.active_nudges_enabled) return "disabled";
  if (!(await resolveEffectiveChannelIds(check.serverId, config, now)).includes(check.listedChannelId))
    return "channel_removed";
  const { stopped_at: stoppedAt } = await naturalNudgeRepository.loadRuntimeState(check.serverId);
  if (await isFailureStopped(check.serverId, stoppedAt)) return "stopped";
  if (personas.length === 0 || personas[0].config.user_byok_mode) return "no_server_key";
  const me = check.channel.guild.members.me;
  const sendPermission = check.channel.isThread()
    ? PermissionFlagsBits.SendMessagesInThreads
    : PermissionFlagsBits.SendMessages;
  if (!me || !check.channel.permissionsFor(me)?.has(sendPermission)) return "no_send_permission";
  const history = await naturalNudgeRepository.loadFireHistory(
    check.serverId,
    new Date(now.getTime() - PERSONA_REST_MS),
    1,
  );
  const activeNudges = history.recent.filter((fire) => fire.mode === "active");
  const dayStart = serverDayStart(now, personas[0].config.timezone_offset ?? 0);
  if (
    activeNudges.filter((fire) => fire.fired_at >= dayStart).length >=
    ACTIVE_NUDGE_DAILY_CAPS[config.active_nudge_frequency]
  )
    return "cap_reached";
  if (
    activeNudges.some(
      (fire) =>
        listedChannelOf(check.client, fire.channel_disc_id) === check.listedChannelId &&
        now.getTime() - fire.fired_at.getTime() < HOUR_MS,
    )
  )
    return "channel_cap";
  const { backend } = await resolveMatcherBackend(personas[0], config);
  if (!backend) return "no_matcher";
  return {
    backend,
    recentFires: history.recent,
    dayStart,
    checkCap: ACTIVE_NUDGE_DAILY_CHECK_CAPS[config.active_nudge_frequency],
  };
}

/** Personas that may speak here: talkativeness above 0 and allowed in the channel. */
async function loadSpeakers(
  check: ActiveNudgeCheck,
  personas: readonly NudgePersona[],
): Promise<{ speakers: NudgePersona[]; configs: Map<number, PersonaNaturalNudgeConfig> }> {
  const parentId = check.channel.isThread() ? (check.channel.parentId ?? undefined) : undefined;
  const [whitelist, configs] = await Promise.all([
    whitelistRepository.checkChannelWhitelist(check.guildId, check.channel.id, undefined, parentId),
    naturalNudgeRepository.loadPersonaConfigs(personas.map((persona) => persona.persona_id)),
  ]);
  const speakers = personas.filter(
    (persona) =>
      (configs.get(persona.persona_id)?.talkativeness ?? 0) > 0 &&
      whitelistRepository.isPersonaAllowedByWhitelistStatus(whitelist, persona.persona_id),
  );
  return { speakers, configs };
}

function personaTickets(
  persona: NudgePersona,
  configs: ReadonlyMap<number, PersonaNaturalNudgeConfig>,
  recentFires: readonly NaturalNudgeFireRow[],
  now: Date,
): number {
  const lastFire = recentFires
    .filter((fire) => fire.persona_id === persona.persona_id)
    .reduce<Date | undefined>(
      (latest, fire) => (!latest || fire.fired_at > latest ? fire.fired_at : latest),
      undefined,
    );
  return (
    (TALKATIVENESS_TICKETS[configs.get(persona.persona_id)?.talkativeness ?? 0] ?? 0) *
    restedShare(lastFire, now, PERSONA_REST_MS)
  );
}

/**
 * Another warm persona takes the turn. Rarely-talked-to personas get more tickets, and replies to a
 * detour raise their count, so the boost corrects itself.
 */
async function drawDetour(
  check: ActiveNudgeCheck,
  excluded: ReadonlySet<number>,
  speakers: readonly NudgePersona[],
  configs: ReadonlyMap<number, PersonaNaturalNudgeConfig>,
  recentFires: readonly NaturalNudgeFireRow[],
  now: Date,
  random: () => number,
): Promise<NudgePersona | null> {
  const others = speakers.filter((persona) => !excluded.has(persona.persona_id));
  if (others.length === 0) return null;
  const [warm, month] = await Promise.all([
    statRepository.getServerPersonaMessageCounts({
      serverId: check.serverId,
      from: new Date(now.getTime() - ACTIVE_NUDGE_DETOUR_WARM_DAYS * DAY_MS),
    }),
    statRepository.getServerPersonaMessageCounts({
      serverId: check.serverId,
      from: new Date(now.getTime() - ACTIVE_NUDGE_UNDERDOG_DAYS * DAY_MS),
    }),
  ]);
  const topCount = Math.max(0, ...month.values());
  return drawRaffle(
    others
      .filter((persona) => (warm.get(persona.persona_lineage_id) ?? 0) > 0)
      .map((persona) => ({
        item: persona,
        tickets:
          personaTickets(persona, configs, recentFires, now) *
          underdogBoost(month.get(persona.persona_lineage_id) ?? 0, topCount),
      })),
    random,
  );
}

export interface ActiveNudgeCheckOptions {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  budget?: ActiveNudgeCheckBudget;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One Active Nudge check: Phase A reads fresh settings and caps, one matcher call picks an interest or
 * `none`, and after a short delay the re-check confirms the moment before a plain turn. Any doubt
 * resolves to saying nothing.
 */
export async function runActiveNudgeCheck(
  check: ActiveNudgeCheck,
  options: ActiveNudgeCheckOptions = {},
): Promise<AttemptResult> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const budget = options.budget ?? checkBudget;
  const telemetry: Omit<ActiveNudgeSample, "outcome" | "phase" | "reason"> = {
    serverId: check.serverId,
    heat: check.heat,
    rematched: false,
  };
  const finish = (outcome: AttemptResult, phase: "a" | "c", reason: string): AttemptResult => {
    recordActiveNudgeSample({ ...telemetry, outcome, phase, reason });
    return outcome;
  };

  // Opened before the first await, so a persona reply during the Phase A reads still counts.
  const watch: ChannelWatch = { humans: 0, personaSpoke: false };
  watches.set(check.channel.id, watch);
  try {
    const now = new Date();
    const personas = (await getCachedAllPersonas(check.guildId)).filter(
      (persona): persona is NudgePersona => typeof persona.persona_id === "number",
    );
    const settings = await checkSettingsAndCaps(check, personas, now);
    if (typeof settings === "string") return finish("aborted", "a", settings);
    const { speakers, configs } = await loadSpeakers(check, personas);
    const { options: matcherOptions, owners } = buildMatcherOptions(speakers, configs, random);
    if (matcherOptions.length === 0) return finish("aborted", "a", "no_interests");
    const window = await fetchRecentMessages(check.channel, ACTIVE_NUDGE_WINDOW_MESSAGES);
    const evidence = await buildMatcherEvidence(window, check.guildId);
    if (!evidence) return finish("aborted", "a", "no_evidence");
    if (!budget.take(check.serverId, settings.dayStart, settings.checkCap))
      return finish("aborted", "a", "check_cap_reached");

    const matched: MatcherResult = await matchActiveNudge({
      state: personas[0],
      backend: settings.backend,
      options: matcherOptions,
      evidence,
    });
    Object.assign(telemetry, {
      matcherKind: matched.kind,
      matcherModel: matched.model || undefined,
      optionCount: matcherOptions.length,
      margin: matched.margin,
      matcherInputTokens: matched.usage?.inputTokens,
      matcherOutputTokens: matched.usage?.outputTokens,
    });
    if (matched.rateLimited) budget.pause(check.serverId, Date.now());
    // Not counted toward the failure stop, so a broken matcher cannot also stop the server's idle nudges.
    if (matched.reason === "failed") return finish("failed", "a", "matcher_failed");
    if (!matched.choice) return finish("aborted", "a", `matcher_${matched.reason}`);
    const spoke = spokeInWindow(window, personas, check.client.user?.id);
    const winners = (owners.get(matched.choice) ?? []).filter((owner) => !spoke.has(owner.persona_id));
    if (winners.length === 0) return finish("aborted", "a", "winner_spoke");
    const winner =
      drawRaffle(
        winners.map((persona) => ({
          item: persona,
          tickets: personaTickets(persona, configs, settings.recentFires, now),
        })),
        random,
      ) ?? winners[0];
    const detour =
      random() < ACTIVE_NUDGE_DETOUR_CHANCE
        ? await drawDetour(
            check,
            new Set([...spoke, winner.persona_id]),
            speakers,
            configs,
            settings.recentFires,
            now,
            random,
          )
        : null;
    const speaker = detour ?? winner;
    telemetry.detour = detour !== null;

    const delayMs = ACTIVE_NUDGE_DELAY_MIN_MS + random() * (ACTIVE_NUDGE_DELAY_MAX_MS - ACTIVE_NUDGE_DELAY_MIN_MS);
    const interest = matcherOptions.find((option) => option.id === matched.choice)?.text ?? matched.choice;
    log.info(
      `Natural Nudges: Active Nudge queued for ${speaker.persona_nickname} in channel ${check.channel.id} ` +
        `(interest "${interest}"${detour ? `, detour from ${winner.persona_nickname}` : ""}, ` +
        `speaking in ${Math.round(delayMs / 1000)} s unless the moment passes)`,
    );
    await sleep(delayMs);

    const recheck = await recheckBeforeSend(check, speaker, watch, budget, {
      options: matcherOptions,
      choice: matched.choice,
    });
    if (recheck.rematch) {
      telemetry.rematched = true;
      telemetry.rematchInputTokens = recheck.rematch.usage?.inputTokens;
      telemetry.rematchOutputTokens = recheck.rematch.usage?.outputTokens;
    }
    if (recheck.reason) return finish("aborted", "c", recheck.reason);
    return await speak(check, speaker, interest, detour !== null, finish);
  } finally {
    if (watches.get(check.channel.id) === watch) watches.delete(check.channel.id);
  }
}

/** The Phase A matcher inputs the re-check repeats, so the second call's interest ID means the same interest. */
interface RematchPlan {
  options: readonly MatcherOption[];
  choice: string;
}

interface RecheckOutcome {
  /** Abort reason, or null when the moment is still there. */
  reason: string | null;
  /** The one extra matcher call made when the delay filled the Phase A evidence window. */
  rematch?: MatcherResult;
}

/**
 * The cheap checks again, read fresh, after the delay; when new human messages filled the evidence
 * window, the matcher runs once more and only the same interest may speak.
 */
async function recheckBeforeSend(
  check: ActiveNudgeCheck,
  speaker: NudgePersona,
  watch: ChannelWatch,
  budget: ActiveNudgeCheckBudget,
  plan: RematchPlan,
): Promise<RecheckOutcome> {
  const personas = (await personaRepository.loadAllForServer(check.guildId)).filter(
    (persona): persona is NudgePersona => typeof persona.persona_id === "number",
  );
  const settings = await checkSettingsAndCaps(check, personas, new Date());
  if (typeof settings === "string") return { reason: settings };
  if (!personas.some((persona) => persona.persona_id === speaker.persona_id)) return { reason: "persona_removed" };
  const { speakers } = await loadSpeakers(check, personas);
  if (!speakers.some((persona) => persona.persona_id === speaker.persona_id)) return { reason: "persona_silenced" };
  if (watch.personaSpoke) return { reason: "persona_spoke" };
  if (isChannelProcessingLocked(check.channel.id)) return { reason: "channel_busy" };
  if (watch.humans < ACTIVE_NUDGE_STALE_HUMAN_MESSAGES) return { reason: null };

  const window = await fetchRecentMessages(check.channel, ACTIVE_NUDGE_WINDOW_MESSAGES);
  const evidence = await buildMatcherEvidence(window, check.guildId);
  if (!evidence) return { reason: "window_gone" };
  if (spokeInWindow(window, personas, check.client.user?.id).has(speaker.persona_id))
    return { reason: "persona_spoke" };
  if (!budget.take(check.serverId, settings.dayStart, settings.checkCap)) return { reason: "check_cap_reached" };
  const rematched = await matchActiveNudge({
    state: personas[0],
    backend: settings.backend,
    options: plan.options,
    evidence,
  });
  if (rematched.rateLimited) budget.pause(check.serverId, Date.now());
  // Like the first call, a failure here must not count toward the failure stop.
  if (rematched.reason === "failed") return { reason: "matcher_failed", rematch: rematched };
  if (rematched.choice !== plan.choice) return { reason: "window_gone", rematch: rematched };
  // The second call takes seconds, so the moment must still hold on return, not only before it starts.
  if (watch.personaSpoke) return { reason: "persona_spoke", rematch: rematched };
  if (isChannelProcessingLocked(check.channel.id)) return { reason: "channel_busy", rematch: rematched };
  return { reason: null, rematch: rematched };
}

/** A plain turn on the newest message, with no brief or agenda: the persona reacts as itself. */
async function speak(
  check: ActiveNudgeCheck,
  speaker: NudgePersona,
  interest: string,
  detour: boolean,
  finish: (outcome: AttemptResult, phase: "a" | "c", reason: string) => AttemptResult,
): Promise<AttemptResult> {
  const anchor = await check.channel.messages
    .fetch({ limit: 1 })
    .then((messages) => messages.first() ?? null)
    .catch(() => null);
  if (!anchor) return finish("aborted", "c", "anchor_unavailable");

  let outcome: AttemptResult | null = null;
  const settle = async (result: GenerationTurnResult): Promise<void> => {
    if (!isDeliveredTurnResult(result)) {
      if (isGenerationFailure(result)) await naturalNudgeRepository.recordFailure(check.serverId);
      outcome = finish(isGenerationFailure(result) ? "failed" : "aborted", "c", `generation_${result.status}`);
      return;
    }
    const recorded = await naturalNudgeRepository.recordActiveNudgeFire({
      serverId: check.serverId,
      channelDiscId: check.channel.id,
      personaId: speaker.persona_id,
      openerMessageDiscId: result.firstDeliveredMessageId ?? anchor.id,
      detour,
    });
    outcome = finish("fired", "c", recorded ? "delivered" : "fire_row_failed");
  };

  const disposition = await tomoriChat({
    client: check.client,
    message: anchor,
    isFromQueue: false,
    isManuallyTriggered: true,
    forceReason: false,
    isStopResponse: false,
    selectedPersonaId: speaker.persona_id,
    isPersonaJob: false,
    isUserImpersonation: false,
    textQuotaSource: "system",
    textQuotaTriggerKey: `active-nudge:${check.serverId}:${anchor.id}`,
    shouldSurfaceUserErrors: false,
    naturalNudge: { toolNames: [] },
    injectedContextItems: [
      systemContextItem([
        `${speaker.persona_nickname} decided to join in on their own because the conversation turned to one of their interests: ${interest}.`,
      ]),
    ],
    borrowsTriggerMessage: true,
    onGenerationResult: settle,
  });
  if (outcome) return outcome;
  log.info(`Natural Nudges: Active Nudge not delivered for server ${check.serverId} (disposition ${disposition})`);
  return finish("aborted", "c", `admission_${disposition}`);
}
