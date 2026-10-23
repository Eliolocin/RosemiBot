import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { sql as applicationSql } from "@/utils/db/client";
import { configRepository, personaRepository } from "@/utils/db/repositories";
import { resolveCapabilityCredentials } from "@/utils/provider/credentialResolver";
import { initializeLocalizer } from "@/utils/text/localizer";
import { MemberKeyRepository } from "@/modules/supporter-billing/db/repositories/memberKeys";
import {
  initializeSupporterBillingSchema,
  SupporterEntitlementRepository,
  SupporterIdentityRepository,
  SupporterSponsorshipRepository,
  type SupporterIdentityRow,
} from "@/modules/supporter-billing";
import { OpenRouterEngine } from "@/tools/webSearch/openrouterEngine";
import * as toolProgressNotice from "@/utils/discord/toolProgressNotice";
import type { ToolContext } from "@/types/tool/interfaces";
import { createMemberKeyMetadata } from "../../helpers/memberKeyMetadata";
import { useEnvSandbox } from "../../helpers/env";
import { withResolvedSupporterFunding } from "../../unit/supporterBilling/guards/fundingFixtures";
import { localizedCopy } from "../../helpers/localeCases";
import { cleanupFixtures, insertFixtures, type FixtureRefs, FIXTURE_IDS } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const MODEL = "_rt_guard/text";
const MEMBER_KEY = "synthetic-guard-member-key";

const supporterConfig = {
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
      defaultModelByCapability: { text: MODEL },
    },
  },
} as const;

describe.skipIf(!DB_TESTS_AVAILABLE)("supporter guard usage through the real credential resolver", () => {
  useEnvSandbox([
    "RUN_ENV",
    "TOMORI_SUPPORTER_BILLING_ENABLED",
    "TOMORI_SUPPORTER_CONFIG_JSON",
    "TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY",
  ]);
  let refs: FixtureRefs;
  let llmId: number;
  let identity: SupporterIdentityRow;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    await applicationSql`SELECT 1`;
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    process.env.TOMORI_SUPPORTER_CONFIG_JSON = JSON.stringify(supporterConfig);
    process.env.TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY = "synthetic-management-key";
    await initializeSupporterBillingSchema(testSql);
    identity = await new SupporterIdentityRepository(testSql).upsertIdentity({
      discordUserId: FIXTURE_IDS.userDiscId,
      patreonUserId: "_rt_guard_patreon_user",
      patreonMemberId: "_rt_guard_patreon_member",
      patreonCampaignId: "campaign_test",
    });
    await new SupporterEntitlementRepository(testSql).upsertSnapshot({
      supporterIdentityId: identity.supporter_identity_id,
      tierKey: "test_tier",
      patreonTierId: "tier_test",
      patronStatus: "active_patron",
      isActive: true,
      source: "oauth",
      lastVerifiedAt: new Date(),
      periodStart: new Date(Date.now() - 60_000),
      periodEnd: new Date(Date.now() + 3_600_000),
    });
    const memberKeys = new MemberKeyRepository(testSql);
    const created = await memberKeys.storeCreated(
      await memberKeys.initialize(identity),
      createHash("sha256").update(MEMBER_KEY).digest("hex"),
      MEMBER_KEY,
    );
    await memberKeys.save({ ...created, applied_limit: 1, disabled: false, pending_action: null });
    await new SupporterSponsorshipRepository(testSql).startActiveSponsorship({
      serverId: refs.serverId,
      serverDiscId: FIXTURE_IDS.serverDiscId,
      sponsorIdentityId: identity.supporter_identity_id,
      createdByDiscId: FIXTURE_IDS.userDiscId,
    });
    const [model] = await testSql`INSERT INTO llms (llm_codename, llm_provider)
      VALUES (${MODEL}, 'openrouter') RETURNING llm_id`;
    llmId = model.llm_id;
    await testSql`INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version, llm_id)
      VALUES (${refs.serverId}, 'supporter', NULL, 1, ${llmId})
      ON CONFLICT (server_id, provider) DO UPDATE SET llm_id = EXCLUDED.llm_id`;
    expect(await configRepository.updateModelConfig(refs.serverId, { llm_id: llmId }, "supporter")).toBe(true);
  });

  afterAll(async () => {
    await cleanupFixtures(testSql);
    await testSql`DELETE FROM llms WHERE llm_id = ${llmId}`;
  });

  it("records one usage row attributed to the funding the resolver loaded from database state", async () => {
    await initializeLocalizer();
    const creds = await resolveCapabilityCredentials(refs.serverId, "text");
    expect(creds.apiKey).toBe(MEMBER_KEY);

    const persona = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    if (!persona) throw new Error("Expected the fixture persona");
    const context = withResolvedSupporterFunding(
      {
        channel: {
          id: "_rt_guard_channel",
          send: async () => ({ id: "_rt_guard_notice" }),
        } as unknown as ToolContext["channel"],
        client: {} as ToolContext["client"],
        provider: "openrouter",
        locale: "en-US",
        suppressProgressNotices: true,
        tomoriState: persona,
      },
      creds,
    );
    const notice = spyOn(toolProgressNotice, "sendToolNotice").mockResolvedValue(undefined);
    const request = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: string | URL | Request) => {
          const url = input instanceof Request ? input.url : String(input);
          if (url.includes("/keys/")) {
            return Response.json({
              data: createMemberKeyMetadata({
                hash: createHash("sha256").update(MEMBER_KEY).digest("hex"),
                limit: 1,
                limit_remaining: 1,
              }),
            });
          }
          if (url.endsWith("/models")) {
            return Response.json({
              data: [
                {
                  id: MODEL,
                  context_length: 4096,
                  architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] },
                  supported_parameters: ["max_tokens"],
                  pricing: { prompt: "0.000001", completion: "0.000002" },
                },
              ],
            });
          }
          return Response.json({
            id: "synthetic-guard-search",
            usage: { cost: 0.0072, prompt_tokens: 100, completion_tokens: 1 },
            choices: [
              {
                message: {
                  annotations: [
                    {
                      type: "url_citation",
                      url_citation: { url: "https://example.com/guard", title: "Guard result", content: "Excerpt" },
                    },
                  ],
                },
              },
            ],
          });
        },
        { preconnect: () => undefined },
      ),
    );
    try {
      const result = await new OpenRouterEngine().search("fixture", "text", context);
      expect(result.success).toBe(true);
    } finally {
      notice.mockRestore();
      request.mockRestore();
    }

    const rows = async () =>
      testSql`SELECT funding_scope, server_id, capability, model_codename, cost_usd, provider_request_id
        FROM supporter_usage_statistics
        WHERE supporter_identity_id = ${identity.supporter_identity_id} AND capability = 'text'`;
    for (let attempt = 0; attempt < 50 && (await rows()).length === 0; attempt++) await Bun.sleep(10);
    expect(await rows()).toEqual([
      {
        funding_scope: "server",
        server_id: refs.serverId,
        capability: "text",
        model_codename: MODEL,
        cost_usd: 0.0072,
        provider_request_id: "synthetic-guard-search",
      },
    ]);
  });

  it("turns a spend refusal against the same resolved funding into the subscription copy", async () => {
    await testSql`UPDATE supporter_member_keys SET applied_limit = 0.000001
      WHERE supporter_identity_id = ${identity.supporter_identity_id}`;
    const creds = await resolveCapabilityCredentials(refs.serverId, "text");
    const persona = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    if (!persona) throw new Error("Expected the fixture persona");
    const context = withResolvedSupporterFunding(
      {
        channel: {
          id: "_rt_guard_channel",
          send: async () => ({ id: "_rt_guard_notice" }),
        } as unknown as ToolContext["channel"],
        client: {} as ToolContext["client"],
        provider: "openrouter",
        locale: "en-US",
        suppressProgressNotices: true,
        tomoriState: persona,
      },
      creds,
    );
    const notice = spyOn(toolProgressNotice, "sendToolNotice").mockResolvedValue(undefined);
    const request = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: string | URL | Request) => {
          const url = input instanceof Request ? input.url : String(input);
          if (url.includes("/keys/")) {
            return Response.json({ data: createMemberKeyMetadata({ hash: "synthetic-hash", limit: 0 }) });
          }
          if (url.endsWith("/models")) {
            return Response.json({
              data: [
                {
                  id: MODEL,
                  context_length: 4096,
                  architecture: { modality: "text->text" },
                  supported_parameters: ["max_tokens"],
                  pricing: { prompt: "0.000001", completion: "0.000002" },
                },
              ],
            });
          }
          throw new Error("The refused search must not reach the provider");
        },
        { preconnect: () => undefined },
      ),
    );
    try {
      const result = await new OpenRouterEngine().search("fixture", "text", context);
      expect(result.success).toBe(false);
      expect(result.error).toContain(localizedCopy("en-US", "commands.subscribe.request.scope.server"));
    } finally {
      notice.mockRestore();
      request.mockRestore();
    }
  });
});
