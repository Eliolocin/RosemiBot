import type { SQL } from "bun";
import type { AppEnvironment } from "@/types/config";
import { isDatabaseSchemaManagementEnabled } from "@/init/database";
import { sql as defaultSql } from "@/utils/db/client";
import {
  isSupporterBillingEnabled,
  parseSupporterBillingConfigJson,
  type SupporterBillingConfig,
} from "@/modules/supporter-billing/config";
import {
  initializeSupporterBillingSchema,
  validateSupporterBillingSchema,
  type SupporterBillingSchemaInitializationResult,
} from "@/modules/supporter-billing/db";
import {
  startPatreonReconcileJob,
  type PatreonReconcileJobHandle,
} from "@/modules/supporter-billing/patreon/reconcile";
import { initializePatreonRoutes, type PatreonRouteInitializer } from "@/modules/supporter-billing/patreon/routes";

type EnvRecord = Readonly<Record<string, string | undefined>>;

export type SupporterBillingSchemaInitializer = (client: SQL) => Promise<SupporterBillingSchemaInitializationResult>;
export type SupporterBillingReconcileJobStarter = (context: {
  config: SupporterBillingConfig;
  env?: EnvRecord;
}) => PatreonReconcileJobHandle;

export interface InitializeSupporterBillingOptions {
  environment: AppEnvironment;
  env?: EnvRecord;
  billingClient?: SQL;
  initializeBillingSchema?: SupporterBillingSchemaInitializer;
  initializePatreonRoutes?: PatreonRouteInitializer;
  startPatreonReconcileJob?: SupporterBillingReconcileJobStarter;
}

export type SupporterBillingInitializationResult =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      config: SupporterBillingConfig;
      schema: SupporterBillingSchemaInitializationResult;
      reconcileJob: PatreonReconcileJobHandle;
    };

export async function initializeSupporterBilling(
  options: InitializeSupporterBillingOptions,
): Promise<SupporterBillingInitializationResult> {
  const env = options.env ?? process.env;

  if (!isSupporterBillingEnabled(options.environment, env)) {
    return { enabled: false };
  }

  const billingConfig = parseSupporterBillingConfigJson(env.TOMORI_SUPPORTER_CONFIG_JSON, {
    env,
    validateReferencedSecrets: true,
  });
  const billingClient = options.billingClient ?? defaultSql;
  const initializeBillingSchema =
    options.initializeBillingSchema ??
    (isDatabaseSchemaManagementEnabled(env.DATABASE_SCHEMA_MANAGEMENT_ENABLED)
      ? initializeSupporterBillingSchema
      : validateSupporterBillingSchema);
  const initializePatreonRouteHook = options.initializePatreonRoutes ?? initializePatreonRoutes;
  const startPatreonReconcileJobHook = options.startPatreonReconcileJob ?? startPatreonReconcileJob;

  const schema = await initializeBillingSchema(billingClient);
  await initializePatreonRouteHook({ config: billingConfig, env });
  const reconcileJob = startPatreonReconcileJobHook({ config: billingConfig, env });

  return {
    enabled: true,
    config: billingConfig,
    schema,
    reconcileJob,
  };
}

export * from "@/modules/supporter-billing/config";
export * from "@/modules/supporter-billing/db";
export * from "@/modules/supporter-billing/runtime";
export { registerSupporterProviderExtensions } from "@/modules/supporter-billing/registration";
