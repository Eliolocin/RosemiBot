import { ProviderRequestDeniedError, type ProviderUsageContext } from "@/utils/provider/providerUsage";
import { localizer } from "@/utils/text/localizer";
import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import type { Client, TextChannel } from "discord.js";
import { HumanizerDegree } from "@/types/db/schema";
import type {
  ProcessedChunk,
  ProviderError,
  StreamConfig,
  StreamContext,
  StreamProvider,
} from "@/types/stream/interfaces";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";

const config: StreamConfig = {
  model: "fixture",
  apiKey: "",
  temperature: 1,
  maxMessageLength: 1950,
  flushBufferSize: 1000,
  flushBufferSizeCodeBlock: 15000,
  inactivityTimeoutMs: 10000,
  baseTypeSpeedMsPerChar: 0,
  maxTypingTimeMs: 0,
  minVisibleTypingDurationMs: 0,
  // Must stream because NONE aggregates the reply into one final send that a failed stream never posts.
  humanizerDegree: HumanizerDegree.LIGHT,
  emojiUsageEnabled: false,
};

const CHANNEL_ID = "state_machine_fixture";
const POSTED_LINE = "Mirri finished this line.\n";
const UNFINISHED_CLAUSE = "and then started anoth";
const providerError: ProviderError = { type: "api_error", message: "upstream reset", code: "502", retryable: true };

function fixture(steps: Array<ProcessedChunk | (() => void)>, suppressUserErrors: boolean) {
  const send = mock(async (_payload: unknown) => ({ id: "sent_1", url: "", author: { id: "bot_1" } }));
  const context: StreamContext = {
    channel: { id: CHANNEL_ID, send, isThread: () => false } as unknown as TextChannel,
    client: {} as Client,
    tomoriState: createPersona({ persona_nickname: "Mirri", config: { humanizer_degree: HumanizerDegree.LIGHT } }),
    contextItems: [],
    currentTurnModelParts: [],
    provider: "fixture",
    locale: "en-US",
    deliveredMessageRefs: [],
    suppressUserErrors,
  };
  const provider: StreamProvider = {
    async *startStream() {
      for (const step of steps) {
        if (typeof step === "function") step();
        else yield { provider: "fixture", data: step };
      }
    },
    processChunk: (raw) => raw.data as ProcessedChunk,
    handleProviderError: () => ({ type: "unknown", retryable: false, message: "Fixture failure" }),
    createErrorDescription: () => null,
    getProviderInfo: () => ({ name: "fixture", version: "1", supportsStreaming: true, supportsFunctionCalling: true }),
  };
  return { context, provider };
}

describe("StreamOrchestrator failed-stream delivery", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  afterEach(() => StreamOrchestrator.clearStopRequest(CHANNEL_ID));

  it("leaves deferred request denials to the fallback owner and renders ordinary denials once", async () => {
    for (const deferNotice of [true, false]) {
      const usageContext: ProviderUsageContext = {};
      const denied = new ProviderRequestDeniedError(
        usageContext,
        (locale) => ({
          titleKey: "general.errors.api_key_error_title",
          description: localizer(locale, "general.errors.api_key_error_description"),
        }),
        { deferNotice },
      );
      const { context, provider } = fixture(
        [{ type: "error", error: { ...providerError, originalError: denied } }],
        false,
      );
      context.usageContext = usageContext;
      const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);
      expect(result.status).toBe("error");
      expect(context.channel.send).toHaveBeenCalledTimes(deferNotice ? 0 : 1);
    }
  });

  it("holds an unfinished clause back only while a retry may continue the posted text", async () => {
    for (const suppressUserErrors of [true, false]) {
      const { context, provider } = fixture(
        [
          { type: "text", content: POSTED_LINE },
          { type: "text", content: UNFINISHED_CLAUSE },
          { type: "error", error: providerError },
        ],
        suppressUserErrors,
      );

      const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);

      expect(result.status).toBe("error");
      expect(result.accumulatedText).toContain(POSTED_LINE.trim());
      expect(result.accumulatedText?.includes(UNFINISHED_CLAUSE)).toBe(!suppressUserErrors);
    }
  });

  it("returns the posted text when the stream is aborted or throws", async () => {
    const abortController = new AbortController();
    const aborted = fixture(
      [
        { type: "text", content: `${POSTED_LINE}Next` },
        () => abortController.abort(),
        { type: "text", content: "late" },
      ],
      true,
    );
    aborted.context.abortSignal = abortController.signal;
    const thrown = fixture(
      [
        { type: "text", content: `${POSTED_LINE}Next` },
        () => {
          throw new Error("socket closed");
        },
      ],
      true,
    );

    for (const { context, provider } of [aborted, thrown]) {
      const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);
      expect(result.status).toBe("error");
      expect(result.accumulatedText).toContain(POSTED_LINE.trim());
    }
  });
});
