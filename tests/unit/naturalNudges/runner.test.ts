import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Collection, type Client, type GuildTextBasedChannel, type Message } from "discord.js";
import * as tomoriChatModule from "@/events/messageCreate/tomoriChat";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import type { NaturalNudgeFireRow } from "@/modules/natural-nudges/db/types";
import { BUILTIN_IDLE_NUDGES, type IdleNudgeDefinition } from "@/modules/natural-nudges/runtime/idleNudges";
import * as planner from "@/modules/natural-nudges/runtime/planner";
import * as plannerModel from "@/modules/natural-nudges/runtime/model";
import { runIdleNudgeAttempt, type IdleNudgeAttempt } from "@/modules/natural-nudges/runtime/runner";
import { metricSampleRepository } from "@/utils/db/repositories/MetricSampleRepository";
import { personaRepository } from "@/utils/db/repositories/PersonaRepository";
import { whitelistRepository } from "@/utils/db/repositories/WhitelistRepository";
import { createPersona } from "../../helpers/fixtures";
import type { TomoriChatInput } from "@/utils/chat/types";

const SERVER_ID = 7;
const PERSONA_ID = 5;
const PARTNER_ID = 6;
const RECORDED_ID = "1300000000000000200";
const OLDER_ID = "1300000000000000100";
const NEWER_ID = "1300000000000000300";
const PLACEHOLDER_ID = "1300000000000000400";

const spies: Array<{ mockRestore: () => void }> = [];
let chatInputs: TomoriChatInput[] = [];
let samples: Array<Record<string, unknown>> = [];
let configSpy: ReturnType<typeof spyOn<typeof naturalNudgeRepository, "loadServerConfig">>;
let historySpy: ReturnType<typeof spyOn<typeof naturalNudgeRepository, "loadFireHistory">>;

let onChatCall: (() => void | Promise<void>) | null = null;

beforeEach(() => {
  chatInputs = [];
  onChatCall = null;
  samples = [];
  configSpy = spyOn(naturalNudgeRepository, "loadServerConfig");
  configSpy.mockResolvedValue({
    idle_nudges_enabled: true,
    channel_disc_ids: ["fixture-channel"],
    llm_id: 1,
    idle_nudge_frequency: 1,
  } as never);
  historySpy = spyOn(naturalNudgeRepository, "loadFireHistory");
  historySpy.mockResolvedValue({ latestIdleNudges: [], recent: [] });
  spies.push(
    spyOn(planner, "planIdleNudge").mockResolvedValue({
      status: "planned",
      model: "fixture-planner",
      usage: null,
      plan: {
        channelIndex: 0,
        topic: "trains",
        openerDirection: "Ask about trains.",
        agenda: "Learn a route.",
        scene: null,
      },
    }),
    configSpy,
    spyOn(naturalNudgeRepository, "loadRuntimeState").mockResolvedValue({ stopped_at: null } as never),
    historySpy,
    spyOn(naturalNudgeRepository, "loadPersonaConfigs").mockResolvedValue(
      new Map([
        [
          PERSONA_ID,
          {
            persona_id: PERSONA_ID,
            talkativeness: 2,
            interests: [],
            has_override: true,
            idle_nudges: [],
            disabled_idle_nudge_ids: [],
            idle_nudges_override: false,
            idle_nudges_inherited: false,
          },
        ],
      ]),
    ),
    spyOn(personaRepository, "loadAllForServer").mockResolvedValue([
      { persona_id: PERSONA_ID },
      { persona_id: PARTNER_ID },
    ] as never),
    spyOn(whitelistRepository, "checkChannelWhitelist").mockResolvedValue(undefined as never),
    spyOn(whitelistRepository, "isPersonaAllowedByWhitelistStatus").mockReturnValue(true),
    spyOn(metricSampleRepository, "recordSample").mockImplementation(async (_name, fields) => {
      samples.push(fields);
    }),
    spyOn(plannerModel, "resolvePlannerModel").mockResolvedValue({
      kind: "ready",
      llmId: 1,
      slot: "nudge-planner",
      source: "pinned",
    }),
    spyOn(tomoriChatModule, "isChannelProcessingLocked").mockReturnValue(false),
    spyOn(tomoriChatModule, "tomoriChat").mockImplementation(async (input) => {
      chatInputs.push(input);
      await onChatCall?.();
      return "run";
    }),
  );
});

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

/** The gateway still reports `RECORDED_ID` as the newest message, as it does after that message is deleted. */
function attemptWithHistory(latest: () => Promise<Message[]>): {
  attempt: IdleNudgeAttempt;
  sent: string[];
  deleted: string[];
} {
  const sent: string[] = [];
  const deleted: string[] = [];
  const channel = {
    id: "fixture-channel",
    name: "general",
    lastMessageId: RECORDED_ID,
    messages: {
      fetch: async () => new Collection((await latest()).map((message) => [message.id, message])),
    },
    send: async ({ content }: { content: string }) => {
      sent.push(content);
      return {
        id: PLACEHOLDER_ID,
        channelId: "fixture-channel",
        delete: async () => {
          deleted.push(PLACEHOLDER_ID);
        },
      } as unknown as Message;
    },
  } as unknown as GuildTextBasedChannel;
  const attempt: IdleNudgeAttempt = {
    client: {} as Client,
    serverId: SERVER_ID,
    serverDiscId: "fixture-guild",
    timezoneOffset: 0,
    heat: 20,
    awake: Array.from({ length: 24 }, () => true),
    persona: createPersona({ persona_id: PERSONA_ID, server_id: SERVER_ID }),
    interests: [],
    idleNudge: BUILTIN_IDLE_NUDGES.find((candidate) => candidate.category === "start_topic") as IdleNudgeDefinition,
    plannerModel: { llmId: 1, slot: "nudge-planner" },
    availableTools: new Set(),
    plannerChannels: [{ channel, quietSinceMs: 0, transcript: "" }],
    target: null,
    partners: [],
  };
  return { attempt, sent, deleted };
}

const messageWithId = (id: string) => ({ id }) as Message;

function idleNudgeFire(fireId: number): NaturalNudgeFireRow {
  return {
    fire_id: fireId,
    server_id: SERVER_ID,
    channel_disc_id: "fixture-channel",
    persona_id: PERSONA_ID,
    mode: "idle",
    category: "start_topic",
    idle_nudge_key: "start_topic.interest_musing",
    target_user_id: null,
    opener_message_disc_id: RECORDED_ID,
    answered: true,
    fired_at: new Date(),
  };
}

describe("idle nudge anchor", () => {
  it("borrows the newest surviving message when the recorded newest one was deleted", async () => {
    const { attempt, sent } = attemptWithHistory(async () => [messageWithId(OLDER_ID)]);
    await runIdleNudgeAttempt(attempt);
    expect(chatInputs.map((input) => input.message.id)).toEqual([OLDER_ID]);
    expect(sent).toEqual([]);
  });

  it("deletes the placeholder before generation, so the blank line never waits in the channel", async () => {
    const { attempt, sent, deleted } = attemptWithHistory(async () => []);
    let deletedAtGeneration: string[] = [];
    onChatCall = () => {
      deletedAtGeneration = [...deleted];
    };

    await runIdleNudgeAttempt(attempt);

    expect(sent).toHaveLength(1);
    expect(chatInputs.map((input) => input.message.id)).toEqual([PLACEHOLDER_ID]);
    expect(deletedAtGeneration).toEqual([PLACEHOLDER_ID]);
    expect(deleted).toEqual([PLACEHOLDER_ID]);
  });

  it.each([
    RECORDED_ID,
    NEWER_ID,
  ])("uses the latest message after planning even when the gateway reports %s", async (gatewayMessageId) => {
    const latest = messageWithId(NEWER_ID);
    const { attempt, sent } = attemptWithHistory(async () => [latest]);
    attempt.plannerChannels[0].channel.lastMessageId = gatewayMessageId;
    const recordFire = spyOn(naturalNudgeRepository, "recordIdleNudgeFire").mockResolvedValue(true);
    spies.push(recordFire);
    onChatCall = async () => {
      await chatInputs.at(-1)?.onGenerationResult?.({
        status: "completed",
        streamResults: [],
        personaResponses: [
          { text: "A new topic.", personaName: attempt.persona.persona_nickname, personaId: PERSONA_ID },
        ],
        firstDeliveredMessageId: PLACEHOLDER_ID,
      });
    };

    expect(await runIdleNudgeAttempt(attempt)).toBe("fired");
    expect(chatInputs.map((input) => input.message)).toEqual([latest]);
    expect(chatInputs[0].borrowsTriggerMessage).toBe(true);
    expect(recordFire.mock.calls[0][0].openerMessageDiscId).toBe(PLACEHOLDER_ID);
    expect(sent).toEqual([]);
  });

  it("still aborts when another bot reply is processing after planning", async () => {
    const { attempt, sent } = attemptWithHistory(async () => [messageWithId(NEWER_ID)]);
    spies.push(spyOn(tomoriChatModule, "isChannelProcessingLocked").mockReturnValue(true));

    expect(await runIdleNudgeAttempt(attempt)).toBe("aborted");
    expect(samples.at(-1)).toMatchObject({ reason: "channel_busy", phase: "c" });
    expect(chatInputs).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("aborts without posting when the history read fails", async () => {
    const { attempt, sent } = attemptWithHistory(async () => {
      throw new Error("Discord unavailable");
    });

    expect(await runIdleNudgeAttempt(attempt)).toBe("aborted");
    expect(samples.at(-1)).toMatchObject({ reason: "anchor_unavailable", phase: "c" });
    expect(chatInputs).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe("daily idle nudge cap", () => {
  const CAP_BY_LEVEL = [
    [0, 1],
    [1, 3],
    [2, 5],
    [3, 8],
  ] as const;

  it("counts the idle nudges already fired today against the level's cap", async () => {
    for (const [level, cap] of CAP_BY_LEVEL) {
      configSpy.mockResolvedValue({
        idle_nudges_enabled: true,
        channel_disc_ids: ["fixture-channel"],
        llm_id: 1,
        idle_nudge_frequency: level,
      } as never);
      const fired = Array.from({ length: cap }, (_, index) => idleNudgeFire(index + 1));

      historySpy.mockResolvedValue({ latestIdleNudges: [], recent: fired });
      const { attempt } = attemptWithHistory(async () => [messageWithId(OLDER_ID)]);
      expect(await runIdleNudgeAttempt(attempt)).toBe("aborted");
      expect(samples.at(-1)).toMatchObject({ reason: "cap_reached", phase: "c" });

      historySpy.mockResolvedValue({ latestIdleNudges: [], recent: fired.slice(1) });
      const { attempt: allowed } = attemptWithHistory(async () => [messageWithId(OLDER_ID)]);
      await runIdleNudgeAttempt(allowed);
      expect(samples.at(-1)).toMatchObject({ reason: "admission_run", phase: "c" });
    }
  });
});

describe("Play Scene", () => {
  const OPENER_ID = "1300000000000000500";
  const LEAD_AGENDA = "Win the argument.";
  const PARTNER_AGENDA = "Reveal a secret hobby.";
  const contextText = (items: TomoriChatInput["injectedContextItems"]) =>
    JSON.stringify(items?.flatMap((item) => item.parts) ?? []);

  it("gives each partner only its own goal on its first turn and anchors every agenda to the opener", async () => {
    spies.push(
      spyOn(planner, "planIdleNudge").mockResolvedValue({
        status: "planned",
        model: "fixture-planner",
        usage: null,
        plan: {
          channelIndex: 0,
          topic: "mecha",
          openerDirection: "Claim the best mecha show.",
          agenda: LEAD_AGENDA,
          scene: { script: [1, 2, 1, 2], partnerAgendas: [PARTNER_AGENDA] },
        },
      }),
    );
    const recordFire = spyOn(naturalNudgeRepository, "recordIdleNudgeFire").mockResolvedValue(true);
    spies.push(recordFire);
    const { attempt } = attemptWithHistory(async () => [messageWithId(OLDER_ID)]);
    attempt.idleNudge = BUILTIN_IDLE_NUDGES.find(
      (candidate) => candidate.key === "play_scene.banter",
    ) as IdleNudgeDefinition;
    attempt.partners = [
      {
        persona: createPersona({ persona_id: PARTNER_ID, persona_nickname: "Juno", server_id: SERVER_ID }),
        interests: [],
      },
    ];

    await runIdleNudgeAttempt(attempt);
    const [input] = chatInputs;
    const scene = input.sceneTurn;
    expect(scene?.sequence.map((speaker) => speaker.personaId)).toEqual([
      PERSONA_ID,
      PARTNER_ID,
      PERSONA_ID,
      PARTNER_ID,
    ]);
    expect(contextText(input.injectedContextItems)).toContain(LEAD_AGENDA);
    expect(contextText(input.injectedContextItems)).not.toContain(PARTNER_AGENDA);
    expect(contextText(scene?.turnContextItems?.[1])).toContain(PARTNER_AGENDA);
    expect(contextText(scene?.turnContextItems?.[1])).not.toContain(LEAD_AGENDA);
    expect(scene?.turnContextItems?.[3]).toEqual([]);

    await input.onGenerationResult?.({
      status: "completed",
      streamResults: [],
      personaResponses: [{}],
      firstDeliveredMessageId: OPENER_ID,
    } as never);
    expect(recordFire).toHaveBeenCalledTimes(1);
    const [fire, agendas] = recordFire.mock.calls[0];
    expect(fire.openerMessageDiscId).toBe(OPENER_ID);
    expect(agendas).toEqual([
      { personaId: PERSONA_ID, agenda: LEAD_AGENDA },
      { personaId: PARTNER_ID, agenda: PARTNER_AGENDA },
    ]);
  });
});
