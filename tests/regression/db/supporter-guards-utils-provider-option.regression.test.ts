import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { ComponentType } from "discord.js";
import {
  initializeSupporterBillingSchema,
  SupporterEntitlementRepository,
  SupporterIdentityRepository,
  SupporterSponsorshipRepository,
  type SupporterIdentityRow,
} from "@/modules/supporter-billing";
import type { SupporterBillingConfig } from "@/modules/supporter-billing/config";
import type { LlmRow } from "@/types/db/schema";
import { resetOpenRouterCapabilityCache } from "@/utils/cache/openrouterCapabilityCache";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { resetDatabaseConnection } from "@/utils/db/client";
import { llmModelRepo, llmProviderRepo, personaRepository } from "@/utils/db/repositories";
import { configModelOperations, loadConfigModelProviders } from "@/utils/discord/interactions/configModelOperations";
import { buildInitialProvidersPanel } from "@/utils/discord/interactions/providersRoutes";
import { ensureSupporterEntry } from "@/modules/supporter-billing/discord/sponsorship";
import { loadServerProviderPanelScope, saveProviderModel } from "@/utils/provider/providerPanelOperations";
import { initializeLocalizer } from "@/utils/text/localizer";
import { useEnvSandbox } from "../../helpers/env";
import { localizedCopy } from "../../helpers/localeCases";
import { createRouteInteraction } from "../../helpers/routeInteraction";
import { naturalNudgePanelDependencies } from "@/modules/natural-nudges/discord/operations";
import { cleanupFixtures, FIXTURE_IDS, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const SUPPORTER_DISCORD_ID = "_rt_supporter_provider_option";

const SUPPORTER_CONFIG: SupporterBillingConfig = {
  patreon: {
    campaignId: "campaign_provider_option",
    oauthClientIdEnv: "TOMORI_SUPPORTER_PATREON_CLIENT_ID",
    oauthClientSecretEnv: "TOMORI_SUPPORTER_PATREON_CLIENT_SECRET",
    webhookSecretEnv: "TOMORI_SUPPORTER_PATREON_WEBHOOK_SECRET",
    creatorRefreshTokenEnv: "TOMORI_SUPPORTER_PATREON_CREATOR_REFRESH_TOKEN",
    manageUrl: "https://www.patreon.com/fixture",
  },
  jobs: {
    reconcileIntervalSeconds: 300,
    manualRefreshCooldownSeconds: 30,
  },
  tiers: {
    test_tier: {
      displayNameKey: "supporter.tiers.fixture",
      patreonTierIds: ["tier_fixture"],
      monthlyBudgetMicros: 100_000,
      defaultModelByCapability: { text: "fixture/placeholder" },
    },
  },
};

interface SelectOption {
  label: string;
  value: string;
}

function collectComponents(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const nested = Array.isArray(record.components) ? record.components.flatMap(collectComponents) : [];
  const component = record.component ? collectComponents(record.component) : [];
  return [record, ...nested, ...component];
}

function selectOptions(value: unknown): SelectOption[] {
  return collectComponents(value)
    .filter((component) => component.type === ComponentType.StringSelect)
    .flatMap((component) => (Array.isArray(component.options) ? (component.options as SelectOption[]) : []));
}

describe.skipIf(!DB_TESTS_AVAILABLE)("supporter provider option: stored rows", () => {
  useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED", "TOMORI_SUPPORTER_CONFIG_JSON"]);
  let refs: FixtureRefs;
  let identity: SupporterIdentityRow;
  let textModel: LlmRow;

  beforeAll(async () => {
    await setupTestDb();
    resetDatabaseConnection();
    refs = await insertFixtures(testSql);
    await initializeSupporterBillingSchema(testSql);
    await initializeLocalizer();

    const identities = new SupporterIdentityRepository(testSql);
    identity = await identities.upsertIdentity({
      discordUserId: SUPPORTER_DISCORD_ID,
      patreonUserId: "_rt_patreon_provider_option",
      patreonMemberId: "_rt_member_provider_option",
      patreonCampaignId: SUPPORTER_CONFIG.patreon.campaignId,
    });
    await new SupporterEntitlementRepository(testSql).upsertSnapshot({
      supporterIdentityId: identity.supporter_identity_id,
      tierKey: "test_tier",
      patreonTierId: "tier_fixture",
      patronStatus: "active_patron",
      isActive: true,
      source: "oauth",
      lastVerifiedAt: new Date(),
      periodStart: new Date(Date.now() - 60_000),
      periodEnd: new Date(Date.now() + 3_600_000),
    });
    await new SupporterSponsorshipRepository(testSql).startActiveSponsorship({
      serverId: refs.serverId,
      serverDiscId: FIXTURE_IDS.serverDiscId,
      sponsorIdentityId: identity.supporter_identity_id,
      createdByDiscId: SUPPORTER_DISCORD_ID,
    });

    const defaultModel = await llmModelRepo.loadDefaultModel("openrouter");
    if (!defaultModel?.llm_id) throw new Error("Expected a seeded OpenRouter text model");
    textModel = defaultModel;
    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    if (!state) throw new Error("Expected a configured fixture workspace");
    expect(
      await ensureSupporterEntry({
        kind: "server",
        serverId: refs.serverId,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        state,
      }),
    ).toBe(true);

    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    process.env.TOMORI_SUPPORTER_CONFIG_JSON = JSON.stringify({
      ...SUPPORTER_CONFIG,
      tiers: {
        test_tier: {
          ...SUPPORTER_CONFIG.tiers.test_tier,
          defaultModelByCapability: { text: textModel.llm_codename },
        },
      },
    });
  });

  afterAll(async () => {
    resetOpenRouterCapabilityCache();
    await cleanupFixtures(testSql);
    await testSql`DELETE FROM supporter_identities WHERE discord_user_id = ${SUPPORTER_DISCORD_ID}`;
  });

  it("stores the supporter payer row and capability marker when a subscription model is picked", async () => {
    await testSql`UPDATE server_model_configs
      SET subscription_capabilities = '{}', llm_id = NULL
      WHERE server_id = ${refs.serverId}`;
    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    if (!state) throw new Error("Expected a configured fixture workspace");
    resetOpenRouterCapabilityCache();
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async () =>
          Response.json({
            data: [
              {
                id: textModel.llm_codename,
                context_length: 4096,
                architecture: { modality: "text->text" },
                supported_parameters: ["max_tokens"],
                pricing: { prompt: "0.000001", completion: "0.000001" },
              },
            ],
          }),
        { preconnect: globalThis.fetch.preconnect },
      ),
    );

    try {
      const result = await saveProviderModel({
        serverDiscId: FIXTURE_IDS.serverDiscId,
        state,
        entryId: "provider:supporter",
        capability: "text",
        codeName: textModel.llm_codename,
      });

      expect(result).toMatchObject({ status: "success", entryId: "provider:supporter" });
      const saved = await llmProviderRepo.loadSavedProviderConfig(refs.serverId, "supporter");
      expect(saved).toMatchObject({ provider: "supporter", llm_id: textModel.llm_id, api_key: null });
      const [configRow] = await testSql<
        Array<{ llm_id: number | null; subscription_capabilities: string[] }>
      >`SELECT llm_id, subscription_capabilities FROM server_model_configs WHERE server_id = ${refs.serverId}`;
      expect(configRow).toMatchObject({ llm_id: textModel.llm_id });
      expect(configRow?.subscription_capabilities).toContain("text");
      expect(await loadConfigModelProviders(refs.serverId, "text")).toContain("supporter");
    } finally {
      fetchSpy.mockRestore();
      resetOpenRouterCapabilityCache();
    }
  });

  it("writes the subscription capability marker when the config model list picks the subscription provider", async () => {
    const [embedding] = await testSql<Array<{ embedding_model_id: number }>>`
      SELECT embedding_model_id FROM embedding_models
      WHERE provider = 'openrouter' AND NOT is_deprecated AND NOT is_scoped_registration
      ORDER BY embedding_model_id LIMIT 1`;
    if (!embedding) throw new Error("Expected a seeded OpenRouter embedding model");
    await testSql`INSERT INTO scoped_model_registrations (server_id, embedding_model_id)
      VALUES (${refs.serverId}, ${embedding.embedding_model_id})
      ON CONFLICT DO NOTHING`;
    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    if (!state) throw new Error("Expected a configured fixture workspace");

    expect(await loadConfigModelProviders(refs.serverId, "embedding")).toContain("supporter");
    expect(
      await configModelOperations.setCapabilityModel({
        tomoriState: state,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        capability: "embedding",
        provider: "supporter",
        modelId: embedding.embedding_model_id,
      }),
    ).toMatchObject({ status: "success" });
    const [selected] = await testSql<
      Array<{ embedding_model_id: number | null; subscription_capabilities: string[] }>
    >`SELECT embedding_model_id, subscription_capabilities
      FROM server_model_configs WHERE server_id = ${refs.serverId}`;
    expect(selected).toMatchObject({ embedding_model_id: embedding.embedding_model_id });
    expect(selected?.subscription_capabilities).toContain("embedding");

    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "false";
    expect(await loadConfigModelProviders(refs.serverId, "embedding")).not.toContain("supporter");
    expect(
      await configModelOperations.setCapabilityModel({
        tomoriState: state,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        capability: "embedding",
        provider: "supporter",
        modelId: embedding.embedding_model_id,
      }),
    ).toEqual({ status: "not-found" });
    const [unchanged] = await testSql<
      Array<{ subscription_capabilities: string[] }>
    >`SELECT subscription_capabilities FROM server_model_configs WHERE server_id = ${refs.serverId}`;
    expect(unchanged?.subscription_capabilities).toContain("embedding");
  });

  it("stores and releases the real Subscription nudge slot payers", async () => {
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    if (!state || !textModel.llm_id) throw new Error("Expected a configured fixture workspace");
    const operations = naturalNudgePanelDependencies.operations;
    expect(await operations.setPlannerModel(state, "supporter", textModel.llm_id)).toBe("success");
    expect(await operations.setCheckerModel(state, { kind: "llm", provider: "supporter", id: textModel.llm_id })).toBe(
      "success",
    );
    const reload = async () => {
      const reloaded = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
      if (!reloaded) throw new Error("Expected the saved workspace");
      return reloaded;
    };
    const funded = await reload();
    expect(funded.config.subscription_capabilities).toEqual(expect.arrayContaining(["nudge_planner", "nudge_checker"]));
    expect(await operations.setPlannerModel(funded, "", null)).toBe("success");
    expect(await operations.setCheckerModel(funded, null)).toBe("success");
    const cleared = await reload();
    expect(cleared.config.subscription_capabilities).not.toContain("nudge_planner");
    expect(cleared.config.subscription_capabilities).not.toContain("nudge_checker");
  });

  it("shows the subscription entry only while the stored sponsorship stays active", async () => {
    const interaction = createRouteInteraction({ isManager: true });
    if (!interaction.guild) throw new Error("Expected a guild interaction");
    Object.assign(interaction.guild.members, {
      cache: new Map([[identity.discord_user_id, { displayName: "Mirri" }]]),
    });
    const panelLabels = async () => {
      invalidateTomoriStateCache(FIXTURE_IDS.serverDiscId);
      const scope = await loadServerProviderPanelScope(FIXTURE_IDS.serverDiscId);
      if (!scope) throw new Error("Expected a provider panel scope");
      const payload = await buildInitialProvidersPanel(interaction as never, "en-US", {
        resolveScope: async () => scope,
      });
      return selectOptions(payload).map((option) => option.label);
    };
    const subscriptionLabel = localizedCopy("en-US", "commands.providers.subscription_label");
    const subscribeLabel = localizedCopy("en-US", "commands.providers.subscribe");

    const sponsored = await panelLabels();
    expect(sponsored).toContain(subscriptionLabel);
    expect(sponsored).not.toContain(subscribeLabel);

    await testSql`UPDATE supporter_server_sponsorships
      SET status = 'revoked', revoked_at = NOW()
      WHERE server_id = ${refs.serverId} AND status = 'active'`;
    const unsponsored = await panelLabels();
    expect(unsponsored).not.toContain(subscriptionLabel);
    expect(unsponsored).toContain(subscribeLabel);

    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "false";
    const disabled = await panelLabels();
    expect(disabled).not.toContain(subscriptionLabel);
    expect(disabled).not.toContain(subscribeLabel);
  });
});
