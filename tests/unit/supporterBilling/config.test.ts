import { describe, expect, it } from "bun:test";
import {
  initializeSupporterBilling,
  isSupporterBillingEnabled,
  SupporterBillingConfigError,
  parseSupporterBillingConfigJson,
  type SupporterBillingConfig,
} from "@/modules/supporter-billing";

const validSupporterConfig: SupporterBillingConfig = {
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

describe("supporter billing config and feature gate", () => {
  it("accepts independent voice defaults and rejects ambiguous or empty voice configuration", () => {
    const configure = (voice: unknown) =>
      JSON.stringify({
        ...validSupporterConfig,
        tiers: {
          test_tier: {
            ...validSupporterConfig.tiers.test_tier,
            defaultModelByCapability: { text: "test/model", voice },
          },
        },
      });
    for (const voice of [
      { clone: "fish-audio/s2.1-pro" },
      { design: "bytedance-seed/seed-audio-1-0" },
      { clone: "fish-audio/s2.1-pro", design: "bytedance-seed/seed-audio-1-0" },
    ])
      expect(parseSupporterBillingConfigJson(configure(voice)).tiers.test_tier.defaultModelByCapability.voice).toEqual(
        voice,
      );
    for (const voice of ["fish-audio/s2.1-pro", {}, { clone: " " }, { typo: "test/model" }])
      expect(() => parseSupporterBillingConfigJson(configure(voice))).toThrow(SupporterBillingConfigError);
  });
  it("accepts a literal tier label and requires a single bounded display-name source", () => {
    const { displayNameKey: _key, ...tier } = validSupporterConfig.tiers.test_tier;
    const configured = (label: Record<string, unknown>) => ({
      ...validSupporterConfig,
      tiers: { test_tier: { ...tier, ...label } },
    });
    const displayName = "Workshop ($3/month)";
    expect(
      parseSupporterBillingConfigJson(JSON.stringify(configured({ displayName }))).tiers.test_tier.displayName,
    ).toBe(displayName);
    for (const label of [
      {},
      { displayName: " " },
      { displayName: "x".repeat(101) },
      { displayName, displayNameKey: _key },
    ])
      expect(() => parseSupporterBillingConfigJson(JSON.stringify(configured(label)))).toThrow(
        SupporterBillingConfigError,
      );
  });

  it("rejects retired accounting settings and accepts capability defaults without price limits", () => {
    expect(parseSupporterBillingConfigJson(JSON.stringify(validSupporterConfig))).toEqual(validSupporterConfig);
    const tier = {
      ...validSupporterConfig.tiers.test_tier,
      defaultModelByCapability: { text: "test/model", image: "test/image" },
    };
    expect(
      parseSupporterBillingConfigJson(JSON.stringify({ ...validSupporterConfig, tiers: { test_tier: tier } })).tiers
        .test_tier.defaultModelByCapability.image,
    ).toBe("test/image");
    for (const config of [
      { ...validSupporterConfig, jobs: { ...validSupporterConfig.jobs, reservationTtlSeconds: 60 } },
      {
        ...validSupporterConfig,
        tiers: { test_tier: { ...tier, reservationMicrosByCapability: { text: { default: 1000, max: 5000 } } } },
      },
      { ...validSupporterConfig, tiers: { test_tier: { ...tier, defaultModelByCapability: {} } } },
    ])
      expect(() => parseSupporterBillingConfigJson(JSON.stringify(config))).toThrow(SupporterBillingConfigError);
  });

  it("requires both production runtime and the explicit true flag", () => {
    expect(isSupporterBillingEnabled("development", createEnabledEnv())).toBe(false);
    expect(
      isSupporterBillingEnabled("production", createEnabledEnv({ TOMORI_SUPPORTER_BILLING_ENABLED: "false" })),
    ).toBe(false);
    expect(isSupporterBillingEnabled("production", createEnabledEnv())).toBe(true);
  });

  it("ignores invalid billing config and starts no route hook when billing is disabled", async () => {
    let schemaHookCalled = false;
    let routeHookCalled = false;
    let reconcileHookCalled = false;

    const result = await initializeSupporterBilling({
      environment: "production",
      env: {
        TOMORI_SUPPORTER_BILLING_ENABLED: "false",
        TOMORI_SUPPORTER_CONFIG_JSON: "{not-json",
      },
      initializeBillingSchema: async () => {
        schemaHookCalled = true;
        return { initializedTables: [] };
      },
      initializePatreonRoutes: () => {
        routeHookCalled = true;
      },
      startPatreonReconcileJob: () => {
        reconcileHookCalled = true;
        return { stop: () => undefined };
      },
    });

    expect(result.enabled).toBe(false);
    expect(schemaHookCalled).toBe(false);
    expect(routeHookCalled).toBe(false);
    expect(reconcileHookCalled).toBe(false);
  });

  it("keeps billing disabled in development even when the billing flag is true", async () => {
    let schemaHookCalled = false;
    let routeHookCalled = false;
    let reconcileHookCalled = false;

    const result = await initializeSupporterBilling({
      environment: "development",
      env: {
        TOMORI_PUBLIC_BASE_URL: "https://bot.example.test",
        TOMORI_SUPPORTER_BILLING_ENABLED: "true",
        TOMORI_SUPPORTER_CONFIG_JSON: "{not-json",
      },
      initializeBillingSchema: async () => {
        schemaHookCalled = true;
        return { initializedTables: [] };
      },
      initializePatreonRoutes: () => {
        routeHookCalled = true;
      },
      startPatreonReconcileJob: () => {
        reconcileHookCalled = true;
        return { stop: () => undefined };
      },
    });

    expect(result.enabled).toBe(false);
    expect(schemaHookCalled).toBe(false);
    expect(routeHookCalled).toBe(false);
    expect(reconcileHookCalled).toBe(false);
  });

  it("rejects invalid config only when production billing is enabled", async () => {
    let schemaHookCalled = false;

    await expect(
      initializeSupporterBilling({
        environment: "production",
        env: {
          TOMORI_PUBLIC_BASE_URL: "https://bot.example.test",
          TOMORI_SUPPORTER_BILLING_ENABLED: "true",
          TOMORI_SUPPORTER_CONFIG_JSON: "{not-json",
        },
        initializeBillingSchema: async () => {
          schemaHookCalled = true;
          return { initializedTables: [] };
        },
      }),
    ).rejects.toThrow(SupporterBillingConfigError);

    expect(schemaHookCalled).toBe(false);
  });

  it("validates referenced secret names when billing is enabled", async () => {
    let schemaHookCalled = false;

    for (const secret of ["TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY"])
      await expect(
        initializeSupporterBilling({
          environment: "production",
          env: createEnabledEnv({
            [secret]: "",
          }),
          initializeBillingSchema: async () => {
            schemaHookCalled = true;
            return { initializedTables: [] };
          },
        }),
      ).rejects.toThrow("unset secret environment variables");

    expect(schemaHookCalled).toBe(false);
  });

  it("runs gated schema and Patreon hooks after enabled config validation", async () => {
    const callOrder: string[] = [];
    let routeHookCalled = false;
    let reconcileHookCalled = false;

    const result = await initializeSupporterBilling({
      environment: "production",
      env: createEnabledEnv(),
      initializeBillingSchema: async () => {
        callOrder.push("schema");
        return { initializedTables: [] };
      },
      initializePatreonRoutes: () => {
        callOrder.push("routes");
        routeHookCalled = true;
      },
      startPatreonReconcileJob: () => {
        callOrder.push("reconcile");
        reconcileHookCalled = true;
        return { stop: () => undefined };
      },
    });

    expect(result.enabled).toBe(true);
    expect(callOrder).toEqual(["schema", "routes", "reconcile"]);
    expect(routeHookCalled).toBe(true);
    expect(reconcileHookCalled).toBe(true);
  });
});
