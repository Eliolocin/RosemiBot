import { afterEach, describe, expect, it, mock } from "bun:test";
import * as realRemoteFetch from "@/utils/security/userRemoteFetch";
import { createScopedModuleMocker } from "../../../helpers/mockSurface";

const request = mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
  Response.json({
    issuer: "https://pluralbuddy.app/api/auth",
    authorization_endpoint: "https://pluralbuddy.app/api/auth/oauth2/authorize",
    token_endpoint: "https://pluralbuddy.app/api/auth/oauth2/token",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
    authorization_response_iss_parameter_supported: true,
  }),
);
const scopedMock = createScopedModuleMocker(mock, { "@/utils/security/userRemoteFetch": realRemoteFetch });
scopedMock.module("@/utils/security/userRemoteFetch", () => ({ ...realRemoteFetch, fetchUserRemoteUrl: request }));

const {
  createPluralBuddyOAuthSession,
  exchangePluralBuddyOAuthCode,
  parsePluralBuddyOAuthCallback,
  validatePluralBuddyRedirect,
} = await import("@/utils/messageProxy/services/pluralbuddy/oauthBootstrap");

const instance = {
  serviceId: "pluralbuddy" as const,
  instanceId: "pluralbuddy:official",
  origin: "https://pluralbuddy.app",
};
const redirect = "http://127.0.0.1:47321/oauth/callback";

afterEach(() => {
  request.mockClear();
  request.mockImplementation(async () =>
    Response.json({
      issuer: "https://pluralbuddy.app/api/auth",
      authorization_endpoint: "https://pluralbuddy.app/api/auth/oauth2/authorize",
      token_endpoint: "https://pluralbuddy.app/api/auth/oauth2/token",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic"],
      authorization_response_iss_parameter_supported: true,
    }),
  );
});

describe("PluralBuddy bot host OAuth bootstrap", () => {
  it("requires an exact loopback redirect", () => {
    expect(validatePluralBuddyRedirect(redirect).toString()).toBe(redirect);
    expect(() => validatePluralBuddyRedirect("https://example.com/oauth/callback")).toThrow();
    expect(() => validatePluralBuddyRedirect("http://localhost:47321/oauth/callback")).toThrow();
  });

  it("binds authorization to the selected origin and validates callback state and issuer", async () => {
    const session = await createPluralBuddyOAuthSession(instance, "client-id", redirect);
    const authorization = new URL(session.authorizeUrl);
    expect(authorization.origin).toBe(instance.origin);
    expect(authorization.searchParams.get("redirect_uri")).toBe(redirect);
    expect(authorization.searchParams.get("resource")).toBe(instance.origin);
    expect(authorization.searchParams.get("scope")).toBe("profile offline_access");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("code_challenge")).toBeTruthy();
    expect(authorization.searchParams.get("code_challenge")).not.toBe(session.verifier);

    const callback = new URL(redirect);
    callback.searchParams.set("state", session.state);
    callback.searchParams.set("iss", session.issuer);
    callback.searchParams.set("code", "short-lived-code");
    expect(parsePluralBuddyOAuthCallback(callback, redirect, session)).toBe("short-lived-code");
    callback.searchParams.set("iss", "https://other.example/api/auth");
    expect(() => parsePluralBuddyOAuthCallback(callback, redirect, session)).toThrow();
    callback.searchParams.set("iss", session.issuer);
    callback.searchParams.set("state", "wrong-state");
    expect(() => parsePluralBuddyOAuthCallback(callback, redirect, session)).toThrow();
    callback.searchParams.set("state", session.state);
    callback.searchParams.append("state", session.state);
    expect(() => parsePluralBuddyOAuthCallback(callback, redirect, session)).toThrow();
    callback.searchParams.delete("state");
    callback.searchParams.set("state", session.state);
    callback.searchParams.delete("code");
    callback.searchParams.set("error", "access_denied");
    expect(() => parsePluralBuddyOAuthCallback(callback, redirect, session)).toThrow();
  });

  it("sends PKCE and instance resource with Basic client authentication", async () => {
    const session = await createPluralBuddyOAuthSession(instance, "client-id", redirect);
    request.mockImplementationOnce(async (_input, init) => {
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Basic ${btoa("client-id:client-secret")}`);
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("redirect_uri")).toBe(redirect);
      expect(body.get("code_verifier")).toBe(session.verifier);
      expect(body.get("resource")).toBe(instance.origin);
      return Response.json({
        access_token: "access-token",
        refresh_token: "refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
      });
    });
    const token = await exchangePluralBuddyOAuthCode(
      instance,
      "client-id",
      "client-secret",
      redirect,
      session,
      "short-lived-code",
    );
    expect(token.refresh_token).toBe("refresh-token");
  });

  it("rejects discovery that points credentials to another origin", async () => {
    request.mockImplementationOnce(async () =>
      Response.json({
        issuer: "https://pluralbuddy.app/api/auth",
        authorization_endpoint: "https://pluralbuddy.app/api/auth/oauth2/authorize",
        token_endpoint: "https://other.example/api/auth/oauth2/token",
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
        authorization_response_iss_parameter_supported: true,
      }),
    );
    expect(createPluralBuddyOAuthSession(instance, "client-id", redirect)).rejects.toThrow();
  });

  it("does not accept an exchange without a renewable token", async () => {
    const session = await createPluralBuddyOAuthSession(instance, "client-id", redirect);
    request.mockImplementationOnce(async () => Response.json({ access_token: "access-token", expires_in: 3600 }));
    expect(
      exchangePluralBuddyOAuthCode(instance, "client-id", "client-secret", redirect, session, "short-lived-code"),
    ).rejects.toThrow();
  });

  it("does not send one instance's client credentials to another origin", async () => {
    const session = await createPluralBuddyOAuthSession(instance, "client-id", redirect);
    const other = {
      serviceId: "pluralbuddy" as const,
      instanceId: "pluralbuddy:11111111-1111-4111-8111-111111111111",
      origin: "https://another.example",
    };
    request.mockClear();
    expect(
      exchangePluralBuddyOAuthCode(other, "client-id", "client-secret", redirect, session, "short-lived-code"),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
