import { embeddingModelSchema } from "@/types/db/schema";
import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { createLlmRow, createPersona, createUserRow } from "../../../helpers/fixtures";
import { executeCompactCommand } from "@/utils/compaction/compact/commandImplementation";
import * as compactModal from "@/utils/compaction/compact/modal";
import * as compactSummary from "@/utils/compaction/compact/summaryGeneration";
import * as compactHistory from "@/utils/compaction/compact/historyExtraction";
import * as compactSupplementary from "@/utils/compaction/compact/supplementaryContext";
import * as modals from "@/utils/discord/ui/modals";
import * as personalProviderRuntime from "@/utils/provider/personalProviderRuntime";
import * as providerInfo from "@/utils/provider/providerInfoRegistry";
import * as credentialResolver from "@/utils/provider/credentialResolver";
import * as embeddingProvider from "@/utils/embeddings/embeddingProvider";
import * as ragAvailability from "@/utils/db/ragAvailability";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";
import { llmModelRepo, personaRepository, ragRepository } from "@/utils/db/repositories";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../../helpers/localeCases";
import {
  captureUsageRecords,
  createResolvedCredentials,
  createServerFunding,
  installSpendHarness,
  produceFundedDenial,
  settleUsage,
  type SpendHarness,
  type UsageCapture,
} from "./utils-fundingFixtures";

const persona = createPersona({
  server_id: 7,
  llm: createLlmRow({ llm_provider: "openrouter", supports_structoutput: true }),
  config: { subscription_capabilities: [], embedding_model_id: 31 },
});

const user = createUserRow({ user_id: 70 });

const embeddingModel = embeddingModelSchema.parse({
  embedding_model_id: 31,
  codename: "fixture/embedding",
  provider: "openrouter",
  model_family: "openai",
});

type Embed = { data: { title?: string; description?: string } };
type Handler = (argument: never) => Promise<unknown>;

function createHarness(
  options: {
    denial?: unknown;
    textFunding?: ReturnType<typeof createServerFunding> | null;
    embeddingFunding?: ReturnType<typeof createServerFunding> | null;
  } = {},
) {
  const edits: Array<{ embeds?: Embed[] }> = [];
  const sent: Array<{ embeds?: unknown[] }> = [];
  const collectors: Array<Map<string, Handler>> = [];
  const summaryMessage = {
    id: "summary-message",
    fetch: async () => ({ embeds: [{ description: "fixture summary" }] }),
    edit: async () => undefined,
    createMessageComponentCollector: () => {
      const handlers = new Map<string, Handler>();
      collectors.push(handlers);
      return { on: (event: string, handler: Handler) => handlers.set(event, handler) };
    },
  };
  const channel = {
    id: "fixture-channel",
    messages: {},
    send: async (payload: { embeds?: unknown[] }) => {
      sent.push(payload);
      return summaryMessage;
    },
  };
  const submitInteraction = {
    channel,
    guild: null,
    user: { id: "fixture-user" },
    id: "fixture-submit",
    deferred: true,
    replied: false,
    editReply: async (payload: { embeds?: Embed[] }) => {
      edits.push(payload);
    },
    deferReply: async () => undefined,
  };
  const interaction = {
    channel,
    guildId: "_fixture_guild",
    guild: { id: "_fixture_guild" },
    user: { id: "fixture-user" },
    options: {
      getString: (name: string) => (name === "type" ? "conversation" : null),
      getChannel: () => null,
    },
  } as unknown as ChatInputCommandInteraction;

  const spies = [
    spyOn(compactModal, "promptForCompactOptions").mockResolvedValue({
      submitInteraction,
      summaryType: "conversation",
      refresh: false,
      analyzeImages: false,
      systemPrompt: "fixture prompt",
    } as never),
    spyOn(personaRepository, "loadState").mockResolvedValue(persona),
    spyOn(personaRepository, "loadAllForServer").mockResolvedValue([persona]),
    spyOn(personalProviderRuntime, "applyPersonalProviderSelectionsToTomoriState").mockResolvedValue({
      tomoriState: persona,
    } as never),
    spyOn(providerInfo, "providerSupportsFeature").mockReturnValue(true),
    spyOn(credentialResolver, "resolveCapabilityCredentials").mockImplementation(async (_serverId, capability) =>
      capability === "embedding"
        ? createResolvedCredentials(
            options.embeddingFunding === undefined
              ? createServerFunding({ capability: "embedding", modelCodename: embeddingModel.codename })
              : options.embeddingFunding,
            { modelId: embeddingModel.embedding_model_id },
          )
        : createResolvedCredentials(options.textFunding === undefined ? createServerFunding() : options.textFunding),
    ),
    spyOn(compactHistory, "buildConversationContext").mockResolvedValue({
      conversationText: "fixture conversation",
      imageReferences: [],
    } as never),
    spyOn(compactSupplementary, "buildSupplementaryContext").mockResolvedValue(""),
    spyOn(compactSummary, "generateCompactSummary").mockImplementation(async (request) => {
      if (options.denial) return { cause: options.denial } as never;
      request.onUsage?.({ inputTokens: 20, outputTokens: 8, costUsd: 0.03 });
      return { summary: "fixture summary" } as never;
    }),
    spyOn(modals, "promptWithRawModal").mockResolvedValue({
      outcome: "submit",
      interaction: submitInteraction,
      values: { compact_doc_name: "fixture document", compact_doc_scope: "serverwide" },
    } as never),
    spyOn(llmModelRepo, "loadEmbeddingModelById").mockResolvedValue(embeddingModel),
    spyOn(ragRepository, "normalizeText").mockReturnValue("fixture summary"),
    spyOn(ragRepository, "chunkText").mockReturnValue(["fixture summary"]),
    spyOn(ragRepository, "insertWithChunks").mockResolvedValue(9),
    spyOn(tomoriStateCache, "invalidateTomoriStateCache").mockImplementation(() => undefined),
    spyOn(ragAvailability, "isRagAvailable").mockReturnValue(true),
    spyOn(embeddingProvider, "providerSupportsEmbeddingTaskType").mockResolvedValue(false),
    spyOn(embeddingProvider, "generateEmbeddingsBatched").mockImplementation(async (request) => {
      request.onUsage?.({ inputTokens: 4, outputTokens: 0, costUsd: 0.02 });
      return [[0.1, 0.2]];
    }),
  ];
  return {
    interaction,
    edits,
    sent,
    collectors,
    restore: () => {
      for (const spy of spies) spy.mockRestore();
    },
  };
}

let usage: UsageCapture | null = null;
let spend: SpendHarness | null = null;
const restore: Array<() => void> = [];

afterEach(() => {
  usage?.restore();
  usage = null;
  spend?.restore();
  spend = null;
  for (const undo of restore.splice(0)) undo();
});

describe("compact summary usage and denial", () => {
  beforeAll(async () => initializeLocalizer());

  it("records exactly one summary usage entry for the funded compaction", async () => {
    usage = captureUsageRecords();
    const funding = createServerFunding({ capability: "text", modelCodename: persona.llm.llm_codename });
    const harness = createHarness({ textFunding: funding });
    restore.push(harness.restore);
    await executeCompactCommand({} as Client, harness.interaction, user, "en-US");
    await settleUsage();
    expect(harness.sent).toHaveLength(1);
    expect(usage.rows).toHaveLength(1);
    expect(usage.rows[0]).toMatchObject({
      supporterIdentityId: funding.sponsorIdentityId,
      capability: "text",
      costUsd: 0.03,
      inputTokens: 20,
      outputTokens: 8,
    });
  });

  it("records nothing for a BYOK compaction key", async () => {
    usage = captureUsageRecords();
    const harness = createHarness({ textFunding: null });
    restore.push(harness.restore);
    await executeCompactCommand({} as Client, harness.interaction, user, "en-US");
    await settleUsage();
    expect(usage.rows).toHaveLength(0);
  });

  it("shows a spend-guard denial as subscription copy instead of the generic compact failure", async () => {
    spend = installSpendHarness();
    const { denial, funding } = await produceFundedDenial(spend);
    const harness = createHarness({ denial, textFunding: funding });
    restore.push(harness.restore);
    await executeCompactCommand({} as Client, harness.interaction, user, "en-US");
    const title = harness.edits.at(-1)?.embeds?.[0]?.data.title ?? "";
    expect(title).toContain(localizedCopy("en-US", "commands.subscribe.request.allowance_title"));
    expect(title).not.toContain(localizedCopy("en-US", "commands.compact.failed_title"));
  });
});

describe("compact add-to-docs usage", () => {
  beforeAll(async () => initializeLocalizer());

  for (const funded of [true, false]) {
    it(
      funded
        ? "records one embedding usage entry for a funded document save"
        : "records no embedding usage for a BYOK document save",
      async () => {
        usage = captureUsageRecords();
        const harness = createHarness({
          embeddingFunding: funded
            ? createServerFunding({ capability: "embedding", modelCodename: embeddingModel.codename })
            : null,
        });
        restore.push(harness.restore);
        await executeCompactCommand({} as Client, harness.interaction, user, "en-US");
        const endHandler = harness.collectors[0]?.get("end");
        if (!endHandler) throw new Error("compact collector end handler was not registered");
        await endHandler(undefined as never);
        const collectHandler = harness.collectors[1]?.get("collect");
        if (!collectHandler) throw new Error("add-to-docs collect handler was not registered");
        await collectHandler({ customId: "compact_add_to_docs", memberPermissions: { has: () => true } } as never);
        await settleUsage();
        const embeddingRows = usage.rows.filter((row) => row.capability === "embedding");
        expect(embeddingRows).toHaveLength(funded ? 1 : 0);
        if (funded)
          expect(embeddingRows[0]).toMatchObject({
            capability: "embedding",
            modelCodename: embeddingModel.codename,
            costUsd: 0.02,
          });
      },
    );
  }
});
