import { createLlmRow, createPersona } from "../../helpers/fixtures";
import * as memberCredentials from "@/modules/supporter-billing/runtime/managedProvider";
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { customEndpointSchema } from "@/types/db/schema";
import { stubGlobalFetch } from "../../helpers/fetchStub";
import type { Client, Message } from "discord.js";
import type { LlmRow, TomoriState } from "@/types/db/schema";
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
import * as realEmbedHelper from "@/utils/discord/embedHelper";
import * as realSupporterRuntime from "@/modules/supporter-billing/runtime";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import { getSupporterRequestFailureCopy } from "@/modules/supporter-billing/discord/requestFailure";
import { ColorCode } from "@/utils/misc/logger";
import { initializeLocalizer } from "@/utils/text/localizer";
import { useEnvSandbox } from "../../helpers/env";
import { localizedProse } from "../../helpers/localeCases";
import * as realStreamOrchestrator from "@/utils/discord/streamOrchestrator";
import * as realPersonalProviderRuntime from "@/utils/provider/personalProviderRuntime";
import * as realProviderFactory from "@/utils/provider/providerFactory";
import * as realCrypto from "@/utils/security/crypto";
import * as realKeyRotation from "@/utils/security/keyRotation";
import * as realToolRegistry from "@/tools/toolRegistry";
import { createScopedModuleMocker, overrideMembers, stubLogMembers } from "../../helpers/mockSurface";
import { VERBATIM_TOOL_CALLING_NUDGE } from "@/utils/tools/verbatimToolCalling";
import { OpenrouterStreamAdapter, type OpenrouterStreamConfig } from "@/providers/openrouter/openrouterStreamAdapter";
import { HumanizerDegree } from "@/types/db/schema";
import type { StreamContext } from "@/types/stream/interfaces";
import { computeSafeInputBudget } from "@/utils/text/contextTruncator";
import { sumTurnUsage } from "@/utils/text/tokenEstimate";

const queuedResults: GenerationTurnResult[] = [];
// Parallel to queuedResults: the delivered-message refs each runToolLoop call should push into the
// shared sink before returning its queued result, simulating messages the stream committed to
// Discord during that attempt. Undefined entries push nothing.
const queuedDeliveries: Array<Array<{ messageId: string; channelId: string; webhookId: string | null }> | undefined> =
  [];
const toolLoopCalls: Array<{
  model: string;
  suppressUserErrors: boolean | undefined;
  contextItems: ToolLoopParams["context"]["contextItems"];
  numCtx: number | null | undefined;
  apiKey: string;
  credentialSource: ChatTurnContext["textCredentialSource"];
  supporterFunding?: ToolLoopParams["supporterFunding"];
}> = [];
const providerConfigCalls: Array<{ model: string; apiKey: string }> = [];
const fallbackNoticeCalls: Array<{
  failures: FallbackNoticeAttempt[];
  successModel: LlmRow;
  offerPersonalFallbackOptOut: boolean | undefined;
}> = [];
const personalSavedConfigLoads: Array<{ userId: number; provider: string }> = [];
const subscriptionNotices: Array<{ titleKey?: string; description?: string }> = [];
const usageRecords: Array<{ sponsorIdentityId: number | null } & realSupporterRuntime.SupporterUsageReport> = [];
const serverSavedConfigLoads: Array<{ serverId: number; provider: string }> = [];
// Flipped off to model a user who has no personal key saved for the provider a
// chain entry belongs to.
let personalKeyAvailable = true;
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
const modelCatalog = new Map<string, LlmRow>();
let channelModel: LlmRow | null = null;
const fundingRequests: Array<Parameters<typeof realSupporterRuntime.resolveSupporterFunding>[0]> = [];
let savedProviderConfigLoadCount = 0;
let decryptApiKeyCount = 0;
let selectApiKeyCount = 0;
let personalOverlayState: TomoriState | null = null;
let serverSupporterFunding: realSupporterRuntime.SupporterFundingContext | null = null;
let rotationEnabled = false;
const rotationSelections: string[] = [];
const rotationChecks: string[] = [];
let fetchStub: ReturnType<typeof stubGlobalFetch>;

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
  "@/utils/discord/embedHelper": realEmbedHelper,
  "@/modules/supporter-billing/runtime": realSupporterRuntime,
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
  getCachedChannelLlm: async () => channelModel,
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
    loadSavedProviderConfig: async (serverId: number, provider: string) => {
      serverSavedConfigLoads.push({ serverId, provider });
      savedProviderConfigLoadCount++;
      return { api_key: Buffer.from("encrypted-key"), key_version: 1 };
    },
    loadUserSavedProviderConfig: async (userId: number, provider: string) => {
      personalSavedConfigLoads.push({ userId, provider });
      return personalKeyAvailable ? { api_key: Buffer.from("personal-encrypted-key"), key_version: 1 } : null;
    },
  }),
  llmModelRepo: overrideMembers(realRepositories.llmModelRepo, {
    loadByProviderAndCodename: async (provider: string, codename: string) => {
      const model = modelCatalog.get(`${provider}:${codename}`);
      return model ?? null;
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

scopedMock.module("@/utils/discord/embedHelper", () => ({
  ...realEmbedHelper,
  sendStandardEmbed: async (
    _channel: unknown,
    _locale: string,
    options: { titleKey?: string; description?: string },
  ) => {
    subscriptionNotices.push(options);
  },
}));

scopedMock.module("@/modules/supporter-billing/runtime", () => ({
  ...realSupporterRuntime,
  recordSupporterUsage: (
    funding: realSupporterRuntime.SupporterFundingContext | null | undefined,
    report: realSupporterRuntime.SupporterUsageReport,
  ) => {
    usageRecords.push({
      sponsorIdentityId: funding?.sponsorIdentityId ?? null,
      ...report,
    });
  },
  resolveSupporterFunding: async (params: Parameters<typeof realSupporterRuntime.resolveSupporterFunding>[0]) => {
    fundingRequests.push(params);
    return serverSupporterFunding
      ? {
          ok: true as const,
          context: serverSupporterFunding,
          state: {} as never,
          config: {} as never,
          tier: {} as never,
        }
      : { ok: false as const, reason: "missing_sponsorship" as const };
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
  decryptApiKey: async (key: Buffer) => {
    decryptApiKeyCount++;
    return key.toString() === "personal-encrypted-key" ? "personal-key" : "server-key";
  },
  encryptApiKey: async () => ({ encrypted: Buffer.from(""), version: 1 }),
  storeOptApiKey: async () => true,
  getOptApiKey: async () => null,
  deleteOptApiKey: async () => true,
  hasOptApiKey: async () => false,
}));

scopedMock.module("@/utils/security/keyRotation", () => ({
  ...realKeyRotation,
  MAX_KEY_ATTEMPTS: 3,
  hasAvailableRotationKey: async (state: TomoriState, excluded: number[] = []) => {
    rotationChecks.push(state.llm.llm_codename);
    return rotationEnabled && !excluded.includes(42);
  },
  recordKeyError: async () => undefined,
  recordKeySuccess: async () => undefined,
  selectApiKey: async (state: TomoriState, excluded: number[] = []) => {
    selectApiKeyCount++;
    rotationSelections.push(state.llm.llm_codename);
    if (!rotationEnabled) return null;
    const rotationKeyId = excluded.includes(41) ? 42 : 41;
    return { apiKey: `server-pool-${rotationKeyId}`, rotationKeyId, isMainKey: false };
  },
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
      apiKey: params.providerConfig.apiKey,
      credentialSource: params.context.textCredentialSource,
      supporterFunding: params.supporterFunding,
    });
    // Simulate this attempt committing messages to the channel before it resolves.
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

function makeLlm(id: number, codename: string, provider = "google"): LlmRow {
  return createLlmRow({
    llm_id: id,
    llm_codename: codename,
    llm_provider: provider,
    has_tools: false,
    sees_images: false,
    sees_videos: false,
    supports_structoutput: false,
  });
}

function makeOpenRouterLlm(id: number, codename: string): LlmRow {
  return {
    ...makeLlm(id, codename),
    llm_provider: "openrouter",
  } as LlmRow;
}

function makeContext(primaryModel: LlmRow, fallbackModel: LlmRow): ChatTurnContext {
  const channel = {
    id: "channel_1",
    isThread: () => false,
  };
  const state = createPersona({
    server_id: 1,
    persona_id: 10,
    persona_lineage_id: 100,
    persona_nickname: "Tomori",
    is_alter: false,
    llm: primaryModel,
    fallback_chain: [{ kind: "llm", model: fallbackModel }],
    config: {
      api_key: Buffer.from("encrypted-key"),
      key_version: 1,
      llm_temperature: 0.7,
      private_channel_ids: [],
      tool_notice_hidden_keys: [],
      user_byok_mode: false,
    },
  });

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

/**
 * Runs a rejected request through the real OpenRouter adapter, so the turn sees the error exactly as
 * a provider HTTP failure arrives rather than a prebuilt subscription denial.
 */
async function openRouterRejection(
  status: number,
  error: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<GenerationTurnResult> {
  fetchStub.mockImplementation(
    (async () => new Response(JSON.stringify({ error }), { status, headers })) as unknown as typeof fetch,
  );
  const config: OpenrouterStreamConfig = {
    model: "openrouter/allowed-primary",
    apiKey: "synthetic-member-key",
    temperature: 0.8,
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
  const streamContext = {
    channel: {},
    client: {},
    tomoriState: {
      persona_nickname: "Tomori",
      trigger_words: [],
      config: { llm_stop_speaker_pattern_enabled: false, llm_stop_strings: null, thinking_level: "none" },
    },
    contextItems: [],
    currentTurnModelParts: [],
    provider: "openrouter",
    locale: "en-US",
  } as unknown as StreamContext;
  try {
    const adapter = new OpenrouterStreamAdapter();
    for await (const chunk of adapter.startStream(config, streamContext)) {
      const processed = adapter.processChunk(chunk);
      if (processed.type === "error") {
        return { status: "error", streamResults: [{ status: "error", data: processed.error }], personaResponses: [] };
      }
    }
  } finally {
    fetchStub.mockImplementation((async () => Response.json({ data: [] })) as unknown as typeof fetch);
  }
  throw new Error("The OpenRouter adapter did not report the rejection");
}

/** An attempt that posted `text` to Discord before failing, as the tool loop reports it. */
function partialFailure(status: "error" | "timeout", text: string): GenerationTurnResult {
  return {
    status,
    streamResults: [
      {
        status,
        data:
          status === "timeout"
            ? new Error("SDK_CALL_TIMEOUT: provider streamToDiscord call timed out.")
            : { type: "rate_limit", code: "429", message: "rate limited" },
        accumulatedText: text,
      },
    ],
    personaResponses: [{ personaName: "Tomori", text, personaId: 10, personaLineageId: 100 }],
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

function makeSupporterFunding(
  overrides: Partial<Extract<NonNullable<ChatTurnContext["supporterFunding"]>, { fundingScope: "server" }>> = {},
) {
  return {
    credentialSource: "supporter" as const,

    fundingScope: "server" as const,
    capability: "text" as const,
    personalUserId: null,
    provider: "openrouter" as const,
    modelCodename: "openrouter/allowed-primary",

    tierKey: "test_tier",
    sponsorshipId: 40,
    serverId: 1,
    sponsorIdentityId: 10,
    sponsorDiscordUserId: "sponsor_disc_1",
    entitlementId: 20,
    renewalAt: null,
    ...overrides,
  };
}

function setSupporterEnv(): void {
  process.env.RUN_ENV = "production";
  process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
  process.env.TOMORI_SUPPORTER_CONFIG_JSON = JSON.stringify({
    patreon: {
      campaignId: "campaign_test",
      oauthClientIdEnv: "TOMORI_SUPPORTER_PATREON_CLIENT_ID",
      oauthClientSecretEnv: "TOMORI_SUPPORTER_PATREON_CLIENT_SECRET",
      webhookSecretEnv: "TOMORI_SUPPORTER_PATREON_WEBHOOK_SECRET",
      creatorRefreshTokenEnv: "TOMORI_SUPPORTER_PATREON_CREATOR_REFRESH_TOKEN",
      manageUrl: "https://www.patreon.com/test",
    },
    jobs: {
      reconcileIntervalSeconds: 300,
      manualRefreshCooldownSeconds: 30,
    },
    tiers: {
      test_tier: {
        displayNameKey: "supporter.tiers.test",
        patreonTierIds: ["tier_test"],
        monthlyBudgetMicros: 100000,
        defaultModelByCapability: { text: "openrouter/allowed-primary" },
      },
    },
  });
}

describe("runGenerationTurn fallback behavior", () => {
  useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED", "TOMORI_SUPPORTER_CONFIG_JSON"]);
  beforeAll(async () => initializeLocalizer());
  let memberKeySpy: ReturnType<typeof spyOn<typeof memberCredentials, "resolveSupporterMemberKey">>;
  beforeEach(() => {
    memberKeySpy = spyOn(memberCredentials, "resolveSupporterMemberKey").mockResolvedValue("synthetic-member-key");
  });
  afterEach(() => memberKeySpy.mockRestore());
  afterEach(() => fetchStub.mockRestore());

  it("keeps personal success and failure outside an enabled server rotation pool", async () => {
    for (const outcome of [successfulReply(), personalRouteFailure()]) {
      rotationEnabled = true;
      const context = makePersonalContext(
        makeLlm(1, "server-primary"),
        makeLlm(2, "server-fallback"),
        makeLlm(3, "personal-primary"),
      );
      context.turn.userRow.personal_server_fallback_enabled = false;
      queuedResults.push(outcome);
      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      expect((await runGenerationTurn(context, collectingSink())).status).toBe(outcome.status);
    }
    expect(toolLoopCalls.map((call) => call.apiKey)).toEqual(["personal-key", "personal-key"]);
    expect(rotationSelections).toHaveLength(0);
    expect(rotationChecks).toHaveLength(0);
  });

  it("admits server fallback separately and rotates only its attempts", async () => {
    rotationEnabled = true;
    const context = makePersonalContext(
      makeLlm(1, "server-primary"),
      makeLlm(2, "server-fallback"),
      makeLlm(3, "personal-primary"),
    );
    queuedResults.push(personalRouteFailure(), personalRouteFailure(), successfulReply());
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    expect((await runGenerationTurn(context, collectingSink())).status).toBe("completed");
    expect(toolLoopCalls.map(({ apiKey, credentialSource }) => ({ apiKey, credentialSource }))).toEqual([
      { apiKey: "personal-key", credentialSource: "personal" },
      { apiKey: "server-pool-41", credentialSource: "server" },
      { apiKey: "server-pool-42", credentialSource: "server" },
    ]);
    expect(rotationSelections).not.toContain("personal-primary");
    expect(rotationChecks).not.toContain("personal-primary");
    expect(textQuotaAdmissions).toHaveLength(1);
    expect(cooldownAdmissions).toHaveLength(1);
  });

  beforeEach(async () => {
    fetchStub = stubGlobalFetch(() => Response.json({ data: [] }));
    queuedResults.length = 0;
    queuedDeliveries.length = 0;
    toolLoopCalls.length = 0;
    providerConfigCalls.length = 0;
    fallbackNoticeCalls.length = 0;
    personalSavedConfigLoads.length = 0;
    subscriptionNotices.length = 0;
    usageRecords.length = 0;
    serverSavedConfigLoads.length = 0;
    personalKeyAvailable = true;
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
    serverSupporterFunding = null;
    modelCatalog.clear();
    channelModel = null;
    fundingRequests.length = 0;
    savedProviderConfigLoadCount = 0;
    decryptApiKeyCount = 0;
    selectApiKeyCount = 0;
    rotationEnabled = false;
    rotationSelections.length = 0;
    rotationChecks.length = 0;

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
    const endpoint = customEndpointSchema.parse({
      extra_config: {},
      custom_endpoint_id: 5,
      connection_id: 42,
      server_id: null,
      user_id: 4,
      label: "local",
      capability: "text",
      api_style: "openai-compatible",
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
    });
    context.currentPersona.fallback_chain = [{ kind: "custom_endpoint", endpoint }];
    context.textCredentialSource = "personal";
    context.personalRoutingUserId = 4;
    personalOverlayState = context.currentPersona;
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

  for (const deferred of [false, true]) {
    it.each([
      { scope: "the owning server", serverId: 1, userId: null, allowed: true },
      { scope: "a personal account", serverId: null, userId: 4, allowed: false },
      { scope: "another server", serverId: 2, userId: null, allowed: false },
    ])(`${deferred ? "deferred" : "initial"} server fallback checks an endpoint owned by $scope before loading credentials`, async ({
      serverId,
      userId,
      allowed,
    }) => {
      const primary = makeLlm(1, "server-primary");
      const fallback = makeLlm(2, "unused-fallback");
      const context = deferred
        ? makePersonalContext(primary, fallback, makeLlm(3, "personal-primary"))
        : makeContext(primary, fallback);
      const endpoint = customEndpointSchema.parse({
        extra_config: {},
        custom_endpoint_id: 5,
        connection_id: 42,
        server_id: serverId,
        user_id: userId,
        label: "local",
        capability: "text",
        api_style: "openai-compatible",
        endpoint_url: "https://example.invalid/v1",
        model_name: "custom-fallback",
        model_ref_id: 9,
      });
      context.currentPersona.fallback_chain = [{ kind: "custom_endpoint", endpoint }];
      if (deferred) queuedResults.push(personalRouteFailure());
      queuedResults.push(personalRouteFailure(), successfulReply());

      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      await runGenerationTurn(context, collectingSink());

      const expectedModels = deferred ? ["personal-primary", "server-primary"] : ["server-primary"];
      if (allowed) expectedModels.push("custom-fallback");
      expect(toolLoopCalls.map((call) => call.model)).toEqual(expectedModels);
      expect(personalSavedConfigLoads).toEqual([]);
      expect(serverSavedConfigLoads).toEqual(allowed ? [{ serverId: 1, provider: "custom:42" }] : []);
      expect(toolLoopCalls.filter((call) => call.model === "custom-fallback")).toEqual(
        allowed ? [expect.objectContaining({ credentialSource: "server", apiKey: "server-key" })] : [],
      );
    });
  }

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
    expect(context as Pick<ChatTurnContext, "textCredentialSource">).toMatchObject({ textCredentialSource: "server" });
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

  it("resolves a cross-provider fallback against the user's key on a personal-routed turn", async () => {
    const context = makeContext(makeLlm(1, "primary-model"), makeLlm(2, "deepseek-fallback", "deepseek"));
    context.textCredentialSource = "personal";
    (context as unknown as { personalRoutingUserId: number }).personalRoutingUserId = 4;
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

    expect(toolLoopCalls.map((call) => call.model)).toEqual(["primary-model", "deepseek-fallback"]);
    // The server's saved DeepSeek config must never be consulted here, or the
    // user's chain would spend the server owner's key.
    expect(personalSavedConfigLoads).toEqual([{ userId: 4, provider: "deepseek" }]);
    expect(selectApiKeyCount).toBe(0);
  });

  it("skips a cross-provider fallback the user has no personal key for", async () => {
    const context = makeContext(makeLlm(1, "primary-model"), makeLlm(2, "deepseek-fallback", "deepseek"));
    context.textCredentialSource = "personal";
    (context as unknown as { personalRoutingUserId: number }).personalRoutingUserId = 4;
    personalKeyAvailable = false;
    const emittedErrors: unknown[] = [];
    queuedResults.push({
      status: "error",
      streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
      personaResponses: [],
    });
    const sink: ChatResponseSink = {
      emitStreamResult: async (result) => {
        emittedErrors.push(result);
      },
      emitError: async (error) => {
        emittedErrors.push(error);
      },
      finalize: async () => undefined,
    };

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, sink);

    // Only the primary runs: the unusable entry leaves the pool rather than
    // falling through to the server's key.
    expect(toolLoopCalls.map((call) => call.model)).toEqual(["primary-model"]);
    expect(personalSavedConfigLoads).toEqual([{ userId: 4, provider: "deepseek" }]);
    expect(emittedErrors).toHaveLength(1);
    expect(fallbackNoticeCalls).toHaveLength(0);
  });

  it("continues the timed-out primary's posted text on the fallback model instead of deleting it", async () => {
    const primaryModel = makeLlm(1, "primary-model");
    const fallbackModel = {
      ...makeLlm(2, "claude-haiku-4-5", "anthropic"),
      supports_assistant_prefill: true,
    } as LlmRow;
    const context = makeContext(primaryModel, fallbackModel);
    const deleteMessage = mock(async () => undefined);
    (context as unknown as { responseTarget?: unknown }).responseTarget = {
      webhook: { id: "webhook_1", token: "synthetic_token", deleteMessage },
    };
    const sink = collectingSink();
    const primaryFailure = partialFailure("timeout", "First half.");
    primaryFailure.streamResults[0].usage = { inputTokens: 900, outputTokens: 30 };
    const fallbackReply = successfulReply("second half.");
    fallbackReply.streamResults[0].usage = { inputTokens: 950, outputTokens: 20 };
    queuedResults.push(primaryFailure, fallbackReply);
    queuedDeliveries.push(
      [{ messageId: "partial_1", channelId: "channel_1", webhookId: "webhook_1" }],
      [{ messageId: "fallback_1", channelId: "channel_1", webhookId: "webhook_1" }],
    );

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(toolLoopCalls[0]?.contextItems.some((item) => item.role === "model")).toBe(false);
    expect(toolLoopCalls[1]?.contextItems.at(-1)).toMatchObject({
      role: "model",
      parts: [{ type: "text", text: "Tomori: First half." }],
    });
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(context.streamingContext.deliveredMessageRefs?.map((ref) => ref.messageId)).toEqual([
      "partial_1",
      "fallback_1",
    ]);
    expect(sink.finalizedResults).toEqual([result]);
    expect(result.status).toBe("completed");
    expect(result.personaResponses[0]?.text).toBe("First half.\nsecond half.");
    expect(result.streamResults.map((stream) => stream.accumulatedText)).toEqual(["First half.", "second half."]);
    // Post-turn stats record every usage entry under the final model, so the primary's must not ride along.
    expect(sumTurnUsage(result.streamResults)).toEqual({ inputTokens: 950, outputTokens: 20 });
  });

  it("trims history so the fallback request still fits its budget with the continuation added", async () => {
    const limitedModel = (id: number, codename: string) =>
      ({
        ...makeLlm(id, codename, "anthropic"),
        supports_assistant_prefill: true,
        context_window: 2000,
      }) as LlmRow;
    const context = makeContext(limitedModel(1, "claude-haiku-4-5"), limitedModel(2, "claude-haiku-4-5-fallback"));
    context.currentPersona.config.llm_max_output_tokens = 200;
    const historyLine = "Juno: ".padEnd(400, "a");
    context.contextItems = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("model" as const),
      parts: [{ type: "text" as const, text: `${index} ${historyLine}` }],
      metadataTag: ContextItemTag.DIALOGUE_HISTORY,
    }));
    const trigger = { role: "user" as const, parts: [{ type: "text" as const, text: "Juno: keep going" }] };
    context.contextItems.push({ ...trigger, metadataTag: ContextItemTag.DIALOGUE_HISTORY });
    queuedResults.push(partialFailure("timeout", "b".repeat(2400)), successfulReply("done."));

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, collectingSink());

    const fallbackRequest = toolLoopCalls[1]?.contextItems ?? [];
    const estimatedTokens = Math.floor(
      fallbackRequest
        .flatMap((item) => item.parts)
        .reduce((chars, part) => chars + (part.type === "text" ? part.text.length : 0), 0) / 4,
    );
    expect(estimatedTokens).toBeLessThanOrEqual(computeSafeInputBudget(2000, 200));
    expect(fallbackRequest.at(-2)).toMatchObject(trigger);
    expect(fallbackRequest.at(-1)?.role).toBe("model");
  });

  it("continues a failed key's posted text on the rotated key, as an instruction when the model blocks prefill", async () => {
    rotationEnabled = true;
    const primaryModel = makeLlm(1, "claude-sonnet-4-6", "anthropic");
    const context = makeContext(primaryModel, makeLlm(2, "unused-fallback"));
    const sink = collectingSink();
    queuedResults.push(partialFailure("error", "First half."), successfulReply("second half."));

    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);

    expect(toolLoopCalls.map((call) => ({ model: call.model, apiKey: call.apiKey }))).toEqual([
      { model: "claude-sonnet-4-6", apiKey: "server-pool-41" },
      { model: "claude-sonnet-4-6", apiKey: "server-pool-42" },
    ]);
    const retryContext = toolLoopCalls[1]?.contextItems ?? [];
    expect(retryContext.some((item) => item.role === "model")).toBe(false);
    expect(JSON.stringify(retryContext.at(-1)?.parts)).toContain("Tomori: First half.");
    expect(context.streamingContext.outputPrefill).toBe("Tomori: First half.");
    expect(sink.emittedErrors).toHaveLength(0);
    expect(result.personaResponses[0]?.text).toBe("First half.\nsecond half.");
  });

  it("completes with the posted text when the continuation has nothing to add", async () => {
    for (const [data, status] of [
      [undefined, "completed"],
      [{ finishReason: "length" }, "empty_response"],
    ] as const) {
      toolLoopCalls.length = 0;
      const context = makeContext(makeLlm(1, "primary-model"), makeLlm(2, "fallback-model"));
      queuedResults.push(partialFailure("timeout", "Only half."), {
        status: "empty_response",
        streamResults: [{ status: "empty_response", data }],
        personaResponses: [],
      });

      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      const result = await runGenerationTurn(context, collectingSink());

      expect(toolLoopCalls).toHaveLength(2);
      expect(result.status).toBe(status);
      expect(result.personaResponses[0]?.text).toBe("Only half.");
    }
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
  it("routes Supporter turns through managed OpenRouter and filters deprecated fallbacks before provider calls", async () => {
    setSupporterEnv();
    serverSupporterFunding = makeSupporterFunding();
    const primaryModel = makeOpenRouterLlm(101, "openrouter/allowed-primary");
    const allowedFallback = makeOpenRouterLlm(102, "openrouter/allowed-fallback");
    const disallowedFallback = { ...makeOpenRouterLlm(103, "openrouter/disallowed"), is_deprecated: true };
    modelCatalog.set("openrouter:openrouter/allowed-primary", primaryModel);

    const context = makeContext(primaryModel, allowedFallback);
    context.textCredentialSource = "supporter";
    context.supporterFunding = makeSupporterFunding();
    context.currentPersona = {
      ...context.currentPersona,
      fallback_chain: [
        { kind: "llm", model: disallowedFallback, credentialProvider: "supporter" },
        { kind: "llm", model: allowedFallback, credentialProvider: "supporter" },
      ],
      config: {
        ...context.currentPersona.config,
        api_key: Buffer.from("encrypted-server-key"),
        model_randomizer_enabled: true,
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

    const sink: ChatResponseSink = {
      emitStreamResult: async () => undefined,
      emitError: async () => undefined,
      finalize: async () => undefined,
    };
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const originalRandom = Math.random;
    Math.random = () => 0;
    let result: GenerationTurnResult;
    try {
      result = await runGenerationTurn(context, sink);
    } finally {
      Math.random = originalRandom;
    }

    expect(result).toBe(fallbackSuccess);
    expect(toolLoopCalls.map((call) => call.model)).toEqual([
      "openrouter/allowed-primary",
      "openrouter/allowed-fallback",
    ]);
    expect(providerConfigCalls).toEqual([
      { model: "openrouter/allowed-primary", apiKey: "synthetic-member-key" },
      { model: "openrouter/allowed-fallback", apiKey: "synthetic-member-key" },
    ]);
    expect(savedProviderConfigLoadCount).toBe(0);
    expect(decryptApiKeyCount).toBe(0);
    expect(selectApiKeyCount).toBe(0);
  });
  it("skips other models on a truly exhausted allowance and uses a saved server provider", async () => {
    setSupporterEnv();
    const primary = makeOpenRouterLlm(101, "openrouter/allowed-primary");
    const sharedFallback = makeOpenRouterLlm(102, "openrouter/shared-fallback");
    const byokFallback = makeLlm(103, "byok-fallback");
    modelCatalog.set("openrouter:openrouter/allowed-primary", primary);
    const context = makeContext(primary, sharedFallback);
    context.currentPersona.fallback_chain = [{ kind: "llm", model: sharedFallback, credentialProvider: "supporter" }];
    context.currentPersona.fallback_chain?.push({ kind: "llm", model: byokFallback });
    context.textCredentialSource = "supporter";
    context.supporterFunding = makeSupporterFunding();
    const denied = new SupporterRequestDeniedError("allowance_exhausted", { periodEnd: new Date("2026-02-01") });
    queuedResults.push(
      { status: "error", streamResults: [{ status: "error", data: denied }], personaResponses: [] },
      successfulReply(),
    );
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, collectingSink());
    expect(toolLoopCalls.map((call) => call.model)).toEqual([primary.llm_codename, byokFallback.llm_codename]);
    expect(context).toMatchObject({ textCredentialSource: "server" });
    expect(subscriptionNotices).toEqual([]);
    expect(fallbackNoticeCalls).toEqual([
      expect.objectContaining({
        successModel: byokFallback,
        failures: [
          {
            modelCodename: primary.llm_codename,
            errorDetail: expect.stringMatching(
              localizedProse(context.locale, "commands.subscribe.request.allowance_reason"),
            ),
          },
        ],
      }),
    ]);
  });

  it("maps an OpenRouter key-limit rejection to the exhaustion notice and configured fallback", async () => {
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    for (const status of [402, 403]) {
      setSupporterEnv();
      toolLoopCalls.length = 0;
      subscriptionNotices.length = 0;
      fallbackNoticeCalls.length = 0;
      const primary = makeOpenRouterLlm(101, "openrouter/allowed-primary");
      const sharedFallback = makeOpenRouterLlm(102, "openrouter/shared-fallback");
      const byokFallback = makeLlm(103, "byok-fallback");
      modelCatalog.set("openrouter:openrouter/allowed-primary", primary);
      const context = makeContext(primary, sharedFallback);
      context.currentPersona.fallback_chain = [
        { kind: "llm", model: sharedFallback, credentialProvider: "supporter" },
        { kind: "llm", model: byokFallback },
      ];
      context.textCredentialSource = "supporter";
      context.supporterFunding = makeSupporterFunding({ renewalAt: new Date("2026-11-01T00:00:00Z") });
      queuedResults.push(
        await openRouterRejection(status, {
          code: status,
          message: "Key limit exceeded",
          metadata: { limit_source: "openrouter_key_limit" },
        }),
        successfulReply(),
      );
      expect((await runGenerationTurn(context, collectingSink())).status).toBe("completed");
      expect(toolLoopCalls.map((call) => call.model)).toEqual([primary.llm_codename, byokFallback.llm_codename]);
      expect(subscriptionNotices).toEqual([]);
      expect(fallbackNoticeCalls).toHaveLength(1);
      expect(fallbackNoticeCalls[0]?.failures[0]?.errorDetail).toMatch(
        localizedProse(context.locale, "commands.subscribe.request.allowance_reason"),
      );
    }
  });

  it("does not classify an unlabelled OpenRouter 402 as subscription exhaustion", async () => {
    setSupporterEnv();
    const primary = makeOpenRouterLlm(101, "openrouter/allowed-primary");
    const sharedFallback = makeOpenRouterLlm(102, "openrouter/shared-fallback");
    modelCatalog.set("openrouter:openrouter/allowed-primary", primary);
    const context = makeContext(primary, sharedFallback);
    context.currentPersona.fallback_chain = [{ kind: "llm", model: sharedFallback, credentialProvider: "supporter" }];
    context.textCredentialSource = "supporter";
    context.supporterFunding = makeSupporterFunding();
    serverSupporterFunding = makeSupporterFunding();
    queuedResults.push(
      await openRouterRejection(402, {
        code: 402,
        message: "This request requires more credits, or fewer max_tokens.",
      }),
      successfulReply(),
    );
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    expect((await runGenerationTurn(context, collectingSink())).status).toBe("completed");
    expect(toolLoopCalls.map((call) => call.model)).toEqual([primary.llm_codename, sharedFallback.llm_codename]);
    expect(subscriptionNotices).toEqual([]);
  });

  it("treats operator capacity as distinct from exhaustion and still tries a cheaper funded fallback", async () => {
    setSupporterEnv();
    const primary = makeOpenRouterLlm(101, "openrouter/allowed-primary");
    const sharedFallback = makeOpenRouterLlm(102, "openrouter/shared-fallback");
    const byokFallback = makeLlm(103, "byok-fallback");
    modelCatalog.set("openrouter:openrouter/allowed-primary", primary);
    const context = makeContext(primary, sharedFallback);
    context.currentPersona.fallback_chain = [
      { kind: "llm", model: sharedFallback, credentialProvider: "supporter" },
      { kind: "llm", model: byokFallback },
    ];
    context.textCredentialSource = "supporter";
    context.supporterFunding = makeSupporterFunding();
    queuedResults.push(
      await openRouterRejection(
        402,
        { code: 402, message: "Insufficient credits", metadata: { limit_source: "openrouter_in_flight_budget" } },
        { "Retry-After": "120" },
      ),
      successfulReply(),
    );
    serverSupporterFunding = makeSupporterFunding();
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    expect((await runGenerationTurn(context, collectingSink())).status).toBe("completed");
    expect(toolLoopCalls.map((call) => call.model)).toEqual([primary.llm_codename, sharedFallback.llm_codename]);
    expect(subscriptionNotices).toEqual([]);
    expect(fallbackNoticeCalls[0]?.failures[0]?.errorDetail).toMatch(
      localizedProse(context.locale, "commands.subscribe.request.capacity_reason"),
    );
  });

  it("waits out a short in-flight Retry-After and retries the same subscription attempt", async () => {
    setSupporterEnv();
    const primary = makeOpenRouterLlm(101, "openrouter/allowed-primary");
    modelCatalog.set("openrouter:openrouter/allowed-primary", primary);
    const context = makeContext(primary, makeLlm(103, "byok-fallback"));
    context.textCredentialSource = "supporter";
    context.supporterFunding = makeSupporterFunding();
    queuedResults.push(
      await openRouterRejection(
        402,
        { code: 402, message: "Insufficient credits", metadata: { limit_source: "openrouter_in_flight_budget" } },
        { "Retry-After": "0.01" },
      ),
      successfulReply(),
    );
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    expect((await runGenerationTurn(context, collectingSink())).status).toBe("completed");
    expect(toolLoopCalls.map(({ model, apiKey }) => ({ model, apiKey }))).toEqual([
      { model: primary.llm_codename, apiKey: "synthetic-member-key" },
      { model: primary.llm_codename, apiKey: "synthetic-member-key" },
    ]);
    expect(subscriptionNotices).toEqual([]);
  });

  it("records each attempt's reported cost and tokens under the funding that paid for it", async () => {
    setSupporterEnv();
    const primary = makeOpenRouterLlm(101, "openrouter/allowed-primary");
    const byokFallback = makeLlm(103, "byok-fallback");
    modelCatalog.set("openrouter:openrouter/allowed-primary", primary);
    const context = makeContext(primary, byokFallback);
    context.textCredentialSource = "supporter";
    context.supporterFunding = makeSupporterFunding();
    queuedResults.push(
      {
        status: "error",
        streamResults: [
          { status: "completed", usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.001 } },
          { status: "error", data: new Error("tool continuation failed"), usage: undefined },
        ],
        personaResponses: [],
      },
      {
        ...successfulReply(),
        streamResults: [
          { status: "completed", accumulatedText: "ok", usage: { inputTokens: 5, outputTokens: 1, costUsd: 0.5 } },
        ],
      },
    );
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    expect((await runGenerationTurn(context, collectingSink())).status).toBe("completed");
    expect(toolLoopCalls.map((call) => call.supporterFunding?.sponsorIdentityId)).toEqual([10, undefined]);
    expect(usageRecords.filter((record) => record.costUsd !== undefined)).toEqual([
      { sponsorIdentityId: 10, modelCodename: primary.llm_codename, costUsd: 0.001, inputTokens: 10, outputTokens: 2 },
      {
        sponsorIdentityId: null,
        modelCodename: byokFallback.llm_codename,
        costUsd: 0.5,
        inputTokens: 5,
        outputTokens: 1,
      },
    ]);
  });

  it("uses the scoped OpenRouter BYOK fallback after a member allowance denial", async () => {
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    for (const personal of [false, true]) {
      setSupporterEnv();
      const primary = makeOpenRouterLlm(101, "openrouter/allowed-primary");
      modelCatalog.set("openrouter:openrouter/allowed-primary", primary);
      const context = makeContext(primary, primary);
      context.textCredentialSource = "supporter";
      context.supporterFunding = personal
        ? {
            ...makeSupporterFunding(),
            fundingScope: "personal",
            personalUserId: 91,
            sponsorshipId: null,
            serverId: null,
          }
        : makeSupporterFunding();
      context.currentPersona.fallback_chain = [{ kind: "llm", model: primary }];
      if (personal) {
        context.personalRoutingUserId = 91;
        context.turn.userRow.personal_server_fallback_enabled = false;
        personalOverlayState = context.currentPersona;
      }
      const before = toolLoopCalls.length;
      queuedResults.push(
        {
          status: "error",
          streamResults: [{ status: "error", data: new SupporterRequestDeniedError("allowance_exhausted") }],
          personaResponses: [],
        },
        successfulReply(),
      );
      expect((await runGenerationTurn(context, collectingSink())).status).toBe("completed");
      expect(toolLoopCalls.slice(before).map(({ apiKey, credentialSource }) => ({ apiKey, credentialSource }))).toEqual(
        [
          { apiKey: "synthetic-member-key", credentialSource: "supporter" },
          { apiKey: personal ? "personal-key" : "server-key", credentialSource: personal ? "personal" : "server" },
        ],
      );
      if (personal) expect(personalSavedConfigLoads.at(-1)).toEqual({ userId: 91, provider: "openrouter" });
      else
        expect(serverSavedConfigLoads.at(-1)).toEqual({
          serverId: context.currentPersona.server_id,
          provider: "openrouter",
        });
    }
  });

  it("keeps a promoted BYOK entry on its own key when both entries name the same OpenRouter model", async () => {
    setSupporterEnv();
    const primary = makeOpenRouterLlm(101, "openrouter/allowed-primary");
    modelCatalog.set("openrouter:openrouter/allowed-primary", primary);
    const context = makeContext(primary, primary);
    context.textCredentialSource = "supporter";
    context.supporterFunding = makeSupporterFunding();
    context.currentPersona.config.model_randomizer_enabled = true;
    queuedResults.push(successfulReply());
    const random = spyOn(Math, "random").mockReturnValue(0.99);
    try {
      const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
      expect((await runGenerationTurn(context, collectingSink())).status).toBe("completed");
      expect(toolLoopCalls.map(({ apiKey, credentialSource }) => ({ apiKey, credentialSource }))).toEqual([
        { apiKey: "server-key", credentialSource: "server" },
      ]);
    } finally {
      random.mockRestore();
    }
  });

  it("resolves explicitly selected subscription fallbacks after a BYOK primary", async () => {
    setSupporterEnv();
    const primary = makeOpenRouterLlm(101, "openrouter/allowed-primary");
    const context = makeContext(primary, primary);
    context.currentPersona.fallback_chain = [{ kind: "llm", model: primary, credentialProvider: "supporter" }];
    serverSupporterFunding = makeSupporterFunding();
    queuedResults.push(personalRouteFailure(), successfulReply());
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    expect((await runGenerationTurn(context, collectingSink())).status).toBe("completed");
    expect(toolLoopCalls.map(({ apiKey, credentialSource }) => ({ apiKey, credentialSource }))).toEqual([
      { apiKey: "server-key", credentialSource: "server" },
      { apiKey: "synthetic-member-key", credentialSource: "supporter" },
    ]);
  });

  it("never substitutes a saved BYOK key without a configured fallback", async () => {
    setSupporterEnv();
    const primary = makeOpenRouterLlm(101, "openrouter/allowed-primary");
    modelCatalog.set("openrouter:openrouter/allowed-primary", primary);
    const context = makeContext(primary, primary);
    context.textCredentialSource = "supporter";
    context.supporterFunding = makeSupporterFunding();
    context.currentPersona.fallback_chain = [];
    queuedResults.push({
      status: "error",
      streamResults: [{ status: "error", data: new SupporterRequestDeniedError("allowance_exhausted") }],
      personaResponses: [],
    });
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    expect((await runGenerationTurn(context, collectingSink())).status).toBe("error");
    expect(toolLoopCalls).toHaveLength(1);
    expect(savedProviderConfigLoadCount).toBe(0);
  });

  it("funds the effective persona or channel override through its own model admission", async () => {
    setSupporterEnv();
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const primary = makeOpenRouterLlm(101, "openrouter/allowed-primary");
    const channelOverride = makeOpenRouterLlm(102, "openrouter/channel-model");
    const personaOverride = makeOpenRouterLlm(103, "openrouter/persona-model");
    for (const personaWins of [true, false]) {
      toolLoopCalls.length = 0;
      fundingRequests.length = 0;
      channelModel = channelOverride;
      const selected = personaWins ? personaOverride : channelOverride;
      const context = makeContext(primary, primary);
      context.currentPersona.fallback_chain = undefined;
      context.currentPersona.persona_llm = personaWins ? personaOverride : undefined;
      context.currentPersona.config.subscription_capabilities = ["text"];
      context.textCredentialSource = "supporter";
      context.supporterFunding = makeSupporterFunding();
      serverSupporterFunding = makeSupporterFunding({ modelCodename: selected.llm_codename });
      queuedResults.push(successfulReply());
      expect((await runGenerationTurn(context, collectingSink())).status).toBe("completed");
      expect(toolLoopCalls.map((call) => [call.model, call.apiKey])).toEqual([
        [selected.llm_codename, "synthetic-member-key"],
      ]);
      expect(fundingRequests.map((request) => request.requestedModelCodename)).toEqual([selected.llm_codename]);
    }
  });

  it("uses a cross-provider persona override on server BYOK instead of sponsor funding", async () => {
    setSupporterEnv();
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const primary = makeOpenRouterLlm(101, "openrouter/allowed-primary");
    const override = makeLlm(102, "native-persona");
    const context = makeContext(primary, primary);
    context.currentPersona.fallback_chain = undefined;
    context.currentPersona.persona_llm = override;
    context.currentPersona.config.subscription_capabilities = ["text"];
    context.textCredentialSource = "supporter";
    context.supporterFunding = makeSupporterFunding();
    queuedResults.push(successfulReply());
    expect((await runGenerationTurn(context, collectingSink())).status).toBe("completed");
    expect(toolLoopCalls.map((call) => [call.model, call.apiKey, call.credentialSource])).toEqual([
      ["native-persona", "server-key", "server"],
    ]);
    expect(fundingRequests).toHaveLength(0);
  });

  it("allows personal BYOK fallback only to the same user's own DM workspace", async () => {
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const primary = makeLlm(101, "personal-primary");
    const fallback = makeLlm(102, "workspace-fallback");
    const context = makeContext(fallback, fallback);
    context.textCredentialSource = "personal";
    context.personalRoutingUserId = 4;
    context.personalTextProvider = "google";
    context.isDMChannel = true;
    context.serverDiscId = context.userDiscId;
    personalOverlayState = { ...context.currentPersona, llm: primary, fallback_chain: undefined };
    queuedResults.push(personalRouteFailure(), successfulReply());
    expect((await runGenerationTurn(context, collectingSink())).status).toBe("completed");
    expect(toolLoopCalls.map((call) => [call.model, call.credentialSource])).toEqual([
      ["personal-primary", "personal"],
      ["workspace-fallback", "server"],
    ]);
  });

  it("tries configured personal BYOK fallback before a server route when the subscription is unavailable", async () => {
    setSupporterEnv();
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const primary = makeOpenRouterLlm(101, "openrouter/unavailable");
    const fallback = makeOpenRouterLlm(102, "openrouter/personal-fallback");
    const context = makeContext(makeLlm(103, "server-primary"), fallback);
    context.textCredentialSource = "personal";
    context.personalRoutingUserId = 4;
    context.personalTextProvider = "supporter";
    context.currentPersona.config.user_byok_mode = true;
    personalOverlayState = {
      ...context.currentPersona,
      llm: primary,
      config: { ...context.currentPersona.config, api_key: null },
      fallback_chain: [{ kind: "llm", model: fallback, credentialProvider: "openrouter" }],
    };
    queuedResults.push(successfulReply());
    expect((await runGenerationTurn(context, collectingSink())).status).toBe("completed");
    expect(toolLoopCalls.map((call) => [call.model, call.apiKey, call.credentialSource])).toEqual([
      ["openrouter/personal-fallback", "personal-key", "personal"],
    ]);
    expect(textQuotaAdmissions).toHaveLength(0);
  });

  it("reports failed personal exhaustion fallback without borrowing server credentials in a DM", async () => {
    setSupporterEnv();
    const primary = makeOpenRouterLlm(101, "openrouter/allowed-primary");
    const context = makeContext(primary, makeLlm(103, "unfunded-fallback"));
    modelCatalog.set("openrouter:openrouter/allowed-primary", primary);
    context.textCredentialSource = "supporter";
    context.personalRoutingUserId = 4;
    context.isDMChannel = true;
    context.supporterFunding = {
      ...makeSupporterFunding(),
      fundingScope: "personal",
      personalUserId: 4,
      sponsorshipId: null,
      serverId: null,
    };
    const denied = new SupporterRequestDeniedError(
      "allowance_exhausted",
      { periodEnd: new Date("2026-02-01") },
      "text",
      "personal",
    );
    queuedResults.push({ status: "error", streamResults: [{ status: "error", data: denied }], personaResponses: [] });
    personalOverlayState = context.currentPersona;
    personalKeyAvailable = false;
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, collectingSink());
    expect(toolLoopCalls).toHaveLength(1);
    expect(personalSavedConfigLoads).toEqual([{ userId: 4, provider: "google" }]);
    expect(savedProviderConfigLoadCount).toBe(0);
    expect(selectApiKeyCount).toBe(0);
    expect(subscriptionNotices).toEqual([
      expect.objectContaining(getSupporterRequestFailureCopy(denied, context.locale, false)),
    ]);
  });

  it("checks a deferred server sponsor separately and skips an exhausted subscriber", async () => {
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    setSupporterEnv();
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    const personalPrimary = makeOpenRouterLlm(101, "openrouter/allowed-primary");
    const serverPrimary = makeOpenRouterLlm(102, "openrouter/server-primary");
    const byokFallback = makeLlm(103, "server-byok-fallback");
    modelCatalog.set("openrouter:openrouter/allowed-primary", personalPrimary);
    for (const sameSubscriber of [true, false]) {
      toolLoopCalls.length = 0;
      subscriptionNotices.length = 0;
      const context = makeContext(serverPrimary, byokFallback);
      context.currentPersona.config.subscription_capabilities = ["text"];
      context.textCredentialSource = "supporter";
      context.personalRoutingUserId = 4;
      context.supporterFunding = {
        ...makeSupporterFunding(),
        fundingScope: "personal",
        personalUserId: 4,
        sponsorshipId: null,
        serverId: null,
      };
      personalOverlayState = { ...context.currentPersona, llm: personalPrimary, fallback_chain: undefined };
      serverSupporterFunding = {
        ...makeSupporterFunding(),
        modelCodename: serverPrimary.llm_codename,
        sponsorIdentityId: sameSubscriber ? 10 : 11,
      };
      queuedResults.push(
        {
          status: "error",
          streamResults: [{ status: "error", data: new SupporterRequestDeniedError("allowance_exhausted") }],
          personaResponses: [],
        },
        successfulReply(),
      );
      const result = await runGenerationTurn(context, collectingSink());
      expect(result.status).toBe("completed");
      expect(toolLoopCalls.map((call) => call.model)).toEqual([
        personalPrimary.llm_codename,
        sameSubscriber ? byokFallback.llm_codename : serverPrimary.llm_codename,
      ]);
      expect(context).toMatchObject({ textCredentialSource: sameSubscriber ? "server" : "supporter" });
      expect(subscriptionNotices).toEqual([]);
    }
  });

  it("reports failed fallback once after an allowance denial and a rejected BYOK attempt", async () => {
    setSupporterEnv();
    const primary = makeOpenRouterLlm(101, "openrouter/allowed-primary");
    const fallback = makeLlm(102, "byok-fallback");
    modelCatalog.set("openrouter:openrouter/allowed-primary", primary);
    const context = makeContext(primary, fallback);
    context.textCredentialSource = "supporter";
    context.supporterFunding = makeSupporterFunding();
    const denied = new SupporterRequestDeniedError("allowance_exhausted", { periodEnd: new Date("2026-02-01") });
    queuedResults.push(
      { status: "error", streamResults: [{ status: "error", data: denied }], personaResponses: [] },
      personalRouteFailure(),
    );
    const sink = collectingSink();
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    const result = await runGenerationTurn(context, sink);
    expect(result.status).toBe("error");
    expect(toolLoopCalls.at(-1)?.suppressUserErrors).toBe(true);
    expect(sink.emittedErrors).toHaveLength(0);
    expect(subscriptionNotices).toEqual([
      expect.objectContaining({ ...getSupporterRequestFailureCopy(denied, context.locale), color: ColorCode.ERROR }),
    ]);
  });

  it("reports one red allowance error when the configured fallback times out", async () => {
    setSupporterEnv();
    const primary = makeOpenRouterLlm(101, "openrouter/allowed-primary");
    modelCatalog.set("openrouter:openrouter/allowed-primary", primary);
    const context = makeContext(primary, makeLlm(102, "byok-fallback"));
    context.textCredentialSource = "supporter";
    context.supporterFunding = makeSupporterFunding();
    const denied = new SupporterRequestDeniedError("allowance_exhausted");
    queuedResults.push(
      { status: "error", streamResults: [{ status: "error", data: denied }], personaResponses: [] },
      { status: "timeout", streamResults: [{ status: "timeout" }], personaResponses: [] },
    );
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    expect((await runGenerationTurn(context, collectingSink())).status).toBe("timeout");
    expect(subscriptionNotices).toEqual([
      expect.objectContaining({ ...getSupporterRequestFailureCopy(denied, context.locale), color: ColorCode.ERROR }),
    ]);
    expect(fallbackNoticeCalls).toEqual([]);
    expect(timeoutNotices).toEqual([]);
    expect(context.streamingContext.deferredTimeoutNotice).toBeUndefined();
  });
});
