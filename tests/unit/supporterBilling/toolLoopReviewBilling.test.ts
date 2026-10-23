import { llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import * as capabilityResolver from "@/utils/provider/providerCapabilityResolver";
import * as crypto from "@/utils/security/crypto";
import * as ruleChecks from "@/utils/chat/responseRuleCheck";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import * as memberCredentials from "@/modules/supporter-billing/runtime/managedProvider";
import {
  supporterSponsorshipRepository,
  supporterServerSponsorshipSchema,
  supporterUsageStatisticsRepository,
} from "@/modules/supporter-billing/db";
import { useEnvSandbox } from "../../helpers/env";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";
import { savedProviderConfigSchema } from "@/types/db/schema";
import { log } from "@/utils/misc/logger";
import { createResponseReviewState, reviewResponseCandidate } from "@/utils/chat/responseReview";
import type { ProviderStructuredJsonRequest } from "@/types/provider/featureInterfaces";
import { ContextItemTag } from "@/types/misc/context";
import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as realDeliberateToolMode from "@/utils/tools/deliberateToolMode";
import * as realToolRegistry from "@/tools/toolRegistry";
import * as realChannelQueue from "@/utils/chat/channelQueue";
import * as realContextAnnotations from "@/utils/chat/contextAnnotations";
import * as realEmbedHelper from "@/utils/discord/embedHelper";
import * as realStreamOrchestrator from "@/utils/discord/streamOrchestrator";
import * as realToolProgressNotice from "@/utils/discord/toolProgressNotice";
import * as realProviderInfoRegistry from "@/utils/provider/providerInfoRegistry";
import { createScopedModuleMocker, overrideMembers, stubLogMembers } from "../../helpers/mockSurface";
import { createLlmRow, createPersona } from "../../helpers/fixtures";
import type { LLMProvider, ProviderConfig, StreamResult } from "@/types/provider/interfaces";
import type { StandardEmbedOptions } from "@/types/discord/embed";
import type { ChatTurnContext } from "@/utils/chat/types";
import type { ResponseReviewState } from "@/utils/chat/responseReview";
import type { PendingStreamResponse } from "@/types/stream/pendingResponse";
import type { TomoriState } from "@/types/db/schema";
import type { ToolResult } from "@/types/tool/interfaces";
import { createExpressionDeliveryState } from "@/utils/chat/expressionDelivery";

let toolExecuteCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let toolExecuteQueue: ToolResult[] = [];
let requiresFollowUp = false;
let requiresFollowUpCalls: Array<{ name: string; serverId?: number }> = [];
let hasStopRequest = false;
let isFollowUpRequest = false;
let _clearStopRequestCalls = 0;
let standardEmbedCalls: StandardEmbedOptions[] = [];
let standardEmbedFailure: Error | null = null;
let hiddenToolNotices: string[] = [];
let onStopCheck: (() => void) | null = null;

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
    if (standardEmbedFailure) throw standardEmbedFailure;
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
  StreamOrchestrator: overrideMembers(realStreamOrchestrator.StreamOrchestrator, {
    hasStopRequest: (_channelId: string) => {
      onStopCheck?.();
      return hasStopRequest;
    },
    isFollowUpRequest: (_channelId: string) => isFollowUpRequest,
    clearStopRequest: (_channelId: string) => {
      _clearStopRequestCalls += 1;
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

scopedMock.module("@/utils/tools/deliberateToolMode", () => ({ ...realDeliberateToolMode }));

scopedMock.module("@/utils/chat/channelQueue", () => ({
  ...realChannelQueue,
  channelLocks: new Map(),
  setChannelStreamKill: (_channelId: string) => {},
  setChannelToolCallChainActive: () => undefined,
  getChannelTurnAbortSignal: () => undefined,
  incrementChannelFollowUpCount: () => undefined,
  resetChannelFollowUpCount: () => undefined,
  queueStopResponseAtFront: () => undefined,
}));

scopedMock.module("@/utils/chat/contextAnnotations", () => ({
  ...realContextAnnotations,
  annotateRecentMessageMetadataInContext: () => ({ annotatedCount: 0, patchedReplyReferenceCount: 0 }),
}));

scopedMock.module("@/tools/toolRegistry", () => ({
  ...realToolRegistry,
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

function makeProviderConfig(): ProviderConfig {
  return { model: "test-model", apiKey: "test-key", temperature: 0.7 };
}

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

function makeReviewContext(): ChatTurnContext & { responseReview: ResponseReviewState } {
  const context = makeContext();
  context.currentPersona.config.response_drafting_enabled = true;
  context.currentPersona.config.response_review_items = ["persona", "examples", "history", "context", "tools"];
  context.currentPersona.config.response_reviewer_prompt = "Evaluate the character in the admitted scene.";
  context.tomoriState.llm.supports_structoutput = true;
  context.tomoriState.llm.context_window = 64000;
  context.tomoriState.config.api_key = null;
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
      parts: [{ type: "text", text: "Juno: Stay here with me." }],
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
  useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED"]);
  beforeEach(() => {
    toolExecuteCalls = [];
    toolExecuteQueue = [];
    requiresFollowUp = false;
    requiresFollowUpCalls = [];
    hasStopRequest = false;
    isFollowUpRequest = false;
    _clearStopRequestCalls = 0;
    standardEmbedCalls = [];
    standardEmbedFailure = null;
    hiddenToolNotices = [];
    onStopCheck = null;
  });

  it("pins only an owned reviewer, uses its saved credentials, and funds it only from the stored marker", async () => {
    await initializeLocalizer();
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
      thinking_level: "low",
    });
    const modelSpy = spyOn(llmModelRepo, "loadById").mockResolvedValue(reviewer);
    const availableSpy = spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockResolvedValue([reviewer]);
    const savedSpy = spyOn(llmProviderRepo, "loadSavedProviderConfig").mockResolvedValue(saved);
    const decryptSpy = spyOn(crypto, "decryptApiKey").mockResolvedValue("owned-review-key");
    const { provider } = makeProvider([]);
    const calls: ProviderStructuredJsonRequest[] = [];
    const usageSpy = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    Object.assign(provider, {
      callStructuredJSON: async (request: ProviderStructuredJsonRequest) => {
        calls.push(request);
        request.onUsage?.({ inputTokens: 32, outputTokens: 4, costUsd: 0.001 });
        return { success: true, data: { status: "pass" } };
      },
    });
    const capabilitySpy = spyOn(capabilityResolver, "resolveStructuredOutputCapability").mockResolvedValue(
      provider as Awaited<ReturnType<typeof capabilityResolver.resolveStructuredOutputCapability>>,
    );
    const sponsor = spyOn(supporterSponsorshipRepository, "loadActiveSponsorshipForServer").mockResolvedValue(
      supporterServerSponsorshipSchema.parse({
        sponsorship_id: 1,
        server_id: context.currentPersona.server_id,
        server_disc_id: "synthetic-server",
        sponsor_identity_id: 2,
        status: "active",
        created_by_disc_id: "synthetic-sponsor",
        created_at: new Date(),
        updated_at: new Date(),
        revoked_at: null,
      }),
    );
    const member = spyOn(memberCredentials, "resolveSupporterCapabilityCredentials").mockResolvedValue({
      apiKey: "synthetic-review-member-key",
      funding: {
        credentialSource: "supporter",
        provider: "openrouter",
        capability: "text",
        modelCodename: "review-model",
        tierKey: "test-tier",
        sponsorIdentityId: 2,
        sponsorDiscordUserId: "synthetic-sponsor",
        entitlementId: 3,
        renewalAt: null,
        fundingScope: "server",
        sponsorshipId: 1,
        serverId: 1,
        personalUserId: null,
      },
    });
    try {
      await reviewResponseCandidate(context, makeProvider([]).provider, makeProviderConfig());
      process.env.RUN_ENV = "production";
      process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
      const sponsored = makeReviewContext();
      sponsored.responseReview.reviewerId = 88;
      sponsored.responseReview.pending = [held("quiet", []).pendingResponse];
      expect((await reviewResponseCandidate(sponsored, makeProvider([]).provider, makeProviderConfig())).status).toBe(
        "pass",
      );
      expect(calls[1]?.apiKey).toBe("owned-review-key");
      expect(calls[1]?.thinkingLevel).toBe("low");
      const funded = makeReviewContext();
      funded.currentPersona.config.subscription_capabilities = ["reviewer"];
      funded.responseReview.reviewerId = 88;
      funded.responseReview.pending = [held("quiet", []).pendingResponse];
      expect((await reviewResponseCandidate(funded, makeProvider([]).provider, makeProviderConfig())).status).toBe(
        "pass",
      );
      expect(calls[2]?.apiKey).toBe("synthetic-review-member-key");
      expect(calls[2]?.thinkingLevel).toBe("low");
      expect(usageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 32,
          outputTokens: 4,
          costUsd: 0.001,
          modelCodename: "review-model",
        }),
      );
      expect(decryptSpy).toHaveBeenCalledTimes(2);
      const deniedError = new SupporterRequestDeniedError("inactive_entitlement");
      member.mockRejectedValue(deniedError);
      const errorLog = spyOn(log, "error").mockImplementation(async () => {});
      errorLog.mockClear();
      try {
        const denied = makeReviewContext();
        denied.shouldSurfaceUserErrors = true;
        denied.currentPersona.config.subscription_capabilities = ["reviewer"];
        Object.assign(denied.channel, { isSendable: () => true, partial: false });
        denied.responseReview.reviewerId = 88;
        denied.responseReview.pending = [held("quiet", []).pendingResponse];
        expect((await reviewResponseCandidate(denied, provider, makeProviderConfig())).status).toBe("unavailable");
        expect(errorLog).not.toHaveBeenCalled();
        expect(standardEmbedCalls.at(-1)?.description).toBe(
          localizedCopy("en-US", "commands.subscribe.sponsorship.errors.inactive"),
        );
        expect(calls).toHaveLength(3);
      } finally {
        errorLog.mockRestore();
      }
      availableSpy.mockResolvedValue([]);
      const inaccessible = makeReviewContext();
      inaccessible.currentPersona.config.subscription_capabilities = ["reviewer"];
      inaccessible.responseReview.reviewerId = 88;
      inaccessible.responseReview.pending = [held("quiet", []).pendingResponse];
      expect((await reviewResponseCandidate(inaccessible, provider, makeProviderConfig())).status).toBe("unavailable");
      expect(calls).toHaveLength(3);
    } finally {
      modelSpy.mockRestore();
      availableSpy.mockRestore();
      savedSpy.mockRestore();
      decryptSpy.mockRestore();
      capabilitySpy.mockRestore();
      sponsor.mockRestore();
      member.mockRestore();
      usageSpy.mockRestore();
    }
  });
  it("keeps a reviewed turn alive when its subscription notice cannot be delivered", async () => {
    await initializeLocalizer();
    const rules = spyOn(ruleChecks, "checkResponseRules").mockResolvedValue({ status: "disabled" });
    standardEmbedFailure = new Error("Missing Permissions");
    try {
      for (const reviewer of ["passes", "denied"] as const) {
        const context = makeReviewContext();
        context.currentPersona.config.response_reviewer_prompt = null;
        const rebuilt = createResponseReviewState(context);
        if (!rebuilt) throw new Error("Expected enabled review");
        context.responseReview = rebuilt;
        Object.assign(context.channel, { isSendable: () => true, partial: false });
        context.shouldSurfaceUserErrors = true;
        context.responseReview.pending = [
          held("A quiet character waits by the door while the rain falls outside.", []).pendingResponse,
        ];
        const { provider } = makeProvider([]);
        Object.assign(provider, {
          callStructuredJSON: async () => {
            if (reviewer === "denied") throw new SupporterRequestDeniedError("allowance_exhausted");
            return { success: true, data: { status: "pass" } };
          },
        });
        expect((await reviewResponseCandidate(context, provider, makeProviderConfig())).status).toBe(
          reviewer === "passes" ? "pass" : "unavailable",
        );
      }
      expect(standardEmbedCalls.map((call) => call.titleKey)).toEqual(["commands.subscribe.request.allowance_title"]);
    } finally {
      rules.mockRestore();
    }
  });
});
