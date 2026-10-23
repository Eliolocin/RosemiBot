import { embeddingModelSchema } from "@/types/db/schema";
import { createPersona } from "../../../helpers/fixtures";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import type { StreamContext } from "@/types/stream/interfaces";
import { StreamErrorUi } from "@/utils/discord/stream/errorUi";
import * as embedHelper from "@/utils/discord/embedHelper";
import { serverDocumentsOperations } from "@/utils/discord/interactions/memoriesDocumentOperations";
import { llmModelRepo, serverMemoryRepository } from "@/utils/db/repositories";
import * as embeddingProvider from "@/utils/embeddings/embeddingProvider";
import * as ragAvailability from "@/utils/db/ragAvailability";
import * as credentialResolver from "@/utils/provider/credentialResolver";
import * as documents from "@/utils/documents/documentService";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";
import { spyOn } from "bun:test";
import { MemberKeyRepository, type MemberKeyRow } from "@/modules/supporter-billing/db/repositories/memberKeys";
import {
  supporterUsageStatisticsRepository,
  type RecordSupporterUsageParams,
} from "@/modules/supporter-billing/db/repositories";
import { supporterSpendGuard } from "@/modules/supporter-billing/runtime/spendGuard";
import type { SupporterFundingContext } from "@/modules/supporter-billing/runtime/types";
import type { ResolvedCredentials } from "@/utils/provider/credentialResolver";
import type { MemberKeyMetadata } from "@/modules/supporter-billing/openrouter/management";

export const FIXTURE_RENEWAL_AT = new Date("2026-11-01T00:00:00Z");

interface FundingOverrides {
  credentialSource?: "supporter";
  provider?: "openrouter";
  capability?: SupporterFundingContext["capability"];
  modelCodename?: string;
  tierKey?: string;
  sponsorIdentityId?: number;
  sponsorDiscordUserId?: string;
  entitlementId?: number;
  renewalAt?: Date | null;
  fundingScope?: "server" | "personal";
  sponsorshipId?: number | null;
  serverId?: number | null;
  personalUserId?: number | null;
}

export function createServerFunding(overrides: FundingOverrides = {}): SupporterFundingContext {
  return {
    credentialSource: "supporter",
    provider: "openrouter",
    capability: "text",
    modelCodename: "fixture/text-model",
    tierKey: "fixture_tier",
    sponsorIdentityId: 10,
    sponsorDiscordUserId: "fixture_sponsor",
    entitlementId: 20,
    renewalAt: FIXTURE_RENEWAL_AT,
    fundingScope: "server",
    sponsorshipId: 40,
    serverId: 7,
    personalUserId: null,
    ...overrides,
  } as SupporterFundingContext;
}

export function createPersonalFunding(overrides: FundingOverrides = {}): SupporterFundingContext {
  return createServerFunding({
    fundingScope: "personal",
    sponsorshipId: null,
    serverId: null,
    personalUserId: 70,
    ...overrides,
  });
}

export function createResolvedCredentials(
  funding: SupporterFundingContext | null,
  overrides: Partial<ResolvedCredentials> = {},
): ResolvedCredentials {
  return {
    provider: "openrouter",
    apiKey: "fixture-api-key",
    keyVersion: 1,
    savedConfig: null,
    source: funding?.fundingScope === "personal" ? "personal" : "server",
    ...(funding ? { supporterFunding: funding } : {}),
    ...overrides,
  };
}

export interface UsageCapture {
  rows: RecordSupporterUsageParams[];
  restore(): void;
}

export function captureUsageRecords(): UsageCapture {
  const rows: RecordSupporterUsageParams[] = [];
  const spy = spyOn(supporterUsageStatisticsRepository, "record").mockImplementation(async (row) => {
    rows.push(row);
    return true;
  });
  return { rows, restore: () => spy.mockRestore() };
}

export async function settleUsage(): Promise<void> {
  await Bun.sleep(0);
}

export interface SpendKey {
  apiKey: string;
  keyHash: string;
  funding: SupporterFundingContext;
  identityId: number;
  appliedLimit: number;
}

export interface SpendHarness {
  register(options?: { funding?: SupporterFundingContext; appliedLimit?: number; loggedSpend?: number }): SpendKey;
  pending(identityId: number): number;
  observed(keyHash: string): number;
  restore(): void;
}

let spendSequence = 0;

export function installSpendHarness(): SpendHarness {
  const rows = new Map<number, MemberKeyRow>();
  const logged = new Map<number, number>();
  const remoteUsage = new Map<string, number>();
  const memberKeySpy = spyOn(MemberKeyRepository.prototype, "loadByIdentityId").mockImplementation(
    async (identityId) => rows.get(identityId) ?? null,
  );
  const totalSpy = spyOn(supporterUsageStatisticsRepository, "totalSince").mockImplementation(
    async (identityId) => logged.get(identityId) ?? 0,
  );
  const guard = supporterSpendGuard as unknown as {
    provider: () => { get(hash: string): Promise<MemberKeyMetadata | null> };
  };
  const originalProvider = guard.provider;
  guard.provider = () => ({
    get: async (hash) => ({ hash, name: "fixture", disabled: false, usage: remoteUsage.get(hash) ?? 0, limit: null }),
  });
  return {
    register(options = {}) {
      const sequence = ++spendSequence;
      const identityId = 900_000 + sequence;
      const keyHash = `fixture-key-hash-${sequence}`;
      const apiKey = `fixture-member-key-${sequence}`;
      const appliedLimit = options.appliedLimit ?? 1;
      const funding = createServerFunding({
        ...options.funding,
        sponsorIdentityId: identityId,
      });
      rows.set(identityId, {
        member_key_id: sequence,
        patreon_member_id: `fixture-member-${sequence}`,
        patreon_user_id: null,
        patreon_campaign_id: null,
        carried_allowance: null,
        funded_period_start: null,
        funded_period_end: null,
        retained_cost: 0,
        supporter_identity_id: identityId,
        detached_retention_started_at: null,
        retention_hold: false,
        key_hash: keyHash,
        api_key: null,
        key_version: null,
        disabled: false,
        applied_charge_at: null,
        renewal_due_at: null,
        applied_limit: appliedLimit,
        applied_allowance: null,
        key_created_at: new Date("2026-01-01T00:00:00Z"),
        pending_action: null,
        operation_id: null,
        target_limit: null,
        target_allowance: null,
        target_charge_at: null,
        target_period_end: null,
        retired_hash: null,
      });
      logged.set(identityId, options.loggedSpend ?? 0);
      remoteUsage.set(keyHash, 0);
      supporterSpendGuard.registerCredential(apiKey, funding, keyHash);
      return { apiKey, keyHash, funding, identityId, appliedLimit };
    },
    pending: (identityId) => supporterSpendGuard.pendingSpend(identityId),
    observed: (keyHash) => supporterSpendGuard.observedSpend(keyHash),
    restore() {
      guard.provider = originalProvider;
      memberKeySpy.mockRestore();
      totalSpy.mockRestore();
    },
  };
}

export function fundingContext(funding: SupporterFundingContext | null) {
  return { supporterFunding: funding ?? undefined };
}

export const embeddingModel = embeddingModelSchema.parse({
  embedding_model_id: 31,
  codename: "fixture/embedding",
  provider: "openrouter",
  model_family: "openai",
});

export async function runChunkEdit(funding: ReturnType<typeof createServerFunding> | null, fail?: unknown) {
  const credentials = createResolvedCredentials(funding, {
    provider: "openrouter",
    apiKey: "fixture-embedding-key",
    modelId: embeddingModel.embedding_model_id,
  });
  const spies = [
    spyOn(ragAvailability, "isRagAvailable").mockReturnValue(true),
    spyOn(credentialResolver, "resolveCapabilityCredentials").mockResolvedValue(credentials),
    spyOn(llmModelRepo, "loadEmbeddingModelById").mockResolvedValue(embeddingModel),
    spyOn(embeddingProvider, "providerSupportsEmbeddingTaskType").mockResolvedValue(false),
    spyOn(embeddingProvider, "generateEmbeddingsBatched").mockImplementation(async (request) => {
      if (fail) throw fail;
      request.onUsage?.({ inputTokens: 3, outputTokens: 0, costUsd: 0.01 });
      return [[0.1, 0.2]];
    }),
    spyOn(serverMemoryRepository, "loadDocumentMeta").mockResolvedValue({
      document_name: "fixture",
      channel_disc_ids: [],
      channel_scope_pending: false,
    }),
    spyOn(serverMemoryRepository, "loadDocumentChunks").mockResolvedValue([
      { document_chunk_id: 1, chunk_index: 0, content: "old text" } as never,
    ]),
    spyOn(serverMemoryRepository, "updateChunk").mockResolvedValue(true),
    spyOn(documents, "rebuildDocumentTextContent").mockResolvedValue(undefined),
    spyOn(tomoriStateCache, "invalidateTomoriStateCache").mockImplementation(() => undefined),
  ];
  try {
    return await serverDocumentsOperations.editChunk({
      serverId: 7,
      personaId: null,
      documentId: 5,
      chunkIdx: 0,
      workspaceId: "fixture-workspace",
      userId: 70,
      configuredEmbeddingModelId: embeddingModel.embedding_model_id ?? null,
      canManage: true,
      content: "new text",
      channelDiscIds: [],
    });
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

export async function renderReturnedDenial(result: object, funding: SupporterFundingContext | null = null) {
  const denial = Object.values(result).find((value: unknown) => value instanceof SupporterRequestDeniedError);
  if (!(denial instanceof SupporterRequestDeniedError)) throw new Error("Expected a returned request denial");
  const send = spyOn(embedHelper, "sendStandardEmbed").mockResolvedValue(undefined);
  try {
    await new StreamErrorUi().handleProviderError(
      { type: "api_error", message: "fixture refusal", retryable: false, originalError: denial },
      { createErrorDescription: () => null } as never,
      {
        channel: { id: "guard-denial" },
        tomoriState: createPersona(),
        locale: "en-US",
        textCredentialSource: "supporter",
        ...fundingContext(funding),
      } as unknown as StreamContext,
    );
    return send.mock.calls[0]?.[2];
  } finally {
    send.mockRestore();
  }
}

export async function produceFundedDenial(
  harness: SpendHarness,
  capability: SupporterFundingContext["capability"] = "text",
) {
  const key = harness.register({ appliedLimit: 0, funding: createServerFunding({ capability }) });
  const denial = await supporterSpendGuard
    .begin(key.apiKey, async () => 0)
    .then(
      () => {
        throw new Error("Expected exhausted member key denial");
      },
      (error: unknown) => error,
    );
  return { funding: key.funding, denial };
}
