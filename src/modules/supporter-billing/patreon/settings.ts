import { getOAuthPublicBaseUrl, OAUTH_CALLBACK_PATH } from "@/utils/oauth/settings";
import type { SupporterBillingConfig } from "@/modules/supporter-billing/config";

export const PATREON_OAUTH_AUTHORIZE_URL = "https://www.patreon.com/oauth2/authorize";
export const PATREON_OAUTH_TOKEN_URL = "https://www.patreon.com/api/oauth2/token";
export const PATREON_IDENTITY_URL = "https://www.patreon.com/api/oauth2/v2/identity";
export const PATREON_API_BASE_URL = "https://www.patreon.com/api/oauth2/v2";
export const PATREON_OAUTH_CALLBACK_PATH = OAUTH_CALLBACK_PATH;
export const PATREON_WEBHOOK_PATH = "/supporter-billing/patreon/webhook";
export const PATREON_OAUTH_SCOPES = ["identity", "identity.memberships"] as const;
export const PATREON_USER_AGENT = "TomoriBot Supporter Billing";

const DEFAULT_OAUTH_STATE_TTL_SECONDS = 600;
const DEFAULT_PATREON_HTTP_TIMEOUT_MS = 10000;
const DEFAULT_USAGE_PERIOD_FALLBACK_HOURS = 24;
const DEFAULT_WEBHOOK_MAX_BYTES = 1024 * 1024;
const DEFAULT_RECONCILE_MAX_PAGES = 20;
type EnvRecord = Readonly<Record<string, string | undefined>>;

function readPositiveIntegerEnv(env: EnvRecord, name: string, defaultValue: number): number {
  const rawValue = env[name]?.trim();
  if (!rawValue) {
    return defaultValue;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isSafeInteger(parsedValue) && parsedValue > 0 ? parsedValue : defaultValue;
}

export function getPatreonOAuthStateTtlSeconds(env: EnvRecord = process.env): number {
  return readPositiveIntegerEnv(env, "TOMORI_SUPPORTER_OAUTH_STATE_TTL_SECONDS", DEFAULT_OAUTH_STATE_TTL_SECONDS);
}

export function getPatreonHttpTimeoutMs(env: EnvRecord = process.env): number {
  return readPositiveIntegerEnv(env, "TOMORI_SUPPORTER_PATREON_HTTP_TIMEOUT_MS", DEFAULT_PATREON_HTTP_TIMEOUT_MS);
}

export function getPatreonUsagePeriodFallbackHours(env: EnvRecord = process.env): number {
  return readPositiveIntegerEnv(env, "TOMORI_SUPPORTER_PERIOD_FALLBACK_HOURS", DEFAULT_USAGE_PERIOD_FALLBACK_HOURS);
}

export function getPatreonWebhookMaxBytes(env: EnvRecord = process.env): number {
  return readPositiveIntegerEnv(env, "TOMORI_SUPPORTER_PATREON_WEBHOOK_MAX_BYTES", DEFAULT_WEBHOOK_MAX_BYTES);
}

export function getPatreonReconcileMaxPages(env: EnvRecord = process.env): number {
  return readPositiveIntegerEnv(env, "TOMORI_SUPPORTER_RECONCILE_MAX_PAGES", DEFAULT_RECONCILE_MAX_PAGES);
}

export function getPatreonOAuthCredentials(
  config: SupporterBillingConfig,
  env: EnvRecord = process.env,
): { clientId: string; clientSecret: string } {
  const clientId = env[config.patreon.oauthClientIdEnv]?.trim();
  const clientSecret = env[config.patreon.oauthClientSecretEnv]?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("Patreon OAuth client credentials are not available");
  }

  return { clientId, clientSecret };
}

export function getPatreonWebhookSecret(config: SupporterBillingConfig, env: EnvRecord = process.env): string {
  const webhookSecret = env[config.patreon.webhookSecretEnv]?.trim();
  if (!webhookSecret) {
    throw new Error("Patreon webhook secret is not available");
  }

  return webhookSecret;
}

export function buildPatreonOAuthCallbackUrl(env?: EnvRecord): string {
  return new URL(OAUTH_CALLBACK_PATH, getOAuthPublicBaseUrl(env)).toString();
}
