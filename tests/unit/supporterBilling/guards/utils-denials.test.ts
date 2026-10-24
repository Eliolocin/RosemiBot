import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { Client, Message, TextChannel } from "discord.js";
import { HumanizerDegree } from "@/types/db/schema";
import type { EmbeddingModelRow, SavedProviderConfigRow } from "@/types/db/schema";
import type {
  ProcessedChunk,
  ProviderError,
  StreamConfig,
  StreamContext,
  StreamProvider,
} from "@/types/stream/interfaces";
import { StreamErrorUi } from "@/utils/discord/stream/errorUi";
import { StreamOrchestrator } from "@/utils/discord/stream/stateMachine";
import { configModelOperations } from "@/utils/discord/interactions/configModelOperations";
import { createMemoriesInteractionRoute } from "@/utils/discord/interactions/memoriesRoutes";
import { serverDocumentsOperations } from "@/utils/discord/interactions/memoriesDocumentOperations";
import { parseInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import * as embedHelper from "@/utils/discord/embedHelper";
import { resolveTextCredentialPolicy, type TextCredentialPolicyDependencies } from "@/utils/chat/turnPlanner";
import * as credentialResolver from "@/utils/provider/credentialResolver";
import * as ragAvailability from "@/utils/db/ragAvailability";
import {
  configRepository,
  llmModelRepo,
  llmProviderRepo,
  ragRepository,
  serverMemoryRepository,
} from "@/utils/db/repositories";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona, createUserRow } from "../../../helpers/fixtures";
import { localizedCopy, localizedProse } from "../../../helpers/localeCases";
import { createRouteInteraction } from "../../../helpers/routeInteraction";
import {
  createPersonalFunding,
  createResolvedCredentials,
  createServerFunding,
  installSpendHarness,
  produceFundedDenial,
  fundingContext,
  runChunkEdit,
  renderReturnedDenial,
} from "./utils-fundingFixtures";

const STREAM_CHANNEL_ID = "guards_denial_stream";

const STREAM_CONFIG: StreamConfig = {
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
  humanizerDegree: HumanizerDegree.LIGHT,
  emojiUsageEnabled: false,
};

function wrapDenial(denial: unknown): ProviderError {
  return {
    type: "api_error",
    message: "upstream refused the subscription request",
    code: "403",
    retryable: true,
    originalError: denial,
  };
}

function createStreamProvider(
  steps: ProcessedChunk[] = [],
  createErrorDescription: () => string | null = () => null,
): StreamProvider {
  return {
    async *startStream() {
      for (const step of steps) yield { provider: "fixture", data: step };
    },
    processChunk: (raw) => raw.data as ProcessedChunk,
    handleProviderError: () => ({ type: "unknown", retryable: false, message: "Fixture failure" }),
    createErrorDescription,
    getProviderInfo: () => ({ name: "fixture", version: "1", supportsStreaming: true, supportsFunctionCalling: true }),
  };
}

function createStreamContext(overrides: Partial<StreamContext> = {}): StreamContext {
  return {
    channel: { id: STREAM_CHANNEL_ID } as unknown as StreamContext["channel"],
    client: {} as Client,
    tomoriState: createPersona({ persona_nickname: "Mirri" }),
    contextItems: [],
    currentTurnModelParts: [],
    provider: "fixture",
    locale: "en-US",
    deliveredMessageRefs: [],
    suppressUserErrors: false,
    ...overrides,
  };
}

function createStreamFixture(steps: ProcessedChunk[], textCredentialSource: "supporter" | "server") {
  const channel = { id: STREAM_CHANNEL_ID, send: async () => ({ id: "sent_1" }), isThread: () => false };
  const context = createStreamContext({
    channel: channel as unknown as TextChannel,
    textCredentialSource,
  });
  return { context, provider: createStreamProvider(steps) };
}

function requireRoute(customId: string) {
  const parsed = parseInteractionRoute(customId);
  if (!parsed) throw new Error(`Failed to parse route for customId: ${customId}`);
  return parsed;
}

type MemoriesRouteInteraction = Parameters<ReturnType<typeof createMemoriesInteractionRoute>["execute"]>[1];

const SAVED_EMBEDDING_PROVIDER: SavedProviderConfigRow = {
  server_id: 1,
  provider: "google",
  credential_revision: 1,
  api_key: null,
  key_version: 1,
  llm_id: null,
  diffusion_model_id: null,
  embedding_model_id: 5,
  nai_diffusion_model_id: null,
  nai_preset_name: null,
  llm_disabled_params: [],
  llm_logit_biases: [],
  thinking_level: "auto",
  fallback_model_refs: [],
};

const CURRENT_EMBEDDING_MODEL: EmbeddingModelRow = {
  embedding_model_id: 2,
  provider: "google",
  codename: "fixture-old-embedding",
  model_family: "openai",
  is_scoped_registration: false,
  is_default: false,
  is_deprecated: false,
};

const CHOSEN_EMBEDDING_MODEL: EmbeddingModelRow = {
  embedding_model_id: 5,
  provider: "google",
  codename: "fixture-new-embedding",
  model_family: "gemini",
  is_scoped_registration: false,
  is_default: false,
  is_deprecated: false,
};

beforeAll(async () => {
  await initializeLocalizer();
});

afterEach(() => StreamOrchestrator.clearStopRequest(STREAM_CHANNEL_ID));

describe("supporter denial rendering guards", () => {
  it("renders the subscription copy ahead of provider and generic stream error handling", async () => {
    const harness = installSpendHarness();
    const send = spyOn(embedHelper, "sendStandardEmbed").mockResolvedValue(undefined);
    try {
      const { denial, funding } = await produceFundedDenial(harness);
      let providerDescriptionCalls = 0;
      const provider = createStreamProvider([], () => {
        providerDescriptionCalls++;
        return "fixture generic provider copy";
      });

      await new StreamErrorUi().handleProviderError(
        wrapDenial(denial),
        provider,
        createStreamContext({ textCredentialSource: "supporter", ...fundingContext(funding) }),
      );

      expect(providerDescriptionCalls).toBe(0);
      expect(send).toHaveBeenCalledTimes(1);
      const options = send.mock.calls[0]?.[2];
      expect(options?.titleKey).toBe("commands.subscribe.request.allowance_title");
      expect(options?.description).toMatch(localizedProse("en-US", "commands.subscribe.request.exhausted"));
      expect(options?.description).not.toBe("fixture generic provider copy");
      expect(options?.tipKeys).toEqual([]);
      expect(options?.restrictedDetail).toBeUndefined();
    } finally {
      send.mockRestore();
      harness.restore();
    }
  });

  it("defers the subscription notice on a supporter stream instead of posting the provider error UI", async () => {
    const harness = installSpendHarness();
    const send = spyOn(embedHelper, "sendStandardEmbed").mockResolvedValue(undefined);
    try {
      const { denial, funding } = await produceFundedDenial(harness);
      const providerError = wrapDenial(denial);
      const { context, provider } = createStreamFixture([{ type: "error", error: providerError }], "supporter");
      Object.assign(context, fundingContext(funding));

      const result = await new StreamOrchestrator().streamToDiscord(provider, STREAM_CONFIG, context);

      expect(result.status).toBe("error");
      expect(result.data).toBe(providerError);
      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
      harness.restore();
    }
  });

  it("renders a document write denial as the subscription receipt", async () => {
    const harness = installSpendHarness();
    try {
      const { denial, funding } = await produceFundedDenial(harness, "embedding");
      const deniedEdit = await runChunkEdit(funding, denial);
      const customId = "memories:v1:document-chunk-edit-submit:en-US:10:77:3:nonce123";
      const route = createMemoriesInteractionRoute({
        resolveScope: async () => ({
          serverId: 1,
          workspaceId: "guild-1",
          guildId: "guild-1",
          userDiscId: "user-1",
          userId: 42,
          canManage: true,
          isBlacklisted: false,
          memteachingEnabled: true,
          configuredEmbeddingModelId: null,
          personas: [createPersona({ persona_id: 10, persona_lineage_id: 100 })],
          readStatus: "fresh",
        }),
        loadDocuments: async () => [],
        getPersonaAvatarData: async () => ({ url: null, files: [] }),
        getDocumentCountsByPersona: async () => ({ byPersona: new Map(), serverwide: 0 }),
        getEligibleHistoryPersonaIds: async () => new Set(),
        getDocumentCounts: async () => ({ documents: 0, chunks: 0 }),
        loadDocumentChunks: async () => [],
        documentOperations: {
          ...serverDocumentsOperations,
          editChunk: async () => deniedEdit,
        },
        takeChannelSelectValues: () => [],
      });
      const interaction = createRouteInteraction({
        customId,
        kind: "modal",
        fields: { content_nonce123: "Updated content" },
      });

      await route.execute({} as Client, interaction as unknown as MemoriesRouteInteraction, requireRoute(customId));

      const rendered = JSON.stringify(interaction.edits.at(-1));
      if (rendered === undefined) throw new Error("The document route did not repaint the panel");
      expect(rendered).toContain(localizedCopy("en-US", "commands.subscribe.request.allowance_title"));
      expect(rendered).toMatch(localizedProse("en-US", "commands.subscribe.request.exhausted"));
      expect(rendered).not.toContain(localizedCopy("en-US", "commands.memories.write_failed_heading"));
    } finally {
      harness.restore();
    }
  });

  it("returns a subscription result when re-embedding is denied instead of succeeding or failing the write", async () => {
    const harness = installSpendHarness();
    const providers = spyOn(llmProviderRepo, "loadSavedProviderConfigs").mockResolvedValue([SAVED_EMBEDDING_PROVIDER]);
    const embeddings = spyOn(llmModelRepo, "loadAvailableEmbeddingModels").mockResolvedValue([CHOSEN_EMBEDDING_MODEL]);
    const modelsById = spyOn(llmModelRepo, "loadEmbeddingModelById").mockImplementation(async (id: number) =>
      id === CURRENT_EMBEDDING_MODEL.embedding_model_id ? CURRENT_EMBEDDING_MODEL : CHOSEN_EMBEDDING_MODEL,
    );
    const update = spyOn(configRepository, "updateModelConfig").mockResolvedValue(true);
    const ragAvailable = spyOn(ragAvailability, "isRagAvailable").mockReturnValue(true);
    const countDocuments = spyOn(serverMemoryRepository, "countDocuments").mockResolvedValue(1);
    const credentials = spyOn(credentialResolver, "resolveCapabilityCredentials").mockResolvedValue(
      createResolvedCredentials(createServerFunding({ capability: "embedding" }), {
        apiKey: "fixture-member-key",
        source: "server",
      }),
    );
    const reembed = spyOn(ragRepository, "reembedServerDocuments");
    try {
      const { denial, funding } = await produceFundedDenial(harness, "embedding");
      credentials.mockResolvedValue(
        createResolvedCredentials(funding, { apiKey: "fixture-member-key", source: "server" }),
      );
      reembed.mockRejectedValue(denial);

      const result = await configModelOperations.setCapabilityModel({
        tomoriState: createPersona({ config: { embedding_model_id: CURRENT_EMBEDDING_MODEL.embedding_model_id } }),
        serverDiscId: "guild-1",
        capability: "embedding",
        provider: "google",
        modelId: CHOSEN_EMBEDDING_MODEL.embedding_model_id as number,
      });

      expect((await renderReturnedDenial(result, funding))?.titleKey).toBe(
        "commands.subscribe.request.allowance_title",
      );
      expect(reembed).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledTimes(1);
    } finally {
      reembed.mockRestore();
      credentials.mockRestore();
      countDocuments.mockRestore();
      ragAvailable.mockRestore();
      update.mockRestore();
      modelsById.mockRestore();
      embeddings.mockRestore();
      providers.mockRestore();
      harness.restore();
    }
  });

  it("renders subscription copy when a personal key has an inactive entitlement", async () => {
    const notices: Array<Parameters<typeof embedHelper.sendStandardEmbed>[2]> = [];
    const dependencies: Partial<TextCredentialPolicyDependencies> = {
      resolvePersonalCapabilityCredentials: async () =>
        createResolvedCredentials(createPersonalFunding(), { source: "personal" }),
      resolveSupporterFunding: async () => ({ ok: false, reason: "inactive_entitlement" }),
      resolveCapabilityCredentials: async () => {
        throw new Error("Server credential resolution must not run for a denied personal subscription");
      },
      resolveServerTextModel: async () => {
        throw new Error("Server model resolution must not run for a denied personal subscription");
      },
      sendStandardEmbed: async (_channel, _locale, options) => {
        notices.push(options);
      },
    };

    const result = await resolveTextCredentialPolicy({
      tomoriState: createPersona(),
      isSelfMessage: false,
      isPersonaJob: false,
      isManuallyTriggered: true,
      isUserImpersonation: false,
      borrowsTriggerMessage: false,
      userRow: createUserRow({ user_id: 42, user_disc_id: "user-42" }),
      channel: { id: "fixture-channel" } as unknown as Message["channel"],
      locale: "en-US",
      isDMChannel: false,
      shouldSurfaceUserErrors: true,
      llmOverrideCodename: "fixture/text-model",
      dependencies,
    });

    expect(result).toBeNull();
    expect(notices).toHaveLength(1);
    const [notice] = notices;
    expect(notice?.titleKey).toBe("commands.subscribe.request.title");
    expect(notice?.description).toMatch(localizedProse("en-US", "commands.subscribe.sponsorship.errors.inactive"));
  });
});
