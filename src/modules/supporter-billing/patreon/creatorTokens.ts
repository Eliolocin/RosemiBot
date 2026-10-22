import type { OAuthFetch } from "@/utils/oauth/oauthFetch";
import type { SQL } from "bun";
import type { SupporterBillingConfig } from "@/modules/supporter-billing/config";
import { createPatreonCreatorTokenStore, expirePatreonCreatorAccessToken } from "@/modules/supporter-billing/db";
import {
  getPatreonHttpTimeoutMs,
  PATREON_OAUTH_TOKEN_URL,
  PATREON_USER_AGENT,
} from "@/modules/supporter-billing/patreon/settings";
import { log } from "@/utils/misc/logger";
import { OAuthRefreshCoordinator } from "@/utils/oauth/refreshCoordinator";
import { patreonTokenTransport } from "@/modules/supporter-billing/patreon/tokenTransport";

const coordinator = new OAuthRefreshCoordinator();

function tokenKey(config: SupporterBillingConfig, env: Readonly<Record<string, string | undefined>>): string {
  return `${config.patreon.campaignId}:${env[config.patreon.oauthClientIdEnv]}`;
}

export async function getPatreonCreatorAccessToken(options: {
  config: SupporterBillingConfig;
  env?: Readonly<Record<string, string | undefined>>;
  client?: SQL;
  fetchImpl?: OAuthFetch;
}): Promise<string> {
  const env = options.env ?? process.env;
  const token = await coordinator.getAccessToken({
    key: tokenKey(options.config, env),
    store: createPatreonCreatorTokenStore(options),
    endpoint: PATREON_OAUTH_TOKEN_URL,
    allowedOrigins: [new URL(PATREON_OAUTH_TOKEN_URL).origin],
    timeoutMs: getPatreonHttpTimeoutMs(env),
    userAgent: PATREON_USER_AGENT,
    fetchImpl: patreonTokenTransport(options.fetchImpl),
    onFailure: (reason, disposition, diagnostics) =>
      log.warn("Patreon creator OAuth refresh failed", undefined, {
        metadata: { errorClass: reason, disposition, ...diagnostics },
      }),
  });
  if (!token)
    throw new Error("Patreon creator authorization is unavailable; inspect refresh status or authorize again.");
  return token;
}

export async function rejectPatreonCreatorAccessToken(
  config: SupporterBillingConfig,
  rejectedToken: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  try {
    await expirePatreonCreatorAccessToken(config.patreon.campaignId, rejectedToken);
  } catch {
    throw new Error("Patreon creator access rejection could not be stored.");
  }
  coordinator.invalidate(tokenKey(config, env), rejectedToken);
}

export function clearPatreonCreatorTokenStateForTests(): void {
  coordinator.clear();
}
