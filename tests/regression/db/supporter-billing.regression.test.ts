import { loadConfigSwitchModelsView } from "@/utils/discord/interactions/configModelLoaders";
import type { SQL } from "bun";
import { createHash, randomUUID } from "node:crypto";
import { createMemberKeyMetadata } from "../../helpers/memberKeyMetadata";
import { MemberKeyRepository } from "@/modules/supporter-billing/db/repositories/memberKeys";
import { OAuthStateRepository } from "@/utils/db/repositories/OAuthStateRepository";
import { afterAll, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import {
  createPatreonCreatorTokenStore,
  replacePatreonCreatorAuthorization,
  SponsorshipConflictError,
} from "@/modules/supporter-billing/db";
import {
  clearPatreonCreatorTokenStateForTests,
  getPatreonCreatorAccessToken,
} from "@/modules/supporter-billing/patreon/creatorTokens";
import { OAuthRefreshCoordinator } from "@/utils/oauth/refreshCoordinator";
import type { OAuthFetch } from "@/utils/oauth/oauthFetch";
import { decryptApiKey, encryptApiKey } from "@/utils/security/crypto";
import { sql as applicationSql, resetDatabaseConnection } from "@/utils/db/client";
import {
  configRepository,
  exportRepository,
  llmModelRepo,
  llmProviderRepo,
  personaRepository,
} from "@/utils/db/repositories";
import {
  buildSavedProviderConfigFromExistingOrDefaults,
  buildUserSavedProviderConfigFromExistingOrDefaults,
} from "@/utils/provider/savedProviderConfig";
import {
  activateSupporterDefaults,
  ensurePersonalSupporterDefaults,
  persistSupporterSponsorship,
} from "@/modules/supporter-billing/discord/sponsorship";
import { saveProviderModel } from "@/utils/provider/providerPanelOperations";
import {
  configModelOperations,
  loadConfigModelProviders,
  loadConfigModelChoices,
} from "@/utils/discord/interactions/configModelOperations";
import { useEnvSandbox } from "../../helpers/env";
import { log } from "@/utils/misc/logger";
import { fetchPatreonCampaignMemberPayloads } from "@/modules/supporter-billing/patreon/reconcile";
import {
  checkSupporterBillingTablesExist,
  initializeSupporterBilling,
  initializeSupporterBillingSchema,
  runSupporterBillingMaintenance,
  SUPPORTER_BILLING_TABLE_NAMES,
  SupporterEntitlementRepository,
  SupporterIdentityRepository,
  SupporterSponsorshipRepository,
  SupporterUsageStatisticsRepository,
  SupporterWebhookEventRepository,
} from "@/modules/supporter-billing";
import { recordSupporterUsage } from "@/modules/supporter-billing/runtime/usageStatistics";
import {
  persistEligiblePatreonSupporter,
  persistPatreonMemberState,
} from "@/modules/supporter-billing/patreon/persistence";
import { handlePatreonWebhookRawBody } from "@/modules/supporter-billing/patreon/webhook";
import { computePatreonWebhookSignature } from "@/modules/supporter-billing/patreon/webhookVerifier";
import { FIXTURE_IDS, cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";
import { callDecisionsForProvider, loadDecisionModelsForScope } from "@/providers/utils/providerFeatureExecutors";
import { resetOpenRouterCapabilityCache } from "@/utils/cache/openrouterCapabilityCache";
import { resolveCapabilityCredentials } from "@/utils/provider/credentialResolver";
import { loadUserSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
import {
  loadAvailableModelsForCapability,
  loadPersonalModelDisplayInfo,
} from "@/utils/discord/interactions/personalConfigLoaders";
import { resolveSupporterFunding } from "@/modules/supporter-billing/runtime/funding";
import { activatePersonalProviderTextModel } from "@/utils/provider/providerActivation";
import { invalidateUserCache } from "@/utils/cache/userCache";
import { loadConfigPersonaVoiceView } from "@/utils/discord/interactions/configPersonaVoiceLoader";

const validSupporterConfig: import("@/modules/supporter-billing/config").SupporterBillingConfig = {
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
      defaultModelByCapability: { text: "test/provider-model" },
    },
  },
};

const LEGACY_ACCOUNTING_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS supporter_usage_periods (
      usage_period_id SERIAL PRIMARY KEY,
      supporter_identity_id INTEGER NOT NULL REFERENCES supporter_identities(supporter_identity_id) ON DELETE CASCADE,
      tier_key TEXT NOT NULL,
      period_start TIMESTAMPTZ NOT NULL,
      period_end TIMESTAMPTZ NOT NULL,
      budget_micros BIGINT NOT NULL,
      reserved_micros BIGINT NOT NULL DEFAULT 0,
      spent_micros BIGINT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT supporter_usage_periods_identity_period_key UNIQUE (
        supporter_identity_id,
        period_start,
        period_end
      ),
      CONSTRAINT supporter_usage_periods_budget_micros_check CHECK (budget_micros >= 0),
      CONSTRAINT supporter_usage_periods_reserved_micros_check CHECK (reserved_micros >= 0),
      CONSTRAINT supporter_usage_periods_spent_micros_check CHECK (spent_micros >= 0),
      CONSTRAINT supporter_usage_periods_status_check CHECK (status IN ('active', 'exhausted', 'closed', 'void')),
      CONSTRAINT supporter_usage_periods_period_order_check CHECK (period_end > period_start)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS supporter_usage_reservations (
      reservation_id SERIAL PRIMARY KEY,
      usage_period_id INTEGER NOT NULL REFERENCES supporter_usage_periods(usage_period_id) ON DELETE CASCADE,
      server_id INTEGER REFERENCES servers(server_id) ON DELETE SET NULL,
      server_disc_id TEXT NOT NULL,
      channel_disc_id TEXT NOT NULL,
      trigger_user_disc_id TEXT NOT NULL,
      estimated_micros BIGINT NOT NULL,
      settled_micros BIGINT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'reserved',
      idempotency_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      settled_at TIMESTAMPTZ,
      submitted_at TIMESTAMPTZ,
      provider_request_id TEXT,
      funding_scope TEXT NOT NULL DEFAULT 'server' CHECK (funding_scope IN ('server', 'personal')),
      capability TEXT NOT NULL DEFAULT 'text' CHECK (capability IN ('text', 'vision', 'image', 'video', 'voice', 'decision', 'embedding')),
      CONSTRAINT supporter_usage_reservations_idempotency_key_key UNIQUE (idempotency_key),
      CONSTRAINT supporter_usage_reservations_estimated_micros_check CHECK (estimated_micros > 0),
      CONSTRAINT supporter_usage_reservations_settled_micros_check CHECK (settled_micros >= 0),
      CONSTRAINT supporter_usage_reservations_status_check CHECK (
        status IN ('reserved', 'settled', 'released', 'expired', 'failed')
      )
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS supporter_usage_events (
      usage_event_id SERIAL PRIMARY KEY,
      usage_period_id INTEGER NOT NULL REFERENCES supporter_usage_periods(usage_period_id) ON DELETE CASCADE,
      reservation_id INTEGER REFERENCES supporter_usage_reservations(reservation_id) ON DELETE SET NULL,
      server_id INTEGER REFERENCES servers(server_id) ON DELETE SET NULL,
      server_disc_id TEXT NOT NULL,
      channel_disc_id TEXT NOT NULL,
      trigger_user_disc_id TEXT NOT NULL,
      openrouter_generation_id TEXT,
      model_codename TEXT NOT NULL,
      provider TEXT NOT NULL,
      funding_scope TEXT NOT NULL DEFAULT 'server' CHECK (funding_scope IN ('server', 'personal')),
      capability TEXT NOT NULL DEFAULT 'text' CHECK (capability IN ('text', 'vision', 'image', 'video', 'voice', 'decision', 'embedding')),
      prompt_tokens BIGINT,
      completion_tokens BIGINT,
      reasoning_tokens BIGINT,
      cached_tokens BIGINT,
      total_tokens BIGINT,
      cost_micros BIGINT NOT NULL,
      cost_source TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT supporter_usage_events_prompt_tokens_check CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
      CONSTRAINT supporter_usage_events_completion_tokens_check CHECK (
        completion_tokens IS NULL OR completion_tokens >= 0
      ),
      CONSTRAINT supporter_usage_events_reasoning_tokens_check CHECK (
        reasoning_tokens IS NULL OR reasoning_tokens >= 0
      ),
      CONSTRAINT supporter_usage_events_cached_tokens_check CHECK (cached_tokens IS NULL OR cached_tokens >= 0),
      CONSTRAINT supporter_usage_events_total_tokens_check CHECK (total_tokens IS NULL OR total_tokens >= 0),
      CONSTRAINT supporter_usage_events_cost_micros_check CHECK (cost_micros >= 0),
      CONSTRAINT supporter_usage_events_cost_source_check CHECK (
        cost_source IN ('openrouter_response', 'openrouter_generation_lookup', 'estimated_fallback')
      )
    )
  `,
] as const;

function createEnabledEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    TOMORI_PUBLIC_BASE_URL: "https://bot.example.test",
    TOMORI_SUPPORTER_BILLING_ENABLED: "true",
    TOMORI_SUPPORTER_CONFIG_JSON: JSON.stringify(validSupporterConfig),
    TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY: "synthetic-management-key",
    TOMORI_SUPPORTER_PATREON_CLIENT_ID: "test-patreon-client-id",
    TOMORI_SUPPORTER_PATREON_CLIENT_SECRET: "test-patreon-client-secret",
    TOMORI_SUPPORTER_PATREON_WEBHOOK_SECRET: "test-patreon-webhook-secret",
    TOMORI_SUPPORTER_PATREON_CREATOR_REFRESH_TOKEN: "test-patreon-creator-access-token",
    ...overrides,
  };
}

async function dropSupporterBillingTables(): Promise<void> {
  await testSql`DROP SCHEMA IF EXISTS supporter_accounting_archive CASCADE`;
  for (const tableName of [...SUPPORTER_BILLING_TABLE_NAMES].reverse()) {
    await testSql.unsafe(`DROP TABLE IF EXISTS ${tableName} CASCADE`);
  }
}

async function expectAllBillingTablesExist(expected: boolean): Promise<void> {
  const tableStates = await checkSupporterBillingTablesExist(testSql);
  expect(Object.values(tableStates).every((exists) => exists === expected)).toBe(true);
}

async function createSupporterFixture(suffix: string, discordUserId = `_rt_supporter_${suffix}`) {
  return new SupporterIdentityRepository(testSql).upsertIdentity({
    discordUserId,
    patreonUserId: `_rt_patreon_user_${suffix}`,
    patreonMemberId: `_rt_patreon_member_${suffix}`,
    patreonCampaignId: "campaign_test",
  });
}

async function revokeServerSponsorships(serverId: number): Promise<void> {
  await testSql`UPDATE supporter_server_sponsorships SET status = 'revoked', revoked_at = NOW()
    WHERE server_id = ${serverId} AND status = 'active'`;
}

describe.skipIf(!DB_TESTS_AVAILABLE)("Supporter billing — gated DB schema", () => {
  useEnvSandbox([
    "RUN_ENV",
    "TOMORI_SUPPORTER_BILLING_ENABLED",
    "TOMORI_SUPPORTER_CONFIG_JSON",
    "TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY",
  ]);
  let refs: FixtureRefs;

  beforeAll(async () => {
    await setupTestDb();
    // Earlier DB-lane files replay migrations on scoped_model_registrations after the shared pool cached RETURNING * plans.
    resetDatabaseConnection();
    refs = await insertFixtures(testSql);
    invalidateUserCache(FIXTURE_IDS.userDiscId);
  });

  afterAll(async () => {
    await dropSupporterBillingTables();
    await cleanupFixtures(testSql);
  });

  it("keeps billing tables absent until production billing startup is enabled, then initializes idempotently", async () => {
    await dropSupporterBillingTables();

    const disabledResult = await initializeSupporterBilling({
      environment: "production",
      env: createEnabledEnv({ TOMORI_SUPPORTER_BILLING_ENABLED: "false" }),
      billingClient: testSql,
    });

    expect(disabledResult.enabled).toBe(false);
    await expectAllBillingTablesExist(false);

    const enabledResult = await initializeSupporterBilling({
      environment: "production",
      env: createEnabledEnv(),
      billingClient: testSql,
      initializePatreonRoutes: () => undefined,
      startPatreonReconcileJob: () => ({ stop: () => undefined }),
    });

    expect(enabledResult.enabled).toBe(true);
    if (!enabledResult.enabled) throw new Error("Supporter billing was not initialized");
    await expectAllBillingTablesExist(true);

    await initializeSupporterBillingSchema(testSql);
    await expectAllBillingTablesExist(true);
    const [retired] = await testSql`
      SELECT to_regnamespace('supporter_accounting_archive') AS archive,
        to_regclass('public.supporter_usage_periods') AS periods,
        to_regclass('public.supporter_usage_reservations') AS reservations,
        to_regclass('public.supporter_usage_events') AS events
    `;
    expect(retired).toEqual({ archive: null, periods: null, reservations: null, events: null });
  });
  it("starts billing with runtime DML grants after privileged initialization and refuses incomplete grants or schema", async () => {
    const role = `billing_runtime_${randomUUID().replaceAll("-", "")}`;
    const rollback = new Error("rollback permission rehearsal");
    await dropSupporterBillingTables();
    try {
      await expect(
        testSql.begin(async (tx) => {
          await tx.unsafe(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
          await tx`REVOKE CREATE ON SCHEMA public FROM PUBLIC`;
          await tx.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
          await tx.unsafe(
            `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
          );
          await tx.unsafe(
            `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${role}`,
          );
          await tx.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_states TO ${role}`);
          await tx.unsafe(`GRANT USAGE, SELECT, UPDATE ON SEQUENCE oauth_states_oauth_state_id_seq TO ${role}`);
          await tx.unsafe(`GRANT EXECUTE ON FUNCTION update_timestamp() TO ${role}`);
          await initializeSupporterBillingSchema(tx);
          await initializeSupporterBillingSchema(tx);

          const start = (client: SQL, routes: () => void = () => undefined) =>
            initializeSupporterBilling({
              environment: "production",
              env: createEnabledEnv({ DATABASE_SCHEMA_MANAGEMENT_ENABLED: "false" }),
              billingClient: client,
              initializePatreonRoutes: routes,
              startPatreonReconcileJob: () => ({ stop: () => undefined }),
            });

          await tx.savepoint(async (runtime) => {
            await runtime.unsafe(`SET LOCAL ROLE ${role}`);
            const [permissions] = await runtime`
              SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS can_create,
                current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class
                  WHERE oid = 'supporter_identities'::regclass) AS owns_tables
            `;
            expect(permissions).toEqual({ can_create: false, owns_tables: false });
            expect((await start(runtime)).enabled).toBe(true);
            const identities = new SupporterIdentityRepository(runtime);
            const params = {
              discordUserId: "_rt_supporter_runtime",
              patreonUserId: "_rt_patreon_runtime",
              patreonMemberId: "_rt_member_runtime",
              patreonCampaignId: "campaign_test",
            };
            const identity = await identities.upsertIdentity(params);
            const updated = await identities.upsertIdentity({ ...params, patreonMemberId: "_rt_member_updated" });
            expect(updated.supporter_identity_id).toBe(identity.supporter_identity_id);
            expect((await identities.loadById(identity.supporter_identity_id))?.patreon_member_id).toBe(
              "_rt_member_updated",
            );
            const deleted = await runtime`
              DELETE FROM supporter_identities WHERE supporter_identity_id = ${identity.supporter_identity_id}
              RETURNING supporter_identity_id
            `;
            expect(deleted).toHaveLength(1);
            await runtime`RESET ROLE`;
          });

          for (const change of [
            `REVOKE INSERT ON supporter_webhook_events FROM ${role}`,
            `REVOKE USAGE ON SEQUENCE supporter_identities_supporter_identity_id_seq FROM ${role}`,
            "ALTER TABLE supporter_usage_statistics DROP COLUMN input_tokens",
            "ALTER TABLE supporter_member_keys DROP COLUMN detached_retention_started_at",
            "ALTER TABLE supporter_member_keys DROP COLUMN retention_hold",
            "DROP TABLE supporter_webhook_events",
          ]) {
            let routesOpened = false;
            await expect(
              tx.savepoint(async (runtime) => {
                await runtime.unsafe(change);
                await runtime.unsafe(`SET LOCAL ROLE ${role}`);
                await start(runtime, () => {
                  routesOpened = true;
                });
              }),
            ).rejects.toBeInstanceOf(Error);
            expect(routesOpened).toBe(false);
          }
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await initializeSupporterBillingSchema(testSql);
    }
  });

  it("archives legacy accounting rows, relationships and sequences without reopening runtime tables", async () => {
    const identity = await createSupporterFixture("accounting_retirement");
    for (const statement of LEGACY_ACCOUNTING_SCHEMA_STATEMENTS) await testSql.unsafe(statement);
    const [period] = await testSql`
      INSERT INTO supporter_usage_periods (supporter_identity_id, tier_key, period_start, period_end, budget_micros, reserved_micros, spent_micros)
      VALUES (${identity.supporter_identity_id}, 'test_tier', NOW() - INTERVAL '1 day', NOW() + INTERVAL '29 days', 100000, 2000, 1500)
      RETURNING usage_period_id
    `;
    await testSql`
      INSERT INTO supporter_usage_reservations (usage_period_id, server_id, server_disc_id, channel_disc_id, trigger_user_disc_id, estimated_micros, idempotency_key, expires_at, submitted_at, provider_request_id, funding_scope, capability)
      VALUES (${period.usage_period_id}, ${refs.serverId}, ${FIXTURE_IDS.serverDiscId}, 'fixture-channel', ${FIXTURE_IDS.userDiscId}, 2000, 'retired-hold', NOW() + INTERVAL '1 hour', NOW(), 'fixture-pending-video', 'server', 'video')
      RETURNING reservation_id
    `;
    const [reservation] = await testSql`
      INSERT INTO supporter_usage_reservations (usage_period_id, server_id, server_disc_id, channel_disc_id, trigger_user_disc_id, estimated_micros, settled_micros, status, idempotency_key, expires_at, submitted_at, settled_at, provider_request_id)
      VALUES (${period.usage_period_id}, ${refs.serverId}, ${FIXTURE_IDS.serverDiscId}, 'fixture-channel', ${FIXTURE_IDS.userDiscId}, 1500, 1500, 'settled', 'retired-settlement', NOW() + INTERVAL '1 hour', NOW(), NOW(), 'fixture-generation')
      RETURNING reservation_id
    `;
    await testSql`
      INSERT INTO supporter_usage_events (usage_period_id, reservation_id, server_id, server_disc_id, channel_disc_id, trigger_user_disc_id, openrouter_generation_id, model_codename, provider, funding_scope, capability, prompt_tokens, cost_micros, cost_source)
      VALUES (${period.usage_period_id}, ${reservation.reservation_id}, ${refs.serverId}, ${FIXTURE_IDS.serverDiscId}, 'fixture-channel', ${FIXTURE_IDS.userDiscId}, 'fixture-generation', 'test/model', 'openrouter', 'server', 'text', 10, 1500, 'openrouter_response')
    `;
    const before = [
      await testSql`SELECT to_jsonb(t) AS row FROM supporter_usage_periods t`,
      await testSql`SELECT to_jsonb(t) AS row FROM supporter_usage_reservations t`,
      await testSql`SELECT to_jsonb(t) AS row FROM supporter_usage_events t`,
    ];
    await initializeSupporterBillingSchema(testSql);
    await initializeSupporterBillingSchema(testSql);
    const after = [
      await testSql`SELECT to_jsonb(t) AS row FROM supporter_accounting_archive.supporter_usage_periods t`,
      await testSql`SELECT to_jsonb(t) AS row FROM supporter_accounting_archive.supporter_usage_reservations t`,
      await testSql`SELECT to_jsonb(t) AS row FROM supporter_accounting_archive.supporter_usage_events t`,
    ];
    expect(after).toEqual(before);
    const [state] = await testSql`
      SELECT to_regclass('public.supporter_usage_periods') AS periods,
        to_regclass('public.supporter_usage_reservations') AS reservations,
        to_regclass('public.supporter_usage_events') AS events,
        pg_get_serial_sequence('supporter_accounting_archive.supporter_usage_reservations', 'reservation_id') AS sequence
    `;
    expect(state).toMatchObject({ periods: null, reservations: null, events: null });
    expect(state.sequence).toBe("supporter_accounting_archive.supporter_usage_reservations_reservation_id_seq");
    const [relationship] = await testSql`
      SELECT confrelid::regclass::text AS target FROM pg_constraint
      WHERE conrelid = 'supporter_accounting_archive.supporter_usage_reservations'::regclass
        AND conname = 'supporter_usage_reservations_usage_period_id_fkey'
    `;
    expect(relationship.target).toBe("supporter_accounting_archive.supporter_usage_periods");
    expect(await new SupporterIdentityRepository(testSql).loadById(identity.supporter_identity_id)).toEqual(identity);
    await testSql`DROP SCHEMA supporter_accounting_archive CASCADE`;
  });

  it("leaves legacy tables intact if the archive destination conflicts", async () => {
    for (const statement of LEGACY_ACCOUNTING_SCHEMA_STATEMENTS) await testSql.unsafe(statement);
    await testSql`CREATE SCHEMA supporter_accounting_archive`;
    await testSql`CREATE TABLE supporter_accounting_archive.supporter_usage_reservations (marker TEXT)`;
    await testSql`INSERT INTO supporter_accounting_archive.supporter_usage_reservations VALUES ('existing-archive')`;
    try {
      await expect(initializeSupporterBillingSchema(testSql)).rejects.toBeDefined();
      const [state] = await testSql`
        SELECT to_regclass('public.supporter_usage_periods') IS NOT NULL AS periods,
          to_regclass('public.supporter_usage_reservations') IS NOT NULL AS reservations,
          to_regclass('public.supporter_usage_events') IS NOT NULL AS events
      `;
      expect(state).toEqual({ periods: true, reservations: true, events: true });
      expect(
        await testSql<
          Array<{ marker: string }>
        >`SELECT marker FROM supporter_accounting_archive.supporter_usage_reservations`,
      ).toEqual([{ marker: "existing-archive" }]);
    } finally {
      await testSql`DROP SCHEMA supporter_accounting_archive CASCADE`;
      await initializeSupporterBillingSchema(testSql);
      await testSql`DROP SCHEMA supporter_accounting_archive CASCADE`;
    }
  });

  it("purges old OAuth and webhook receipts while retaining recent replay protection", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    const oauth = new OAuthStateRepository(testSql);
    const webhook = new SupporterWebhookEventRepository(testSql);
    for (const [suffix, at] of [
      ["old", old],
      ["recent", now],
    ] as const) {
      await oauth.recordStateNonce({
        flow: "patreon",
        nonceHash: `maintenance-${suffix}`,
        subject: FIXTURE_IDS.userDiscId,
        expiresAt: at,
        createdAt: new Date(at.getTime() - 1000),
      });
      const receipt = await webhook.recordReceipt({
        patreonEventId: `maintenance-${suffix}`,
        eventType: "members:update",
        idempotencyKey: `maintenance-${suffix}`,
        payloadHash: `maintenance-${suffix}`,
        receivedAt: at,
      });
      await webhook.markProcessed(receipt.webhook_event_id, "processed", null, at);
    }
    const result = await runSupporterBillingMaintenance({ client: testSql, now });
    expect(result.purgedOAuthStates).toBeGreaterThanOrEqual(1);
    expect(result.purgedWebhookEvents).toBeGreaterThanOrEqual(1);
    expect(await webhook.loadByIdempotencyKey("maintenance-old")).toBeNull();
    expect(await webhook.loadByIdempotencyKey("maintenance-recent")).not.toBeNull();
    const rows = await testSql<
      Array<{ nonce_hash: string }>
    >`SELECT nonce_hash FROM oauth_states WHERE nonce_hash IN ('maintenance-old', 'maintenance-recent')`;
    expect(rows.map((row) => row.nonce_hash)).toEqual(["maintenance-recent"]);
  });

  it("activates personal subscription models and funds owned Decisions without overwriting BYOK credentials", async () => {
    await initializeSupporterBillingSchema(testSql);
    const identity = await createSupporterFixture("personal_registration", FIXTURE_IDS.userDiscId);
    await new SupporterEntitlementRepository(testSql).upsertSnapshot({
      supporterIdentityId: identity.supporter_identity_id,
      tierKey: "test_tier",
      patreonTierId: "tier_test",
      patronStatus: "active_patron",
      isActive: true,
      periodStart: new Date(Date.now() - 60_000),
      periodEnd: new Date(Date.now() + 3_600_000),
      lastVerifiedAt: new Date(),
      source: "oauth",
    });
    const memberKeys = new MemberKeyRepository(testSql);
    const initial = await memberKeys.initialize(identity);
    const created = await memberKeys.storeCreated(initial, "synthetic-routing-hash", "synthetic-member-key");
    await memberKeys.save({ ...created, applied_limit: 0.1, disabled: false, pending_action: null });
    await applicationSql`SELECT 1`;
    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    const byokModel = await llmModelRepo.loadDefaultModel("openrouter");
    if (!state || !byokModel?.llm_id) throw new Error("Expected a configured workspace and OpenRouter model");
    const key = await encryptApiKey("test-personal-openrouter-key");
    const byok = await buildUserSavedProviderConfigFromExistingOrDefaults({
      userId: refs.userId,
      provider: "openrouter",
      apiKey: key.encrypted,
      keyVersion: key.version,
      baseConfig: state.config,
      llmId: byokModel.llm_id,
      enabledCapabilities: ["text"],
    });
    expect(
      await llmProviderRepo.upsertUserSavedProviderConfig(refs.userId, { ...byok, llm_max_output_tokens: 1777 }),
    ).toBe(true);
    const config = structuredClone(validSupporterConfig);
    config.tiers.test_tier.defaultModelByCapability.text = "test/personal-default";
    config.tiers.test_tier.defaultModelByCapability.embedding = "test/personal-embedding";
    config.tiers.test_tier.defaultModelByCapability.image = "test/personal-image";
    config.tiers.test_tier.defaultModelByCapability.decision = "test/personal-decision";
    config.tiers.test_tier.defaultModelByCapability.video = "test/personal-video";
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY = "synthetic-management-key";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    process.env.TOMORI_SUPPORTER_CONFIG_JSON = JSON.stringify(config);
    resetOpenRouterCapabilityCache();
    const decisionCredentials: Array<string | null> = [];
    let validDecisionAnswers = false;
    let decisionKeyLimited = false;
    const request = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: string | URL | Request, init?: RequestInit) => {
          const url = input instanceof Request ? input.url : String(input);
          if (url.includes("/keys/"))
            return Response.json({
              data: createMemberKeyMetadata({ hash: url.slice(url.lastIndexOf("/") + 1), limit: 0.1 }),
            });
          if (String(input).endsWith("/videos/models"))
            return Response.json({
              data: [
                {
                  id: "test/personal-video",
                  supported_durations: [5],
                  supported_resolutions: ["480p"],
                  supported_aspect_ratios: ["16:9"],
                  generate_audio: false,
                  pricing_skus: { duration_seconds: "0.0004" },
                },
                {
                  id: "test/unpriced-video",
                  supported_durations: [5],
                  supported_resolutions: ["480p"],
                  supported_aspect_ratios: ["16:9"],
                  generate_audio: false,
                  pricing_skus: { video_tokens: "0.001" },
                },
              ],
            });
          if (String(input).endsWith("/models?output_modalities=decisions"))
            return Response.json({
              data: [
                {
                  id: "test/personal-decision",
                  context_length: 1000,
                  architecture: { input_modalities: ["text"], output_modalities: ["decisions"] },
                  pricing: { prompt: "0.000001", completion: "0" },
                },
                {
                  id: "test/personal-decision-edited",
                  context_length: 1000,
                  architecture: { input_modalities: ["text"], output_modalities: ["decisions"] },
                  pricing: { prompt: "0.000001", completion: "0" },
                },
              ],
            });
          if (String(input).endsWith("/api/alpha/decisions") && decisionKeyLimited)
            return Response.json(
              {
                error: { code: 402, message: "Key limit exceeded", metadata: { limit_source: "openrouter_key_limit" } },
              },
              { status: 402 },
            );
          if (String(input).endsWith("/api/alpha/decisions")) {
            decisionCredentials.push(new Headers(init?.headers).get("Authorization"));
            return Response.json({
              id: `gen_owned_decision_${decisionCredentials.length}`,
              model: "test/personal-decision",
              answers: validDecisionAnswers ? { criterion: { type: "noul", noul: 0.1 } } : {},
              usage: { input_tokens: 8, output_tokens: 0, cost: 0.0001 },
            });
          }
          if (String(input).endsWith("/images/models"))
            return Response.json({
              data: [{ id: "test/personal-image", architecture: { output_modalities: ["image"] } }],
            });
          if (String(input).endsWith("/images/models/test/personal-image/endpoints"))
            return Response.json({
              id: "test/personal-image",
              endpoints: [
                {
                  provider_tag: "fixture-image-provider",
                  supported_parameters: {
                    n: { type: "range", min: 1, max: 1 },
                    aspect_ratio: { type: "enum", values: ["1:1"] },
                  },
                  pricing: [{ billable: "output_image", unit: "image", cost_usd: "0.001" }],
                },
              ],
            });
          if (String(input).endsWith("/embeddings/models"))
            return Response.json({
              data: [
                {
                  id: "test/personal-embedding",
                  context_length: 1000,
                  architecture: { modality: "text->embeddings", output_modalities: ["embeddings"] },
                  pricing: { prompt: "0.000001", completion: "0" },
                },
              ],
            });
          if (!String(input).endsWith("/models")) throw new Error("Registration must not make an inference request");
          return Response.json({
            data: ["test/personal-default", "test/personal-registered"].map((id) => ({
              id,
              context_length: 1000,
              architecture: { modality: "text->text" },
              supported_parameters: ["max_tokens"],
              pricing: { prompt: "0.000001", completion: "0.000001" },
            })),
          });
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    try {
      await activateSupporterDefaults({
        kind: "personal",
        userId: refs.userId,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        state,
      });
      const subscription = await llmProviderRepo.loadUserSavedProviderConfig(refs.userId, "supporter");
      const preserved = await llmProviderRepo.loadUserSavedProviderConfig(refs.userId, "openrouter");
      expect(subscription?.api_key).toBeNull();
      expect(subscription?.enabled_capabilities).toContain("text");
      expect(preserved?.api_key?.equals(key.encrypted)).toBe(true);
      expect(preserved?.llm_max_output_tokens).toBe(1777);
      expect(preserved?.enabled_capabilities).not.toContain("text");
      const result = await saveProviderModel({
        serverDiscId: FIXTURE_IDS.serverDiscId,
        ownerId: refs.userId,
        scopeKind: "personal",
        state,
        entryId: "provider:supporter",
        capability: "text",
        codeName: "test/personal-registered",
      });
      expect(result.status).toBe("success");
      const selected = await llmProviderRepo.loadUserSavedProviderConfig(refs.userId, "supporter");
      const model = selected?.llm_id ? await llmModelRepo.loadById(selected.llm_id) : null;
      expect(model).toMatchObject({ llm_provider: "openrouter", llm_codename: "test/personal-registered" });
      const embedded = await saveProviderModel({
        serverDiscId: FIXTURE_IDS.serverDiscId,
        ownerId: refs.userId,
        scopeKind: "personal",
        state,
        entryId: "provider:supporter",
        capability: "embedding",
        codeName: "test/personal-embedding",
      });
      expect(embedded.status).toBe("success");
      const registeredDecision = await saveProviderModel({
        serverDiscId: FIXTURE_IDS.serverDiscId,
        ownerId: refs.userId,
        scopeKind: "personal",
        state,
        entryId: "provider:supporter",
        capability: "decision",
        codeName: "test/personal-decision",
      });
      expect(registeredDecision.status).toBe("success");
      const personalScope = { kind: "personal" as const, ownerId: refs.userId };
      const decision = (await loadDecisionModelsForScope(personalScope)).find(
        (option) => option.model.codename === "test/personal-decision",
      );
      if (!decision) throw new Error("Expected the owned Decision model");
      const personalFunding = await resolveSupporterFunding({
        scope: { kind: "personal", userId: refs.userId },
        capability: "text",
      });
      if (!personalFunding.ok) throw new Error("Expected active personal funding");
      const decisionRequest = {
        scope: personalScope,
        reference: decision.reference,
        evidence: "Fixture evidence",
        questions: [{ type: "predicate" as const, id: "criterion", instructions: "Fixture criterion" }],
        supporterFunding: personalFunding.context,
      };
      expect(await callDecisionsForProvider(decisionRequest)).toMatchObject({
        status: "failed",
        category: "malformed",
      });
      validDecisionAnswers = true;
      expect(await callDecisionsForProvider(decisionRequest)).toMatchObject({ status: "completed" });
      const decisionUsage = async () =>
        testSql`
          SELECT funding_scope, server_id, model_codename, cost_usd,
            input_tokens::float8 AS input_tokens, output_tokens::float8 AS output_tokens
          FROM supporter_usage_statistics
          WHERE supporter_identity_id = ${identity.supporter_identity_id} AND capability = 'decision'
        `;
      for (let attempt = 0; attempt < 50 && (await decisionUsage()).length < 2; attempt++) await Bun.sleep(10);
      expect(await decisionUsage()).toEqual([
        {
          funding_scope: "personal",
          server_id: null,
          model_codename: "test/personal-decision",
          cost_usd: 0.0001,
          input_tokens: 8,
          output_tokens: 0,
        },
        {
          funding_scope: "personal",
          server_id: null,
          model_codename: "test/personal-decision",
          cost_usd: 0.0001,
          input_tokens: 8,
          output_tokens: 0,
        },
      ]);
      decisionKeyLimited = true;
      expect(await callDecisionsForProvider(decisionRequest)).toMatchObject({
        status: "denied",
        error: { reason: "allowance_exhausted", capability: "decision", fundingScope: "personal" },
      });
      decisionKeyLimited = false;
      expect(
        await callDecisionsForProvider({ ...decisionRequest, scope: { kind: "personal", ownerId: refs.userId + 1 } }),
      ).toMatchObject({ status: "unavailable", reason: "not-owned" });
      const serverScope = { kind: "server" as const, ownerId: refs.serverId };
      expect(
        await callDecisionsForProvider({ ...decisionRequest, scope: serverScope, supporterFunding: undefined }),
      ).toMatchObject({ status: "unavailable", reason: "not-owned" });
      await new SupporterSponsorshipRepository(testSql).startActiveSponsorship({
        serverId: refs.serverId,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        sponsorIdentityId: identity.supporter_identity_id,
        createdByDiscId: FIXTURE_IDS.userDiscId,
      });
      await llmProviderRepo.upsertDecisionModelRegistration({
        serverId: refs.serverId,
        decisionModelId: decision.model.decision_model_id,
      });
      const serverDecision = (await loadDecisionModelsForScope(serverScope)).find(
        (option) => option.model.decision_model_id === decision.model.decision_model_id,
      );
      if (!serverDecision) throw new Error("Expected the independently registered server Decision");
      expect(
        await llmProviderRepo.upsertSavedProviderConfig(
          refs.serverId,
          await buildSavedProviderConfigFromExistingOrDefaults({
            serverId: refs.serverId,
            provider: "supporter",
            apiKey: null,
            keyVersion: 1,
            baseConfig: state.config,
          }),
        ),
      ).toBe(true);
      expect(
        (await loadConfigModelProviders(refs.serverId, "decision")).some((provider) => provider === "supporter"),
      ).toBe(true);
      expect(
        await configModelOperations.setCapabilityModel({
          tomoriState: state,
          serverDiscId: FIXTURE_IDS.serverDiscId,
          capability: "decision",
          provider: "supporter",
          modelId: serverDecision.model.decision_model_id,
        }),
      ).toMatchObject({ status: "success" });
      const [selectedDecision] =
        await testSql`SELECT decision_model_id FROM server_model_configs WHERE server_id = ${refs.serverId}`;
      expect(selectedDecision.decision_model_id).toBe(serverDecision.model.decision_model_id);
      expect(
        await configModelOperations.clearCapabilityModel({
          tomoriState: { ...state, config: { ...state.config, decision_model_id: selectedDecision.decision_model_id } },
          serverDiscId: FIXTURE_IDS.serverDiscId,
          capability: "decision",
        }),
      ).toMatchObject({ status: "success" });
      expect(
        await callDecisionsForProvider({
          ...decisionRequest,
          scope: serverScope,
          reference: serverDecision.reference,
          supporterFunding: undefined,
        }),
      ).toMatchObject({ status: "completed" });
      expect(await callDecisionsForProvider({ ...decisionRequest, supporterFunding: undefined })).toMatchObject({
        status: "completed",
      });
      expect(decisionCredentials).toEqual([
        "Bearer synthetic-member-key",
        "Bearer synthetic-member-key",
        "Bearer synthetic-member-key",
        "Bearer test-personal-openrouter-key",
      ]);
      delete config.tiers.test_tier.defaultModelByCapability.decision;
      process.env.TOMORI_SUPPORTER_CONFIG_JSON = JSON.stringify(config);
      expect(await callDecisionsForProvider(decisionRequest)).toMatchObject({ status: "completed" });
      expect(decisionCredentials[4]).toBe("Bearer test-personal-openrouter-key");
      process.env.TOMORI_SUPPORTER_CONFIG_JSON = JSON.stringify({
        ...config,
        tiers: {
          test_tier: {
            ...config.tiers.test_tier,
            defaultModelByCapability: {
              ...config.tiers.test_tier.defaultModelByCapability,
              decision: "test/personal-decision",
            },
          },
        },
      });
      process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "false";
      expect(await callDecisionsForProvider(decisionRequest)).toMatchObject({
        status: "denied",
        error: { reason: "unsupported_capability" },
      });
      expect(decisionCredentials).toHaveLength(5);
      process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
      if (!preserved) throw new Error("Expected preserved BYOK configuration");
      expect(await llmProviderRepo.deleteUserSavedProviderConfig(refs.userId, "openrouter")).toBe(true);
      expect(
        (await loadDecisionModelsForScope(personalScope)).some(
          (option) => option.reference.modelId === decision.reference.modelId,
        ),
      ).toBe(true);
      expect(await callDecisionsForProvider(decisionRequest)).toMatchObject({ status: "completed" });
      expect(decisionCredentials[5]).toBe("Bearer synthetic-member-key");
      expect(await llmProviderRepo.upsertUserSavedProviderConfig(refs.userId, preserved)).toBe(true);
      const editedDecision = await saveProviderModel({
        serverDiscId: FIXTURE_IDS.serverDiscId,
        ownerId: refs.userId,
        scopeKind: "personal",
        state,
        entryId: "provider:supporter",
        capability: "decision",
        codeName: "test/personal-decision-edited",
        editingModelId: decision.model.decision_model_id,
      });
      expect(editedDecision.status).toBe("success");
      const edited = (await loadDecisionModelsForScope(personalScope)).find(
        (option) => option.model.codename === "test/personal-decision-edited",
      );
      if (!edited) throw new Error("Expected the edited Decision registration");
      expect(await callDecisionsForProvider(decisionRequest)).toMatchObject({
        status: "unavailable",
        reason: "not-owned",
      });
      expect(
        (await loadDecisionModelsForScope(serverScope)).some(
          (option) => option.reference.modelId === decision.reference.modelId,
        ),
      ).toBe(true);
      expect(
        await saveProviderModel({
          serverDiscId: FIXTURE_IDS.serverDiscId,
          ownerId: refs.userId,
          scopeKind: "personal",
          state,
          entryId: "provider:supporter",
          capability: "decision",
          codeName: edited.model.codename,
          editingModelId: edited.model.decision_model_id,
          removeDecisionModel: true,
        }),
      ).toMatchObject({ status: "success", removed: true });
      expect(
        (await loadDecisionModelsForScope(personalScope)).some(
          (option) => option.reference.modelId === edited.reference.modelId,
        ),
      ).toBe(false);
      const registeredImage = await saveProviderModel({
        serverDiscId: FIXTURE_IDS.serverDiscId,
        ownerId: refs.userId,
        scopeKind: "personal",
        state,
        entryId: "provider:supporter",
        capability: "image",
        codeName: "test/personal-image",
      });
      expect(registeredImage.status).toBe("success");
      expect(
        await saveProviderModel({
          serverDiscId: FIXTURE_IDS.serverDiscId,
          ownerId: refs.userId,
          scopeKind: "personal",
          state,
          entryId: "provider:supporter",
          capability: "video",
          codeName: "test/unpriced-video",
        }),
      ).toMatchObject({ status: "success" });
      expect(
        await saveProviderModel({
          serverDiscId: FIXTURE_IDS.serverDiscId,
          ownerId: refs.userId,
          scopeKind: "personal",
          state,
          entryId: "provider:supporter",
          capability: "video",
          codeName: "test/personal-video",
        }),
      ).toMatchObject({ status: "success" });
      const videoBinding = await resolveCapabilityCredentials(refs.serverId, "video", { userId: refs.userId });
      expect(videoBinding).toMatchObject({
        source: "personal",
        provider: "openrouter",
        apiKey: "synthetic-member-key",
        supporterFunding: { capability: "video", fundingScope: "personal" },
      });
      expect(
        (await loadAvailableModelsForCapability(refs.userId, "supporter", "video")).some(
          (row) => row.id === videoBinding.modelId,
        ),
      ).toBe(true);
      const imageBinding = await resolveCapabilityCredentials(refs.serverId, "image-standard", {
        userId: refs.userId,
      });
      expect(imageBinding).toMatchObject({
        provider: "openrouter",
        source: "personal",
        supporterFunding: { capability: "image", fundingScope: "personal", modelCodename: "test/personal-image" },
      });
      expect(
        (await loadAvailableModelsForCapability(refs.userId, "supporter", "image")).some(
          (row) => row.id === imageBinding.modelId,
        ),
      ).toBe(true);
      expect(
        (await loadUserSavedProvidersForCapability(refs.userId, "image")).some((row) => row.provider === "supporter"),
      ).toBe(true);
      const binding = await resolveCapabilityCredentials(refs.serverId, "embedding", {
        userId: refs.userId,
      });
      expect(binding).toMatchObject({
        provider: "openrouter",
        source: "personal",
        supporterFunding: {
          fundingScope: "personal",
          capability: "embedding",
          modelCodename: "test/personal-embedding",
        },
      });
      expect(
        (await loadUserSavedProvidersForCapability(refs.userId, "embedding")).some(
          (row) => row.provider === "supporter",
        ),
      ).toBe(true);
      expect(
        (await loadAvailableModelsForCapability(refs.userId, "supporter", "embedding")).some(
          (row) => row.id === binding.modelId,
        ),
      ).toBe(true);
      expect(
        (await llmProviderRepo.loadUserSavedProviderConfig(refs.userId, "openrouter"))?.api_key?.equals(key.encrypted),
      ).toBe(true);
      const personalModels = await llmProviderRepo.loadUserSavedProviderConfig(refs.userId, "supporter");
      if (!personalModels?.llm_id) throw new Error("Missing personal model selections");
      config.tiers.test_tier.defaultModelByCapability.vision = "test/personal-registered";
      process.env.TOMORI_SUPPORTER_CONFIG_JSON = JSON.stringify(config);
      expect(
        await llmProviderRepo.upsertUserSavedProviderConfig(refs.userId, {
          ...personalModels,
          vision_llm_id: personalModels.llm_id,
          assigned_capabilities: [...personalModels.assigned_capabilities, "vision"],
          enabled_capabilities: [...personalModels.enabled_capabilities, "vision"],
        }),
      ).toBe(true);
      const serverMember = await createSupporterFixture("server_routing");
      await new SupporterEntitlementRepository(testSql).upsertSnapshot({
        supporterIdentityId: serverMember.supporter_identity_id,
        tierKey: "test_tier",
        patreonTierId: "tier_test",
        patronStatus: "active_patron",
        isActive: true,
        source: "oauth",
        lastVerifiedAt: new Date(),
        periodStart: new Date(Date.now() - 60_000),
        periodEnd: new Date(Date.now() + 3_600_000),
      });
      const serverInitial = await memberKeys.initialize(serverMember);
      const serverCreated = await memberKeys.storeCreated(
        serverInitial,
        "synthetic-server-routing-hash",
        "synthetic-server-member-key",
      );
      await memberKeys.save({ ...serverCreated, applied_limit: 0.1, disabled: false, pending_action: null });
      await revokeServerSponsorships(refs.serverId);
      await new SupporterSponsorshipRepository(testSql).startActiveSponsorship({
        serverId: refs.serverId,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        sponsorIdentityId: serverMember.supporter_identity_id,
        createdByDiscId: serverMember.discord_user_id,
      });
      await testSql`INSERT INTO scoped_model_registrations
        (server_id, llm_id, embedding_model_id, diffusion_model_id, video_model_id)
        VALUES (${refs.serverId}, ${personalModels.llm_id}, NULL, NULL, NULL),
          (${refs.serverId}, NULL, ${personalModels.embedding_model_id}, NULL, NULL),
          (${refs.serverId}, NULL, NULL, ${personalModels.diffusion_model_id}, NULL),
          (${refs.serverId}, NULL, NULL, NULL, ${personalModels.video_model_id})
        ON CONFLICT DO NOTHING`;
      expect(
        await configRepository.updateModelConfig(
          refs.serverId,
          {
            llm_id: personalModels.llm_id,
            vision_llm_id: personalModels.llm_id,
            embedding_model_id: personalModels.embedding_model_id,
            diffusion_model_id: personalModels.diffusion_model_id,
            video_model_id: personalModels.video_model_id,
          },
          "supporter",
        ),
      ).toBe(true);
      for (const capability of ["text", "vision", "embedding", "image-standard", "video"] as const) {
        const personal = await resolveCapabilityCredentials(refs.serverId, capability, { userId: refs.userId });
        const server = await resolveCapabilityCredentials(refs.serverId, capability);
        expect(personal.apiKey).toBe("synthetic-member-key");
        expect(personal.supporterFunding?.fundingScope).toBe("personal");
        expect(server.apiKey).toBe("synthetic-server-member-key");
        expect(server.supporterFunding?.fundingScope).toBe("server");
      }
      const currentKey = await memberKeys.load(serverMember.patreon_member_id);
      if (!currentKey) throw new Error("Missing server member key");
      await memberKeys.save({ ...currentKey, disabled: true });
      await expect(resolveCapabilityCredentials(refs.serverId, "text")).rejects.toMatchObject({
        reason: "inactive_entitlement",
      });
      const exports = await Promise.all([
        exportRepository.exportWorkspaceConfig(FIXTURE_IDS.serverDiscId),
        exportRepository.exportPersonalConfig(FIXTURE_IDS.userDiscId),
      ]);
      for (const exported of exports) {
        expect(exported.success).toBe(true);
        const serialized = JSON.stringify(exported.data);
        expect(serialized).not.toContain("synthetic-member-key");
        expect(serialized).not.toContain("synthetic-server-member-key");
      }
    } finally {
      request.mockRestore();
      resetOpenRouterCapabilityCache();
      await llmProviderRepo.deleteUserSavedProviderConfig(refs.userId, "supporter");
      await llmProviderRepo.deleteUserSavedProviderConfig(refs.userId, "openrouter");
    }
  });

  it("selects tier defaults for personal access and sponsored servers while keeping BYOK keys", async () => {
    await initializeSupporterBillingSchema(testSql);
    await revokeServerSponsorships(refs.serverId);
    const activeEntitlement = (supporterIdentityId: number) => ({
      supporterIdentityId,
      tierKey: "test_tier",
      patreonTierId: "tier_test",
      patronStatus: "active_patron",
      isActive: true,
      periodStart: new Date(Date.now() - 60_000),
      periodEnd: new Date(Date.now() + 3_600_000),
      lastVerifiedAt: new Date(),
      source: "oauth" as const,
    });
    const personalMember = await createSupporterFixture("personal_registration", FIXTURE_IDS.userDiscId);
    const serverMember = await createSupporterFixture("server_defaults");
    const entitlements = new SupporterEntitlementRepository(testSql);
    await entitlements.upsertSnapshot(activeEntitlement(personalMember.supporter_identity_id));
    await entitlements.upsertSnapshot(activeEntitlement(serverMember.supporter_identity_id));
    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    const byokText = await llmModelRepo.loadDefaultModel("openrouter");
    const [byokEmbedding] = await testSql`SELECT embedding_model_id FROM embedding_models
      WHERE provider = 'openrouter' AND NOT is_deprecated AND NOT is_scoped_registration AND model_family IS NOT NULL
      ORDER BY embedding_model_id LIMIT 1`;
    const [byokImage] = await testSql`SELECT diffusion_model_id FROM image_diffusion_models
      WHERE provider = 'openrouter' AND NOT is_deprecated AND NOT is_scoped_registration
      ORDER BY diffusion_model_id LIMIT 1`;
    if (!state || !byokText?.llm_id || !byokEmbedding || !byokImage)
      throw new Error("Expected seeded OpenRouter models");
    const key = await encryptApiKey("test-byok-openrouter-key");
    const personalByok = await buildUserSavedProviderConfigFromExistingOrDefaults({
      userId: refs.userId,
      provider: "openrouter",
      apiKey: key.encrypted,
      keyVersion: key.version,
      baseConfig: state.config,
      llmId: byokText.llm_id,
      enabledCapabilities: ["text", "image"],
    });
    expect(await llmProviderRepo.upsertUserSavedProviderConfig(refs.userId, personalByok)).toBe(true);
    const serverByok = await buildSavedProviderConfigFromExistingOrDefaults({
      serverId: refs.serverId,
      provider: "openrouter",
      apiKey: key.encrypted,
      keyVersion: key.version,
      baseConfig: state.config,
      llmId: byokText.llm_id,
    });
    expect(await llmProviderRepo.upsertSavedProviderConfig(refs.serverId, serverByok)).toBe(true);
    expect(
      await configRepository.updateModelConfig(refs.serverId, {
        llm_id: byokText.llm_id,
        vision_llm_id: null,
        embedding_model_id: byokEmbedding.embedding_model_id,
        diffusion_model_id: byokImage.diffusion_model_id,
        video_model_id: null,
      }),
    ).toBe(true);
    const config = structuredClone(validSupporterConfig);
    config.tiers.test_tier.defaultModelByCapability = {
      text: "test/default-text",
      vision: "test/default-vision",
      image: "test/personal-image",
      video: "test/personal-video",
      embedding: "test/personal-embedding",
      decision: "test/personal-decision",
      voice: { clone: "fish-audio/s2.1-pro", design: "bytedance-seed/seed-audio-1-0" },
    };
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY = "synthetic-management-key";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    process.env.TOMORI_SUPPORTER_CONFIG_JSON = JSON.stringify(config);
    resetOpenRouterCapabilityCache();
    const request = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: string | URL | Request) => {
          const url = String(input);
          if (url.endsWith("/models?output_modalities=speech"))
            return Response.json({ data: [{ id: "fish-audio/s2.1-pro" }, { id: "bytedance-seed/seed-audio-1-0" }] });
          if (url.endsWith("/models/fish-audio/s2.1-pro/endpoints"))
            return Response.json({ data: { endpoints: [{ supports_voice_cloning: true }] } });
          if (url.endsWith("/videos/models"))
            return Response.json({
              data: [
                {
                  id: "test/personal-video",
                  supported_durations: [5],
                  supported_resolutions: ["480p"],
                  supported_aspect_ratios: ["16:9"],
                  generate_audio: false,
                  pricing_skus: { duration_seconds: "0.0004" },
                },
              ],
            });
          if (url.endsWith("/models?output_modalities=decisions"))
            return Response.json({
              data: [
                {
                  id: "test/personal-decision",
                  context_length: 1000,
                  architecture: { input_modalities: ["text"], output_modalities: ["decisions"] },
                  pricing: { prompt: "0.000001", completion: "0" },
                },
              ],
            });
          if (url.endsWith("/images/models"))
            return Response.json({
              data: [{ id: "test/personal-image", architecture: { output_modalities: ["image"] } }],
            });
          if (url.endsWith("/images/models/test/personal-image/endpoints"))
            return Response.json({
              id: "test/personal-image",
              endpoints: [
                {
                  provider_tag: "fixture-image-provider",
                  supported_parameters: { n: { type: "range", min: 1, max: 1 } },
                  pricing: [{ billable: "output_image", unit: "image", cost_usd: "0.001" }],
                },
              ],
            });
          if (url.endsWith("/embeddings/models"))
            return Response.json({
              data: [
                {
                  id: "test/personal-embedding",
                  context_length: 1000,
                  architecture: { modality: "text->embeddings", output_modalities: ["embeddings"] },
                  pricing: { prompt: "0.000001", completion: "0" },
                },
              ],
            });
          if (!url.endsWith("/models")) throw new Error(`Bootstrap must not make an inference request: ${url}`);
          return Response.json({
            data: [
              { id: "test/default-text", architecture: { modality: "text->text" } },
              { id: "test/default-vision", architecture: { modality: "text+image->text" } },
            ].map((model) => ({
              ...model,
              context_length: 1000,
              supported_parameters: ["max_tokens"],
              pricing: { prompt: "0.000001", completion: "0.000001" },
            })),
          });
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    const codenames = async (row: Record<string, unknown> | null) => ({
      text: row?.llm_id ? (await llmModelRepo.loadById(Number(row.llm_id)))?.llm_codename : null,
      vision: row?.vision_llm_id ? (await llmModelRepo.loadById(Number(row.vision_llm_id)))?.llm_codename : null,
      image: row?.diffusion_model_id
        ? (await llmModelRepo.loadDiffusionModelById(Number(row.diffusion_model_id)))?.codename
        : null,
      video: row?.video_model_id
        ? (await llmModelRepo.loadVideoGenerationModelById(Number(row.video_model_id)))?.codename
        : null,
      embedding: row?.embedding_model_id
        ? (await llmModelRepo.loadEmbeddingModelById(Number(row.embedding_model_id)))?.codename
        : null,
    });
    try {
      const saveConfig = llmProviderRepo.upsertUserSavedProviderConfig.bind(llmProviderRepo);
      let refuseFirstSelection = true;
      const firstSelection = spyOn(llmProviderRepo, "upsertUserSavedProviderConfig").mockImplementation(
        async (...args) => {
          if (refuseFirstSelection && args[1].provider === "supporter" && args[1].llm_id !== null) {
            refuseFirstSelection = false;
            return false;
          }
          return await saveConfig(...args);
        },
      );
      try {
        await expect(
          ensurePersonalSupporterDefaults({
            kind: "personal",
            userId: refs.userId,
            serverDiscId: "223456789012345678",
            state: null,
          }),
        ).rejects.toMatchObject({ reason: "model_unavailable" });
      } finally {
        firstSelection.mockRestore();
      }
      expect((await llmProviderRepo.loadUserSavedProviderConfig(refs.userId, "supporter"))?.llm_id).toBeNull();
      expect(
        await ensurePersonalSupporterDefaults({
          kind: "personal",
          userId: refs.userId,
          serverDiscId: "223456789012345678",
          state: null,
        }),
      ).toBeUndefined();
      const personal = await llmProviderRepo.loadUserSavedProviderConfig(refs.userId, "supporter");
      const keptPersonal = await llmProviderRepo.loadUserSavedProviderConfig(refs.userId, "openrouter");
      expect(personal?.api_key).toBeNull();
      expect(await codenames(personal)).toEqual({
        text: "test/default-text",
        vision: "test/default-vision",
        image: "test/personal-image",
        video: "test/personal-video",
        embedding: "test/personal-embedding",
      });
      const [fish] = await testSql`SELECT speech_model_id FROM speech_models
        WHERE provider = 'openrouter' AND codename = 'fish-audio/s2.1-pro'`;
      expect(personal?.speech_clone_model_id).toBe(fish.speech_model_id);
      const [seed] = await testSql`SELECT speech_model_id FROM speech_models
        WHERE provider = 'openrouter' AND codename = 'bytedance-seed/seed-audio-1-0'`;
      expect(personal?.speech_design_model_id).toBe(seed.speech_model_id);
      expect(new Set(personal?.enabled_capabilities)).toEqual(
        new Set(["text", "vision", "image", "video", "embedding", "speech_clone", "speech_design"]),
      );
      expect(keptPersonal?.api_key?.equals(key.encrypted)).toBe(true);
      expect(keptPersonal?.llm_id).toBe(byokText.llm_id);
      expect(keptPersonal?.diffusion_model_id).toBe(personalByok.diffusion_model_id);
      expect(keptPersonal?.enabled_capabilities).toEqual([]);
      expect(
        (await loadDecisionModelsForScope({ kind: "personal", ownerId: refs.userId })).some(
          (option) => option.model.codename === "test/personal-decision",
        ),
      ).toBe(true);

      config.tiers.test_tier.defaultModelByCapability.image = "test/unlisted-image";
      process.env.TOMORI_SUPPORTER_CONFIG_JSON = JSON.stringify(config);
      expect(
        await activatePersonalProviderTextModel({
          userId: refs.userId,
          provider: "openrouter",
          llmId: byokText.llm_id,
        }),
      ).toMatchObject({ status: "activated" });
      await ensurePersonalSupporterDefaults({
        kind: "personal",
        userId: refs.userId,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        state,
      });
      expect(
        (await llmProviderRepo.loadUserSavedProviderConfig(refs.userId, "openrouter"))?.enabled_capabilities,
      ).toContain("text");
      expect(
        (await llmProviderRepo.loadUserSavedProviderConfig(refs.userId, "supporter"))?.enabled_capabilities,
      ).not.toContain("text");
      await persistSupporterSponsorship({
        serverId: refs.serverId,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        sponsorIdentityId: serverMember.supporter_identity_id,
        createdByDiscId: serverMember.discord_user_id,
      });
      const serverModels = await configRepository.loadModelCapabilityIds(refs.serverId);
      const keptServer = await llmProviderRepo.loadSavedProviderConfig(refs.serverId, "openrouter");
      const [serverSpeech] =
        await testSql`SELECT speech_clone_model_id, speech_design_model_id FROM server_speech_configs
        WHERE server_id = ${refs.serverId}`;
      expect(await codenames(serverModels)).toMatchObject({
        text: "test/default-text",
        vision: "test/default-vision",
        video: "test/personal-video",
      });
      expect(serverModels?.diffusion_model_id).toBe(byokImage.diffusion_model_id);
      expect(serverModels?.embedding_model_id).toBe(byokEmbedding.embedding_model_id);
      expect(serverSpeech.speech_clone_model_id).toBe(fish.speech_model_id);
      expect(serverSpeech.speech_design_model_id).toBe(seed.speech_model_id);
      const sponsoredState = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
      if (!sponsoredState) throw new Error("Expected sponsored workspace");
      const sponsoredView = await loadConfigSwitchModelsView(sponsoredState, FIXTURE_IDS.serverDiscId, undefined);
      for (const capability of ["text", "vision", "video", "tts-clone", "tts-design"] as const) {
        expect(sponsoredView.slots.find((slot) => slot.capability === capability)?.currentProvider).toBe("supporter");
      }
      for (const capability of ["embedding", "image"] as const) {
        expect(sponsoredView.slots.find((slot) => slot.capability === capability)?.currentProvider).toBe("openrouter");
      }
      expect(await loadConfigModelProviders(refs.serverId, "tts-clone")).toContain("supporter");
      expect(await loadConfigModelChoices(refs.serverId, "tts-clone", "supporter")).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: fish.speech_model_id })]),
      );
      expect((await llmProviderRepo.loadSavedProviderConfig(refs.serverId, "supporter"))?.api_key).toBeNull();
      expect(keptServer?.api_key?.equals(key.encrypted)).toBe(true);
      expect(keptServer?.llm_id).toBe(byokText.llm_id);
      await llmProviderRepo.deleteSavedProviderConfig(refs.serverId, "openrouter");
      const voiceView = await loadConfigPersonaVoiceView(state);
      expect(voiceView.hasTargets).toBe(true);
      expect(voiceView.capability.assignable).toBe(true);
      process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "false";
      expect((await loadConfigPersonaVoiceView(state)).hasTargets).toBe(false);
      process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
      await llmProviderRepo.deleteUserSavedProviderConfig(refs.userId, "supporter");
      await revokeServerSponsorships(refs.serverId);
      await persistSupporterSponsorship({
        serverId: refs.serverId,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        sponsorIdentityId: personalMember.supporter_identity_id,
        createdByDiscId: personalMember.discord_user_id,
      });
      const rows = await llmProviderRepo.loadUserSavedProviderConfigs(refs.userId);
      const display = await loadPersonalModelDisplayInfo(refs.userId, rows);
      expect(display.eligibleProvidersForCapability.text).toContain("supporter");
      expect(display.routingRows.text.storedProvider).toBe("supporter");
      expect(rows.find((row) => row.provider === "supporter")?.enabled_capabilities).toContain("text");
    } finally {
      request.mockRestore();
      resetOpenRouterCapabilityCache();
      await testSql`DELETE FROM server_speech_configs WHERE server_id = ${refs.serverId}`;
      await testSql`DELETE FROM saved_provider_configs WHERE server_id = ${refs.serverId}
        AND provider IN ('supporter', 'openrouter')`;
      await llmProviderRepo.deleteUserSavedProviderConfig(refs.userId, "supporter");
      await llmProviderRepo.deleteUserSavedProviderConfig(refs.userId, "openrouter");
    }
  });

  it("consumes OAuth state nonces once and rejects expired nonce rows", async () => {
    await initializeSupporterBillingSchema(testSql);
    const oauthStateRepository = new OAuthStateRepository(testSql);
    const now = new Date();
    const nonceSuffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const activeNonceHash = `_rt_nonce_hash_once_${nonceSuffix}`;
    const expiredNonceHash = `_rt_nonce_hash_expired_${nonceSuffix}`;

    await oauthStateRepository.recordStateNonce({
      flow: "patreon",
      nonceHash: activeNonceHash,
      subject: FIXTURE_IDS.userDiscId,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
    });
    const firstConsume = await oauthStateRepository.consumeStateNonce({
      flow: "patreon",
      nonceHash: activeNonceHash,
      subject: FIXTURE_IDS.userDiscId,
      consumedAt: now,
    });
    const replayConsume = await oauthStateRepository.consumeStateNonce({
      flow: "patreon",
      nonceHash: activeNonceHash,
      subject: FIXTURE_IDS.userDiscId,
      consumedAt: now,
    });

    await oauthStateRepository.recordStateNonce({
      flow: "patreon",
      nonceHash: expiredNonceHash,
      subject: FIXTURE_IDS.userDiscId,
      expiresAt: new Date(now.getTime() - 1_000),
      createdAt: new Date(now.getTime() - 2_000),
    });
    const expiredConsume = await oauthStateRepository.consumeStateNonce({
      flow: "patreon",
      nonceHash: expiredNonceHash,
      subject: FIXTURE_IDS.userDiscId,
      consumedAt: now,
    });

    expect(firstConsume?.consumed_at?.toISOString()).toBe(now.toISOString());
    expect(replayConsume).toBeNull();
    expect(expiredConsume).toBeNull();
  });

  it("persists OAuth-linked identity and entitlement transactionally", async () => {
    await initializeSupporterBillingSchema(testSql);
    const suffix = `persist_${Date.now()}`;
    const verifiedAt = new Date();
    const periodStart = new Date("2026-01-01T00:00:00.000Z");
    const periodEnd = new Date("2026-02-01T00:00:00.000Z");

    const result = await persistEligiblePatreonSupporter({
      config: validSupporterConfig,
      client: testSql,
      env: createEnabledEnv(),
      verifiedAt,
      snapshot: {
        discordUserId: `_rt_supporter_oauth_${suffix}`,
        patreonUserId: `_rt_patreon_user_oauth_${suffix}`,
        patreonMemberId: `_rt_patreon_member_oauth_${suffix}`,
        patreonCampaignId: "campaign_test",
        tierKey: "test_tier",
        patreonTierId: "tier_test",
        patronStatus: "active_patron",
        periodStart,
        periodEnd,
        periodDateSource: "patreon",
        lastSuccessfulChargeAt: null,
        nextChargeAt: periodEnd,
      },
    });

    const identityRepository = new SupporterIdentityRepository(testSql);
    const entitlementRepository = new SupporterEntitlementRepository(testSql);
    const identity = await identityRepository.loadByDiscordUserId(`_rt_supporter_oauth_${suffix}`);
    const entitlement = identity ? await entitlementRepository.loadByIdentityId(identity.supporter_identity_id) : null;
    expect(result.identity.discord_user_id).toBe(`_rt_supporter_oauth_${suffix}`);
    expect(identity?.patreon_member_id).toBe(`_rt_patreon_member_oauth_${suffix}`);
    expect(entitlement?.source).toBe("oauth");
    expect(entitlement?.is_active).toBe(true);
    expect(entitlement?.period_start).toEqual(periodStart);
    expect(entitlement?.period_end).toEqual(periodEnd);
  });

  it("rejects sponsor takeovers until the active sponsorship is revoked", async () => {
    await initializeSupporterBillingSchema(testSql);
    await revokeServerSponsorships(refs.serverId);
    const suffix = `sponsorship_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const identityRepository = new SupporterIdentityRepository(testSql);
    const sponsorshipRepository = new SupporterSponsorshipRepository(testSql);
    const now = new Date();

    const firstSponsor = await identityRepository.upsertIdentity({
      discordUserId: `_rt_supporter_first_${suffix}`,
      patreonUserId: `_rt_patreon_user_first_${suffix}`,
      patreonMemberId: `_rt_patreon_member_first_${suffix}`,
      patreonCampaignId: "campaign_test",
      linkedAt: now,
      lastOauthAt: now,
    });
    const secondSponsor = await identityRepository.upsertIdentity({
      discordUserId: `_rt_supporter_second_${suffix}`,
      patreonUserId: `_rt_patreon_user_second_${suffix}`,
      patreonMemberId: `_rt_patreon_member_second_${suffix}`,
      patreonCampaignId: "campaign_test",
      linkedAt: now,
      lastOauthAt: now,
    });

    const sponsorshipParams = (sponsor: typeof firstSponsor) => ({
      serverId: refs.serverId,
      serverDiscId: FIXTURE_IDS.serverDiscId,
      sponsorIdentityId: sponsor.supporter_identity_id,
      createdByDiscId: sponsor.discord_user_id,
    });
    const firstSponsorship = await sponsorshipRepository.startActiveSponsorship(sponsorshipParams(firstSponsor));
    const repeated = await sponsorshipRepository.startActiveSponsorship(sponsorshipParams(firstSponsor));
    expect(repeated.sponsorship_id).toBe(firstSponsorship.sponsorship_id);
    await expect(sponsorshipRepository.startActiveSponsorship(sponsorshipParams(secondSponsor))).rejects.toBeInstanceOf(
      SponsorshipConflictError,
    );
    expect((await sponsorshipRepository.loadActiveSponsorshipForServer(refs.serverId))?.sponsorship_id).toBe(
      firstSponsorship.sponsorship_id,
    );

    const wrongSponsorRevoke = await sponsorshipRepository.revokeActiveSponsorshipForSponsor({
      sponsorshipId: firstSponsorship.sponsorship_id,
      sponsorIdentityId: secondSponsor.supporter_identity_id,
    });
    expect(wrongSponsorRevoke).toBeNull();

    const revoked = await sponsorshipRepository.revokeActiveSponsorshipForSponsor({
      sponsorshipId: firstSponsorship.sponsorship_id,
      sponsorIdentityId: firstSponsor.supporter_identity_id,
    });
    expect(revoked?.status).toBe("revoked");
    expect(revoked?.revoked_at).toBeInstanceOf(Date);
    expect(await sponsorshipRepository.loadActiveSponsorshipForServer(refs.serverId)).toBeNull();

    const replacement = await sponsorshipRepository.startActiveSponsorship(sponsorshipParams(secondSponsor));
    expect(
      (await sponsorshipRepository.loadActiveSponsorshipsForSponsorIdentity(firstSponsor.supporter_identity_id)).length,
    ).toBe(0);
    expect(
      (await sponsorshipRepository.loadActiveSponsorshipsForSponsorIdentity(secondSponsor.supporter_identity_id)).map(
        (row) => row.sponsorship_id,
      ),
    ).toEqual([replacement.sponsorship_id]);
    await revokeServerSponsorships(refs.serverId);
  });

  it("persists multiple sponsored servers sharing one sponsor", async () => {
    await initializeSupporterBillingSchema(testSql);
    await revokeServerSponsorships(refs.serverId);
    const suffix = `sponsorship_limit_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const identityRepository = new SupporterIdentityRepository(testSql);
    const sponsorshipRepository = new SupporterSponsorshipRepository(testSql);
    const now = new Date();

    const sponsor = await identityRepository.upsertIdentity({
      discordUserId: `_rt_supporter_limit_${suffix}`,
      patreonUserId: `_rt_patreon_user_limit_${suffix}`,
      patreonMemberId: `_rt_patreon_member_limit_${suffix}`,
      patreonCampaignId: "campaign_test",
      linkedAt: now,
      lastOauthAt: now,
    });
    const [secondServer] = await testSql`
      INSERT INTO servers (server_disc_id)
      VALUES (${`_rt_server_limit_${suffix}`})
      RETURNING server_id
    `;

    await sponsorshipRepository.startActiveSponsorship({
      serverId: refs.serverId,
      serverDiscId: FIXTURE_IDS.serverDiscId,
      sponsorIdentityId: sponsor.supporter_identity_id,
      createdByDiscId: sponsor.discord_user_id,
    });

    await sponsorshipRepository.startActiveSponsorship({
      serverId: secondServer.server_id,
      serverDiscId: `_rt_server_limit_${suffix}`,
      sponsorIdentityId: sponsor.supporter_identity_id,
      createdByDiscId: sponsor.discord_user_id,
    });

    const activeSponsorships = await sponsorshipRepository.loadActiveSponsorshipsForSponsorIdentity(
      sponsor.supporter_identity_id,
    );
    expect(activeSponsorships.map((row) => row.server_id)).toContain(refs.serverId);
    expect(activeSponsorships.map((row) => row.server_id)).toContain(secondServer.server_id);

    await testSql`DELETE FROM servers WHERE server_id = ${secondServer.server_id}`;
  });

  it("migrates legacy webhook payload keys without losing receipts or admitting retries", async () => {
    await initializeSupporterBillingSchema(testSql);
    const repository = new SupporterWebhookEventRepository(testSql);
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const payloadHash = createHash("sha256").update(suffix).digest("hex");
    const params = {
      patreonEventId: null,
      eventType: "members:create",
      idempotencyKey: `payload:${payloadHash}`,
      payloadHash,
      receivedAt: new Date(),
    };
    const legacy = await repository.recordReceiptForProcessing(params);
    const processed = await repository.markProcessed(
      legacy.event.webhook_event_id,
      "ignored",
      "wrong_campaign",
      new Date(),
    );
    if (!processed) throw new Error("Webhook fixture receipt was not stored");
    const eventId = `event_${suffix}`;
    const providerReceipt = await repository.recordReceiptForProcessing({
      ...params,
      patreonEventId: eventId,
      eventType: "members:update",
      idempotencyKey: `event:${eventId}`,
    });
    const scopedKey = `payload:${params.eventType}:${payloadHash}`;

    await initializeSupporterBillingSchema(testSql);
    await initializeSupporterBillingSchema(testSql);

    expect(await repository.loadByIdempotencyKey(scopedKey)).toEqual({ ...processed, idempotency_key: scopedKey });
    expect(await repository.loadByIdempotencyKey(`event:${eventId}`)).toEqual(providerReceipt.event);
    const retried = await repository.recordReceiptForProcessing({ ...params, idempotencyKey: scopedKey });
    expect(retried.status).toBe("duplicate");
    expect(retried.event.webhook_event_id).toBe(legacy.event.webhook_event_id);
  });

  it("deduplicates a handler-written webhook receipt across repeated privileged schema initialization", async () => {
    await initializeSupporterBillingSchema(testSql);
    const identity = await createSupporterFixture(`webhook_redelivery_${Date.now()}`);
    const secret = "synthetic-redelivery-webhook-secret";
    const now = new Date("2026-01-15T00:00:00.000Z");
    const payload = {
      data: {
        type: "member",
        id: identity.patreon_member_id,
        attributes: {
          patron_status: "active_patron",
          last_charge_status: "Paid",
          last_charge_date: "2026-01-01T00:00:00.000Z",
          next_charge_date: "2026-02-01T00:00:00.000Z",
          pledge_relationship_start: "2026-01-01T00:00:00.000Z",
          will_pay_amount_cents: 100,
        },
        relationships: {
          campaign: { data: { type: "campaign", id: validSupporterConfig.patreon.campaignId } },
          user: { data: { type: "user", id: identity.patreon_user_id } },
          currently_entitled_tiers: { data: [{ type: "tier", id: "tier_test" }] },
        },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const deliver = () =>
      handlePatreonWebhookRawBody(
        rawBody,
        {
          "x-patreon-event": "members:update",
          "x-patreon-signature": computePatreonWebhookSignature(rawBody, secret),
        },
        {
          config: validSupporterConfig,
          env: createEnabledEnv({ TOMORI_SUPPORTER_PATREON_WEBHOOK_SECRET: secret }),
          now,
          repositories: {
            identityRepository: new SupporterIdentityRepository(testSql),
            webhookEventRepository: new SupporterWebhookEventRepository(testSql),
          },
          fetchMember: async () => payload,
          persistMemberState: (options) =>
            persistPatreonMemberState({
              ...options,
              repositories: {
                identityRepository: new SupporterIdentityRepository(testSql),
                entitlementRepository: new SupporterEntitlementRepository(testSql),
              },
            }),
        },
      );
    const payloadHash = createHash("sha256").update(rawBody).digest("hex");

    try {
      expect((await deliver()).status).toBe("processed");
      await initializeSupporterBillingSchema(testSql);
      await initializeSupporterBillingSchema(testSql);
      const redelivery = await deliver();
      await initializeSupporterBillingSchema(testSql);

      expect(redelivery.status).toBe("duplicate");
      const receipts = await testSql<
        Array<{ idempotency_key: string }>
      >`SELECT idempotency_key FROM supporter_webhook_events WHERE payload_hash = ${payloadHash}`;
      expect(receipts).toHaveLength(1);
    } finally {
      await testSql`DELETE FROM supporter_webhook_events WHERE payload_hash = ${payloadHash}`;
    }
  });

  it("stores webhook idempotency rows and rejects duplicate fallback payload deliveries", async () => {
    await initializeSupporterBillingSchema(testSql);
    const webhookRepository = new SupporterWebhookEventRepository(testSql);
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const idempotencyKey = `_rt_payload_${suffix}`;

    const firstReceipt = await webhookRepository.recordReceiptForProcessing({
      patreonEventId: null,
      eventType: "members:update",
      idempotencyKey,
      payloadHash: `_rt_payload_hash_${suffix}`,
      receivedAt: new Date(),
    });
    const duplicateReceipt = await webhookRepository.recordReceiptForProcessing({
      patreonEventId: null,
      eventType: "members:update",
      idempotencyKey,
      payloadHash: `_rt_payload_hash_${suffix}`,
      receivedAt: new Date(),
    });

    expect(firstReceipt.status).toBe("recorded");
    expect(duplicateReceipt.status).toBe("duplicate");
    expect(duplicateReceipt.event.webhook_event_id).toBe(firstReceipt.event.webhook_event_id);
  });

  it("records usage statistics once per provider job and follows identity and server deletion", async () => {
    await initializeSupporterBillingSchema(testSql);
    const repository = new SupporterUsageStatisticsRepository(testSql);
    const identity = await createSupporterFixture(`usage_${Date.now()}`);
    const [server] = await testSql`
      INSERT INTO servers (server_disc_id) VALUES (${`_rt_usage_server_${Date.now()}`}) RETURNING server_id
    `;
    const funding = {
      credentialSource: "supporter" as const,
      provider: "openrouter" as const,
      capability: "video" as const,
      modelCodename: "example/video-model",
      tierKey: "test_tier",
      sponsorIdentityId: identity.supporter_identity_id,
      sponsorDiscordUserId: identity.discord_user_id,
      entitlementId: 1,
      renewalAt: null,
      fundingScope: "server" as const,
      sponsorshipId: 1,
      serverId: server.server_id as number,
      personalUserId: null,
    };
    const jobId = `_rt_video_job_${Date.now()}`;
    for (let poll = 0; poll < 3; poll++)
      recordSupporterUsage(
        funding,
        { modelCodename: funding.modelCodename, costUsd: 0.25, providerRequestId: jobId },
        repository,
      );
    recordSupporterUsage(
      { ...funding, capability: "text" },
      { modelCodename: "example/text-model", costUsd: 0.001 },
      repository,
    );
    recordSupporterUsage(
      { ...funding, capability: "text" },
      { modelCodename: "example/text-model", costUsd: 0.001 },
      repository,
    );
    const readRows = async () =>
      testSql`
        SELECT funding_scope, server_id, capability, model_codename, cost_usd, provider_request_id
        FROM supporter_usage_statistics
        WHERE supporter_identity_id = ${identity.supporter_identity_id}
        ORDER BY usage_statistic_id
      `;
    for (let attempt = 0; attempt < 50 && (await readRows()).length < 3; attempt++) await Bun.sleep(10);
    expect(await readRows()).toEqual([
      {
        funding_scope: "server",
        server_id: server.server_id,
        capability: "video",
        model_codename: "example/video-model",
        cost_usd: 0.25,
        provider_request_id: jobId,
      },
      {
        funding_scope: "server",
        server_id: server.server_id,
        capability: "text",
        model_codename: "example/text-model",
        cost_usd: 0.001,
        provider_request_id: null,
      },
      {
        funding_scope: "server",
        server_id: server.server_id,
        capability: "text",
        model_codename: "example/text-model",
        cost_usd: 0.001,
        provider_request_id: null,
      },
    ]);
    expect(
      await repository.record({
        supporterIdentityId: identity.supporter_identity_id,
        fundingScope: "server",
        serverId: server.server_id,
        capability: "video",
        modelCodename: "example/video-model",
        costUsd: 0.25,
        providerRequestId: jobId,
      }),
    ).toBe(false);

    await testSql`DELETE FROM servers WHERE server_id = ${server.server_id}`;
    expect((await readRows()).map((row: { server_id: number | null }) => row.server_id)).toEqual([null, null, null]);
    await testSql`DELETE FROM supporter_identities WHERE supporter_identity_id = ${identity.supporter_identity_id}`;
    expect(await readRows()).toEqual([]);
  });

  it("aggregates the allowance period and keeps purged spend in the member key's logged total", async () => {
    await initializeSupporterBillingSchema(testSql);
    const repository = new SupporterUsageStatisticsRepository(testSql);
    const identity = await createSupporterFixture(`usage_retention_${Date.now()}`);
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const periodStart = new Date(now - 95 * day);
    const periodEnd = new Date(now + 5 * day);
    await new SupporterEntitlementRepository(testSql).upsertSnapshot({
      supporterIdentityId: identity.supporter_identity_id,
      tierKey: "test_tier",
      patreonTierId: "tier_test",
      patronStatus: "active_patron",
      isActive: true,
      source: "oauth",
      lastVerifiedAt: new Date(),
      periodStart,
      periodEnd,
    });
    const memberKeys = new MemberKeyRepository(testSql);
    await memberKeys.storeCreated(
      await memberKeys.initialize(identity),
      "synthetic-retention-hash",
      "synthetic-retention-key",
    );
    const keyCreatedAt = new Date(now - 200 * day);
    await testSql`UPDATE supporter_member_keys SET key_created_at = ${keyCreatedAt}
      WHERE supporter_identity_id = ${identity.supporter_identity_id}`;
    for (const [scope, model, cost, inputTokens, outputTokens, recordedAt] of [
      ["server", "example/expired", 0.5, 1, 1, new Date(now - 150 * day)],
      ["server", "example/shared", 0.05, 4, 6, new Date(now - 92 * day)],
      ["server", "example/shared", 0.2, null, null, new Date(now - day)],
      ["personal", "example/personal", 0.1, 10, 20, new Date(now - day)],
    ] as const) {
      await testSql`INSERT INTO supporter_usage_statistics (supporter_identity_id, funding_scope, server_id, capability,
          model_codename, cost_usd, input_tokens, output_tokens, recorded_at)
        VALUES (${identity.supporter_identity_id}, ${scope}, ${scope === "server" ? refs.serverId : null}, 'text',
          ${model}, ${cost}, ${inputTokens}, ${outputTokens}, ${recordedAt})`;
    }

    await repository.record({
      supporterIdentityId: identity.supporter_identity_id,
      fundingScope: "server",
      serverId: refs.serverId,
      capability: "vision",
      modelCodename: "example/shared",
      costUsd: 0.03,
      providerRequestId: null,
      inputTokens: 2,
      outputTokens: 3,
    });

    const aggregates = await repository.aggregatePeriod(identity.supporter_identity_id, periodStart, periodEnd);
    expect(
      aggregates.sort(
        (left, right) =>
          left.model_codename.localeCompare(right.model_codename) || left.capability.localeCompare(right.capability),
      ),
    ).toEqual([
      {
        funding_scope: "personal",
        server_disc_id: null,
        model_codename: "example/personal",
        capability: "text",
        cost_usd: 0.1,
        generations: 1,
        input_tokens: 10,
        output_tokens: 20,
      },
      {
        funding_scope: "server",
        server_disc_id: FIXTURE_IDS.serverDiscId,
        model_codename: "example/shared",
        capability: "text",
        cost_usd: 0.25,
        generations: 2,
        input_tokens: 4,
        output_tokens: 6,
      },
      {
        funding_scope: "server",
        server_disc_id: FIXTURE_IDS.serverDiscId,
        model_codename: "example/shared",
        capability: "vision",
        cost_usd: 0.03,
        generations: 1,
        input_tokens: 2,
        output_tokens: 3,
      },
    ]);

    const loggedBefore = await repository.totalSince(identity.supporter_identity_id, keyCreatedAt);
    expect(loggedBefore).toBeCloseTo(0.88, 10);
    expect(await repository.purgeAgedStatistics(new Date(now - 90 * day))).toBe(1);
    expect(await repository.totalSince(identity.supporter_identity_id, keyCreatedAt)).toBeCloseTo(loggedBefore, 10);
    expect(await repository.aggregatePeriod(identity.supporter_identity_id, periodStart, periodEnd)).toHaveLength(3);

    await testSql`DELETE FROM supporter_identities WHERE supporter_identity_id = ${identity.supporter_identity_id}`;
  });
});

describe.skipIf(!DB_TESTS_AVAILABLE)("Patreon creator OAuth lifecycle", () => {
  beforeAll(async () => {
    await setupTestDb();
    await initializeSupporterBillingSchema(testSql);
  });
  afterAll(async () => {
    clearPatreonCreatorTokenStateForTests();
    await dropSupporterBillingTables();
  });

  function optionsFor(campaignId: string) {
    return {
      config: { ...validSupporterConfig, patreon: { ...validSupporterConfig.patreon, campaignId } },
      env: createEnabledEnv(),
      client: testSql,
    };
  }

  it("bootstraps operator reauthorization before encrypted storage and keeps inspection output secret-free", async () => {
    const options = optionsFor("creator-operator-bootstrap");
    const masterKey = "synthetic_operator_bootstrap_master_key_123";
    const refreshToken = "synthetic_operator_bootstrap_refresh_token";
    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      ...options.env,
      RUN_ENV: "development",
      TEST_PRODUCTION: "false",
      DISCORD_TOKEN: "synthetic_operator_bot_token",
      ERROR_DB_LOGGING_ENABLED: "false",
      TOMORI_SUPPORTER_CONFIG_JSON: JSON.stringify(options.config),
      TOMORI_SUPPORTER_PATREON_CREATOR_REFRESH_TOKEN: refreshToken,
    };
    for (const name of Object.keys(childEnv)) if (name.startsWith("CRYPTO_SECRET")) delete childEnv[name];
    Object.assign(childEnv, { CRYPTO_SECRET_V1: masterKey, CRYPTO_SECRET_CURRENT: "1" });
    async function run(script: string, args: string[]) {
      const child = Bun.spawn(
        [process.execPath, "--no-env-file", "run", `scripts/maintenance/supporter/${script}.ts`, ...args],
        {
          env: childEnv,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      for (const secret of [masterKey, refreshToken, childEnv.TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY]) {
        if (secret) expect(stdout + stderr).not.toContain(secret);
      }
      return code;
    }
    try {
      expect(await run("reauthorizeCreator", ["--execute"])).toBe(0);
      const [row] = await testSql<{ refresh_token_key_version: number; credential: string }[]>`
        SELECT refresh_token_key_version, pgp_sym_decrypt(refresh_token, ${masterKey}) AS credential
        FROM supporter_patreon_creator_tokens WHERE campaign_id = ${options.config.patreon.campaignId}`;
      expect(row.refresh_token_key_version).toBe(1);
      expect(row.credential).toBe(refreshToken);
      expect(await run("reauthorizeCreator", [])).toBe(0);
      expect(await run("refreshEntitlement", ["--discord-user-id", "_rt_missing_operator_identity"])).toBe(1);
    } finally {
      await testSql`DELETE FROM supporter_patreon_creator_tokens WHERE campaign_id = ${options.config.patreon.campaignId}`;
    }
  });

  it("rotates encrypted credentials once, reuses committed access after restart, and never reseeds", async () => {
    const options = optionsFor("creator-rotation");
    const request = mock<OAuthFetch>(async (_input, init) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("client_id")).toBe(options.env.TOMORI_SUPPORTER_PATREON_CLIENT_ID ?? null);
      expect(body.get("client_secret")).toBe(options.env.TOMORI_SUPPORTER_PATREON_CLIENT_SECRET ?? null);
      expect(body.get("refresh_token")).toBe(options.env.TOMORI_SUPPORTER_PATREON_CREATOR_REFRESH_TOKEN ?? null);
      expect(init?.redirect).toBe("manual");
      return Response.json({
        access_token: "creator-access-one",
        refresh_token: "creator-refresh-two",
        token_type: "Bearer",
        expires_in: 3600,
      });
    });
    const access = await Promise.all([
      getPatreonCreatorAccessToken({ ...options, fetchImpl: request }),
      getPatreonCreatorAccessToken({ ...options, fetchImpl: request }),
    ]);
    expect(access).toEqual(["creator-access-one", "creator-access-one"]);
    expect(request).toHaveBeenCalledTimes(1);
    const [row] = await testSql<
      {
        access_token: Buffer;
        refresh_token: Buffer;
        access_token_key_version: number;
        refresh_token_key_version: number;
      }[]
    >`
      SELECT access_token, refresh_token, access_token_key_version, refresh_token_key_version
      FROM supporter_patreon_creator_tokens WHERE campaign_id = ${options.config.patreon.campaignId}
    `;
    expect(await decryptApiKey(row.access_token, row.access_token_key_version)).toBe("creator-access-one");
    expect(await decryptApiKey(row.refresh_token, row.refresh_token_key_version)).toBe("creator-refresh-two");
    clearPatreonCreatorTokenStateForTests();
    expect(
      await getPatreonCreatorAccessToken({
        ...options,
        env: { ...options.env, TOMORI_SUPPORTER_PATREON_CREATOR_REFRESH_TOKEN: undefined },
        fetchImpl: request,
      }),
    ).toBe("creator-access-one");
    expect(request).toHaveBeenCalledTimes(1);
    await testSql`UPDATE supporter_patreon_creator_tokens SET access_expires_at = NOW() WHERE campaign_id = ${options.config.patreon.campaignId}`;
    clearPatreonCreatorTokenStateForTests();
    request.mockImplementationOnce(async (_input, init) => {
      expect(new URLSearchParams(String(init?.body)).get("refresh_token")).toBe("creator-refresh-two");
      return Response.json({
        access_token: "creator-access-two",
        refresh_token: "creator-refresh-three",
        token_type: "Bearer",
        expires_in: 3600,
      });
    });
    expect(await getPatreonCreatorAccessToken({ ...options, fetchImpl: request })).toBe("creator-access-two");
  });

  it("refreshes a rejected creator access token once before retrying reconciliation", async () => {
    const options = optionsFor("creator-members-rejection");
    let refreshes = 0;
    let memberRequests = 0;
    const request = mock<OAuthFetch>(async (input, init) => {
      if (String(input).endsWith("/token")) {
        refreshes += 1;
        return Response.json({
          access_token: `members-access-${refreshes}`,
          refresh_token: `members-refresh-${refreshes}`,
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      memberRequests += 1;
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer members-access-${memberRequests}`);
      return memberRequests === 1 ? new Response(null, { status: 401 }) : Response.json({ data: [] });
    });
    expect(
      await fetchPatreonCampaignMemberPayloads({ config: options.config, env: options.env, fetchImpl: request }),
    ).toEqual([]);
    expect(refreshes).toBe(2);
    expect(memberRequests).toBe(2);
  });

  it("serializes independent coordinators through the database row lock", async () => {
    const options = optionsFor("creator-concurrent");
    const request = mock<OAuthFetch>(async () =>
      Response.json({
        access_token: "creator-concurrent-access",
        refresh_token: "creator-concurrent-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    );
    const first = new OAuthRefreshCoordinator();
    const second = new OAuthRefreshCoordinator();
    const refresh = {
      key: "creator",
      store: createPatreonCreatorTokenStore(options),
      endpoint: "https://www.patreon.com/api/oauth2/token",
      allowedOrigins: ["https://www.patreon.com"],
      fetchImpl: request,
      onFailure: () => {},
    };
    expect(await Promise.all([first.getAccessToken(refresh), second.getAccessToken(refresh)])).toEqual([
      "creator-concurrent-access",
      "creator-concurrent-access",
    ]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("persists invalid-grant blocking without logging secrets and permits explicit reauthorization", async () => {
    const options = optionsFor("creator-blocked");
    const request = mock<OAuthFetch>(async () =>
      Response.json(
        { error: "invalid_grant", error_description: "private-client-secret private-refresh-token" },
        { status: 400 },
      ),
    );
    const warning = spyOn(log, "warn").mockImplementation(() => {});
    try {
      await expect(getPatreonCreatorAccessToken({ ...options, fetchImpl: request })).rejects.toThrow();
      await expect(getPatreonCreatorAccessToken({ ...options, fetchImpl: request })).rejects.toThrow();
      expect(request).toHaveBeenCalledTimes(1);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warning.mock.calls)).not.toContain("private-client-secret");
      expect(JSON.stringify(warning.mock.calls)).not.toContain("private-refresh-token");
      const [row] = await testSql<
        { refresh_blocked_at: Date | null }[]
      >`SELECT refresh_blocked_at FROM supporter_patreon_creator_tokens WHERE campaign_id = ${options.config.patreon.campaignId}`;
      expect(row.refresh_blocked_at).not.toBeNull();
      await replacePatreonCreatorAuthorization(
        options.config.patreon.campaignId,
        "test-patreon-client-id",
        "reauthorized-refresh",
        testSql,
      );
      request.mockImplementationOnce(async (_input, init) => {
        expect(new URLSearchParams(String(init?.body)).get("refresh_token")).toBe("reauthorized-refresh");
        return Response.json({
          access_token: "reauthorized-access",
          refresh_token: "reauthorized-next",
          token_type: "Bearer",
          expires_in: 3600,
        });
      });
      expect(await getPatreonCreatorAccessToken({ ...options, fetchImpl: request })).toBe("reauthorized-access");
    } finally {
      warning.mockRestore();
    }
  });

  it("persists rate-limit retry times and skips requests until the retry window", async () => {
    const options = optionsFor("creator-retry");
    const request = mock<OAuthFetch>(
      async () => new Response(null, { status: 429, headers: { "Retry-After": "120" } }),
    );
    await expect(getPatreonCreatorAccessToken({ ...options, fetchImpl: request })).rejects.toThrow();
    clearPatreonCreatorTokenStateForTests();
    await expect(getPatreonCreatorAccessToken({ ...options, fetchImpl: request })).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    const [row] = await testSql<
      { refresh_retry_after: Date }[]
    >`SELECT refresh_retry_after FROM supporter_patreon_creator_tokens WHERE campaign_id = ${options.config.patreon.campaignId}`;
    expect(new Date(row.refresh_retry_after).getTime()).toBeGreaterThan(Date.now() + 115_000);
  });

  it("rolls back both tokens and serves no access if storage fails before commit", async () => {
    const options = optionsFor("creator-rollback");
    await replacePatreonCreatorAuthorization(
      options.config.patreon.campaignId,
      "test-patreon-client-id",
      "original-refresh",
      testSql,
    );
    const store = createPatreonCreatorTokenStore(options);
    const failures: string[] = [];
    const result = await new OAuthRefreshCoordinator().getAccessToken({
      key: "creator",
      store: {
        withLock: (operation) =>
          store.withLock(async (session) => {
            await operation(session);
            throw new Error("Simulated transaction commit failure.");
          }),
      },
      endpoint: "https://www.patreon.com/api/oauth2/token",
      allowedOrigins: ["https://www.patreon.com"],
      fetchImpl: async () =>
        Response.json({
          access_token: "uncommitted-access",
          refresh_token: "uncommitted-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        }),
      onFailure: (reason) => failures.push(reason),
    });
    expect(result).toBeNull();
    expect(failures).toEqual(["storage"]);
    const [row] = await testSql<
      { access_token: Buffer | null; refresh_token: Buffer; refresh_token_key_version: number }[]
    >`SELECT access_token, refresh_token, refresh_token_key_version FROM supporter_patreon_creator_tokens WHERE campaign_id = ${options.config.patreon.campaignId}`;
    expect(row.access_token).toBeNull();
    expect(await decryptApiKey(row.refresh_token, row.refresh_token_key_version)).toBe("original-refresh");
  });

  it("moves consumed legacy nonce receipts to the shared table without reopening replay", async () => {
    await testSql`CREATE TABLE supporter_oauth_states (nonce_hash TEXT, discord_user_id TEXT, expires_at TIMESTAMPTZ, consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ)`;
    await testSql`INSERT INTO supporter_oauth_states VALUES ('legacy-consumed', 'user-one', NOW() + INTERVAL '1 minute', NOW(), NOW())`;
    await initializeSupporterBillingSchema(testSql);
    expect(
      await new OAuthStateRepository(testSql).consumeStateNonce({
        flow: "patreon",
        subject: "user-one",
        nonceHash: "legacy-consumed",
      }),
    ).toBeNull();
    const [row] = await testSql<
      { flow: string; subject: string; consumed_at: Date | null }[]
    >`SELECT flow, subject, consumed_at FROM oauth_states WHERE nonce_hash = 'legacy-consumed'`;
    expect(row.flow).toBe("patreon");
    expect(row.subject).toBe("user-one");
    expect(row.consumed_at).not.toBeNull();
  });
});
