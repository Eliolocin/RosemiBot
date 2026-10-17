import { randomBytes } from "node:crypto";
import type { MessageProxyInstanceContext } from "@/utils/messageProxy/instances";
import { canonicalMessageProxyOrigin } from "@/utils/messageProxy/instances";
import { createOAuthPkce } from "@/utils/oauth/pkce";
import { discoverOAuthMetadata } from "@/utils/oauth/metadata";
import { parseOAuthAuthorizationResponse } from "@/utils/oauth/authorizationResponse";
import { requestOAuthToken, type OAuthToken } from "@/utils/oauth/tokenEndpoint";

export type PluralBuddyBootstrapToken = OAuthToken & { refresh_token: string };

export interface PluralBuddyOAuthSession {
  authorizeUrl: string;
  state: string;
  verifier: string;
  issuer: string;
  tokenEndpoint: string;
}

export function validatePluralBuddyRedirect(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("The registered redirect URI is invalid.");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname === "/"
  ) {
    throw new Error("Register an exact http://127.0.0.1:<port>/<path> redirect URI for this helper.");
  }
  return url;
}

export async function createPluralBuddyOAuthSession(
  instance: MessageProxyInstanceContext,
  clientId: string,
  redirectUri: string,
): Promise<PluralBuddyOAuthSession> {
  const { issuer, authorizationEndpoint, tokenEndpoint } = await validatePluralBuddyDiscovery(instance);

  const state = randomBytes(32).toString("base64url");
  const { verifier, challenge } = createOAuthPkce();
  const url = new URL(authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "profile offline_access",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: instance.origin,
  }).toString();
  return { authorizeUrl: url.toString(), state, verifier, issuer, tokenEndpoint };
}

export async function validatePluralBuddyDiscovery(instance: MessageProxyInstanceContext): Promise<{
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
}> {
  if (instance.serviceId !== "pluralbuddy" || canonicalMessageProxyOrigin(instance.origin) !== instance.origin) {
    throw new Error("The selected PluralBuddy instance is invalid.");
  }
  const issuer = `${instance.origin}/api/auth`;
  const authorizationEndpoint = `${issuer}/oauth2/authorize`;
  const tokenEndpoint = `${issuer}/oauth2/token`;
  return discoverOAuthMetadata({
    discoveryUrl: `${instance.origin}/.well-known/openid-configuration`,
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
  });
}

export function parsePluralBuddyOAuthCallback(
  callbackUrl: URL,
  redirectUri: string,
  session: PluralBuddyOAuthSession,
): string {
  const registered = new URL(redirectUri);
  if (callbackUrl.origin !== registered.origin || callbackUrl.pathname !== registered.pathname) {
    throw new Error("OAuth callback used an unregistered redirect URI.");
  }
  return parseOAuthAuthorizationResponse(callbackUrl.searchParams, {
    state: session.state,
    issuer: session.issuer,
    requireIssuer: true,
  });
}

export async function exchangePluralBuddyOAuthCode(
  instance: MessageProxyInstanceContext,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  session: PluralBuddyOAuthSession,
  code: string,
): Promise<PluralBuddyBootstrapToken> {
  if (
    instance.serviceId !== "pluralbuddy" ||
    canonicalMessageProxyOrigin(instance.origin) !== instance.origin ||
    session.issuer !== `${instance.origin}/api/auth` ||
    session.tokenEndpoint !== `${instance.origin}/api/auth/oauth2/token`
  ) {
    throw new Error("OAuth session does not match the selected instance.");
  }
  const token = await requestOAuthToken({
    endpoint: session.tokenEndpoint,
    allowedOrigins: [instance.origin],
    authentication: { method: "basic", clientId, clientSecret },
    requireRefreshToken: true,
    parameters: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: session.verifier,
      resource: instance.origin,
    }),
  });
  if (!token.refresh_token) throw new Error("OAuth token response is not renewable.");
  return { ...token, refresh_token: token.refresh_token };
}
