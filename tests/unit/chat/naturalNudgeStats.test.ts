import * as tomoriChatModule from "@/events/messageCreate/tomoriChat";
import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { RecordStatInput } from "@/utils/db/repositories/StatRepository";
import type { ChatIncoming, ChatTurnContext, GenerationTurnResult, TomoriChatInput } from "@/utils/chat/types";
import { statRepository } from "@/utils/db/repositories";
import { runPostTurnEffects } from "@/utils/chat/postTurnEffects";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";

const recorded: RecordStatInput[] = [];
const recordStatSpy = spyOn(statRepository, "recordStat").mockImplementation((input: RecordStatInput) => {
  recorded.push(input);
});

const LINEAGE_ID = 5;
const NUDGE = { toolNames: ["web_search"] };

function makeContext(isNaturalNudge: boolean): ChatTurnContext {
  const channel = { id: `channel_${Math.random().toString(36).slice(2)}`, isThread: () => false };
  const message = { id: "message_1", channel, createdTimestamp: Date.now() };
  const incoming = {
    client: { channels: { fetch: async () => null } },
    message,
    isFromQueue: false,
    isManuallyTriggered: isNaturalNudge,
    retryCount: 0,
    skipLock: false,
    isPersonaJob: false,
    isUserImpersonation: false,
    textQuotaSource: isNaturalNudge ? "system" : "user",
    naturalNudge: isNaturalNudge ? NUDGE : undefined,
  } as unknown as ChatIncoming;
  const tomoriState = createPersona({
    server_id: 7,
    persona_lineage_id: LINEAGE_ID,
    config: { thought_log_channel_disc_id: null, private_channel_ids: [] },
  });
  return {
    client: incoming.client,
    message,
    channel,
    guild: { id: "123456789012345678" },
    locale: "en-US",
    turn: { lockedTurn: { admission: { incoming } }, triggeredPersonaIds: [] },
    currentPersona: { ...tomoriState, persona_id: 3, persona_nickname: "Mirri" },
    tomoriState,
    triggererUserId: 42,
    contextItems: [],
    shouldSurfaceUserErrors: false,
    isUserImpersonation: false,
    isDMChannel: false,
    isFromQueue: false,
    isPersonaJob: false,
    shouldApplyTextQuota: false,
    simplifiedMessages: [],
    isStopResponse: false,
    reunionPresence: null,
    textQuotaTriggerKey: "nudge:7:message_1",
    expressionDelivery: { delivered: null },
  } as unknown as ChatTurnContext;
}

const completed: GenerationTurnResult = {
  status: "completed",
  streamResults: [{ status: "completed", accumulatedText: "hello" }],
  personaResponses: [{ text: "hello", personaName: "Mirri", personaId: 3, personaLineageId: LINEAGE_ID }],
};

function metrics(): string[] {
  return recorded.map((entry) => entry.metric);
}

describe("Natural Nudges turns stay out of engagement stats", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  afterAll(() => {
    recordStatSpy.mockRestore();
  });

  beforeEach(() => {
    recorded.length = 0;
  });

  it("records neither message_sent nor active_hour for a nudge, but still records usage", async () => {
    await runPostTurnEffects(makeContext(true), completed);
    await Bun.sleep(0);

    expect(metrics()).not.toContain("message_sent");
    expect(metrics()).not.toContain("active_hour");
    expect(metrics()).toContain("model_used");
    expect(metrics()).toContain("text_generated");
  });

  it("records both for an ordinary turn", async () => {
    await runPostTurnEffects(makeContext(false), completed);
    await Bun.sleep(0);

    expect(metrics()).toContain("message_sent");
    expect(metrics()).toContain("active_hour");
  });

  it("keeps the nudge marker on the empty-response retry", async () => {
    const calls: TomoriChatInput[] = [];
    const chatSpy = spyOn(tomoriChatModule, "tomoriChat").mockImplementation(async (input) => {
      calls.push(input);
      return "run";
    });
    try {
      await runPostTurnEffects(makeContext(true), {
        status: "empty_response",
        streamResults: [],
        personaResponses: [],
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.naturalNudge).toEqual(NUDGE);
      expect(calls[0]?.skipLock).toBe(true);
    } finally {
      chatSpy.mockRestore();
    }
  });
});
