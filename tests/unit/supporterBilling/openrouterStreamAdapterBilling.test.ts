import { afterEach, describe, expect, it, mock } from "bun:test";
import { findOpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import { OpenrouterStreamAdapter, type OpenrouterStreamConfig } from "@/providers/openrouter/openrouterStreamAdapter";
import { HumanizerDegree } from "@/types/db/schema";
import type { StreamContext } from "@/types/stream/interfaces";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { createPersona } from "../../helpers/fixtures";
import { stubGlobalFetch } from "../../helpers/fetchStub";
import { createSupporterFunding } from "../supporterBilling/guards/fundingFixtures";
import { getSupporterUsageContext } from "@/modules/supporter-billing/runtime/types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeStreamConfig(): OpenrouterStreamConfig {
  return {
    model: "example/model",
    apiKey: "test-key",
    temperature: 0.8,
    topP: 0.9,
    minP: 0.1,
    logitBias: { "123": -100 },
    inactivityTimeoutMs: 5_000,
    maxMessageLength: 2000,
    flushBufferSize: 1000,
    flushBufferSizeCodeBlock: 15000,
    baseTypeSpeedMsPerChar: 0,
    maxTypingTimeMs: 0,
    minVisibleTypingDurationMs: 0,
    humanizerDegree: HumanizerDegree.NONE,
    emojiUsageEnabled: true,
  };
}

function makeStreamContext(): StreamContext {
  return {
    channel: {},
    client: {},
    tomoriState: {
      persona_nickname: "Tomori",
      trigger_words: [],
      config: {
        llm_stop_speaker_pattern_enabled: false,
        llm_stop_strings: null,
        thinking_level: "none",
      },
    },
    contextItems: [],
    currentTurnModelParts: [],
    provider: "openrouter",
    locale: "en-US",
  } as unknown as StreamContext;
}

describe("OpenrouterStreamAdapter.processChunk", () => {
  it("defers a subscription spending-limit rejection to the turn's notice and keeps its limit source", async () => {
    for (const status of [402, 403]) {
      const fetchStub = stubGlobalFetch(
        () =>
          new Response(
            JSON.stringify({
              error: {
                code: status,
                message: "Key limit exceeded",
                metadata: { limit_source: "openrouter_key_limit" },
              },
            }),
            { status },
          ),
      );
      try {
        const send = mock(async () => ({ id: "message_1" }));
        const context = makeStreamContext();
        Object.assign(context.channel, { id: `openrouter_limit_${status}`, isThread: () => false, send });
        context.tomoriState = createPersona({
          persona_nickname: "Mirri",
          config: { thinking_level: "none", llm_stop_speaker_pattern_enabled: false },
        });
        context.textCredentialSource = "supporter";
        context.usageContext = getSupporterUsageContext(createSupporterFunding({ capability: "text" }));
        const result = await new StreamOrchestrator().streamToDiscord(
          new OpenrouterStreamAdapter(),
          makeStreamConfig(),
          context,
        );
        expect(result.status).toBe("error");
        expect(findOpenRouterLimitError(result.data)).toMatchObject({ limitSource: "openrouter_key_limit", status });
        expect(send).not.toHaveBeenCalled();
      } finally {
        fetchStub.mockRestore();
      }
    }
  });
});

describe("OpenrouterStreamAdapter.handleProviderError", () => {});

describe("OpenrouterStreamAdapter tool history", () => {});

describe("OpenrouterStreamAdapter parameter degradation", () => {});

describe("OpenrouterStreamAdapter response body teardown", () => {});

describe("OpenrouterStreamAdapter strict chat-completion compatibility", () => {});

describe("OpenrouterStreamAdapter first-token budget", () => {});
