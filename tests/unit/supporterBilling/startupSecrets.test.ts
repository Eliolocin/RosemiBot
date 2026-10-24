import { afterAll, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SQL } from "bun";
import { initializeSupporterBilling, type InitializeSupporterBillingOptions } from "@/modules/supporter-billing";
import { SupporterBillingConfigError } from "@/modules/supporter-billing/config";
import type { SupporterBillingSchemaInitializationResult } from "@/modules/supporter-billing/db";
import type { PatreonReconcileJobHandle } from "@/modules/supporter-billing/patreon/reconcile";

const CONFIG = {
  patreon: {
    campaignId: "fixture-campaign",
    oauthClientIdEnv: "TOMORI_SUPPORTER_PATREON_CLIENT_ID",
    oauthClientSecretEnv: "TOMORI_SUPPORTER_PATREON_CLIENT_SECRET",
    webhookSecretEnv: "TOMORI_SUPPORTER_PATREON_WEBHOOK_SECRET",
    creatorRefreshTokenEnv: "TOMORI_SUPPORTER_PATREON_CREATOR_REFRESH_TOKEN",
    manageUrl: "https://fixtures.example/manage",
  },
  jobs: { reconcileIntervalSeconds: 900, manualRefreshCooldownSeconds: 60 },
  tiers: {
    fixture_tier: {
      displayNameKey: "commands.subscribe.tiers.fixture",
      patreonTierIds: ["fixture-patreon-tier"],
      monthlyBudgetMicros: 1_000_000,
      defaultModelByCapability: { text: "fixture/text-model" },
    },
  },
};

const VALID_ENV: Record<string, string> = {
  TOMORI_SUPPORTER_BILLING_ENABLED: "true",
  TOMORI_SUPPORTER_CONFIG_JSON: JSON.stringify(CONFIG),
  TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY: "fixture-management-key",
  TOMORI_SUPPORTER_PATREON_CLIENT_ID: "fixture-client-id",
  TOMORI_SUPPORTER_PATREON_CLIENT_SECRET: "fixture-client-secret",
  TOMORI_SUPPORTER_PATREON_WEBHOOK_SECRET: "fixture-webhook-secret",
};

interface StartupHooks {
  options: Pick<
    InitializeSupporterBillingOptions,
    "billingClient" | "initializeBillingSchema" | "initializePatreonRoutes" | "startPatreonReconcileJob"
  >;
  schema: ReturnType<typeof mock<() => Promise<SupporterBillingSchemaInitializationResult>>>;
  routes: ReturnType<typeof mock<() => Promise<void>>>;
  jobs: ReturnType<typeof mock<() => PatreonReconcileJobHandle>>;
}

function createStartupHooks(): StartupHooks {
  const schema = mock(async (): Promise<SupporterBillingSchemaInitializationResult> => ({ initializedTables: [] }));
  const routes = mock(async () => undefined);
  const jobs = mock((): PatreonReconcileJobHandle => ({ stop: () => undefined }));
  return {
    options: {
      billingClient: {} as SQL,
      initializeBillingSchema: () => schema(),
      initializePatreonRoutes: () => routes(),
      startPatreonReconcileJob: () => jobs(),
    },
    schema,
    routes,
    jobs,
  };
}

async function initializeWith(env: Record<string, string>) {
  return initializeSupporterBilling({ environment: "production", env, ...createStartupHooks().options });
}

function without(env: Record<string, string>, name: string): Record<string, string> {
  const { [name]: _removed, ...rest } = env;
  return rest;
}

const temporaryDirectories: string[] = [];

afterAll(async () => {
  for (const directory of temporaryDirectories) await rm(directory, { recursive: true, force: true });
});

interface ScenarioResult {
  requestRegistered?: boolean;
  optionCount?: number;
  billingEnabled?: string | null;
  configPresent?: boolean;
  publicBaseUrl?: string | null;
}

async function runSecretScenario(script: string, overrides: Record<string, string>): Promise<ScenarioResult> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of ["SECRET_FILE", "GCP_SECRET_FILE", "TEST_PRODUCTION"]) delete env[name];
  Object.assign(env, overrides);
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], {
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Secret scenario failed (exit ${exitCode}): ${stderr}`);
  const line = stdout.split("\n").find((candidate) => candidate.includes('"marker":"billing-secrets"'));
  if (!line) throw new Error(`Secret scenario produced no result line: ${stdout}`);
  return JSON.parse(line) as ScenarioResult;
}

const BASE_SECRETS = {
  DISCORD_TOKEN: "fixture-discord-token",
  POSTGRES_HOST: "localhost",
  POSTGRES_PORT: "5432",
  POSTGRES_USER: "postgres",
  POSTGRES_PASSWORD: "fixture-password",
  POSTGRES_DB: "fixture-database",
  CRYPTO_SECRET: "fixture-crypto-secret",
};

const BILLING_SECRETS = {
  ...VALID_ENV,
  TOMORI_PUBLIC_BASE_URL: "https://fixtures.example",
};

const LOAD_SCRIPT = `import { loadSecrets } from "./src/init/secrets";
await loadSecrets("production");
console.log(JSON.stringify({
  marker: "billing-secrets",
  billingEnabled: process.env.TOMORI_SUPPORTER_BILLING_ENABLED ?? null,
  configPresent: Boolean(process.env.TOMORI_SUPPORTER_CONFIG_JSON),
  publicBaseUrl: process.env.TOMORI_PUBLIC_BASE_URL ?? null,
}));`;

describe("supporter billing secret registration", () => {
  it("loads every registered billing name from a mounted secret file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "tomoribot-billing-secrets-"));
    temporaryDirectories.push(directory);
    const secretFile = path.join(directory, "secrets.json");
    await writeFile(secretFile, JSON.stringify({ ...BASE_SECRETS, ...BILLING_SECRETS }));

    const result = await runSecretScenario(LOAD_SCRIPT, {
      RUN_ENV: "production",
      SECRET_FILE: secretFile,
    });

    expect(result.billingEnabled).toBe("true");
    expect(result.configPresent).toBe(true);
    expect(result.publicBaseUrl).toBe("https://fixtures.example");
  });

  it("loads every registered billing name from AWS Secrets Manager", async () => {
    const secretString = JSON.stringify({ ...BASE_SECRETS, ...BILLING_SECRETS });
    const result = await runSecretScenario(
      `import { mock } from "bun:test";
       mock.module("@aws-sdk/client-secrets-manager", () => ({
         SecretsManagerClient: class {
           async send() {
             return { SecretString: ${JSON.stringify(secretString)} };
           }
         },
         GetSecretValueCommand: class {},
       }));
       const { loadSecrets } = await import("./src/init/secrets");
       await loadSecrets("production");
       console.log(JSON.stringify({
         marker: "billing-secrets",
         billingEnabled: process.env.TOMORI_SUPPORTER_BILLING_ENABLED ?? null,
         configPresent: Boolean(process.env.TOMORI_SUPPORTER_CONFIG_JSON),
         publicBaseUrl: process.env.TOMORI_PUBLIC_BASE_URL ?? null,
       }));`,
      { RUN_ENV: "production" },
    );

    expect(result.billingEnabled).toBe("true");
    expect(result.configPresent).toBe(true);
    expect(result.publicBaseUrl).toBe("https://fixtures.example");
  });
});

describe("supporter billing startup requirements", () => {
  it("registers production request and option callbacks through the initializer before its disabled return", async () => {
    const result = await runSecretScenario(
      `
      const { initSupporterBilling } = await import("./src/init/supporterBilling");
      const { hasProviderRequestHook } = await import("./src/utils/provider/providerRequestHook");
      const { getProviderOptions } = await import("./src/utils/provider/providerOptionRegistry");
      await initSupporterBilling("development");
      console.log(JSON.stringify({ marker: "billing-secrets", requestRegistered: hasProviderRequestHook(),
        optionCount: getProviderOptions().filter((option) => option.value === "supporter").length }));
    `,
      { RUN_ENV: "development", TOMORI_SUPPORTER_BILLING_ENABLED: "false" },
    );
    expect(result.requestRegistered).toBe(true);
    expect(result.optionCount).toBe(1);
  });
  it("starts with the required keys alone and leaves optional tuning settings unset", async () => {
    const hooks = createStartupHooks();
    const result = await initializeSupporterBilling({
      environment: "production",
      env: VALID_ENV,
      ...hooks.options,
    });

    expect(result.enabled).toBe(true);
    expect(hooks.schema).toHaveBeenCalledTimes(1);
    expect(hooks.routes).toHaveBeenCalledTimes(1);
    expect(hooks.jobs).toHaveBeenCalledTimes(1);
  });

  it("does not validate or initialize anything while billing is disabled", async () => {
    const hooks = createStartupHooks();
    const result = await initializeSupporterBilling({
      environment: "production",
      env: { TOMORI_SUPPORTER_BILLING_ENABLED: "false" },
      ...hooks.options,
    });

    expect(result).toEqual({ enabled: false });
    expect(hooks.schema).not.toHaveBeenCalled();
    expect(hooks.routes).not.toHaveBeenCalled();
    expect(hooks.jobs).not.toHaveBeenCalled();
  });

  it("refuses to start when the enabled config object is absent", async () => {
    const hooks = createStartupHooks();
    const error = await initializeSupporterBilling({
      environment: "production",
      env: without(VALID_ENV, "TOMORI_SUPPORTER_CONFIG_JSON"),
      ...hooks.options,
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(SupporterBillingConfigError);
    expect((error as SupporterBillingConfigError).issues.join(" ")).toContain("TOMORI_SUPPORTER_CONFIG_JSON");
    expect(hooks.schema).not.toHaveBeenCalled();
  });

  it("names a missing referenced credential without echoing any secret value", async () => {
    const hooks = createStartupHooks();
    const error = await initializeSupporterBilling({
      environment: "production",
      env: without(VALID_ENV, "TOMORI_SUPPORTER_PATREON_CLIENT_SECRET"),
      ...hooks.options,
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(SupporterBillingConfigError);
    const issues = (error as SupporterBillingConfigError).issues.join(" ");
    expect(issues).toContain("TOMORI_SUPPORTER_PATREON_CLIENT_SECRET must be set");
    expect(issues).not.toContain(VALID_ENV.TOMORI_SUPPORTER_PATREON_CLIENT_ID);
    expect(issues).not.toContain(VALID_ENV.TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY);
    expect(hooks.schema).not.toHaveBeenCalled();
  });

  it("requires the management key that reconciliation creates member keys with", async () => {
    const error = await initializeWith(without(VALID_ENV, "TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY")).catch(
      (failure: unknown) => failure,
    );

    expect(error).toBeInstanceOf(SupporterBillingConfigError);
    expect((error as SupporterBillingConfigError).issues.join(" ")).toContain(
      "TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY must be set",
    );
  });
});
