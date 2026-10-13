import { afterEach, describe, expect, it } from "bun:test";
import { getFetchUrlEngineOrder } from "@/tools/fetchUrl/dispatcher";
import { convertFetchedContent, SafeHttpFetchEngine } from "@/tools/fetchUrl/safeHttpFetchEngine";
import type { ToolContext } from "@/types/tool/interfaces";
import {
  checkCrossOriginRedirect,
  createPinnedFetchRequest,
  fetchUserRemoteUrl,
  RemoteUrlPolicyError,
  resolveValidatedUserRedirect,
} from "@/utils/security/userRemoteFetch";
import { useEnvSandbox } from "../../helpers/env";

const PRIVATE_NETWORK_ENV = "FETCH_URL_ALLOW_PRIVATE_NETWORK";
const RUN_ENV_NAME = "RUN_ENV";
const CRAWL4AI_BASE_URL_ENV = "CRAWL4AI_BASE_URL";

useEnvSandbox([PRIVATE_NETWORK_ENV, RUN_ENV_NAME, CRAWL4AI_BASE_URL_ENV]);

describe("safe HTTP fetch engine", () => {
  it("uses only the guarded in-process engine when Crawl4AI is not configured", () => {
    delete process.env[RUN_ENV_NAME];
    delete process.env[CRAWL4AI_BASE_URL_ENV];
    expect(getFetchUrlEngineOrder()).toEqual(["safe_http"]);
  });

  it("does not enable a configured external browser fetcher in production without an explicit opt-in", () => {
    process.env[RUN_ENV_NAME] = "production";
    process.env[CRAWL4AI_BASE_URL_ENV] = "http://127.0.0.1:11235/";
    delete process.env[PRIVATE_NETWORK_ENV];
    expect(getFetchUrlEngineOrder()).toEqual(["safe_http"]);

    process.env[PRIVATE_NETWORK_ENV] = "true";
    expect(getFetchUrlEngineOrder()).toEqual(["crawl4ai", "safe_http"]);
  });

  it("tries a configured external browser fetcher first outside production, with safe_http as fallback", () => {
    delete process.env[RUN_ENV_NAME];
    process.env[CRAWL4AI_BASE_URL_ENV] = "http://127.0.0.1:11235/";
    expect(getFetchUrlEngineOrder()).toEqual(["crawl4ai", "safe_http"]);
  });

  it("removes executable HTML content while converting readable content", () => {
    const markdown = convertFetchedContent(
      "<main><h1>Safe title</h1><script>metadata_secret()</script><p>Hello</p></main>",
      "text/html; charset=utf-8",
    );

    expect(markdown).toContain("# Safe title");
    expect(markdown).toContain("Hello");
    expect(markdown).not.toContain("metadata_secret");
  });

  it("pins the transport URL while preserving the origin Host and TLS name", () => {
    const request = createPinnedFetchRequest(
      new URL("https://example.com:8443/path?q=1"),
      { headers: { Accept: "text/plain" } },
      "203.0.113.10",
    );

    expect(request.url.toString()).toBe("https://203.0.113.10:8443/path?q=1");
    expect(new Headers(request.init.headers).get("host")).toBe("example.com:8443");
    expect(new Headers(request.init.headers).get("accept")).toBe("text/plain");
    expect(request.init.tls?.serverName).toBe("example.com");
  });

  it("returns a streaming response before its body finishes", async () => {
    process.env[RUN_ENV_NAME] = "development";
    let finishBody: (() => void) | undefined;
    const finishResponseBody = (): void => {
      const finish = finishBody;
      finishBody = undefined;
      finish?.();
    };
    const server = Bun.serve({
      hostname: "::",
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("first"));
              finishBody = () => {
                controller.enqueue(new TextEncoder().encode("-second"));
                controller.close();
              };
            },
          }),
        ),
    });
    const responsePromise = fetchUserRemoteUrl(`http://localhost:${server.port}/stream`);
    const timeoutMarker = Symbol("response timeout");

    try {
      const response = await Promise.race([
        responsePromise,
        new Promise<typeof timeoutMarker>((resolve) => setTimeout(() => resolve(timeoutMarker), 1_000)),
      ]);

      expect(response).not.toBe(timeoutMarker);
      finishResponseBody();
      if (response !== timeoutMarker) {
        expect(await response.text()).toBe("first-second");
      }
    } finally {
      // Release the old blocking implementation too, so a failing regression
      // test does not leave an active request behind.
      finishResponseBody();
      await responsePromise.catch(() => undefined);
      server.stop(true);
    }
  });

  it("retries a refused POST on the next validated address without duplicating the body", async () => {
    process.env[RUN_ENV_NAME] = "development";
    let requestCount = 0;
    const receivedBodies: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        requestCount += 1;
        receivedBodies.push(await request.text());
        return Response.json({ ok: true });
      },
    });

    try {
      const response = await fetchUserRemoteUrl(`http://localhost:${server.port}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      });

      expect(response.ok).toBe(true);
      expect(requestCount).toBe(1);
      expect(receivedBodies).toEqual(['{"message":"hello"}']);
    } finally {
      server.stop(true);
    }
  });

  it("includes fetched page content in provider-visible result data", async () => {
    process.env[RUN_ENV_NAME] = "development";
    const server = Bun.serve({
      hostname: "::",
      port: 0,
      fetch: () =>
        new Response("<main><h1>Fetched title</h1><p>Readable body.</p></main>", {
          headers: { "Content-Type": "text/html" },
        }),
    });

    try {
      const result = await new SafeHttpFetchEngine().fetch(`http://localhost:${server.port}/page`, {}, {
        abortSignal: AbortSignal.timeout(5_000),
      } as ToolContext);
      const data = result.data as { summary?: string };

      expect(result.success).toBe(true);
      expect(data.summary).toBe(result.message);
      expect(data.summary).toContain("# Fetched title");
      expect(data.summary).toContain("Readable body.");
    } finally {
      server.stop(true);
    }
  });

  it("preserves start_index pagination in provider-visible summaries", async () => {
    process.env[RUN_ENV_NAME] = "development";
    const server = Bun.serve({
      hostname: "::",
      port: 0,
      fetch: () => new Response("abcdefghijklmnopqrstuvwxyz", { headers: { "Content-Type": "text/plain" } }),
    });
    const engine = new SafeHttpFetchEngine();
    const context = { abortSignal: AbortSignal.timeout(5_000) } as ToolContext;
    const url = `http://localhost:${server.port}/page`;

    try {
      const first = await engine.fetch(url, { maxLength: 10 }, context);
      const firstData = first.data as { summary: string; nextIndex?: number; startIndex: number };
      expect(firstData.summary).toContain("abcdefghij");
      expect(firstData.summary).toContain("start_index=10");
      expect(firstData.nextIndex).toBe(10);

      const second = await engine.fetch(url, { maxLength: 10, startIndex: firstData.nextIndex }, context);
      const secondData = second.data as { summary: string; nextIndex?: number; startIndex: number };
      expect(secondData.summary).toContain("klmnopqrst");
      expect(secondData.startIndex).toBe(10);
      expect(secondData.nextIndex).toBe(20);
    } finally {
      server.stop(true);
    }
  });

  it("rejects a redirect from a public URL to Azure IMDS before the next request", async () => {
    await expect(
      resolveValidatedUserRedirect(
        new URL("https://example.com/start"),
        "https://169.254.169.254/metadata/identity/oauth2/token",
        true,
      ),
    ).rejects.toThrow(/link-local|publicly routable/i);
  });
});

interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

const SYNTHETIC_BEARER = "Bearer synthetic-redirect-canary";
const CREDENTIAL_HEADERS = {
  Authorization: SYNTHETIC_BEARER,
  "x-api-key": "synthetic-x-api-key-canary",
  "x-goog-api-key": "synthetic-goog-canary",
  Cookie: "session=synthetic-cookie-canary",
};

type FixtureRoute = (request: Request) => Response;

function redirectTo(location: string, status: number): Response {
  return new Response(null, { status, headers: { Location: location } });
}

function receivedCanary(requests: RecordedRequest[]): boolean {
  const canaries = Object.values(CREDENTIAL_HEADERS);
  return requests.some((request) => Object.values(request.headers).some((value) => canaries.includes(value)));
}

describe("user remote fetch redirect credentials", () => {
  const servers: Array<{ stop: (force?: boolean) => void }> = [];

  afterEach(() => {
    for (const server of servers.splice(0)) server.stop(true);
  });

  /**
   * A loopback server whose routes answer or redirect. Two servers on different ports are two
   * origins, which is all a cross-origin credential test needs. Routes stay mutable so a fixture
   * can redirect to a server started after it.
   */
  function fixture(routes: Record<string, FixtureRoute> = {}) {
    process.env[RUN_ENV_NAME] = "development";
    const received: RecordedRequest[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        received.push({
          method: request.method,
          path,
          headers: Object.fromEntries(request.headers.entries()),
          body: await request.text(),
        });
        return routes[path]?.(request) ?? new Response("missing", { status: 404 });
      },
    });
    servers.push(server);
    return { routes, received, origin: `http://127.0.0.1:${server.port}` };
  }

  it("sends credentials on a direct request", async () => {
    const target = fixture({ "/v1/models": () => Response.json({ data: [] }) });

    const response = await fetchUserRemoteUrl(`${target.origin}/v1/models`, { headers: CREDENTIAL_HEADERS });

    expect(response.status).toBe(200);
    expect(target.received[0]?.headers.authorization).toBe(SYNTHETIC_BEARER);
  });

  it.each([301, 302, 303, 307, 308])("keeps credentials across a same-origin %i GET redirect", async (status) => {
    const target = fixture({
      "/v1/models/": () => redirectTo("/v1/models", status),
      "/v1/models": () => Response.json({ data: [] }),
    });

    const response = await fetchUserRemoteUrl(`${target.origin}/v1/models/`, { headers: CREDENTIAL_HEADERS });

    expect(response.status).toBe(200);
    expect(target.received.map((request) => request.headers.authorization)).toEqual([
      SYNTHETIC_BEARER,
      SYNTHETIC_BEARER,
    ]);
  });

  it.each([
    [301, "GET", ""],
    [302, "GET", ""],
    [303, "GET", ""],
    [307, "POST", '{"text":"hello"}'],
    [308, "POST", '{"text":"hello"}'],
  ])("applies %i method semantics to a same-origin credentialed POST", async (status, method, body) => {
    const target = fixture({
      "/synthesize/": () => redirectTo("/synthesize", status),
      "/synthesize": () => Response.json({ detail: "validation" }, { status: 422 }),
    });

    const response = await fetchUserRemoteUrl(`${target.origin}/synthesize/`, {
      method: "POST",
      headers: { ...CREDENTIAL_HEADERS, "Content-Type": "application/json" },
      body: '{"text":"hello"}',
    });

    const followed = target.received[1];
    expect(response.status).toBe(422);
    expect(followed?.method).toBe(method);
    expect(followed?.body).toBe(body);
    expect(followed?.headers.authorization).toBe(SYNTHETIC_BEARER);
  });

  it("follows a cross-origin asset redirect anonymously while keeping safe headers", async () => {
    const assetHost = fixture({ "/signed/video.mp4": () => new Response("video-bytes") });
    const apiHost = fixture({ "/files/video": () => redirectTo(`${assetHost.origin}/signed/video.mp4`, 302) });

    const response = await fetchUserRemoteUrl(`${apiHost.origin}/files/video`, {
      headers: { ...CREDENTIAL_HEADERS, "User-Agent": "TomoriBot-test", Accept: "video/mp4" },
    });

    expect(await response.text()).toBe("video-bytes");
    expect(receivedCanary(assetHost.received)).toBe(false);
    expect(assetHost.received[0]?.headers["user-agent"]).toBe("TomoriBot-test");
    expect(assetHost.received[0]?.headers.accept).toBe("video/mp4");
  });

  it("explains a cross-origin 307 POST that the new origin rejects without credentials", async () => {
    const otherHost = fixture({ "/v1/chat/completions": () => new Response("unauthorized", { status: 401 }) });
    const apiHost = fixture({
      "/v1/chat/completions": () => redirectTo(`${otherHost.origin}/v1/chat/completions`, 307),
    });

    const error = await fetchUserRemoteUrl(`${apiHost.origin}/v1/chat/completions`, {
      method: "POST",
      headers: { ...CREDENTIAL_HEADERS, "Content-Type": "application/json" },
      body: '{"messages":[]}',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RemoteUrlPolicyError);
    expect((error as RemoteUrlPolicyError).failureCode).toBe("REDIRECT_CREDENTIALS_WITHHELD");
    expect(otherHost.received[0]?.method).toBe("POST");
    expect(otherHost.received[0]?.body).toBe('{"messages":[]}');
    expect(receivedCanary(otherHost.received)).toBe(false);
  });

  it("treats a hostname change on the same port as a different origin", async () => {
    const target = fixture({
      "/start": (request) => redirectTo(`http://localhost:${new URL(request.url).port}/landed`, 302),
      "/landed": () => new Response("landed"),
    });

    const response = await fetchUserRemoteUrl(`${target.origin}/start`, { headers: CREDENTIAL_HEADERS });

    expect(await response.text()).toBe("landed");
    expect(target.received[1]?.headers.authorization).toBeUndefined();
  });

  it("does not reattach credentials when a later hop returns to the original origin", async () => {
    const apiHost = fixture({ "/final": () => new Response("final") });
    const bounceHost = fixture({ "/bounce": () => redirectTo(`${apiHost.origin}/final`, 302) });
    apiHost.routes["/start"] = () => redirectTo(`${bounceHost.origin}/bounce`, 302);

    const response = await fetchUserRemoteUrl(`${apiHost.origin}/start`, { headers: CREDENTIAL_HEADERS });

    expect(await response.text()).toBe("final");
    expect(apiHost.received[0]?.headers.authorization).toBe(SYNTHETIC_BEARER);
    expect(receivedCanary([...bounceHost.received, ...apiHost.received.slice(1)])).toBe(false);
  });

  it("refuses a credentialed HTTPS to HTTP downgrade before sending anything", () => {
    expect(() =>
      checkCrossOriginRedirect(new URL("https://api.example.com/v1"), new URL("http://api.example.com/v1"), {
        headers: { Authorization: SYNTHETIC_BEARER },
      }),
    ).toThrow(RemoteUrlPolicyError);
  });

  it("treats an HTTP to HTTPS upgrade as an origin change that drops credentials", () => {
    expect(
      checkCrossOriginRedirect(new URL("http://api.example.com/v1"), new URL("https://api.example.com/v1"), {
        headers: { Authorization: SYNTHETIC_BEARER },
      }),
    ).toBe(true);
  });

  it("allows an anonymous downgrade under the existing URL policy", () => {
    expect(
      checkCrossOriginRedirect(new URL("https://images.example.com/a.png"), new URL("http://cdn.example.net/a.png"), {
        headers: { "User-Agent": "TomoriBot-test" },
      }),
    ).toBe(false);
  });

  it("refuses a cross-origin target that embeds URL credentials", () => {
    expect(() =>
      checkCrossOriginRedirect(new URL("https://api.example.com/v1"), new URL("https://user:pw@other.example/v1"), {}),
    ).toThrow(RemoteUrlPolicyError);
  });
});
