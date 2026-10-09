import { llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import * as capabilityResolver from "@/utils/provider/providerCapabilityResolver";
import * as crypto from "@/utils/security/crypto";
import * as ruleChecks from "@/utils/chat/responseRuleCheck";
import * as decisionRouting from "@/utils/chat/responseDecisionRouting";
import { savedProviderConfigSchema } from "@/types/db/schema";
import { log } from "@/utils/misc/logger";
import { requestFollowUp, deleteStopRequest } from "@/utils/discord/stream/stopRequests";
import {
  buildReviewerPacket,
  createResponseReviewState,
  draftReviewResultSchema,
  reviewResponseCandidate,
  MAX_TOOL_REVIEWS,
  MAX_TOOL_CORRECTIONS,
  toolRequestIdentity,
} from "@/utils/chat/responseReview";
import type { ProviderStructuredJsonRequest } from "@/types/provider/featureInterfaces";
import { ContextItemTag } from "@/types/misc/context";
import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
// Captured BEFORE the `mock.module` calls below run. Static imports are
// evaluated at link time, ahead of any top-level statement, so this binds the
// REAL deliberateToolMode module; we re-register it in afterAll to undo the
// simplified stub for files loaded later in the monolithic run.
import * as realDeliberateToolMode from "@/utils/tools/deliberateToolMode";
// Same link-time capture for every other module mocked below. Spreading these
// namespaces makes each factory full-surface, so a partial mock can never break
// the module linking of a file loaded later in the monolithic `bun test`.
import * as realToolRegistry from "@/tools/toolRegistry";
import * as realChannelQueue from "@/utils/chat/channelQueue";
import * as realContextAnnotations from "@/utils/chat/contextAnnotations";
import * as realEmbedHelper from "@/utils/discord/embedHelper";
import * as realStreamOrchestrator from "@/utils/discord/streamOrchestrator";
import * as realToolProgressNotice from "@/utils/discord/toolProgressNotice";
import * as realProviderInfoRegistry from "@/utils/provider/providerInfoRegistry";
import { createScopedModuleMocker, overrideMembers, stubLogMembers } from "../../helpers/mockSurface";
import { createLlmRow, createPersona } from "../../helpers/fixtures";
import type { Sticker } from "discord.js";
import type { LLMProvider, ProviderConfig, StreamResult } from "@/types/provider/interfaces";
import type { StandardEmbedOptions } from "@/types/discord/embed";
import type { StructuredContextItem } from "@/types/misc/context";
import type { ChatTurnContext } from "@/utils/chat/types";
import type { ResponseReviewState } from "@/utils/chat/responseReview";
import type { PendingStreamResponse } from "@/types/stream/pendingResponse";
import type { TomoriState } from "@/types/db/schema";
import type { ToolResult } from "@/types/tool/interfaces";
import type { ToolLoopParams } from "@/utils/chat/toolLoop";
import { createExpressionDeliveryState } from "@/utils/chat/expressionDelivery";

let toolExecuteCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let toolExecuteQueue: ToolResult[] = [];
let requiresFollowUp = false;
let requiresFollowUpCalls: Array<{ name: string; serverId?: number }> = [];
let hasStopRequest = false;
let isFollowUpRequest = false;
let clearStopRequestCalls = 0;
let standardEmbedCalls: StandardEmbedOptions[] = [];
let hiddenToolNotices: string[] = [];
let activeStreamKill: ((reason: Error) => void) | null = null;
let onStopCheck: (() => void) | null = null;

// Module mocks: all must appear before the first lazy import of toolLoop.ts

// The real `ColorCode` enum comes through the spread, so its values stay the hex
// STRINGS other modules rely on at load time (e.g. contextEmbeds.ts calls
// ColorCode.ERROR.replace("#", "")). Only `log` is silenced.
const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/discord/embedHelper": realEmbedHelper,
  "@/utils/discord/toolProgressNotice": realToolProgressNotice,
  "@/utils/discord/streamOrchestrator": realStreamOrchestrator,
  "@/utils/provider/providerInfoRegistry": realProviderInfoRegistry,
  "@/utils/tools/deliberateToolMode": realDeliberateToolMode,
  "@/utils/chat/channelQueue": realChannelQueue,
  "@/utils/chat/contextAnnotations": realContextAnnotations,
  "@/tools/toolRegistry": realToolRegistry,
});

stubLogMembers({
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  success: () => undefined,
  section: () => undefined,
});

scopedMock.module("@/utils/discord/embedHelper", () => ({
  ...realEmbedHelper,
  sendStandardEmbed: async (_channel: unknown, _locale: string, options: StandardEmbedOptions) => {
    standardEmbedCalls.push(options);
  },
}));

scopedMock.module("@/utils/discord/toolProgressNotice", () => ({
  ...realToolProgressNotice,
  routeHiddenToolNotice: async (_context: unknown, embed: { description?: string }) => {
    hiddenToolNotices.push(embed.description ?? "");
  },
}));

scopedMock.module("@/utils/discord/streamOrchestrator", () => ({
  ...realStreamOrchestrator,
  // Statics are non-enumerable, so a spread would drop the whole class surface.
  StreamOrchestrator: overrideMembers(realStreamOrchestrator.StreamOrchestrator, {
    hasStopRequest: (_channelId: string) => {
      onStopCheck?.();
      return hasStopRequest;
    },
    isFollowUpRequest: (_channelId: string) => isFollowUpRequest,
    clearStopRequest: (_channelId: string) => {
      clearStopRequestCalls += 1;
      hasStopRequest = false;
    },
    getAndClearStopContext: (_channelId: string) => null,
  }),
}));

scopedMock.module("@/utils/provider/providerInfoRegistry", () => ({
  ...realProviderInfoRegistry,
  providerUsesApiFamily: (providerName: string, apiFamily: string) => {
    const families: Record<string, string> = {
      google: "google-genai",
      novelai: "novelai",
      openrouter: "openai-compatible",
    };
    return families[providerName.toLowerCase()] === apiFamily;
  },
}));

// Pass through to the REAL deliberateToolMode (captured at link time above).
// toolLoop.ts never calls these functions: it reads deliberate-mode data from
// `context` so the loop tests don't need a behavioral stub here; the mock
// exists only to satisfy transitive linking. Returning the real exports keeps
// the mock harmless if it leaks into a later file in the monolithic `bun test`
// (e.g. deliberateToolMode.test.ts, which asserts the real behavior). Spreading
// a statically-captured namespace is safe; unlike `await import()` inside a
// factory, it was evaluated before any mock.module call took effect.
scopedMock.module("@/utils/tools/deliberateToolMode", () => ({ ...realDeliberateToolMode }));

scopedMock.module("@/utils/chat/channelQueue", () => ({
  ...realChannelQueue,
  channelLocks: new Map(),
  setChannelStreamKill: (_channelId: string, kill: ((reason: Error) => void) | null) => {
    activeStreamKill = kill;
  },
  setChannelToolCallChainActive: () => undefined,
  getChannelTurnAbortSignal: () => undefined,
  incrementChannelFollowUpCount: () => undefined,
  resetChannelFollowUpCount: () => undefined,
  queueStopResponseAtFront: () => undefined,
}));

// Only the annotation entry point needs an inert stub for the loop tests; every
// other export passes through to the real module so this mock stays harmless
// when it leaks into a later file (e.g. contextMedia -> formatInlineSystemContent).
scopedMock.module("@/utils/chat/contextAnnotations", () => ({
  ...realContextAnnotations,
  annotateRecentMessageMetadataInContext: () => ({ annotatedCount: 0, patchedReplyReferenceCount: 0 }),
}));

// The ToolRegistry singleton: executeTool drains toolExecuteQueue.
scopedMock.module("@/tools/toolRegistry", () => ({
  ...realToolRegistry,
  // A class instance: its methods live on the prototype, so delegate rather
  // than spread or the remaining registry methods vanish for later files.
  ToolRegistry: overrideMembers(realToolRegistry.ToolRegistry, {
    executeTool: async (name: string, args: Record<string, unknown>) => {
      toolExecuteCalls.push({ name, args });
      const next = toolExecuteQueue.shift();
      return next ?? { success: true, data: { result: "ok" } };
    },
    requiresFollowUp: async (name: string, serverId?: number) => {
      requiresFollowUpCalls.push({ name, serverId });
      return requiresFollowUp;
    },
  }),
}));

function makeTomoriState(): TomoriState {
  return createPersona({
    persona_id: 42,
    persona_lineage_id: 420,
    persona_nickname: "TestBot",
    llm: createLlmRow({
      llm_codename: "test-model",
      has_tools: true,
      sees_images: false,
      sees_videos: false,
      sees_youtube: false,
      supports_structoutput: false,
    }),
    config: {
      // The schema stores the decrypted credential as bytes. The loop's credential arrives
      // through `providerConfig`, so this field only has to be present.
      api_key: Buffer.from("test-key"),
      llm_temperature: 0.7,
    },
  });
}

function makeContext(): ChatTurnContext {
  const channel = { id: "ch_test" };
  const tomoriState = makeTomoriState();
  return {
    channel,
    client: {},
    guild: null,
    locale: "en-US",
    message: { id: "msg_1", channel },
    contextItems: [],
    simplifiedMessages: [],
    messageIdMap: new Map(),
    emojiStrings: [],
    loadedEmojis: null,
    loadedStickers: null,
    channelName: "test-channel",
    channelDescription: null,
    serverDiscId: "server_1",
    serverName: "Test Server",
    serverDescription: null,
    userDiscId: "user_1",
    triggererName: "TestUser",
    textCredentialSource: "server",
    personalRoutingUserId: null,
    personalTextProvider: null,
    shouldApplyTextQuota: false,
    textQuotaTriggerKey: "turn_1",
    textQuotaState: null,
    // Disable user-facing embeds so sendStandardEmbed is never called for routing issues.
    shouldSurfaceUserErrors: false,
    isDMChannel: false,
    isFromQueue: true,
    isStopResponse: false,
    isPersonaJob: false,
    isSelfMessage: false,
    isUserImpersonation: false,
    allPersonas: [],
    currentPersona: tomoriState,
    tomoriState,
    requestSnapshot: {},
    streamingContext: { disableYouTubeProcessing: false },
    deliberateToolModeActive: false,
    deliberateToolContextTurns: 0,
    deliberateToolTriggerMatchByToolName: new Map(),
    expressionDelivery: createExpressionDeliveryState(),
    responseTarget: undefined,
    turn: {
      lockedTurn: {
        channelId: "ch_test",
        admission: { incoming: { retryCount: 0 } },
        lockedAt: Date.now(),
        queueDepth: 0,
        skipLock: false,
      },
    },
  } as unknown as ChatTurnContext;
}

/** A guild text channel whose sends record into `events`, with sticker sends eligible to deliver. */
function makeStickerContext(events: string[]): ChatTurnContext {
  const context = makeContext();
  const send = async () => {
    events.push("send");
    return { id: "900000000000000001", webhookId: null };
  };
  context.channel = { id: "ch_test", send, isThread: () => false } as unknown as ChatTurnContext["channel"];
  context.message = { id: "msg_1", channel: context.channel, reply: send } as unknown as ChatTurnContext["message"];
  context.guild = { id: "guild_1" } as unknown as ChatTurnContext["guild"];
  context.client = { user: null } as unknown as ChatTurnContext["client"];
  return context;
}

function makeProviderConfig(): ProviderConfig {
  return { model: "test-model", apiKey: "test-key", temperature: 0.7 };
}

/** Function-call stream result: simulates the provider requesting a tool. */
function makeFunctionCallResult(
  name: string,
  args: Record<string, unknown> = {},
  accumulatedText?: string,
): StreamResult {
  return { status: "function_call", data: { name, args }, accumulatedText };
}

/**
 * Creates a fake LLMProvider whose streamToDiscord pops from a result queue.
 * Returns the provider and an array that accumulates every functionInteractionHistory
 * array passed to each call, so tests can verify what the provider sees.
 */
function makeProvider(
  results: StreamResult[],
  providerName = "test-provider",
  simulateBufferedTextParts = false,
): {
  provider: LLMProvider;
  capturedHistories: Array<unknown[]>;
  capturedContexts: unknown[];
  capturedModelParts: Array<Array<Record<string, unknown>>>;
} {
  const capturedHistories: Array<unknown[]> = [];
  const capturedContexts: unknown[] = [];
  const capturedModelParts: Array<Array<Record<string, unknown>>> = [];
  const queue = [...results];

  const provider = {
    getInfo: () => ({
      name: providerName,
      displayName: "Test Provider",
      supportedModels: ["test-model"],
      requiresApiKey: false,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsImages: false,
      supportsVideos: false,
      apiFamily: "openai-compatible",
      supportedParams: [],
      featureSupport: {
        imageGeneration: "none",
        videoGeneration: "none",
        embeddings: false,
        structuredOutput: false,
        presetGeneration: false,
        expressionInitialization: false,
        liveTokenCounting: false,
        conversationCompaction: false,
        historyExtraction: false,
      },
    }),
    streamToDiscord: async (
      _ch: unknown,
      _cl: unknown,
      _ts: unknown,
      _cfg: unknown,
      _ctx: unknown,
      modelPartsInput: unknown,
      _emoji: unknown,
      functionHistory: unknown[] | undefined,
    ) => {
      capturedHistories.push(functionHistory ? [...functionHistory] : []);
      capturedContexts.push(JSON.parse(JSON.stringify(_ctx)));
      const modelParts = modelPartsInput as Array<Record<string, unknown>>;
      capturedModelParts.push([...modelParts]);
      const next = queue.shift();
      if (!next) throw new Error("Fake provider: no more queued stream results");
      if (simulateBufferedTextParts && next.accumulatedText?.trim()) {
        modelParts.push({ text: next.accumulatedText });
      }
      return next;
    },
    validateApiKey: async () => ({ valid: true }),
    formatErrorDescription: () => null,
    getTools: async () => [
      {
        functionDeclarations: [
          "lookup",
          "create_long_term_memory",
          "mirror_action",
          "other_action",
          "fetch-url",
          "fetch",
          "brave_web_search",
        ].map((name) => ({
          name,
          description: "Harmless fixture action",
          parameters: { type: "object", properties: { target: { type: "string" }, text: { type: "string" } } },
        })),
      },
    ],
    getDefaultModel: async () => "test-model",
    createConfig: async () => makeProviderConfig(),
  } as unknown as LLMProvider;

  return { provider, capturedHistories, capturedModelParts, capturedContexts };
}

/** Convenience: build ToolLoopParams from a context and provider. */
function makeParams(context: ChatTurnContext, provider: LLMProvider): ToolLoopParams {
  return { context, provider, providerConfig: makeProviderConfig(), tomoriState: context.tomoriState };
}

function makeReviewContext(): ChatTurnContext & { responseReview: ResponseReviewState } {
  const context = makeContext();
  context.currentPersona.config.response_drafting_enabled = true;
  context.currentPersona.config.response_reviewer_prompt = "Evaluate the character in the admitted scene.";
  context.tomoriState.llm.supports_structoutput = true;
  context.tomoriState.llm.context_window = 64000;
  context.contextItems = [
    {
      role: "system",
      metadataTag: ContextItemTag.SYSTEM_PERSONALITY,
      parts: [{ type: "text", text: "Mirri is terse, stubborn and speaks softly." }],
    },
    {
      role: "user",
      metadataTag: ContextItemTag.DIALOGUE_HISTORY,
      messageId: context.message.id,
      sender: { name: "Juno", type: "user" },
      parts: [{ type: "text", text: "Stay here with me." }],
    },
    {
      role: "user",
      metadataTag: ContextItemTag.DIALOGUE_SAMPLE,
      parts: [{ type: "text", text: "A sample invitation." }],
    },
    {
      role: "model",
      metadataTag: ContextItemTag.DIALOGUE_SAMPLE,
      parts: [{ type: "text", text: "A sample quiet reply." }],
    },
  ];
  const responseReview = createResponseReviewState(context);
  if (!responseReview) throw new Error("Review fixture must be enabled");
  context.streamingContext.holdResponseText = true;
  return Object.assign(context, { responseReview });
}

function held(
  text: string,
  delivered: string[],
  status: StreamResult["status"] = "completed",
): StreamResult & { pendingResponse: PendingStreamResponse } {
  return {
    status,
    accumulatedText: "",
    usage: { inputTokens: 10, outputTokens: 5 },
    pendingResponse: {
      text,
      retainedBytes: Buffer.byteLength(text, "utf8"),
      segments: 1,
      deliver: async () => {
        delivered.push(text);
        return { status: "completed", accumulatedText: text };
      },
    },
  };
}

describe("runToolLoop — contract tests", () => {
  beforeEach(() => {
    toolExecuteCalls = [];
    toolExecuteQueue = [];
    requiresFollowUp = false;
    requiresFollowUpCalls = [];
    hasStopRequest = false;
    isFollowUpRequest = false;
    clearStopRequestCalls = 0;
    standardEmbedCalls = [];
    hiddenToolNotices = [];
    onStopCheck = null;
    activeStreamKill = null;
  });

  it("executes tool with correct args and delivers result to next provider call", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    const { provider, capturedHistories } = makeProvider([
      makeFunctionCallResult("echo_tool", { text: "hello" }),
      { status: "completed", accumulatedText: "I echoed: hello" },
    ]);
    toolExecuteQueue.push({ success: true, data: { echoed: "hello" } });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");
    expect(result.personaResponses).toHaveLength(1);
    expect(result.personaResponses[0]?.text).toBe("I echoed: hello");

    expect(toolExecuteCalls).toHaveLength(1);
    expect(toolExecuteCalls[0]?.name).toBe("echo_tool");
    expect(toolExecuteCalls[0]?.args).toEqual({ text: "hello" });

    expect(capturedHistories).toHaveLength(2);

    expect(capturedHistories[0]).toHaveLength(0);

    const secondHistory = capturedHistories[1] as Array<{
      functionCall: { name: string };
      functionResponse: { functionResponse: { name: string; response: { result: unknown } } };
    }>;
    expect(secondHistory).toHaveLength(1);
    expect(secondHistory[0]?.functionCall?.name).toBe("echo_tool");
    expect(secondHistory[0]?.functionResponse?.functionResponse?.name).toBe("echo_tool");

    const resultData = secondHistory[0]?.functionResponse?.functionResponse?.response?.result as {
      echoed: string;
    };
    expect(resultData?.echoed).toBe("hello");

    expect(result.streamResults).toHaveLength(2);
  });

  it("preserves direct tool delivery when the tool ends without streamed text", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const { provider } = makeProvider([makeFunctionCallResult("voice_tool")]);
    toolExecuteQueue.push({ success: true, responseDelivered: true, endTurn: true });

    const result = await runToolLoop(makeParams(makeContext(), provider));

    expect(result.status).toBe("completed");
    expect(result.personaResponses).toHaveLength(0);
    expect(result.toolResponseDelivered).toBe(true);
  });

  it("tool failure: error is represented in the history entry and the loop continues", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    const { provider, capturedHistories } = makeProvider([
      makeFunctionCallResult("bad_tool", {}),
      { status: "completed", accumulatedText: "sorry about that" },
    ]);
    // One failure: below the consecutive-error cap (3).
    toolExecuteQueue.push({ success: false, error: "something broke" });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");
    expect(result.personaResponses[0]?.text).toBe("sorry about that");

    expect(toolExecuteCalls).toHaveLength(1);

    // History entry for the failed call uses the standardized failure shape.
    const secondHistory = capturedHistories[1] as Array<{
      functionCall: { name: string };
      functionResponse: { functionResponse: { response: { result: { status: string; tool_name: string } } } };
    }>;
    expect(secondHistory).toHaveLength(1);
    const failResult = secondHistory[0]?.functionResponse?.functionResponse?.response?.result;
    expect(failResult?.status).toBe("tool_execution_failed");
    expect(failResult?.tool_name).toBe("bad_tool");

    // The raw internal error string is not surfaced as the final response text.
    expect(result.personaResponses[0]?.text).not.toContain("something broke");
  });

  it("consecutive tool errors: loop exits with 'error' after MAX_CONSECUTIVE_TOOL_ERRORS failures", async () => {
    const { runToolLoop, MAX_CONSECUTIVE_TOOL_ERRORS } = await import("@/utils/chat/toolLoop");

    const { provider } = makeProvider(Array.from({ length: 20 }, () => makeFunctionCallResult("fail_tool", {})));
    for (let i = 0; i < 20; i++) {
      toolExecuteQueue.push({ success: false, error: "always broken" });
    }

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("error");
    expect(toolExecuteCalls).toHaveLength(MAX_CONSECUTIVE_TOOL_ERRORS);

    expect(result.personaResponses).toHaveLength(0);
  });

  it("deliberate tool mode: blocked tool is NOT dispatched and gets synthetic failure in history", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    const { provider, capturedHistories } = makeProvider([
      makeFunctionCallResult("blocked_tool", { q: "test" }),
      { status: "completed", accumulatedText: "ok got it" },
    ]);

    const context = makeContext();
    // Deliberate mode is on; only "allowed_tool" is exposed.
    context.deliberateToolModeActive = true;
    context.streamingContext.deliberateToolAllowedNames = ["allowed_tool"];

    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");

    // ToolRegistry.executeTool must NOT have been called for the blocked tool.
    expect(toolExecuteCalls).toHaveLength(0);

    // The history entry given to the provider must carry the standardized failure shape.
    // Note: toolResult.data has `blocked_by_deliberate_tool_mode` but since success===false,
    // executeToolCall routes through the generic failure path → status="tool_execution_failed".
    const secondHistory = capturedHistories[1] as Array<{
      functionCall: { name: string };
      functionResponse: {
        functionResponse: {
          response: { result: { status: string; tool_name: string; reason: string } };
        };
      };
    }>;
    expect(secondHistory).toHaveLength(1);
    expect(secondHistory[0]?.functionCall?.name).toBe("blocked_tool");
    const syntheticResult = secondHistory[0]?.functionResponse?.functionResponse?.response?.result;
    expect(syntheticResult?.status).toBe("tool_execution_failed");
    expect(syntheticResult?.tool_name).toBe("blocked_tool");
    // Reason must mention that the tool was not exposed (not a generic failure).
    expect(syntheticResult?.reason).toContain("not exposed");
  });

  it("loop bound: exits with 'timeout' after MAX_FUNCTION_CALL_ITERATIONS with no final answer", async () => {
    const { runToolLoop, MAX_FUNCTION_CALL_ITERATIONS } = await import("@/utils/chat/toolLoop");

    // Provider never produces a terminal result, always requests another tool.
    const { provider } = makeProvider(
      Array.from({ length: MAX_FUNCTION_CALL_ITERATIONS + 5 }, () => makeFunctionCallResult("infinite_tool", {})),
    );
    for (let i = 0; i < MAX_FUNCTION_CALL_ITERATIONS + 5; i++) {
      toolExecuteQueue.push({ success: true, data: { ok: true } });
    }

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("timeout");
    // Exactly one tool call per iteration, and no more iterations than the loop allows.
    expect(toolExecuteCalls).toHaveLength(MAX_FUNCTION_CALL_ITERATIONS);
    expect(result.streamResults).toHaveLength(MAX_FUNCTION_CALL_ITERATIONS);
  });

  it("malformed function-call (missing name) aborts with 'error' without dispatching any tool", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    // data has no `name` field, so should trigger the validation abort path.
    const { provider } = makeProvider([{ status: "function_call", data: {} }]);

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("error");
    expect(toolExecuteCalls).toHaveLength(0);
  });

  it("context-restart response: enriched item injected into contextItems, no history entry for that tool call", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    const { provider, capturedHistories } = makeProvider([
      makeFunctionCallResult("reveal_tool", {}),
      { status: "completed", accumulatedText: "here you go" },
    ]);

    // Tool returns a context_restart_youtube signal with an enhanced_context_item.
    const fakeContextItem: StructuredContextItem = {
      role: "user",
      parts: [{ type: "text", text: "YouTube transcript: ..." }],
    };
    toolExecuteQueue.push({
      success: true,
      data: {
        type: "context_restart_youtube",
        enhanced_context_item: fakeContextItem,
      },
    });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");
    expect(result.personaResponses[0]?.text).toBe("here you go");

    // The enriched item must be appended to contextItems.
    expect(context.contextItems).toContain(fakeContextItem);

    // The streaming-context disable flag must have been set.
    expect(context.streamingContext.disableYouTubeProcessing).toBe(true);

    // The context-restart call must NOT appear in the function history
    // passed to the second provider call (restart replaces it with enriched context).
    expect(capturedHistories).toHaveLength(2);
    expect(capturedHistories[1]).toHaveLength(0); // no history entry for the restart call
  });

  it("context-restart response: stashed item injected when the tool returns only a pending_context_key", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const { stashEnhancedContextItem } = await import("@/utils/chat/pendingEnhancedContext");

    const { provider } = makeProvider([
      makeFunctionCallResult("peek_profile_picture", {}),
      { status: "completed", accumulatedText: "cute pfp" },
    ]);

    // peek_profile_picture keeps its base64 payload out of ToolResult.data (the registry
    // retains results), so the loop must drain the stash to see the image at all.
    const stashedItem = {
      role: "user",
      parts: [{ type: "image", uri: "data:image/png;base64,AAAA" }],
    } as unknown as Parameters<typeof stashEnhancedContextItem>[0];
    const pendingContextKey = stashEnhancedContextItem(stashedItem);

    toolExecuteQueue.push({
      success: true,
      data: {
        type: "context_restart_with_image",
        pending_context_key: pendingContextKey,
      },
    });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");
    expect(context.contextItems).toContain(stashedItem);
    expect(context.streamingContext.disableProfilePictureProcessing).toBe(true);
  });

  it("context-restart response: a stashed item is consumed once, so a replayed key injects nothing", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const { stashEnhancedContextItem } = await import("@/utils/chat/pendingEnhancedContext");

    const { provider } = makeProvider([
      makeFunctionCallResult("peek_profile_picture", {}),
      makeFunctionCallResult("peek_profile_picture", {}),
      { status: "completed", accumulatedText: "done" },
    ]);

    const stashedItem = { role: "user", parts: [{ type: "text", text: "avatar" }] } as unknown as Parameters<
      typeof stashEnhancedContextItem
    >[0];
    const pendingContextKey = stashEnhancedContextItem(stashedItem);

    const restartResult = {
      success: true,
      data: { type: "context_restart_with_image", pending_context_key: pendingContextKey },
    };
    toolExecuteQueue.push(restartResult, restartResult);

    const context = makeContext();
    const initialItemCount = context.contextItems.length;
    await runToolLoop(makeParams(context, provider));

    expect(context.contextItems.length).toBe(initialItemCount + 1);
  });

  // Pre-tool text preservation (post-tool-call amnesia regression)

  it("pre-tool text is preserved in the history entry passed to the follow-up provider call", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    const { provider, capturedHistories } = makeProvider([
      makeFunctionCallResult("create_long_term_memory", { content: "likes cats" }, "Yeah, let me remember that."),
      { status: "completed", accumulatedText: "Saved! Anything else?" },
    ]);
    toolExecuteQueue.push({ success: true, data: { saved: true } });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    // The loop continued to a follow-up provider call, so long-term memory
    // must NOT behave as an end-turn tool.
    expect(result.status).toBe("completed");
    expect(capturedHistories).toHaveLength(2);
    expect(result.personaResponses[0]?.text).toBe("Saved! Anything else?");

    // The follow-up call's history entry carries the already-sent text so the
    // model knows not to repeat it (the amnesia fix contract).
    const secondHistory = capturedHistories[1] as Array<{
      functionCall: { name: string };
      preToolCallTextParts?: Array<Record<string, unknown>>;
    }>;
    expect(secondHistory).toHaveLength(1);
    expect(secondHistory[0]?.preToolCallTextParts).toEqual([{ type: "text", text: "Yeah, let me remember that." }]);
  });

  it("removes pre-tool text from trailing model prefill after moving it into tool history", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const { provider, capturedModelParts } = makeProvider(
      [
        makeFunctionCallResult("echo_tool", {}, "Let me check that."),
        { status: "completed", accumulatedText: "Here is the result." },
      ],
      "openrouter",
      true,
    );
    toolExecuteQueue.push({ success: true, data: { summary: "Tool result" } });

    const result = await runToolLoop(makeParams(makeContext(), provider));

    expect(result.status).toBe("completed");
    expect(capturedModelParts).toEqual([[], []]);
  });

  it("no pre-tool text: history entry omits preToolCallTextParts", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    const { provider, capturedHistories } = makeProvider([
      makeFunctionCallResult("echo_tool", {}, "   "),
      { status: "completed", accumulatedText: "done" },
    ]);
    toolExecuteQueue.push({ success: true, data: { ok: true } });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");
    const secondHistory = capturedHistories[1] as Array<{
      preToolCallTextParts?: Array<Record<string, unknown>>;
    }>;
    expect(secondHistory).toHaveLength(1);
    expect(secondHistory[0]?.preToolCallTextParts).toBeUndefined();
  });

  it("multi-tool chain: each history entry carries only its own iteration's pre-tool text", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    const { provider, capturedHistories } = makeProvider([
      makeFunctionCallResult("tool_one", {}, "First, let me check something."),
      makeFunctionCallResult("tool_two", {}, "Now one more thing."),
      { status: "completed", accumulatedText: "All done!" },
    ]);
    toolExecuteQueue.push({ success: true, data: { ok: 1 } });
    toolExecuteQueue.push({ success: true, data: { ok: 2 } });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");
    expect(capturedHistories).toHaveLength(3);

    // The third provider call sees both entries, each with its own text:
    // no duplication across iterations (fresh stream state per streamOnce).
    const thirdHistory = capturedHistories[2] as Array<{
      functionCall: { name: string };
      preToolCallTextParts?: Array<Record<string, unknown>>;
    }>;
    expect(thirdHistory).toHaveLength(2);
    expect(thirdHistory[0]?.preToolCallTextParts).toEqual([{ type: "text", text: "First, let me check something." }]);
    expect(thirdHistory[1]?.preToolCallTextParts).toEqual([{ type: "text", text: "Now one more thing." }]);
  });

  it("update_short_term_memory with pre-tool text still ends the turn without a follow-up call", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    const { provider, capturedHistories } = makeProvider([
      makeFunctionCallResult("update_short_term_memory", { content: "note" }, "Got it, noting that down."),
    ]);
    toolExecuteQueue.push({ success: true, data: { saved: true } });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    // Suppress-set tool ends the turn after pre-tool text; the visible text is the response.
    expect(result.status).toBe("completed");
    expect(capturedHistories).toHaveLength(1);
    expect(result.personaResponses[0]?.text).toBe("Got it, noting that down.");
    expect(requiresFollowUpCalls).toHaveLength(0);
  });

  it("an empty follow-up after delivered text completes only when the model had nothing to add", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const cases: Array<{ label: string; empty: StreamResult; needsFollowUp: boolean; expected: string }> = [
      { label: "settled", empty: { status: "empty_response" }, needsFollowUp: false, expected: "completed" },
      { label: "lookup tool", empty: { status: "empty_response" }, needsFollowUp: true, expected: "empty_response" },
      {
        label: "token cap",
        empty: { status: "empty_response", data: { finishReason: "length" } },
        needsFollowUp: false,
        expected: "empty_response",
      },
      {
        label: "speaker guard",
        empty: { status: "empty_response", data: { emptyResponseReason: "speaker_guard" } },
        needsFollowUp: false,
        expected: "empty_response",
      },
      {
        label: "held NovelAI fragment",
        empty: { status: "empty_response", naiContinuationPrefill: "and then" },
        needsFollowUp: false,
        expected: "empty_response",
      },
    ];

    const failures: string[] = [];
    for (const testCase of cases) {
      const { provider } = makeProvider([
        makeFunctionCallResult("echo_tool", {}, "Let me check that."),
        testCase.empty,
      ]);
      toolExecuteQueue.push({ success: true, data: { saved: true } });
      requiresFollowUp = testCase.needsFollowUp;

      const result = await runToolLoop(makeParams(makeContext(), provider));
      if (result.status !== testCase.expected) failures.push(`${testCase.label}: ${result.status}`);
    }
    expect(failures).toEqual([]);
  });

  it("an empty first stream is still reported as empty so the turn retries", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const { provider } = makeProvider([{ status: "empty_response" }]);

    const result = await runToolLoop(makeParams(makeContext(), provider));

    expect(result.status).toBe("empty_response");
  });

  it("sends a resolved sticker at invocation, after pre-tool text and before continuing text", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const events: string[] = [];
    const { provider, capturedHistories } = makeProvider([
      makeFunctionCallResult("select_sticker_for_response", { sticker_name: "Wave" }, "Oh hi!"),
      { status: "completed", accumulatedText: "Nice to see you." },
    ]);
    const originalStream = provider.streamToDiscord;
    provider.streamToDiscord = async (...args: Parameters<LLMProvider["streamToDiscord"]>) => {
      const result = await originalStream(...args);
      events.push(`text:${result.accumulatedText ?? ""}`);
      return result;
    };
    const sticker = { id: "sticker_1", name: "Wave", url: "https://cdn.example/s.png", available: true };
    toolExecuteQueue.push({
      success: true,
      data: { sticker_name: "Wave" },
      stickerSelection: { kind: "native", sticker: sticker as unknown as Sticker },
    });
    const context = makeStickerContext(events);

    const result = await runToolLoop(makeParams(context, provider));

    expect(events).toEqual(["text:Oh hi!", "send", "text:Nice to see you."]);
    expect(result.status).toBe("completed");
    expect(JSON.stringify(capturedHistories)).toContain("sticker_sent");
    expect(JSON.stringify(capturedHistories)).not.toContain("sticker_1");
  });

  it("treats a sticker-only reply as delivered output rather than an empty response", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const { provider } = makeProvider([
      makeFunctionCallResult("select_sticker_for_response", { sticker_name: "Wave" }),
      { status: "empty_response" },
    ]);
    const sticker = { id: "sticker_1", name: "Wave", url: "https://cdn.example/s.png", available: true };
    toolExecuteQueue.push({
      success: true,
      data: { sticker_name: "Wave" },
      stickerSelection: { kind: "native", sticker: sticker as unknown as Sticker },
    });

    const result = await runToolLoop(makeParams(makeStickerContext([]), provider));

    expect(result.status).toBe("completed");
    expect(result.toolResponseDelivered).toBe(true);
    expect(result.personaResponses).toEqual([]);
  });

  it("a stop raised after the tool resolved but before the send prevents the send", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const events: string[] = [];
    const { provider } = makeProvider([
      makeFunctionCallResult("select_sticker_for_response", { sticker_name: "Wave" }),
    ]);
    const sticker = { id: "sticker_1", name: "Wave", url: "https://cdn.example/s.png", available: true };
    toolExecuteQueue.push({
      success: true,
      data: { sticker_name: "Wave" },
      stickerSelection: { kind: "native", sticker: sticker as unknown as Sticker },
    });
    // The stop lands after the dispatcher's own pre- and post-execution checks, so only the
    // delivery's recheck immediately before the send can observe it.
    let stopChecks = 0;
    onStopCheck = () => {
      stopChecks += 1;
      if (stopChecks === 3) hasStopRequest = true;
    };

    const result = await runToolLoop(makeParams(makeStickerContext(events), provider));

    expect(stopChecks).toBeGreaterThanOrEqual(3);
    expect(result.status).toBe("stopped_by_user");
    expect(events).not.toContain("send");
  });

  it("NovelAI continues after pre-tool text when the successful tool requires follow-up", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    requiresFollowUp = true;
    const { provider, capturedHistories } = makeProvider(
      [
        makeFunctionCallResult("web_search", { query: "news" }, "Let me check."),
        { status: "completed", accumulatedText: "Here is what I found." },
      ],
      "novelai",
    );
    toolExecuteQueue.push({ success: true, data: { results: ["result"] } });

    const context = makeContext();
    context.streamingContext.suppressTextOutput = true;
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");
    expect(capturedHistories).toHaveLength(2);
    expect(result.personaResponses[0]?.text).toBe("Here is what I found.");
    expect(context.streamingContext.suppressTextOutput).toBe(false);
    expect(requiresFollowUpCalls).toEqual([{ name: "web_search", serverId: 1 }]);
  });

  it("NovelAI ends after pre-tool text when the successful tool does not require follow-up", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const { provider, capturedHistories } = makeProvider(
      [makeFunctionCallResult("non_follow_up_tool", {}, "That is done.")],
      "novelai",
    );
    toolExecuteQueue.push({ success: true, data: { ok: true } });

    const result = await runToolLoop(makeParams(makeContext(), provider));

    expect(result.status).toBe("completed");
    expect(capturedHistories).toHaveLength(1);
    expect(result.personaResponses[0]?.text).toBe("That is done.");
    expect(requiresFollowUpCalls).toEqual([{ name: "non_follow_up_tool", serverId: 1 }]);
  });

  it("NovelAI suppresses repeated text and retries a tool failure after pre-tool text", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const { provider, capturedHistories } = makeProvider(
      [
        makeFunctionCallResult("web_search", {}, "Let me try that."),
        { status: "completed", accumulatedText: "Recovered." },
      ],
      "novelai",
    );
    toolExecuteQueue.push({ success: false, error: "temporary failure" });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");
    expect(capturedHistories).toHaveLength(2);
    expect(context.streamingContext.suppressTextOutput).toBe(true);
    expect(standardEmbedCalls).toHaveLength(0);
  });

  it("NovelAI ends with the localized retry-exhausted embed at the configured threshold", async () => {
    const { runToolLoop, NAI_TOOL_FAILURE_RETRY_THRESHOLD } = await import("@/utils/chat/toolLoop");
    const { provider, capturedHistories } = makeProvider(
      Array.from({ length: 4 }, () => makeFunctionCallResult("web_search", {}, "Still trying.")),
      "novelai",
    );
    for (let i = 0; i < 4; i++) {
      toolExecuteQueue.push({ success: false, error: "always fails" });
    }

    const result = await runToolLoop(makeParams(makeContext(), provider));

    expect(result.status).toBe("completed");
    expect(capturedHistories).toHaveLength(NAI_TOOL_FAILURE_RETRY_THRESHOLD);
    expect(toolExecuteCalls).toHaveLength(NAI_TOOL_FAILURE_RETRY_THRESHOLD);
    expect(standardEmbedCalls).toContainEqual({
      titleKey: "genai.nai_tool_retry_exhausted_title",
      descriptionKey: "genai.nai_tool_retry_exhausted_description",
      color: "#E74C3C",
    });
  });

  it("successful STM update without pre-tool text disables further STM calls and continues", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const { provider, capturedHistories } = makeProvider([
      makeFunctionCallResult("update_short_term_memory", { content: "note" }),
      { status: "completed", accumulatedText: "Done." },
    ]);
    toolExecuteQueue.push({ success: true, data: { saved: true } });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(result.status).toBe("completed");
    expect(capturedHistories).toHaveLength(2);
    expect(context.streamingContext.disableShortTermMemoryUpdate).toBe(true);
  });

  it("clears a stale follow-up interrupt and lets the tool chain continue", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    hasStopRequest = true;
    isFollowUpRequest = true;
    const { provider, capturedHistories } = makeProvider([
      makeFunctionCallResult("echo_tool"),
      { status: "completed", accumulatedText: "Done." },
    ]);
    toolExecuteQueue.push({ success: true, data: { ok: true } });

    const result = await runToolLoop(makeParams(makeContext(), provider));

    expect(result.status).toBe("completed");
    expect(toolExecuteCalls).toHaveLength(1);
    expect(capturedHistories).toHaveLength(2);
    expect(clearStopRequestCalls).toBe(1);
  });

  it("a plain stop request still aborts before tool execution", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    hasStopRequest = true;
    isFollowUpRequest = false;
    const { provider } = makeProvider([makeFunctionCallResult("echo_tool")]);

    const result = await runToolLoop(makeParams(makeContext(), provider));

    expect(result.status).toBe("stopped_by_user");
    expect(toolExecuteCalls).toHaveLength(0);
    // The abort consumes the request: the stream's own stop check never ran on this path, and a
    // request left behind would abort the channel's next turn at its pre-stream check.
    expect(clearStopRequestCalls).toBe(1);
    expect(hasStopRequest).toBe(false);
  });

  it("does not dispatch a tool whose arguments the provider truncated", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    // A tool whose arguments replace stored state would write only the recovered keys and
    // silently drop the rest, so the call is refused outright.
    const truncatedCall: StreamResult = {
      status: "function_call",
      data: { name: "update_short_term_memory", args: { scene_state: "bedroom" }, argumentsTruncated: true },
    };
    const { provider, capturedHistories } = makeProvider([
      truncatedCall,
      { status: "completed", accumulatedText: "retried" },
    ]);
    toolExecuteQueue.push({ success: true, data: { saved: true } });

    const context = makeContext();
    const result = await runToolLoop(makeParams(context, provider));

    expect(toolExecuteCalls).toHaveLength(0);
    expect(result.status).toBe("completed");

    const history = capturedHistories[1] as Array<{
      functionCall: { name: string; args?: Record<string, unknown> };
      functionResponse: {
        functionResponse: { response: { result: { status: string; tool_name: string; reason: string } } };
      };
    }>;
    expect(history).toHaveLength(1);
    expect(history[0]?.functionCall?.name).toBe("update_short_term_memory");
    // The recovered subset is dropped, so the model is not shown a call it did not make.
    expect(history[0]?.functionCall?.args).toBeUndefined();
    const synthetic = history[0]?.functionResponse?.functionResponse?.response?.result;
    expect(synthetic?.status).toBe("tool_execution_failed");
    expect(synthetic?.tool_name).toBe("update_short_term_memory");
    expect(synthetic?.reason).toContain("truncated");

    // The ordinary failure path emits a thought-log notice, so the refusal has to as well or
    // the truncation leaves no trace a user can see.
    expect(hiddenToolNotices).toHaveLength(1);
    expect(hiddenToolNotices[0]).toContain("truncated");
  });

  it("refuses a truncated call before the deliberate-mode allowlist can report it", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    // Both gates would fire here. The refusal runs first, so the model is told the payload was
    // cut short rather than that deliberate mode hid the tool, which is the actionable cause.
    const truncatedCall: StreamResult = {
      status: "function_call",
      data: { name: "hidden_tool", args: {}, argumentsTruncated: true },
    };
    const { provider, capturedHistories } = makeProvider([
      truncatedCall,
      { status: "completed", accumulatedText: "retried" },
    ]);

    const context = makeContext();
    context.deliberateToolModeActive = true;
    context.streamingContext.deliberateToolAllowedNames = ["allowed_tool"];
    await runToolLoop(makeParams(context, provider));

    const history = capturedHistories[1] as Array<{
      functionResponse: { functionResponse: { response: { result: { reason: string } } } };
    }>;
    const reason = history[0]?.functionResponse?.functionResponse?.response?.result?.reason ?? "";
    expect(reason).toContain("truncated");
    expect(reason).not.toContain("not exposed");
  });

  it("counts a refused truncated call toward the consecutive tool error cap", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");

    // A model that keeps reissuing a truncated call must not loop forever.
    const truncatedCall: StreamResult = {
      status: "function_call",
      data: { name: "update_short_term_memory", args: {}, argumentsTruncated: true },
    };
    const { provider } = makeProvider(Array.from({ length: 10 }, () => truncatedCall));

    const result = await runToolLoop(makeParams(makeContext(), provider));

    expect(result.status).toBe("error");
    expect(toolExecuteCalls).toHaveLength(0);
  });

  it("retains reported author usage when a held stream settles after cancellation", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const context = makeReviewContext();
    const { provider } = makeProvider([]);
    const review = mock(async () => ({ success: true, data: { status: "pass" } }));
    Object.assign(provider, {
      callStructuredJSON: review,
      streamToDiscord: () =>
        new Promise<StreamResult>((resolve) => {
          context.streamingContext.abortSignal?.addEventListener(
            "abort",
            () => {
              setTimeout(() => resolve({ status: "stopped_by_user", usage: { inputTokens: 25, outputTokens: 3 } }), 0);
            },
            { once: true },
          );
          queueMicrotask(() => {
            hasStopRequest = true;
            activeStreamKill?.(new Error("Fixture cancellation"));
          });
        }),
    });
    const result = await runToolLoop(makeParams(context, provider));
    expect(result.status).toBe("stopped_by_user");
    expect(result.personaResponses).toEqual([]);
    expect(result.usageEntries).toEqual([
      { kind: "author", model: "test-model", usage: { inputTokens: 25, outputTokens: 3 } },
    ]);
    expect(review).not.toHaveBeenCalled();
  });

  it("keeps Off on the ordinary path without an auxiliary request", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const context = makeContext();
    const { provider } = makeProvider([{ status: "completed", accumulatedText: "A quiet reply." }]);
    const review = mock(async () => ({ success: true, data: { status: "pass" } }));
    Object.assign(provider, { callStructuredJSON: review });
    const result = await runToolLoop(makeParams(context, provider));
    expect(review).not.toHaveBeenCalled();
    expect(result.personaResponses[0]?.text).toBe("A quiet reply.");
    expect(result.usageEntries).toBeUndefined();
  });

  it("reviews a quiet short reply once, passes without another author request and delivers once", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const context = makeReviewContext();
    const delivered: string[] = [];
    const { provider, capturedHistories } = makeProvider([held("*nods*", delivered)]);
    const calls: ProviderStructuredJsonRequest[] = [];
    Object.assign(provider, {
      callStructuredJSON: async (request: ProviderStructuredJsonRequest) => {
        calls.push(request);
        request.onUsage?.({ inputTokens: 20, outputTokens: 2 });
        return { success: true, data: { status: "pass" } };
      },
    });
    const result = await runToolLoop(makeParams(context, provider));
    expect(calls).toHaveLength(1);
    expect(capturedHistories).toHaveLength(1);
    expect(delivered).toEqual(["*nods*"]);
    expect(result.personaResponses[0]?.text).toBe("*nods*");
    expect(result.usageEntries?.map((entry) => entry.kind)).toEqual(["author", "reviewer"]);
    expect(calls[0]?.apiKey).toBe(makeProviderConfig().apiKey);
    const packet = JSON.parse(calls[0]?.userPrompt ?? "{}");
    expect(packet.candidate.status).toBe("pending");
    expect(packet.trigger.sender.name).toBe("Juno");
    expect(packet.representativeDialogues.length).toBeGreaterThan(0);
  });

  it("revises the whole held response once while preserving successful tools and their outcomes", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const context = makeReviewContext();
    const delivered: string[] = [];
    const preTool = held("I will check.", delivered, "function_call");
    preTool.data = { name: "lookup", args: { query: "scene fact" } };
    toolExecuteQueue.push({ success: true, data: { fact: "The door is closed." } });
    const { provider, capturedHistories } = makeProvider([
      preTool,
      held("Generic assistant answer.", delivered),
      held("*rests against the closed door* I stay.", delivered),
    ]);
    const requests: ProviderStructuredJsonRequest[] = [];
    Object.assign(provider, {
      callStructuredJSON: async (request: ProviderStructuredJsonRequest) => {
        requests.push(request);
        return {
          success: true,
          data:
            request.schemaName === "response_review" &&
            requests.filter((entry) => entry.schemaName === "response_review").length === 1
              ? {
                  status: "revise",
                  findings: [
                    {
                      category: "voice",
                      problem: "The voice is detached.",
                      direction: "Use the character's terse voice and the closed door.",
                    },
                  ],
                }
              : { status: "pass" },
        };
      },
    });
    const result = await runToolLoop(makeParams(context, provider));
    expect(toolExecuteCalls).toHaveLength(1);
    expect(requests).toHaveLength(3);
    expect(JSON.parse(requests[1]?.userPrompt ?? "{}").candidate.text).toContain("I will check.");
    expect(JSON.parse(requests[2]?.userPrompt ?? "{}").tools[0].outcome).toEqual(
      context.responseReview?.functionHistory[0]?.functionResponse,
    );
    expect(capturedHistories[2]).toHaveLength(1);
    expect(delivered).toEqual(["*rests against the closed door* I stay."]);
    expect(result.personaResponses[0]?.text).not.toContain("Generic");
    expect(context.responseReview?.revisions).toBe(1);
    expect(result.usageEntries?.filter((entry) => entry.kind === "author")).toHaveLength(3);
  });

  it("carries the held-prose ceiling across tool passes", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const { MAX_PENDING_RESPONSE_BYTES, MAX_PENDING_RESPONSE_SEGMENTS } = await import(
      "@/utils/discord/stream/constants"
    );
    const context = makeReviewContext();
    const delivered: string[] = [];
    const narration = held("I will check the shelf.", delivered, "function_call");
    narration.data = { name: "lookup", args: {} };
    const { provider } = makeProvider([narration, held("It is here.", delivered)]);
    const limits: unknown[] = [];
    const streamToDiscord = provider.streamToDiscord.bind(provider);
    provider.streamToDiscord = (...args: Parameters<LLMProvider["streamToDiscord"]>) => {
      limits.push({ ...context.streamingContext.pendingResponseLimit });
      return streamToDiscord(...args);
    };
    Object.assign(provider, { callStructuredJSON: async () => ({ success: true, data: { status: "pass" } }) });
    await runToolLoop(makeParams(context, provider));
    const narrationBytes = Buffer.byteLength("I will check the shelf.", "utf8");
    expect(limits).toEqual([
      { maxBytes: MAX_PENDING_RESPONSE_BYTES, maxSegments: MAX_PENDING_RESPONSE_SEGMENTS },
      { maxBytes: MAX_PENDING_RESPONSE_BYTES - narrationBytes, maxSegments: MAX_PENDING_RESPONSE_SEGMENTS - 1 },
    ]);
    expect(delivered).toEqual(["I will check the shelf.", "It is here."]);
  });

  it("reviews a reply cut at the held ceiling as cut, then delivers it with usage and the length notice", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const context = makeReviewContext();
    context.shouldSurfaceUserErrors = true;
    const delivered: string[] = [];
    const cut = held("Mirri keeps talking", delivered);
    cut.usage = undefined;
    cut.stopReason = "pending_response_limit";
    cut.pendingResponse.truncation = "retention_limit";
    const { provider } = makeProvider([cut]);
    const requests: ProviderStructuredJsonRequest[] = [];
    Object.assign(provider, {
      callStructuredJSON: async (request: ProviderStructuredJsonRequest) => {
        requests.push(request);
        expect(delivered).toEqual([]);
        return { success: true, data: { status: "pass" } };
      },
    });
    const result = await runToolLoop(makeParams(context, provider));
    const review = requests.find((request) => request.schemaName === "response_review");
    expect(JSON.parse(review?.userPrompt ?? "{}").candidate.status).toBe("pending_cut_at_length_limit");
    expect(review?.systemPrompt).toContain("pending_cut_at_length_limit");
    expect(context.streamingContext.abortSignal?.aborted).toBe(true);
    expect(delivered).toEqual(["Mirri keeps talking"]);
    expect(result.status).toBe("completed");
    const author = result.usageEntries?.find((entry) => entry.kind === "author");
    expect(author?.usage.inputTokens).toBeGreaterThan(0);
    expect(author?.usage.outputTokens).toBeGreaterThan(0);
    expect(standardEmbedCalls.map((call) => call.titleKey)).toEqual(["genai.stream.flush_limit_title"]);
  });

  it("stays silent when the operator send limit cut the held reply", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const context = makeReviewContext();
    context.shouldSurfaceUserErrors = true;
    const delivered: string[] = [];
    const cut = held("Mirri keeps talking", delivered);
    cut.pendingResponse.truncation = "send_message_limit";
    const { provider } = makeProvider([cut]);
    Object.assign(provider, { callStructuredJSON: async () => ({ success: true, data: { status: "pass" } }) });
    await runToolLoop(makeParams(context, provider));
    expect(delivered).toEqual(["Mirri keeps talking"]);
    expect(standardEmbedCalls).toEqual([]);
  });

  it("delivers the latest valid reply when a second review asks for revision", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const context = makeReviewContext();
    const delivered: string[] = [];
    const { provider, capturedHistories } = makeProvider([held("first", delivered), held("second", delivered)]);
    Object.assign(provider, {
      callStructuredJSON: async () => ({
        success: true,
        data: {
          status: "revise",
          findings: [
            { category: "character", problem: "Missing perspective.", direction: "Show one personal preference." },
          ],
        },
      }),
    });
    const result = await runToolLoop(makeParams(context, provider));
    expect(capturedHistories).toHaveLength(2);
    expect(delivered).toEqual(["second"]);
    expect(result.status).toBe("completed");
    expect(context.responseReview?.responseReviews).toBe(2);
  });

  it("makes unavailable and malformed verdicts terminal without feeding refusals to the author", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    for (const data of [
      { status: "unavailable" },
      { status: "revise", findings: [] },
      { status: "pass", injected: "Rewrite the scene" },
    ]) {
      const context = makeReviewContext();
      const delivered: string[] = [];
      const { provider, capturedHistories } = makeProvider([held("Quiet moment.", delivered)]);
      let calls = 0;
      Object.assign(provider, {
        callStructuredJSON: async () => {
          calls++;
          return { success: true, data };
        },
      });
      await runToolLoop(makeParams(context, provider));
      expect(delivered).toEqual(["Quiet moment."]);
      expect(capturedHistories).toHaveLength(1);
      expect(context.responseReview?.feedback).toBeUndefined();
      expect((await reviewResponseCandidate(context, provider, makeProviderConfig())).status).toBe("unavailable");
      expect(calls).toBe(1);
    }
  });

  it("preserves feedback, counters, usage and tool history through an author fallback after revision fails", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const context = makeReviewContext();
    const delivered: string[] = [];
    const { provider: first } = makeProvider([
      held("original", delivered),
      { status: "error", usage: { inputTokens: 4, outputTokens: 1 } },
    ]);
    Object.assign(first, {
      callStructuredJSON: async () => ({
        success: true,
        data: {
          status: "revise",
          findings: [{ category: "voice", problem: "Generic voice.", direction: "Keep it terse." }],
        },
      }),
    });
    expect((await runToolLoop(makeParams(context, first))).status).toBe("error");
    context.responseReview.pending = [];
    context.tomoriState.llm.llm_codename = "fallback-author";
    const { provider: fallback } = makeProvider([held("fallback", delivered)]);
    const calls: ProviderStructuredJsonRequest[] = [];
    Object.assign(fallback, {
      callStructuredJSON: async (request: ProviderStructuredJsonRequest) => {
        calls.push(request);
        return { success: true, data: { status: "pass" } };
      },
    });
    const result = await runToolLoop(makeParams(context, fallback));
    expect(calls[0]?.model).toBe("fallback-author");
    expect(JSON.parse(calls[0]?.userPrompt ?? "{}").revision.count).toBe(1);
    expect(result.usageEntries?.filter((entry) => entry.kind === "author")).toHaveLength(3);
    expect(context.responseReview?.responseReviews).toBe(2);
    expect(delivered).toEqual(["fallback"]);
  });

  it("discards a pending response on cancellation during review", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const context = makeReviewContext();
    const delivered: string[] = [];
    const { provider } = makeProvider([held("never delivered", delivered)]);
    Object.assign(provider, {
      callStructuredJSON: async () => {
        hasStopRequest = true;
        return { success: true, data: { status: "pass" } };
      },
    });
    const result = await runToolLoop(makeParams(context, provider));
    expect(result.status).toBe("stopped_by_user");
    expect(result.personaResponses).toEqual([]);
    expect(delivered).toEqual([]);
  });

  it("requires persona, trigger and full candidate evidence and bounds optional history", () => {
    const context = makeReviewContext();
    context.contextItems.push(
      ...Array.from(
        { length: 50 },
        (_, index): StructuredContextItem => ({
          role: "model",
          metadataTag: ContextItemTag.DIALOGUE_HISTORY,
          messageId: `history_${index}`,
          parts: [{ type: "text", text: "A long historical reply. ".repeat(10) }],
        }),
      ),
    );
    const packet = buildReviewerPacket(context, "pending", 3000);
    expect(packet?.candidate.text).toBe("pending");
    expect(packet?.coverage.historyIncluded).toBeLessThan(50);
    expect(packet?.coverage.historyIncluded).toBeGreaterThan(0);
    expect(buildReviewerPacket(context, "x".repeat(5000), 3000)).toBeNull();
    context.contextItems = [];
    expect(buildReviewerPacket(context, "pending", 3000)).toBeNull();
    expect(draftReviewResultSchema.safeParse({ status: "revise", findings: [] }).success).toBe(false);
  });

  it("pins only an owned reviewer and uses its saved credentials independently of the author", async () => {
    const context = makeReviewContext();
    context.responseReview.reviewerId = 88;
    context.responseReview.pending = [held("quiet", []).pendingResponse];
    const reviewer = createLlmRow({
      llm_id: 88,
      llm_provider: "openrouter",
      llm_codename: "review-model",
      context_window: 64000,
      supports_structoutput: true,
    });
    const saved = savedProviderConfigSchema.parse({
      server_id: context.currentPersona.server_id,
      provider: "openrouter",
      api_key: Buffer.from("owned-encrypted"),
      llm_id: 88,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
      llm_disabled_params: [],
      llm_logit_biases: [],
      fallback_model_refs: [],
    });
    const modelSpy = spyOn(llmModelRepo, "loadById").mockResolvedValue(reviewer);
    const availableSpy = spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockResolvedValue([reviewer]);
    const savedSpy = spyOn(llmProviderRepo, "loadSavedProviderConfig").mockResolvedValue(saved);
    const decryptSpy = spyOn(crypto, "decryptApiKey").mockResolvedValue("owned-review-key");
    const { provider } = makeProvider([]);
    const calls: ProviderStructuredJsonRequest[] = [];
    Object.assign(provider, {
      callStructuredJSON: async (request: ProviderStructuredJsonRequest) => {
        calls.push(request);
        return { success: true, data: { status: "pass" } };
      },
    });
    const capabilitySpy = spyOn(capabilityResolver, "resolveStructuredOutputCapability").mockResolvedValue(
      provider as Awaited<ReturnType<typeof capabilityResolver.resolveStructuredOutputCapability>>,
    );
    try {
      expect((await reviewResponseCandidate(context, makeProvider([]).provider, makeProviderConfig())).status).toBe(
        "pass",
      );
      expect(calls[0]?.apiKey).toBe("owned-review-key");
      expect(calls[0]?.model).toBe("review-model");
      expect(availableSpy.mock.calls[0]?.[2]).toEqual({ kind: "server", ownerId: context.currentPersona.server_id });
      availableSpy.mockResolvedValue([]);
      const inaccessible = makeReviewContext();
      inaccessible.responseReview.reviewerId = 88;
      inaccessible.responseReview.pending = [held("quiet", []).pendingResponse];
      expect((await reviewResponseCandidate(inaccessible, provider, makeProviderConfig())).status).toBe("unavailable");
      expect(calls).toHaveLength(1);
    } finally {
      modelSpy.mockRestore();
      availableSpy.mockRestore();
      savedSpy.mockRestore();
      decryptSpy.mockRestore();
      capabilitySpy.mockRestore();
    }
  });

  it("logs operational reviewer failures once with safe metadata and treats refusal as an ordinary outcome", async () => {
    const errorSpy = spyOn(log, "error").mockImplementation(async () => {});
    const infoSpy = spyOn(log, "info").mockImplementation(() => {});
    errorSpy.mockClear();
    infoSpy.mockClear();
    try {
      const context = makeReviewContext();
      const { provider } = makeProvider([]);
      context.responseReview.pending = [held("PRIVATE_DRAFT", []).pendingResponse];
      Object.assign(provider, {
        callStructuredJSON: async () => {
          throw new Error("PRIVATE_DRAFT PRIVATE_EVIDENCE PRIVATE_KEY https://example.invalid?token=secret");
        },
      });
      expect((await reviewResponseCandidate(context, provider, makeProviderConfig())).status).toBe("unavailable");
      await reviewResponseCandidate(context, provider, makeProviderConfig());
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("PRIVATE_");
      expect(JSON.stringify(infoSpy.mock.calls)).not.toContain("PRIVATE_");
      errorSpy.mockClear();
      const refusal = makeReviewContext();
      refusal.responseReview.pending = [held("PRIVATE_DRAFT", []).pendingResponse];
      Object.assign(provider, {
        callStructuredJSON: async () => ({ success: false, error: "PRIVATE_REFUSAL", failure: "refusal" }),
      });
      expect((await reviewResponseCandidate(refusal, provider, makeProviderConfig())).status).toBe("unavailable");
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockImplementation(async () => {});
      infoSpy.mockImplementation(() => {});
    }
  });

  it("reports pinned reviewer decryption failure once without raw error or credential content", async () => {
    const context = makeReviewContext();
    context.responseReview.reviewerId = 88;
    context.responseReview.pending = [held("PRIVATE_DRAFT", []).pendingResponse];
    const reviewer = createLlmRow({ llm_id: 88, supports_structoutput: true });
    const saved = savedProviderConfigSchema.parse({
      server_id: context.currentPersona.server_id,
      provider: reviewer.llm_provider,
      api_key: Buffer.from("PRIVATE_KEY"),
      key_version: 2147483647,
      llm_id: 88,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
      llm_disabled_params: [],
      llm_logit_biases: [],
      fallback_model_refs: [],
    });
    const model = spyOn(llmModelRepo, "loadById").mockResolvedValue(reviewer);
    const available = spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockResolvedValue([reviewer]);
    const registration = spyOn(llmProviderRepo, "loadSavedProviderConfig").mockResolvedValue(saved);
    const { provider } = makeProvider([]);
    const structured = mock(async () => ({ success: true, data: { status: "pass" } }));
    Object.assign(provider, { callStructuredJSON: structured });
    const capability = spyOn(capabilityResolver, "resolveStructuredOutputCapability").mockResolvedValue(
      provider as Awaited<ReturnType<typeof capabilityResolver.resolveStructuredOutputCapability>>,
    );
    const errors = spyOn(log, "error").mockImplementation(async () => {});
    errors.mockClear();
    try {
      expect((await reviewResponseCandidate(context, provider, makeProviderConfig())).status).toBe("unavailable");
      expect(errors).toHaveBeenCalledTimes(1);
      expect(errors.mock.calls[0]?.[2]).toMatchObject({ metadata: { category: "credentials", reviewerId: 88 } });
      const records = JSON.stringify(
        errors.mock.calls.map(([message, cause, metadata]) => ({
          message,
          cause: cause instanceof Error ? { message: cause.message, stack: cause.stack } : cause,
          metadata,
        })),
      );
      expect(records).not.toContain("PRIVATE_");
      expect(structured).not.toHaveBeenCalled();
    } finally {
      for (const spy of [model, available, registration, capability]) spy.mockRestore();
      errors.mockImplementation(async () => {});
    }
  });

  it("bounds a silent reviewer timeout without triggering an author rewrite or another review", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const actualTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeoutSpy = spyOn(AbortSignal, "timeout").mockImplementation(() => actualTimeout(5));
    try {
      const context = makeReviewContext();
      const delivered: string[] = [];
      const { provider, capturedHistories } = makeProvider([held("latest valid", delivered)]);
      let calls = 0;
      Object.assign(provider, {
        callStructuredJSON: () => {
          calls++;
          return new Promise(() => {});
        },
      });
      const result = await runToolLoop(makeParams(context, provider));
      expect(result.status).toBe("completed");
      expect(capturedHistories).toHaveLength(1);
      expect(calls).toBe(1);
      expect(delivered).toEqual(["latest valid"]);
      expect(context.responseReview?.unavailable).toBe(true);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("aborts reviewer transport promptly on a follow-up interruption", async () => {
    const context = makeReviewContext();
    context.responseReview.pending = [held("pending", []).pendingResponse];
    const { provider } = makeProvider([]);
    let signal: AbortSignal | undefined;
    Object.assign(provider, {
      callStructuredJSON: (request: ProviderStructuredJsonRequest) => {
        signal = request.abortSignal;
        requestFollowUp(context.channel.id, "fixture_user");
        return new Promise(() => {});
      },
    });
    try {
      expect((await reviewResponseCandidate(context, provider, makeProviderConfig())).status).toBe("cancelled");
      expect(signal?.aborted).toBe(true);
      expect(context.responseReview?.unavailable).toBe(false);
    } finally {
      deleteStopRequest(context.channel.id);
    }
  });

  it("reuses verdicts only for identical evidence and candidate, and excludes optional protocol instructions", async () => {
    const context = makeReviewContext();
    context.responseReview.pending = [held("pending", []).pendingResponse];
    const { provider } = makeProvider([]);
    let calls = 0;
    Object.assign(provider, {
      callStructuredJSON: async () => {
        calls++;
        return { success: true, data: { status: "pass" } };
      },
    });
    await reviewResponseCandidate(context, provider, makeProviderConfig());
    await reviewResponseCandidate(context, provider, makeProviderConfig());
    expect(calls).toBe(1);
    context.responseReview.functionHistory.push({
      functionCall: { name: "lookup", args: { api_key: "PRIVATE_KEY" } },
      functionResponse: { fact: "new outcome" },
    });
    await reviewResponseCandidate(context, provider, makeProviderConfig());
    expect(calls).toBe(2);
    const packet = buildReviewerPacket(context, "pending", 64000);
    expect(JSON.stringify(packet?.tools)).not.toContain("PRIVATE_KEY");
    expect(packet?.candidate.text).toBe("pending");
    expect(buildReviewerPacket(context, `sk-proj-${"a".repeat(30)}`, 64000)).toBeNull();
  });

  it("routes checker hits/failures directly to review and keeps diagnostics out of author continuation and accepted dialogue", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const evidence = ruleChecks.validateRuleAnalysis(
      {
        score: 50,
        band: "moderate",
        word_count: 12,
        violations: [
          {
            type: "Violation",
            rule: "tone",
            match: "PRIVATE_RULE_SNIPPET",
            context: "PRIVATE_RULE_CONTEXT",
            penalty: 4,
            start: 0,
            end: 4,
          },
        ],
        counts: { tone: 1 },
        total_penalty: 4,
        weighted_sum: 4,
        density: 1,
        advice: ["PRIVATE_RULE_ADVICE"],
      },
      "A sufficiently long fictional reply with a quiet gesture by the door.",
    );
    const rules = spyOn(ruleChecks, "checkResponseRules");
    const decisions = spyOn(decisionRouting, "routeResponseDecision").mockResolvedValue("review");
    try {
      for (const status of ["hits", "failed"] as const) {
        rules.mockResolvedValue(status === "hits" ? { status, evidence } : { status });
        const context = makeReviewContext();
        const delivered: string[] = [];
        const { provider, capturedHistories, capturedContexts } = makeProvider([
          held("first pending reply", delivered),
          held("chosen reply", delivered),
        ]);
        const packets: Array<Record<string, unknown>> = [];
        Object.assign(provider, {
          callStructuredJSON: async (request: ProviderStructuredJsonRequest) => {
            packets.push(JSON.parse(request.userPrompt));
            return {
              success: true,
              data:
                packets.length === 1
                  ? {
                      status: "revise",
                      findings: [
                        {
                          category: "voice",
                          problem: "The reply contradicts the quiet persona.",
                          direction: "Keep her voice quiet.",
                        },
                      ],
                    }
                  : { status: "pass" },
            };
          },
        });
        const result = await runToolLoop(makeParams(context, provider));
        expect(packets).toHaveLength(2);
        expect(Boolean(packets[0].ruleEvidence)).toBe(status === "hits");
        expect(result.status).toBe("completed");
        expect(delivered).toEqual(["chosen reply"]);
        expect(JSON.stringify(capturedHistories)).not.toContain("PRIVATE_RULE_");
        expect(JSON.stringify(capturedContexts)).not.toContain("PRIVATE_RULE_");
        expect(JSON.stringify(result.personaResponses)).not.toContain("PRIVATE_RULE_");
        expect(JSON.stringify(context.responseReview.functionHistory)).not.toContain("PRIVATE_RULE_");
      }
      expect(decisions).not.toHaveBeenCalled();
    } finally {
      rules.mockRestore();
      decisions.mockRestore();
    }
  });

  it("clean/short/disabled rules cannot approve prose and tool review never checks arbitrary argument JSON", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const rules = spyOn(ruleChecks, "checkResponseRules");
    const decisions = spyOn(decisionRouting, "routeResponseDecision").mockResolvedValue("review");
    try {
      for (const status of ["clean", "short_text", "disabled"] as const) {
        const text =
          status === "clean" ? "A quiet character waits by the door while the rain falls outside." : "Stay here.";
        const evidence = ruleChecks.validateRuleAnalysis(
          {
            score: 100,
            band: "clean",
            word_count: status === "clean" ? 13 : 2,
            violations: [],
            counts: {},
            total_penalty: 0,
            weighted_sum: 0,
            density: 0,
            advice: [],
          },
          text,
        );
        rules.mockResolvedValue(status === "disabled" ? { status } : { status, evidence });
        const context = makeReviewContext();
        context.responseReview.pending = [held(text, []).pendingResponse];
        const { provider } = makeProvider([]);
        let reviews = 0;
        Object.assign(provider, {
          callStructuredJSON: async () => {
            reviews++;
            return { success: true, data: { status: "pass" } };
          },
        });
        expect((await reviewResponseCandidate(context, provider, makeProviderConfig())).status).toBe("pass");
        expect(reviews).toBe(1);
      }
      rules.mockClear();
      const context = makeReviewContext();
      const first = held("", [], "function_call");
      first.data = { name: "mirror_action", args: { text: "PRIVATE_ARGUMENT_JSON" } };
      const { provider } = makeProvider([first, held("", [])]);
      Object.assign(provider, { callStructuredJSON: async () => ({ success: true, data: { status: "pass" } }) });
      await runToolLoop(makeParams(context, provider));
      expect(rules).not.toHaveBeenCalled();
      expect(decisions.mock.calls.some(([, , packet]) => packet.kind === "tool_call")).toBe(true);
    } finally {
      rules.mockRestore();
      decisions.mockRestore();
    }
  });
  const rejection = {
    status: "revise" as const,
    findings: [
      { category: "tool_use" as const, problem: "The target is invented.", direction: "Use the admitted target." },
    ],
  };

  for (const name of ["create_long_term_memory", "mirror_action"]) {
    it(`${name}: approves the exact snapshot once and preserves pending narration until text review`, async () => {
      const { runToolLoop } = await import("@/utils/chat/toolLoop");
      const context = makeReviewContext();
      const delivered: string[] = [];
      const args = { target: "fixture", text: "Quiet fictional note", nested: { count: 2 } };
      const first = held("I will leave a note.", delivered, "function_call");
      first.data = { name, args };
      const { provider } = makeProvider([first, held("Done.", delivered)]);
      const packets: Record<string, unknown>[] = [];
      Object.assign(provider, {
        callStructuredJSON: async (request: ProviderStructuredJsonRequest) => {
          packets.push(JSON.parse(request.userPrompt));
          expect(delivered).toEqual([]);
          if (request.schemaName === "tool_review") {
            expect(toolExecuteCalls).toEqual([]);
            args.text = "Mutation of original provider object";
          }
          request.onUsage?.({ inputTokens: 7, outputTokens: 2 });
          return { success: true, data: { status: "pass" } };
        },
      });
      const result = await runToolLoop(makeParams(context, provider));
      expect(toolExecuteCalls).toEqual([
        { name, args: { target: "fixture", text: "Quiet fictional note", nested: { count: 2 } } },
      ]);
      expect(packets[0]?.proposedCall).toMatchObject({
        status: "not_executed",
        name,
        arguments: toolExecuteCalls[0]?.args,
      });
      expect(packets[1]?.candidate).toEqual({ status: "pending", text: "I will leave a note.\nDone." });
      expect(delivered).toEqual(["I will leave a note.", "Done."]);
      expect(result.usageEntries?.filter((entry) => entry.kind === "reviewer")).toHaveLength(2);
      expect(context.responseReview.toolReviews).toBe(1);
      expect(context.responseReview.responseReviews).toBe(1);
    });

    it(`${name}: pairs rejection, blocks identical retries and executes only the passed correction`, async () => {
      const { runToolLoop } = await import("@/utils/chat/toolLoop");
      const context = makeReviewContext();
      const { provider, capturedHistories } = makeProvider([
        makeFunctionCallResult(name, { target: "invented", text: "note" }),
        makeFunctionCallResult(name, { text: "note", target: "invented" }),
        makeFunctionCallResult(name, { target: "fixture", text: "note" }),
        { status: "completed" },
      ]);
      toolExecuteQueue.push({ success: true, data: { written: true } });
      const review = mock(async () => ({
        success: true,
        data: review.mock.calls.length === 1 ? rejection : { status: "pass" },
      }));
      Object.assign(provider, { callStructuredJSON: review });
      const result = await runToolLoop(makeParams(context, provider));
      expect(result.status).toBe("completed");
      expect(result.personaResponses).toEqual([]);
      expect(toolExecuteCalls).toEqual([{ name, args: { target: "fixture", text: "note" } }]);
      expect(review).toHaveBeenCalledTimes(2);
      const rejectedHistory = capturedHistories[2] as ResponseReviewState["functionHistory"];
      for (const entry of rejectedHistory) {
        expect(entry.functionResponse).toMatchObject({
          functionResponse: {
            name: entry.functionCall.name,
            response: { result: { status: "review_rejected", actionExecuted: false } },
          },
        });
      }
      expect(context.responseReview.toolCorrections).toBe(1);
      expect(context.responseReview.revisions).toBe(0);
      expect(hiddenToolNotices).toEqual([]);
    });

    it(`${name}: bounds changed corrections and identical rejections without counting tool failures`, async () => {
      const { runToolLoop } = await import("@/utils/chat/toolLoop");
      const context = makeReviewContext();
      const { provider } = makeProvider([
        ...Array.from({ length: 7 }, (_, index) => makeFunctionCallResult(name, { target: `invented_${index}` })),
        { status: "completed" },
      ]);
      const review = mock(async () => ({ success: true, data: rejection }));
      Object.assign(provider, { callStructuredJSON: review });
      expect((await runToolLoop(makeParams(context, provider))).status).toBe("completed");
      expect(toolExecuteCalls).toEqual([]);
      expect(review).toHaveBeenCalledTimes(2);
      expect(context.responseReview.toolCorrections).toBe(1);
      expect(
        context.responseReview.functionHistory.every((entry) =>
          JSON.stringify(entry.functionResponse).includes("review_rejected"),
        ),
      ).toBe(true);
      expect(standardEmbedCalls).toEqual([]);
    });

    it(`${name}: unavailable permits independent requests but cannot approve a rejected correction`, async () => {
      const { runToolLoop } = await import("@/utils/chat/toolLoop");
      const context = makeReviewContext();
      const { provider } = makeProvider([
        makeFunctionCallResult(name, { target: "invented" }),
        makeFunctionCallResult(name, { target: "fixture" }),
        makeFunctionCallResult(name, { target: "invented" }),
        makeFunctionCallResult("other_action", { target: "fixture" }),
        { status: "completed" },
      ]);
      const review = mock(async () => ({
        success: true,
        data: review.mock.calls.length === 1 ? rejection : { status: "unavailable" },
      }));
      Object.assign(provider, { callStructuredJSON: review });
      await runToolLoop(makeParams(context, provider));
      expect(toolExecuteCalls).toEqual([{ name: "other_action", args: { target: "fixture" } }]);
      expect(context.responseReview.unavailable).toBe(true);
      expect(review).toHaveBeenCalledTimes(2);
      expect(
        context.responseReview.functionHistory
          .slice(0, 3)
          .every((entry) => JSON.stringify(entry.functionResponse).includes("review_rejected")),
      ).toBe(true);
    });

    it(`${name}: exhaustion permits a new request while retaining prior rejection across author fallback`, async () => {
      const { runToolLoop } = await import("@/utils/chat/toolLoop");
      const context = makeReviewContext();
      const { provider: first } = makeProvider([
        makeFunctionCallResult(name, { target: "invented" }),
        { status: "error" },
      ]);
      Object.assign(first, { callStructuredJSON: async () => ({ success: true, data: rejection }) });
      expect((await runToolLoop(makeParams(context, first))).status).toBe("error");
      context.responseReview.toolReviews = MAX_TOOL_REVIEWS;
      const { provider: fallback } = makeProvider([
        makeFunctionCallResult(name, { target: "invented" }),
        makeFunctionCallResult(name, { target: "fixture" }),
        makeFunctionCallResult("other_action", { target: "fixture" }),
        { status: "completed" },
      ]);
      const review = mock(async () => ({ success: true, data: { status: "pass" } }));
      Object.assign(fallback, { callStructuredJSON: review });
      await runToolLoop(makeParams(context, fallback));
      expect(toolExecuteCalls).toEqual([{ name: "other_action", args: { target: "fixture" } }]);
      expect(review).not.toHaveBeenCalled();
      expect(context.responseReview.toolReviews).toBe(MAX_TOOL_REVIEWS);
      expect(context.responseReview.unavailable).toBe(true);
    });

    it(`${name}: cancellation and follow-up during or after approval execute nothing`, async () => {
      const { runToolLoop } = await import("@/utils/chat/toolLoop");
      for (const followUp of [false, true]) {
        const context = makeReviewContext();
        const delivered: string[] = [];
        const pending = held("never send", delivered, "function_call");
        pending.data = { name, args: { target: "fixture" } };
        const { provider } = makeProvider([pending]);
        Object.assign(provider, {
          callStructuredJSON: async () => {
            hasStopRequest = true;
            isFollowUpRequest = followUp;
            return { success: true, data: { status: "pass" } };
          },
        });
        const result = await runToolLoop(makeParams(context, provider));
        expect(result.status).toBe(followUp ? "follow_up_interrupt" : "stopped_by_user");
        expect(toolExecuteCalls).toEqual([]);
        expect(delivered).toEqual([]);
        expect(context.responseReview.pending).toEqual([]);
        hasStopRequest = false;
        isFollowUpRequest = false;
      }
    });

    it(`${name}: a repeated successful action during response revision reuses history without replay`, async () => {
      const { runToolLoop } = await import("@/utils/chat/toolLoop");
      const context = makeReviewContext();
      const delivered: string[] = [];
      const args = { target: "fixture" };
      const { provider } = makeProvider([
        makeFunctionCallResult(name, args),
        held("generic", delivered),
        makeFunctionCallResult(name, args),
        held("quiet", delivered),
      ]);
      let textReviews = 0;
      Object.assign(provider, {
        callStructuredJSON: async (request: ProviderStructuredJsonRequest) => ({
          success: true,
          data: request.schemaName === "response_review" && ++textReviews === 1 ? rejection : { status: "pass" },
        }),
      });
      await runToolLoop(makeParams(context, provider));
      expect(toolExecuteCalls).toEqual([{ name, args }]);
      expect(context.responseReview.functionHistory).toHaveLength(2);
      expect(context.responseReview.functionHistory[0]?.functionResponse).toEqual(
        context.responseReview.functionHistory[1]?.functionResponse,
      );
      expect(context.responseReview.toolReviews).toBe(1);
      expect(delivered).toEqual(["quiet"]);
    });

    it(`${name}: Off executes ordinarily without review, preparation or replay suppression`, async () => {
      const { runToolLoop } = await import("@/utils/chat/toolLoop");
      const { provider } = makeProvider([
        makeFunctionCallResult(name, { target: "fixture" }),
        makeFunctionCallResult(name, { target: "fixture" }),
        { status: "completed" },
      ]);
      const review = mock(async () => ({ success: true, data: rejection }));
      Object.assign(provider, { callStructuredJSON: review });
      await runToolLoop(makeParams(makeContext(), provider));
      expect(toolExecuteCalls).toHaveLength(2);
      expect(review).not.toHaveBeenCalled();
    });
  }

  it("applies the two turn-wide correction opportunities across independent chains and fallback", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const context = makeReviewContext();
    const { provider: first } = makeProvider([
      makeFunctionCallResult("lookup", { target: "invented" }),
      makeFunctionCallResult("lookup", { target: "fixture" }),
      { status: "error" },
    ]);
    let calls = 0;
    Object.assign(first, {
      callStructuredJSON: async () => ({ success: true, data: ++calls === 1 ? rejection : { status: "pass" } }),
    });
    await runToolLoop(makeParams(context, first));
    const { provider } = makeProvider([
      makeFunctionCallResult("mirror_action", { target: "invented" }),
      makeFunctionCallResult("mirror_action", { target: "fixture" }),
      makeFunctionCallResult("other_action", { target: "invented" }),
      makeFunctionCallResult("other_action", { target: "fixture" }),
      { status: "completed" },
    ]);
    calls = 0;
    Object.assign(provider, {
      callStructuredJSON: async () => ({ success: true, data: ++calls === 2 ? { status: "pass" } : rejection }),
    });
    await runToolLoop(makeParams(context, provider));
    expect(context.responseReview.toolCorrections).toBe(MAX_TOOL_CORRECTIONS);
    expect(toolExecuteCalls.map((call) => call.name)).toEqual(["lookup", "mirror_action"]);
    expect(context.responseReview.toolReviews).toBe(5);
  });

  it("reviews each actual call independently with prior successful effects as evidence", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const context = makeReviewContext();
    const { provider } = makeProvider([
      makeFunctionCallResult("lookup", { target: "fixture" }),
      makeFunctionCallResult("mirror_action", { target: "invented" }),
      { status: "completed" },
    ]);
    const packets: Array<ReturnType<typeof buildReviewerPacket>> = [];
    Object.assign(provider, {
      callStructuredJSON: async (request: ProviderStructuredJsonRequest) => {
        packets.push(JSON.parse(request.userPrompt));
        return { success: true, data: packets.length === 1 ? { status: "pass" } : rejection };
      },
    });
    await runToolLoop(makeParams(context, provider));
    expect(toolExecuteCalls.map((call) => call.name)).toEqual(["lookup"]);
    expect(packets[1]?.tools[0]?.name).toBe("lookup");
    expect(packets[1]?.proposedCall?.name).toBe("mirror_action");
    expect(context.responseReview.toolReviews).toBe(2);
  });

  it("bounds review calls for independent requests without borrowing the response budget", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const context = makeReviewContext();
    const { provider } = makeProvider([
      ...Array.from({ length: MAX_TOOL_REVIEWS + 2 }, (_, index) =>
        makeFunctionCallResult("mirror_action", { target: `fixture_${index}` }),
      ),
      { status: "completed" },
    ]);
    const review = mock(async () => ({ success: true, data: { status: "pass" } }));
    Object.assign(provider, { callStructuredJSON: review });
    await runToolLoop(makeParams(context, provider));
    expect(toolExecuteCalls).toHaveLength(MAX_TOOL_REVIEWS + 2);
    expect(review).toHaveBeenCalledTimes(MAX_TOOL_REVIEWS);
    expect(context.responseReview.unavailable).toBe(true);
    expect(context.responseReview.responseReviews).toBe(0);
  });

  it("canonicalizes nested argument order while retaining changed effects", () => {
    const first = { name: "lookup", args: { target: "fixture", nested: { b: 2, a: 1 } } };
    expect(toolRequestIdentity(first)).toBe(
      toolRequestIdentity({ name: "lookup", args: { nested: { a: 1, b: 2 }, target: "fixture" } }),
    );
    expect(toolRequestIdentity(first)).not.toBe(
      toolRequestIdentity({ ...first, args: { ...first.args, target: "other" } }),
    );
  });
  it("tool refusal, malformed output and operation failure end review without injecting refusal feedback", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    for (const failure of ["refusal", "malformed", "throw"] as const) {
      toolExecuteCalls = [];
      const context = makeReviewContext();
      const { provider } = makeProvider([
        makeFunctionCallResult("mirror_action", { target: "fixture" }),
        makeFunctionCallResult("lookup", { target: "fixture" }),
        { status: "completed" },
      ]);
      let calls = 0;
      Object.assign(provider, {
        callStructuredJSON: async () => {
          calls++;
          if (failure === "throw") throw new Error("PRIVATE_REFUSAL");
          return failure === "refusal"
            ? { success: false, failure: "refusal" }
            : { success: true, data: { status: "revise", findings: [] } };
        },
      });
      await runToolLoop(makeParams(context, provider));
      expect(calls).toBe(1);
      expect(toolExecuteCalls).toHaveLength(2);
      expect(context.responseReview.feedback).toBeUndefined();
      expect(JSON.stringify(context.responseReview.functionHistory)).not.toContain("PRIVATE_REFUSAL");
    }
  });

  it("tool reviewer cancellation aborts a pending transport and ignores its late approval", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    const context = makeReviewContext();
    const { provider } = makeProvider([makeFunctionCallResult("mirror_action", { target: "fixture" })]);
    let lateApproval!: (value: unknown) => void;
    let aborted = false;
    Object.assign(provider, {
      callStructuredJSON: (request: ProviderStructuredJsonRequest) => {
        request.abortSignal?.addEventListener(
          "abort",
          () => {
            aborted = true;
          },
          { once: true },
        );
        queueMicrotask(() => requestFollowUp(context.channel.id, "fixture-user"));
        return new Promise((resolve) => {
          lateApproval = resolve;
        });
      },
    });
    try {
      const result = await runToolLoop(makeParams(context, provider));
      expect(result.personaResponses).toEqual([]);
      expect(aborted).toBe(true);
      lateApproval({ success: true, data: { status: "pass" } });
      await Promise.resolve();
      expect(toolExecuteCalls).toEqual([]);
      expect(context.responseReview.unavailable).toBe(false);
    } finally {
      deleteStopRequest(context.channel.id);
    }
  });

  it("tool evidence with redacted effects, missing definition or unsupported admitted media becomes unavailable", async () => {
    const { runToolLoop } = await import("@/utils/chat/toolLoop");
    for (const mode of ["secret", "definition", "media"] as const) {
      toolExecuteCalls = [];
      const context = makeReviewContext();
      if (mode === "media")
        context.contextItems.push({
          role: "user",
          parts: [{ type: "image", mimeType: "image/png", uri: "https://example.com/fixture.png" }],
        });
      const args = mode === "secret" ? { api_key: "PRIVATE_KEY" } : { target: "fixture" };
      const { provider } = makeProvider([makeFunctionCallResult("mirror_action", args), { status: "completed" }]);
      if (mode === "definition") Object.assign(provider, { getTools: async () => [] });
      const review = mock(async () => ({ success: true, data: { status: "pass" } }));
      Object.assign(provider, { callStructuredJSON: review });
      await runToolLoop(makeParams(context, provider));
      expect(review).not.toHaveBeenCalled();
      expect(context.responseReview.unavailable).toBe(true);
      expect(toolExecuteCalls).toEqual([{ name: "mirror_action", args }]);
    }
  });
});
