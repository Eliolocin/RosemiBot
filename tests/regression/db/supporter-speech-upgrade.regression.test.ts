import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SQL, TransactionSQL } from "bun";
import { runMigrations } from "@/db/migrationRunner";
import {
  initializeSupporterBillingSchema,
  SupporterEntitlementRepository,
  SupporterIdentityRepository,
  SupporterSponsorshipRepository,
} from "@/modules/supporter-billing/db";
import { MemberKeyRepository } from "@/modules/supporter-billing/db/repositories/memberKeys";
import { splitSqlStatements } from "@/utils/db/sqlSplitter";
import { loadHostedSpeechSelection, setHostedSpeechSelection } from "@/utils/db/repositories/SpeechRepository";
import { resolveSpeechTargets } from "@/utils/provider/speechEndpointResolver";
import { encryptApiKey } from "@/utils/security/crypto";
import { useEnvSandbox } from "../../helpers/env";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";
import { LAUNCH_MIGRATION_NAMES } from "./supporterMigrationHistory";

const MIGRATIONS_DIR = path.join(process.cwd(), "src/db/migrations");
const BAND_MIGRATIONS = [
  "900_shared_oauth_states",
  "901_subscription_speech_selections",
  "902_subscription_capability_ownership",
] as const;
const TAG_PREFIX = "_rt_supporter_speech_";
const ROLLBACK = new Error("rollback");

interface SpeechScenario {
  serverId: number;
  userId: number;
  cloneModelId: number;
  googleModelId: number;
  supporterConfigId: number;
  openrouterConfigId: number;
  personalConfigId: number;
}

async function inRolledBackTransaction(body: (tx: TransactionSQL) => Promise<void>): Promise<void> {
  try {
    await testSql.begin(async (tx) => {
      await body(tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

async function applyMigration(client: SQL, name: string): Promise<void> {
  const sqlText = await readFile(path.join(MIGRATIONS_DIR, name), "utf-8");
  for (const statement of splitSqlStatements(sqlText)) await client.unsafe(statement);
}

async function insertScenario(client: SQL, tag: string): Promise<SpeechScenario> {
  const [server] = await client<{ server_id: number }[]>`
    INSERT INTO servers (server_disc_id) VALUES (${`${TAG_PREFIX}${tag}`}) RETURNING server_id
  `;
  const [user] = await client<{ user_id: number }[]>`
    INSERT INTO users (user_disc_id) VALUES (${`${TAG_PREFIX}${tag}`}) RETURNING user_id
  `;
  await client`INSERT INTO server_model_configs (server_id) VALUES (${server.server_id})`;
  await client`INSERT INTO server_speech_configs (server_id) VALUES (${server.server_id})`;
  const [clone] = await client<{ speech_model_id: number }[]>`
    SELECT speech_model_id FROM speech_models
    WHERE provider = 'openrouter' AND voice_mode = 'clone' AND NOT is_deprecated
    ORDER BY is_default DESC, speech_model_id LIMIT 1
  `;
  const [google] = await client<{ speech_model_id: number }[]>`
    SELECT speech_model_id FROM speech_models
    WHERE provider = 'google' AND voice_mode IN ('design', 'auto') AND NOT is_deprecated
    ORDER BY is_default DESC, speech_model_id LIMIT 1
  `;
  if (!clone || !google) throw new Error("Missing seeded speech models");
  const key = await encryptApiKey(`synthetic-supporter-speech-${tag}`);
  const [supporter] = await client<{ saved_config_id: number }[]>`
    INSERT INTO saved_provider_configs (server_id, provider)
    VALUES (${server.server_id}, 'supporter') RETURNING saved_config_id
  `;
  const [openrouter] = await client<{ saved_config_id: number }[]>`
    INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version)
    VALUES (${server.server_id}, 'openrouter', ${key.encrypted}, ${key.version}) RETURNING saved_config_id
  `;
  const [personal] = await client<{ user_saved_config_id: number }[]>`
    INSERT INTO user_saved_provider_configs (user_id, provider)
    VALUES (${user.user_id}, 'supporter') RETURNING user_saved_config_id
  `;
  return {
    serverId: server.server_id,
    userId: user.user_id,
    cloneModelId: clone.speech_model_id,
    googleModelId: google.speech_model_id,
    supporterConfigId: supporter.saved_config_id,
    openrouterConfigId: openrouter.saved_config_id,
    personalConfigId: personal.user_saved_config_id,
  };
}

async function readSelection(client: SQL, serverId: number): Promise<number | null> {
  const [row] = await client<{ speech_clone_model_id: number | null }[]>`
    SELECT speech_clone_model_id FROM server_speech_configs WHERE server_id = ${serverId}
  `;
  return row?.speech_clone_model_id ?? null;
}

async function readCapabilities(client: SQL, serverId: number): Promise<string[]> {
  const [row] = await client<{ subscription_capabilities: string[] }[]>`
    SELECT subscription_capabilities FROM server_model_configs WHERE server_id = ${serverId}
  `;
  return row?.subscription_capabilities ?? [];
}

async function insertOpenRouterKey(client: SQL, serverId: number, tag: string): Promise<void> {
  const key = await encryptApiKey(`synthetic-supporter-speech-${tag}-replacement`);
  await client`
    INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version)
    VALUES (${serverId}, 'openrouter', ${key.encrypted}, ${key.version})
  `;
}

describe.skipIf(!DB_TESTS_AVAILABLE)("Subscription speech upgrade regressions", () => {
  useEnvSandbox([
    "RUN_ENV",
    "TOMORI_SUPPORTER_BILLING_ENABLED",
    "TOMORI_SUPPORTER_CONFIG_JSON",
    "TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY",
  ]);

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await testSql`DELETE FROM servers WHERE server_disc_id LIKE ${`${TAG_PREFIX}%`}`;
    await testSql`DELETE FROM users WHERE user_disc_id LIKE ${`${TAG_PREFIX}%`}`;
  });

  it("records and executes the deployment band on the disposable fresh install", async () => {
    const recorded = await testSql<{ name: string }[]>`
      SELECT name FROM schema_migrations
      WHERE name IN (${BAND_MIGRATIONS[0]}, ${BAND_MIGRATIONS[1]}, ${BAND_MIGRATIONS[2]})
      ORDER BY name
    `;
    expect(recorded.map(({ name }) => name)).toEqual([...BAND_MIGRATIONS]);

    const legacy = await testSql<{ name: string }[]>`
      SELECT name FROM schema_migrations
      WHERE name IN ('100_shared_oauth_states', '103_subscription_speech_selections',
        '117_subscription_capability_ownership')
    `;
    expect(legacy).toEqual([]);

    const [oauth] = await testSql<{ table_name: string | null }[]>`
      SELECT to_regclass('public.oauth_states')::text AS table_name
    `;
    expect(oauth.table_name).toBe("oauth_states");
    const [oauthIndex] = await testSql<{ index_name: string | null }[]>`
      SELECT to_regclass('public.idx_oauth_states_expires')::text AS index_name
    `;
    expect(oauthIndex.index_name).toBe("idx_oauth_states_expires");
    const [capabilities] = await testSql<{ count: number }[]>`
      SELECT COUNT(*)::INT AS count FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'server_model_configs'
        AND column_name = 'subscription_capabilities'
    `;
    expect(capabilities.count).toBe(1);
  });

  it("accepts Subscription-backed hosted speech selections without a BYOK key", async () => {
    const scenario = await insertScenario(testSql, "validate");
    await testSql`DELETE FROM saved_provider_configs WHERE saved_config_id = ${scenario.openrouterConfigId}`;
    const serverScope = { kind: "server" as const, ownerId: scenario.serverId };
    const personalScope = { kind: "personal" as const, ownerId: scenario.userId };

    expect(
      await setHostedSpeechSelection(serverScope, scenario.cloneModelId, "clone", false, undefined, "supporter"),
    ).toBe(true);
    expect(await readSelection(testSql, scenario.serverId)).toBe(scenario.cloneModelId);
    expect(await readCapabilities(testSql, scenario.serverId)).toContain("speech_clone");
    expect(await loadHostedSpeechSelection(scenario.serverId, "clone", undefined, true)).toMatchObject({
      subscription: true,
      credentialId: scenario.supporterConfigId,
      apiKey: null,
      model: { speech_model_id: scenario.cloneModelId },
    });
    expect(await setHostedSpeechSelection(serverScope, scenario.googleModelId)).toBe(false);
    expect(await readSelection(testSql, scenario.serverId)).toBe(scenario.cloneModelId);

    expect(
      await setHostedSpeechSelection(personalScope, scenario.cloneModelId, "clone", false, undefined, "supporter"),
    ).toBe(true);
    expect(await loadHostedSpeechSelection(scenario.serverId, "clone", scenario.userId, true)).toMatchObject({
      subscription: true,
      credentialId: scenario.personalConfigId,
      model: { speech_model_id: scenario.cloneModelId },
    });
  });

  it("keeps the paid selection when the OpenRouter key is cleared or its provider row is removed", async () => {
    const scenario = await insertScenario(testSql, "revise");
    const serverScope = { kind: "server" as const, ownerId: scenario.serverId };
    expect(
      await setHostedSpeechSelection(serverScope, scenario.cloneModelId, "clone", false, undefined, "supporter"),
    ).toBe(true);

    await testSql`UPDATE saved_provider_configs SET api_key = NULL
      WHERE saved_config_id = ${scenario.openrouterConfigId}`;
    expect(await readSelection(testSql, scenario.serverId)).toBe(scenario.cloneModelId);
    expect(await readCapabilities(testSql, scenario.serverId)).toContain("speech_clone");
    expect(await loadHostedSpeechSelection(scenario.serverId, "clone", undefined, true)).toMatchObject({
      subscription: true,
      credentialId: scenario.supporterConfigId,
    });

    await testSql`DELETE FROM saved_provider_configs WHERE saved_config_id = ${scenario.openrouterConfigId}`;
    expect(await readSelection(testSql, scenario.serverId)).toBe(scenario.cloneModelId);
    expect(await readCapabilities(testSql, scenario.serverId)).toContain("speech_clone");
    expect(await loadHostedSpeechSelection(scenario.serverId, "clone", undefined, true)).toMatchObject({
      subscription: true,
      credentialId: scenario.supporterConfigId,
    });

    await testSql`DELETE FROM saved_provider_configs WHERE saved_config_id = ${scenario.supporterConfigId}`;
    expect(await readSelection(testSql, scenario.serverId)).toBeNull();
    expect(await loadHostedSpeechSelection(scenario.serverId, "clone", undefined, true)).toBeNull();
  });

  it("bills a retained Subscription speech selection to the sponsoring member key", async () => {
    const scenario = await insertScenario(testSql, "billing");
    const billingCampaign = "synthetic-supporter-speech-upgrade-campaign";
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    process.env.TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY = "synthetic-management-key";
    process.env.TOMORI_SUPPORTER_CONFIG_JSON = JSON.stringify({
      patreon: {
        campaignId: billingCampaign,
        oauthClientIdEnv: "CLIENT_ID",
        oauthClientSecretEnv: "CLIENT_SECRET",
        webhookSecretEnv: "WEBHOOK_SECRET",
        creatorRefreshTokenEnv: "REFRESH_TOKEN",
        manageUrl: "https://www.patreon.com/example",
      },
      jobs: { reconcileIntervalSeconds: 300, manualRefreshCooldownSeconds: 30 },
      tiers: {
        synthetic: {
          displayNameKey: "supporter.tiers.synthetic",
          patreonTierIds: ["synthetic"],
          monthlyBudgetMicros: 100000,
          defaultModelByCapability: { text: "example/text", voice: { clone: "fish-audio/s2.1-pro" } },
        },
      },
    });
    await initializeSupporterBillingSchema(testSql);
    const identity = await new SupporterIdentityRepository(testSql).upsertIdentity({
      discordUserId: `${TAG_PREFIX}billing-sponsor`,
      patreonUserId: `${TAG_PREFIX}billing-user`,
      patreonMemberId: `${TAG_PREFIX}billing-member`,
      patreonCampaignId: billingCampaign,
    });
    await new SupporterEntitlementRepository(testSql).upsertSnapshot({
      supporterIdentityId: identity.supporter_identity_id,
      tierKey: "synthetic",
      patreonTierId: "synthetic",
      patronStatus: "active_patron",
      isActive: true,
      source: "oauth",
      lastVerifiedAt: new Date(),
      periodStart: new Date(Date.now() - 60_000),
      periodEnd: new Date(Date.now() + 3_600_000),
    });
    const memberKeys = new MemberKeyRepository(testSql);
    const initial = await memberKeys.initialize(identity);
    const createdKey = await memberKeys.storeCreated(
      initial,
      "synthetic-supporter-speech-upgrade-hash",
      "synthetic-supporter-speech-upgrade-member",
    );
    await memberKeys.save({ ...createdKey, applied_limit: 0.1, disabled: false, pending_action: null });
    await new SupporterSponsorshipRepository(testSql).startActiveSponsorship({
      serverId: scenario.serverId,
      serverDiscId: `${TAG_PREFIX}billing`,
      sponsorIdentityId: identity.supporter_identity_id,
      createdByDiscId: `${TAG_PREFIX}billing-sponsor`,
    });
    try {
      expect(
        await setHostedSpeechSelection(
          { kind: "server", ownerId: scenario.serverId },
          scenario.cloneModelId,
          "clone",
          false,
          undefined,
          "supporter",
        ),
      ).toBe(true);
      const target = (await resolveSpeechTargets(scenario.serverId)).clone;
      expect(target).toMatchObject({
        kind: "hosted-model",
        apiKey: "synthetic-supporter-speech-upgrade-member",
        subscription: true,
        model: { speech_model_id: scenario.cloneModelId },
      });
    } finally {
      await testSql`DELETE FROM supporter_identities WHERE patreon_campaign_id = ${billingCampaign}`;
    }
  });

  it("keeps billing-aware speech functions when pending migrations run after a recorded launch history", async () => {
    await inRolledBackTransaction(async (tx) => {
      for (const migration of BAND_MIGRATIONS) await applyMigration(tx, `${migration}.sql`);
      const history = [...LAUNCH_MIGRATION_NAMES];
      await tx`DELETE FROM schema_migrations WHERE NOT (name = ANY(${tx.array(history, "text")}))`;
      await tx`
        INSERT INTO schema_migrations (name)
        SELECT unnest(${tx.array(history, "text")}) ON CONFLICT DO NOTHING
      `;
      await runMigrations(tx, MIGRATIONS_DIR);

      const scenario = await insertScenario(tx, "upgrade");
      await tx`DELETE FROM saved_provider_configs WHERE saved_config_id = ${scenario.openrouterConfigId}`;
      await tx`UPDATE server_model_configs SET subscription_capabilities = ARRAY['speech_clone']
        WHERE server_id = ${scenario.serverId}`;
      await tx`UPDATE server_speech_configs SET speech_clone_model_id = ${scenario.cloneModelId}
        WHERE server_id = ${scenario.serverId}`;
      expect(await readSelection(tx, scenario.serverId)).toBe(scenario.cloneModelId);
      expect(await readCapabilities(tx, scenario.serverId)).toContain("speech_clone");

      await tx`UPDATE user_saved_provider_configs
        SET speech_clone_model_id = ${scenario.cloneModelId},
          assigned_capabilities = ARRAY['speech_clone'], enabled_capabilities = ARRAY['speech_clone']
        WHERE user_saved_config_id = ${scenario.personalConfigId}`;
      const [personal] = await tx<{ speech_clone_model_id: number | null; assigned_capabilities: string[] }[]>`
        SELECT speech_clone_model_id, assigned_capabilities FROM user_saved_provider_configs
        WHERE user_saved_config_id = ${scenario.personalConfigId}
      `;
      expect(personal.speech_clone_model_id).toBe(scenario.cloneModelId);
      expect(personal.assigned_capabilities).toContain("speech_clone");

      await insertOpenRouterKey(tx, scenario.serverId, "upgrade");
      await tx`UPDATE saved_provider_configs SET api_key = NULL
        WHERE server_id = ${scenario.serverId} AND provider = 'openrouter'`;
      expect(await readSelection(tx, scenario.serverId)).toBe(scenario.cloneModelId);
      expect(await readCapabilities(tx, scenario.serverId)).toContain("speech_clone");

      await tx`DELETE FROM saved_provider_configs
        WHERE server_id = ${scenario.serverId} AND provider = 'openrouter'`;
      expect(await readSelection(tx, scenario.serverId)).toBe(scenario.cloneModelId);
      expect(await readCapabilities(tx, scenario.serverId)).toContain("speech_clone");

      await tx`DELETE FROM saved_provider_configs
        WHERE server_id = ${scenario.serverId} AND provider = 'supporter'`;
      expect(await readSelection(tx, scenario.serverId)).toBeNull();
    });
  });
});
