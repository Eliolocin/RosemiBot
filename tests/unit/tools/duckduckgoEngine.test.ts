import * as managedProvider from "@/modules/supporter-billing/runtime/managedProvider";
import * as usageStatistics from "@/modules/supporter-billing/runtime/usageStatistics";
import { supporterSpendGuard } from "@/modules/supporter-billing/runtime/spendGuard";
import type { SupporterFundingContext } from "@/modules/supporter-billing/runtime/types";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { OpenrouterToolAdapter } from "@/providers/openrouter/openrouterToolAdapter";
import * as braveService from "@/tools/restAPIs/brave/braveSearchService";
import * as searxngService from "@/tools/restAPIs/searxng/searxngService";
import { BraveEngine } from "@/tools/webSearch/braveEngine";
import { resolveWebSearchToolCapabilities } from "@/tools/webSearch/capabilities";
import { getSearchNoticeKey } from "@/tools/webSearch/categoryMetadata";
import {
  DuckDuckGoEngine,
  formatDuckDuckGoResults,
  normalizeDuckDuckGoResultUrl,
  parseDuckDuckGoHtml,
} from "@/tools/webSearch/duckduckgoEngine";
import { SearxngEngine } from "@/tools/webSearch/searxngEngine";
import { OpenRouterEngine } from "@/tools/webSearch/openrouterEngine";
import { WebSearchTool } from "@/tools/webSearch/webSearchTool";
import type { ToolContext } from "@/types/tool/interfaces";
import * as embedHelper from "@/utils/discord/embedHelper";
import * as toolProgressNotice from "@/utils/discord/toolProgressNotice";
import * as remoteFetch from "@/utils/security/userRemoteFetch";
import * as crypto from "@/utils/security/crypto";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createLlmRow, createPersona } from "../../helpers/fixtures";
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

function openRouterContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return makeContext({
    provider: "openrouter",
    tomoriState: createPersona({
      llm: createLlmRow({ llm_provider: "openrouter", llm_codename: "openai/gpt-4.1-nano" }),
      config: { api_key: Buffer.from("encrypted-fixture"), key_version: 2 },
    }),
    ...overrides,
  });
}

const citation = (url: string, title = "Fixture title", content = "Fixture excerpt") => ({
  type: "url_citation",
  url_citation: { url, title, content },
});
const searchResponse = (annotations: unknown[]) =>
  Response.json({ choices: [{ message: { content: "", annotations }, finish_reason: "length" }] });

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

describe("OpenRouter engine requests", () => {
  const engine = new OpenRouterEngine();
  let restore: Array<{ mockRestore(): void }> = [];

  afterEach(() => {
    for (const spy of restore) spy.mockRestore();
    restore = [];
  });

  function stubOpenRouter(respond: (init?: RequestInit) => Response | Promise<Response>) {
    const decrypt = spyOn(crypto, "decryptApiKey").mockResolvedValue("fixture-api-key");
    const request = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => await respond(init), {
        preconnect: () => undefined,
      }),
    );
    restore.push(decrypt, request);
    return { decrypt, request };
  }

  it("is available only on OpenRouter turns with a saved credential and supports text-like categories", async () => {
    expect(await engine.available(openRouterContext())).toBe(true);
    expect(await engine.available(openRouterContext({ provider: "google" }))).toBe(false);
    expect(await engine.available(openRouterContext({ tomoriState: createPersona() }))).toBe(false);
    for (const category of ["text", "news", "papers", "code"] as const) {
      expect(engine.supportsCategory(category)).toBe(true);
    }
    for (const category of ["image", "video", "files", "music"] as const) {
      expect(engine.supportsCategory(category)).toBe(false);
    }
  });

  it("extracts bounded, unique citations into the summary even when the completion has no text", async () => {
    const { decrypt, request } = stubOpenRouter(() =>
      searchResponse([
        citation("https://example.com/guide", "Guide", "Search excerpt"),
        citation("https://example.com/guide", "Duplicate"),
        citation("javascript:alert(1)", "Script"),
        citation("https://user:secret@example.com/", "Credentials"),
        citation("http://[", "Malformed"),
        { type: "url_citation", url_citation: { url: "https://bad.example/", content: 7 } },
        { type: "other" },
        { type: "url_citation", url_citation: { url: "https://docs.example.org/" } },
        citation("https://extra.example/", "Extra"),
      ]),
    );
    const notice = spyOn(toolProgressNotice, "sendToolNotice").mockResolvedValue();
    restore.push(notice);
    const context = openRouterContext();

    const result = await engine.search("q".repeat(600), "text", context, 2);

    expect(result.success).toBe(true);
    expect(decrypt).toHaveBeenCalledWith(context.tomoriState.config.api_key, 2);
    expect(notice.mock.calls[0][2].titleKey).toBe("tools.search.category_search_title");
    expect(request.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    const init = request.mock.calls[0][1];
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer fixture-api-key",
      ...buildOpenRouterAttributionHeaders(),
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe(context.tomoriState.llm.llm_codename);
    expect(body.stream).toBe(false);
    expect(body.plugins).toEqual([{ id: "web", engine: "exa", max_results: 2 }]);
    expect(body.max_tokens).toBe(1);
    expect(body.messages[0].content).toContain("q".repeat(500));
    expect(body.messages[0].content).not.toContain("q".repeat(501));
    expect(urlsFound(result)).toBe(2);
    const summary = (result.data as { summary: string }).summary;
    for (const expected of [
      "https://example.com/guide",
      "Guide",
      "Search excerpt",
      "https://docs.example.org/",
      "fetch_url",
    ]) {
      expect(summary).toContain(expected);
    }
    for (const rejected of ["Duplicate", "javascript:", "secret", "https://bad.example/", "https://extra.example/"]) {
      expect(summary).not.toContain(rejected);
    }
    expect(result.message).toBe(summary);
  });

  it("funds keyless searches in both scopes, records reported costs before citation validation, and refuses exhausted keys", async () => {
    const member = spyOn(managedProvider, "resolveSupporterMemberKey").mockResolvedValue("synthetic-member-key");
    const decrypt = spyOn(crypto, "decryptApiKey").mockResolvedValue("synthetic-byok-key");
    const record = spyOn(usageStatistics, "recordSupporterUsage").mockImplementation(() => {});
    const begin = spyOn(supporterSpendGuard, "begin").mockResolvedValue(undefined);
    const request = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async () =>
          Response.json({
            id: "synthetic-search",
            usage: { cost: 0.0072, prompt_tokens: 100, completion_tokens: 1 },
            choices: [{ message: { annotations: [] } }],
          }),
        { preconnect: fetch.preconnect },
      ),
    );
    restore.push(member, decrypt, record, begin, request);
    for (const scope of ["personal", "server"] as const) {
      const supporterFunding: SupporterFundingContext = {
        credentialSource: "supporter",
        provider: "openrouter",
        capability: "text",
        modelCodename: "openai/gpt-4.1-nano",
        tierKey: "mochi",
        sponsorIdentityId: 1,
        sponsorDiscordUserId: "synthetic-member",
        entitlementId: 1,
        renewalAt: null,
        ...(scope === "personal"
          ? { fundingScope: "personal", personalUserId: 1, serverId: null, sponsorshipId: null }
          : { fundingScope: "server", personalUserId: null, serverId: 1, sponsorshipId: 1 }),
      };
      const context = openRouterContext({ supporterFunding });
      context.tomoriState.config.api_key = null;
      expect(await engine.available(context)).toBe(true);
      expect((await engine.search("fixture", "text", context)).success).toBe(false);
      expect(record).toHaveBeenLastCalledWith(
        supporterFunding,
        expect.objectContaining({
          costUsd: 0.0072,
          inputTokens: 100,
          outputTokens: 1,
          providerRequestId: "synthetic-search",
        }),
      );
      expect(new Headers(request.mock.calls.at(-1)?.[1]?.headers).get("Authorization")).toBe(
        "Bearer synthetic-member-key",
      );
      begin.mockRejectedValueOnce(new SupporterRequestDeniedError("allowance_exhausted", undefined, "text", scope));
      const sent = request.mock.calls.length;
      expect((await engine.search("fixture", "text", context)).success).toBe(false);
      expect(request.mock.calls).toHaveLength(sent);
    }
    expect(decrypt).not.toHaveBeenCalled();
    const writes = record.mock.calls.length;
    await engine.search("fixture", "text", openRouterContext());
    expect(new Headers(request.mock.calls.at(-1)?.[1]?.headers).get("Authorization")).toBe("Bearer synthetic-byok-key");
    expect(record.mock.calls).toHaveLength(writes + 1);
    expect(record.mock.calls.at(-1)?.[0]).toBeUndefined();
  });

  it("caps result counts and excerpt lengths", async () => {
    const { request } = stubOpenRouter(() =>
      searchResponse(
        Array.from({ length: 25 }, (_, index) =>
          citation(`https://site${index}.example/`, "t".repeat(500), "c".repeat(6000)),
        ),
      ),
    );
    const result = await engine.search("fixture", "text", openRouterContext(), 50);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).plugins[0].max_results).toBe(20);
    expect(urlsFound(result)).toBe(20);
    expect(result.message).not.toContain("t".repeat(301));
    expect(result.message).not.toContain("c".repeat(4001));
  });

  it("fails safely on HTTP errors, missing citations, malformed JSON, and transport errors", async () => {
    const { request } = stubOpenRouter(() => searchResponse([]));
    const embed = spyOn(embedHelper, "sendStandardEmbed").mockResolvedValue();
    restore.push(embed);
    const responders = [
      ...[402, 429, 503].map((status) => () => new Response("fixture-secret-upstream-body", { status })),
      () => searchResponse([]),
      () => Response.json({ choices: [{ message: { content: "Uncited synthesis" } }] }),
      () => searchResponse([citation("ftp://example.com/file")]),
      () => Response.json({ choices: [] }),
      () => new Response("{bad json"),
      () => {
        throw new Error("fixture-secret-upstream-body");
      },
    ];
    for (const respond of responders) {
      request.mockImplementationOnce(Object.assign(async () => respond(), { preconnect: () => undefined }));
      const result = await engine.search("fixture", "text", openRouterContext());
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(JSON.stringify(result)).not.toContain("fixture-secret-upstream-body");
    }
    expect(embed).not.toHaveBeenCalled();
  });

  it("cancels an oversized response instead of reading it indefinitely", async () => {
    let cancelled = false;
    stubOpenRouter(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new Uint8Array(64 * 1024));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    );
    expect((await engine.search("fixture", "text", openRouterContext())).success).toBe(false);
    expect(cancelled).toBe(true);
  });

  it("stops on turn cancellation and on its request deadline", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | null | undefined;
    const { request } = stubOpenRouter(
      (init) =>
        new Promise<Response>((_, reject) => {
          requestSignal = init?.signal;
          requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), { once: true });
          controller.abort();
        }),
    );
    expect(
      (await engine.search("fixture", "text", openRouterContext({ abortSignal: controller.signal }))).success,
    ).toBe(false);
    expect(requestSignal?.aborted).toBe(true);

    const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(
      AbortSignal.abort(new DOMException("", "TimeoutError")),
    );
    restore.push(timeout);
    request.mockClear();
    expect((await engine.search("fixture", "text", openRouterContext())).success).toBe(false);
    expect(timeout.mock.calls[0][0]).toBeGreaterThanOrEqual(1000);
    expect(request).not.toHaveBeenCalled();
  });

  it("emits no progress notice for cancelled turns or failed credential decryption", async () => {
    const { decrypt, request } = stubOpenRouter(() => searchResponse([citation("https://example.com/")]));
    const notice = spyOn(toolProgressNotice, "sendToolNotice").mockResolvedValue();
    restore.push(notice);
    const context = openRouterContext({ suppressProgressNotices: false, abortSignal: AbortSignal.abort() });

    expect((await engine.search("fixture", "text", context)).success).toBe(false);
    expect(decrypt).not.toHaveBeenCalled();
    decrypt.mockRejectedValueOnce(new Error("fixture-decryption-failure"));
    expect(
      (await engine.search("fixture", "text", openRouterContext({ suppressProgressNotices: false }))).success,
    ).toBe(false);
    const controller = new AbortController();
    decrypt.mockImplementationOnce(async () => {
      controller.abort();
      return "fixture-api-key";
    });
    expect(
      (
        await engine.search(
          "fixture",
          "text",
          openRouterContext({ suppressProgressNotices: false, abortSignal: controller.signal }),
        )
      ).success,
    ).toBe(false);
    expect(notice).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
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

  it("tries Brave, SearXNG, OpenRouter, and DuckDuckGo in order until one succeeds", async () => {
    configureBackends(true, true);
    const attempts: string[] = [];
    const brave = spyOn(BraveEngine.prototype, "search").mockImplementation(async () => {
      attempts.push("brave");
      return { success: false };
    });
    const searxng = spyOn(SearxngEngine.prototype, "search").mockImplementation(async () => {
      attempts.push("searxng");
      return { success: false };
    });
    const openrouter = spyOn(OpenRouterEngine.prototype, "search").mockImplementation(async () => {
      attempts.push("openrouter");
      return { success: true, message: "openrouter" };
    });
    const ddg = stubSearchFetch(() => {
      attempts.push("duckduckgo");
      return html(RESULTS_PAGE);
    });
    restore.push(brave, searxng, openrouter, ddg.spy);

    expect((await new WebSearchTool().execute({ query: "fixture" }, openRouterContext())).message).toBe("openrouter");
    expect(attempts).toEqual(["brave", "searxng", "openrouter"]);
    attempts.length = 0;
    openrouter.mockImplementation(async () => {
      attempts.push("openrouter");
      return { success: false };
    });
    expect((await new WebSearchTool().execute({ query: "fixture" }, openRouterContext())).success).toBe(true);
    expect(attempts).toEqual(["brave", "searxng", "openrouter", "duckduckgo"]);
  });

  it("posts one progress notice per 402 fallback and preserves DuckDuckGo's challenge notice", async () => {
    configureBackends(false, false);
    const decrypt = spyOn(crypto, "decryptApiKey").mockResolvedValue("fixture-api-key");
    const request = spyOn(globalThis, "fetch").mockResolvedValue(new Response("credits", { status: 402 }));
    let challenged = false;
    const ddg = stubSearchFetch(() => (challenged ? html(CHALLENGE_PAGE, 202) : html(RESULTS_PAGE)));
    const embed = spyOn(embedHelper, "sendStandardEmbed").mockResolvedValue();
    restore.push(decrypt, request, ddg.spy, embed);
    const context = openRouterContext({ suppressProgressNotices: false });
    context.tomoriState.config.tool_notice_verbosity = "verbose";

    expect((await new WebSearchTool().execute({ query: "fixture" }, context)).success).toBe(true);
    expect(embed).toHaveBeenCalledTimes(1);
    challenged = true;
    expect((await new WebSearchTool().execute({ query: "fixture" }, context)).success).toBe(false);
    const titleKeys = embed.mock.calls.map((call) => call[2].titleKey);
    expect(titleKeys.filter((key) => key === "tools.search.category_search_title")).toHaveLength(2);
    expect(titleKeys.filter((key) => key === "general.errors.duckduckgo_rate_limit.title")).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(ddg.calls).toHaveLength(2);
  });

  it("posts one progress notice while the real Brave, SearXNG, and OpenRouter engines fail over", async () => {
    configureBackends(true, true);
    const brave = spyOn(braveService, "braveWebSearch").mockResolvedValue({ success: false, error: "fixture" });
    const searxng = spyOn(searxngService, "searxngSearch").mockResolvedValue({ success: false, error: "fixture" });
    const decrypt = spyOn(crypto, "decryptApiKey").mockResolvedValue("fixture-api-key");
    const request = spyOn(globalThis, "fetch").mockResolvedValue(new Response("credits", { status: 402 }));
    const ddg = stubSearchFetch(() => html(RESULTS_PAGE));
    const embed = spyOn(embedHelper, "sendStandardEmbed").mockResolvedValue();
    restore.push(brave, searxng, decrypt, request, ddg.spy, embed);
    const context = openRouterContext({ suppressProgressNotices: false });
    context.tomoriState.config.tool_notice_verbosity = "verbose";

    expect((await new WebSearchTool().execute({ query: "fixture" }, context)).success).toBe(true);
    expect(brave).toHaveBeenCalledTimes(1);
    expect(searxng).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(ddg.calls).toHaveLength(1);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it.each([
    "entry",
    "availability",
    "request",
  ] as const)("stops fallback when the turn is cancelled during %s", async (phase) => {
    configureBackends(false, false);
    const controller = new AbortController();
    const available = spyOn(OpenRouterEngine.prototype, "available").mockImplementation(async () => {
      if (phase === "availability") controller.abort();
      return true;
    });
    const decrypt = spyOn(crypto, "decryptApiKey").mockResolvedValue("fixture-api-key");
    const request = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async () => {
          controller.abort();
          throw controller.signal.reason;
        },
        { preconnect: () => undefined },
      ),
    );
    const ddgSearch = spyOn(DuckDuckGoEngine.prototype, "search").mockResolvedValue({ success: true });
    const embed = spyOn(embedHelper, "sendStandardEmbed").mockResolvedValue();
    restore.push(available, decrypt, request, ddgSearch, embed);
    const context = openRouterContext({ suppressProgressNotices: false, abortSignal: controller.signal });
    context.tomoriState.config.tool_notice_verbosity = "verbose";
    if (phase === "entry") controller.abort();

    expect((await new WebSearchTool().execute({ query: "fixture" }, context)).success).toBe(false);
    expect(ddgSearch).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(phase === "request" ? 1 : 0);
    expect(embed).toHaveBeenCalledTimes(phase === "request" ? 1 : 0);
    if (phase === "entry") expect(available).not.toHaveBeenCalled();
  });

  it("fulfills advertised text-like categories through OpenRouter after configured engines fail", async () => {
    configureBackends(true, true);
    const attempts: string[] = [];
    const brave = spyOn(BraveEngine.prototype, "search").mockImplementation(async () => {
      attempts.push("brave");
      return { success: false };
    });
    const searxng = spyOn(SearxngEngine.prototype, "search").mockImplementation(async () => {
      attempts.push("searxng");
      return { success: false };
    });
    const decrypt = spyOn(crypto, "decryptApiKey").mockResolvedValue("fixture-api-key");
    const request = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async () => {
          attempts.push("openrouter");
          return searchResponse([citation("https://example.com/fallback")]);
        },
        { preconnect: () => undefined },
      ),
    );
    const notice = spyOn(toolProgressNotice, "sendToolNotice").mockResolvedValue();
    const ddg = stubSearchFetch(() => html(RESULTS_PAGE));
    restore.push(brave, searxng, decrypt, request, notice, ddg.spy);
    const query = "distributed storage";
    const prompts: string[] = [];

    for (const category of ["news", "papers", "code"] as const) {
      attempts.length = 0;
      const capabilities = await resolveWebSearchToolCapabilities(1, "openrouter");
      expect(capabilities.categories).toContain(category);
      const result = await new WebSearchTool().execute({ query, category }, openRouterContext());
      expect(result.success).toBe(true);
      expect(result.message).toContain("https://example.com/fallback");
      expect(attempts).toEqual(category === "news" ? ["brave", "searxng", "openrouter"] : ["searxng", "openrouter"]);
      const call = notice.mock.calls.at(-1);
      expect(call?.[1]).toBe(getSearchNoticeKey(category));
      expect(call?.[2].titleVars).toEqual({
        category: localizedCopy("en-US", `tools.search.category_labels.${category}`),
        query,
      });
      const prompt: string = JSON.parse(String(request.mock.calls.at(-1)?.[1]?.body)).messages[0].content;
      expect(prompt).toContain(query);
      prompts.push(prompt);
    }
    expect(new Set(prompts).size).toBe(prompts.length);
    expect(ddg.calls).toHaveLength(0);
  });

  it("advertises OpenRouter text search while preserving configured backend categories and priority", async () => {
    configureBackends(false, false);
    const context = openRouterContext();
    const assembled = await new WebSearchTool().assembleForContext({
      provider: context.provider,
      state: { ...context.tomoriState, server_id: "1", activePersonaHasElevenlabsVoice: false },
    });
    expect(assembled?.description).toContain("OpenRouter Search");
    expect(assembled?.parameters.properties.category.enum).toEqual(["text"]);
    for (const backend of restore.splice(0)) backend.mockRestore();
    configureBackends(true, false);
    const brave = await resolveWebSearchToolCapabilities(1, "openrouter");
    expect(brave.engineLabel).toBe("Brave Search");
    expect(brave.categories).toContain("image");
    for (const backend of restore.splice(0)) backend.mockRestore();
    configureBackends(false, true);
    expect((await resolveWebSearchToolCapabilities(1, "openrouter")).categories).toContain("papers");
  });

  it("skips text fallbacks and returns the localized failure when media engines fail", async () => {
    configureBackends(true, true);
    const brave = spyOn(BraveEngine.prototype, "search").mockResolvedValue({ success: false });
    const searxng = spyOn(SearxngEngine.prototype, "search").mockResolvedValue({ success: false });
    const openrouter = spyOn(OpenRouterEngine.prototype, "search").mockResolvedValue({ success: true });
    const { calls, spy } = stubSearchFetch(() => html(RESULTS_PAGE));
    restore.push(brave, searxng, openrouter, spy);

    for (const category of ["image", "video", "files", "music"] as const) {
      const result = await new WebSearchTool().execute({ query: "fixture", category }, openRouterContext());

      expect(result.success).toBe(false);
      const description = localizedCopy("en-US", "tools.search.category_unavailable_description", {
        category: localizedCopy("en-US", `tools.search.category_labels.${category}`),
      });
      expect(result.message).toBe(description);
      expect(new OpenrouterToolAdapter().convertResult(result).content).toContain(description);
    }
    expect(brave).toHaveBeenCalled();
    expect(searxng).toHaveBeenCalled();
    expect(openrouter).not.toHaveBeenCalled();
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
