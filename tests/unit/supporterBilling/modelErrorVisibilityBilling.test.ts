import { beforeAll, describe, expect, it, mock } from "bun:test";
import type { Client, TextChannel } from "discord.js";
import { HumanizerDegree, type TomoriState } from "@/types/db/schema";
import type { StreamConfig, StreamContext, StreamProvider } from "@/types/stream/interfaces";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { initializeLocalizer } from "@/utils/text/localizer";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";

function makeConfig(): StreamConfig {
  return {
    model: "bad-model",
    apiKey: "",
    temperature: 1,
    maxMessageLength: 1950,
    flushBufferSize: 1000,
    flushBufferSizeCodeBlock: 15000,
    inactivityTimeoutMs: 10_000,
    baseTypeSpeedMsPerChar: 0,
    maxTypingTimeMs: 0,
    minVisibleTypingDurationMs: 0,
    humanizerDegree: HumanizerDegree.NONE,
    emojiUsageEnabled: false,
  };
}

function makeContext(send: ReturnType<typeof mock>, suppressUserErrors: boolean): StreamContext {
  return {
    channel: {
      id: "channel_1",
      send,
    } as unknown as TextChannel,
    client: {} as Client,
    tomoriState: {
      server_id: 1,
      llm: { llm_provider: "fake" },
      persona_nickname: "Tomori",
      trigger_words: [],
      config: {},
      fallback_llms: [],
    } as unknown as TomoriState,
    contextItems: [],
    currentTurnModelParts: [],
    provider: "fake",
    locale: "en-US",
    suppressUserErrors,
  };
}

function makeProvider(): StreamProvider {
  return {
    async *startStream() {
      yield { data: {}, provider: "fake" };
    },
    processChunk() {
      return {
        type: "error",
        error: {
          type: "model_error",
          message:
            "Custom endpoint error: HTTP 400: Unsupported model `Deepseek` for provider `DeepSeek`. Supported IDs: `deepseek-auto`.",
          code: "400_model",
          retryable: false,
        },
      };
    },

    handleProviderError(error) {
      return {
        type: "model_error",
        message: error instanceof Error ? error.message : String(error),
        code: "model_error",
        retryable: false,
      };
    },
    createErrorDescription() {
      return "Error Code 400_model: Invalid request sent to provider";
    },
    getProviderInfo() {
      return {
        name: "fake",
        version: "test",
        supportsStreaming: true,
        supportsFunctionCalling: true,
      };
    },
  };
}

describe("StreamOrchestrator model-error visibility", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  it("defers subscription budget notices to generation so the final fallback outcome is known", async () => {
    const send = mock(async () => undefined);
    const provider = makeProvider();
    const denied = new SupporterRequestDeniedError("allowance_exhausted");
    provider.processChunk = () => ({
      type: "error",
      error: { type: "unknown", message: denied.message, retryable: false, originalError: denied },
    });
    const context = makeContext(send, false);
    context.textCredentialSource = "supporter";
    const result = await new StreamOrchestrator().streamToDiscord(provider, makeConfig(), context);
    expect(result.status).toBe("error");
    expect(send).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ originalError: denied });
  });
});
