import type { SupporterBillingConfig } from "@/modules/supporter-billing/config";
import { parseOAuthAuthorizationResponse, OAuthAuthorizationError } from "@/utils/oauth/authorizationResponse";
import { oauthStateRepository } from "@/utils/db/repositories/OAuthStateRepository";
import {
  mapPatreonIdentityToEligibleSupporter,
  type PatreonMembershipRejectionReason,
} from "@/modules/supporter-billing/patreon/mapping";
import {
  exchangePatreonOAuthCodeForToken,
  fetchPatreonIdentity,
  PatreonApiError,
  type PatreonTokenResponse,
} from "@/modules/supporter-billing/patreon/oauth";
import {
  type PersistEligiblePatreonSupporterOptions,
  type PersistEligiblePatreonSupporterResult,
  persistEligiblePatreonSupporter,
} from "@/modules/supporter-billing/patreon/persistence";
import {
  getPatreonOAuthCredentials,
  getPatreonUsagePeriodFallbackHours,
} from "@/modules/supporter-billing/patreon/settings";
import { validateAndConsumeOAuthState, type OAuthStateNonceRepository } from "@/utils/oauth/state";
import { localizer } from "@/utils/text/localizer";

type EnvRecord = Readonly<Record<string, string | undefined>>;

export type PatreonOAuthCallbackStatus =
  | "success"
  | "authorization_denied"
  | "missing_code"
  | "invalid_state"
  | "expired_state"
  | "state_replay"
  | PatreonMembershipRejectionReason
  | "patreon_unavailable"
  | "server_error";

const CALLBACK_KEYS = {
  success: ["commands.subscribe.callback.success.title", "commands.subscribe.callback.success.message"],
  authorization_denied: [
    "commands.subscribe.callback.authorization_denied.title",
    "commands.subscribe.callback.authorization_denied.message",
  ],
  missing_code: ["commands.subscribe.callback.missing_code.title", "commands.subscribe.callback.missing_code.message"],
  invalid_state: [
    "commands.subscribe.callback.invalid_state.title",
    "commands.subscribe.callback.invalid_state.message",
  ],
  expired_state: [
    "commands.subscribe.callback.expired_state.title",
    "commands.subscribe.callback.expired_state.message",
  ],
  state_replay: ["commands.subscribe.callback.state_replay.title", "commands.subscribe.callback.state_replay.message"],
  invalid_payload: [
    "commands.subscribe.callback.invalid_payload.title",
    "commands.subscribe.callback.invalid_payload.message",
  ],
  unlinked_membership: [
    "commands.subscribe.callback.unlinked_membership.title",
    "commands.subscribe.callback.unlinked_membership.message",
  ],
  wrong_campaign: [
    "commands.subscribe.callback.wrong_campaign.title",
    "commands.subscribe.callback.wrong_campaign.message",
  ],
  inactive: ["commands.subscribe.callback.inactive.title", "commands.subscribe.callback.inactive.message"],
  unconfigured_tier: [
    "commands.subscribe.callback.unconfigured_tier.title",
    "commands.subscribe.callback.unconfigured_tier.message",
  ],
  patreon_unavailable: [
    "commands.subscribe.callback.patreon_unavailable.title",
    "commands.subscribe.callback.patreon_unavailable.message",
  ],
  server_error: ["commands.subscribe.callback.server_error.title", "commands.subscribe.callback.server_error.message"],
} satisfies Record<PatreonOAuthCallbackStatus, [string, string]>;

export interface PatreonOAuthCallbackResponse {
  status: PatreonOAuthCallbackStatus;
  statusCode: number;
  contentType: "text/html; charset=utf-8";
  body: string;
}

export interface HandlePatreonOAuthCallbackOptions {
  config: SupporterBillingConfig;
  env?: EnvRecord;
  stateRepository?: OAuthStateNonceRepository;
  now?: Date;
  fallbackHours?: number;
  exchangeCodeForToken?: (code: string) => Promise<PatreonTokenResponse>;
  fetchIdentity?: (accessToken: string) => Promise<unknown>;
  persistSupporter?: (
    options: PersistEligiblePatreonSupporterOptions,
  ) => Promise<PersistEligiblePatreonSupporterResult>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderCallbackHtml(status: PatreonOAuthCallbackStatus, locale: string): string {
  const [titleKey, messageKey] = CALLBACK_KEYS[status];
  const title = escapeHtml(localizer(locale, titleKey));
  const message = escapeHtml(localizer(locale, messageKey));
  const htmlLang = escapeHtml(locale.replaceAll("_", "-"));

  return `<!doctype html>
<html lang="${htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${message}</p>
  </main>
</body>
</html>`;
}

function makeCallbackResponse(
  status: PatreonOAuthCallbackStatus,
  statusCode: number,
  locale = "en-US",
): PatreonOAuthCallbackResponse {
  return {
    status,
    statusCode,
    contentType: "text/html; charset=utf-8",
    body: renderCallbackHtml(status, locale),
  };
}

function mapStateFailureReason(reason: string): PatreonOAuthCallbackStatus {
  if (reason === "expired") {
    return "expired_state";
  }

  if (reason === "replay") {
    return "state_replay";
  }

  return "invalid_state";
}

export async function handlePatreonOAuthCallbackUrl(
  callbackUrl: URL,
  options: HandlePatreonOAuthCallbackOptions,
): Promise<PatreonOAuthCallbackResponse> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const state = callbackUrl.searchParams.get("state")?.trim();
  if (!state || callbackUrl.searchParams.getAll("state").length !== 1) {
    return makeCallbackResponse("invalid_state", 400);
  }

  const credentials = getPatreonOAuthCredentials(options.config, env);
  const stateResult = await validateAndConsumeOAuthState(
    state,
    credentials.clientSecret,
    options.stateRepository ?? oauthStateRepository,
    now,
    "patreon",
  );

  if (!stateResult.valid) {
    return makeCallbackResponse(mapStateFailureReason(stateResult.reason), 400);
  }
  const locale = stateResult.payload.locale ?? "en-US";

  let code: string;
  try {
    code = parseOAuthAuthorizationResponse(callbackUrl.searchParams, {
      state,
      issuer: "https://www.patreon.com",
      requireIssuer: false,
    });
  } catch (error) {
    const status =
      error instanceof OAuthAuthorizationError && error.reason === "denied"
        ? "authorization_denied"
        : error instanceof OAuthAuthorizationError && error.reason === "code"
          ? "missing_code"
          : "invalid_state";
    return makeCallbackResponse(status, 400, locale);
  }

  try {
    const tokenResponse = await (
      options.exchangeCodeForToken ??
      ((oauthCode) => exchangePatreonOAuthCodeForToken(oauthCode, { config: options.config, env }))
    )(code);
    const identityResponse = await (
      options.fetchIdentity ?? ((accessToken) => fetchPatreonIdentity(accessToken, { env }))
    )(tokenResponse.accessToken);
    const membershipMapping = mapPatreonIdentityToEligibleSupporter({
      discordUserId: stateResult.payload.subject,
      config: options.config,
      identityResponse,
      now,
      fallbackHours: options.fallbackHours ?? getPatreonUsagePeriodFallbackHours(env),
    });

    if (!membershipMapping.eligible) {
      return makeCallbackResponse(membershipMapping.reason, 403, locale);
    }

    await (options.persistSupporter ?? persistEligiblePatreonSupporter)({
      config: options.config,
      snapshot: membershipMapping.snapshot,
      verifiedAt: now,
      env,
    });

    return makeCallbackResponse("success", 200, locale);
  } catch (error) {
    if (error instanceof PatreonApiError) {
      return makeCallbackResponse("patreon_unavailable", 502, locale);
    }

    return makeCallbackResponse("server_error", 500, locale);
  }
}
