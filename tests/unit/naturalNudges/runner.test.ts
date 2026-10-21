import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Collection, type Client, type GuildTextBasedChannel, type Message } from "discord.js";
import * as tomoriChatModule from "@/events/messageCreate/tomoriChat";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { BUILTIN_EPISODES, type EpisodeDefinition } from "@/modules/natural-nudges/runtime/episodes";
import * as planner from "@/modules/natural-nudges/runtime/planner";
import * as plannerModel from "@/modules/natural-nudges/runtime/model";
import { runEpisodeAttempt, type EpisodeAttempt } from "@/modules/natural-nudges/runtime/runner";
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

beforeEach(() => {
  chatInputs = [];
  spies.push(
    spyOn(planner, "planEpisode").mockResolvedValue({
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
    spyOn(naturalNudgeRepository, "loadServerConfig").mockResolvedValue({
      episodes_enabled: true,
      channel_disc_ids: ["fixture-channel"],
      llm_id: 1,
      daily_episode_cap: 3,
    } as never),
    spyOn(naturalNudgeRepository, "loadRuntimeState").mockResolvedValue({ stopped_at: null } as never),
    spyOn(naturalNudgeRepository, "loadFireHistory").mockResolvedValue({ latestEpisodes: [], recent: [] }),
    spyOn(naturalNudgeRepository, "loadPersonaConfigs").mockResolvedValue(
      new Map([[PERSONA_ID, { persona_id: PERSONA_ID, talkativeness: 2, interests: [], has_override: true }]]),
    ),
    spyOn(personaRepository, "loadAllForServer").mockResolvedValue([
      { persona_id: PERSONA_ID },
      { persona_id: PARTNER_ID },
    ] as never),
    spyOn(whitelistRepository, "checkChannelWhitelist").mockResolvedValue(undefined as never),
    spyOn(whitelistRepository, "isPersonaAllowedByWhitelistStatus").mockReturnValue(true),
    spyOn(metricSampleRepository, "recordSample").mockResolvedValue(undefined),
    spyOn(plannerModel, "resolvePlannerModel").mockResolvedValue({ kind: "ready", llmId: 1, source: "pinned" }),
    spyOn(tomoriChatModule, "isChannelProcessingLocked").mockReturnValue(false),
    spyOn(tomoriChatModule, "tomoriChat").mockImplementation(async (input) => {
      chatInputs.push(input);
      return "run";
    }),
  );
});

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

/** The gateway still reports `RECORDED_ID` as the newest message, as it does after that message is deleted. */
function attemptWithHistory(latest: () => Promise<Message[]>): {
  attempt: EpisodeAttempt;
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
  const attempt: EpisodeAttempt = {
    client: {} as Client,
    serverId: SERVER_ID,
    serverDiscId: "fixture-guild",
    timezoneOffset: 0,
    heat: 20,
    awake: Array.from({ length: 24 }, () => true),
    persona: createPersona({ persona_id: PERSONA_ID, server_id: SERVER_ID }),
    interests: [],
    episode: BUILTIN_EPISODES.find((candidate) => candidate.category === "new_topic") as EpisodeDefinition,
    plannerLlmId: 1,
    availableTools: new Set(),
    plannerChannels: [{ channel, lastMessageId: RECORDED_ID, quietSinceMs: 0, transcript: "" }],
    target: null,
    partners: [],
  };
  return { attempt, sent, deleted };
}

const messageWithId = (id: string) => ({ id }) as Message;

describe("episode anchor", () => {
  it("borrows the newest surviving message when the recorded newest one was deleted", async () => {
    const { attempt, sent } = attemptWithHistory(async () => [messageWithId(OLDER_ID)]);
    await runEpisodeAttempt(attempt);
    expect(chatInputs.map((input) => input.message.id)).toEqual([OLDER_ID]);
    expect(sent).toEqual([]);
  });

  it("speaks on a placeholder in an empty channel and removes it once the turn has run", async () => {
    const { attempt, sent, deleted } = attemptWithHistory(async () => []);
    await runEpisodeAttempt(attempt);
    expect(sent).toHaveLength(1);
    expect(chatInputs.map((input) => input.message.id)).toEqual([PLACEHOLDER_ID]);
    expect(deleted).toEqual([PLACEHOLDER_ID]);
  });

  it("aborts without posting when a newer message arrived or the history read fails", async () => {
    for (const latest of [
      async () => [messageWithId(NEWER_ID)],
      async () => {
        throw new Error("Discord unavailable");
      },
    ]) {
      const { attempt, sent } = attemptWithHistory(latest);
      expect(await runEpisodeAttempt(attempt)).toBe("aborted");
      expect(sent).toEqual([]);
    }
    expect(chatInputs).toEqual([]);
  });
});

describe("Alter Talk scene", () => {
  const OPENER_ID = "1300000000000000500";
  const LEAD_AGENDA = "Win the argument.";
  const PARTNER_AGENDA = "Reveal a secret hobby.";
  const contextText = (items: TomoriChatInput["injectedContextItems"]) =>
    JSON.stringify(items?.flatMap((item) => item.parts) ?? []);

  it("gives each partner only its own goal on its first turn and anchors every agenda to the opener", async () => {
    spies.push(
      spyOn(planner, "planEpisode").mockResolvedValue({
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
    const recordFire = spyOn(naturalNudgeRepository, "recordEpisodeFire").mockResolvedValue(true);
    spies.push(recordFire);
    const { attempt } = attemptWithHistory(async () => [messageWithId(OLDER_ID)]);
    attempt.episode = BUILTIN_EPISODES.find((candidate) => candidate.key === "alter_talk.banter") as EpisodeDefinition;
    attempt.partners = [
      {
        persona: createPersona({ persona_id: PARTNER_ID, persona_nickname: "Juno", server_id: SERVER_ID }),
        interests: [],
      },
    ];

    await runEpisodeAttempt(attempt);
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
