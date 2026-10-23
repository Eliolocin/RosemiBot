import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { Client, ModalSubmitInteraction } from "discord.js";
import type { SavedProviderConfigRow, ServerMemoryRow, TomoriState } from "@/types/db/schema";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import type { SupporterFundingContext } from "@/modules/supporter-billing/runtime/types";
import { getSupporterUsageContext } from "@/modules/supporter-billing/runtime/types";
import { readOpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";
import { llmModelRepo, ragRepository, serverMemoryRepository } from "@/utils/db/repositories";
import * as ragAvailability from "@/utils/db/ragAvailability";
import { serverDocumentsOperations } from "@/utils/discord/interactions/memoriesDocumentOperations";
import {
  createMemoriesInteractionRoute,
  serverMemoriesOperations,
  type MemoriesRouteDependencies,
} from "@/utils/discord/interactions/memoriesRoutes";
import { parseInteractionRoute, type ParsedInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import * as embeddingProvider from "@/utils/embeddings/embeddingProvider";
import * as credentialResolver from "@/utils/provider/credentialResolver";
import * as rateLimiter from "@/utils/security/rateLimiter";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";
import { localizedCopy } from "../../helpers/localeCases";

beforeAll(async () => initializeLocalizer());

const SAVED_PROVIDER_CONFIG: SavedProviderConfigRow = {
  server_id: 1,
  provider: "google",
  api_key: null,
  key_version: 1,
  credential_revision: 1,
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

const MEMBER_FUNDING: SupporterFundingContext = {
  credentialSource: "supporter",
  provider: "openrouter",
  capability: "embedding",
  modelCodename: "embedding-model",
  tierKey: "test_tier",
  sponsorIdentityId: 3,
  sponsorDiscordUserId: "sponsor-3",
  entitlementId: 4,
  renewalAt: null,
  fundingScope: "server",
  sponsorshipId: 5,
  serverId: 1,
  personalUserId: null,
};

function requireRoute(customId: string): ParsedInteractionRoute {
  const parsed = parseInteractionRoute(customId);
  if (!parsed) throw new Error(`Failed to parse route for customId: ${customId}`);
  return parsed;
}

function makeMemory(id: number, overrides: Partial<ServerMemoryRow> = {}): ServerMemoryRow {
  return {
    server_memory_id: id,
    server_id: 1,
    persona_id: 10,
    persona_lineage_id: 1770,
    user_id: 42,
    content: `Server memory content ${id}`,
    tags: ["general", "lore"],
    channel_disc_ids: [],
    channel_scope_pending: false,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makePersona(id: number, lineageId: number, name: string, isAlter = false): TomoriState {
  return createPersona({
    persona_id: id,
    persona_lineage_id: lineageId,
    persona_nickname: name,
    is_alter: isAlter,
  });
}

function createTestDependencies(overrides: Partial<MemoriesRouteDependencies> = {}) {
  const calls: string[] = [];
  const memories = [
    makeMemory(1, { user_id: 42, persona_lineage_id: 1770, content: "Memory 1" }),
    makeMemory(2, { user_id: 99, persona_lineage_id: 1770, content: "Memory 2" }),
  ];

  const dependencies: MemoriesRouteDependencies = {
    resolveScope: async (interaction) => {
      calls.push("resolveScope");
      const isManager = !interaction.guildId || (interaction.memberPermissions?.has("ManageGuild") ?? false);
      return {
        serverId: 1,
        workspaceId: "guild-123",
        guildId: "guild-123",
        userDiscId: interaction.user.id,
        userId: 42,
        canManage: isManager,
        isBlacklisted: false,
        memteachingEnabled: false,
        configuredEmbeddingModelId: null,
        personas: [makePersona(10, 1770, "Tomori"), makePersona(20, 1880, "Anon")],
        readStatus: "fresh",
      };
    },
    loadMemories: async (serverId, lineageId, userId) => {
      calls.push(`loadMemories:${serverId}:${lineageId}:${userId ?? "undefined"}`);
      if (userId !== undefined) {
        return memories.filter((m) => m.persona_lineage_id === lineageId && m.user_id === userId);
      }
      return memories.filter((m) => m.persona_lineage_id === lineageId);
    },
    getMemoryCountsByLineage: async (serverId, userId) => {
      calls.push(`getMemoryCountsByLineage:${serverId}:${userId ?? "undefined"}`);
      return new Map([
        [1770, userId === undefined ? 2 : 1],
        [1880, 4],
      ]);
    },
    getPersonaAvatarData: async (_interaction, persona) => {
      calls.push(`getPersonaAvatarData:${persona.persona_id}`);
      return { url: `https://cdn.example.invalid/${persona.persona_id}.png`, files: [] };
    },
    loadDocuments: async (serverId, personaId) => {
      calls.push(`loadDocuments:${serverId}:${personaId ?? "serverwide"}`);
      return [];
    },
    loadDocumentMeta: async (serverId, personaId, documentId) => {
      calls.push(`loadDocumentMeta:${serverId}:${personaId ?? "serverwide"}:${documentId}`);
      return null;
    },
    loadDocumentChunks: async (serverId, personaId, documentId) => {
      calls.push(`loadDocumentChunks:${serverId}:${personaId ?? "serverwide"}:${documentId}`);
      return [];
    },
    getDocumentCounts: async (serverId, personaId) => {
      calls.push(`getDocumentCounts:${serverId}:${personaId ?? "serverwide"}`);
      return { documents: 0, chunks: 0 };
    },
    getDocumentCountsByPersona: async () => ({ byPersona: new Map([[10, 3]]), serverwide: 1 }),
    getEligibleHistoryPersonaIds: async () => new Set(),
    getStmEntries: async (workspaceId) => {
      calls.push(`getStmEntries:${workspaceId}`);
      return [
        { channelId: "12345678901234567", personaId: 10, personaName: "Tomori", lastUpdated: 3 },
        { channelId: "12345678901234568", personaId: 10, personaName: "Tomori", lastUpdated: 2 },
        { channelId: "12345678901234569", personaId: null, personaName: "Unscoped", lastUpdated: 1 },
      ];
    },
    preWarmServerStm: async (workspaceId) => {
      calls.push(`preWarmServerStm:${workspaceId}`);
    },
    operations: serverMemoriesOperations,
    documentOperations: serverDocumentsOperations,
    recordAction: () => {
      calls.push("recordAction");
    },
    createNonce: () => "test-nonce",
    showAddModal: async () => {
      calls.push("showAddModal");
    },
    takeFileUpload: () => undefined,
    takeDocumentFileUpload: () => undefined,
    readUploadedText: async () => ({ isValid: true, text: "" }),
    showEditModal: async () => {
      calls.push("showEditModal");
    },
    showAddDocumentModal: async () => {
      calls.push("showAddDocumentModal");
    },
    showEditChunkModal: async () => {
      calls.push("showEditChunkModal");
    },
    showVectorizeModal: async () => {
      calls.push("showVectorizeModal");
    },
    showStmModal: async () => {
      calls.push("showStmModal");
    },
    takeCheckboxValues: () => [],
    takeChannelSelectValues: () => [],
    clearStm: () => {
      calls.push("clearStm");
    },
    ...overrides,
  };

  return { dependencies, calls, memories };
}

it("renders a subscription refusal from a document write as its own receipt", async () => {
  const edits: unknown[] = [];
  const denied = new SupporterRequestDeniedError("allowance_exhausted", undefined, "embedding", "server");
  const { dependencies } = createTestDependencies({
    documentOperations: {
      ...serverDocumentsOperations,
      add: async () => ({ status: "provider-denied" as const, denied }),
    },
  });
  const route = createMemoriesInteractionRoute(dependencies);
  const customId = "memories:v1:document-add-submit:en-US:10:nonce123";
  const interaction = {
    id: "int-subscription",
    customId,
    user: { id: "user-42", username: "user42" },
    guildId: "guild-123",
    memberPermissions: { has: () => true },
    deferred: false,
    replied: false,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => true,
    deferUpdate: async function (this: { deferred: boolean }) {
      this.deferred = true;
    },
    editReply: async function (this: { replied: boolean }, payload: unknown) {
      this.replied = true;
      edits.push(payload);
    },
    fields: { getTextInputValue: (fieldId: string) => (fieldId.startsWith("name_") ? "Guide" : "") },
  };
  await route.execute({} as Client, interaction as unknown as ModalSubmitInteraction, requireRoute(customId));
  const rendered = JSON.stringify(edits.at(-1));
  expect(rendered).toContain(localizedCopy("en-US", "commands.subscribe.request.allowance_title"));
  expect(rendered).not.toContain(localizer("en-US", "commands.memories.write_failed_heading"));
});

describe("funded document writes", () => {
  it("returns the request's funded denial from a vectorize write instead of a generic failure", async () => {
    const order: string[] = [];
    const ragSpy = spyOn(ragAvailability, "isRagAvailable").mockReturnValue(true);
    const memoryGuardSpy = spyOn(rateLimiter.memoryGuard, "checkMemory").mockReturnValue({
      status: "safe",
      rssUsedMB: 1,
      memoryLimitMB: 2,
      percentUsed: 0,
      shouldProcessMedia: true,
    });
    const quotaSpy = spyOn(rateLimiter, "reserveDocumentQuota").mockReturnValue({ allowed: true });
    const credentialSpy = spyOn(credentialResolver, "resolveCapabilityCredentials").mockResolvedValue({
      provider: "openrouter",
      apiKey: "synthetic-member-key",
      keyVersion: 1,
      savedConfig: SAVED_PROVIDER_CONFIG,
      source: "server",
      modelId: 5,
      supporterFunding: MEMBER_FUNDING,
      usageContext: getSupporterUsageContext(MEMBER_FUNDING),
    });
    const modelIdSpy = spyOn(credentialResolver, "getResolvedCapabilityModelId").mockReturnValue(5);
    const modelSpy = spyOn(llmModelRepo, "loadEmbeddingModelById").mockResolvedValue({
      embedding_model_id: 5,
      provider: "openrouter",
      codename: "embedding-model",
      model_family: "embedding-family",
      is_scoped_registration: false,
      is_default: false,
      is_deprecated: false,
    });
    const taskSpy = spyOn(embeddingProvider, "providerSupportsEmbeddingTaskType").mockResolvedValue(false);
    const embeddingSpy = spyOn(embeddingProvider, "generateEmbeddingsBatched").mockResolvedValue([[0.1, 0.2]]);
    const normalizeSpy = spyOn(ragRepository, "normalizeText").mockImplementation((content) => content);
    const chunkSpy = spyOn(ragRepository, "chunkText").mockReturnValue(["Vectorized content"]);
    const insertSpy = spyOn(ragRepository, "insertWithChunks").mockImplementation(async () => {
      order.push("insert");
      return 91;
    });
    const loadSpy = spyOn(serverMemoryRepository, "loadServerMemoriesScoped").mockResolvedValue([
      makeMemory(7, { persona_id: 10, persona_lineage_id: 1770, user_id: 42 }),
    ]);
    const duplicateSpy = spyOn(serverMemoryRepository, "documentExistsByName").mockResolvedValue(false);
    const documentCountSpy = spyOn(serverMemoryRepository, "countDocumentsScoped").mockResolvedValue(0);
    const chunkCountSpy = spyOn(serverMemoryRepository, "countChunksScoped").mockResolvedValue(0);
    const removeSpy = spyOn(serverMemoryRepository, "remove").mockImplementation(async () => {
      order.push("remove");
      return true;
    });
    const invalidateSpy = spyOn(tomoriStateCache, "invalidateTomoriStateCache").mockImplementation(() => {
      order.push("invalidate");
    });

    const input = {
      serverId: 1,
      personaId: 10,
      personaLineageId: 1770,
      memoryId: 7,
      userId: 42,
      userDiscId: "user-42",
      workspaceId: "guild-123",
      configuredEmbeddingModelId: 5,
      isBlacklisted: false,
      canManage: true,
      memteachingEnabled: true,
      content: "Vectorized content",
      documentName: "Vectorized Guide",
      channelDiscIds: [],
    };

    try {
      embeddingSpy.mockRejectedValueOnce(
        new Error("OpenRouter embedding request failed: HTTP 402", {
          cause:
            readOpenRouterLimitError(
              402,
              new Headers(),
              JSON.stringify({ error: { code: 402, metadata: { limit_source: "openrouter_key_limit" } } }),
            ) ?? undefined,
        }),
      );
      expect(await serverDocumentsOperations.vectorize(input)).toMatchObject({
        status: "provider-denied",
        denied: { reason: "allowance_exhausted", capability: "embedding", fundingScope: "server" },
      });
      expect(order).toEqual([]);
    } finally {
      ragSpy.mockRestore();
      memoryGuardSpy.mockRestore();
      quotaSpy.mockRestore();
      credentialSpy.mockRestore();
      modelIdSpy.mockRestore();
      modelSpy.mockRestore();
      taskSpy.mockRestore();
      embeddingSpy.mockRestore();
      normalizeSpy.mockRestore();
      chunkSpy.mockRestore();
      insertSpy.mockRestore();
      loadSpy.mockRestore();
      duplicateSpy.mockRestore();
      documentCountSpy.mockRestore();
      chunkCountSpy.mockRestore();
      removeSpy.mockRestore();
      invalidateSpy.mockRestore();
    }
  });
});
