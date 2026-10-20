import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Collection, type Client, type GuildTextBasedChannel, type Message } from "discord.js";
import * as tomoriChatModule from "@/events/messageCreate/tomoriChat";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { defaultServerNaturalNudgeConfig } from "@/modules/natural-nudges/db/types";
import * as channels from "@/modules/natural-nudges/runtime/channels";
import {
  buildMatcherOptions,
  observeChimeInMessage,
  runChimeInCheck,
  type ChimeInCheck,
} from "@/modules/natural-nudges/runtime/chimeIns";
import * as configCache from "@/modules/natural-nudges/runtime/configCache";
import * as inFlight from "@/modules/natural-nudges/runtime/inFlight";
import * as matcher from "@/modules/natural-nudges/runtime/matcher";
import { CHIME_IN_OPTION_BUDGET } from "@/modules/natural-nudges/runtime/tuning";
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
const client = { user: { id: CLIENT_USER_ID } } as unknown as Client;
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

describe("Chime-in counter", () => {
  let claims: number;
  beforeEach(() => {
    claims = 0;
    spies.push(
      spyOn(configCache, "readChimeInGate").mockResolvedValue({
        serverId: SERVER_ID,
        config: defaultServerNaturalNudgeConfig(SERVER_ID),
        channelIds: new Set(["listed-parent"]),
        heat: 15,
      }),
      spyOn(autoTrigger, "rollAutochatTarget").mockReturnValue(3),
      spyOn(inFlight, "claimNudgeServer").mockImplementation(() => {
        claims++;
        return false;
      }),
    );
  });

  it("trips once per rolled count, counting a thread toward its listed parent", async () => {
    const thread = fakeChannel("counter-thread", "listed-parent");
    for (let index = 0; index < 4; index++) await observeChimeInMessage(client, member(thread));
    expect(claims).toBe(1);
  });

  it("counts neither bots nor members in channels off the list", async () => {
    const listed = fakeChannel("listed-parent");
    const other = fakeChannel("counter-unlisted");
    for (let index = 0; index < 5; index++) {
      await observeChimeInMessage(client, fakeMessage(listed, { id: "1300000000000000003", bot: true }));
      await observeChimeInMessage(client, member(other));
    }
    expect(claims).toBe(0);
  });

  it("starts over when a persona speaks", async () => {
    const thread = fakeChannel("counter-reset", "listed-parent");
    await observeChimeInMessage(client, member(thread));
    await observeChimeInMessage(client, member(thread));
    await observeChimeInMessage(client, self(thread));
    await observeChimeInMessage(client, member(thread));
    await observeChimeInMessage(client, member(thread));
    expect(claims).toBe(0);
    await observeChimeInMessage(client, member(thread));
    expect(claims).toBe(1);
  });
});

describe("matcher options", () => {
  it("merges a shared label into one option and never exceeds the option budget", () => {
    const many = Array.from({ length: CHIME_IN_OPTION_BUDGET }, (_, index) => ({
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
    expect(budgeted.options.length).toBeLessThanOrEqual(CHIME_IN_OPTION_BUDGET);
  });
});

describe("Chime-in check", () => {
  let chatInputs: TomoriChatInput[];
  let samples: Array<Record<string, unknown>>;
  let locked: boolean;
  let window: Message[];
  const channel = fakeChannel("listed-parent");
  const check: ChimeInCheck = {
    client,
    channel,
    listedChannelId: "listed-parent",
    guildId: GUILD_ID,
    serverId: SERVER_ID,
    heat: 15,
  };
  const recordFire = () => spyOn(naturalNudgeRepository, "recordChimeInFire").mockResolvedValue(true);

  beforeEach(() => {
    chatInputs = [];
    samples = [];
    locked = false;
    window = [member(channel)];
    spies.push(
      spyOn(tomoriStateCache, "getCachedAllPersonas").mockResolvedValue([main, alter]),
      spyOn(personaRepository, "loadAllForServer").mockResolvedValue([main, alter]),
      spyOn(naturalNudgeRepository, "loadServerConfig").mockResolvedValue(defaultServerNaturalNudgeConfig(SERVER_ID)),
      spyOn(naturalNudgeRepository, "loadRuntimeState").mockResolvedValue({
        server_id: SERVER_ID,
        episode_jitter: 1,
        consecutive_failures: 0,
        stopped_at: null,
      }),
      spyOn(naturalNudgeRepository, "loadFireHistory").mockResolvedValue({ recent: [], latestEpisodes: [] }),
      spyOn(naturalNudgeRepository, "loadPersonaConfigs").mockResolvedValue(
        new Map([
          [MAIN_ID, { persona_id: MAIN_ID, talkativeness: 2, interests: [MECHA], has_override: true }],
          [ALTER_ID, { persona_id: ALTER_ID, talkativeness: 0, interests: [], has_override: true }],
        ]),
      ),
      spyOn(channels, "resolveEffectiveChannelIds").mockResolvedValue(["listed-parent"]),
      spyOn(channels, "fetchRecentMessages").mockImplementation(async () => window),
      spyOn(channels, "buildMatcherEvidence").mockResolvedValue("Juno: the new Gundam is out"),
      spyOn(whitelistRepository, "checkChannelWhitelist").mockResolvedValue(undefined as never),
      spyOn(whitelistRepository, "isPersonaAllowedByWhitelistStatus").mockReturnValue(true),
      spyOn(matcher, "resolveMatcherBackend").mockResolvedValue({ kind: "llm", llmId: 1 }),
      spyOn(matcher, "matchChimeIn").mockResolvedValue({
        choice: "i01",
        reason: "matched",
        kind: "llm",
        model: "fixture",
      }),
      spyOn(metricSampleRepository, "recordSample").mockImplementation(async (_name, fields) => {
        samples.push(fields);
      }),
      spyOn(tomoriChatModule, "isChannelProcessingLocked").mockImplementation(() => locked),
      spyOn(tomoriChatModule, "suppressNextSelfReply").mockImplementation(() => undefined),
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

  it("speaks a plain turn as the interest's owner and records the fire", async () => {
    const fire = recordFire();
    spies.push(fire);
    expect(await runChimeInCheck(check, options())).toBe("fired");
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
    expect(await runChimeInCheck(check, { sleep: async () => {}, random: () => 0.05 })).toBe("fired");
    expect(chatInputs.map((input) => input.selectedPersonaId)).toEqual([ALTER_ID]);
  });

  it("skips a channel where the bot cannot send, before any matcher call", async () => {
    canSend = false;
    expect(await runChimeInCheck(check, options())).toBe("aborted");
    expect(samples.at(-1)).toMatchObject({ reason: "no_send_permission", phase: "a" });
    expect(matcher.matchChimeIn).not.toHaveBeenCalled();
  });

  it("stays quiet when the winner already spoke in the matcher's window", async () => {
    window = [member(channel), self(channel)];
    expect(await runChimeInCheck(check, options())).toBe("aborted");
    expect(chatInputs).toEqual([]);
    expect(samples.at(-1)).toMatchObject({ reason: "winner_spoke", phase: "a" });
  });

  it("aborts after the delay when a persona spoke or the channel became busy", async () => {
    const cases: Array<[string, () => Promise<void>]> = [
      ["persona_spoke", () => observeChimeInMessage(client, self(channel))],
      [
        "channel_busy",
        async () => {
          locked = true;
        },
      ],
    ];
    for (const [reason, duringDelay] of cases) {
      locked = false;
      expect(await runChimeInCheck(check, options(duringDelay))).toBe("aborted");
      expect(samples.at(-1)).toMatchObject({ reason, phase: "c" });
    }
    expect(chatInputs).toEqual([]);
  });

  it("reads an untrusted matcher answer as no fire", async () => {
    spies.push(
      spyOn(matcher, "matchChimeIn").mockResolvedValue({
        choice: null,
        reason: "refused",
        kind: "llm",
        model: "fixture",
      }),
    );
    expect(await runChimeInCheck(check, options())).toBe("aborted");
    expect(samples.at(-1)).toMatchObject({ reason: "matcher_refused" });
    expect(chatInputs).toEqual([]);
  });
});
