import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { stubLogMembers } from "../../helpers/mockSurface";
import { createOpenRouterCatalog, parseOpenRouterCatalogModelList } from "@/utils/cache/openrouterCatalog";
import { stubGlobalFetch } from "../../helpers/fetchStub";

stubLogMembers({ info: () => undefined, warn: () => undefined, success: () => undefined, error: () => undefined });

interface TestEntry {
  id: string;
}

function jsonResponse(ids: string[]): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ data: ids.map((id) => ({ id })) }),
  } as unknown as Response;
}

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    statusText: "Service Unavailable",
    json: async () => ({}),
  } as unknown as Response;
}

function makeCatalog(settings: { minRefreshIntervalMs?: number; ttlMs?: number } = {}) {
  return createOpenRouterCatalog<TestEntry>({
    label: "test",
    url: "https://openrouter.test/api/v1/models",
    parse: (payload) => parseOpenRouterCatalogModelList("test", payload).map((entry) => ({ id: entry.id })),
    keyOf: (entry) => entry.id,
    ...settings,
  });
}

let fetchSpy: ReturnType<typeof stubGlobalFetch>;

beforeEach(() => {
  fetchSpy = stubGlobalFetch(async () => jsonResponse(["vendor/first"]));
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("OpenRouter catalog refresh", () => {
  it("bounds video discovery and cancels oversized or rejected responses", async () => {
    for (const status of [200, 503]) {
      let cancelled = false;
      fetchSpy.mockImplementation((async (_input, init) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status },
        );
      }) as typeof fetch);
      const catalog = createOpenRouterCatalog({
        label: "video",
        url: "https://openrouter.ai/api/v1/videos/models",
        parse: (payload) => parseOpenRouterCatalogModelList("video", payload),
        keyOf: (entry) => entry.id,
      });
      await catalog.initialize();
      expect(catalog.isReady()).toBe(false);
      expect(cancelled).toBe(true);
    }
  });

  it("finds a model published after the initial load", async () => {
    const catalog = makeCatalog({ minRefreshIntervalMs: 0 });
    await catalog.initialize();

    expect(await catalog.getOrFetch("vendor/published-later")).toBeUndefined();

    fetchSpy.mockImplementation((async (..._args: Parameters<typeof fetch>) =>
      jsonResponse(["vendor/first", "vendor/published-later"])) as typeof fetch);

    expect(await catalog.getOrFetch("vendor/published-later")).toEqual({ id: "vendor/published-later" });
  });

  it("reaches the network after a failed startup fetch instead of staying closed", async () => {
    fetchSpy.mockImplementation((async (..._args: Parameters<typeof fetch>) => errorResponse(503)) as typeof fetch);

    const catalog = makeCatalog({ minRefreshIntervalMs: 0 });
    await catalog.initialize();
    expect(catalog.isReady()).toBe(false);

    fetchSpy.mockImplementation((async (..._args: Parameters<typeof fetch>) =>
      jsonResponse(["vendor/first"])) as typeof fetch);

    expect(await catalog.getOrFetch("vendor/first")).toEqual({ id: "vendor/first" });
    expect(catalog.isReady()).toBe(true);
  });

  it("keeps the cached catalog when a refresh fails", async () => {
    const catalog = makeCatalog({ minRefreshIntervalMs: 0 });
    await catalog.initialize();

    fetchSpy.mockImplementation((async (..._args: Parameters<typeof fetch>) => errorResponse(503)) as typeof fetch);
    await catalog.getOrFetch("vendor/missing");

    expect(catalog.isReady()).toBe(true);
    expect(catalog.get("vendor/first")).toEqual({ id: "vendor/first" });
  });

  it("treats an empty catalog as a failed refresh", async () => {
    const catalog = makeCatalog({ minRefreshIntervalMs: 0 });
    await catalog.initialize();

    fetchSpy.mockImplementation((async (..._args: Parameters<typeof fetch>) => jsonResponse([])) as typeof fetch);
    await catalog.getOrFetch("vendor/missing");

    expect(catalog.size()).toBe(1);
    expect(catalog.get("vendor/first")).toEqual({ id: "vendor/first" });
  });

  it("rate-limits repeated misses to one fetch per cooldown window", async () => {
    const catalog = makeCatalog({ minRefreshIntervalMs: 600000 });
    await catalog.initialize();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await catalog.getOrFetch("vendor/typo");
    await catalog.getOrFetch("vendor/typo");
    await catalog.getOrFetch("vendor/another-typo");

    // The startup fetch opens the window, so misses inside it reuse that catalog rather
    // than re-fetching a snapshot taken moments ago.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("bypasses the cooldown for a fresh lookup", async () => {
    const catalog = makeCatalog({ minRefreshIntervalMs: 600000 });
    await catalog.initialize();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockImplementation((async (..._args: Parameters<typeof fetch>) =>
      jsonResponse(["vendor/first", "vendor/published-later"])) as typeof fetch);

    expect(await catalog.getOrFetch("vendor/published-later")).toBeUndefined();
    expect(await catalog.getOrFetch("vendor/published-later", { fresh: true })).toEqual({
      id: "vendor/published-later",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("refreshes on a fresh lookup even when the codename is already cached", async () => {
    const catalog = makeCatalog({ minRefreshIntervalMs: 600000 });
    await catalog.initialize();

    expect(await catalog.getOrFetch("vendor/first", { fresh: true })).toEqual({ id: "vendor/first" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent misses into a single fetch", async () => {
    const catalog = makeCatalog({ minRefreshIntervalMs: 0 });

    await Promise.all([
      catalog.getOrFetch("vendor/first"),
      catalog.getOrFetch("vendor/first"),
      catalog.getOrFetch("vendor/first"),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("refreshes only once the TTL has elapsed", async () => {
    // Within the freshness window a stale check reuses the snapshot the startup fetch stored.
    const freshCatalog = makeCatalog({ minRefreshIntervalMs: 0, ttlMs: 3600000 });
    await freshCatalog.initialize();

    await freshCatalog.refreshIfStale();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Past it, the same check refreshes. Each catalog carries its own window, so the elapsed
    // case needs its own catalog rather than a mutated shared setting.
    const expiredCatalog = makeCatalog({ minRefreshIntervalMs: 0, ttlMs: 1 });
    await expiredCatalog.initialize();
    await Bun.sleep(2);
    await expiredCatalog.refreshIfStale();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("matches codenames case-insensitively", async () => {
    const catalog = makeCatalog();
    fetchSpy.mockImplementation((async (..._args: Parameters<typeof fetch>) =>
      jsonResponse(["Vendor/Mixed-Case"])) as typeof fetch);
    await catalog.initialize();

    expect(catalog.get("  vendor/MIXED-case ")).toEqual({ id: "vendor/mixed-case" });
  });
});

describe("OpenRouter catalog payload parsing", () => {
  it("skips entries without a usable id", () => {
    expect(
      parseOpenRouterCatalogModelList("embedding", {
        data: [{ id: " Vendor/Embed-1 ", name: "Embed One", description: " " }, { id: "" }, { name: "no id" }],
      }),
    ).toEqual([{ id: "vendor/embed-1", name: "Embed One", description: null }]);
  });

  it("rejects responses without a data array", () => {
    expect(() => parseOpenRouterCatalogModelList("image", { error: "unavailable" })).toThrow("missing data array");
  });
});
