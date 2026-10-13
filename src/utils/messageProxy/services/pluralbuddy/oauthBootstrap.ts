import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { MessageProxyInstanceContext } from "@/utils/messageProxy/instances";
import { canonicalMessageProxyOrigin } from "@/utils/messageProxy/instances";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";
import { readBoundedMessageProxyResponse } from "@/utils/messageProxy/boundedResponse";

const DISCOVERY_TIMEOUT_MS = 10_000;
const TOKEN_TIMEOUT_MS = 10_000;

const discoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  response_types_supported: z.array(z.string()),
  grant_types_supported: z.array(z.string()),
  code_challenge_methods_supported: z.array(z.string()),
  token_endpoint_auth_methods_supported: z.array(z.string()),
  authorization_response_iss_parameter_supported: z.literal(true),
});

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z
    .string()
    .transform((value) => value.toLowerCase())
    .pipe(z.literal("bearer")),
  expires_in: z.number().positive(),
});

export type PluralBuddyBootstrapToken = z.infer<typeof tokenSchema>;

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
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
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
  const response = await fetchUserRemoteUrl(
    `${instance.origin}/.well-known/openid-configuration`,
    {
      redirect: "manual",
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    },
    { strict: true },
  );
  if (!response.ok) throw new Error(`OAuth discovery failed with status ${response.status}.`);
  const parsed = discoverySchema.safeParse(JSON.parse(await readBoundedMessageProxyResponse(response)));
  if (
    !parsed.success ||
    parsed.data.issuer !== issuer ||
    parsed.data.authorization_endpoint !== authorizationEndpoint ||
    parsed.data.token_endpoint !== tokenEndpoint ||
    !parsed.data.response_types_supported.includes("code") ||
    !parsed.data.grant_types_supported.includes("authorization_code") ||
    !parsed.data.grant_types_supported.includes("refresh_token") ||
    !parsed.data.code_challenge_methods_supported.includes("S256") ||
    !parsed.data.token_endpoint_auth_methods_supported.includes("client_secret_basic")
  ) {
    throw new Error("OAuth discovery does not match the selected instance or required authorization flow.");
  }

  return { issuer, authorizationEndpoint, tokenEndpoint };
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
  const states = callbackUrl.searchParams.getAll("state");
  const issuers = callbackUrl.searchParams.getAll("iss");
  if (states.length !== 1 || issuers.length !== 1) {
    throw new Error("OAuth callback has ambiguous state or issuer parameters.");
  }
  const receivedState = states[0];
  const expected = Buffer.from(session.state);
  const received = Buffer.from(receivedState ?? "");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new Error("OAuth callback state did not match.");
  }
  if (issuers[0] !== session.issuer) {
    throw new Error("OAuth callback issuer did not match.");
  }
  if (callbackUrl.searchParams.has("error")) {
    throw new Error("OAuth authorization was denied or expired.");
  }
  const codes = callbackUrl.searchParams.getAll("code");
  if (codes.length !== 1 || !codes[0]) throw new Error("OAuth callback did not contain one code.");
  return codes[0];
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
    session.issuer !== `${instance.origin}/api/auth` ||
    session.tokenEndpoint !== `${instance.origin}/api/auth/oauth2/token`
  ) {
    throw new Error("OAuth session does not match the selected instance.");
  }
  const credentials = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  const response = await fetchUserRemoteUrl(
    session.tokenEndpoint,
    {
      method: "POST",
      redirect: "manual",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: session.verifier,
        resource: instance.origin,
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    },
    { strict: true },
  );
  if (!response.ok) throw new Error(`OAuth token exchange failed with status ${response.status}.`);
  const parsed = tokenSchema.safeParse(JSON.parse(await readBoundedMessageProxyResponse(response)));
  if (!parsed.success) throw new Error("OAuth token exchange did not return a renewable Bearer token.");
  return parsed.data;
}
