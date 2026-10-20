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
import { readChimeInGate } from "@/modules/natural-nudges/runtime/configCache";
import { claimNudgeServer, releaseNudgeServer } from "@/modules/natural-nudges/runtime/inFlight";
import {
  matchChimeIn,
  matcherOptionId,
  resolveMatcherBackend,
  type MatcherBackend,
  type MatcherOption,
  type MatcherResult,
} from "@/modules/natural-nudges/runtime/matcher";
import {
  chimeInTripRange,
  drawRaffle,
  restedShare,
  serverDayStart,
  underdogBoost,
} from "@/modules/natural-nudges/runtime/meters";
import { isGenerationFailure, type AttemptResult } from "@/modules/natural-nudges/runtime/runner";
import { recordChimeInSample, type ChimeInSample } from "@/modules/natural-nudges/runtime/telemetry";
import {
  CHIME_IN_DELAY_MAX_MS,
  CHIME_IN_DELAY_MIN_MS,
  CHIME_IN_DETOUR_CHANCE,
  CHIME_IN_DETOUR_WARM_DAYS,
  CHIME_IN_EMPTY_REST_MS,
  CHIME_IN_OPTION_BUDGET,
  CHIME_IN_STALE_HUMAN_MESSAGES,
  CHIME_IN_UNDERDOG_DAYS,
  CHIME_IN_WINDOW_MESSAGES,
  DAY_MS,
  HOUR_MS,
  PERSONA_REST_MS,
  TALKATIVENESS_TICKETS,
} from "@/modules/natural-nudges/runtime/tuning";
import { isChannelProcessingLocked, suppressNextSelfReply, tomoriChat } from "@/events/messageCreate/tomoriChat";
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
 * Human messages per conversation channel since a persona last spoke there. Kept in memory, because
 * a restart only resets the counts to 0, which delays the next check slightly.
 */
class ChimeInCounter {
  private readonly channels = new Map<string, ChannelCounter>();

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
    this.channels.set(channelId, { count: 0, target: 0, restUntil: now + CHIME_IN_EMPTY_REST_MS });
  }
}

/** What happened in a channel after its check started, which decides whether the moment is still there. */
interface ChannelWatch {
  humans: number;
  personaSpoke: boolean;
}

const counter = new ChimeInCounter();
const watches = new Map<string, ChannelWatch>();

async function isPersonaMessage(client: Client, message: Message): Promise<boolean> {
  if (!message.webhookId) return message.author.id === client.user?.id;
  return (await verifyMessageWebhook(message)) && !getCachedImpersonatedUserIdForWebhook(message.webhookId);
}

export interface ChimeInCheck {
  client: Client;
  channel: GuildTextBasedChannel;
  /** The allow-listed channel: the channel itself, or a thread's parent. */
  listedChannelId: string;
  guildId: string;
  serverId: number;
  heat: number;
}

/**
 * The cheap part of Chime-ins, run on every guild message: count human messages in allowed channels,
 * reset on persona messages, and start one check when the rolled count trips.
 */
export async function observeChimeInMessage(client: Client, message: Message): Promise<void> {
  if (!message.inGuild() || message.system) return;
  const channelId = message.channelId;
  if (!isHumanMessage(message)) {
    // Only a channel already counting or watched has anything to reset, so other bot traffic costs nothing.
    if (!counter.isTracking(channelId) && !watches.has(channelId)) return;
    if (!(await isPersonaMessage(client, message))) return;
    counter.reset(channelId, Date.now());
    const watch = watches.get(channelId);
    if (watch) watch.personaSpoke = true;
    return;
  }
  const watch = watches.get(channelId);
  if (watch) watch.humans++;

  const gate = await readChimeInGate(message.guildId);
  if (!gate?.config.chime_in_enabled) return;
  const channel = message.channel;
  const listedChannelId = channel.isThread() ? channel.parentId : channel.id;
  if (!listedChannelId || !gate.channelIds.has(listedChannelId)) return;
  const range = chimeInTripRange(gate.heat, gate.config.chime_in_frequency);
  if (!range || !counter.recordHuman(channelId, range, Date.now())) return;
  if (!claimNudgeServer(gate.serverId)) return;

  const check: ChimeInCheck = {
    client,
    channel,
    listedChannelId,
    guildId: message.guildId,
    serverId: gate.serverId,
    heat: gate.heat,
  };
  void runWithErrorContext({ source: "natural_nudge", serverId: gate.serverId }, () => runChimeInCheck(check))
    .then((result) => {
      if (result !== "fired") counter.rest(channelId, Date.now());
    })
    .catch(async (error) => {
      counter.rest(channelId, Date.now());
      await log.error("Natural Nudges: Chime-in check failed", error, { serverId: gate.serverId });
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
    if (byLabel.size + added.size > CHIME_IN_OPTION_BUDGET) continue;
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

interface CheckSettings {
  backend: MatcherBackend;
  recentFires: NaturalNudgeFireRow[];
}

/** The fresh-read checks Phase A and the re-check share; a string names the abort reason. */
async function checkSettingsAndCaps(
  check: ChimeInCheck,
  personas: readonly NudgePersona[],
  now: Date,
): Promise<CheckSettings | string> {
  const config = await naturalNudgeRepository.loadServerConfig(check.serverId);
  if (!config.chime_in_enabled) return "disabled";
  if (!(await resolveEffectiveChannelIds(check.serverId, config, now)).includes(check.listedChannelId))
    return "channel_removed";
  if ((await naturalNudgeRepository.loadRuntimeState(check.serverId)).stopped_at) return "stopped";
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
  const chimeIns = history.recent.filter((fire) => fire.mode === "chime_in");
  const dayStart = serverDayStart(now, personas[0].config.timezone_offset ?? 0);
  if (chimeIns.filter((fire) => fire.fired_at >= dayStart).length >= config.daily_chime_in_cap) return "cap_reached";
  if (
    chimeIns.some(
      (fire) => fire.channel_disc_id === check.channel.id && now.getTime() - fire.fired_at.getTime() < HOUR_MS,
    )
  )
    return "channel_cap";
  const backend = await resolveMatcherBackend(personas[0], config.llm_id);
  if (!backend) return "no_matcher";
  return { backend, recentFires: history.recent };
}

/** Personas that may speak here: talkativeness above 0 and allowed in the channel. */
async function loadSpeakers(
  check: ChimeInCheck,
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
  check: ChimeInCheck,
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
      from: new Date(now.getTime() - CHIME_IN_DETOUR_WARM_DAYS * DAY_MS),
    }),
    statRepository.getServerPersonaMessageCounts({
      serverId: check.serverId,
      from: new Date(now.getTime() - CHIME_IN_UNDERDOG_DAYS * DAY_MS),
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

export interface ChimeInCheckOptions {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One Chime-in check: Phase A reads fresh settings and caps, one matcher call picks an interest or
 * `none`, and after a short delay the re-check confirms the moment before a plain turn. Any doubt
 * resolves to saying nothing.
 */
export async function runChimeInCheck(check: ChimeInCheck, options: ChimeInCheckOptions = {}): Promise<AttemptResult> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const telemetry: Omit<ChimeInSample, "outcome" | "phase" | "reason"> = { serverId: check.serverId, heat: check.heat };
  const finish = (outcome: AttemptResult, phase: "a" | "c", reason: string): AttemptResult => {
    recordChimeInSample({ ...telemetry, outcome, phase, reason });
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
    const window = await fetchRecentMessages(check.channel, CHIME_IN_WINDOW_MESSAGES);
    const evidence = await buildMatcherEvidence(window, check.guildId);
    if (!evidence) return finish("aborted", "a", "no_evidence");

    const matched: MatcherResult = await matchChimeIn({
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
    // Not counted toward the failure stop, so a broken matcher cannot also stop the server's episodes.
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
      random() < CHIME_IN_DETOUR_CHANCE
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

    await sleep(CHIME_IN_DELAY_MIN_MS + random() * (CHIME_IN_DELAY_MAX_MS - CHIME_IN_DELAY_MIN_MS));

    const blocked = await recheckBeforeSend(check, speaker, watch);
    if (blocked) return finish("aborted", "c", blocked);
    return await speak(check, speaker, detour !== null, finish);
  } finally {
    if (watches.get(check.channel.id) === watch) watches.delete(check.channel.id);
  }
}

/** The cheap checks again, read fresh, after the delay; the moment counts as gone on any change. */
async function recheckBeforeSend(
  check: ChimeInCheck,
  speaker: NudgePersona,
  watch: ChannelWatch,
): Promise<string | null> {
  const personas = (await personaRepository.loadAllForServer(check.guildId)).filter(
    (persona): persona is NudgePersona => typeof persona.persona_id === "number",
  );
  const settings = await checkSettingsAndCaps(check, personas, new Date());
  if (typeof settings === "string") return settings;
  if (!personas.some((persona) => persona.persona_id === speaker.persona_id)) return "persona_removed";
  const { speakers } = await loadSpeakers(check, personas);
  if (!speakers.some((persona) => persona.persona_id === speaker.persona_id)) return "persona_silenced";
  if (watch.personaSpoke) return "persona_spoke";
  if (watch.humans >= CHIME_IN_STALE_HUMAN_MESSAGES) return "window_gone";
  if (isChannelProcessingLocked(check.channel.id)) return "channel_busy";
  return null;
}

/** A plain turn on the newest message, with no brief or agenda: the persona reacts as itself. */
async function speak(
  check: ChimeInCheck,
  speaker: NudgePersona,
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
    const recorded = await naturalNudgeRepository.recordChimeInFire({
      serverId: check.serverId,
      channelDiscId: check.channel.id,
      personaId: speaker.persona_id,
      openerMessageDiscId: result.firstDeliveredMessageId ?? anchor.id,
      detour,
    });
    outcome = finish("fired", "c", recorded ? "delivered" : "fire_row_failed");
  };

  suppressNextSelfReply(check.channel.id);
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
    textQuotaTriggerKey: `chime-in:${check.serverId}:${anchor.id}`,
    shouldSurfaceUserErrors: false,
    naturalNudge: { toolNames: [] },
    borrowsTriggerMessage: true,
    onGenerationResult: settle,
  });
  if (outcome) return outcome;
  log.info(`Natural Nudges: Chime-in not delivered for server ${check.serverId} (disposition ${disposition})`);
  return finish("aborted", "c", `admission_${disposition}`);
}
