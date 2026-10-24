import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { ChatInputCommandInteraction, Client, Message, ModalSubmitInteraction } from "discord.js";
import { execute as importHistory } from "@/commands/learn/history";
import { supporterUsageStatisticsRepository } from "@/modules/supporter-billing/db/repositories";
import * as presetExecutors from "@/providers/utils/providerFeatureExecutors";
import * as ragAvailability from "@/utils/db/ragAvailability";
import * as stateCache from "@/utils/cache/tomoriStateCache";
import { llmModelRepo, personaRepository, serverMemoryRepository } from "@/utils/db/repositories";
import * as rateLimiter from "@/utils/security/rateLimiter";
import * as embeddings from "@/utils/embeddings/embeddingProvider";
import * as historyFetcher from "@/utils/discord/historyFetcher";
import * as historyFormatter from "@/utils/discord/historyFormatter";
import * as webhookIdentity from "@/utils/chat/webhookIdentity";
import * as documentService from "@/utils/documents/documentService";
import * as personalProviders from "@/utils/provider/personalProviderRuntime";
import * as credentials from "@/utils/provider/credentialResolver";
import * as modals from "@/utils/discord/ui/modals";
import { embeddingModelSchema } from "@/types/db/schema";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createLlmRow, createPersona, createUserRow } from "../../../helpers/fixtures";
import { makeFakeInteraction } from "../../../helpers/fakeInteraction";
import { localizedCopy } from "../../../helpers/localeCases";
import {
  createProviderLimitFailure,
  createSupporterCredentials,
  createSupporterDenial,
  createSupporterFunding,
  createUnfundedCredentials,
} from "./fundingFixtures";

const TEXT_MODEL = "synthetic/text";
const EMBEDDING_MODEL = "synthetic/embedding";
const START_ID = "100000000000000001";

const embeddingsModel = embeddingModelSchema.parse({
  embedding_model_id: 7,
  provider: "openrouter",
  codename: EMBEDDING_MODEL,
  model_family: "synthetic-family",
});

const textFunding = () => createSupporterFunding({ modelCodename: TEXT_MODEL, capability: "text" });
const embeddingFunding = () =>
  createSupporterFunding({
    modelCodename: EMBEDDING_MODEL,
    capability: "embedding",
    sponsorIdentityId: 52,
    entitlementId: 18,
    fundingScope: "personal",
    sponsorshipId: null,
    serverId: null,
    personalUserId: 1,
  });

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

beforeAll(initializeLocalizer);

function harness(): {
  interaction: ChatInputCommandInteraction;
  modal: ReturnType<typeof makeFakeInteraction>;
  calls: ReturnType<typeof makeFakeInteraction>["calls"];
} {
  const modal = makeFakeInteraction({ deferred: true, replied: true });
  const command = makeFakeInteraction({
    guild: { id: "synthetic-guild", name: "Synthetic guild", channels: { cache: new Map() } },
    guildId: "synthetic-guild",
    channel: {
      id: "synthetic-channel",
      isThread: () => false,
      client: { user: { id: "synthetic-bot" } },
      messages: { fetch: async (id: string) => ({ id }) },
    },
    memberPermissions: { has: () => true },
  });
  Object.assign(command.interaction.options, {
    getString: (name: string) => {
      if (name === "scope") return "global";
      if (name === "name") return "fixture-history";
      if (name === "start_message_id") return START_ID;
      return null;
    },
    getInteger: () => null,
  });
  const persona = createPersona({
    llm: createLlmRow({
      llm_provider: "openrouter",
      llm_codename: TEXT_MODEL,
      supports_structoutput: true,
    }),
  });
  spies.push(spyOn(ragAvailability, "isRagAvailable").mockReturnValue(true));
  spies.push(spyOn(rateLimiter.memoryGuard, "checkMemory").mockReturnValue({ status: "ok" } as never));
  spies.push(spyOn(stateCache, "getCachedTomoriState").mockResolvedValue(persona));
  spies.push(
    spyOn(personalProviders, "applyPersonalProviderSelectionsToTomoriState").mockResolvedValue({
      tomoriState: persona,
      activeConfigs: {},
    }),
  );
  spies.push(spyOn(personaRepository, "loadAllForServer").mockResolvedValue([persona]));
  spies.push(spyOn(llmModelRepo, "loadEmbeddingModelById").mockResolvedValue(embeddingsModel));
  spies.push(
    spyOn(modals, "promptWithRawModal").mockResolvedValue({
      outcome: "submit",
      interaction: modal.interaction as unknown as ModalSubmitInteraction,
      values: {},
    }),
  );
  spies.push(
    spyOn(historyFetcher, "fetchHistoryAfter").mockResolvedValue({
      messages: [{ id: START_ID, content: "synthetic message", author: { id: "synthetic-user" } } as Message],
      reachedEnd: true,
    }),
  );
  spies.push(
    spyOn(historyFormatter, "formatMessagesForExtraction").mockReturnValue({
      messageCount: 2,
      text: "synthetic line one\nsynthetic line two",
      detectedPersonaTomoriIds: [],
    } as never),
  );
  spies.push(spyOn(webhookIdentity, "verifyMessageWebhook").mockResolvedValue(false));
  spies.push(spyOn(rateLimiter, "reserveDocumentQuota").mockReturnValue({ allowed: true, resetAt: null } as never));
  spies.push(spyOn(documentService, "createDocumentRecord").mockResolvedValue(42));
  spies.push(spyOn(documentService, "appendDocumentChunks").mockResolvedValue(undefined as never));
  spies.push(spyOn(documentService, "finalizeDocumentContent").mockResolvedValue(undefined as never));
  spies.push(spyOn(stateCache, "invalidateTomoriStateCache").mockImplementation(() => undefined));
  spies.push(spyOn(serverMemoryRepository, "documentExistsByName").mockResolvedValue(false));
  spies.push(spyOn(serverMemoryRepository, "countDocumentsScoped").mockResolvedValue(0));
  spies.push(spyOn(serverMemoryRepository, "countChunksScoped").mockResolvedValue(0));
  spies.push(spyOn(serverMemoryRepository, "removeDocument").mockResolvedValue(undefined as never));
  spies.push(spyOn(embeddings, "providerSupportsEmbeddingTaskType").mockResolvedValue(false));
  return { interaction: command.interaction as unknown as ChatInputCommandInteraction, modal, calls: command.calls };
}

function stubCredentials() {
  const text = textFunding();
  const embedding = embeddingFunding();
  spies.push(
    spyOn(credentials, "resolveCapabilityCredentials").mockImplementation(async (_serverId, capability) =>
      capability === "embedding"
        ? createSupporterCredentials({
            modelId: 7,
            funding: embedding,
          })
        : createSupporterCredentials({ funding: text }),
    ),
  );
  return { text, embedding };
}

function payload(calls: Array<{ method: string; args: unknown[] }>): string {
  return JSON.stringify(calls.filter((call) => ["reply", "editReply", "followUp"].includes(call.method)));
}

function successfulExtraction(): void {
  spies.push(
    spyOn(presetExecutors, "extractHistoryWindowForProvider").mockImplementation(async (request) => {
      request.onUsage?.({ inputTokens: 300, outputTokens: 40, costUsd: 0.02 });
      return { ok: true, entries: [{ lossless_restatement: "A synthetic fact." }], discarded: 0 } as never;
    }),
  );
  spies.push(
    spyOn(embeddings, "generateEmbeddingsBatched").mockImplementation(async (request) => {
      request.onUsage?.({ inputTokens: 20, outputTokens: 0, costUsd: 0.0004 });
      return [[0.1, 0.2]];
    }),
  );
}

describe("learn history command billing guards", () => {
  it("records nested text and embedding usage against the funding of each call", async () => {
    const { interaction } = harness();
    stubCredentials();
    successfulExtraction();
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);

    await importHistory({} as Client, interaction, createUserRow(), "en-US");

    expect(record.mock.calls).toHaveLength(2);
    expect(record.mock.calls[0]?.[0]).toEqual({
      supporterIdentityId: textFunding().sponsorIdentityId,
      fundingScope: "server",
      serverId: textFunding().serverId,
      capability: "text",
      modelCodename: TEXT_MODEL,
      costUsd: 0.02,
      providerRequestId: null,
      inputTokens: 300,
      outputTokens: 40,
    });
    expect(record.mock.calls[1]?.[0]).toEqual({
      supporterIdentityId: embeddingFunding().sponsorIdentityId,
      fundingScope: "personal",
      serverId: embeddingFunding().serverId,
      capability: "embedding",
      modelCodename: EMBEDDING_MODEL,
      costUsd: 0.0004,
      providerRequestId: null,
      inputTokens: 20,
      outputTokens: 0,
    });
  });

  it("records nothing when the server's own keys pay for text extraction and embedding", async () => {
    const { interaction, modal } = harness();
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockImplementation(async (_serverId, capability) =>
        createUnfundedCredentials({ modelId: capability === "embedding" ? 7 : 12 }),
      ),
    );
    successfulExtraction();
    const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
    spies.push(record);

    await importHistory({} as Client, interaction, createUserRow(), "en-US");

    expect(payload(modal.calls)).toContain(localizedCopy("en-US", "commands.learn.history.success_title"));
    expect(record).not.toHaveBeenCalled();
  });

  for (const refusal of ["scoped", "provider"] as const) {
    it(`attributes a ${refusal} text extraction denial to its request funding`, async () => {
      const { interaction, modal } = harness();
      const { text } = stubCredentials();
      spies.push(
        spyOn(presetExecutors, "extractHistoryWindowForProvider").mockResolvedValue({
          ok: false,
          reason: "failed",
          error: "denied",
          cause:
            refusal === "provider"
              ? createProviderLimitFailure()
              : createSupporterDenial({ reason: "model_not_allowed", funding: text }),
        } as never),
      );

      await importHistory({} as Client, interaction, createUserRow(), "en-US");

      const rendered = payload(modal.calls);
      expect(rendered).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.server"));
      if (refusal === "scoped")
        expect(rendered).toContain(localizedCopy("en-US", "commands.subscribe.request.capabilities.text"));
      expect(rendered).not.toContain(localizedCopy("en-US", "commands.subscribe.request.capabilities.embedding"));
      expect(rendered).not.toContain("commands.learn.history.extraction_failed_title");
    });

    it(`attributes a ${refusal} embedding denial to its request funding`, async () => {
      const { interaction, modal } = harness();
      const { embedding } = stubCredentials();
      spies.push(
        spyOn(presetExecutors, "extractHistoryWindowForProvider").mockImplementation(async (request) => {
          request.onUsage?.({ inputTokens: 300, outputTokens: 40, costUsd: 0.02 });
          return { ok: true, entries: [{ lossless_restatement: "A synthetic fact." }], discarded: 0 } as never;
        }),
      );
      spies.push(
        spyOn(embeddings, "generateEmbeddingsBatched").mockRejectedValue(
          refusal === "provider"
            ? createProviderLimitFailure()
            : createSupporterDenial({ reason: "model_not_allowed", funding: embedding }),
        ),
      );
      const record = spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true);
      spies.push(record);

      await importHistory({} as Client, interaction, createUserRow(), "en-US");

      const rendered = payload(modal.calls);
      expect(rendered).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.personal"));
      expect(rendered).not.toContain(localizedCopy("en-US", "commands.subscribe.request.scope.server"));
      if (refusal === "scoped")
        expect(rendered).toContain(localizedCopy("en-US", "commands.subscribe.request.capabilities.embedding"));
      expect(rendered).not.toContain(localizedCopy("en-US", "commands.subscribe.request.capabilities.text"));
      expect(record.mock.calls).toHaveLength(1);
      expect(record.mock.calls[0]?.[0]?.capability).toBe("text");
    });
  }

  it("reports a credential-time denial as the subscription copy", async () => {
    const { interaction, modal } = harness();
    spies.push(
      spyOn(credentials, "resolveCapabilityCredentials").mockRejectedValue(
        createSupporterDenial({ reason: "inactive_entitlement", capability: "text" }),
      ),
    );

    await importHistory({} as Client, interaction, createUserRow(), "en-US");

    expect(payload(modal.calls)).toContain(localizedCopy("en-US", "commands.subscribe.sponsorship.errors.inactive"));
  });
});
