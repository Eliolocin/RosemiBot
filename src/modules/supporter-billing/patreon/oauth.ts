import { requestOAuthToken, OAuthTokenError } from "@/utils/oauth/tokenEndpoint";
import { patreonTokenTransport } from "@/modules/supporter-billing/patreon/tokenTransport";
import type { SupporterBillingConfig } from "@/modules/supporter-billing/config";
import { oauthStateRepository } from "@/utils/db/repositories/OAuthStateRepository";
import { createAndPersistOAuthState, type OAuthStateNonceRepository } from "@/utils/oauth/state";
import {
  buildPatreonOAuthCallbackUrl,
  getPatreonHttpTimeoutMs,
  getPatreonOAuthCredentials,
  getPatreonOAuthStateTtlSeconds,
  PATREON_IDENTITY_URL,
  PATREON_OAUTH_AUTHORIZE_URL,
  PATREON_OAUTH_SCOPES,
  PATREON_OAUTH_TOKEN_URL,
  PATREON_USER_AGENT,
} from "@/modules/supporter-billing/patreon/settings";

type EnvRecord = Readonly<Record<string, string | undefined>>;
type FetchLike = typeof fetch;

export interface CreatePatreonOAuthUrlOptions {
  config: SupporterBillingConfig;
  env?: EnvRecord;
  stateRepository?: OAuthStateNonceRepository;
  locale?: string;
  now?: Date;
}

export interface PatreonTokenExchangeOptions {
  config: SupporterBillingConfig;
  env?: EnvRecord;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export interface PatreonIdentityFetchOptions {
  env?: EnvRecord;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export interface PatreonTokenResponse {
  accessToken: string;
  tokenType: string | null;
  expiresIn: number | null;
  scope: string | null;
}

export class PatreonApiError extends Error {
  public constructor(
    message: string,
    public readonly statusCode: number | null = null,
  ) {
    super(message);
    this.name = "PatreonApiError";
  }
}

export function buildPatreonOAuthAuthorizationUrl(params: {
  clientId: string;
  state: string;
  env?: EnvRecord;
}): string {
  const authorizationUrl = new URL(PATREON_OAUTH_AUTHORIZE_URL);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", params.clientId);
  authorizationUrl.searchParams.set("redirect_uri", buildPatreonOAuthCallbackUrl(params.env));
  authorizationUrl.searchParams.set("scope", PATREON_OAUTH_SCOPES.join(" "));
  authorizationUrl.searchParams.set("state", params.state);

  return authorizationUrl.toString();
}

export async function createPatreonOAuthUrlForDiscordUser(
  discordUserId: string,
  options: CreatePatreonOAuthUrlOptions,
): Promise<string> {
  const env = options.env ?? process.env;
  const credentials = getPatreonOAuthCredentials(options.config, env);
  const createdState = await createAndPersistOAuthState({
    flow: "patreon",
    subject: discordUserId,
    signerSecret: credentials.clientSecret,
    ttlSeconds: getPatreonOAuthStateTtlSeconds(env),
    locale: options.locale,
    now: options.now,
    stateRepository: options.stateRepository ?? oauthStateRepository,
  });

  return buildPatreonOAuthAuthorizationUrl({
    clientId: credentials.clientId,
    state: createdState.state,
    env,
  });
}

export async function exchangePatreonOAuthCodeForToken(
  code: string,
  options: PatreonTokenExchangeOptions,
): Promise<PatreonTokenResponse> {
  const env = options.env ?? process.env;
  const credentials = getPatreonOAuthCredentials(options.config, env);
  const requestBody = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: buildPatreonOAuthCallbackUrl(env),
  });
  try {
    const token = await requestOAuthToken({
      endpoint: PATREON_OAUTH_TOKEN_URL,
      allowedOrigins: [new URL(PATREON_OAUTH_TOKEN_URL).origin],
      authentication: { method: "body", ...credentials },
      parameters: requestBody,
      timeoutMs: options.timeoutMs ?? getPatreonHttpTimeoutMs(env),
      fetchImpl: patreonTokenTransport(options.fetchImpl),
      userAgent: PATREON_USER_AGENT,
    });
    return {
      accessToken: token.access_token,
      tokenType: token.token_type,
      expiresIn: token.expires_in,
      scope: token.scope ?? null,
    };
  } catch (error) {
    throw new PatreonApiError("Patreon token exchange failed", error instanceof OAuthTokenError ? error.status : null);
  }
}

export async function fetchPatreonIdentity(
  accessToken: string,
  options: PatreonIdentityFetchOptions = {},
): Promise<unknown> {
  const identityUrl = new URL(PATREON_IDENTITY_URL);
  identityUrl.searchParams.set("include", "memberships,memberships.campaign,memberships.currently_entitled_tiers");
  identityUrl.searchParams.set(
    "fields[member]",
    "patron_status,last_charge_date,last_charge_status,next_charge_date,pledge_relationship_start,will_pay_amount_cents",
  );
  identityUrl.searchParams.set("fields[tier]", "title");
  identityUrl.searchParams.set("fields[campaign]", "creation_name");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? getPatreonHttpTimeoutMs(options.env);
  const response = await fetchImpl(identityUrl.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": PATREON_USER_AGENT,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new PatreonApiError("Patreon identity fetch failed", response.status);
  }

  return await response.json();
}
