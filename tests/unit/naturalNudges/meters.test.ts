import { describe, expect, it } from "bun:test";
import type { NaturalNudgeFireRow } from "@/modules/natural-nudges/db/types";
import {
  computeEpisodeDueAt,
  computeHeat,
  countUnansweredStreak,
  drawRaffle,
  episodesPerDay,
  isWithinWakingHours,
  resolveWakingHours,
  restedShare,
  serverDayStart,
  wakeDelayMinutes,
} from "@/modules/natural-nudges/runtime/meters";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-03-10T15:00:00.000Z");

function dailyCounts(perDay: (age: number) => number, days = 30): Map<string, number> {
  const counts = new Map<string, number>();
  for (let age = 0; age < days; age++) {
    const bucket = new Date(Date.UTC(2026, 2, 10) - age * DAY).toISOString().slice(0, 10);
    counts.set(bucket, perDay(age));
  }
  return counts;
}

function fire(overrides: Partial<NaturalNudgeFireRow>): NaturalNudgeFireRow {
  return {
    fire_id: 1,
    server_id: 1,
    channel_disc_id: "100000000000000001",
    persona_id: 1,
    mode: "episode",
    category: "new_topic",
    episode_key: "new_topic.interest_musing",
    target_user_id: null,
    opener_message_disc_id: "200000000000000001",
    answered: false,
    fired_at: new Date(NOW.getTime() - DAY),
    ...overrides,
  };
}

describe("heat", () => {
  it("reads as messages per day for a steady server", () => {
    expect(
      computeHeat(
        dailyCounts(() => 20),
        NOW,
      ),
    ).toBeCloseTo(20, 0);
  });

  it("weighs a message three days old at half a message from today", () => {
    const today = computeHeat(
      dailyCounts((age) => (age === 0 ? 10 : 0)),
      NOW,
    );
    const threeDaysOld = computeHeat(
      dailyCounts((age) => (age === 3 ? 10 : 0)),
      NOW,
    );
    expect(threeDaysOld / today).toBeCloseTo(0.5, 5);
  });

  it("falls below the episode floor after a daily server goes quiet for two weeks", () => {
    expect(
      computeHeat(
        dailyCounts((age) => (age >= 14 ? 20 : 0)),
        NOW,
      ),
    ).toBeLessThan(1);
  });
});

describe("episodes per day", () => {
  it("matches the launch examples at the Gentle level", () => {
    expect(episodesPerDay(20, 1, 3)).toBeCloseTo(1.33, 2);
    expect(episodesPerDay(6, 1, 3) * 7).toBeCloseTo(2.8, 1);
    expect(episodesPerDay(0.5, 1, 3)).toBe(0);
  });

  it("scales with the level and stops at the daily cap", () => {
    expect(episodesPerDay(20, 0, 3)).toBeCloseTo(0.67, 2);
    expect(episodesPerDay(20, 2, 3)).toBe(2);
    expect(episodesPerDay(20, 3, 3)).toBe(3);
    expect(episodesPerDay(60, 1, 3)).toBe(3);
  });
});

describe("due time", () => {
  const last = new Date("2026-03-10T00:00:00.000Z");

  it("spreads the episode budget over sixteen waking hours", () => {
    const dueAt = computeEpisodeDueAt({ lastEpisodeAt: last, perDay: 2, jitter: 1, unansweredStreak: 0 });
    expect(dueAt?.getTime()).toBe(last.getTime() + 8 * HOUR);
  });

  it("triples the interval for each unanswered episode in the streak", () => {
    const one = computeEpisodeDueAt({ lastEpisodeAt: last, perDay: 2, jitter: 1, unansweredStreak: 1 });
    const two = computeEpisodeDueAt({ lastEpisodeAt: last, perDay: 2, jitter: 1, unansweredStreak: 2 });
    expect(one?.getTime()).toBe(last.getTime() + 24 * HOUR);
    expect(two?.getTime()).toBe(last.getTime() + 72 * HOUR);
  });

  it("is due at once for a first episode and never without a budget", () => {
    expect(computeEpisodeDueAt({ lastEpisodeAt: null, perDay: 1, jitter: 1, unansweredStreak: 0 })?.getTime()).toBe(0);
    expect(computeEpisodeDueAt({ lastEpisodeAt: last, perDay: 0, jitter: 1, unansweredStreak: 0 })).toBeNull();
  });
});

describe("unanswered streak", () => {
  it("counts consecutive unanswered inviting episodes until an answered one", () => {
    const fires = [
      fire({ fire_id: 3, fired_at: new Date(NOW.getTime() - 1 * DAY) }),
      fire({ fire_id: 2, fired_at: new Date(NOW.getTime() - 2 * DAY) }),
      fire({ fire_id: 1, fired_at: new Date(NOW.getTime() - 3 * DAY), answered: true }),
    ];
    expect(countUnansweredStreak(fires, null)).toBe(2);
  });

  it("restarts once the server talks to Tomori after an episode", () => {
    const fires = [
      fire({ fire_id: 2, fired_at: new Date(NOW.getTime() - 1 * DAY) }),
      fire({ fire_id: 1, fired_at: new Date(NOW.getTime() - 3 * DAY) }),
    ];
    expect(countUnansweredStreak(fires, new Date(NOW.getTime() - 2 * DAY))).toBe(1);
  });

  it("skips Alter Talk, which never invites an answer", () => {
    const fires = [fire({ fire_id: 2, category: "alter_talk" }), fire({ fire_id: 1 })];
    expect(countUnansweredStreak(fires, null)).toBe(1);
  });
});

describe("rested share", () => {
  it("climbs in a straight line from a tenth to whole over the rest window", () => {
    expect(restedShare(undefined, NOW, DAY)).toBe(1);
    expect(restedShare(NOW, NOW, DAY)).toBeCloseTo(0.1, 5);
    expect(restedShare(new Date(NOW.getTime() - DAY / 2), NOW, DAY)).toBeCloseTo(0.55, 5);
    expect(restedShare(new Date(NOW.getTime() - 2 * DAY), NOW, DAY)).toBe(1);
  });
});

describe("waking hours", () => {
  it("falls back to a fixed local night for servers with too little history", () => {
    const awake = resolveWakingHours(
      Array.from({ length: 24 }, () => 1),
      9,
    );
    const asleepUtcHours = awake.flatMap((isAwake, hour) => (isAwake ? [] : [hour]));
    expect(asleepUtcHours).toEqual([16, 17, 18, 19, 20, 21, 22]);
  });

  it("learns the active stretch from the histogram", () => {
    const histogram = Array.from({ length: 24 }, (_, hour) => (hour >= 12 && hour <= 20 ? 40 : 0));
    const awake = resolveWakingHours(histogram, 0);
    expect(awake[15]).toBe(true);
    expect(awake[3]).toBe(false);
  });

  it("opens the first waking hour up to ninety minutes late, the same way each day", () => {
    const awake = Array.from({ length: 24 }, (_, hour) => hour >= 8);
    const stretchStart = new Date("2026-03-10T08:00:00.000Z");
    const delay = wakeDelayMinutes(42, stretchStart);
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(90);
    expect(wakeDelayMinutes(42, stretchStart)).toBe(delay);
    expect(isWithinWakingHours(awake, new Date(stretchStart.getTime() + (delay + 1) * 60_000), 42)).toBe(true);
    expect(isWithinWakingHours(awake, new Date("2026-03-10T03:00:00.000Z"), 42)).toBe(false);
    if (delay > 0) {
      expect(isWithinWakingHours(awake, new Date(stretchStart.getTime() + (delay - 1) * 60_000), 42)).toBe(false);
    }
  });
});

describe("raffle and server day", () => {
  it("never draws an entry without tickets", () => {
    const draws = [0, 0.25, 0.5, 0.99].map((value) =>
      drawRaffle(
        [
          { item: "silent", tickets: 0 },
          { item: "shy", tickets: 5 },
          { item: "chatty", tickets: 15 },
        ],
        () => value,
      ),
    );
    expect(draws).not.toContain("silent");
    expect(drawRaffle([{ item: "silent", tickets: 0 }])).toBeNull();
  });

  it("starts the cap day at local midnight", () => {
    expect(serverDayStart(new Date("2026-03-10T15:00:00.000Z"), 9).toISOString()).toBe("2026-03-10T15:00:00.000Z");
    expect(serverDayStart(new Date("2026-03-10T14:59:00.000Z"), 9).toISOString()).toBe("2026-03-09T15:00:00.000Z");
  });
});
