import { createLlmRow, createPersona } from "../../helpers/fixtures";
import * as memberCredentials from "@/modules/supporter-billing/runtime/managedProvider";
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { stubGlobalFetch } from "../../helpers/fetchStub";
import type { Client, Message } from "discord.js";
import type { LlmRow, TomoriState } from "@/types/db/schema";
import type { ProviderConfig, StreamResult } from "@/types/provider/interfaces";
import type { FallbackNoticeAttempt } from "@/utils/discord/fallbackModelNotice";
import type { ChatResponseSink, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import type { ToolLoopParams } from "@/utils/chat/toolLoop";
import type { TextQuotaTriggerState } from "@/utils/chat/textQuotaState";
import * as realRepositories from "@/utils/db/repositories";
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
import { OpenrouterStreamAdapter, type OpenrouterStreamConfig } from "@/providers/openrouter/openrouterStreamAdapter";
import { HumanizerDegree } from "@/types/db/schema";
import type { StreamContext } from "@/types/stream/interfaces";

const queuedResults: GenerationTurnResult[] = [];
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
let personalKeyAvailable = true;
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
const cooldownAdmissions: Array<{ serverDiscId: string; cooldownUserDiscId: string; notifyUser: boolean | undefined }> =
  [];
let cooldownAdmissionResult = true;
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
  ...realRepositories,
  llmProviderRepo: overrideMembers(realRepositories.llmProviderRepo, {
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
      : {
          ok: false as const,
          reason:
            params.scope.kind === "personal" ? ("missing_subscription" as const) : ("missing_sponsorship" as const),
        };
  },
}));

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
      userRow: { user_id: 4, user_disc_id: "user_1", personal_server_fallback_enabled: true },
    },
    userDiscId: "user_1",
  } as unknown as ChatTurnContext;
}

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

function personalRouteFailure(): GenerationTurnResult {
  return {
    status: "error",
    streamResults: [{ status: "error", data: { type: "rate_limit", code: "429", message: "rate limited" } }],
    personaResponses: [],
  };
}

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

  it("reports an unavailable personal subscription once when the server route is withheld", async () => {
    setSupporterEnv();
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    for (const sink of [collectingSink(), collectingSink()]) {
      const context = makePersonalContext(
        makeLlm(1, "server-primary"),
        makeLlm(2, "server-fallback"),
        makeOpenRouterLlm(3, "openrouter/personal-primary"),
      );
      context.textCredentialSource = "personal";
      context.personalTextProvider = "supporter";
      context.supporterFunding = null;
      context.turn.userRow.personal_server_fallback_enabled = false;
      context.textQuotaTriggerKey = "trigger_lapsed_personal_subscription";
      expect((await runGenerationTurn(context, sink)).status).toBe("skipped");
    }

    const expected = getSupporterRequestFailureCopy(
      new SupporterRequestDeniedError("missing_subscription", undefined, "text", "personal"),
      "en-US",
    );
    expect(toolLoopCalls).toHaveLength(0);
    expect(subscriptionNotices).toHaveLength(1);
    expect(subscriptionNotices[0]).toMatchObject({ titleKey: expected.titleKey, description: expected.description });
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
  it("resolves a personal cross-provider fallback without selecting a server key", async () => {
    const context = makeContext(makeLlm(1, "primary-model"), makeLlm(2, "deepseek-fallback", "deepseek"));
    context.textCredentialSource = "personal";
    context.personalRoutingUserId = 4;
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
    const { runGenerationTurn } = await import("@/utils/chat/generationTurn");
    await runGenerationTurn(context, collectingSink());
    expect(selectApiKeyCount).toBe(0);
  });
});
