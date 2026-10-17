import { officialMessageProxyInstanceFixture } from "../../../helpers/messageProxyInstance";
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { stallUntilAborted } from "../../../helpers/fetchStub";

const originalLookupTimeoutMs = process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS;
const originalApiToken = process.env.PLURALKIT_API_TOKEN;
process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS = "2000";

// Set at module scope, so it can only be undone once every test here has run.
afterAll(() => {
  if (originalLookupTimeoutMs === undefined) delete process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS;
  else process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS = originalLookupTimeoutMs;
  if (originalApiToken === undefined) delete process.env.PLURALKIT_API_TOKEN;
  else process.env.PLURALKIT_API_TOKEN = originalApiToken;
});

let fetchMessage: typeof import("@/utils/messageProxy/services/pluralkit/api").fetchMessage;
let getCachedMessageLookup: typeof import("@/utils/messageProxy/services/pluralkit/api").getCachedMessageLookup;
let clearPluralKitApiStateForTests: typeof import("@/utils/messageProxy/services/pluralkit/api").clearPluralKitApiStateForTests;
let PluralKitLookupUnavailableError: typeof import("@/utils/messageProxy/services/pluralkit/api").PluralKitLookupUnavailableError;

const FILE_LOOKUP_TIMEOUT_MS = "2000";

beforeAll(async () => {
  ({ fetchMessage, getCachedMessageLookup, clearPluralKitApiStateForTests, PluralKitLookupUnavailableError } =
    await import("@/utils/messageProxy/services/pluralkit/api"));
});

const officialInstance = officialMessageProxyInstanceFixture("pluralkit");
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearPluralKitApiStateForTests();
  process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS = FILE_LOOKUP_TIMEOUT_MS;
  if (originalApiToken === undefined) delete process.env.PLURALKIT_API_TOKEN;
  else process.env.PLURALKIT_API_TOKEN = originalApiToken;
});

/** Runs one test under a lookup budget other than the file's 2000ms default. */
async function withLookupBudget(budgetMs: number, body: () => Promise<void>): Promise<void> {
  process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS = String(budgetMs);
  try {
    await body();
  } finally {
    process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS = FILE_LOOKUP_TIMEOUT_MS;
  }
}

function snowflake(value: string): string {
  return (
    (BigInt(`0x${createHash("sha256").update(value).digest("hex").slice(0, 15)}`) % 900000000000000000n) +
    100000000000000000n
  ).toString();
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  const payload =
    body && typeof body === "object" && !Array.isArray(body)
      ? {
          ...body,
          ...Object.fromEntries(
            Object.entries(body)
              .filter(([key, value]) => (key === "original" || key === "sender") && typeof value === "string")
              .map(([key, value]) => [key, snowflake(value as string)]),
          ),
        }
      : body;
  return new Response(JSON.stringify(payload), { status, headers });
}

// Two cases below exhaust the real retry budget rather than faking timers, so they need
// headroom over the 5s per-test default.
const RETRY_EXHAUSTION_TIMEOUT_MS = 20_000;

describe("pkApi.fetchMessage", () => {
  it("resolves a successful lookup and normalizes fields", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(200, {
        original: "111",
        sender: "222",
        system: { id: "abcdef", uuid: "11111111-2222-4333-8444-555555555555", name: "Lighthouse", tag: "[LH]" },
        member: { id: "ghijkl", uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: "TestA", display_name: "Test A" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchMessage(officialInstance, "msg-success-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      original: snowflake("111"),
      sender: snowflake("222"),
      system: { id: "abcdef", uuid: "11111111-2222-4333-8444-555555555555", name: "Lighthouse", tag: "[LH]" },
      member: { id: "ghijkl", uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: "TestA", display_name: "Test A" },
    });
  });

  it("treats a deleted member as no identity claim", async () => {
    const fetchMock = mock(async () => jsonResponse(200, { original: "333", sender: "444" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchMessage(officialInstance, "msg-deleted-member");

    expect(result?.system).toBeNull();
    expect(result?.member).toBeNull();
    expect(result?.sender).toBe(snowflake("444"));
  });

  it("accepts private optional fields without inventing values", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(200, {
        original: "private-original",
        sender: "private-sender",
        system: {
          id: "abcdef",
          uuid: "11111111-2222-4333-8444-555555555555",
        },
        member: {
          id: "ghijkl",
          uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          name: "Mirri",
        },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchMessage(officialInstance, "msg-private-fields");

    expect(result?.system?.name).toBeUndefined();
    expect(result?.system?.description).toBeUndefined();
    expect(result?.member?.display_name).toBeUndefined();
    expect(result?.member?.pronouns).toBeUndefined();
  });

  it("keeps a public member's pronouns in the validated payload", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(200, {
        original: "pronoun-original",
        sender: "pronoun-sender",
        system: { id: "abcdef", uuid: "11111111-2222-4333-8444-555555555555", name: "Lighthouse" },
        member: {
          id: "ghijkl",
          uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          name: "Mirri",
          pronouns: "she/her",
        },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect((await fetchMessage(officialInstance, "msg-public-pronouns"))?.member?.pronouns).toBe("she/her");
  });

  it("accepts explicit null pronouns from a member who keeps them private", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(200, {
        original: "null-pronoun-original",
        sender: "null-pronoun-sender",
        system: { id: "abcdef", uuid: "11111111-2222-4333-8444-555555555555" },
        member: {
          id: "ghijkl",
          uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          name: "Mirri",
          pronouns: null,
        },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect((await fetchMessage(officialInstance, "msg-null-pronouns"))?.member?.pronouns).toBeNull();
  });

  it("fails closed on structurally invalid successful payloads", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(200, {
        original: "invalid-original",
        sender: "invalid-sender",
        system: { id: "abcdef", uuid: "not-a-uuid" },
        member: null,
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // PK answered, but not with anything trustworthy: that is a transport failure,
    // never a confirmed miss, and the untrustworthy answer must not be cached.
    await expect(fetchMessage(officialInstance, "msg-invalid-payload")).rejects.toThrow(
      PluralKitLookupUnavailableError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getCachedMessageLookup(officialInstance, "msg-invalid-payload")).toBeNull();
  });

  it("sends the configured token verbatim and omits an empty token", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { sender: "token-sender", system: null, member: null }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    process.env.PLURALKIT_API_TOKEN = "fixture-token";
    await fetchMessage(officialInstance, "msg-token-present");
    process.env.PLURALKIT_API_TOKEN = "";
    await fetchMessage(officialInstance, "msg-token-absent");

    expect(new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers).get("Authorization")).toBe(
      "fixture-token",
    );
    expect(
      new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.headers).get("Authorization"),
    ).toBeNull();
  });

  it("retries a 404 (PK indexing lag) and succeeds once the message appears", async () => {
    let calls = 0;
    const fetchMock = mock(async () => {
      calls++;
      if (calls === 1) return jsonResponse(404, {});
      return jsonResponse(200, { original: "555", sender: "666", system: null, member: null });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchMessage(officialInstance, "msg-retry-404");

    expect(calls).toBe(2);
    expect(result?.sender).toBe(snowflake("666"));
  });

  it("honors a sane Retry-After header on 429 before succeeding", async () => {
    let calls = 0;
    const fetchMock = mock(async () => {
      calls++;
      if (calls === 1) return jsonResponse(429, {}, { "Retry-After": "0.05" });
      return jsonResponse(200, { original: "777", sender: "888", system: null, member: null });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const start = Date.now();
    const result = await fetchMessage(officialInstance, "msg-retry-429");

    expect(calls).toBe(2);
    expect(result?.sender).toBe(snowflake("888"));
    // Honored the 50ms header, not the ~800ms first backoff step
    expect(Date.now() - start).toBeLessThan(700);
  });

  it("ignores PK's buggy Retry-After: 0 on 429 and falls back to the backoff schedule", async () => {
    let calls = 0;
    const fetchMock = mock(async () => {
      calls++;
      if (calls === 1) return jsonResponse(429, {}, { "Retry-After": "0" });
      return jsonResponse(200, { original: "777", sender: "888", system: null, member: null });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const start = Date.now();
    const result = await fetchMessage(officialInstance, "msg-retry-429-zero");

    expect(calls).toBe(2);
    expect(result?.sender).toBe(snowflake("888"));
    // A zero header must NOT mean an instant retry against a rate-limited
    // endpoint; the ~800ms first backoff step applies instead. PluralKit's
    // rate limiter is known to send 0 accidentally.
    expect(Date.now() - start).toBeGreaterThanOrEqual(750);
  });

  it("falls back to backoff for malformed Retry-After values", async () => {
    let calls = 0;
    const fetchMock = mock(async () => {
      calls++;
      if (calls === 1) return jsonResponse(429, {}, { "Retry-After": "later" });
      return jsonResponse(200, { original: "777", sender: "888", system: null, member: null });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const start = Date.now();
    const result = await fetchMessage(officialInstance, "msg-retry-429-malformed");

    expect(calls).toBe(2);
    expect(result?.sender).toBe(snowflake("888"));
    expect(Date.now() - start).toBeGreaterThanOrEqual(750);
  });

  it(
    "aborts a stalled attempt in time to recover on a second attempt",
    async () => {
      await withLookupBudget(3000, async () => {
        let calls = 0;
        const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
          calls++;
          if (calls === 1) return stallUntilAborted(init?.signal);
          return jsonResponse(200, { original: "stall-original", sender: "stall-sender", system: null, member: null });
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const start = Date.now();
        const result = await fetchMessage(officialInstance, "msg-stalled-then-valid");
        const elapsed = Date.now() - start;

        expect(calls).toBe(2);
        expect(result?.sender).toBe(snowflake("stall-sender"));
        // The stalled attempt is cut at half the 3000ms budget (1500ms), which is what
        // leaves the ~800ms backoff step and the retry inside the same deadline. A
        // whole-budget attempt would have ended here with no answer at all.
        expect(elapsed).toBeGreaterThanOrEqual(1500);
        expect(elapsed).toBeLessThan(3000);
      });
    },
    RETRY_EXHAUSTION_TIMEOUT_MS,
  );

  it(
    "retries when the first response stalls while reading its body",
    async () => {
      await withLookupBudget(3000, async () => {
        let calls = 0;
        const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
          calls++;
          if (calls === 1) {
            const body = new ReadableStream<Uint8Array>({
              start(controller) {
                init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
              },
            });
            return new Response(body, { status: 200 });
          }
          return jsonResponse(200, { original: "body-original", sender: "body-sender" });
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await fetchMessage(officialInstance, "msg-stalled-body");

        expect(calls).toBe(2);
        expect(result?.sender).toBe(snowflake("body-sender"));
      });
    },
    RETRY_EXHAUSTION_TIMEOUT_MS,
  );

  it(
    "reports an unresolved stall instead of a miss once the whole budget is spent",
    async () => {
      await withLookupBudget(3000, async () => {
        const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) =>
          stallUntilAborted(init?.signal),
        );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const start = Date.now();
        await expect(fetchMessage(officialInstance, "msg-always-stalled")).rejects.toThrow(
          PluralKitLookupUnavailableError,
        );
        const elapsed = Date.now() - start;

        // Two attempts, both bounded by the same overall deadline: the retry does not
        // extend the lookup, and a stalled transport stays distinguishable from a 404.
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(elapsed).toBeLessThan(3600);
      });
    },
    RETRY_EXHAUSTION_TIMEOUT_MS,
  );

  it("reports a refusing API as unavailable rather than a miss", async () => {
    for (const status of [401, 500] as const) {
      const messageId = `msg-status-${status}`;
      const fetchMock = mock(async () => jsonResponse(status, {}));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      await expect(fetchMessage(officialInstance, messageId)).rejects.toThrow(PluralKitLookupUnavailableError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      clearPluralKitApiStateForTests();
    }
  });

  it("stops instead of retrying early when Retry-After leaves no room for another attempt", async () => {
    await withLookupBudget(2000, async () => {
      for (const retryAfterSeconds of ["30", "1.8"] as const) {
        const fetchMock = mock(async () => jsonResponse(429, {}, { "Retry-After": retryAfterSeconds }));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const start = Date.now();
        await expect(fetchMessage(officialInstance, `msg-retry-after-${retryAfterSeconds}`)).rejects.toThrow(
          PluralKitLookupUnavailableError,
        );

        // Honoring the header would leave this 2000ms budget no usable attempt, so the
        // lookup reports the rate limit now rather than retrying before the server
        // allows or holding this admission for two seconds.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(Date.now() - start).toBeLessThan(500);
        clearPluralKitApiStateForTests();
      }
    });
  });

  it(
    "gives up once the retry budget is exhausted and returns null",
    async () => {
      const fetchMock = mock(async () => jsonResponse(404, {}));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const result = await fetchMessage(officialInstance, "msg-exhausted");

      // Every answer was a 404, so PK's last word stands: the message is unknown, not
      // a transport failure. Real backoff sleeps dominate this test, putting it near
      // the 5s default and flaking whenever the shared lane runs under load.
      expect(result).toBeNull();
      expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    },
    RETRY_EXHAUSTION_TIMEOUT_MS,
  );

  it(
    "does not permanently cache a failed lookup — a later call can still succeed",
    async () => {
      const failingFetch = mock(async () => jsonResponse(404, {}));
      globalThis.fetch = failingFetch as unknown as typeof fetch;

      const firstResult = await fetchMessage(officialInstance, "msg-recovers");
      expect(firstResult).toBeNull();

      const succeedingFetch = mock(async () =>
        jsonResponse(200, { original: "999", sender: "aaa", system: null, member: null }),
      );
      globalThis.fetch = succeedingFetch as unknown as typeof fetch;

      const secondResult = await fetchMessage(officialInstance, "msg-recovers");
      expect(secondResult?.sender).toBe(snowflake("aaa"));
      expect(succeedingFetch).toHaveBeenCalledTimes(1);
    },
    RETRY_EXHAUSTION_TIMEOUT_MS,
  );

  it("keeps a transport failure uncached so a later call can still resolve the message", async () => {
    const failingFetch = mock(async () => jsonResponse(401, {}));
    globalThis.fetch = failingFetch as unknown as typeof fetch;

    await expect(fetchMessage(officialInstance, "msg-recovers-after-error")).rejects.toThrow(
      PluralKitLookupUnavailableError,
    );

    const succeedingFetch = mock(async () =>
      jsonResponse(200, { original: "122", sender: "233", system: null, member: null }),
    );
    globalThis.fetch = succeedingFetch as unknown as typeof fetch;

    // The rejected lookup must leave no in-flight or cached entry behind, or every
    // later attempt for this message would fail without touching the network.
    expect((await fetchMessage(officialInstance, "msg-recovers-after-error"))?.sender).toBe(snowflake("233"));
    expect(succeedingFetch).toHaveBeenCalledTimes(1);
  });

  it("caches a successful lookup permanently — a later call never refetches", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(200, { original: "bbb", sender: "ccc", system: null, member: null }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const first = await fetchMessage(officialInstance, "msg-cached");
    const second = await fetchMessage(officialInstance, "msg-cached");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it("serves context cache reads without making another API call", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(200, { original: "cache-original", sender: "cache-sender", system: null, member: null }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const fetched = await fetchMessage(officialInstance, "msg-context-cache");
    const cached = getCachedMessageLookup(officialInstance, "msg-context-cache");

    expect(cached).toEqual(fetched);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("evicts the oldest successful lookup when the cache reaches its cap", async () => {
    const fetchMock = mock(async (request: string | URL | Request) => {
      const messageId = String(request).split("/").at(-1) ?? "missing";
      return jsonResponse(200, { original: messageId, sender: "cache-sender", system: null, member: null });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    for (let index = 0; index <= 2000; index++) {
      await fetchMessage(officialInstance, `msg-lru-${index}`);
    }
    expect(getCachedMessageLookup(officialInstance, "msg-lru-0")).toBeNull();
    expect(getCachedMessageLookup(officialInstance, "msg-lru-2000")?.original).toBe(snowflake("msg-lru-2000"));

    await fetchMessage(officialInstance, "msg-lru-0");
    expect(fetchMock).toHaveBeenCalledTimes(2002);
  });

  it("single-flights concurrent lookups for the same message ID", async () => {
    let resolveResponse: (value: Response) => void = () => {};
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = mock(async () => responsePromise);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const first = fetchMessage(officialInstance, "msg-concurrent");
    const second = fetchMessage(officialInstance, "msg-concurrent");

    resolveResponse(jsonResponse(200, { original: "ddd", sender: "eee", system: null, member: null }));

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual(secondResult);
  });

  it("keeps same-ID lookups separate across approved instances", async () => {
    const custom = {
      serviceId: "pluralkit",
      instanceId: "pluralkit:11111111-2222-4333-8444-555555555555",
      origin: "https://example.org",
    };
    const fetchMock = mock(async (_url: RequestInfo | URL, init?: RequestInit) =>
      jsonResponse(200, {
        original: "111",
        sender: new Headers(init?.headers).get("host") === "example.org" ? "custom-sender" : "official-sender",
        system: null,
        member: null,
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const [official, other] = await Promise.all([
      fetchMessage(officialInstance, "msg-shared"),
      fetchMessage(custom, "msg-shared"),
    ]);
    expect(official?.sender).toBe(snowflake("official-sender"));
    expect(other?.sender).toBe(snowflake("custom-sender"));
    expect(getCachedMessageLookup(officialInstance, "msg-shared")?.sender).toBe(snowflake("official-sender"));
    expect(getCachedMessageLookup(custom, "msg-shared")?.sender).toBe(snowflake("custom-sender"));
  });

  it("refuses a private origin before opening a request", async () => {
    const fetchMock = mock(async () => jsonResponse(200, {}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      fetchMessage(
        {
          serviceId: "pluralkit",
          instanceId: "pluralkit:11111111-2222-4333-8444-555555555555",
          origin: "https://127.0.0.1",
        },
        "msg-private-origin",
      ),
    ).rejects.toThrow(PluralKitLookupUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not follow a lookup redirect", async () => {
    const fetchMock = mock(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://example.org/v2/messages/123456789012345678" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(fetchMessage(officialInstance, "msg-redirect")).rejects.toThrow(PluralKitLookupUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
