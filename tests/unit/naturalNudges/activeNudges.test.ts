import { afterEach, beforeEach, describe, expect, it, spyOn, type Mock } from "bun:test";
import { Collection, type Client, type GuildTextBasedChannel, type Message } from "discord.js";
import * as tomoriChatModule from "@/events/messageCreate/tomoriChat";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { defaultServerNaturalNudgeConfig, type NaturalNudgeFireRow } from "@/modules/natural-nudges/db/types";
import * as channels from "@/modules/natural-nudges/runtime/channels";
import {
  buildMatcherOptions,
  observeActiveNudgeMessage,
  runActiveNudgeCheck,
  type ActiveNudgeCheck,
} from "@/modules/natural-nudges/runtime/activeNudges";
import * as configCache from "@/modules/natural-nudges/runtime/configCache";
import * as inFlight from "@/modules/natural-nudges/runtime/inFlight";
import * as matcher from "@/modules/natural-nudges/runtime/matcher";
import { ACTIVE_NUDGE_OPTION_BUDGET, ACTIVE_NUDGE_STALE_HUMAN_MESSAGES } from "@/modules/natural-nudges/runtime/tuning";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";
import type { TomoriChatInput } from "@/utils/chat/types";
import { statRepository } from "@/utils/db/repositories";
import { metricSampleRepository } from "@/utils/db/repositories/MetricSampleRepository";
import { personaRepository } from "@/utils/db/repositories/PersonaRepository";
import { whitelistRepository } from "@/utils/db/repositories/WhitelistRepository";
import * as autoTrigger from "@/utils/discord/autoTriggerThreshold";
import { createPersona } from "../../helpers/fixtures";

const SERVER_ID = 7;
const GUILD_ID = "fixture-guild";
const CLIENT_USER_ID = "1300000000000000001";
const ANCHOR_ID = "1300000000000000500";
const MAIN_ID = 5;
const ALTER_ID = 6;
const client = { user: { id: CLIENT_USER_ID }, channels: { cache: new Map() } } as unknown as Client;
const main = createPersona({
  persona_id: MAIN_ID,
  persona_lineage_id: 105,
  server_id: SERVER_ID,
  persona_nickname: "Mirri",
}) as ReturnType<typeof createPersona> & { persona_id: number };
const alter = createPersona({
  persona_id: ALTER_ID,
  persona_lineage_id: 106,
  server_id: SERVER_ID,
  persona_nickname: "Juno",
  is_alter: true,
}) as typeof main;
const MECHA = { label: "mecha anime", description: "Giant piloted robots." };
const BAKING = { label: "baking", description: "Bread and pastry." };
const defaultMatch: matcher.MatcherResult = { choice: "i01", reason: "matched", kind: "llm", model: "fixture" };

const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

let canSend = true;

function fakeChannel(id: string, parentId?: string): GuildTextBasedChannel {
  return {
    id,
    parentId: parentId ?? null,
    isThread: () => parentId !== undefined,
    guild: { members: { me: { id: CLIENT_USER_ID } } },
    permissionsFor: () => ({ has: () => canSend }),
    messages: { fetch: async () => new Collection([[ANCHOR_ID, { id: ANCHOR_ID } as Message]]) },
  } as unknown as GuildTextBasedChannel;
}

function fakeMessage(channel: GuildTextBasedChannel, author: { id: string; bot: boolean }): Message {
  return {
    inGuild: () => true,
    system: false,
    guildId: GUILD_ID,
    channelId: channel.id,
    channel,
    webhookId: null,
    author,
  } as unknown as Message;
}

const member = (channel: GuildTextBasedChannel) => fakeMessage(channel, { id: "1300000000000000002", bot: false });
const self = (channel: GuildTextBasedChannel) => fakeMessage(channel, { id: CLIENT_USER_ID, bot: true });

describe("Active Nudge counter", () => {
  let claims: number;
  beforeEach(() => {
    claims = 0;
    spies.push(
      spyOn(configCache, "readActiveNudgeGate").mockResolvedValue({
        serverId: SERVER_ID,
        config: defaultServerNaturalNudgeConfig(SERVER_ID),
        channelIds: new Set(["listed-parent", "trip-parent", "reset-parent", "quiet-parent"]),
        heat: 15,
      }),
      spyOn(autoTrigger, "rollAutochatTarget").mockReturnValue(3),
      spyOn(inFlight, "claimNudgeServer").mockImplementation(() => {
        claims++;
        return false;
      }),
    );
  });

  it("trips once per rolled count, with a parent and its threads sharing one count", async () => {
    const parent = fakeChannel("trip-parent");
    const thread = fakeChannel("trip-thread", "trip-parent");
    await observeActiveNudgeMessage(client, member(parent));
    await observeActiveNudgeMessage(client, member(thread));
    expect(claims).toBe(0);
    await observeActiveNudgeMessage(client, member(thread));
    expect(claims).toBe(1);
  });

  it("counts neither bots nor members in channels off the list", async () => {
    const listed = fakeChannel("quiet-parent");
    const other = fakeChannel("counter-unlisted");
    for (let index = 0; index < 5; index++) {
      await observeActiveNudgeMessage(client, fakeMessage(listed, { id: "1300000000000000003", bot: true }));
      await observeActiveNudgeMessage(client, member(other));
    }
    expect(claims).toBe(0);
  });

  it("starts over when a persona speaks in the parent or any of its threads", async () => {
    const parent = fakeChannel("reset-parent");
    const thread = fakeChannel("reset-thread", "reset-parent");
    await observeActiveNudgeMessage(client, member(parent));
    await observeActiveNudgeMessage(client, member(parent));
    await observeActiveNudgeMessage(client, self(thread));
    await observeActiveNudgeMessage(client, member(parent));
    await observeActiveNudgeMessage(client, member(thread));
    expect(claims).toBe(0);
    await observeActiveNudgeMessage(client, member(parent));
    expect(claims).toBe(1);
  });
});

describe("matcher options", () => {
  it("merges a shared label into one option and never exceeds the option budget", () => {
    const many = Array.from({ length: ACTIVE_NUDGE_OPTION_BUDGET }, (_, index) => ({
      label: `topic ${index}`,
      description: "Filler.",
    }));
    const configs = new Map([
      [MAIN_ID, { persona_id: MAIN_ID, talkativeness: 2, interests: [MECHA], has_override: true }],
      [
        ALTER_ID,
        { persona_id: ALTER_ID, talkativeness: 2, interests: [{ ...MECHA, label: "Mecha Anime" }], has_override: true },
      ],
    ]);
    const shared = buildMatcherOptions([main, alter], configs);
    expect(shared.options).toHaveLength(1);
    expect(
      shared.owners
        .get(shared.options[0].id)
        ?.map((persona) => persona.persona_id)
        .sort(),
    ).toEqual([MAIN_ID, ALTER_ID]);

    configs.set(ALTER_ID, { persona_id: ALTER_ID, talkativeness: 2, interests: many, has_override: true });
    const budgeted = buildMatcherOptions([main, alter], configs);
    expect(budgeted.options.length).toBeLessThanOrEqual(ACTIVE_NUDGE_OPTION_BUDGET);
  });
});

describe("Active Nudge check", () => {
  let chatInputs: TomoriChatInput[];
  let samples: Array<Record<string, unknown>>;
  let locked: boolean;
  let window: Message[];
  let configSpy: ReturnType<typeof spyOn<typeof naturalNudgeRepository, "loadServerConfig">>;
  let historySpy: ReturnType<typeof spyOn<typeof naturalNudgeRepository, "loadFireHistory">>;
  let matches: matcher.MatcherResult[];
  let match: Mock<typeof matcher.matchActiveNudge>;
  const channel = fakeChannel("listed-parent");
  const check: ActiveNudgeCheck = {
    client,
    channel,
    listedChannelId: "listed-parent",
    guildId: GUILD_ID,
    serverId: SERVER_ID,
    heat: 15,
  };
  const recordFire = () => spyOn(naturalNudgeRepository, "recordActiveNudgeFire").mockResolvedValue(true);

  beforeEach(() => {
    chatInputs = [];
    samples = [];
    locked = false;
    window = [member(channel)];
    configSpy = spyOn(naturalNudgeRepository, "loadServerConfig");
    configSpy.mockResolvedValue(defaultServerNaturalNudgeConfig(SERVER_ID));
    historySpy = spyOn(naturalNudgeRepository, "loadFireHistory");
    historySpy.mockResolvedValue({ recent: [], latestIdleNudges: [] });
    matches = [];
    match = spyOn(matcher, "matchActiveNudge").mockImplementation(async () => matches.shift() ?? defaultMatch);
    spies.push(
      match,
      spyOn(tomoriStateCache, "getCachedAllPersonas").mockResolvedValue([main, alter]),
      spyOn(personaRepository, "loadAllForServer").mockResolvedValue([main, alter]),
      configSpy,
      spyOn(naturalNudgeRepository, "loadRuntimeState").mockResolvedValue({
        server_id: SERVER_ID,
        idle_nudge_jitter: 1,
        consecutive_failures: 0,
        stopped_at: null,
      }),
      historySpy,
      spyOn(naturalNudgeRepository, "loadPersonaConfigs").mockResolvedValue(
        new Map([
          [MAIN_ID, { persona_id: MAIN_ID, talkativeness: 2, interests: [MECHA], has_override: true }],
          [ALTER_ID, { persona_id: ALTER_ID, talkativeness: 2, interests: [BAKING], has_override: true }],
        ]),
      ),
      spyOn(channels, "resolveEffectiveChannelIds").mockResolvedValue(["listed-parent"]),
      spyOn(channels, "fetchRecentMessages").mockImplementation(async () => window),
      spyOn(channels, "buildMatcherEvidence").mockResolvedValue("Juno: the new Gundam is out"),
      spyOn(configCache, "readActiveNudgeGate").mockResolvedValue({
        serverId: SERVER_ID,
        config: defaultServerNaturalNudgeConfig(SERVER_ID),
        channelIds: new Set(),
        heat: 15,
      }),
      spyOn(whitelistRepository, "checkChannelWhitelist").mockResolvedValue(undefined as never),
      spyOn(whitelistRepository, "isPersonaAllowedByWhitelistStatus").mockReturnValue(true),
      spyOn(matcher, "resolveMatcherBackend").mockResolvedValue({ kind: "llm", llmId: 1 }),
      spyOn(metricSampleRepository, "recordSample").mockImplementation(async (_name, fields) => {
        samples.push(fields);
      }),
      spyOn(tomoriChatModule, "isChannelProcessingLocked").mockImplementation(() => locked),
      spyOn(tomoriChatModule, "tomoriChat").mockImplementation(async (input) => {
        chatInputs.push(input);
        await input.onGenerationResult?.({
          status: "completed",
          streamResults: [],
          personaResponses: [{}],
          firstDeliveredMessageId: "1300000000000000600",
        } as never);
        return "run";
      }),
    );
    canSend = true;
  });

  const options = (sleep: () => Promise<void> = async () => {}) => ({ sleep, random: () => 0.5 });

  const postHumans = async (count: number) => {
    window = Array.from({ length: count }, () => member(channel));
    for (let index = 0; index < count; index++) await observeActiveNudgeMessage(client, member(channel));
  };

  it("speaks a plain turn as the interest's owner and records the fire", async () => {
    const fire = recordFire();
    spies.push(fire);
    expect(await runActiveNudgeCheck(check, options())).toBe("fired");
    const [input] = chatInputs;
    expect(input).toMatchObject({
      selectedPersonaId: MAIN_ID,
      naturalNudge: { toolNames: [] },
      borrowsTriggerMessage: true,
    });
    expect(input.injectedContextItems).toBeUndefined();
    expect(input.message.id).toBe(ANCHOR_ID);
    expect(fire.mock.calls[0][0]).toMatchObject({
      personaId: MAIN_ID,
      openerMessageDiscId: "1300000000000000600",
      detour: false,
    });
  });

  it("never detours to a persona who already spoke in the window", async () => {
    spies.push(
      recordFire(),
      spyOn(naturalNudgeRepository, "loadPersonaConfigs").mockResolvedValue(
        new Map([
          [MAIN_ID, { persona_id: MAIN_ID, talkativeness: 2, interests: [], has_override: true }],
          [ALTER_ID, { persona_id: ALTER_ID, talkativeness: 2, interests: [MECHA], has_override: true }],
        ]),
      ),
      spyOn(statRepository, "getServerPersonaMessageCounts").mockResolvedValue(
        new Map([[main.persona_lineage_id, 50]]),
      ),
    );
    window = [member(channel), self(channel)];
    expect(await runActiveNudgeCheck(check, { sleep: async () => {}, random: () => 0.05 })).toBe("fired");
    expect(chatInputs.map((input) => input.selectedPersonaId)).toEqual([ALTER_ID]);
  });

  it("holds the hourly cap for a parent after an Active Nudge in one of its threads", async () => {
    const cache = (client as unknown as { channels: { cache: Map<string, unknown> } }).channels.cache;
    cache.set("cap-thread", { isThread: () => true, parentId: "listed-parent" });
    historySpy.mockResolvedValue({
      recent: [
        {
          fire_id: 1,
          server_id: SERVER_ID,
          channel_disc_id: "cap-thread",
          persona_id: MAIN_ID,
          mode: "active",
          category: null,
          idle_nudge_key: null,
          target_user_id: null,
          opener_message_disc_id: ANCHOR_ID,
          answered: null,
          fired_at: new Date(Date.now() - 10 * 60_000),
        },
      ],
      latestIdleNudges: [],
    });
    try {
      expect(await runActiveNudgeCheck(check, options())).toBe("aborted");
      expect(samples.at(-1)).toMatchObject({ reason: "channel_cap", phase: "a" });
    } finally {
      cache.delete("cap-thread");
    }
  });

  it("counts today's Active Nudges against the level's cap", async () => {
    spies.push(recordFire());
    const CAP_BY_LEVEL = [
      [0, 1],
      [1, 3],
      [2, 6],
      [3, 10],
    ] as const;
    const activeNudgeFire = (fireId: number): NaturalNudgeFireRow => ({
      fire_id: fireId,
      server_id: SERVER_ID,
      channel_disc_id: "cap-other-channel",
      persona_id: MAIN_ID,
      mode: "active",
      category: null,
      idle_nudge_key: null,
      target_user_id: null,
      opener_message_disc_id: ANCHOR_ID,
      answered: null,
      fired_at: new Date(),
    });

    for (const [level, cap] of CAP_BY_LEVEL) {
      configSpy.mockResolvedValue({ ...defaultServerNaturalNudgeConfig(SERVER_ID), active_nudge_frequency: level });
      const fired = Array.from({ length: cap }, (_, index) => activeNudgeFire(index + 1));

      historySpy.mockResolvedValue({ recent: fired, latestIdleNudges: [] });
      expect(await runActiveNudgeCheck(check, options())).toBe("aborted");
      expect(samples.at(-1)).toMatchObject({ reason: "cap_reached", phase: "a" });

      historySpy.mockResolvedValue({ recent: fired.slice(1), latestIdleNudges: [] });
      expect(await runActiveNudgeCheck(check, options())).toBe("fired");
    }
  });

  it("lifts a failure stop itself once a turn has succeeded since, so idle nudges being off cannot strand it", async () => {
    const stoppedAt = new Date("2026-10-21T16:06:23Z");
    const clear = spyOn(naturalNudgeRepository, "clearFailures").mockResolvedValue(undefined);
    const lastTurn = spyOn(statRepository, "getServerMetricLastAt").mockResolvedValue(new Date("2026-10-21T16:05:00Z"));
    spies.push(
      clear,
      lastTurn,
      recordFire(),
      spyOn(naturalNudgeRepository, "loadRuntimeState").mockResolvedValue({
        server_id: SERVER_ID,
        idle_nudge_jitter: 1,
        consecutive_failures: 3,
        stopped_at: stoppedAt,
      }),
    );
    expect(await runActiveNudgeCheck(check, options())).toBe("aborted");
    expect(samples.at(-1)).toMatchObject({ reason: "stopped" });
    expect(clear).not.toHaveBeenCalled();

    lastTurn.mockResolvedValue(new Date("2026-10-21T16:07:18Z"));
    expect(await runActiveNudgeCheck(check, options())).toBe("fired");
    expect(clear).toHaveBeenCalledWith(SERVER_ID);
  });

  it("skips a channel where the bot cannot send, before any matcher call", async () => {
    canSend = false;
    expect(await runActiveNudgeCheck(check, options())).toBe("aborted");
    expect(samples.at(-1)).toMatchObject({ reason: "no_send_permission", phase: "a" });
    expect(matcher.matchActiveNudge).not.toHaveBeenCalled();
  });

  it("stays quiet when the winner already spoke in the matcher's window", async () => {
    window = [member(channel), self(channel)];
    expect(await runActiveNudgeCheck(check, options())).toBe("aborted");
    expect(chatInputs).toEqual([]);
    expect(samples.at(-1)).toMatchObject({ reason: "winner_spoke", phase: "a" });
  });

  it("aborts after the delay when a persona spoke or the channel became busy, before any re-match", async () => {
    const cases: Array<[string, () => Promise<void>]> = [
      [
        "persona_spoke",
        async () => {
          await postHumans(ACTIVE_NUDGE_STALE_HUMAN_MESSAGES);
          await observeActiveNudgeMessage(client, self(channel));
        },
      ],
      [
        "channel_busy",
        async () => {
          await postHumans(ACTIVE_NUDGE_STALE_HUMAN_MESSAGES);
          locked = true;
        },
      ],
    ];
    for (const [reason, duringDelay] of cases) {
      locked = false;
      match.mockClear();
      expect(await runActiveNudgeCheck(check, options(duringDelay))).toBe("aborted");
      expect(samples.at(-1)).toMatchObject({ reason, phase: "c" });
      expect(match).toHaveBeenCalledTimes(1);
    }
    expect(chatInputs).toEqual([]);
  });

  it("re-matches a filled window and speaks when the same interest wins again", async () => {
    spies.push(recordFire());
    matches = [
      defaultMatch,
      { choice: "i01", reason: "matched", kind: "llm", model: "fixture", usage: { inputTokens: 40, outputTokens: 5 } },
    ];
    expect(
      await runActiveNudgeCheck(
        check,
        options(() => postHumans(ACTIVE_NUDGE_STALE_HUMAN_MESSAGES)),
      ),
    ).toBe("fired");
    expect(match).toHaveBeenCalledTimes(2);
    expect(match.mock.calls[1][0].options).toEqual(match.mock.calls[0][0].options);
    expect(channels.buildMatcherEvidence).toHaveBeenLastCalledWith(window, GUILD_ID);
    expect(chatInputs.map((input) => input.selectedPersonaId)).toEqual([MAIN_ID]);
    expect(samples.at(-1)).toMatchObject({
      outcome: "fired",
      phase: "c",
      reason: "delivered",
      rematched: 1,
      rematch_tokens_in: 40,
      rematch_tokens_out: 5,
    });
  });

  it("aborts with window_gone when the re-match picks another interest or none", async () => {
    const seconds: matcher.MatcherResult[] = [
      { choice: "i02", reason: "matched", kind: "llm", model: "fixture" },
      { choice: null, reason: "none", kind: "llm", model: "fixture" },
    ];
    for (const second of seconds) {
      match.mockClear();
      window = [member(channel)];
      matches = [defaultMatch, second];
      expect(
        await runActiveNudgeCheck(
          check,
          options(() => postHumans(ACTIVE_NUDGE_STALE_HUMAN_MESSAGES)),
        ),
      ).toBe("aborted");
      expect(match).toHaveBeenCalledTimes(2);
      expect(samples.at(-1)).toMatchObject({
        outcome: "aborted",
        phase: "c",
        reason: "window_gone",
        rematched: 1,
      });
      expect(chatInputs).toEqual([]);
    }
  });

  it("makes no second matcher call below the stale threshold", async () => {
    spies.push(recordFire());
    expect(
      await runActiveNudgeCheck(
        check,
        options(() => postHumans(ACTIVE_NUDGE_STALE_HUMAN_MESSAGES - 1)),
      ),
    ).toBe("fired");
    expect(match).toHaveBeenCalledTimes(1);
    expect(samples.at(-1)).toMatchObject({ outcome: "fired", phase: "c", rematched: 0 });
  });

  it("aborts quietly when the second matcher call fails", async () => {
    const failure = spyOn(naturalNudgeRepository, "recordFailure").mockResolvedValue(null);
    spies.push(failure);
    matches = [defaultMatch, { choice: null, reason: "failed", kind: "llm", model: "fixture" }];
    expect(
      await runActiveNudgeCheck(
        check,
        options(() => postHumans(ACTIVE_NUDGE_STALE_HUMAN_MESSAGES)),
      ),
    ).toBe("aborted");
    expect(match).toHaveBeenCalledTimes(2);
    expect(samples.at(-1)).toMatchObject({
      outcome: "aborted",
      phase: "c",
      reason: "matcher_failed",
      rematched: 1,
    });
    expect(failure).not.toHaveBeenCalled();
    expect(chatInputs).toEqual([]);
  });

  it("aborts when a persona speaks or the channel locks during the second matcher call", async () => {
    const cases: Array<[string, () => Promise<void>]> = [
      ["persona_spoke", () => observeActiveNudgeMessage(client, self(channel))],
      [
        "channel_busy",
        async () => {
          locked = true;
        },
      ],
    ];
    for (const [reason, duringMatch] of cases) {
      locked = false;
      match.mockClear();
      matches = [defaultMatch, defaultMatch];
      let calls = 0;
      match.mockImplementation(async () => {
        calls++;
        const result = matches.shift() ?? defaultMatch;
        if (calls === 2) await duringMatch();
        return result;
      });
      expect(
        await runActiveNudgeCheck(
          check,
          options(() => postHumans(ACTIVE_NUDGE_STALE_HUMAN_MESSAGES)),
        ),
      ).toBe("aborted");
      expect(match).toHaveBeenCalledTimes(2);
      expect(samples.at(-1)).toMatchObject({
        outcome: "aborted",
        phase: "c",
        reason,
        rematched: 1,
      });
      expect(chatInputs).toEqual([]);
    }
  });

  it("aborts when the re-match window shows the chosen speaker already spoke", async () => {
    const duringDelay = async () => {
      await postHumans(ACTIVE_NUDGE_STALE_HUMAN_MESSAGES);
      window = [...window.slice(1), self(channel)];
    };
    expect(await runActiveNudgeCheck(check, options(duringDelay))).toBe("aborted");
    expect(match).toHaveBeenCalledTimes(1);
    expect(samples.at(-1)).toMatchObject({ outcome: "aborted", phase: "c", reason: "persona_spoke" });
    expect(chatInputs).toEqual([]);
  });

  it("reads an untrusted matcher answer as no fire", async () => {
    match.mockResolvedValue({ choice: null, reason: "refused", kind: "llm", model: "fixture" });
    expect(await runActiveNudgeCheck(check, options())).toBe("aborted");
    expect(samples.at(-1)).toMatchObject({ reason: "matcher_refused" });
    expect(chatInputs).toEqual([]);
  });
});
