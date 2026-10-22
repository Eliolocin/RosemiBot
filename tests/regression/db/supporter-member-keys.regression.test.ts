import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import type { SupporterBillingConfig } from "@/modules/supporter-billing/config";
import { initializeSupporterBillingSchema } from "@/modules/supporter-billing/db/schema";
import { MemberKeyRepository } from "@/modules/supporter-billing/db/repositories/memberKeys";
import {
  SupporterEntitlementRepository,
  SupporterIdentityRepository,
  SupporterWebhookEventRepository,
  SupporterUsageStatisticsRepository,
} from "@/modules/supporter-billing/db/repositories";
import { handlePatreonWebhookRawBody } from "@/modules/supporter-billing/patreon/webhook";
import { computePatreonWebhookSignature } from "@/modules/supporter-billing/patreon/webhookVerifier";
import { refreshPatreonEntitlementForIdentity } from "@/modules/supporter-billing/patreon/reconcile";
import {
  persistEligiblePatreonSupporter,
  persistPatreonMemberState,
} from "@/modules/supporter-billing/patreon/persistence";
import {
  mapPatreonIdentityToEligibleSupporter,
  type EligiblePatreonSupporterSnapshot,
} from "@/modules/supporter-billing/patreon/mapping";
import {
  reconcileMemberKeys,
  cleanupDetachedMemberKeysLocked,
  rotateSupporterMemberKey,
  unlinkSupporterIdentity,
} from "@/modules/supporter-billing/openrouter/memberKeys";
import {
  MemberKeyError,
  type MemberKeyMetadata,
  type MemberKeyProvider,
} from "@/modules/supporter-billing/openrouter/management";
import { keyManager } from "@/utils/security/keyManager";
import {
  SupporterSpendGuard,
  supporterSpendGuard,
  fetchWithSupporterSpend,
} from "@/modules/supporter-billing/runtime/spendGuard";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import type { SupporterFundingContext } from "@/modules/supporter-billing/runtime/types";
import { resetOpenRouterCapabilityCache } from "@/utils/cache/openrouterCapabilityCache";
import { estimateSupporterRequestCost } from "@/modules/supporter-billing/runtime/spendEstimates";
import { validateOpenRouterSpeechModel } from "@/utils/cache/openrouterSpeechModelCache";
import { synthesizeOpenRouterSpeech } from "@/providers/openrouter/openrouterSpeech";
import { OpenrouterProvider } from "@/providers/openrouter/openrouterProvider";
import { findSupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import { getOrFetchOpenRouterVideoModelCapabilities } from "@/utils/cache/openrouterVideoModelCache";
import { getOrFetchOpenRouterEmbeddingModel } from "@/utils/cache/openrouterEmbeddingModelCache";
import { getOrFetchOpenRouterDecisionModel } from "@/utils/cache/openrouterDecisionModelCache";
import { OpenrouterStreamAdapter } from "@/providers/openrouter/openrouterStreamAdapter";
import { createPersona } from "../../helpers/fixtures";
import type { StreamContext, StreamConfig } from "@/types/stream/interfaces";
import { getOrFetchOpenRouterImageEndpoints } from "@/utils/cache/openrouterImageModelCache";
import { scanEncryptedRows, verifyCiphertext } from "@/utils/security/encryptedColumns";
import { useFullEnvSandbox } from "../../helpers/env";
import { loadSubscriptionAllowance } from "@/modules/supporter-billing/subscribe/usage";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const config: SupporterBillingConfig = {
  patreon: {
    campaignId: "member-key-campaign",
    oauthClientIdEnv: "CLIENT_ID",
    oauthClientSecretEnv: "CLIENT_SECRET",
    webhookSecretEnv: "WEBHOOK_SECRET",
    creatorRefreshTokenEnv: "REFRESH_TOKEN",
    manageUrl: "https://www.patreon.com/example",
  },
  jobs: { reconcileIntervalSeconds: 300, manualRefreshCooldownSeconds: 30 },
  tiers: {
    mochi: {
      displayNameKey: "supporter.tiers.mochi",
      patreonTierIds: ["tier-mochi"],
      monthlyBudgetMicros: 10_000_000,
      defaultModelByCapability: { text: "example/text" },
    },
    dango: {
      displayNameKey: "supporter.tiers.dango",
      patreonTierIds: ["tier-dango"],
      monthlyBudgetMicros: 20_000_000,
      defaultModelByCapability: { text: "example/text" },
    },
    taiyaki: {
      displayNameKey: "supporter.tiers.taiyaki",
      patreonTierIds: ["tier-taiyaki"],
      monthlyBudgetMicros: 30_000_000,
      defaultModelByCapability: { text: "example/text" },
    },
  },
};
const now = new Date("2026-01-10T00:00:00Z");
const renewal = new Date("2026-02-01T00:00:00Z");
const nextRenewal = new Date("2026-03-01T00:00:00Z");

class Provider implements MemberKeyProvider {
  keys = new Map<string, MemberKeyMetadata & { key: string }>();
  created: string[] = [];
  updates: Array<{ hash: string; disabled: boolean; limit?: number }> = [];
  lostCreate = false;
  lostUpdate = false;
  failDelete = false;
  failGet = false;
  async create(name: string) {
    const hash = randomUUID();
    const key = `synthetic-member-secret-${hash}`;
    this.keys.set(hash, { hash, key, name, usage: 0, limit: 0, disabled: false });
    this.created.push(hash);
    if (this.lostCreate) {
      this.lostCreate = false;
      throw new Error(key);
    }
    return { hash, key };
  }
  async findByName(name: string) {
    return [...this.keys.values()].filter((key) => key.name === name);
  }
  async get(hash: string) {
    if (this.failGet) throw new Error("synthetic-provider-unavailable");
    return this.keys.get(hash) ?? null;
  }
  async update(hash: string, values: { disabled: boolean; limit?: number }) {
    const key = this.keys.get(hash);
    if (!key) throw new Error("synthetic-missing-key");
    Object.assign(key, values);
    this.updates.push({ hash, ...values });
    if (this.lostUpdate) {
      this.lostUpdate = false;
      throw new Error(key.key);
    }
  }
  async delete(hash: string) {
    if (this.failDelete) throw new Error("synthetic-delete-unavailable");
    this.keys.delete(hash);
  }
}

function snapshot(suffix: string): EligiblePatreonSupporterSnapshot {
  return {
    discordUserId: `_member_keys_discord_${suffix}`,
    patreonUserId: `_member_keys_user_${suffix}`,
    patreonMemberId: `_member_keys_member_${suffix}`,
    patreonCampaignId: config.patreon.campaignId,
    tierKey: "mochi",
    patreonTierId: "tier-mochi",
    patronStatus: "active_patron",
    periodStart: new Date("2026-01-01"),
    periodEnd: renewal,
    nextChargeAt: renewal,
    periodDateSource: "patreon",
    lastSuccessfulChargeAt: new Date("2026-01-01"),
  };
}

function mappedSnapshot(
  suffix: string,
  at: Date,
  nextChargeAt: Date | null,
  chargeAt = new Date("2026-01-01"),
): EligiblePatreonSupporterSnapshot {
  const value = snapshot(suffix);
  const mapped = mapPatreonIdentityToEligibleSupporter({
    config,
    discordUserId: value.discordUserId,
    now: at,
    fallbackHours: 24,
    identityResponse: {
      data: {
        type: "user",
        id: value.patreonUserId,
        relationships: { memberships: { data: [{ type: "member", id: value.patreonMemberId }] } },
      },
      included: [
        {
          type: "member",
          id: value.patreonMemberId,
          attributes: {
            patron_status: "active_patron",
            last_charge_status: "Paid",
            last_charge_date: chargeAt.toISOString(),
            next_charge_date: nextChargeAt?.toISOString() ?? null,
          },
          relationships: {
            campaign: { data: { type: "campaign", id: config.patreon.campaignId } },
            currently_entitled_tiers: { data: [{ type: "tier", id: value.patreonTierId }] },
          },
        },
      ],
    },
  });
  if (!mapped.eligible) throw new Error("Invalid member-key fixture");
  return mapped.snapshot;
}

describe.skipIf(!DB_TESTS_AVAILABLE)("Supporter member-key lifecycle", () => {
  useFullEnvSandbox();
  const repository = new MemberKeyRepository(testSql);
  const identities = new SupporterIdentityRepository(testSql);
  const options = { config, client: testSql, now };
  const statistics = new SupporterUsageStatisticsRepository(testSql);

  function funding(identityId: number): SupporterFundingContext {
    return {
      credentialSource: "supporter",
      provider: "openrouter",
      capability: "text",
      modelCodename: "example/text",
      tierKey: "mochi",
      sponsorIdentityId: identityId,
      sponsorDiscordUserId: "synthetic-member",
      entitlementId: identityId,
      renewalAt: renewal,
      fundingScope: "personal",
      sponsorshipId: null,
      serverId: null,
      personalUserId: 1,
    };
  }

  async function record(identityId: number, costUsd: number) {
    await statistics.record({
      supporterIdentityId: identityId,
      fundingScope: "personal",
      serverId: null,
      capability: "text",
      modelCodename: "example/text",
      costUsd,
      providerRequestId: null,
    });
  }

  async function link(value: EligiblePatreonSupporterSnapshot, provider: Provider, at = now) {
    return await persistEligiblePatreonSupporter({
      config,
      client: testSql,
      verifiedAt: at,
      snapshot: value,
      memberKeyProvider: provider,
    });
  }
  async function change(value: EligiblePatreonSupporterSnapshot, provider: Provider, active = true, at = now) {
    const identity = await identities.loadByDiscordUserId(value.discordUserId);
    if (!identity) throw new Error("Missing fixture identity");
    return await persistPatreonMemberState({
      config,
      client: testSql,
      verifiedAt: at,
      identity,
      snapshot: { ...value, isActive: active, inactiveReason: active ? null : "inactive" },
      source: "webhook",
      memberKeyProvider: provider,
    });
  }
  async function remote(value: EligiblePatreonSupporterSnapshot, provider: Provider) {
    const row = await repository.load(value.patreonMemberId);
    const key = row?.key_hash ? provider.keys.get(row.key_hash) : null;
    if (!key) throw new Error("Missing fixture key");
    return key;
  }

  beforeAll(async () => {
    await setupTestDb();
    await initializeSupporterBillingSchema(testSql);
    process.env.CRYPTO_SECRET_V1 = "synthetic_member_key_master_version_one_123";
    process.env.CRYPTO_SECRET_V2 = "synthetic_member_key_master_version_two_456";
    process.env.CRYPTO_SECRET_CURRENT = "1";
    keyManager.initialize();
  });
  afterAll(async () => {
    await testSql`DELETE FROM supporter_member_keys WHERE patreon_member_id LIKE '_member_keys_%'`;
    await testSql`DELETE FROM supporter_identities WHERE patreon_campaign_id = ${config.patreon.campaignId}`;
    await testSql`DELETE FROM supporter_webhook_events WHERE patreon_event_id LIKE '_member_keys_%'`;
    keyManager.initialize();
  });

  it("creates once on concurrent first links, encrypts the credential, and preserves it on repeated delivery", async () => {
    const value = snapshot("concurrent");
    const provider = new Provider();
    const results = await Promise.all(Array.from({ length: 4 }, () => link(value, provider)));
    expect(new Set(results.map((result) => result.identity.supporter_identity_id)).size).toBe(1);
    expect(provider.created).toHaveLength(1);
    const key = await remote(value, provider);
    expect(key.limit).toBe(10);
    const row = await repository.load(value.patreonMemberId);
    expect(row?.api_key?.toString()).not.toContain(key.key);
    expect(row?.key_version).toBe(1);
    expect(row?.applied_limit).toBe(10);
    expect(row?.key_created_at).toBeInstanceOf(Date);
    expect(await repository.loadCredential(results[0].identity.supporter_identity_id, now)).toBe(key.key);
    await change(value, provider);
    expect(provider.created).toHaveLength(1);
    expect(key.limit).toBe(10);
  });

  it("backfills existing keys conservatively and preserves the applied limit on repeated schema initialization", async () => {
    const value = snapshot("guard_backfill");
    const provider = new Provider();
    await link(value, provider);
    const row = await repository.load(value.patreonMemberId);
    if (!row) throw new Error("Missing key row");
    await repository.save({ ...row, applied_limit: null, key_created_at: null });
    await initializeSupporterBillingSchema(testSql);
    await initializeSupporterBillingSchema(testSql);
    const migrated = await repository.load(value.patreonMemberId);
    expect(migrated?.applied_limit).toBe(10);
    expect(migrated?.key_created_at).toEqual(new Date(0));
    expect(migrated?.key_hash).toBe(row.key_hash);
  });

  it("upgrades interrupted renewal and rotation without losing the key's cost window", async () => {
    for (const action of ["renew", "rotate"] as const) {
      const suffix = `guard_upgrade_${action}`;
      const value = snapshot(suffix);
      const provider = new Provider();
      await link(value, provider);
      const key = await remote(value, provider);
      key.usage = 2;
      const row = await repository.load(value.patreonMemberId);
      if (!row) throw new Error("Missing key row");
      await repository.save({
        ...row,
        pending_action: action,
        applied_limit: null,
        key_created_at: null,
        operation_id: randomUUID(),
        target_limit: action === "renew" ? 12 : 10,
        target_charge_at: action === "renew" ? renewal : row.target_charge_at,
        target_period_end: action === "renew" ? nextRenewal : row.target_period_end,
      });
      await initializeSupporterBillingSchema(testSql);
      if (action === "renew")
        await change(mappedSnapshot(suffix, renewal, nextRenewal, renewal), provider, true, renewal);
      else await change(value, provider);
      const current = await repository.load(value.patreonMemberId);
      if (!current) throw new Error("Missing upgraded key row");
      expect(current?.pending_action).toBeNull();
      expect(current?.applied_limit).toBe(action === "renew" ? 12 : 8);
      expect((await remote(value, provider)).limit).toBe(current.applied_limit);
      if (action === "renew") expect(current?.key_created_at).toEqual(new Date(0));
      else expect(current?.key_created_at?.getTime()).toBeGreaterThan(0);
    }
  });

  it("rejects lagging local spend and shares pending holds across scopes without counting committed costs twice", async () => {
    const value = snapshot("spend_guard");
    const provider = new Provider();
    const linked = await link(value, provider);
    const key = await remote(value, provider);
    const id = linked.identity.supporter_identity_id;
    await record(id, 9);
    key.usage = 1;
    const guard = new SupporterSpendGuard(repository, statistics, () => provider);
    guard.registerCredential(key.key, funding(id), key.hash);
    const results = await Promise.allSettled([
      guard.begin(key.key, async () => 0.6),
      guard.begin(key.key, async () => 0.6),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { reason: "allowance_exhausted" },
    });
    const hold = results.find((result) => result.status === "fulfilled");
    if (hold?.status !== "fulfilled" || !hold.value) throw new Error("Expected admitted request");
    expect(guard.pendingSpend(id)).toBe(0.6);
    guard.registerCredential(
      key.key,
      { ...funding(id), fundingScope: "server", sponsorshipId: 1, serverId: 1, personalUserId: null },
      key.hash,
    );
    await expect(guard.begin(key.key, async () => 0.6)).rejects.toMatchObject({ reason: "allowance_exhausted" });
    hold.value.reportCost(0.2);
    await record(id, 0.2);
    hold.value.release();
    hold.value.release();
    expect(guard.pendingSpend(id)).toBe(0);
    const second = await guard.begin(key.key, async () => 0.6);
    second?.reportCost(0.8);
    second?.release();
    await expect(guard.begin(key.key, async () => 0)).rejects.toMatchObject({ reason: "allowance_exhausted" });
    await expect(
      guard.begin(key.key, async () => {
        throw new Error("Exhausted members must skip pricing");
      }),
    ).rejects.toMatchObject({ reason: "allowance_exhausted" });
    const providerReads = spyOn(provider, "get");
    try {
      expect(
        await guard.begin("synthetic-byok", async () => {
          throw new Error("BYOK must skip estimation");
        }),
      ).toBeUndefined();
      expect(providerReads).not.toHaveBeenCalled();
    } finally {
      providerReads.mockRestore();
    }
  });

  it("renews and rotates from logged spend when provider usage lags, preserving targets on retry", async () => {
    const value = snapshot("lagging_lifecycle");
    const provider = new Provider();
    const linked = await link(value, provider);
    const key = await remote(value, provider);
    const id = linked.identity.supporter_identity_id;
    const created = (await repository.load(value.patreonMemberId))?.key_created_at;
    await record(id, 7);
    key.usage = 2;
    const renewed = mappedSnapshot("lagging_lifecycle", renewal, nextRenewal, renewal);
    provider.lostUpdate = true;
    await expect(change(renewed, provider, true, renewal)).rejects.toBeInstanceOf(MemberKeyError);
    expect((await repository.load(value.patreonMemberId))?.target_limit).toBe(17);
    await change(renewed, provider, true, renewal);
    expect(key.limit).toBe(17);
    expect((await repository.load(value.patreonMemberId))?.applied_limit).toBe(17);
    expect((await repository.load(value.patreonMemberId))?.key_created_at).toEqual(created);
    await record(id, 1);
    key.usage = 4;
    const requestId = randomUUID();
    await rotateSupporterMemberKey({ ...options, now: renewal, provider, supporterIdentityId: id, requestId });
    await rotateSupporterMemberKey({ ...options, now: renewal, provider, supporterIdentityId: id, requestId });
    const rotated = await remote(value, provider);
    const row = await repository.load(value.patreonMemberId);
    expect(rotated.limit).toBe(9);
    expect(row?.applied_limit).toBe(9);
    expect(row?.key_created_at?.getTime()).toBeGreaterThan(created?.getTime() ?? 0);
    const guard = new SupporterSpendGuard(repository, statistics, () => provider);
    guard.registerCredential(key.key, funding(id), key.hash);
    await expect(guard.begin(key.key, async () => 1)).rejects.toMatchObject({ reason: "billing_unavailable" });
    guard.registerCredential(rotated.key, funding(id), rotated.hash);
    expect(await guard.begin(rotated.key, async () => 9)).toBeDefined();
  });

  it("holds JSON inference through response consumption, retains unlogged cost, and releases HTTP rejections", async () => {
    const value = snapshot("guard_transport");
    const provider = new Provider();
    const linked = await link(value, provider);
    const key = await remote(value, provider);
    const id = linked.identity.supporter_identity_id;
    const guard = new SupporterSpendGuard(repository, statistics, () => provider);
    guard.registerCredential(key.key, funding(id), key.hash);
    const begin = spyOn(supporterSpendGuard, "begin").mockImplementation((apiKey, estimate) =>
      guard.begin(apiKey, estimate),
    );
    let embeddingsSent = 0;
    const catalog = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: string | URL | Request) => {
          const url = input instanceof Request ? input.url : String(input);
          if (url.endsWith("/embeddings")) embeddingsSent += 1;
          if (url.endsWith("/embeddings/models"))
            return Response.json({ data: [{ id: "example/embed", pricing: { prompt: "0.001", completion: "0" } }] });
          return Response.json({
            data: [{ id: "example/text", context_length: 1000, pricing: { prompt: "0.001", completion: "0.001" } }],
          });
        },
        { preconnect: fetch.preconnect },
      ),
    );
    resetOpenRouterCapabilityCache();
    const init = {
      method: "POST",
      headers: { Authorization: `Bearer ${key.key}` },
      body: JSON.stringify({ model: "example/text", messages: [{ role: "user", content: "Hi" }], max_tokens: 100 }),
    };
    let finish: (() => void) | undefined;
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        finish = () => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ usage: { cost: 0.32 } })));
          controller.close();
          finish = undefined;
        };
      },
    });
    try {
      let sent = false;
      const request = fetchWithSupporterSpend("https://openrouter.ai/api/v1/chat/completions", init, async () => {
        sent = true;
        return new Response(responseBody);
      });
      while (!sent) await Bun.sleep(1);
      expect(guard.pendingSpend(id)).toBeGreaterThan(0);
      finish?.();
      await request;
      expect(guard.pendingSpend(id)).toBe(0);
      expect(guard.observedSpend(key.hash)).toBe(0.32);
      await record(id, 0.32);
      await fetchWithSupporterSpend(
        "https://openrouter.ai/api/v1/chat/completions",
        init,
        async () => new Response("rejected", { status: 403 }),
      );
      expect(guard.observedSpend(key.hash)).toBe(0.32);
      await record(id, 9.68);
      let sentAfterExhaustion = false;
      await expect(
        fetchWithSupporterSpend("https://openrouter.ai/api/v1/chat/completions", init, async () => {
          sentAfterExhaustion = true;
          return Response.json({});
        }),
      ).rejects.toBeInstanceOf(SupporterRequestDeniedError);
      expect(sentAfterExhaustion).toBe(false);
      await getOrFetchOpenRouterEmbeddingModel("example/embed", { fresh: true });
      const embeddingError = await new OpenrouterProvider()
        .generateEmbeddings({ provider: "openrouter", apiKey: key.key, model: "example/embed", inputs: ["Hi"] })
        .catch((error: unknown) => error);
      expect(findSupporterRequestDeniedError(embeddingError)?.reason).toBe("allowance_exhausted");
      expect(embeddingsSent).toBe(0);
    } finally {
      finish?.();
      begin.mockRestore();
      catalog.mockRestore();
      resetOpenRouterCapabilityCache();
    }
  });

  it("releases failed JSON requests, retains successful unknown costs, and gates lowercase POST methods", async () => {
    const value = snapshot("failed_guard_requests");
    const provider = new Provider();
    const linked = await link(value, provider);
    const key = await remote(value, provider);
    const id = linked.identity.supporter_identity_id;
    const row = await repository.load(value.patreonMemberId);
    if (!row) throw new Error("Missing key row");
    await repository.save({ ...row, applied_limit: 0.1 });
    key.limit = 0.1;
    const guard = new SupporterSpendGuard(repository, statistics, () => provider);
    guard.registerCredential(key.key, funding(id), key.hash);
    const begin = spyOn(supporterSpendGuard, "begin").mockImplementation((apiKey) =>
      guard.begin(apiKey, async () => 0.08),
    );
    const init = {
      method: "post",
      headers: { Authorization: `Bearer ${key.key}` },
      body: JSON.stringify({ model: "example/text" }),
    };
    try {
      await expect(
        fetchWithSupporterSpend("https://openrouter.ai/api/v1/chat/completions", init, async () => {
          throw new TypeError("Network unavailable");
        }),
      ).rejects.toBeInstanceOf(TypeError);
      expect(guard.observedSpend(key.hash)).toBe(0);
      for (const response of [
        new Response(null, { status: 502 }),
        Response.json({ error: { message: "Rejected" } }),
        new Response("invalid JSON"),
      ]) {
        await fetchWithSupporterSpend("https://openrouter.ai/api/v1/chat/completions", init, async () => response);
        expect(guard.pendingSpend(id)).toBe(0);
        expect(guard.observedSpend(key.hash)).toBe(0);
      }
      await fetchWithSupporterSpend("https://openrouter.ai/api/v1/chat/completions", init, async () =>
        Response.json({ choices: [] }),
      );
      expect(guard.observedSpend(key.hash)).toBe(0.08);
      let sent = false;
      for (const method of ["POST", "post", "PoSt"]) {
        await expect(
          fetchWithSupporterSpend("https://openrouter.ai/api/v1/chat/completions", { ...init, method }, async () => {
            sent = true;
            return Response.json({});
          }),
        ).rejects.toMatchObject({ reason: "allowance_exhausted" });
      }
      expect(sent).toBe(false);
    } finally {
      begin.mockRestore();
    }
  });

  it("prices cloned voice by UTF-8 bytes inside the guard and leaves provider statistics unknown", async () => {
    const value = snapshot("voice_guard");
    const provider = new Provider();
    const linked = await link(value, provider);
    const key = await remote(value, provider);
    const id = linked.identity.supporter_identity_id;
    const row = await repository.load(value.patreonMemberId);
    if (!row?.key_created_at) throw new Error("Missing key creation time");
    await repository.save({ ...row, applied_limit: 0.0002 });
    key.limit = 0.0002;
    const guard = new SupporterSpendGuard(repository, statistics, () => provider);
    guard.registerCredential(key.key, { ...funding(id), capability: "voice" }, key.hash);
    const begin = spyOn(supporterSpendGuard, "begin").mockImplementation((apiKey, estimate) =>
      guard.begin(apiKey, estimate),
    );
    let syntheses = 0;
    const request = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: string | URL | Request, init?: RequestInit) => {
          if (init?.method === "POST") syntheses += 1;
          return Response.json(
            String(input).endsWith("/endpoints")
              ? { data: { endpoints: [{ supports_voice_cloning: true }] } }
              : { data: [{ id: "fish-audio/s2.1-pro", pricing: { prompt: "0.000015", completion: "0" } }] },
          );
        },
        { preconnect: fetch.preconnect },
      ),
    );
    try {
      expect(await validateOpenRouterSpeechModel("fish-audio/s2.1-pro")).toBe(true);
      const hold = await guard.begin(key.key, () =>
        estimateSupporterRequestCost("/audio/speech", { model: "fish-audio/s2.1-pro", input: "Juno🎵" }),
      );
      expect(guard.pendingSpend(id)).toBeCloseTo(0.00012, 8);
      hold?.release(true);
      expect(guard.pendingSpend(id)).toBe(0);
      expect(await statistics.totalSince(id, row.key_created_at)).toBe(0);
      await expect(
        synthesizeOpenRouterSpeech({
          shape: "clone",
          model: "fish-audio/s2.1-pro",
          apiKey: key.key,
          script: "A script that exceeds the remaining allowance",
          reference: Buffer.alloc(0),
          transcript: null,
          signal: new AbortController().signal,
          maxBytes: 1000,
          operations: [],
        }),
      ).rejects.toMatchObject({ reason: "allowance_exhausted" });
      expect(syntheses).toBe(0);
      expect(await statistics.totalSince(id, row.key_created_at)).toBe(0);
    } finally {
      begin.mockRestore();
      request.mockRestore();
    }
  });

  it("reserves image reasoning and reference inputs and duration-billed voice before dispatch", async () => {
    const model = "google/gemini-nano-banana-2.1";
    let imageRate = 0.00003;
    let speechRate = 0.0025;
    const request = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: string | URL | Request) => {
          const url = String(input);
          if (url.endsWith("/images/models/google/gemini-nano-banana-2.1/endpoints"))
            return Response.json({
              id: model,
              endpoints: [{ pricing: [{ billable: "output_image", unit: "token", cost_usd: imageRate }] }],
            });
          if (url.endsWith("/images/models/example/registered-image/endpoints"))
            return Response.json({
              id: "example/registered-image",
              endpoints: [{ pricing: [{ billable: "output_image", unit: "image", cost_usd: 0.07 }] }],
            });
          if (url.endsWith("/models?output_modalities=speech"))
            return Response.json({
              data: [{ id: "bytedance-seed/seed-audio-1-0", pricing: { prompt: "0", completion: String(speechRate) } }],
            });
          return Response.json({
            data: [
              {
                id: model,
                context_length: 65_536,
                top_provider: { max_completion_tokens: 32_768 },
                pricing: { prompt: "0.0000015", completion: "0.0000075" },
              },
            ],
          });
        },
        { preconnect: fetch.preconnect },
      ),
    );
    resetOpenRouterCapabilityCache();
    try {
      await getOrFetchOpenRouterImageEndpoints(model, { fresh: true });
      expect(await validateOpenRouterSpeechModel("bytedance-seed/seed-audio-1-0", "design")).toBe(true);
      const image = {
        model,
        modalities: ["image", "text"],
        image_config: { image_size: "1K", aspect_ratio: "1:1" },
        messages: [{ role: "user", content: [{ type: "text", text: "A moon" }] }],
      };
      const outputCost = 1_120 * 0.00003 + 32_768 * 0.0000075;
      expect(await estimateSupporterRequestCost("/chat/completions", image)).toBeCloseTo(
        outputCost + Buffer.byteLength(JSON.stringify(image.messages)) * 0.0000015,
        8,
      );
      expect(
        await estimateSupporterRequestCost("/chat/completions", {
          ...image,
          messages: [
            { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }] },
          ],
        }),
      ).toBeCloseTo(outputCost + 65_536 * 0.0000015, 8);
      await expect(
        estimateSupporterRequestCost("/chat/completions", { ...image, image_config: { image_size: "4K" } }),
      ).rejects.toThrow();
      const voice = { model: "bytedance-seed/seed-audio-1-0", input: "A short line" };
      expect(await estimateSupporterRequestCost("/audio/speech", voice)).toBeCloseTo(0.3, 8);
      const value = snapshot("launch_quotes");
      const provider = new Provider();
      const linked = await link(value, provider);
      const key = await remote(value, provider);
      const row = await repository.load(value.patreonMemberId);
      if (!row) throw new Error("Missing fixture member key");
      await repository.save({ ...row, applied_limit: 0.1 });
      key.limit = 0.1;
      const guard = new SupporterSpendGuard(repository, statistics, () => provider);
      guard.registerCredential(key.key, funding(linked.identity.supporter_identity_id), key.hash);
      for (const [path, body] of [
        ["/chat/completions", image],
        ["/audio/speech", voice],
      ] as const)
        await expect(guard.begin(key.key, () => estimateSupporterRequestCost(path, body))).rejects.toMatchObject({
          reason: "allowance_exhausted",
        });
      expect(guard.pendingSpend(linked.identity.supporter_identity_id)).toBe(0);
      expect(
        await estimateSupporterRequestCost("/images", { model: "example/registered-image", prompt: "A moon" }),
      ).toBeCloseTo(0.07, 8);
      imageRate *= 2;
      await getOrFetchOpenRouterImageEndpoints(model, { fresh: true });
      expect(await estimateSupporterRequestCost("/chat/completions", image)).toBeCloseTo(
        outputCost + 0.0336 + Buffer.byteLength(JSON.stringify(image.messages)) * 0.0000015,
        8,
      );
      speechRate *= 2;
      expect(await validateOpenRouterSpeechModel("bytedance-seed/seed-audio-1-0", "design")).toBe(true);
      expect(await estimateSupporterRequestCost("/audio/speech", voice)).toBeCloseTo(0.6, 8);
    } finally {
      request.mockRestore();
      resetOpenRouterCapabilityCache();
    }
  });

  it("quotes launch media and token requests using catalog units", async () => {
    const request = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: string | URL | Request) => {
          const url = String(input);
          if (url.endsWith("/endpoints"))
            return Response.json({
              id: "google/gemini-3.1-flash-image",
              endpoints: [{ pricing: [{ billable: "output_image", unit: "token", cost_usd: "0.000066" }] }],
            });
          if (url.endsWith("/videos/models"))
            return Response.json({
              data: [
                {
                  id: "bytedance/seedance-1-5-pro",
                  pricing_skus: { video_tokens: "0.0000024", video_tokens_without_audio: "0.0000012" },
                },
                {
                  id: "minimax/hailuo-3-max",
                  pricing_skus: {
                    duration_seconds: "0.08",
                    duration_seconds_480p: "0.05",
                    duration_seconds_768p: "0.08",
                  },
                },
                {
                  id: "x-ai/grok-imagine-video-1.5-lite",
                  pricing_skus: {
                    cents_per_image_input: "1",
                    cents_per_video_output_second_480p: "2",
                    cents_per_video_output_second_720p: "3",
                    cents_per_video_output_second_1080p: "14",
                  },
                },
              ],
            });
          if (url.endsWith("/embeddings/models"))
            return Response.json({
              data: [{ id: "example/guard-embedding", pricing: { prompt: "0.00001", completion: "0" } }],
            });
          if (url.endsWith("/models?output_modalities=decisions"))
            return Response.json({
              data: [
                {
                  id: "example/guard-decision",
                  context_length: 1000,
                  architecture: { input_modalities: ["text"], output_modalities: ["decisions"] },
                  pricing: { prompt: "0.00001", completion: "0" },
                },
              ],
            });
          return Response.json({
            data: [
              {
                id: "example/guard-text",
                context_length: 1000,
                pricing: { prompt: "0.000001", completion: "0.000002" },
              },
            ],
          });
        },
        { preconnect: fetch.preconnect },
      ),
    );
    resetOpenRouterCapabilityCache();
    try {
      await getOrFetchOpenRouterImageEndpoints("google/gemini-3.1-flash-image", { fresh: true });
      expect(
        await estimateSupporterRequestCost("/images", {
          model: "google/gemini-3.1-flash-image",
          prompt: "A moon",
          aspect_ratio: "1:1",
        }),
      ).toBeCloseTo(2520 * 0.000066, 8);
      await getOrFetchOpenRouterVideoModelCapabilities("bytedance/seedance-1-5-pro", { fresh: true });
      const video = {
        model: "bytedance/seedance-1-5-pro",
        duration: 5,
        resolution: "720p",
        aspect_ratio: "16:9",
        generate_audio: false,
      };
      const videoCost = await estimateSupporterRequestCost("/videos", video);
      for (const aspectRatio of ["16:9", "1:1", "9:16"]) {
        expect(await estimateSupporterRequestCost("/videos", { ...video, aspect_ratio: aspectRatio })).toBeCloseTo(
          0.13068,
          8,
        );
      }
      expect(await estimateSupporterRequestCost("/videos", { ...video, generate_audio: true })).toBeCloseTo(
        videoCost * 2,
        8,
      );
      const value = snapshot("video_quote_guard");
      const provider = new Provider();
      const linked = await link(value, provider);
      const key = await remote(value, provider);
      const row = await repository.load(value.patreonMemberId);
      if (!row) throw new Error("Missing fixture member key");
      await repository.save({ ...row, applied_limit: 0.1 });
      key.limit = 0.1;
      const guard = new SupporterSpendGuard(repository, statistics, () => provider);
      guard.registerCredential(
        key.key,
        { ...funding(linked.identity.supporter_identity_id), capability: "video" },
        key.hash,
      );
      await expect(
        guard.begin(key.key, () => estimateSupporterRequestCost("/videos", { ...video, aspect_ratio: "1:1" })),
      ).rejects.toMatchObject({ reason: "allowance_exhausted" });
      expect(guard.pendingSpend(linked.identity.supporter_identity_id)).toBe(0);
      await getOrFetchOpenRouterVideoModelCapabilities("minimax/hailuo-3-max", { fresh: true });
      for (const [resolution, expected] of [
        ["480p", 0.25],
        ["768p", 0.4],
      ] as const) {
        expect(
          await estimateSupporterRequestCost("/videos", { ...video, model: "minimax/hailuo-3-max", resolution }),
        ).toBeCloseTo(expected, 8);
      }
      await getOrFetchOpenRouterEmbeddingModel("example/guard-embedding", { fresh: true });
      await getOrFetchOpenRouterVideoModelCapabilities("x-ai/grok-imagine-video-1.5-lite", { fresh: true });
      for (const [resolution, expected] of [
        ["480p", 0.11],
        ["720p", 0.16],
        ["1080p", 0.71],
      ] as const)
        expect(
          await estimateSupporterRequestCost("/videos", {
            ...video,
            model: "x-ai/grok-imagine-video-1.5-lite",
            resolution,
            frame_images: [{}],
          }),
        ).toBeCloseTo(expected, 8);
      expect(
        await estimateSupporterRequestCost("/embeddings", { model: "example/guard-embedding", input: ["Hi"] }),
      ).toBeCloseTo(0.00006, 8);
      await getOrFetchOpenRouterDecisionModel("example/guard-decision", { fresh: true });
      expect(
        await estimateSupporterRequestCost("/decisions", {
          model: "example/guard-decision",
          state: "Evidence",
          questions: {},
        }),
      ).toBeGreaterThan(0);
      const text = { model: "example/guard-text", messages: [{ role: "user", content: "Hi" }], max_tokens: 100 };
      const textCost = await estimateSupporterRequestCost("/chat/completions", text);
      for (const results of [1, 10, 20]) {
        expect(
          await estimateSupporterRequestCost("/chat/completions", {
            ...text,
            plugins: [{ id: "web", engine: "exa", max_results: results }],
          }),
        ).toBeCloseTo(textCost + 0.001 + 0.007 + Math.max(0, results - 10) * 0.001, 8);
      }
      expect(await estimateSupporterRequestCost("/chat/completions", { ...text, max_tokens: 200 })).toBeCloseTo(
        textCost + 0.0002,
        8,
      );
    } finally {
      request.mockRestore();
      resetOpenRouterCapabilityCache();
    }
  });

  it("releases degraded streaming attempts without double headroom and settles abandoned streams", async () => {
    const value = snapshot("stream_guard");
    const provider = new Provider();
    const linked = await link(value, provider);
    const key = await remote(value, provider);
    const id = linked.identity.supporter_identity_id;
    const guard = new SupporterSpendGuard(repository, statistics, () => provider);
    guard.registerCredential(key.key, funding(id), key.hash);
    const begin = spyOn(supporterSpendGuard, "begin").mockImplementation((apiKey) =>
      guard.begin(apiKey, async () => 6),
    );
    let attempts = 0;
    const replies = [
      {
        error: {
          code: 502,
          message: "Provider returned error",
          metadata: { raw: "The max_tokens parameter is not supported" },
        },
      },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 1, cost: 0.25 } },
      { error: { code: 429, message: "Rate limited" } },
      { choices: [{ index: 0, delta: {}, finish_reason: "error" }] },
      { error: { code: 429, message: "Rate limited" }, usage: { cost: 0.1 } },
    ];
    const request = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (_input: string | URL | Request, init?: RequestInit) =>
          init?.method === "POST"
            ? new Response(`data: ${JSON.stringify(replies[attempts++])}\n\ndata: [DONE]\n\n`, {
                headers: { "Content-Type": "text/event-stream" },
              })
            : Response.json({
                data: [
                  { id: "example/stream", context_length: 1000, pricing: { prompt: "0.001", completion: "0.001" } },
                ],
              }),
        { preconnect: fetch.preconnect },
      ),
    );
    resetOpenRouterCapabilityCache();
    const context = {
      channel: {},
      client: {},
      tomoriState: createPersona({ config: { thinking_level: "none", llm_stop_speaker_pattern_enabled: false } }),
      contextItems: [],
      currentTurnModelParts: [],
      provider: "openrouter",
      locale: "en-US",
    } as unknown as StreamContext;
    const config: StreamConfig = {
      model: "example/stream",
      apiKey: key.key,
      temperature: 0.7,
      maxOutputTokens: 100,
      maxMessageLength: 2000,
      flushBufferSize: 1000,
      flushBufferSizeCodeBlock: 15000,
      inactivityTimeoutMs: 5000,
      baseTypeSpeedMsPerChar: 0,
      maxTypingTimeMs: 0,
      minVisibleTypingDurationMs: 0,
      humanizerDegree: 0,
      emojiUsageEnabled: true,
    };
    try {
      const stream = new OpenrouterStreamAdapter().startStream(config, context);
      const first = await stream.next();
      expect(first.done).toBe(false);
      expect(attempts).toBe(2);
      expect(guard.observedSpend(key.hash)).toBe(0.25);
      await stream.return();
      expect(guard.pendingSpend(id)).toBe(0);
      for (const expectedSpend of [0.25, 0.25, 0.35]) {
        for await (const _chunk of new OpenrouterStreamAdapter().startStream(config, context)) {
        }
        expect(guard.pendingSpend(id)).toBe(0);
        expect(guard.observedSpend(key.hash)).toBeCloseTo(expectedSpend, 6);
      }
      const controller = new AbortController();
      let sent = false;
      const waiting = fetchWithSupporterSpend(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${key.key}` },
          body: JSON.stringify({ model: "example/stream", messages: [], max_tokens: 100 }),
          signal: controller.signal,
        },
        async () => {
          sent = true;
          return new Response(new ReadableStream<Uint8Array>());
        },
      );
      while (!sent) await Bun.sleep(1);
      controller.abort();
      await expect(waiting).rejects.toBeDefined();
      expect(guard.pendingSpend(id)).toBe(0);
      expect(guard.observedSpend(key.hash)).toBeCloseTo(0.35, 6);
    } finally {
      begin.mockRestore();
      request.mockRestore();
      resetOpenRouterCapabilityCache();
    }
  });

  it("uses the higher provider reading, caches it briefly, and fails closed on key or storage failures", async () => {
    const value = snapshot("guard_failures");
    const provider = new Provider();
    const linked = await link(value, provider);
    const key = await remote(value, provider);
    const id = linked.identity.supporter_identity_id;
    key.usage = 9.9;
    const guard = new SupporterSpendGuard(repository, statistics, () => provider);
    guard.registerCredential(key.key, funding(id), key.hash);
    const reads = spyOn(provider, "get");
    try {
      for (let index = 0; index < 2; index++)
        await expect(guard.begin(key.key, async () => 1)).rejects.toMatchObject({ reason: "allowance_exhausted" });
      expect(reads).toHaveBeenCalledTimes(1);
      const hold = await guard.begin(key.key, async () => 0.05);
      hold?.reportCost(0.05);
      hold?.release();
      await expect(guard.begin(key.key, async () => 0.06)).rejects.toMatchObject({ reason: "allowance_exhausted" });
      const row = await repository.load(value.patreonMemberId);
      if (!row) throw new Error("Missing key row");
      await repository.save({ ...row, disabled: true });
      await expect(guard.begin(key.key, async () => 0)).rejects.toMatchObject({ reason: "billing_unavailable" });
      await repository.save(row);
      provider.failGet = true;
      const freshGuard = new SupporterSpendGuard(repository, statistics, () => provider);
      freshGuard.registerCredential(key.key, funding(id), key.hash);
      await expect(freshGuard.begin(key.key, async () => 0)).rejects.toMatchObject({ reason: "billing_unavailable" });
      provider.failGet = false;
      const total = spyOn(statistics, "totalSince").mockRejectedValue(new Error(key.key));
      try {
        const error = await guard.begin(key.key, async () => 0).catch((error: unknown) => error);
        expect(error).toBeInstanceOf(SupporterRequestDeniedError);
        expect(String(error)).not.toContain(key.key);
      } finally {
        total.mockRestore();
      }
    } finally {
      reads.mockRestore();
    }
  });

  it("adds only the paid upgrade difference, preserving spend, usage dates and retry targets before the next renewal", async () => {
    const value = snapshot("renewal");
    const provider = new Provider();
    await link(value, provider);
    const key = await remote(value, provider);
    const original = await repository.load(value.patreonMemberId);
    key.usage = 4;
    const edited = {
      ...value,
      tierKey: "dango",
      patreonTierId: "tier-dango",
    };
    for (const lastSuccessfulChargeAt of [null, value.lastSuccessfulChargeAt]) {
      await change({ ...edited, lastSuccessfulChargeAt }, provider, true, new Date("2026-01-16"));
      expect(key.limit).toBe(10);
    }
    const upgraded = {
      ...edited,
      periodStart: new Date("2026-01-15"),
      lastSuccessfulChargeAt: new Date("2026-01-15"),
    };
    provider.lostUpdate = true;
    await expect(change(upgraded, provider, true, new Date("2026-01-16"))).rejects.toBeInstanceOf(MemberKeyError);
    expect(key.limit).toBe(20);
    expect((await repository.load(value.patreonMemberId))?.applied_allowance).toBe(10);
    key.usage = 6;
    await Promise.all(Array.from({ length: 3 }, () => change(upgraded, provider, true, new Date("2026-01-16"))));
    await link(upgraded, provider, new Date("2026-01-16"));
    expect(key.limit).toBe(20);
    const row = await repository.load(value.patreonMemberId);
    expect(row?.key_created_at).toEqual(original?.key_created_at);
    expect(row?.applied_allowance).toBe(20);
    expect(row?.renewal_due_at).toEqual(renewal);
    const identity = await identities.loadByDiscordUserId(value.discordUserId);
    if (!identity) throw new Error("Missing upgrade identity");
    const entitlement = await new SupporterEntitlementRepository(testSql).loadByIdentityId(
      identity.supporter_identity_id,
    );
    if (!entitlement) throw new Error("Missing upgrade entitlement");
    expect(
      await loadSubscriptionAllowance(identity, entitlement, {
        memberKeys: repository,
        statistics,
        provider: () => provider,
        observedSpend: () => 0,
      }),
    ).toEqual({ allowance: 20, used: 6, remaining: 14, start: value.periodStart, end: renewal });
    const renewed = {
      ...upgraded,
      periodStart: renewal,
      periodEnd: nextRenewal,
      nextChargeAt: nextRenewal,
      lastSuccessfulChargeAt: renewal,
    };
    provider.lostUpdate = true;
    await expect(change(renewed, provider, true, renewal)).rejects.toBeInstanceOf(MemberKeyError);
    expect(key.limit).toBe(26);
    key.usage = 8;
    await Promise.all(Array.from({ length: 3 }, () => change(renewed, provider, true, renewal)));
    expect(key.limit).toBe(26);
    expect((await repository.load(value.patreonMemberId))?.applied_charge_at).toEqual(renewal);
    const withoutReceipt = {
      ...mappedSnapshot("renewal", nextRenewal, null),
      tierKey: "dango",
      patreonTierId: "tier-dango",
      lastSuccessfulChargeAt: null,
    };
    await change(withoutReceipt, provider, true, nextRenewal);
    expect(key.limit).toBe(26);
  });

  it("preserves exhausted usage and the highest paid allowance through tier cycling and key rotation", async () => {
    const value = snapshot("upgrade_cycle");
    const provider = new Provider();
    const linked = await link(value, provider);
    const key = await remote(value, provider);
    key.usage = 10;
    const guard = new SupporterSpendGuard(repository, statistics, () => provider);
    guard.registerCredential(key.key, funding(linked.identity.supporter_identity_id), key.hash);
    await expect(guard.begin(key.key, async () => 0.1)).rejects.toMatchObject({ reason: "allowance_exhausted" });
    const upgraded = {
      ...value,
      tierKey: "dango",
      patreonTierId: "tier-dango",
      lastSuccessfulChargeAt: new Date("2026-01-15"),
    };
    await change(upgraded, provider, true, new Date("2026-01-16"));
    expect(key.limit).toBe(20);
    expect(key.usage).toBe(10);
    const hold = await guard.begin(key.key, async () => 0.1);
    expect(hold).toBeDefined();
    hold?.release();
    await change(
      { ...upgraded, tierKey: "mochi", patreonTierId: "tier-mochi" },
      provider,
      true,
      new Date("2026-01-16"),
    );
    await change(upgraded, provider, true, new Date("2026-01-17"));
    expect(key.limit).toBe(20);
    expect((await repository.load(value.patreonMemberId))?.applied_allowance).toBe(20);

    await rotateSupporterMemberKey({
      ...options,
      now: new Date("2026-01-17"),
      provider,
      supporterIdentityId: linked.identity.supporter_identity_id,
      requestId: randomUUID(),
    });
    const replacement = await remote(value, provider);
    expect(replacement.limit).toBe(10);
    await change(upgraded, provider, true, new Date("2026-01-17"));
    expect(replacement.limit).toBe(10);
    await change(
      {
        ...upgraded,
        tierKey: "taiyaki",
        patreonTierId: "tier-taiyaki",
        lastSuccessfulChargeAt: new Date("2026-01-18"),
      },
      provider,
      true,
      new Date("2026-01-19"),
    );
    expect(replacement.limit).toBe(20);
    await change(upgraded, provider, true, new Date("2026-01-19"));
    expect(replacement.limit).toBe(20);

    replacement.usage = 2;
    await change(
      {
        ...value,
        periodStart: renewal,
        periodEnd: nextRenewal,
        nextChargeAt: nextRenewal,
        lastSuccessfulChargeAt: renewal,
      },
      provider,
      true,
      renewal,
    );
    expect(replacement.limit).toBe(12);
    expect((await repository.load(value.patreonMemberId))?.applied_allowance).toBe(10);
  });

  it("disables lapses, denies lookups while provider recovery is pending, and resumes without a refill", async () => {
    const value = snapshot("lapse");
    const provider = new Provider();
    const linked = await link(value, provider);
    const key = await remote(value, provider);
    key.usage = 8;
    provider.lostUpdate = true;
    await expect(change(value, provider, false)).rejects.toBeInstanceOf(MemberKeyError);
    expect(key.disabled).toBe(true);
    expect(await repository.loadCredential(linked.identity.supporter_identity_id, now)).toBeNull();
    await change(value, provider, false);
    await change(value, provider);
    expect(key.disabled).toBe(false);
    expect(key.limit).toBe(10);
    await reconcileMemberKeys({ ...options, provider, now: renewal });
    expect(key.disabled).toBe(true);
    expect(await repository.loadCredential(linked.identity.supporter_identity_id, renewal)).toBeNull();
  });

  it("requires a confirmed renewal boundary and recovers provider usage-read failures without granting twice", async () => {
    const value = mappedSnapshot("missing_dates", now, null);
    const provider = new Provider();
    await link(value, provider);
    const key = await remote(value, provider);
    key.usage = 3;
    const edited = {
      ...mappedSnapshot("missing_dates", new Date("2026-01-21"), null, new Date("2026-01-20")),
      tierKey: "dango",
      patreonTierId: "tier-dango",
    };
    await change(edited, provider, true, new Date("2026-01-21"));
    expect(key.limit).toBe(10);
    await change({ ...edited, nextChargeAt: renewal }, provider, true, new Date("2026-01-21"));
    const renewed = {
      ...edited,
      lastSuccessfulChargeAt: renewal,
      periodStart: renewal,
      periodEnd: nextRenewal,
      nextChargeAt: nextRenewal,
    };
    provider.failGet = true;
    await expect(change(renewed, provider, true, renewal)).rejects.toBeInstanceOf(MemberKeyError);
    expect(key.limit).toBe(10);
    provider.failGet = false;
    await reconcileMemberKeys({ ...options, provider, now: renewal });
    expect(key.limit).toBe(23);
    key.usage = 5;
    await change(renewed, provider, true, renewal);
    expect(key.limit).toBe(23);
  });

  it("preserves a newly confirmed renewal boundary through reactivation after fallback expiry", async () => {
    const value = mappedSnapshot("reactivation_boundary", now, null);
    const provider = new Provider();
    await link(value, provider);
    const key = await remote(value, provider);
    key.usage = 2;
    await change(value, provider, true, value.periodEnd);
    expect(key.disabled).toBe(true);
    const confirmed = mappedSnapshot("reactivation_boundary", value.periodEnd, renewal);
    await change(confirmed, provider, true, value.periodEnd);
    expect(key.disabled).toBe(false);
    expect((await repository.load(value.patreonMemberId))?.renewal_due_at).toEqual(renewal);
    await change(mappedSnapshot("reactivation_boundary", renewal, nextRenewal, renewal), provider, true, renewal);
    expect(key.limit).toBe(12);
    expect((await repository.load(value.patreonMemberId))?.applied_charge_at).toEqual(renewal);
  });

  it("stores stable decimal renewal and rotation targets while replaying a lost provider response", async () => {
    const value = snapshot("fractional_limits");
    const provider = new Provider();
    await link(value, provider);
    const key = await remote(value, provider);
    key.usage = 0.28;
    const renewed = mappedSnapshot("fractional_limits", renewal, nextRenewal, renewal);
    provider.lostUpdate = true;
    await expect(change(renewed, provider, true, renewal)).rejects.toBeInstanceOf(MemberKeyError);
    expect((await repository.load(value.patreonMemberId))?.target_limit).toBe(10.28);
    await change(renewed, provider, true, renewal);
    expect(key.limit).toBe(10.28);
    key.usage = 7.56;
    const identity = await identities.loadByDiscordUserId(value.discordUserId);
    if (!identity) throw new Error("Missing fixture identity");
    await rotateSupporterMemberKey({
      ...options,
      now: renewal,
      provider,
      supporterIdentityId: identity.supporter_identity_id,
      requestId: randomUUID(),
    });
    expect((await remote(value, provider)).limit).toBe(2.72);
  });

  it("performs no writes or provider work for completed detached cleanup", async () => {
    const value = snapshot("cleaned_tombstone");
    const provider = new Provider();
    await link(value, provider);
    await unlinkSupporterIdentity({ ...options, provider, discordUserId: value.discordUserId });
    const save = spyOn(MemberKeyRepository.prototype, "save");
    const find = spyOn(provider, "findByName");
    try {
      await cleanupDetachedMemberKeysLocked(testSql, provider);
      await cleanupDetachedMemberKeysLocked(testSql, provider);
      expect(save).not.toHaveBeenCalled();
      expect(find).not.toHaveBeenCalled();
    } finally {
      save.mockRestore();
      find.mockRestore();
    }
  });

  it("keeps a canceled paid period through Refresh and rejoining, then expires the same key without refilling it", async () => {
    const value = snapshot("cancelled_period");
    const provider = new Provider();
    const linked = await link(value, provider);
    const key = await remote(value, provider);
    key.usage = 2;
    await record(linked.identity.supporter_identity_id, 2);
    const payload = {
      data: {
        type: "member",
        id: value.patreonMemberId,
        attributes: {
          patron_status: "active_patron",
          last_charge_status: "Paid",
          last_charge_date: value.lastSuccessfulChargeAt?.toISOString(),
          next_charge_date: null,
          will_pay_amount_cents: 0,
        },
        relationships: {
          campaign: { data: { type: "campaign", id: config.patreon.campaignId } },
          user: { data: { type: "user", id: value.patreonUserId } },
          currently_entitled_tiers: { data: [{ type: "tier", id: value.patreonTierId }] },
        },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const secret = "synthetic-cancellation-secret";
    const deliver = () =>
      handlePatreonWebhookRawBody(
        rawBody,
        {
          "x-patreon-event": "members:pledge:delete",
          "x-patreon-event-id": "_member_keys_cancellation",
          "x-patreon-signature": computePatreonWebhookSignature(rawBody, secret),
        },
        {
          config,
          now,
          env: { WEBHOOK_SECRET: secret },
          repositories: {
            identityRepository: identities,
            webhookEventRepository: new SupporterWebhookEventRepository(testSql),
          },
          persistMemberState: (options) =>
            persistPatreonMemberState({ ...options, client: testSql, memberKeyProvider: provider }),
        },
      );
    expect((await deliver()).status).toBe("processed");
    expect((await deliver()).status).toBe("duplicate");
    const refresh = (at: Date) =>
      refreshPatreonEntitlementForIdentity({
        config,
        identity: linked.identity,
        now: at,
        fetchCampaignMembers: async () => [payload],
        persistMemberState: (options) =>
          persistPatreonMemberState({ ...options, client: testSql, memberKeyProvider: provider }),
      });
    for (const at of [now, new Date("2026-01-20"), new Date("2026-01-31")]) {
      const result = await refresh(at);
      expect(result.persistResult.entitlement).toMatchObject({
        is_active: true,
        cancel_at_period_end: true,
        period_end: renewal,
        next_charge_at: null,
        last_successful_charge_at: value.lastSuccessfulChargeAt,
      });
      expect(await repository.loadCredential(linked.identity.supporter_identity_id, at)).toBe(key.key);
    }
    const missing = await refreshPatreonEntitlementForIdentity({
      config,
      identity: linked.identity,
      now,
      fetchCampaignMembers: async () => [],
      persistMemberState: (options) =>
        persistPatreonMemberState({ ...options, client: testSql, memberKeyProvider: provider }),
    });
    expect(missing.persistResult.entitlement).toMatchObject({
      is_active: true,
      cancel_at_period_end: true,
      period_end: renewal,
    });
    await change({ ...value, cancelAtPeriodEnd: false }, provider);
    expect(
      (await new SupporterEntitlementRepository(testSql).loadByIdentityId(linked.identity.supporter_identity_id))
        ?.cancel_at_period_end,
    ).toBe(false);
    await refresh(now);
    expect(await repository.loadCredential(linked.identity.supporter_identity_id, renewal)).toBeNull();
    const expired = await refresh(renewal);
    expect(expired.persistResult.entitlement).toMatchObject({
      is_active: false,
      cancel_at_period_end: true,
      period_end: renewal,
    });
    expect(key.disabled).toBe(true);
    expect(key.limit).toBe(10);
    expect(key.usage).toBe(2);
    expect(provider.created).toHaveLength(1);
    expect((await repository.load(value.patreonMemberId))?.key_hash).toBe(key.hash);
  });

  it("retries a signed renewal delivery after provider failure, deduplicates receipts, and disables a refunded member", async () => {
    const value = snapshot("webhook");
    const provider = new Provider();
    await link(value, provider);
    const key = await remote(value, provider);
    key.usage = 2;
    const secret = "synthetic-webhook-secret";
    const payload = {
      data: {
        type: "member",
        id: value.patreonMemberId,
        attributes: {
          patron_status: "active_patron",
          last_charge_status: "Paid",
          last_charge_date: renewal.toISOString(),
          next_charge_date: nextRenewal.toISOString(),
        },
        relationships: {
          campaign: { data: { type: "campaign", id: config.patreon.campaignId } },
          user: { data: { type: "user", id: value.patreonUserId } },
          currently_entitled_tiers: { data: [{ type: "tier", id: value.patreonTierId }] },
        },
      },
    };
    async function deliver(eventId: string, body = payload) {
      const rawBody = Buffer.from(JSON.stringify(body));
      return await handlePatreonWebhookRawBody(
        rawBody,
        {
          "x-patreon-event": "members:update",
          "x-patreon-event-id": eventId,
          "x-patreon-signature": computePatreonWebhookSignature(rawBody, secret),
        },
        {
          config,
          now: renewal,
          env: { WEBHOOK_SECRET: secret },
          repositories: {
            identityRepository: identities,
            webhookEventRepository: new SupporterWebhookEventRepository(testSql),
          },
          persistMemberState: (options) =>
            persistPatreonMemberState({ ...options, client: testSql, memberKeyProvider: provider }),
        },
      );
    }
    provider.lostUpdate = true;
    expect((await deliver("_member_keys_renewal")).statusCode).toBe(500);
    expect(key.limit).toBe(12);
    key.usage = 4;
    expect((await deliver("_member_keys_renewal")).status).toBe("processed");
    expect((await deliver("_member_keys_renewal")).status).toBe("duplicate");
    expect((await deliver("_member_keys_renewal_duplicate_payload")).status).toBe("processed");
    expect(key.limit).toBe(12);
    payload.data.attributes.last_charge_status = "Refunded";
    expect((await deliver("_member_keys_refund")).status).toBe("processed");
    expect(key.disabled).toBe(true);
  });

  it("applies a signed paid upgrade once through provider failure and duplicate deliveries, then renews normally", async () => {
    const value = snapshot("signed_tier_edit");
    const provider = new Provider();
    await link(value, provider);
    const key = await remote(value, provider);
    key.usage = 4;
    const secret = "synthetic-webhook-secret";
    async function deliver(eventId: string, at: Date, chargeAt: Date, nextChargeAt: Date) {
      const rawBody = Buffer.from(
        JSON.stringify({
          data: {
            type: "member",
            id: value.patreonMemberId,
            attributes: {
              patron_status: "active_patron",
              last_charge_status: "Paid",
              last_charge_date: chargeAt.toISOString(),
              next_charge_date: nextChargeAt.toISOString(),
            },
            relationships: {
              campaign: { data: { type: "campaign", id: config.patreon.campaignId } },
              user: { data: { type: "user", id: value.patreonUserId } },
              currently_entitled_tiers: { data: [{ type: "tier", id: "tier-dango" }] },
            },
          },
        }),
      );
      return await handlePatreonWebhookRawBody(
        rawBody,
        {
          "x-patreon-event": "members:update",
          "x-patreon-event-id": eventId,
          "x-patreon-signature": computePatreonWebhookSignature(rawBody, secret),
        },
        {
          config,
          now: at,
          env: { WEBHOOK_SECRET: secret },
          repositories: {
            identityRepository: identities,
            webhookEventRepository: new SupporterWebhookEventRepository(testSql),
          },
          persistMemberState: (options) =>
            persistPatreonMemberState({ ...options, client: testSql, memberKeyProvider: provider }),
        },
      );
    }
    const editedAt = new Date("2026-01-16");
    const upgradeCharge = new Date("2026-01-15");
    provider.lostUpdate = true;
    expect((await deliver("_member_keys_tier_edit", editedAt, upgradeCharge, renewal)).statusCode).toBe(500);
    expect((await deliver("_member_keys_tier_edit", editedAt, upgradeCharge, renewal)).status).toBe("processed");
    expect((await deliver("_member_keys_tier_edit", editedAt, upgradeCharge, renewal)).status).toBe("duplicate");
    expect((await deliver("_member_keys_tier_edit_retry", editedAt, upgradeCharge, renewal)).status).toBe("processed");
    expect(key.limit).toBe(20);
    key.usage = 6;
    expect((await deliver("_member_keys_tier_renewal", renewal, renewal, nextRenewal)).status).toBe("processed");
    expect(key.limit).toBe(26);
    key.usage = 9;
    expect((await deliver("_member_keys_tier_renewal_retry", renewal, renewal, nextRenewal)).status).toBe("processed");
    expect(key.limit).toBe(26);
  });

  it("recovers a lost create response and a failed encrypted write without activating orphan keys", async () => {
    const value = snapshot("create_recovery");
    const provider = new Provider();
    provider.lostCreate = true;
    await expect(link(value, provider)).rejects.toBeInstanceOf(MemberKeyError);
    expect([...provider.keys.values()].every((key) => key.limit === 0)).toBe(true);
    const store = spyOn(MemberKeyRepository.prototype, "storeCreated").mockRejectedValueOnce(
      new Error("synthetic-storage-failure"),
    );
    try {
      await expect(link(value, provider)).rejects.toBeInstanceOf(MemberKeyError);
    } finally {
      store.mockRestore();
    }
    expect(provider.keys.size).toBe(1);
    expect([...provider.keys.values()].every((key) => key.limit === 0)).toBe(true);
    await link(value, provider);
    expect(provider.keys.size).toBe(1);
    expect((await remote(value, provider)).limit).toBe(10);
  });

  it("retries an activation after its storage completion fails using the exact persisted limit", async () => {
    const value = snapshot("activation_recovery");
    const provider = new Provider();
    const save = MemberKeyRepository.prototype.save;
    let failed = false;
    const write = spyOn(MemberKeyRepository.prototype, "save").mockImplementation(async function (
      this: MemberKeyRepository,
      row,
    ) {
      if (!failed && row.pending_action === null && !row.disabled) {
        failed = true;
        throw new Error("synthetic-storage-failure");
      }
      return await save.call(this, row);
    });
    try {
      await expect(link(value, provider)).rejects.toBeInstanceOf(MemberKeyError);
    } finally {
      write.mockRestore();
    }
    const key = await remote(value, provider);
    expect(key.limit).toBe(10);
    key.usage = 2;
    await link(value, provider);
    expect(key.limit).toBe(10);
    expect(provider.created).toHaveLength(1);
  });

  it("persists unlink cleanup across a provider failure and creates a fresh key on a later link", async () => {
    const value = snapshot("unlink");
    const provider = new Provider();
    const linked = await link(value, provider);
    const key = await remote(value, provider);
    provider.failDelete = true;
    await expect(
      unlinkSupporterIdentity({ ...options, provider, discordUserId: value.discordUserId }),
    ).rejects.toBeInstanceOf(MemberKeyError);
    expect(key.disabled).toBe(true);
    expect(await identities.loadByDiscordUserId(value.discordUserId)).toBeNull();
    expect(await repository.loadCredential(linked.identity.supporter_identity_id, now)).toBeNull();
    provider.failDelete = false;
    await unlinkSupporterIdentity({ ...options, provider, discordUserId: value.discordUserId });
    expect(provider.keys.has(key.hash)).toBe(false);
    await link(value, provider);
    expect((await remote(value, provider)).hash).not.toBe(key.hash);
  });

  it("retires both sides of a relink before new activation and rejects a stale former-owner snapshot", async () => {
    const value = snapshot("relink_old");
    const other = snapshot("relink_other");
    const provider = new Provider();
    const old = await link(value, provider);
    await link(other, provider);
    const oldKey = await remote(value, provider);
    const otherKey = await remote(other, provider);
    const replacement = { ...value, discordUserId: other.discordUserId };
    provider.failDelete = true;
    await expect(link(replacement, provider)).rejects.toBeInstanceOf(MemberKeyError);
    expect(provider.created).toHaveLength(2);
    provider.failDelete = false;
    await Promise.all([link(replacement, provider), link(replacement, provider)]);
    expect(provider.keys.has(oldKey.hash)).toBe(false);
    expect(provider.keys.has(otherKey.hash)).toBe(false);
    expect(await identities.loadByDiscordUserId(value.discordUserId)).toBeNull();
    await expect(
      persistPatreonMemberState({
        config,
        client: testSql,
        identity: old.identity,
        verifiedAt: now,
        snapshot: { ...value, isActive: true, inactiveReason: null },
        source: "webhook",
        memberKeyProvider: provider,
      }),
    ).rejects.toBeInstanceOf(MemberKeyError);
  });

  it("rotates once per incident, keeps only the remaining allowance, and retries retired-key deletion", async () => {
    const value = snapshot("rotate");
    const provider = new Provider();
    const linked = await link(value, provider);
    const key = await remote(value, provider);
    key.usage = 7;
    const incident = {
      ...options,
      provider,
      supporterIdentityId: linked.identity.supporter_identity_id,
      requestId: randomUUID(),
    };
    provider.failDelete = true;
    await expect(rotateSupporterMemberKey(incident)).rejects.toBeInstanceOf(MemberKeyError);
    expect(key.disabled).toBe(true);
    const replaced = await remote(value, provider);
    expect(replaced.hash).not.toBe(key.hash);
    expect(replaced.limit).toBe(3);
    provider.failDelete = false;
    await Promise.all([rotateSupporterMemberKey(incident), rotateSupporterMemberKey(incident)]);
    expect(provider.keys.has(key.hash)).toBe(false);
    expect(provider.created).toHaveLength(2);
    expect(await repository.loadCredential(linked.identity.supporter_identity_id, now)).toBe(replaced.key);
  });

  it("recovers rotation after disabling the old key succeeds but storing the replacement plan fails", async () => {
    const value = snapshot("rotate_storage");
    const provider = new Provider();
    const linked = await link(value, provider);
    const key = await remote(value, provider);
    key.usage = 3;
    const incident = {
      ...options,
      provider,
      supporterIdentityId: linked.identity.supporter_identity_id,
      requestId: randomUUID(),
    };
    const save = MemberKeyRepository.prototype.save;
    const write = spyOn(MemberKeyRepository.prototype, "save").mockImplementation(async function (
      this: MemberKeyRepository,
      row,
    ) {
      if (row.pending_action === "create") throw new Error("synthetic-storage-failure");
      return await save.call(this, row);
    });
    try {
      await expect(rotateSupporterMemberKey(incident)).rejects.toBeInstanceOf(MemberKeyError);
    } finally {
      write.mockRestore();
    }
    expect(key.disabled).toBe(true);
    await rotateSupporterMemberKey(incident);
    expect((await remote(value, provider)).limit).toBe(7);
    expect(provider.keys.has(key.hash)).toBe(false);
  });

  it("rotates a lapsed key without re-enabling its access", async () => {
    const value = snapshot("rotate_lapsed");
    const provider = new Provider();
    const linked = await link(value, provider);
    const key = await remote(value, provider);
    key.usage = 9;
    await change(value, provider, false);
    const incident = {
      ...options,
      provider,
      supporterIdentityId: linked.identity.supporter_identity_id,
      requestId: randomUUID(),
    };
    await rotateSupporterMemberKey(incident);
    const replaced = await remote(value, provider);
    expect(replaced.limit).toBe(1);
    expect(replaced.disabled).toBe(true);
    expect(provider.keys.has(key.hash)).toBe(false);
    expect(await repository.loadCredential(linked.identity.supporter_identity_id, now)).toBeNull();
    await rotateSupporterMemberKey(incident);
    expect(provider.created).toHaveLength(2);
  });

  it("fails safely on missing encryption material and rotates ciphertext to the current version on lookup", async () => {
    const value = snapshot("encryption");
    const provider = new Provider();
    const linked = await link(value, provider);
    const key = await remote(value, provider);
    const getKey = spyOn(keyManager, "getKey").mockImplementation(() => {
      throw new Error(key.key);
    });
    try {
      await expect(repository.loadCredential(linked.identity.supporter_identity_id, now)).rejects.toBeInstanceOf(
        MemberKeyError,
      );
    } finally {
      getKey.mockRestore();
    }
    process.env.CRYPTO_SECRET_CURRENT = "2";
    keyManager.initialize();
    try {
      expect(await repository.loadCredential(linked.identity.supporter_identity_id, now)).toBe(key.key);
      const row = await repository.load(value.patreonMemberId);
      expect(row?.key_version).toBe(2);
      const entries = [];
      for await (const entry of scanEncryptedRows(testSql))
        if (entry.target.table === "supporter_member_keys") entries.push(entry);
      const entry = entries.find((entry) => entry.row.id === row?.member_key_id);
      expect(entry).toBeDefined();
      if (entry) await verifyCiphertext(testSql, entry.row.ciphertext, 2);
    } finally {
      process.env.CRYPTO_SECRET_CURRENT = "1";
      keyManager.initialize();
    }
  });

  it("makes no provider changes if entitlement storage fails", async () => {
    const value = snapshot("snapshot_storage");
    const provider = new Provider();
    const write = spyOn(SupporterEntitlementRepository.prototype, "upsertSnapshot").mockRejectedValueOnce(
      new Error("synthetic-storage-failure"),
    );
    try {
      await expect(link(value, provider)).rejects.toBeInstanceOf(MemberKeyError);
    } finally {
      write.mockRestore();
    }
    expect(provider.keys.size).toBe(0);
    expect(await identities.loadByDiscordUserId(value.discordUserId)).toBeNull();
  });
});
