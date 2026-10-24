import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { log } from "@/utils/misc/logger";
import { OAuthAuthorizationError, parseOAuthAuthorizationResponse } from "@/utils/oauth/authorizationResponse";
import {
  clearOAuthCallbackFlowsForTests,
  dispatchOAuthCallback,
  registerOAuthCallbackFlow,
} from "@/utils/oauth/callbackRoute";
import { fetchOAuthJson, type OAuthFetch } from "@/utils/oauth/oauthFetch";
import { OAuthRefreshCoordinator, type OAuthTokenStore } from "@/utils/oauth/refreshCoordinator";
import { createSignedOAuthState, validateSignedOAuthState } from "@/utils/oauth/state";
import { getOAuthPublicBaseUrl } from "@/utils/oauth/settings";
import { OAuthTokenError, requestOAuthToken } from "@/utils/oauth/tokenEndpoint";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";

beforeAll(initializeLocalizer);
afterEach(clearOAuthCallbackFlowsForTests);

const token = { access_token: "access-one", refresh_token: "refresh-two", token_type: "Bearer", expires_in: 3600 };
const requestOptions = {
  endpoint: "https://auth.example/token",
  allowedOrigins: ["https://auth.example"],
  authentication: { method: "body" as const, clientId: "client", clientSecret: "private-secret" },
  parameters: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "private-refresh" }),
};

describe("shared OAuth boundaries", () => {
  it("binds signed state to its flow and rejects tampering and expiry", () => {
    const created = createSignedOAuthState({
      flow: "patreon",
      subject: "user-one",
      signerSecret: "secret",
      ttlSeconds: 60,
    });
    expect(validateSignedOAuthState(created.state, "secret", new Date(), "patreon").valid).toBe(true);
    expect(validateSignedOAuthState(created.state, "secret", new Date(), "other").valid).toBe(false);
    expect(validateSignedOAuthState(`${created.state}x`, "secret").valid).toBe(false);
    expect(validateSignedOAuthState(created.state, "secret", new Date(Date.now() + 61_000)).valid).toBe(false);
  });

  it("dispatches only a registered and correctly signed flow", async () => {
    const handler = mock(async () => ({ statusCode: 200, contentType: "text/plain", body: "" }));
    registerOAuthCallbackFlow("patreon", { signerSecret: "secret", handle: handler });
    const signed = createSignedOAuthState({
      flow: "patreon",
      subject: "user-one",
      signerSecret: "secret",
      ttlSeconds: 60,
    });
    const url = new URL("https://bot.example/oauth/callback");
    url.searchParams.set("state", signed.state);
    expect((await dispatchOAuthCallback(url)).statusCode).toBe(200);
    url.searchParams.set("state", `${signed.state}x`);
    expect((await dispatchOAuthCallback(url)).statusCode).toBe(400);
    const unknown = createSignedOAuthState({
      flow: "other",
      subject: "user-one",
      signerSecret: "secret",
      ttlSeconds: 60,
    });
    url.searchParams.set("state", unknown.state);
    expect((await dispatchOAuthCallback(url)).body).toBe(localizedCopy("en-US", "general.oauth.invalid_callback"));
    const expired = createSignedOAuthState({
      flow: "patreon",
      subject: "user-one",
      signerSecret: "secret",
      ttlSeconds: 1,
      now: new Date(Date.now() - 2000),
    });
    url.searchParams.set("state", expired.state);
    expect((await dispatchOAuthCallback(url)).statusCode).toBe(400);
    clearOAuthCallbackFlowsForTests();
    url.searchParams.set("state", signed.state);
    expect((await dispatchOAuthCallback(url)).statusCode).toBe(400);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("reports callback handler failures as service errors without logging secrets or retrying database logging", async () => {
    const error = Object.assign(new Error("private-refresh-token"), {
      name: "PostgresError",
      code: "08006",
      query: "private-sql-parameters",
    });
    registerOAuthCallbackFlow("patreon", {
      signerSecret: "secret",
      handle: async () => {
        throw error;
      },
    });
    const signed = createSignedOAuthState({
      flow: "patreon",
      subject: "user-one",
      signerSecret: "secret",
      ttlSeconds: 60,
    });
    const url = new URL("https://bot.example/oauth/callback");
    url.searchParams.set("state", signed.state);
    const report = spyOn(log, "error").mockResolvedValue(undefined);
    try {
      const response = await dispatchOAuthCallback(url);
      expect(response.statusCode).toBe(500);
      expect(response.body).toBe(localizedCopy("en-US", "general.oauth.server_error"));
      expect(report).toHaveBeenCalledTimes(1);
      expect(report.mock.calls[0]?.[1]).toBeUndefined();
      expect(report.mock.calls[0]?.[2]).toEqual({
        metadata: { flow: "patreon", exceptionClass: "PostgresError", sqlState: "08006" },
      });
      expect(report.mock.calls[0]?.[3]).toEqual({ persist: false });
      const logged = JSON.stringify(report.mock.calls);
      expect(logged).not.toContain("private-refresh-token");
      expect(logged).not.toContain("private-sql-parameters");
      expect(logged).not.toContain(signed.state);
      url.searchParams.set("state", "malformed");
      expect((await dispatchOAuthCallback(url)).statusCode).toBe(400);
      expect(report).toHaveBeenCalledTimes(1);
    } finally {
      report.mockRestore();
    }
  });

  it("form-encodes Basic client credentials before joining them", async () => {
    const fetchImpl = mock<OAuthFetch>(async (_url, init) => {
      const header = new Headers(init?.headers).get("Authorization");
      expect(header).toBe(`Basic ${btoa("client%3Aid+one:secret%3A%2B%26+two")}`);
      return Response.json(token);
    });
    await requestOAuthToken({
      ...requestOptions,
      authentication: { method: "basic", clientId: "client:id one", clientSecret: "secret:+& two" },
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("checks issuer on error responses before classifying denial and refuses duplicate parameters", () => {
    const params = new URLSearchParams({
      state: "state",
      iss: "https://attacker.example",
      error: "private-upstream-text",
    });
    try {
      parseOAuthAuthorizationResponse(params, { state: "state", issuer: "https://auth.example", requireIssuer: true });
      throw new Error("Expected issuer validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthAuthorizationError);
      expect((error as OAuthAuthorizationError).reason).toBe("issuer");
      expect(String(error)).not.toContain("private-upstream-text");
    }
    for (const query of [
      "state=state&code=a&code=b",
      "state=state&state=state&code=a",
      "state=state&iss=a&iss=a&code=a",
    ]) {
      expect(() =>
        parseOAuthAuthorizationResponse(new URLSearchParams(query), {
          state: "state",
          issuer: "https://auth.example",
          requireIssuer: false,
        }),
      ).toThrow(OAuthAuthorizationError);
    }
  });

  it("accepts only HTTPS public origins", () => {
    expect(getOAuthPublicBaseUrl({})).toBe("https://api.tomoribot.app");
    expect(getOAuthPublicBaseUrl({ TOMORI_PUBLIC_BASE_URL: "https://bot.example/" })).toBe("https://bot.example");
    for (const url of [
      "http://bot.example",
      "https://user:pass@bot.example",
      "https://bot.example/path",
      "https://bot.example/?q=1",
    ]) {
      expect(() => getOAuthPublicBaseUrl({ TOMORI_PUBLIC_BASE_URL: url })).toThrow();
    }
  });

  it("refuses unapproved origins before sending credentials and bounds responses", async () => {
    const fetchImpl = mock<OAuthFetch>(async () => new Response("x".repeat(128 * 1024 + 1)));
    await expect(
      fetchOAuthJson("https://attacker.example/token", {}, { ...requestOptions, fetchImpl }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(fetchOAuthJson(requestOptions.endpoint, {}, { ...requestOptions, fetchImpl })).rejects.toThrow();
  });

  it("applies a deadline to stalled connection setup and response bodies", async () => {
    for (const fetchImpl of [
      async () => new Promise<Response>(() => {}),
      async () => new Response(new ReadableStream({ start() {} })),
    ]) {
      await expect(
        fetchOAuthJson(requestOptions.endpoint, {}, { ...requestOptions, fetchImpl, timeoutMs: 10 }),
      ).rejects.toThrow();
    }
  });

  it("accepts provider lifetimes longer than ten years when their expiration is representable", async () => {
    const expiresIn = 353_687_193;
    const result = await requestOAuthToken({
      ...requestOptions,
      fetchImpl: async () => Response.json({ ...token, expires_in: expiresIn }),
    });
    expect(result.expires_in).toBe(expiresIn);
    expect(result.refresh_token).toBe(token.refresh_token);
  });

  it("validates token shape, refuses redirects, and never includes upstream secrets in failures", async () => {
    for (const body of [
      { access_token: "secret" },
      { ...token, expires_in: -1 },
      { ...token, expires_in: 0 },
      { ...token, expires_in: Number.MAX_VALUE },
      { ...token, token_type: "MAC" },
    ]) {
      const fetchImpl = mock<OAuthFetch>(async (_url, init) => {
        expect(init?.redirect).toBe("manual");
        return Response.json(body);
      });
      await expect(requestOAuthToken({ ...requestOptions, fetchImpl })).rejects.toBeInstanceOf(OAuthTokenError);
    }
    const fetchImpl = mock<OAuthFetch>(async () =>
      Response.json({ error: "invalid_grant", error_description: "private-refresh" }, { status: 400 }),
    );
    try {
      await requestOAuthToken({ ...requestOptions, fetchImpl });
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthTokenError);
      expect((error as OAuthTokenError).disposition).toBe("blocked");
      expect(String(error)).not.toContain("private-refresh");
    }
  });

  it("blocks known permanent OAuth failures while preserving retries for other 400 responses", async () => {
    for (const error of [
      "invalid_grant",
      "invalid_client",
      "unauthorized_client",
      "invalid_target",
      "unknown_provider_error",
    ]) {
      await expect(
        requestOAuthToken({
          ...requestOptions,
          fetchImpl: async () => Response.json({ error }, { status: 400 }),
        }),
      ).rejects.toMatchObject({ disposition: error === "unknown_provider_error" ? "retry" : "blocked", status: 400 });
    }
  });

  it("honors retry-after seconds and dates", async () => {
    for (const [status, headers, body] of [
      [429, { "Retry-After": "120" }, {}],
      [503, { "Retry-After": new Date(Date.now() + 120_000).toUTCString() }, {}],
    ] as const) {
      const fetchImpl = mock<OAuthFetch>(async () => Response.json(body, { status, headers }));
      try {
        await requestOAuthToken({ ...requestOptions, fetchImpl });
        throw new Error("Expected retryable failure.");
      } catch (error) {
        expect(error).toBeInstanceOf(OAuthTokenError);
        expect((error as OAuthTokenError).disposition).toBe("retry");
        expect((error as OAuthTokenError).retryAt.getTime()).toBeGreaterThan(Date.now() + 115_000);
      }
    }
  });

  it("preserves safe storage diagnostics and drops exception messages, unknown names, and invalid SQLSTATEs", async () => {
    for (const [error, diagnostics] of [
      [
        Object.assign(new Error("private-refresh-token"), {
          name: "PostgresError",
          code: "08006",
          parameters: ["private-client-secret"],
        }),
        { exceptionClass: "PostgresError", sqlState: "08006" },
      ],
      [
        Object.assign(new Error("private-refresh-token"), {
          name: "private-client-secret",
          code: "private-sql-parameters",
        }),
        { exceptionClass: "unknown" },
      ],
    ] as const) {
      const onFailure = mock<Parameters<OAuthRefreshCoordinator["getAccessToken"]>[0]["onFailure"]>(() => {});
      const store: OAuthTokenStore = {
        withLock: async () => {
          throw error;
        },
      };
      expect(
        await new OAuthRefreshCoordinator().getAccessToken({ ...requestOptions, key: "instance", store, onFailure }),
      ).toBeNull();
      expect(onFailure.mock.calls).toEqual([["storage", "retry", diagnostics]]);
      expect(JSON.stringify(onFailure.mock.calls)).not.toContain("private-refresh-token");
      expect(JSON.stringify(onFailure.mock.calls)).not.toContain("private-client-secret");
      expect(JSON.stringify(onFailure.mock.calls)).not.toContain("private-sql-parameters");
    }
  });

  it("shares concurrent refresh and returns access only after commit", async () => {
    let committed = false;
    let persistedRefresh = "";
    const store: OAuthTokenStore = {
      withLock: async (operation) => {
        const result = await operation({
          load: async () => ({
            accessToken: null,
            expiresAt: null,
            refreshToken: "refresh-one",
            blocked: false,
            retryAt: null,
            authentication: requestOptions.authentication,
          }),
          persist: async (_token, refreshToken) => {
            persistedRefresh = refreshToken;
          },
          fail: async () => {},
        });
        committed = true;
        return result;
      },
    };
    const fetchImpl = mock<OAuthFetch>(async () => Response.json(token));
    const coordinator = new OAuthRefreshCoordinator();
    const options = { ...requestOptions, key: "instance", store, fetchImpl, onFailure: () => {} };
    const results = await Promise.all([coordinator.getAccessToken(options), coordinator.getAccessToken(options)]);
    expect(results).toEqual(["access-one", "access-one"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(committed).toBe(true);
    expect(persistedRefresh).toBe("refresh-two");
    expect(await coordinator.getAccessToken(options)).toBe("access-one");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
