import { createHash } from "node:crypto";
import type { IdleNudgeFrequencyLevel, NaturalNudgeFireRow } from "@/modules/natural-nudges/db/types";
import { idleNudgeNeedsTarget, type IdleNudgeDefinition } from "@/modules/natural-nudges/runtime/idleNudges";
import {
  HOUR_MS,
  DAY_MS,
  HEAT_HALF_LIFE_DAYS,
  HEAT_WINDOW_DAYS,
  AUTOMATIC_CHANNEL_DAYS,
  MIN_IDLE_NUDGE_HEAT,
  IDLE_NUDGE_HEAT_DIVISORS,
  IDLE_NUDGE_DAILY_CAPS,
  AWAKE_HOURS_PER_DAY,
  IDLE_NUDGE_JITTER_MIN,
  IDLE_NUDGE_JITTER_MAX,
  LULL_MIN_HOURS,
  LULL_MAX_HOURS,
  UNANSWERED_STOP_STREAK,
  UNANSWERED_INTERVAL_FACTOR,
  WAKING_HOURS_MIN_TURNS,
  WAKING_HOUR_SHARE,
  FALLBACK_SLEEP_START_HOUR,
  FALLBACK_SLEEP_END_HOUR,
  WAKE_DELAY_MAX_MINUTES,
  RESTED_FLOOR,
  MIN_ACTIVE_NUDGE_HEAT,
  ACTIVE_NUDGE_HEAT_SCALE_MAX,
  ACTIVE_NUDGE_HEAT_SCALE_MIN,
  ACTIVE_NUDGE_LEVEL_MULTIPLIERS,
  ACTIVE_NUDGE_REFERENCE_HEAT,
  ACTIVE_NUDGE_TRIP_MAX,
  ACTIVE_NUDGE_TRIP_MIN,
  ACTIVE_NUDGE_UNDERDOG_MAX_BOOST,
  IDLE_NUDGE_REST_MS,
  PING_USER_REPEAT_REST_MS,
} from "@/modules/natural-nudges/runtime/tuning";

const INVITING_CATEGORIES = new Set(["ping_user", "revive_topic", "start_topic"]);

function utcDayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function bucketKey(dayStartMs: number): string {
  return new Date(dayStartMs).toISOString().slice(0, 10);
}

/**
 * Recency-weighted messages per day: each day's `message_sent` total is weighted by
 * 0.5^(age / 3 days) and divided by the steady-state weight, so a server that sends N messages
 * every day reads as heat N.
 */
export function computeHeat(dailyCounts: ReadonlyMap<string, number>, now: Date): number {
  const today = utcDayStart(now);
  let weighted = 0;
  let steadyState = 0;
  for (let age = 0; age < HEAT_WINDOW_DAYS; age++) {
    const weight = 0.5 ** (age / HEAT_HALF_LIFE_DAYS);
    steadyState += weight;
    weighted += (dailyCounts.get(bucketKey(today - age * DAY_MS)) ?? 0) * weight;
  }
  return weighted / steadyState;
}

export function heatWindowStart(now: Date): Date {
  return new Date(utcDayStart(now) - (HEAT_WINDOW_DAYS - 1) * DAY_MS);
}

export function automaticChannelWindowStart(now: Date): Date {
  return new Date(utcDayStart(now) - (AUTOMATIC_CHANNEL_DAYS - 1) * DAY_MS);
}

export function idleNudgesPerDay(heat: number, level: IdleNudgeFrequencyLevel): number {
  if (heat < MIN_IDLE_NUDGE_HEAT) return 0;
  return Math.min(heat / IDLE_NUDGE_HEAT_DIVISORS[level], IDLE_NUDGE_DAILY_CAPS[level]);
}

export function rollIdleNudgeJitter(random: () => number = Math.random): number {
  return IDLE_NUDGE_JITTER_MIN + random() * (IDLE_NUDGE_JITTER_MAX - IDLE_NUDGE_JITTER_MIN);
}

export function rollLullHours(random: () => number = Math.random): number {
  return LULL_MIN_HOURS + random() * (LULL_MAX_HOURS - LULL_MIN_HOURS);
}

/** When the next idle nudge becomes due; a server that never had one is due at once. */
export function computeIdleNudgeDueAt(args: {
  lastIdleNudgeAt: Date | null;
  perDay: number;
  jitter: number;
  unansweredStreak: number;
}): Date | null {
  if (args.perDay <= 0) return null;
  if (!args.lastIdleNudgeAt) return new Date(0);
  const intervalMs =
    ((AWAKE_HOURS_PER_DAY * HOUR_MS) / args.perDay) *
    args.jitter *
    UNANSWERED_INTERVAL_FACTOR ** Math.min(args.unansweredStreak, UNANSWERED_STOP_STREAK - 1);
  return new Date(args.lastIdleNudgeAt.getTime() + intervalMs);
}

/**
 * Consecutive unanswered inviting idle nudges, newest first. A `message_sent` after an idle nudge means
 * the server talked to Tomori since, so that idle nudge and everything older no longer counts.
 */
export function countUnansweredStreak(
  latestIdleNudges: readonly NaturalNudgeFireRow[],
  lastEngagementAt: Date | null,
): number {
  let streak = 0;
  for (const fire of latestIdleNudges) {
    if (fire.category && !INVITING_CATEGORIES.has(fire.category)) continue;
    if (fire.answered !== false) break;
    if (lastEngagementAt && lastEngagementAt.getTime() > fire.fired_at.getTime()) break;
    streak++;
  }
  return streak;
}

export function restedShare(lastFiredAt: Date | undefined, now: Date, restMs: number): number {
  if (!lastFiredAt) return 1;
  const elapsed = Math.max(0, now.getTime() - lastFiredAt.getTime());
  return RESTED_FLOOR + (1 - RESTED_FLOOR) * Math.min(1, elapsed / restMs);
}

/** A targeted idle nudge multiplies in its rest on this persona and target, so the drawn member rarely sees a repeat. */
export function idleNudgeTickets(
  idleNudge: IdleNudgeDefinition,
  lastFiredAt: Date | undefined,
  lastFiredOnTargetAt: Date | undefined,
  now: Date,
): number {
  const serverRest = restedShare(lastFiredAt, now, IDLE_NUDGE_REST_MS);
  if (!idleNudgeNeedsTarget(idleNudge)) return serverRest;
  return serverRest * restedShare(lastFiredOnTargetAt, now, PING_USER_REPEAT_REST_MS);
}

/** UTC hours (index 0-23) in which idle nudges may start. */
export function resolveWakingHours(utcHistogram: readonly number[], timezoneOffset: number): boolean[] {
  const total = utcHistogram.reduce((sum, count) => sum + count, 0);
  if (total < WAKING_HOURS_MIN_TURNS) {
    return Array.from({ length: 24 }, (_, utcHour) => {
      const localHour = (((utcHour + timezoneOffset) % 24) + 24) % 24;
      return localHour < FALLBACK_SLEEP_START_HOUR || localHour >= FALLBACK_SLEEP_END_HOUR;
    });
  }
  const smoothed = utcHistogram.map(
    (count, hour) => (utcHistogram[(hour + 23) % 24] + count + utcHistogram[(hour + 1) % 24]) / 3,
  );
  const busiest = Math.max(...smoothed);
  return smoothed.map((value) => value >= busiest * WAKING_HOUR_SHARE);
}

/** Minutes the first waking hour opens late, fixed per server and stretch so it varies day to day. */
export function wakeDelayMinutes(serverId: number, stretchStart: Date): number {
  const digest = createHash("sha256").update(`${serverId}:${stretchStart.toISOString()}`).digest();
  return digest.readUInt32BE(0) % (WAKE_DELAY_MAX_MINUTES + 1);
}

export function isWithinWakingHours(awake: readonly boolean[], now: Date, serverId: number): boolean {
  if (!awake[now.getUTCHours()]) return false;
  if (awake.every(Boolean)) return true;
  let stretchStart = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  while (awake[new Date(stretchStart - HOUR_MS).getUTCHours()]) stretchStart -= HOUR_MS;
  const delayMs = wakeDelayMinutes(serverId, new Date(stretchStart)) * 60_000;
  return now.getTime() >= stretchStart + delayMs;
}

export interface RaffleEntry<T> {
  item: T;
  tickets: number;
}

export function drawRaffle<T>(entries: readonly RaffleEntry<T>[], random: () => number = Math.random): T | null {
  const live = entries.filter((entry) => entry.tickets > 0);
  const total = live.reduce((sum, entry) => sum + entry.tickets, 0);
  if (total <= 0) return null;
  let ticket = random() * total;
  for (const entry of live) {
    ticket -= entry.tickets;
    if (ticket < 0) return entry.item;
  }
  return live[live.length - 1]?.item ?? null;
}

/** Human messages between Active Nudge checks: busier servers check sooner, and nothing runs below the heat floor. */
export function activeNudgeTripRange(
  heat: number,
  level: IdleNudgeFrequencyLevel,
): { min: number; max: number } | null {
  if (heat < MIN_ACTIVE_NUDGE_HEAT) return null;
  const heatScale = Math.min(
    ACTIVE_NUDGE_HEAT_SCALE_MAX,
    Math.max(ACTIVE_NUDGE_HEAT_SCALE_MIN, ACTIVE_NUDGE_REFERENCE_HEAT / heat),
  );
  const scale = heatScale * ACTIVE_NUDGE_LEVEL_MULTIPLIERS[level];
  return {
    min: Math.max(1, Math.round(ACTIVE_NUDGE_TRIP_MIN * scale)),
    max: Math.max(1, Math.round(ACTIVE_NUDGE_TRIP_MAX * scale)),
  };
}

/** Detour ticket multiplier: 1 for the most-talked-to persona, rising toward the maximum as its share falls. */
export function underdogBoost(count: number, topCount: number): number {
  if (topCount <= 0) return ACTIVE_NUDGE_UNDERDOG_MAX_BOOST;
  const share = Math.min(1, Math.max(0, count / topCount));
  return 1 + (ACTIVE_NUDGE_UNDERDOG_MAX_BOOST - 1) * (1 - share);
}

export function serverDayStart(now: Date, timezoneOffset: number): Date {
  const local = now.getTime() + timezoneOffset * HOUR_MS;
  return new Date(utcDayStart(new Date(local)) - timezoneOffset * HOUR_MS);
}
