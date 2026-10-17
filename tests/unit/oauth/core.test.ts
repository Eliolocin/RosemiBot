import { describe, expect, it, mock } from "bun:test";
import { OAuthAuthorizationError, parseOAuthAuthorizationResponse } from "@/utils/oauth/authorizationResponse";
import { fetchOAuthJson, type OAuthFetch } from "@/utils/oauth/oauthFetch";
import { OAuthRefreshCoordinator, type OAuthTokenStore } from "@/utils/oauth/refreshCoordinator";
import { OAuthTokenError, requestOAuthToken } from "@/utils/oauth/tokenEndpoint";

const token = { access_token: "access-one", refresh_token: "refresh-two", token_type: "Bearer", expires_in: 3600 };
const requestOptions = {
  endpoint: "https://auth.example/token",
  allowedOrigins: ["https://auth.example"],
  authentication: { method: "body" as const, clientId: "client", clientSecret: "private-secret" },
  parameters: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "private-refresh" }),
};

describe("shared OAuth boundaries", () => {
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

  it("validates token shape, refuses redirects, and never includes upstream secrets in failures", async () => {
    for (const body of [{ access_token: "secret" }, { ...token, expires_in: -1 }, { ...token, token_type: "MAC" }]) {
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
