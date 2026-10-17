import { timingSafeEqual } from "node:crypto";

export class OAuthAuthorizationError extends Error {
  constructor(public readonly reason: "state" | "issuer" | "denied" | "code") {
    super(`OAuth authorization failed: ${reason}.`);
  }
}

export function parseOAuthAuthorizationResponse(
  params: URLSearchParams,
  options: { state: string; issuer: string; requireIssuer: boolean },
): string {
  const states = params.getAll("state");
  const expected = Buffer.from(options.state);
  const actual = Buffer.from(states[0] ?? "");
  if (states.length !== 1 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new OAuthAuthorizationError("state");
  }
  const issuers = params.getAll("iss");
  if (
    issuers.length > 1 ||
    (options.requireIssuer && issuers.length !== 1) ||
    (issuers.length === 1 && issuers[0] !== options.issuer)
  ) {
    throw new OAuthAuthorizationError("issuer");
  }
  if (params.has("error")) throw new OAuthAuthorizationError("denied");
  const codes = params.getAll("code");
  if (codes.length !== 1 || !codes[0]?.trim()) throw new OAuthAuthorizationError("code");
  return codes[0];
}
