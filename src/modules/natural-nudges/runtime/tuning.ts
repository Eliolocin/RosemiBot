import type { IdleNudgeFrequencyLevel, NaturalNudgeCategory } from "@/modules/natural-nudges/db/types";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** Each day's messages count half as much every 3 days, so about two idle weeks leave no heat. */
export const HEAT_HALF_LIFE_DAYS = 3;
export const HEAT_WINDOW_DAYS = 30;

/** Idle Nudges start only at heat 1 or more: about one message to Tomori a day. */
export const MIN_IDLE_NUDGE_HEAT = 1;

/** Tickets per idle nudge category, fixed for every server because the mix is operator tuning. */
export const IDLE_NUDGE_CATEGORY_WEIGHTS: Record<NaturalNudgeCategory, number> = {
  ping_user: 35,
  revive_topic: 25,
  start_topic: 25,
  play_scene: 15,
};

/** Heat divided by this gives idle nudges per day, per frequency level. */
export const IDLE_NUDGE_HEAT_DIVISORS: Record<IdleNudgeFrequencyLevel, number> = { 0: 30, 1: 15, 2: 10, 3: 6 };

/** Daily idle nudge ceiling per frequency level, so a livelier setting allows more; Gentle keeps the former default cap of 3. */
export const IDLE_NUDGE_DAILY_CAPS: Record<IdleNudgeFrequencyLevel, number> = { 0: 1, 1: 3, 2: 5, 3: 8 };

/**
 * Automatic channel eligibility follows heat's horizon: 14 quiet days decay a server's heat to about
 * 4%, so a channel with no turn in that span could not be what keeps the server nudging. A Ping User nudge
 * target must have triggered a turn inside the same window.
 */
export const AUTOMATIC_CHANNEL_DAYS = 14;

/** The waking day an idle nudge budget is spread over, before jitter. */
export const AWAKE_HOURS_PER_DAY = 16;

export const IDLE_NUDGE_JITTER_MIN = 0.5;
export const IDLE_NUDGE_JITTER_MAX = 1.5;

export const LULL_MIN_HOURS = 1;
export const LULL_MAX_HOURS = 3;

/** Below this many turns in the waking-hours window the histogram is noise, so fixed night hours apply. */
export const WAKING_HOURS_MIN_TURNS = 50;
export const WAKING_HOURS_WINDOW_DAYS = 30;
/** An hour counts as awake when its smoothed activity reaches this share of the busiest hour. */
export const WAKING_HOUR_SHARE = 0.25;
/** Fallback night in the server's local time: 01:00 up to 08:00. */
export const FALLBACK_SLEEP_START_HOUR = 1;
export const FALLBACK_SLEEP_END_HOUR = 8;
export const WAKE_DELAY_MAX_MINUTES = 90;

/** An idle nudge waits this long for any human message in its channel before it counts as unanswered. */
export const PENDING_WINDOW_MS = 12 * HOUR_MS;

/** Unanswered inviting idle nudges in a row that stop idle nudges until the server talks to Tomori again. */
export const UNANSWERED_STOP_STREAK = 3;
/** Each unanswered idle nudge in the current streak multiplies the next interval by this. */
export const UNANSWERED_INTERVAL_FACTOR = 3;

/** Consecutive generation or planner failures that stop a server's nudges until a turn succeeds. */
export const NATURAL_NUDGE_FAILURE_STOP_THRESHOLD = 3;

/** Rested share starts here right after a fire and climbs in a straight line to 1. */
export const RESTED_FLOOR = 0.1;
export const PERSONA_REST_MS = 24 * HOUR_MS;
export const CATEGORY_REST_MS = 12 * HOUR_MS;
export const IDLE_NUDGE_REST_MS = 3 * DAY_MS;

/** Raffle tickets per talkativeness level 0-4. */
export const TALKATIVENESS_TICKETS = [0, 5, 10, 15, 20] as const;

/** Messages per channel read for hanging detection and handed to the planner. */
export const PLANNER_HISTORY_MESSAGES = 15;
/** Lull channels read for hanging detection; the planner then sees at most three of them. */
export const MAX_SCANNED_CHANNELS = 6;
export const MAX_PLANNER_CHANNELS = 3;
/** A conversation older than this is history, not something to pick back up. */
export const HANGING_MAX_AGE_MS = 48 * HOUR_MS;
/** Fewer human messages than this is not a conversation that could be left hanging. */
export const HANGING_MIN_HUMAN_MESSAGES = 2;

export const FIRE_RETENTION_MS = 30 * DAY_MS;
export const AGENDA_RETENTION_MS = 90 * DAY_MS;

/** Long-term memories qualify a target only when written or edited this recently, because they never expire. */
export const PING_USER_MEMORY_DAYS = 30;

/**
 * Ping User nudge lottery points. The caps make counts qualify by sufficiency rather than rank by
 * volume, so one heavy user cannot win every draw. The turn cap is reached at about two turns a day
 * over the interaction window.
 */
export const PING_USER_POINTS_PER_TURN = 1;
export const PING_USER_TURN_CAP = 30;
export const PING_USER_POINTS_PER_STM_CHANNEL = 5;
export const PING_USER_STM_CHANNEL_CAP = 5;
export const PING_USER_ACTIVITY_POINTS = 10;
/** Penalties for a target pinged inside the idle nudge rest window, by this persona or by any. */
export const PING_USER_SAME_PERSONA_PENALTY = 10;
export const PING_USER_ANY_PERSONA_PENALTY = 5;
/** An eligible target whose penalties cancel its points keeps this many tickets, so it is rare but possible. */
export const PING_USER_MIN_TICKETS = 1;

export const PING_USER_PLANNER_MEMORIES = 5;

/** Active Nudge checks need the same heat as idle nudges, because a server that never talks to Tomori is where an uninvited reply intrudes most. */
export const MIN_ACTIVE_NUDGE_HEAT = 1;
/** Human messages between checks at the reference heat, before the frequency level scales them. */
export const ACTIVE_NUDGE_TRIP_MIN = 15;
export const ACTIVE_NUDGE_TRIP_MAX = 40;
export const ACTIVE_NUDGE_REFERENCE_HEAT = 15;
/** Heat scales the trip range by reference heat over heat, held inside these bounds. */
export const ACTIVE_NUDGE_HEAT_SCALE_MIN = 0.5;
export const ACTIVE_NUDGE_HEAT_SCALE_MAX = 4;
/** Trip range multiplier per frequency level, so higher levels check sooner. */
export const ACTIVE_NUDGE_LEVEL_MULTIPLIERS: Record<IdleNudgeFrequencyLevel, number> = { 0: 2, 1: 1, 2: 0.6, 3: 0.35 };
/** Daily Active Nudge ceiling per frequency level, matching the idle nudge cap at Gentle. */
export const ACTIVE_NUDGE_DAILY_CAPS: Record<IdleNudgeFrequencyLevel, number> = { 0: 1, 1: 3, 2: 6, 3: 10 };
/** After a check that found nothing, the channel rests before counting again. */
export const ACTIVE_NUDGE_EMPTY_REST_MS = 10 * 60 * 1000;
/** The matcher's evidence window; longer windows let an earlier topic win after the talk moved on. */
export const ACTIVE_NUDGE_WINDOW_MESSAGES = 5;
/** One check offers at most this many interests plus `none`, because some Decision models reject more than 26 options. */
export const ACTIVE_NUDGE_OPTION_BUDGET = 25;
/** A live conversation goes stale quickly, so the reply waits only long enough not to read as instant. */
export const ACTIVE_NUDGE_DELAY_MIN_MS = 15_000;
export const ACTIVE_NUDGE_DELAY_MAX_MS = 45_000;
/** Human messages after the check that mean the matcher's window is gone. */
export const ACTIVE_NUDGE_STALE_HUMAN_MESSAGES = 5;
/** Share of Active Nudges another persona steals from the winner. */
export const ACTIVE_NUDGE_DETOUR_CHANCE = 0.1;
/** A detour persona must have had a turn this recently, so a forgotten persona does not reappear. */
export const ACTIVE_NUDGE_DETOUR_WARM_DAYS = 60;
export const ACTIVE_NUDGE_UNDERDOG_DAYS = 30;
/** The least-talked-to eligible persona gets this many times the tickets of the most-talked-to one. */
export const ACTIVE_NUDGE_UNDERDOG_MAX_BOOST = 4;

/** A Play Scene draws one partner, and a second this often when one is available. */
export const PLAY_SCENE_SECOND_PARTNER_CHANCE = 0.3;
/** Scene length, opener included: long enough for an exchange, short enough to stay a moment. */
export const PLAY_SCENE_MIN_TURNS = 2;
export const PLAY_SCENE_MAX_TURNS = 4;
