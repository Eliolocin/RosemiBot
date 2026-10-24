import { afterEach, beforeEach, describe, expect, it, type Mock, spyOn } from "bun:test";
import type { Client, Message } from "discord.js";
import { tomoriChat } from "@/events/messageCreate/tomoriChat";
import * as admission from "@/utils/chat/admission";
import * as channelQueue from "@/utils/chat/channelQueue";
import { channelLocks, type QueuedMessage } from "@/utils/chat/channelQueue";
import * as contextPipelineIntent from "@/utils/chat/contextPipelineIntent";
import * as generationTurn from "@/utils/chat/generationTurn";
import * as postTurnEffects from "@/utils/chat/postTurnEffects";
import * as responseEmitter from "@/utils/chat/responseEmitter";
import * as turnPlanner from "@/utils/chat/turnPlanner";
import type {
  ChatAdmission,
  ChatIncoming,
  ChatTurnContext,
  GenerationTurnResult,
  NaturalNudgeTurn,
} from "@/utils/chat/types";

const CHANNEL_ID = "_rt_scene_cleanup";
const SCENE_TURN = { commandId: "nudge:7:anchor", sequence: [], turnIndex: 1, totalTurns: 3 };
const NUDGE: NaturalNudgeTurn = { toolNames: [] };

const spies: Array<{ mockRestore: () => void }> = [];
let clearSpy: Mock<(channelId: string) => QueuedMessage[]>;
let admissionDisposition: ChatAdmission["disposition"];
let generationResult: GenerationTurnResult;

const message = {
  id: "anchor",
  channelId: CHANNEL_ID,
  guildId: "300000000000000041",
  author: { id: "100000000000000041" },
  channel: { id: CHANNEL_ID, sendTyping: async () => undefined },
} as unknown as Message;

beforeEach(() => {
  admissionDisposition = "run";
  clearSpy = spyOn(channelQueue, "clearQueuedNudgeSceneWork").mockReturnValue([]);
  spies.push(
    clearSpy,
    spyOn(admission, "evaluateChatAdmission").mockImplementation(
      async (incoming: ChatIncoming) =>
        ({
          incoming,
          disposition: admissionDisposition,
          locale: "en-US",
          client: incoming.client,
          message,
          channel: message.channel,
          serverDiscId: "300000000000000041",
          userDiscId: "100000000000000041",
          referencedMessage: null,
        }) as ChatAdmission,
    ),
    spyOn(admission, "handleChatDisposition").mockResolvedValue(undefined),
    spyOn(turnPlanner, "planChatTurns").mockImplementation(async (lockedTurn) => ({
      lockedTurn,
      turns: [{ lockedTurn, personaIndex: 0, totalPersonas: 1 }] as never,
    })),
    spyOn(contextPipelineIntent, "buildChatTurnContext").mockImplementation(
      async (turn) => ({ turn }) as unknown as ChatTurnContext,
    ),
    spyOn(responseEmitter, "createChatResponseSink").mockReturnValue({} as never),
    spyOn(generationTurn, "runGenerationTurn").mockImplementation(async () => generationResult),
    spyOn(postTurnEffects, "runPostTurnEffects").mockResolvedValue(undefined),
  );
});

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  channelLocks.delete(CHANNEL_ID);
});

function result(status: GenerationTurnResult["status"], delivered = false): GenerationTurnResult {
  return { status, streamResults: [], personaResponses: delivered ? [{}] : [] } as unknown as GenerationTurnResult;
}

async function runSceneTurn(naturalNudge: NaturalNudgeTurn | undefined): Promise<boolean> {
  clearSpy.mockClear();
  await tomoriChat({
    client: {} as Client,
    message,
    isFromQueue: true,
    isManuallyTriggered: true,
    isPersonaJob: true,
    sceneTurn: SCENE_TURN,
    naturalNudge,
  });
  return clearSpy.mock.calls.some(([channelId]) => channelId === CHANNEL_ID);
}

describe("Natural Nudges scene cleanup", () => {
  it("drops the rest of the scene when a queued turn is rejected or posts nothing", async () => {
    admissionDisposition = "blocked";
    expect(await runSceneTurn(NUDGE)).toBe(true);

    admissionDisposition = "run";
    for (const status of ["error", "timeout", "skipped"] as const) {
      generationResult = result(status);
      expect({ status, cleared: await runSceneTurn(NUDGE) }).toEqual({ status, cleared: true });
    }
  });

  it("keeps the scene after a delivered turn, or while an empty reply is being retried", async () => {
    generationResult = result("completed", true);
    expect(await runSceneTurn(NUDGE)).toBe(false);
    generationResult = result("empty_response");
    expect(await runSceneTurn(NUDGE)).toBe(false);
  });

  it("leaves /generate scene turns alone", async () => {
    generationResult = result("error");
    expect(await runSceneTurn(undefined)).toBe(false);
    admissionDisposition = "blocked";
    expect(await runSceneTurn(undefined)).toBe(false);
  });
});
