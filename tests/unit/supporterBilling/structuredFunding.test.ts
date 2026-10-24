import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  supporterProviderOption,
  registerSupporterProviderOption,
} from "@/modules/supporter-billing/discord/providerOption";
import * as managedProvider from "@/modules/supporter-billing/runtime/managedProvider";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import { getSupporterUsageContext } from "@/modules/supporter-billing/runtime/types";
import {
  supporterUsageStatisticsRepository,
  supporterIdentityRepository,
  supporterEntitlementRepository,
  supporterSponsorshipRepository,
} from "@/modules/supporter-billing/db";
import { planIdleNudge } from "@/modules/natural-nudges/runtime/planner";
import { BUILTIN_IDLE_NUDGES } from "@/modules/natural-nudges/runtime/idleNudges";
import { generatePersonaInterests } from "@/modules/natural-nudges/runtime/interests";
import { matchActiveNudge, resolveMatcherBackend } from "@/modules/natural-nudges/runtime/matcher";
import * as nudgeModel from "@/modules/natural-nudges/runtime/model";
import { callDecisionsForProvider } from "@/providers/utils/providerFeatureExecutors";
import { OpenrouterProvider } from "@/providers/openrouter/openrouterProvider";
import { decisionModelSchema, savedProviderConfigSchema } from "@/types/db/schema";
import type {
  DecisionModelOption,
  SupportsStructuredOutput,
  ProviderDecisionRequest,
} from "@/types/provider/featureInterfaces";
import { llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import * as capabilities from "@/utils/provider/providerCapabilityResolver";
import * as crypto from "@/utils/security/crypto";
import { currentProviderUsageContext } from "@/utils/provider/providerUsage";
import { resolveServerStructuredModel } from "@/utils/provider/serverStructuredOutput";
import { createLlmRow, createPersona } from "../../helpers/fixtures";
import { useEnvSandbox } from "../../helpers/env";
import { createServerFunding } from "./guards/utils-fundingFixtures";
import { findProviderOption } from "@/utils/provider/providerOptionRegistry";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function track<T extends { mockRestore(): void }>(spy: T): T {
  cleanups.push(() => spy.mockRestore());
  return spy;
}
const model = createLlmRow({ llm_id: 51, llm_provider: "openrouter", supports_structoutput: true });
const saved = savedProviderConfigSchema.parse({
  server_id: 7,
  provider: "openrouter",
  api_key: Buffer.from("fixture-byok"),
  llm_id: 51,
  diffusion_model_id: null,
  embedding_model_id: null,
  nai_diffusion_model_id: null,
  nai_preset_name: null,
  llm_disabled_params: [],
  llm_logit_biases: [],
  fallback_model_refs: [],
  thinking_level: "auto",
});
const decision: DecisionModelOption = {
  model: decisionModelSchema.parse({
    decision_model_id: 31,
    provider: "openrouter",
    codename: "fixture/decision",
    input_token_limit: 32000,
    supported_primitives: ["predicate", "choice"],
    is_default: true,
  }),
  reference: { provider: "openrouter", modelId: 31, registrationId: null, customEndpointId: null },
};

describe("Subscription structured-call payer ownership", () => {
  useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED", "TOMORI_SUPPORTER_CONFIG_JSON"]);
  beforeEach(() => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    if (!findProviderOption("supporter")) cleanups.push(registerSupporterProviderOption());
  });

  it("resolves each real Subscription structured slot and carries its context through calls and format retries", async () => {
    const funding = createServerFunding({ modelCodename: model.llm_codename });
    const usageContext = getSupporterUsageContext(funding);
    const state = createPersona({
      server_id: 7,
      llm: model,
      config: { subscription_capabilities: ["text", "reviewer", "nudge_planner", "nudge_checker"] },
    });
    const member = track(
      spyOn(managedProvider, "resolveSupporterCapabilityCredentials").mockResolvedValue({
        apiKey: "fixture-member",
        funding,
      }),
    );
    track(spyOn(llmModelRepo, "loadById").mockResolvedValue(model));
    track(spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockResolvedValue([model]));
    track(
      spyOn(llmProviderRepo, "loadSavedProviderConfig").mockResolvedValue({
        ...saved,
        provider: "supporter",
        api_key: null,
      }),
    );
    track(
      spyOn(nudgeModel, "resolveStructuredCallTarget").mockResolvedValue({
        model: model.llm_codename,
        endpointUrl: undefined,
        maxOutputTokens: 256,
      }),
    );
    track(spyOn(supporterUsageStatisticsRepository, "record").mockResolvedValue(true));
    let reply: unknown = { proceed: false };
    let malformed = false;
    let calls = 0;
    const capability: SupportsStructuredOutput = {
      async callStructuredJSON(request, _schema, zodSchema) {
        calls++;
        expect(request.apiKey).toBe("fixture-member");
        expect(currentProviderUsageContext()).toBe(usageContext);
        request.onUsage?.({ inputTokens: 2, outputTokens: 1, costUsd: 0 });
        if (malformed) {
          malformed = false;
          return { success: false, error: "fixture", failure: "malformed", malformed: { reason: "unparsable" } };
        }
        return { success: true, data: zodSchema.parse(reply) };
      },
    };
    track(
      spyOn(capabilities, "resolveStructuredOutputCapability").mockResolvedValue(
        Object.assign(new OpenrouterProvider(), capability),
      ),
    );
    for (const slot of ["text", "reviewer", "nudge-planner", "nudge-checker"] as const) {
      expect(supporterProviderOption.selection.owns?.({ kind: "server", ownerId: 7, state }, slot)).toBe(true);
      expect(await resolveServerStructuredModel(state, model.llm_id as number, {}, slot)).toMatchObject({
        apiKey: "fixture-member",
        usageContext,
      });
    }
    malformed = true;
    expect(
      await planIdleNudge({
        persona: state,
        interests: [],
        idleNudge: BUILTIN_IDLE_NUDGES[0],
        channels: [],
        plannerModel: { llmId: 51, slot: "nudge-planner" },
        target: null,
        partners: [],
      }),
    ).toMatchObject({ status: "declined" });
    reply = { topic: "none" };
    malformed = true;
    expect(
      await matchActiveNudge({
        state,
        backend: { kind: "llm", llmId: 51, slot: "nudge-checker", model: model.llm_codename },
        options: [{ id: "i01", text: "tea" }],
        evidence: "fixture",
      }),
    ).toMatchObject({ reason: "none" });
    reply = { interests: [{ label: "tea", description: "Brewing tea." }] };
    expect(await generatePersonaInterests(state, { llmId: 51, slot: "nudge-planner" }, [], 1)).toMatchObject({
      status: "generated",
      interests: [{ label: "tea" }],
    });
    expect(calls).toBe(5);
    expect(member.mock.calls.every(([request]) => request.capability === "text")).toBe(true);
    expect(currentProviderUsageContext()).toBeUndefined();
  });

  it("uses BYOK until the Decision slot is explicitly funded and refuses a denied funded request", async () => {
    const funding = createServerFunding({ capability: "decision", modelCodename: decision.model.codename });
    const state = createPersona({ server_id: 7, config: { decision_model_id: 31 } });
    const now = new Date();
    process.env.TOMORI_SUPPORTER_CONFIG_JSON = JSON.stringify({
      patreon: {
        campaignId: "fixture-campaign",
        oauthClientIdEnv: "FIXTURE_CLIENT_ID",
        oauthClientSecretEnv: "FIXTURE_CLIENT_SECRET",
        webhookSecretEnv: "FIXTURE_WEBHOOK_SECRET",
        creatorRefreshTokenEnv: "FIXTURE_REFRESH_TOKEN",
        manageUrl: "https://www.patreon.com/fixture",
      },
      jobs: { reconcileIntervalSeconds: 300, manualRefreshCooldownSeconds: 30 },
      tiers: {
        fixture_tier: {
          displayNameKey: "fixture",
          patreonTierIds: ["fixture-tier"],
          monthlyBudgetMicros: 100000,
          defaultModelByCapability: { decision: decision.model.codename },
        },
      },
    });
    track(
      spyOn(supporterSponsorshipRepository, "loadActiveSponsorshipForServer").mockResolvedValue({
        sponsorship_id: 40,
        server_id: 7,
        server_disc_id: "fixture-server",
        sponsor_identity_id: 10,
        status: "active",
        created_by_disc_id: "fixture_sponsor",
        created_at: now,
        updated_at: now,
        revoked_at: null,
      }),
    );
    track(
      spyOn(supporterIdentityRepository, "loadById").mockResolvedValue({
        supporter_identity_id: 10,
        discord_user_id: "fixture_sponsor",
        patreon_user_id: "fixture-user",
        patreon_member_id: "fixture-member",
        patreon_campaign_id: "fixture-campaign",
        linked_at: now,
        last_oauth_at: now,
        created_at: now,
        updated_at: now,
      }),
    );
    track(
      spyOn(supporterEntitlementRepository, "loadByIdentityId").mockResolvedValue({
        supporter_entitlement_id: 20,
        supporter_identity_id: 10,
        tier_key: "fixture_tier",
        patreon_tier_id: "fixture-tier",
        patron_status: "active_patron",
        is_active: true,
        cancel_at_period_end: false,
        period_start: null,
        period_end: null,
        last_verified_at: now,
        last_successful_charge_at: null,
        next_charge_at: null,
        source: "oauth",
        created_at: now,
        updated_at: now,
      }),
    );
    track(spyOn(llmModelRepo, "loadDecisionModelOptions").mockResolvedValue([decision]));
    track(spyOn(llmProviderRepo, "loadSavedProviderConfig").mockResolvedValue(saved));
    const member = track(
      spyOn(managedProvider, "resolveSupporterCapabilityCredentials").mockResolvedValue({
        apiKey: "fixture-member",
        funding,
      }),
    );
    track(spyOn(crypto, "decryptApiKey").mockResolvedValue("fixture-byok"));
    const seen: Array<{ key: string | null; context: unknown }> = [];
    track(
      spyOn(capabilities, "resolveDecisionsCapability").mockResolvedValue(
        Object.assign(new OpenrouterProvider(), {
          callDecisions: async (request: ProviderDecisionRequest) => {
            seen.push({ key: request.apiKey, context: currentProviderUsageContext() });
            return {
              status: "completed",
              answers: [],
              correlationId: request.correlationId,
              actualModel: request.model,
            };
          },
        }),
      ),
    );
    const config = { llm_id: null, checker_llm_id: null, checker_decision_model_id: null };
    for (const funded of [false, true]) {
      state.config.subscription_capabilities = funded ? ["decision"] : [];
      const { backend } = await resolveMatcherBackend(state, config);
      expect(backend?.kind).toBe("decision");
      if (backend?.kind !== "decision") throw new Error("Expected the selected Decision model");
      await callDecisionsForProvider({
        scope: { kind: "server", ownerId: 7 },
        reference: backend.reference,
        credentials: backend.credentials,
        evidence: "fixture",
        questions: [{ type: "predicate", id: "q", instructions: "fixture" }],
      });
    }
    expect(seen).toEqual([
      { key: "fixture-byok", context: undefined },
      { key: "fixture-member", context: getSupporterUsageContext(funding) },
    ]);
    member.mockRejectedValue(new SupporterRequestDeniedError("model_not_allowed"));
    expect(
      await callDecisionsForProvider({
        scope: { kind: "server", ownerId: 7 },
        reference: decision.reference,
        supporterFunding: funding,
        evidence: "fixture",
        questions: [{ type: "predicate", id: "q", instructions: "fixture" }],
      }),
    ).toMatchObject({ status: "denied" });
    expect(seen).toHaveLength(2);
    state.config.subscription_capabilities = ["nudge_checker"];
    expect(await resolveMatcherBackend(state, { ...config, checker_decision_model_id: 31 })).toMatchObject({
      backend: null,
      denied: true,
      source: "pinned",
    });
  });
});
