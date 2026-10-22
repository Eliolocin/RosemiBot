/**
 * Environment-variable keys that carry Supporter Billing secrets/config from the secret store into
 * `process.env`.
 *
 * Kept as a standalone leaf constant with NO zod/parser imports so early-startup code (e.g.
 * `init/secrets.ts`) can propagate these without pulling the billing config parser into the default
 * bundle. This is the module-owned source of truth for the Supporter env surface: keep it in sync
 * with `TomoriSecrets` (secret loader) and `.env.optional.example`.
 */
export const SUPPORTER_SECRET_ENV_KEYS = [
  "TOMORI_SUPPORTER_BILLING_ENABLED",
  "TOMORI_SUPPORTER_CONFIG_JSON",
  "TOMORI_SUPPORTER_OPENROUTER_MANAGEMENT_KEY",
  "TOMORI_SUPPORTER_PATREON_CLIENT_ID",
  "TOMORI_SUPPORTER_PATREON_CLIENT_SECRET",
  "TOMORI_SUPPORTER_PATREON_WEBHOOK_SECRET",
  "TOMORI_SUPPORTER_PATREON_CREATOR_REFRESH_TOKEN",
  "TOMORI_SUPPORTER_OAUTH_STATE_TTL_SECONDS",
  "TOMORI_SUPPORTER_PATREON_HTTP_TIMEOUT_MS",
  "TOMORI_SUPPORTER_PERIOD_FALLBACK_HOURS",
  "TOMORI_SUPPORTER_PATREON_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS",
  "TOMORI_SUPPORTER_PATREON_WEBHOOK_MAX_BYTES",
  "TOMORI_SUPPORTER_RECONCILE_MAX_PAGES",
  "TOMORI_SUPPORTER_SUBSCRIBE_COMPONENT_TIMEOUT_MS",
  "TOMORI_SUPPORTER_REVOKE_SELECT_TIMEOUT_MS",
  "TOMORI_SUPPORTER_REVOKE_CONFIRM_TIMEOUT_MS",
] as const;

export type SupporterSecretEnvKey = (typeof SUPPORTER_SECRET_ENV_KEYS)[number];
