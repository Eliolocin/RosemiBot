import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import * as braveService from "@/tools/restAPIs/brave/braveSearchService";
import * as searxngService from "@/tools/restAPIs/searxng/searxngService";
import { BraveEngine } from "@/tools/webSearch/braveEngine";
import { resolveWebSearchToolCapabilities } from "@/tools/webSearch/capabilities";
import {
  DuckDuckGoEngine,
  formatDuckDuckGoResults,
  normalizeDuckDuckGoResultUrl,
  parseDuckDuckGoHtml,
} from "@/tools/webSearch/duckduckgoEngine";
import { SearxngEngine } from "@/tools/webSearch/searxngEngine";
import { WebSearchTool } from "@/tools/webSearch/webSearchTool";
import type { ToolContext } from "@/types/tool/interfaces";
import * as embedHelper from "@/utils/discord/embedHelper";
import * as toolProgressNotice from "@/utils/discord/toolProgressNotice";
import * as remoteFetch from "@/utils/security/userRemoteFetch";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";
import { localizedCopy } from "../../helpers/localeCases";
import { stubLogMembers } from "../../helpers/mockSurface";

stubLogMembers({ warn: () => {}, info: () => {}, success: () => {} });

const block = (href: string, title: string, snippet = "", extraClass = "web-result") =>
  `<div class="result results_links results_links_deep ${extraClass}"><div class="links_main">` +
  `<h2 class="result__title"><a rel="nofollow" class="result__a" href="${href}">${title}</a></h2>` +
  `<a class="result__snippet" href="${href}">${snippet}</a></div></div>`;
const page = (body: string) =>
  `<!DOCTYPE html><html><body><div class="serp__results"><div id="links" class="results">${body}</div></div></body></html>`;

const wrapped = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fguide%3Fa%3D1%26b%3D2&amp;rut=fixture";
const RESULTS_PAGE = page(
  [
    block("https://duckduckgo.com/y.js?ad_domain=ads.example&amp;u3=fixture", "Sponsored", "Ad", "result--ad"),
    block(wrapped, "Example &amp; <b>Guide</b>", "First &lt;snippet&gt; with <b>bold</b> &#x4e2d;"),
    block(wrapped, "Duplicate of the guide", "Same destination"),
    block("https://docs.example.org/page", "Docs &#39;page&#39;", ""),
    block("javascript:alert(1)", "Script link", "Rejected"),
    block("https://user:secret@example.net/", "Userinfo link", "Rejected"),
    block("http://[", "Malformed link", "Rejected"),
    block("https://duckduckgo.com/y.js?u3=https%3A%2F%2Fads.example", "Unlabeled ad", "Rejected"),
    block("ftp://files.example.com/archive", "FTP link", "Rejected"),
  ].join(""),
);
const EMPTY_PAGE = page(
  '<div class="result results_links_deep result--no-result"><div class="no-results">No results.</div></div>',
);
const CHALLENGE_PAGE =
  '<html><body><form id="challenge-form"><div class="anomaly-modal__title">Select all squares</div></form></body></html>';

function manyResults(total: number): string {
  return page(
    Array.from({ length: total }, (_, index) => block(`https://site${index}.example/`, `Result ${index}`)).join(""),
  );
}

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    channel: { id: "fixture-channel" } as ToolContext["channel"],
    client: {} as ToolContext["client"],
    tomoriState: createPersona(),
    locale: "en-US",
    provider: "google",
    suppressProgressNotices: true,
    ...overrides,
  };
}

type FetchCall = { input: string; init?: RequestInit; options?: remoteFetch.FetchUserRemoteUrlOptions };

function stubSearchFetch(respond: (init?: RequestInit) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const spy = spyOn(remoteFetch, "fetchUserRemoteUrl").mockImplementation(async (input, init, options) => {
    calls.push({ input: String(input), init, options });
    return await respond(init);
  });
  return { calls, spy };
}

const urlsFound = (result: { data?: unknown }) => (result.data as { urlsFound?: number } | undefined)?.urlsFound;

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

beforeAll(async () => {
  await initializeLocalizer();
});

describe("DuckDuckGo HTML parsing", () => {
  it("keeps organic results, unwraps click wrappers, and rejects unsafe or duplicate links", async () => {
    expect(await parseDuckDuckGoHtml(RESULTS_PAGE)).toEqual({
      kind: "results",
      results: [
        {
          title: "Example & Guide",
          url: "https://example.com/guide?a=1&b=2",
          snippet: "First <snippet> with bold 中",
        },
        { title: "Docs 'page'", url: "https://docs.example.org/page", snippet: "" },
      ],
    });
  });

  it("separates a genuine empty page from a challenge and from changed markup", async () => {
    expect(await parseDuckDuckGoHtml(EMPTY_PAGE)).toEqual({ kind: "empty" });
    expect(await parseDuckDuckGoHtml(CHALLENGE_PAGE)).toEqual({ kind: "challenge" });
    expect(await parseDuckDuckGoHtml(page('<div class="serp__item">Redesigned result</div>'))).toEqual({
      kind: "malformed",
    });
    // Result blocks whose links all fail validation mean the markup moved, not that nothing matched.
    expect(await parseDuckDuckGoHtml(page(block("javascript:void(0)", "Only bad link")))).toEqual({
      kind: "malformed",
    });
  });

  it("unwraps the click wrapper once and never follows ad routing", () => {
    expect(normalizeDuckDuckGoResultUrl(wrapped)).toBe("https://example.com/guide?a=1&b=2");
    const nested = `//duckduckgo.com/l/?uddg=${encodeURIComponent("https://duckduckgo.com/l/?uddg=https%3A%2F%2Fevil.example")}`;
    expect(normalizeDuckDuckGoResultUrl(nested)).toBeNull();
    expect(normalizeDuckDuckGoResultUrl("//duckduckgo.com/l/?rut=missing-target")).toBeNull();
    expect(normalizeDuckDuckGoResultUrl("//duckduckgo.com/l/?uddg=data%3Atext%2Fhtml%2Cx")).toBeNull();
  });

  it("enforces the public result-count limit", () => {
    const results = Array.from({ length: 25 }, (_, index) => ({
      title: `Result ${index}`,
      url: `https://site${index}.example/`,
      snippet: "",
    }));
    const listed = (count?: number) => formatDuckDuckGoResults("fixture", results, count).match(/https:\/\//g)?.length;
    expect(listed()).toBe(10);
    expect(listed(3)).toBe(3);
    expect(listed(50)).toBe(20);
  });
});

describe("DuckDuckGo engine requests", () => {
  const engine = new DuckDuckGoEngine();
  let restore: Array<{ mockRestore(): void }> = [];

  afterEach(() => {
    for (const spy of restore) spy.mockRestore();
    restore = [];
  });

  it("requests the fixed endpoint with only public headers through the strict guarded fetcher", async () => {
    const { calls, spy } = stubSearchFetch(() => html(RESULTS_PAGE));
    restore.push(spy);
    const longQuery = `${"q".repeat(600)} tail`;

    const result = await engine.search(longQuery, "text", makeContext());

    expect(result.success).toBe(true);
    expect(urlsFound(result)).toBe(2);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].input);
    expect(url.origin + url.pathname).toBe("https://html.duckduckgo.com/html/");
    expect(url.searchParams.get("q")).toHaveLength(500);
    expect(calls[0].options).toEqual({ strict: true });
    expect(Object.keys(calls[0].init?.headers ?? {}).sort()).toEqual(["Accept", "User-Agent"]);
  });

  it("returns a successful empty search for a genuine no-results page", async () => {
    const { spy } = stubSearchFetch(() => html(EMPTY_PAGE));
    restore.push(spy);

    const result = await engine.search("nothing matches", "text", makeContext());

    expect(result.success).toBe(true);
    expect(urlsFound(result)).toBe(0);
  });

  it("caps the listed results at the public count limit", async () => {
    const { spy } = stubSearchFetch(() => html(manyResults(25)));
    restore.push(spy);

    expect(urlsFound(await engine.search("fixture", "text", makeContext()))).toBe(10);
    expect(urlsFound(await engine.search("fixture", "text", makeContext(), 50))).toBe(20);
  });

  for (const [label, response, failure] of [
    ["a 202 challenge status", () => html(CHALLENGE_PAGE, 202), "challenge"],
    ["a challenge page served with 200", () => html(CHALLENGE_PAGE), "challenge"],
    ["rate limiting", () => html("", 429), "rate_limited"],
    ["an upstream error", () => html("", 503), "http_error"],
    ["changed markup", () => html(page('<div class="serp__item">Redesigned</div>')), "malformed"],
  ] as const) {
    it(`reports ${label} as a failure instead of an empty result`, async () => {
      const { spy } = stubSearchFetch(response);
      restore.push(spy);

      const result = await engine.search("fixture", "text", makeContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain(failure);
    });
  }

  it("tells the channel about a challenge with the existing rate-limit notice", async () => {
    const { spy } = stubSearchFetch(() => html(CHALLENGE_PAGE, 202));
    const notice = spyOn(toolProgressNotice, "sendToolNotice").mockResolvedValue();
    const embed = spyOn(embedHelper, "sendStandardEmbed").mockResolvedValue();
    restore.push(spy, notice, embed);

    await engine.search("fixture", "text", makeContext({ suppressProgressNotices: false }));

    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0][2].titleKey).toBe("general.errors.duckduckgo_rate_limit.title");
  });

  it("stops reading an oversized chunked response and cancels its body", async () => {
    let bodyCancelled = false;
    const chunk = new Uint8Array(64 * 1024).fill(0x61);
    const { spy } = stubSearchFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(chunk);
            },
            cancel() {
              bodyCancelled = true;
            },
          }),
          { status: 200, headers: { "content-type": "text/html" } },
        ),
    );
    restore.push(spy);

    const result = await engine.search("fixture", "text", makeContext());

    expect(result.success).toBe(false);
    expect(result.error).toContain("oversized");
    expect(bodyCancelled).toBe(true);
  });

  it("aborts the request when the turn is cancelled", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const { spy } = stubSearchFetch(
      (init) =>
        new Promise<Response>((_, reject) => {
          requestSignal = init?.signal ?? undefined;
          requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), { once: true });
          controller.abort();
        }),
    );
    restore.push(spy);

    await expect(engine.search("fixture", "text", makeContext({ abortSignal: controller.signal }))).rejects.toThrow();
    expect(requestSignal?.aborted).toBe(true);
  });
});

describe("web_search engine chain", () => {
  let restore: Array<{ mockRestore(): void }> = [];

  afterEach(() => {
    for (const spy of restore) spy.mockRestore();
    restore = [];
  });

  function configureBackends(brave: boolean, searxng: boolean) {
    restore.push(
      spyOn(braveService, "isBraveSearchAvailable").mockResolvedValue(brave),
      spyOn(searxngService, "isSearxngAvailable").mockResolvedValue(searxng),
    );
  }

  it("serves text search natively when neither Brave nor SearXNG is configured", async () => {
    configureBackends(false, false);
    const { calls, spy } = stubSearchFetch(() => html(RESULTS_PAGE));
    restore.push(spy);

    const result = await new WebSearchTool().execute({ query: "fixture" }, makeContext());

    expect(result.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(await resolveWebSearchToolCapabilities()).toEqual({ categories: ["text"], engineLabel: "DuckDuckGo" });
  });

  it("prefers a configured Brave key, then SearXNG, before DuckDuckGo", async () => {
    const { calls, spy } = stubSearchFetch(() => html(RESULTS_PAGE));
    const brave = spyOn(BraveEngine.prototype, "search").mockResolvedValue({ success: true, message: "brave" });
    const searxng = spyOn(SearxngEngine.prototype, "search").mockResolvedValue({ success: true, message: "searxng" });
    restore.push(spy, brave, searxng);

    configureBackends(true, true);
    expect((await new WebSearchTool().execute({ query: "fixture" }, makeContext())).message).toBe("brave");
    for (const backend of restore.splice(3)) backend.mockRestore();

    configureBackends(false, true);
    expect((await new WebSearchTool().execute({ query: "fixture" }, makeContext())).message).toBe("searxng");
    expect(calls).toHaveLength(0);
  });

  it("keeps non-text categories behind their configured providers", async () => {
    configureBackends(false, false);
    const { calls, spy } = stubSearchFetch(() => html(RESULTS_PAGE));
    restore.push(spy);

    const result = await new WebSearchTool().execute({ query: "fixture", category: "papers" }, makeContext());

    expect(result.success).toBe(false);
    expect(result.message).toBe(
      localizedCopy("en-US", "tools.search.category_unavailable_description", {
        category: localizedCopy("en-US", "tools.search.category_labels.papers"),
      }),
    );
    expect(calls).toHaveLength(0);
  });

  it("refuses a direct call when the server has web search turned off", async () => {
    configureBackends(false, false);
    const { calls, spy } = stubSearchFetch(() => html(RESULTS_PAGE));
    restore.push(spy);
    const context = makeContext({ tomoriState: createPersona({ config: { web_search_enabled: false } }) });

    const result = await new WebSearchTool().execute({ query: "fixture" }, context);

    expect(result.success).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
