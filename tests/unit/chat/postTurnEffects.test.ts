import { beforeAll, describe, expect, it, mock } from "bun:test";
import type { TomoriState } from "@/types/db/schema";
import type { ChatIncoming, ChatTurn, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import { runPostTurnEffects, shouldRetryEmptyResponse } from "@/utils/chat/postTurnEffects";
import { recordReunionPresence, resolveReunionNote, type ReunionPresenceStore } from "@/utils/chat/reunionPresence";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";
import { localizedStatusTitle } from "@/utils/discord/ui/statusTitle";
import { ColorCode } from "@/utils/misc/logger";

const emptyResponseResult: GenerationTurnResult = {
  status: "empty_response",
  streamResults: [],
  personaResponses: [],
};

function makeContext(options: {
  shouldSurfaceUserErrors: boolean;
  isUserImpersonation?: boolean;
  textCredentialSource?: "server" | "personal";
}): {
  context: ChatTurnContext;
  send: ReturnType<typeof mock>;
} {
  const collector = {
    on: () => collector,
  };
  const send = mock(async (_payload: unknown) => ({
    id: "sent_msg_1",
    createMessageComponentCollector: () => collector,
  }));
  const channel = {
    id: `channel_${options.shouldSurfaceUserErrors ? "deliberate" : "passive"}`,
    send,
    isThread: () => false,
  };
  const message = {
    id: `message_${options.shouldSurfaceUserErrors ? "deliberate" : "passive"}`,
    channel,
    createdTimestamp: Date.now(),
  };
  const incoming = {
    client: {
      channels: {
        fetch: async () => null,
      },
    },
    message,
    isFromQueue: false,
    retryCount: 2,
    skipLock: false,
    isPersonaJob: false,
    isUserImpersonation: options.isUserImpersonation ?? false,
    textQuotaSource: "user",
  } as unknown as ChatIncoming;
  const tomoriState = {
    config: {
      thought_log_channel_disc_id: null,
      private_channel_ids: [],
    },
  };

  return {
    context: {
      client: incoming.client,
      message,
      channel,
      locale: "en-US",
      turn: {
        lockedTurn: {
          admission: {
            incoming,
          },
        },
      },
      currentPersona: tomoriState,
      tomoriState,
      shouldSurfaceUserErrors: options.shouldSurfaceUserErrors,
      isUserImpersonation: options.isUserImpersonation ?? false,
      textCredentialSource: options.textCredentialSource ?? "server",
      shouldApplyTextQuota: false,
      simplifiedMessages: [],
      isStopResponse: false,
      isDMChannel: false,
      reunionPresence: null,
    } as unknown as ChatTurnContext,
    send,
  };
}

describe("empty-response post-turn handling", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  it("allows two retries before exhausting the retry budget", () => {
    const incoming = { retryCount: 0 } as ChatIncoming;

    expect(shouldRetryEmptyResponse(incoming, emptyResponseResult)).toBe(true);
    incoming.retryCount = 1;
    expect(shouldRetryEmptyResponse(incoming, emptyResponseResult)).toBe(true);
    incoming.retryCount = 2;
    expect(shouldRetryEmptyResponse(incoming, emptyResponseResult)).toBe(false);
  });

  it("surfaces the localized terminal warning with recovery tips for a deliberate turn", async () => {
    const { context, send } = makeContext({ shouldSurfaceUserErrors: true });

    await runPostTurnEffects(context, emptyResponseResult);

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]?.[0] as
      | {
          embeds?: Array<{ toJSON: () => { title?: string; footer?: { text?: string } } }>;
          components?: Array<{ components?: Array<{ data?: { label?: string } }> }>;
        }
      | undefined;
    expect(payload?.embeds?.[0]?.toJSON().title).toBe(
      localizedStatusTitle("en-US", "genai.empty_response_title", ColorCode.WARN),
    );
    expect(payload?.embeds?.[0]?.toJSON().footer).toBeUndefined();
    expect(payload?.components?.length).toBeGreaterThan(0);
    expect(payload?.components?.[0]?.components?.[0]?.data?.label).toBe(localizedCopy("en-US", "genai.tips.button"));
  });

  it("surfaces the terminal warning even when partial text was already delivered to Discord", async () => {
    const { context, send } = makeContext({ shouldSurfaceUserErrors: true });
    const partiallyDeliveredResult: GenerationTurnResult = {
      ...emptyResponseResult,
      personaResponses: [
        {
          personaName: "Kamila",
          text: "you're a menace",
        },
      ],
    };

    await runPostTurnEffects(context, partiallyDeliveredResult);

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]?.[0] as
      | {
          embeds?: Array<{ toJSON: () => { title?: string } }>;
        }
      | undefined;
    expect(payload?.embeds?.[0]?.toJSON().title).toBe(
      localizedStatusTitle("en-US", "genai.empty_response_title", ColorCode.WARN),
    );
  });

  it("attaches personal-provider recovery guidance when textCredentialSource is personal", async () => {
    const { context, send } = makeContext({ shouldSurfaceUserErrors: true, textCredentialSource: "personal" });

    await runPostTurnEffects(context, emptyResponseResult);

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]?.[0] as
      | {
          components?: Array<{ components?: Array<{ data?: { label?: string } }> }>;
        }
      | undefined;
    expect(payload?.components?.length).toBeGreaterThan(0);
  });

  it("keeps terminal exhaustion silent for a passive turn", async () => {
    const { context, send } = makeContext({ shouldSurfaceUserErrors: false });

    await runPostTurnEffects(context, emptyResponseResult);

    expect(send).not.toHaveBeenCalled();
  });

  it("throws terminal exhaustion back to a user-impersonation flow", async () => {
    const { context, send } = makeContext({
      shouldSurfaceUserErrors: true,
      isUserImpersonation: true,
    });

    await expect(runPostTurnEffects(context, emptyResponseResult)).rejects.toThrow(
      "User impersonation returned an empty response.",
    );
    expect(send).not.toHaveBeenCalled();
  });
});

describe("reunion presence post-turn phase", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  const presenceStore: ReunionPresenceStore = {
    isTrackingEnabled: true,
    getUserPersonaReunionInfo: async () => ({ lastPreviousDayAt: null, seenToday: false }),
    recordPresenceSeen: async () => true,
  };
  const resolveArgs = {
    turn: { userRow: { user_id: 4101, timezone_offset: 0 }, triggererName: "Alice" } as ChatTurn,
    effectivePersona: {
      server_id: 5,
      persona_lineage_id: 4101,
      config: { time_awareness_enabled: true, timezone_offset: 0 },
    } as TomoriState,
    isUserImpersonation: false,
  };

  it("releases the context-build claim when the turn ends without a response", async () => {
    const claimed = await resolveReunionNote(resolveArgs, presenceStore);
    expect(claimed.presence?.mode).toBe("claimed");

    const { context } = makeContext({ shouldSurfaceUserErrors: false });
    context.reunionPresence = claimed.presence;
    await runPostTurnEffects(context, emptyResponseResult);

    // Still held, the claim would defer this second build instead of letting it claim again.
    const retry = await resolveReunionNote(resolveArgs, presenceStore);
    expect(retry.presence?.mode).toBe("claimed");
    await recordReunionPresence(retry.presence, emptyResponseResult, presenceStore);
  });
});
