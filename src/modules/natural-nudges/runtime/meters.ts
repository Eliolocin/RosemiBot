import { createHash } from "node:crypto";
import type { EpisodeFrequencyLevel, NaturalNudgeFireRow } from "@/modules/natural-nudges/db/types";
import {
  HOUR_MS,
  DAY_MS,
  HEAT_HALF_LIFE_DAYS,
  HEAT_WINDOW_DAYS,
  AUTOMATIC_CHANNEL_DAYS,
  MIN_EPISODE_HEAT,
  EPISODE_HEAT_DIVISORS,
  AWAKE_HOURS_PER_DAY,
  EPISODE_JITTER_MIN,
  EPISODE_JITTER_MAX,
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
} from "@/modules/natural-nudges/runtime/tuning";

const INVITING_CATEGORIES = new Set(["reach_out", "revive", "new_topic"]);

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

export function episodesPerDay(heat: number, level: EpisodeFrequencyLevel, dailyCap: number): number {
  if (heat < MIN_EPISODE_HEAT) return 0;
  return Math.min(heat / EPISODE_HEAT_DIVISORS[level], dailyCap);
}

export function rollEpisodeJitter(random: () => number = Math.random): number {
  return EPISODE_JITTER_MIN + random() * (EPISODE_JITTER_MAX - EPISODE_JITTER_MIN);
}

export function rollLullHours(random: () => number = Math.random): number {
  return LULL_MIN_HOURS + random() * (LULL_MAX_HOURS - LULL_MIN_HOURS);
}

/** When the next episode becomes due; a server that never had one is due at once. */
export function computeEpisodeDueAt(args: {
  lastEpisodeAt: Date | null;
  perDay: number;
  jitter: number;
  unansweredStreak: number;
}): Date | null {
  if (args.perDay <= 0) return null;
  if (!args.lastEpisodeAt) return new Date(0);
  const intervalMs =
    ((AWAKE_HOURS_PER_DAY * HOUR_MS) / args.perDay) *
    args.jitter *
    UNANSWERED_INTERVAL_FACTOR ** Math.min(args.unansweredStreak, UNANSWERED_STOP_STREAK - 1);
  return new Date(args.lastEpisodeAt.getTime() + intervalMs);
}

/**
 * Consecutive unanswered inviting episodes, newest first. A `message_sent` after an episode means
 * the server talked to Tomori since, so that episode and everything older no longer counts.
 */
export function countUnansweredStreak(
  latestEpisodes: readonly NaturalNudgeFireRow[],
  lastEngagementAt: Date | null,
): number {
  let streak = 0;
  for (const fire of latestEpisodes) {
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

/** UTC hours (index 0-23) in which episodes may start. */
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

export function serverDayStart(now: Date, timezoneOffset: number): Date {
  const local = now.getTime() + timezoneOffset * HOUR_MS;
  return new Date(utcDayStart(new Date(local)) - timezoneOffset * HOUR_MS);
}
