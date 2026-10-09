import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Client, Message } from "discord.js";
import type { CustomEndpointRow, LlmRow, TomoriState } from "@/types/db/schema";
import { ContextItemTag } from "@/types/misc/context";
import type { ProviderConfig, StreamResult } from "@/types/provider/interfaces";
import type { FallbackNoticeAttempt } from "@/utils/discord/fallbackModelNotice";
import type { ChatResponseSink, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import type { ToolLoopParams } from "@/utils/chat/toolLoop";
import type { TextQuotaTriggerState } from "@/utils/chat/textQuotaState";
// Capture the REAL repository barrel before the mock below replaces it. Importing
// it is side-effect-free (the DB client connects lazily, not at import), and
// `mock.module` runs in source order (not hoisted), so this static import resolves
// to the real module. Spreading it into the mock keeps every repository export
// present, so command modules pulled into the SUT's dynamic-import graph can
// satisfy their static `import { ... }` bindings. Without this, running this file
// in its own process (per-file isolation in runTests.ts) fails to link exports
// like `serverScheduleRepository` that the graph imports but the stub omitted.
import * as realRepositories from "@/utils/db/repositories";
// Same link-time capture for every other module mocked below, for the same
// reason: a partial factory leaks for the rest of the run and breaks files
// loaded later. Spreading the real namespace keeps each mock full-surface.
import * as realChannelLlmCache from "@/utils/cache/channelLlmCache";
import * as realAdmissionGuards from "@/utils/chat/admissionGuards";
import * as realNovelaiCapabilityCache from "@/utils/cache/novelaiCapabilityCache";
import * as realNovelaiSubscriptionCache from "@/utils/cache/novelaiSubscriptionCache";
import * as realOpenrouterCapabilityCache from "@/utils/cache/openrouterCapabilityCache";
import * as realToolLoop from "@/utils/chat/toolLoop";
import * as realFallbackModelNotice from "@/utils/discord/fallbackModelNotice";
import * as realStreamOrchestrator from "@/utils/discord/streamOrchestrator";
import * as realPersonalProviderRuntime from "@/utils/provider/personalProviderRuntime";
import * as realProviderFactory from "@/utils/provider/providerFactory";
import * as realCrypto from "@/utils/security/crypto";
import * as realKeyRotation from "@/utils/security/keyRotation";
import * as realToolRegistry from "@/tools/toolRegistry";
import { createScopedModuleMocker, overrideMembers, stubLogMembers } from "../../helpers/mockSurface";
import { VERBATIM_TOOL_CALLING_NUDGE } from "@/utils/tools/verbatimToolCalling";

const queuedResults: GenerationTurnResult[] = [];
// Parallel to queuedResults: the delivered-message refs each runToolLoop call should push into the
// shared sink before returning its queued result, simulating messages the stream committed to
// Discord during that attempt. Undefined entries push nothing.
const queuedDeliveries: Array<Array<{ messageId: string; channelId: string; isWebhook: boolean }> | undefined> = [];
const toolLoopCalls: Array<{
  model: string;
  suppressUserErrors: boolean | undefined;
  contextItems: ToolLoopParams["context"]["contextItems"];
  numCtx: number | null | undefined;
}> = [];
const providerConfigCalls: Array<{ model: string; apiKey: string }> = [];
const fallbackNoticeCalls: Array<{
  failures: FallbackNoticeAttempt[];
  successModel: LlmRow;
  offerPersonalFallbackOptOut: boolean | undefined;
}> = [];
const personalSavedConfigLoads: Array<{ userId: number; provider: string }> = [];
// Records the server text quota admissions the fallback phase takes, so a test can tell an
// admission that never happened from one that was granted.
const textQuotaAdmissions: Array<{
  triggerKey: string;
  isPersonaJob: boolean;
  userDiscId: string;
  notifyUser: boolean | undefined;
}> = [];
let textQuotaAdmissionResult: { allowed: boolean; state: TextQuotaTriggerState | null } = {
  allowed: true,
  state: null,
};
let textQuotaAdmissionFailure: Error | null = null;
// Records the server cooldown admissions the fallback phase takes, and decides their answer.
const cooldownAdmissions: Array<{ serverDiscId: string; cooldownUserDiscId: string; notifyUser: boolean | undefined }> =
  [];
let cooldownAdmissionResult = true;
// Records the timeout notices the fallback phase resends for a suppressed attempt.
const timeoutNotices: Array<{ providerName: string; sawStreamProgress: boolean }> = [];
const testStopRequests = new Map<string, { type: "stop" | "follow_up"; stopContext?: TestStopContext }>();
let personalOverlayState: TomoriState | null = null;

type TestStopContext = {
  originalStopMessage: Message;
  client: Client;
};

// The real `ColorCode` enum passes through the spread, so its values stay the
// hex STRINGS modules call string methods on at load time (e.g. contextEmbeds.ts
// does ColorCode.ERROR.replace("#", "")). Only `log` is silenced.
const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/cache/channelLlmCache": realChannelLlmCache,
  "@/utils/chat/admissionGuards": realAdmissionGuards,
  "@/utils/cache/novelaiCapabilityCache": realNovelaiCapabilityCache,
  "@/utils/cache/novelaiSubscriptionCache": realNovelaiSubscriptionCache,
  "@/utils/cache/openrouterCapabilityCache": realOpenrouterCapabilityCache,
  "@/utils/db/repositories": realRepositories,
  "@/utils/discord/fallbackModelNotice": realFallbackModelNotice,
  "@/utils/discord/streamOrchestrator": realStreamOrchestrator,
  "@/utils/provider/personalProviderRuntime": realPersonalProviderRuntime,
  "@/utils/provider/providerFactory": realProviderFactory,
  "@/utils/security/crypto": realCrypto,
  "@/utils/security/keyRotation": realKeyRotation,
  "@/utils/chat/toolLoop": realToolLoop,
  "@/tools/toolRegistry": realToolRegistry,
});

stubLogMembers({
  error: () => undefined,
  info: () => undefined,
  section: () => undefined,
  success: () => undefined,
  warn: () => undefined,
});

scopedMock.module("@/utils/cache/channelLlmCache", () => ({
  ...realChannelLlmCache,
  getCachedChannelLlm: async () => null,
}));

scopedMock.module("@/utils/cache/novelaiCapabilityCache", () => ({
  ...realNovelaiCapabilityCache,
  getNovelAITokenLimits: () => undefined,
}));

scopedMock.module("@/utils/cache/novelaiSubscriptionCache", () => ({
  ...realNovelaiSubscriptionCache,
  getCachedContextTokens: () => undefined,
  refreshNovelAISubscription: async () => undefined,
}));

scopedMock.module("@/utils/cache/openrouterCapabilityCache", () => ({
  ...realOpenrouterCapabilityCache,
  getOpenRouterCapabilities: () => undefined,
  getOpenRouterCapabilityCacheSize: () => 0,
  getOpenRouterPricing: () => undefined,
  getOpenRouterSupportedParameters: () => undefined,
  getOpenRouterTokenizer: () => undefined,
  getOpenRouterTokenLimits: () => undefined,
  getOrFetchOpenRouterCapabilities: async () => undefined,
  initializeOpenRouterCapabilityCache: async () => undefined,
  isOpenRouterCapabilityCacheReady: () => false,
}));

scopedMock.module("@/utils/db/repositories", () => ({
  // Spread the real barrel first so every export the SUT graph imports is present,
  // then override only the repository methods this test's code path actually drives.
  ...realRepositories,
  // Each repository is a class INSTANCE: its methods live on the prototype and
  // a spread would drop them, so delegate and shadow only what this file drives.
  llmProviderRepo: overrideMembers(realRepositories.llmProviderRepo, {
    // A stored key for every provider, so a cross-provider fallback arm can be constructed here
    // instead of failing on `applySavedProviderConfig`'s missing-credentials throw.
    loadSavedProviderConfig: async () => ({ api_key: Buffer.from("encrypted-key"), key_version: 1 }),
    loadUserSavedProviderConfig: async (userId: number, provider: string) => {
      personalSavedConfigLoads.push({ userId, provider });
      return { api_key: Buffer.from("encrypted-key"), key_version: 1 };
    },
  }),
  configRepository: overrideMembers(realRepositories.configRepository, {
    updateNsfwConfig: async () => true,
  }),
  personaRepository: overrideMembers(realRepositories.personaRepository, {
    loadAllForServer: async () => [],
  }),
  userRepository: overrideMembers(realRepositories.userRepository, {
    loadOrCreateUser: async () => null,
    updateLastSeen: async () => undefined,
  }),
  serverRepository: overrideMembers(realRepositories.serverRepository, {
    loadServerState: async () => null,
  }),
}));

scopedMock.module("@/utils/discord/fallbackModelNotice", () => ({
  ...realFallbackModelNotice,
  sendFallbackModelUsageNotice: async (args: {
    failures: FallbackNoticeAttempt[];
    successModel: LlmRow;
    offerPersonalFallbackOptOut?: boolean;
  }) => {
    fallbackNoticeCalls.push({
      failures: args.failures,
      successModel: args.successModel,
      offerPersonalFallbackOptOut: args.offerPersonalFallbackOptOut,
    });
  },
}));

// The admission itself reads quota usage from the database and notifies the user through Discord;
// this file only needs to observe that the server fallback phase asked, and to decide the answer.
scopedMock.module("@/utils/chat/admissionGuards", () => ({
  ...realAdmissionGuards,
  checkTextQuotaForAdmission: async (params: {
    triggerKey: string;
    isPersonaJob: boolean;
    userDiscId: string;
    shouldApplyTextQuota: boolean;
    notifyUser?: boolean;
  }) => {
    textQuotaAdmissions.push({
      triggerKey: params.triggerKey,
      isPersonaJob: params.isPersonaJob,
      userDiscId: params.userDiscId,
      notifyUser: params.notifyUser,
    });
    if (textQuotaAdmissionFailure) throw textQuotaAdmissionFailure;
    return textQuotaAdmissionResult;
  },
  // The real cooldown admission reads and writes cooldown rows; the phase's own decision to ask at
  // all is what these tests are about, so the answer is supplied here.
  enforceServerTriggerCooldownForAdmission: async (params: {
    serverDiscId: string;
    cooldownUserDiscId: string;
    notifyUser?: boolean;
  }) => {
    cooldownAdmissions.push({
      serverDiscId: params.serverDiscId,
      cooldownUserDiscId: params.cooldownUserDiscId,
      notifyUser: params.notifyUser,
    });
    return cooldownAdmissionResult;
  },
}));

scopedMock.module("@/utils/discord/streamOrchestrator", () => ({
  ...realStreamOrchestrator,
  StreamOrchestrator: overrideMembers(realStreamOrchestrator.StreamOrchestrator, {
    requestStop(channelId: string, requesterId?: string, stopContext?: TestStopContext): boolean {
      void requesterId;
      testStopRequests.set(channelId, { type: "stop", stopContext });
      return true;
    },

    requestFollowUp(channelId: string, requesterId: string): boolean {
      void requesterId;
      testStopRequests.set(channelId, { type: "follow_up" });
      return true;
    },

    hasStopRequest(channelId: string): boolean {
      return testStopRequests.has(channelId);
    },

    clearStopRequest(channelId: string): void {
      const request = testStopRequests.get(channelId);
      if (!request?.stopContext) {
        testStopRequests.delete(channelId);
      }
    },

    getAndClearStopContext(channelId: string): TestStopContext | null {
      const request = testStopRequests.get(channelId);
      if (!request?.stopContext) {
        return null;
      }
      testStopRequests.delete(channelId);
      return request.stopContext;
    },
  }),
}));

scopedMock.module("@/utils/provider/personalProviderRuntime", () => ({
  ...realPersonalProviderRuntime,
  applyPersonalProviderSelectionsToTomoriState: async (tomoriState: TomoriState) => ({
    tomoriState: personalOverlayState ?? tomoriState,
    activeConfigs: {},
  }),
}));

scopedMock.module("@/utils/provider/providerFactory", () => ({
  ...realProviderFactory,
  getProviderForTomori: async () => fakeProvider,
  ProviderFactory: overrideMembers(realProviderFactory.ProviderFactory, {
    getProviderByName: async () => fakeProvider,
  }),
}));

// The spread keeps the full real export surface intact. `mock.module` is
// process-wide and never restored, so a partial stub would leave later test
// files unable to link against any omitted export.
scopedMock.module("@/utils/security/crypto", () => ({
  ...realCrypto,
  decryptApiKey: async (key: Buffer) => (key.toString() === "personal-encrypted-key" ? "personal-key" : "server-key"),
  encryptApiKey: async () => ({ encrypted: Buffer.from(""), version: 1 }),
  storeOptApiKey: async () => true,
  getOptApiKey: async () => null,
  deleteOptApiKey: async () => true,
  hasOptApiKey: async () => false,
}));

scopedMock.module("@/utils/security/keyRotation", () => ({
  ...realKeyRotation,
  MAX_KEY_ATTEMPTS: 3,
  hasAvailableRotationKey: async () => false,
  recordKeyError: async () => undefined,
  recordKeySuccess: async () => undefined,
  selectApiKey: async () => null,
}));

scopedMock.module("@/utils/chat/toolLoop", () => ({
  ...realToolLoop,
  providerIsApiFamily: (providerName: string, apiFamily: string) => {
    const families: Record<string, string> = {
      google: "google-genai",
      novelai: "novelai",
      openrouter: "openrouter",
    };
    return families[providerName.toLowerCase()] === apiFamily;
  },
  runToolLoop: runToolLoopMock,
  sendStreamTimeoutNotice: async (params: { providerName: string; sawStreamProgress: boolean }) => {
    timeoutNotices.push({ providerName: params.providerName, sawStreamProgress: params.sawStreamProgress });
  },
}));

// The verbatim schema dump resolves the offering tool set through the registry, which starts empty
// in a unit-test process. One declared tool is enough to prove the dump is built and injected.
scopedMock.module("@/tools/toolRegistry", () => ({
  ...realToolRegistry,
  getAvailableToolsWithMCP: async () => ({
    builtInTools: [
      {
        name: "generate_voice_message",
        description: "Speak a line out loud.",
        parameters: { type: "object", properties: { text: { type: "string", description: "Line to speak." } } },
        category: "speech",
        handler: async () => ({ success: true }),
      },
    ],
    mcpFunctionNames: [],
    totalCount: 1,
  }),
}));

type ToolExecutionResult = {
  success: boolean;
  data?: unknown;
  error?: string;
  message?: string;
};

type FunctionHistoryEntry = {
  functionCall: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse: {
    functionResponse: {
      name: string;
      response: {
        result: unknown;
      };
    };
  };
};

async function runToolLoopMock(params: ToolLoopParams): Promise<GenerationTurnResult> {
  if (queuedResults.length > 0) {
    // Mirrors the real tool loop's per-attempt bookkeeping: a notice an earlier attempt held back
    // describes that attempt, not this one.
    params.context.streamingContext.deferredTimeoutNotice = undefined;
    toolLoopCalls.push({
      model: params.tomoriState.llm.llm_codename,
      suppressUserErrors: params.context.streamingContext.suppressUserErrors,
      contextItems: params.context.contextItems,
      numCtx: params.tomoriState.config.custom_num_ctx,
    });
    // Simulate this attempt committing messages to the channel before it resolves, so the
    // supersede-cleanup path in runGenerationTurn has refs to act on.
    const deliveries = queuedDeliveries.shift();
    if (deliveries) {
      if (!params.context.streamingContext.deliveredMessageRefs) {
        params.context.streamingContext.deliveredMessageRefs = [];
      }
      params.context.streamingContext.deliveredMessageRefs.push(...deliveries);
    }
    const next = queuedResults.shift();
    if (!next) {
      throw new Error("No queued generation result for test");
    }
    if (next.status === "timeout") {
      // Mirrors the real tool loop: an SDK-call timeout sends its notice inline when the user can
      // see errors, and otherwise leaves it for the caller that knows whether a fallback answered.
      const notice = { providerName: params.tomoriState.llm.llm_provider, sawStreamProgress: true };
      if (params.context.streamingContext.suppressUserErrors) {
        params.context.streamingContext.deferredTimeoutNotice = notice;
      } else {
        timeoutNotices.push(notice);
      }
    }
    return next;
  }

  return runToolLoopContractShim(params);
}

async function runToolLoopContractShim(params: ToolLoopParams): Promise<GenerationTurnResult> {
  // Read the bounds off the link-time capture of the real module: this shim stands in for
  // runToolLoop, so literals here would let it drift from the loop it models.
  const maxIterations = realToolLoop.MAX_FUNCTION_CALL_ITERATIONS;
  const maxConsecutiveToolErrors = realToolLoop.MAX_CONSECUTIVE_TOOL_ERRORS;
  const streamResults: StreamResult[] = [];
  const functionHistory: FunctionHistoryEntry[] = [];
  let consecutiveToolErrors = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const streamResult = await callProviderStream(params, functionHistory);
    streamResults.push(streamResult);

    if (streamResult.status === "completed") {
      return {
        status: "completed",
        streamResults,
        personaResponses: streamResult.accumulatedText
          ? [
              {
                personaName: params.tomoriState.persona_nickname,
                text: streamResult.accumulatedText,
                personaId: params.tomoriState.persona_id,
                personaLineageId: params.tomoriState.persona_lineage_id,
              },
            ]
          : [],
      };
    }

    if (streamResult.status !== "function_call") {
      return {
        status: streamResult.status === "timeout" ? "timeout" : "error",
        streamResults,
        personaResponses: [],
      };
    }

    const functionCall = parseFunctionCall(streamResult);
    if (!functionCall) {
      return { status: "error", streamResults, personaResponses: [] };
    }

    const toolResult = await executeToolForShim(params, functionCall);
    if (toolResult.success && handleContextRestartForShim(params, toolResult.data)) {
      continue;
    }

    if (!toolResult.success) {
      consecutiveToolErrors++;
    } else {
      consecutiveToolErrors = 0;
    }

    functionHistory.push({
      functionCall,
      functionResponse: {
        functionResponse: {
          name: functionCall.name,
          response: {
            result: toolResult.success
              ? (toolResult.data ?? { status: "completed" })
              : {
                  status: "tool_execution_failed",
                  reason: toolResult.message || toolResult.error || "Tool execution failed without specific error",
                  tool_name: functionCall.name,
                },
          },
        },
      },
    });

    if (consecutiveToolErrors >= maxConsecutiveToolErrors) {
      return { status: "error", streamResults, personaResponses: [] };
    }
  }

  return { status: "timeout", streamResults, personaResponses: [] };
}

async function callProviderStream(
  params: ToolLoopParams,
  functionHistory: FunctionHistoryEntry[],
): Promise<StreamResult> {
  const provider = params.provider as unknown as {
    streamToDiscord: (...args: unknown[]) => Promise<StreamResult>;
  };

  return provider.streamToDiscord(
    params.context.channel,
    params.context.client,
    params.tomoriState,
    params.providerConfig,
    params.context,
    [],
    params.context.emojiStrings,
    functionHistory,
  );
}

function parseFunctionCall(streamResult: StreamResult): { name: string; args: Record<string, unknown> } | null {
  const data = streamResult.data;
  if (!data || typeof data !== "object") return null;
  const candidate = data as { name?: unknown; args?: unknown };
  if (typeof candidate.name !== "string" || candidate.name.length === 0) return null;
  return {
    name: candidate.name,
    args:
      candidate.args && typeof candidate.args === "object" && !Array.isArray(candidate.args)
        ? (candidate.args as Record<string, unknown>)
        : {},
  };
}

async function executeToolForShim(
  params: ToolLoopParams,
  functionCall: { name: string; args: Record<string, unknown> },
): Promise<ToolExecutionResult> {
  const allowedToolNames = params.context.streamingContext.deliberateToolAllowedNames;
  if (
    params.context.deliberateToolModeActive &&
    Array.isArray(allowedToolNames) &&
    !allowedToolNames.includes(functionCall.name)
  ) {
    return {
      success: false,
      error: `Tool "${functionCall.name}" was not exposed for this deliberate tool mode turn.`,
    };
  }

  const { ToolRegistry } = (await import("@/tools/toolRegistry")) as {
    ToolRegistry: {
      executeTool: (name: string, args: Record<string, unknown>, context?: unknown) => Promise<ToolExecutionResult>;
    };
  };

  return ToolRegistry.executeTool(functionCall.name, functionCall.args, params.context);
}

function handleContextRestartForShim(params: ToolLoopParams, data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const result = data as { type?: unknown; enhanced_context_item?: unknown };
  if (typeof result.type !== "string" || !result.type.startsWith("context_restart")) return false;

  if (result.enhanced_context_item) {
    params.context.contextItems.push(result.enhanced_context_item as never);
  }
  if (result.type.includes("youtube")) {
    params.context.streamingContext.disableYouTubeProcessing = true;
  }
  return true;
}

const fakeProvider = {
  createConfig: async (tomoriState: TomoriState, apiKey: string): Promise<ProviderConfig> => {
    providerConfigCalls.push({ model: tomoriState.llm.llm_codename, apiKey });
    return {
      apiKey,
      model: tomoriState.llm.llm_codename,
      temperature: tomoriState.config.llm_temperature ?? 0.7,
    };
  },
  getInfo: () => ({ name: "google" }),
};

function makeLlm(id: number, codename: string): LlmRow {
  return {
    llm_id: id,
    llm_codename: codename,
    llm_provider: "google",
    has_tools: false,
    sees_images: false,
    sees_videos: false,
    supports_structoutput: false,
  } as unknown as LlmRow;
}

function makeContext(primaryModel: LlmRow, fallbackModel: LlmRow): ChatTurnContext {
  const channel = {
    id: "channel_1",
    isThread: () => false,
  };
  const state = {
    server_id: 1,
    persona_id: 10,
    persona_lineage_id: 100,
    persona_nickname: "Tomori",
    is_alter: false,
    llm: primaryModel,
    fallback_chain: [{ kind: "llm", model: fallbackModel }],
    config: {
      api_key: "encrypted-key",
      key_version: 1,
      llm_temperature: 0.7,
      private_channel_ids: [],
      tool_notice_hidden_keys: [],
      user_byok_mode: false,
    },
  } as unknown as TomoriState;

  return {
    channel,
    client: {},
    contextItems: [],
    currentPersona: state,
    emojiStrings: [],
    guild: null,
    isDMChannel: false,
    isFromQueue: true,
    isPersonaJob: false,
    isSelfMessage: false,
    isStopResponse: false,
    isUserImpersonation: false,
    loadedEmojis: null,
    loadedStickers: null,
    locale: "en-US",
    message: { id: "message_1", channel },
    messageIdMap: new Map(),
    personalRoutingUserId: null,
    personalTextProvider: null,
    requestSnapshot: {},
    serverDiscId: "server_1",
    shouldApplyTextQuota: false,
    shouldSurfaceUserErrors: true,
    simplifiedMessages: [],
    streamingContext: {
      disableYouTubeProcessing: false,
    },
    textCredentialSource: "server",
    textQuotaState: null,
    textQuotaTriggerKey: "trigger_1",
    tomoriState: state,
    turn: {
      lockedTurn: {
        admission: {
          incoming: {
            retryCount: 0,
            textQuotaSource: "user",
          },
          cooldownUserDiscId: "user_1",
        },
        channelId: "channel_1",
        lockedAt: Date.now(),
        queueDepth: 0,
        skipLock: false,
      },
      // The account preference the server fallback guard reads, on the same cached row the turn
      // planner took the personal routing decision from.
      userRow: { user_id: 4, user_disc_id: "user_1", personal_server_fallback_enabled: true },
    },
    userDiscId: "user_1",
  } as unknown as ChatTurnContext;
}

/** Turns the fixture into a user-triggered turn that runs on the user's own text provider. */
function makePersonalContext(serverPrimary: LlmRow, serverFallback: LlmRow, personalPrimary: LlmRow): ChatTurnContext {
  const context = makeContext(serverPrimary, serverFallback);
  context.textCredentialSource = "personal";
  context.streamingContext.textCredentialSource = "personal";
  context.personalRoutingUserId = 4;
  context.personalTextProvider = "openrouter";
  personalOverlayState = {
    ...context.currentPersona,
    llm: personalPrimary,
    fallback_chain: undefined,
    fallback_llms: undefined,
    config: { ...context.currentPersona.config, api_key: Buffer.from("personal-encrypted-key") },
  } as TomoriState;
  return context;
}

/** The error the personal route returns before every server route attempt in these tests. */
function personalRouteFailure(): GenerationTurnResult {
  return {
    status: "error",
    streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
    personaResponses: [],
  };
}

function successfulReply(text = "ok"): GenerationTurnResult {
  return {
    status: "completed",
    streamResults: [{ status: "completed", accumulatedText: text }],
    personaResponses: [{ personaName: "Tomori", text, personaId: 10, personaLineageId: 100 }],
  };
}

function collectingSink(): ChatResponseSink & { emittedErrors: unknown[]; finalizedResults: GenerationTurnResult[] } {
  const emittedErrors: unknown[] = [];
  const finalizedResults: GenerationTurnResult[] = [];
  return {
    emittedErrors,
    finalizedResults,
    emitStreamResult: async (result) => {
      emittedErrors.push(result);
    },
    emitError: async (error) => {
      emittedErrors.push(error);
    },
    finalize: async (result) => {
      finalizedResults.push(result);
    },
  };
}

/** Pins the model-randomizer draw so a pool's lead model is decided by the test, not by chance. */
async function runWithFixedRandom(leadFraction: number, run: () => Promise<void>): Promise<void> {
  const originalRandom = Math.random;
  Math.random = () => leadFraction;
  try {
    await run();
  } finally {
    Math.random = originalRandom;
  }
}

describe("runGenerationTurn fallback behavior", () => {
  beforeEach(async () => {
    queuedResults.length = 0;
    queuedDeliveries.length = 0;
    toolLoopCalls.length = 0;
    providerConfigCalls.length = 0;
    fallbackNoticeCalls.length = 0;
    personalSavedConfigLoads.length = 0;
    textQuotaAdmissions.length = 0;
    textQuotaAdmissionResult = {
      allowed: true,
      state: { serverId: 1, userDiscId: "user_1", consumed: false, createdAt: Date.now() },
    };
    textQuotaAdmissionFailure = null;
    cooldownAdmissions.length = 0;
    cooldownAdmissionResult = true;
    timeoutNotices.length = 0;
    personalOverlayState = null;

    const { StreamOrchestrator } = await import("@/utils/discord/streamOrchestrator");
    StreamOrchestrator.clearStopRequest("channel_1");
    StreamOrchestrator.getAndClearStopContext("channel_1");
  });

  it("suppresses primary errors and posts compact fallback notice when a fallback succeeds", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const fallbackModel = makeLlm(2, "fallback-model");
    const context = makeContext(primaryModel, fallbackModel);
    const emittedErrors: unknown[] = [];
    const finalizedResults: GenerationTurnResult[] = [];
    const sink: ChatResponseSink = {
      emitStreamResult: async (result) => {
        emittedErrors.push(result);
      },
      emitError: async (error) => {
        emittedErrors.push(error);
      },
      finalize: async (result) => {
        finalizedResults.push(result);
      },
    };

    const fallbackSuccess: GenerationTurnResult = {
      status: "completed",
      streamResults: [{ status: "completed", accumulatedText: "ok" }],
      personaResponses: [
        {
          personaName: "Tomori",
          text: "ok",
          personaId: 10,
          personaLineageId: 100,
        },
      ],
    };
    queuedResults.push(
      {
        status: "error",
        streamResults: [
          {
            status: "error",
            data: { type: "rate_limit", code: "429", message: "rate limited for key sk-live-CANARY0001 <@&42>" },
          },
        ],
        personaResponses: [],
      },
      fallbackSuccess,
    );

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result).toBe(fallbackSuccess);
    expect(toolLoopCalls.map(({ model, suppressUserErrors }) => ({ model, suppressUserErrors }))).toEqual([
      { model: "primary-model", suppressUserErrors: true },
      { model: "fallback-model", suppressUserErrors: false },
    ]);
    expect(emittedErrors).toHaveLength(0);
    expect(finalizedResults).toEqual([fallbackSuccess]);
    expect(fallbackNoticeCalls).toHaveLength(1);
    expect(fallbackNoticeCalls[0]?.failures).toEqual([
      { modelCodename: "primary-model", errorDetail: "rate_limit (429)" },
    ]);
    expect(fallbackNoticeCalls[0]?.successModel.llm_codename).toBe("fallback-model");
    expect(context.streamingContext.suppressUserErrors).toBe(false);
    expect(context.streamingContext.forceModelFallback).toBe(false);
  });

  it("re-resolves the prefill per attempt so a fallback that rejects it gets no trailing assistant turn", async () => {
    const primaryModel = {
      ...makeLlm(1, "claude-haiku-4-5"),
      llm_provider: "anthropic",
      supports_assistant_prefill: true,
    } as LlmRow;
    const fallbackModel = { ...makeLlm(2, "claude-sonnet-4-6"), llm_provider: "anthropic" } as LlmRow;
    const context = makeContext(primaryModel, fallbackModel);
    context.assistantPrefill = { text: "Sure, here", source: "manual" };
    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async () => undefined,
    };
    queuedResults.push(
      {
        status: "error",
        streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
        personaResponses: [],
      },
      { status: "completed", streamResults: [{ status: "completed", accumulatedText: "ok" }], personaResponses: [] },
    );

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    const [primaryCall, fallbackCall] = toolLoopCalls;
    expect(primaryCall?.contextItems.at(-1)?.role).toBe("model");
    expect(fallbackCall?.contextItems.some((item) => item.role === "model")).toBe(false);
    expect(context.streamingContext.outputPrefill).toBe("Tomori: Sure, here");
  });

  it("runs a user-scoped custom endpoint fallback on its own saved credentials and num_ctx", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const context = makeContext(primaryModel, makeLlm(2, "unused-fallback"));
    context.currentPersona.config.custom_num_ctx = 32_768;
    const endpoint = {
      custom_endpoint_id: 5,
      connection_id: 42,
      server_id: null,
      user_id: 4,
      label: "local",
      capability: "text",
      endpoint_url: "https://example.invalid/v1",
      model_name: "personal-fallback",
      model_ref_id: 9,
      num_ctx: 4_096,
      has_tools: false,
      sees_images: false,
      sees_videos: false,
      supports_structoutput: false,
      strict_role_alternation: false,
      supports_prefix_completion: false,
      supports_assistant_prefill: false,
    } as CustomEndpointRow;
    context.currentPersona.fallback_chain = [{ kind: "custom_endpoint", endpoint }];
    queuedResults.push(
      {
        status: "error",
        streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
        personaResponses: [],
      },
      {
        status: "completed",
        streamResults: [{ status: "completed", accumulatedText: "ok" }],
        personaResponses: [{ personaName: "Tomori", text: "ok", personaId: 10, personaLineageId: 100 }],
      },
    );
    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async () => undefined,
    };

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map(({ model, numCtx }) => ({ model, numCtx }))).toEqual([
      { model: "primary-model", numCtx: 32_768 },
      { model: "personal-fallback", numCtx: 4_096 },
    ]);
    expect(personalSavedConfigLoads).toEqual([{ userId: 4, provider: "custom:42" }]);
  });

  it("falls back from a failed personal text model to the configured server model", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    queuedResults.push(personalRouteFailure(), successfulReply());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary", "server-primary"]);
    // The server route keeps the server's own credentials and the server's whole failover tail,
    // even though both routes name models from the same provider.
    expect(providerConfigCalls).toEqual([
      { model: "personal-primary", apiKey: "personal-key" },
      { model: "server-primary", apiKey: "server-key" },
      { model: "server-fallback", apiKey: "server-key" },
    ]);
    // The server's model spends the server's text quota, and only a later success may consume it.
    expect(textQuotaAdmissions).toEqual([
      { triggerKey: "trigger_1", isPersonaJob: false, userDiscId: "user_1", notifyUser: true },
    ]);
    expect(context.shouldApplyTextQuota).toBe(true);
    expect(context.textQuotaState?.consumed).toBe(false);
    expect(fallbackNoticeCalls).toHaveLength(1);
    expect(fallbackNoticeCalls[0]?.offerPersonalFallbackOptOut).toBe(true);
    expect(fallbackNoticeCalls[0]?.failures).toEqual([
      { modelCodename: "personal-primary", errorDetail: "rate_limit (429)" },
    ]);
  });

  it("keeps a successful personal text turn on its own route", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    queuedResults.push(successfulReply());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    // Building the server pool eagerly would resolve server provider config and take the server's
    // quota admission for a turn that never leaves the personal route.
    expect(providerConfigCalls).toEqual([{ model: "personal-primary", apiKey: "personal-key" }]);
    expect(textQuotaAdmissions).toHaveLength(0);
    expect(context.shouldApplyTextQuota).toBe(false);
    expect(context.textQuotaState).toBeNull();
    expect(fallbackNoticeCalls).toHaveLength(0);
  });

  it("resolves the server route from the persona's server model rather than the personal overlay", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    context.currentPersona.persona_llm = makeLlm(9, "persona-server-model");
    queuedResults.push(personalRouteFailure(), successfulReply());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary", "persona-server-model"]);
  });

  it("withholds the server model fallback when the server requires personal providers", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    context.currentPersona.config.user_byok_mode = true;
    queuedResults.push(personalRouteFailure());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary"]);
    expect(toolLoopCalls[0]?.suppressUserErrors).toBe(false);
    expect(textQuotaAdmissions).toHaveLength(0);
    expect(result.status).toBe("error");
    expect(sink.finalizedResults).toEqual([result]);
  });

  it("skips the server model fallback for an account that turned it off", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    context.turn.userRow.personal_server_fallback_enabled = false;
    queuedResults.push(personalRouteFailure());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary"]);
    expect(providerConfigCalls).toEqual([{ model: "personal-primary", apiKey: "personal-key" }]);
    expect(textQuotaAdmissions).toHaveLength(0);
    expect(context.shouldApplyTextQuota).toBe(false);
    expect(result.status).toBe("error");
  });

  it("keeps the fallback for an account whose preference was never stored", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    context.turn.userRow.personal_server_fallback_enabled = undefined as unknown as boolean;
    queuedResults.push(personalRouteFailure(), successfulReply());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary", "server-primary"]);
  });

  it("refuses the server model fallback when the server's text quota is exhausted", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    textQuotaAdmissionResult = { allowed: false, state: null };
    queuedResults.push(personalRouteFailure());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(textQuotaAdmissions).toHaveLength(1);
    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary"]);
    expect(context.shouldApplyTextQuota).toBe(false);
    expect(result.status).toBe("error");
  });

  it("leaves the personal failure as the outcome when the server route cannot be prepared", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    // A failing quota lookup must not replace the user's own provider error with its own.
    textQuotaAdmissionFailure = new Error("quota lookup unavailable");
    queuedResults.push(personalRouteFailure());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary"]);
    expect(result.status).toBe("error");
    expect(sink.finalizedResults).toEqual([result]);
  });

  it("consumes no quota when the server model fails too", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    queuedResults.push(personalRouteFailure(), personalRouteFailure(), personalRouteFailure());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary", "server-primary", "server-fallback"]);
    expect(context.shouldApplyTextQuota).toBe(true);
    expect(context.textQuotaState?.consumed).toBe(false);
    expect(result.personaResponses).toHaveLength(0);
    expect(fallbackNoticeCalls).toHaveLength(0);
  });

  it("refuses the server model fallback while the server's message cooldown is active", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    cooldownAdmissionResult = false;
    queuedResults.push(personalRouteFailure());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(cooldownAdmissions).toEqual([{ serverDiscId: "server_1", cooldownUserDiscId: "user_1", notifyUser: true }]);
    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary"]);
    // The refusal short-circuits the quota admission: nothing is answered, so nothing is charged.
    expect(textQuotaAdmissions).toHaveLength(0);
    expect(result.status).toBe("error");
  });

  it("admits the server route through the server's cooldown when it is clear", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    queuedResults.push(personalRouteFailure(), successfulReply());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    expect(cooldownAdmissions).toHaveLength(1);
    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary", "server-primary"]);
  });

  it("skips the server cooldown admission for a persona job that shares its group's", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    context.isPersonaJob = true;
    context.turn.lockedTurn.admission.incoming.isPersonaJob = true;
    queuedResults.push(personalRouteFailure(), successfulReply());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    expect(cooldownAdmissions).toHaveLength(0);
    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary", "server-primary"]);
  });

  it("hands the answering route to the rest of the turn once the server takes over", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    queuedResults.push(personalRouteFailure(), successfulReply());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    // The thought-log attribution and the error tips both read these: a server-paid reply must not
    // keep reporting the user's own provider as the payer.
    expect(context.textCredentialSource).toBe("server");
    expect(context.streamingContext.textCredentialSource).toBe("server");
  });

  it("leaves the credential source alone when the personal route answered", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    queuedResults.push(successfulReply());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    expect(context.textCredentialSource).toBe("personal");
    expect(context.streamingContext.textCredentialSource).toBe("personal");
  });

  it("resends a suppressed timeout notice when the server route contributes nothing", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    textQuotaAdmissionResult = { allowed: false, state: null };
    queuedResults.push({
      status: "timeout",
      streamResults: [{ status: "timeout", data: new Error("SDK_CALL_TIMEOUT: provider call timed out.") }],
      personaResponses: [],
    });
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result.status).toBe("timeout");
    // Without this the turn ends in silence: no error result carries a timeout.
    expect(timeoutNotices).toEqual([{ providerName: "google", sawStreamProgress: true }]);
    expect(context.streamingContext.deferredTimeoutNotice).toBeUndefined();
  });

  it("keeps a timeout silent on a server turn that hides its errors", async () => {
    const context = makeContext(makeLlm(1, "server-primary"), makeLlm(2, "server-fallback"));
    context.shouldSurfaceUserErrors = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      queuedResults.push({
        status: "timeout",
        streamResults: [{ status: "timeout", data: new Error("SDK_CALL_TIMEOUT: provider call timed out.") }],
        personaResponses: [],
      });
    }

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, collectingSink());

    expect(result.status).toBe("timeout");
    expect(timeoutNotices).toHaveLength(0);
    expect(context.streamingContext.deferredTimeoutNotice).toBeUndefined();
  });

  it("keeps a timeout silent on a personal turn that hides its errors when the server route refuses", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    context.shouldSurfaceUserErrors = false;
    textQuotaAdmissionResult = { allowed: false, state: null };
    queuedResults.push({
      status: "timeout",
      streamResults: [{ status: "timeout", data: new Error("SDK_CALL_TIMEOUT: provider call timed out.") }],
      personaResponses: [],
    });

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, collectingSink());

    expect(result.status).toBe("timeout");
    expect(timeoutNotices).toHaveLength(0);
    expect(context.streamingContext.deferredTimeoutNotice).toBeUndefined();
  });

  it("keeps the deferred timeout notice for the attempt that the server route replaced", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    queuedResults.push(
      {
        status: "timeout",
        streamResults: [{ status: "timeout", data: new Error("SDK_CALL_TIMEOUT: provider call timed out.") }],
        personaResponses: [],
      },
      successfulReply(),
    );
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result.status).toBe("completed");
    // The server answered, so the personal timeout is superseded rather than reported.
    expect(timeoutNotices).toHaveLength(0);
    expect(context.streamingContext.deferredTimeoutNotice).toBeUndefined();
  });

  it("reports one refused quota for a trigger that runs several persona turns", async () => {
    textQuotaAdmissionResult = { allowed: false, state: null };
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");

    const firstContext = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    firstContext.textQuotaTriggerKey = "trigger_dedupe";
    queuedResults.push(personalRouteFailure());
    await runGenerationTurn(firstContext, collectingSink());

    const secondContext = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    secondContext.textQuotaTriggerKey = "trigger_dedupe";
    queuedResults.push(personalRouteFailure());
    await runGenerationTurn(secondContext, collectingSink());

    expect(textQuotaAdmissions.map((admission) => admission.notifyUser)).toEqual([true, false]);
  });

  it("does not offer the personal fallback opt-out when a personal fallback answered", async () => {
    const primaryModel = makeLlm(1, "personal-primary");
    const fallbackModel = makeLlm(2, "personal-fallback");
    const context = makeContext(primaryModel, fallbackModel);
    context.textCredentialSource = "personal";
    context.personalRoutingUserId = 4;
    personalOverlayState = context.currentPersona;
    queuedResults.push(personalRouteFailure(), successfulReply());
    const sink = collectingSink();

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary", "personal-fallback"]);
    expect(fallbackNoticeCalls).toHaveLength(1);
    expect(fallbackNoticeCalls[0]?.offerPersonalFallbackOptOut).toBe(false);
  });

  it("keeps the server route's model order when only the personal randomizer is on", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    // The personal overlay carries the personal route's own randomizer flag; the server's stays off.
    personalOverlayState = {
      ...(personalOverlayState as TomoriState),
      config: { ...(personalOverlayState as TomoriState).config, model_randomizer_enabled: true },
    } as TomoriState;
    queuedResults.push(personalRouteFailure(), successfulReply());
    const sink = collectingSink();

    // The stub would send the server fallback first if the personal flag reached the server pool.
    await runWithFixedRandom(0.999, async () => {
      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      await runGenerationTurn(context, sink);
    });

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary", "server-primary"]);
  });

  it("draws the server route's leading model from the server's randomizer setting", async () => {
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    context.currentPersona.config.model_randomizer_enabled = true;
    queuedResults.push(personalRouteFailure(), successfulReply());
    const sink = collectingSink();

    await runWithFixedRandom(0.999, async () => {
      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      await runGenerationTurn(context, sink);
    });

    // The draw lands on the last pool member, so only the server's own flag can reorder this pool.
    expect(toolLoopCalls.map((call) => call.model)).toEqual(["personal-primary", "server-fallback"]);
  });

  it("deletes the timed-out primary's partial message when a fallback succeeds", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const fallbackModel = makeLlm(2, "fallback-model");
    const context = makeContext(primaryModel, fallbackModel);

    const deletedWebhookMessageIds: string[] = [];
    (context as unknown as { responseTarget?: unknown }).responseTarget = {
      webhook: {
        deleteMessage: async (messageId: string) => {
          deletedWebhookMessageIds.push(messageId);
        },
      },
    };

    const finalizedResults: GenerationTurnResult[] = [];
    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async (result) => {
        finalizedResults.push(result);
      },
    };

    const fallbackSuccess: GenerationTurnResult = {
      status: "completed",
      streamResults: [{ status: "completed", accumulatedText: "ok" }],
      personaResponses: [
        {
          personaName: "Tomori",
          text: "ok",
          personaId: 10,
          personaLineageId: 100,
        },
      ],
    };
    // Primary times out after flushing one partial webhook message; the fallback completes with its
    // own message. Only the fallback's message should remain in the channel (and the sink).
    queuedResults.push(
      {
        status: "timeout",
        streamResults: [
          { status: "timeout", data: new Error("SDK_CALL_TIMEOUT: provider streamToDiscord call timed out.") },
        ],
        personaResponses: [],
      },
      fallbackSuccess,
    );
    queuedDeliveries.push(
      [{ messageId: "partial_1", channelId: "channel_1", isWebhook: true }],
      [{ messageId: "fallback_1", channelId: "channel_1", isWebhook: true }],
    );

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result).toBe(fallbackSuccess);
    expect(finalizedResults).toEqual([fallbackSuccess]);
    expect(deletedWebhookMessageIds).toEqual(["partial_1"]);
    expect(context.streamingContext.deliveredMessageRefs?.map((ref) => ref.messageId)).toEqual(["fallback_1"]);
  });

  it("does not post fallback notice when fallback is interrupted by a follow-up", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const fallbackModel = makeLlm(2, "fallback-model");
    const context = makeContext(primaryModel, fallbackModel);
    const finalizedResults: GenerationTurnResult[] = [];
    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async (result) => {
        finalizedResults.push(result);
      },
    };

    const interruptedResult: GenerationTurnResult = {
      status: "follow_up_interrupt",
      streamResults: [{ status: "follow_up_interrupt" }],
      personaResponses: [],
    };
    queuedResults.push(
      {
        status: "error",
        streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
        personaResponses: [],
      },
      interruptedResult,
    );

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result).toBe(interruptedResult);
    expect(finalizedResults).toEqual([interruptedResult]);
    expect(fallbackNoticeCalls).toHaveLength(0);
  });

  it("does not post fallback notice when fallback is stopped by a natural stop", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const fallbackModel = makeLlm(2, "fallback-model");
    const context = makeContext(primaryModel, fallbackModel);
    const finalizedResults: GenerationTurnResult[] = [];
    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async (result) => {
        finalizedResults.push(result);
      },
    };

    const stoppedResult: GenerationTurnResult = {
      status: "stopped_by_user",
      streamResults: [{ status: "stopped_by_user", stopReason: "user_request" }],
      personaResponses: [],
    };
    queuedResults.push(
      {
        status: "error",
        streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
        personaResponses: [],
      },
      stoppedResult,
    );

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result).toBe(stoppedResult);
    expect(finalizedResults).toEqual([stoppedResult]);
    expect(fallbackNoticeCalls).toHaveLength(0);
  });

  /**
   * A destination the bot cannot post into fails identically for every key and every model, so
   * spending a generation per remaining arm only to discard it at the same send is waste. A 50001
   * arrives here as error data rather than as a stop, which is the route that used to keep its
   * fallback arms.
   */
  it("abandons the fallback chain when the destination refuses the send for missing access", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const fallbackModel = makeLlm(2, "fallback-model");
    const context = makeContext(primaryModel, fallbackModel);
    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async () => undefined,
    };

    const refusedResult: GenerationTurnResult = {
      status: "error",
      streamResults: [{ status: "error", data: Object.assign(new Error("Missing Access"), { code: 50001 }) }],
      personaResponses: [],
    };
    // Queued behind it so a consumed fallback attempt would be visible rather than silent.
    queuedResults.push(refusedResult, {
      status: "completed",
      streamResults: [{ status: "completed", accumulatedText: "fallback ran" }],
      personaResponses: [],
    });

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    // Abandoning the attempt falls through to the skipped result, and the queued fallback is still
    // there: that is the evidence no second generation was spent.
    expect(result.status).toBe("skipped");
    expect(queuedResults).toHaveLength(1);
    expect(fallbackNoticeCalls).toHaveLength(0);
  });

  it("abandons the fallback chain when the destination is reported as deleted", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const fallbackModel = makeLlm(2, "fallback-model");
    const context = makeContext(primaryModel, fallbackModel);
    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async () => undefined,
    };

    const goneResult: GenerationTurnResult = {
      status: "error",
      streamResults: [{ status: "error", data: Object.assign(new Error("Unknown Channel"), { code: 10003 }) }],
      personaResponses: [],
    };
    queuedResults.push(goneResult, {
      status: "completed",
      streamResults: [{ status: "completed", accumulatedText: "fallback ran" }],
      personaResponses: [],
    });

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result.status).toBe("skipped");
    expect(queuedResults).toHaveLength(1);
    expect(fallbackNoticeCalls).toHaveLength(0);
  });

  it("suppresses completed fallback notice when a follow-up request is already pending", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const fallbackModel = makeLlm(2, "fallback-model");
    const context = makeContext(primaryModel, fallbackModel);
    const finalizedResults: GenerationTurnResult[] = [];
    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async (result) => {
        finalizedResults.push(result);
      },
    };

    const fallbackSuccess: GenerationTurnResult = {
      status: "completed",
      streamResults: [{ status: "completed", accumulatedText: "ok" }],
      personaResponses: [
        {
          personaName: "Tomori",
          text: "ok",
          personaId: 10,
          personaLineageId: 100,
        },
      ],
    };
    queuedResults.push(
      {
        status: "error",
        streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
        personaResponses: [],
      },
      fallbackSuccess,
    );

    const { StreamOrchestrator } = await import("@/utils/discord/streamOrchestrator");
    StreamOrchestrator.requestFollowUp(context.channel.id, context.userDiscId);

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result).toBe(fallbackSuccess);
    expect(finalizedResults).toEqual([fallbackSuccess]);
    expect(fallbackNoticeCalls).toHaveLength(0);
    expect(StreamOrchestrator.hasStopRequest(context.channel.id)).toBe(false);
  });

  it("suppresses completed fallback notice while preserving a pending stop response context", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const fallbackModel = makeLlm(2, "fallback-model");
    const context = makeContext(primaryModel, fallbackModel);
    const finalizedResults: GenerationTurnResult[] = [];
    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async (result) => {
        finalizedResults.push(result);
      },
    };

    const fallbackSuccess: GenerationTurnResult = {
      status: "completed",
      streamResults: [{ status: "completed", accumulatedText: "ok" }],
      personaResponses: [
        {
          personaName: "Tomori",
          text: "ok",
          personaId: 10,
          personaLineageId: 100,
        },
      ],
    };
    queuedResults.push(
      {
        status: "error",
        streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
        personaResponses: [],
      },
      fallbackSuccess,
    );

    const { StreamOrchestrator } = await import("@/utils/discord/streamOrchestrator");
    StreamOrchestrator.requestStop(context.channel.id, context.userDiscId, {
      originalStopMessage: context.message as unknown as Message,
      client: context.client as unknown as Client,
    });

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(result).toBe(fallbackSuccess);
    expect(finalizedResults).toEqual([fallbackSuccess]);
    expect(fallbackNoticeCalls).toHaveLength(0);
    expect(StreamOrchestrator.getAndClearStopContext(context.channel.id)).not.toBeNull();
  });

  // Verbatim prompt scaffolding is decided once, against the primary model, but each attempt runs
  // its own provider and parser. These two cases pin the per-attempt adaptation so a fallback in
  // either direction gets the shape its own adapter understands.
  describe("verbatim tool-calling adaptation across the fallback chain", () => {
    const NUDGE_PROBE = "write the tool call as exactly one Markdown inline code span or fenced code block";

    function contextItemText(item: { parts: Array<{ type: string; text?: string }> }): string {
      return item.parts.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");
    }

    const okSink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async () => undefined,
    };

    const fallbackSuccess: GenerationTurnResult = {
      status: "completed",
      streamResults: [{ status: "completed", accumulatedText: "ok" }],
      personaResponses: [{ personaName: "Tomori", text: "ok", personaId: 10, personaLineageId: 100 }],
    };

    function enqueuePrimaryFailure(): void {
      queuedResults.push({
        status: "error",
        streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
        personaResponses: [],
      });
    }

    it("injects the in-band schemas and the nudge when falling back from a native primary", async () => {
      const context = makeContext(makeLlm(1, "primary-model"), makeLlm(2, "unused-fallback"));
      // A registered custom endpoint whose model opted into verbatim tool calling.
      context.currentPersona.fallback_chain = [
        {
          kind: "llm",
          model: {
            ...makeLlm(9, "local-model"),
            llm_provider: "custom:42",
            has_tools: true,
            verbatim_tool_calling: true,
          } as LlmRow,
        },
      ];
      context.contextItems = [
        { role: "user", parts: [{ type: "text", text: "hello" }], metadataTag: ContextItemTag.DIALOGUE_HISTORY },
        { role: "model", parts: [{ type: "text", text: "hi" }], metadataTag: ContextItemTag.DIALOGUE_HISTORY },
      ] as never;
      enqueuePrimaryFailure();
      queuedResults.push(fallbackSuccess);

      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      await runGenerationTurn(context, okSink);

      expect(toolLoopCalls).toHaveLength(2);
      const fallbackItems = toolLoopCalls[1]?.contextItems ?? [];
      expect(
        fallbackItems.some((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS),
      ).toBe(true);
      expect(fallbackItems.some((item) => contextItemText(item).includes(NUDGE_PROBE))).toBe(true);
      // The native primary's own context stays free of verbatim scaffolding.
      const primaryItems = toolLoopCalls[0]?.contextItems ?? [];
      expect(primaryItems.some((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS)).toBe(
        false,
      );
    });

    it("strips both verbatim halves when falling back from a verbatim custom model to a native one", async () => {
      // A primary that opted into verbatim tool calling, failing over to the native `google` model.
      const verbatimPrimary = {
        ...makeLlm(1, "primary-model"),
        llm_provider: "custom:42",
        has_tools: true,
        verbatim_tool_calling: true,
      } as LlmRow;
      const context = makeContext(verbatimPrimary, makeLlm(2, "native-fallback"));
      // The base context that primary would have produced: the schema dump plus the nudge note.
      context.contextItems = [
        {
          role: "user",
          parts: [{ type: "text", text: "Available tools (JSON): []" }],
          metadataTag: ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS,
        },
        { role: "user", parts: [{ type: "text", text: "hello" }], metadataTag: ContextItemTag.DIALOGUE_HISTORY },
        {
          role: "user",
          parts: [{ type: "text", text: `[System: ${VERBATIM_TOOL_CALLING_NUDGE}]` }],
          metadataTag: ContextItemTag.CONTEXT_NOTE_INJECTION,
        },
        { role: "model", parts: [{ type: "text", text: "hi" }], metadataTag: ContextItemTag.DIALOGUE_HISTORY },
      ] as never;
      enqueuePrimaryFailure();
      queuedResults.push(fallbackSuccess);

      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      await runGenerationTurn(context, okSink);

      const fallbackItems = toolLoopCalls[1]?.contextItems ?? [];
      expect(
        fallbackItems.some((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS),
      ).toBe(false);
      expect(fallbackItems.some((item) => contextItemText(item).includes(NUDGE_PROBE))).toBe(false);
      // The user's own context note shares the tag, so it must survive the strip.
      expect(fallbackItems.some((item) => item.metadataTag === ContextItemTag.DIALOGUE_HISTORY)).toBe(true);
    });

    it("strips a lone verbatim nudge on a native fallback when no schemas were emitted", async () => {
      // Stage 07b drops the schema dump when no tools resolve or resolution throws, while stage 11
      // still writes the nudge. Keying the strip on the dump alone would leave the format
      // instruction on a provider that has no verbatim parser.
      const context = makeContext(makeLlm(1, "primary-model"), makeLlm(2, "native-fallback"));
      context.contextItems = [
        { role: "user", parts: [{ type: "text", text: "hello" }], metadataTag: ContextItemTag.DIALOGUE_HISTORY },
        {
          role: "user",
          parts: [{ type: "text", text: `[System: ${VERBATIM_TOOL_CALLING_NUDGE}]` }],
          metadataTag: ContextItemTag.CONTEXT_NOTE_INJECTION,
        },
        { role: "model", parts: [{ type: "text", text: "hi" }], metadataTag: ContextItemTag.DIALOGUE_HISTORY },
      ] as never;
      enqueuePrimaryFailure();
      queuedResults.push(fallbackSuccess);

      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      await runGenerationTurn(context, okSink);

      const fallbackItems = toolLoopCalls[1]?.contextItems ?? [];
      expect(fallbackItems.some((item) => contextItemText(item).includes(NUDGE_PROBE))).toBe(false);
      expect(fallbackItems.some((item) => item.metadataTag === ContextItemTag.DIALOGUE_HISTORY)).toBe(true);
    });

    it("adds the schema dump without duplicating a nudge the base context already carries", async () => {
      // Verbatim primary -> another verbatim arm: the nudge is already present, so only the dump is
      // missing. Injecting both unconditionally would stack two copies of the instruction.
      const verbatimPrimary = {
        ...makeLlm(1, "primary-model"),
        llm_provider: "custom:42",
        has_tools: true,
        verbatim_tool_calling: true,
      } as LlmRow;
      const context = makeContext(verbatimPrimary, makeLlm(2, "unused-fallback"));
      context.currentPersona.fallback_chain = [
        {
          kind: "llm",
          model: {
            ...makeLlm(9, "local-model"),
            llm_provider: "custom:43",
            has_tools: true,
            verbatim_tool_calling: true,
          } as LlmRow,
        },
      ];
      context.contextItems = [
        {
          role: "user",
          parts: [{ type: "text", text: `[System: ${VERBATIM_TOOL_CALLING_NUDGE}]` }],
          metadataTag: ContextItemTag.CONTEXT_NOTE_INJECTION,
        },
        { role: "user", parts: [{ type: "text", text: "hello" }], metadataTag: ContextItemTag.DIALOGUE_HISTORY },
        { role: "model", parts: [{ type: "text", text: "hi" }], metadataTag: ContextItemTag.DIALOGUE_HISTORY },
      ] as never;
      enqueuePrimaryFailure();
      queuedResults.push(fallbackSuccess);

      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      await runGenerationTurn(context, okSink);

      const fallbackItems = toolLoopCalls[1]?.contextItems ?? [];
      expect(fallbackItems.filter((item) => contextItemText(item).includes(NUDGE_PROBE))).toHaveLength(1);
      expect(
        fallbackItems.some((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS),
      ).toBe(true);
    });
  });
});
