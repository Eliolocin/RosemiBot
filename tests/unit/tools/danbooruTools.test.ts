import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { buildDanbooruTagCard, DanbooruSearchTagsTool, MAX_TAG_CARD_CHARS } from "@/tools/functionCalls/danbooruTools";
import {
  DANBOORU_FAILURE_MESSAGES,
  DANBOORU_ORIGIN,
  type DanbooruAutocompleteEntry,
  danbooruPostListSchema,
  danbooruPostSchema,
  fetchTagAutocomplete,
  toDanbooruTag,
  toNaiTag,
} from "@/tools/restAPIs/danbooru/danbooruService";
import {
  findCosplayTag,
  lookupDanbooruTags,
  MAX_SIGNATURE_TAGS,
  MAX_SUMMARY_CHARS,
  resolveAutocomplete,
  shapeOutfits,
  shapeSignatureTags,
  summarizeWikiBody,
  type TagLookupResult,
} from "@/tools/restAPIs/danbooru/tagLookup";
import type { ToolContext } from "@/types/tool/interfaces";
import { processEmbedsFromMessage } from "@/utils/chat/contextEmbeds";
import { buildNoticeContainer } from "@/utils/discord/ui/statusComponents";
import { ColorCode, log } from "@/utils/misc/logger";
import { initializeLocalizer } from "@/utils/text/localizer";
import { stubGlobalFetch } from "../../helpers/fetchStub";
import { createPersona } from "../../helpers/fixtures";
import { expectForEveryLocale, localizedCopy } from "../../helpers/localeCases";
import { stubLogMembers } from "../../helpers/mockSurface";

stubLogMembers({ info: () => undefined, warn: () => undefined, metric: () => undefined });

beforeAll(async () => initializeLocalizer());

const fixture = <T>(name: string): Promise<T> =>
  Bun.file(new URL(`../../fixtures/danbooru/${name}.json`, import.meta.url)).json() as Promise<T>;

const autocomplete = (name: string) => fixture<DanbooruAutocompleteEntry[]>(`autocomplete_${name}`);
const relatedRated = () => fixture<{ related_tags: Array<{ tag: { name: string } }> }>("related_reisalin_stout_rated");
const wiki = () => fixture<{ body: string }>("wiki_reisalin_stout");

const AUTOCOMPLETE_FIXTURES: Record<string, string> = {
  ryza: "ryza",
  half_up_braid: "half_up_braid",
  reisalin_stout_: "reisalin_stout_prefix",
};

interface RecordedRequest {
  url: URL;
  init: RequestInit | undefined;
}

/** Serves the captured responses by endpoint and query, recording every request. */
function stubDanbooru(requests: RecordedRequest[]) {
  return stubGlobalFetch(async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.pathname === "/autocomplete.json") {
      const name = AUTOCOMPLETE_FIXTURES[url.searchParams.get("search[query]") ?? ""];
      return Response.json(name ? await autocomplete(name) : []);
    }
    if (url.pathname === "/related_tag.json") return Response.json(await relatedRated());
    if (url.pathname === "/wiki_pages/reisalin_stout.json") return Response.json(await wiki());
    return new Response("Not found", { status: 404 });
  });
}

let fetchSpy: ReturnType<typeof stubGlobalFetch> | null = null;
afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = null;
});

describe("Danbooru tag form", () => {
  it("round-trips multi-word and costume tags between Danbooru and NovelAI form", () => {
    expect(toNaiTag("reisalin_stout_(tropical_summer)")).toBe("reisalin stout (tropical summer)");
    expect(toDanbooruTag("Reisalin Stout (Tropical Summer)")).toBe("reisalin_stout_(tropical_summer)");
  });

  it("keeps emoticon tags whose underscore is part of the drawing", () => {
    for (const emoticon of ["^_^", ">_<"]) {
      expect(toNaiTag(emoticon)).toBe(emoticon);
      expect(toDanbooruTag(emoticon)).toBe(emoticon);
    }
  });
});

describe("Danbooru response boundary", () => {
  it("accepts the captured single-post and post-list responses", async () => {
    expect(danbooruPostSchema.safeParse(await fixture("post_11218685")).success).toBe(true);
    const posts = danbooruPostListSchema.safeParse(await fixture("posts_reisalin_stout"));
    expect(posts.success).toBe(true);
    expect(posts.data?.length).toBeGreaterThan(0);
  });

  it("rejects a post whose rating is outside Danbooru's four ratings", async () => {
    const post = await fixture<Record<string, unknown>>("post_11218685");

    expect(danbooruPostSchema.safeParse({ ...post, rating: "x" }).success).toBe(false);
  });

  it("maps HTTP 422 TagLimitError to the 2-tag failure and other 422s to a refusal", async () => {
    const tagLimitBody = await Bun.file(
      new URL("../../fixtures/danbooru/tag_limit_three_tags.json", import.meta.url),
    ).text();
    fetchSpy = stubGlobalFetch(() => new Response(tagLimitBody, { status: 422 }));
    const tagLimit = await fetchTagAutocomplete("a b c", 10);
    fetchSpy.mockRestore();
    fetchSpy = stubGlobalFetch(() => Response.json({ success: false, error: "OtherError" }, { status: 422 }));
    const other = await fetchTagAutocomplete("a", 10);

    expect(tagLimit.ok ? null : tagLimit.failure.kind).toBe("tag_limit");
    expect(other.ok ? null : other.failure.kind).toBe("refused");
  });
});

describe("Danbooru autocomplete mapping", () => {
  it.each([
    ["zzzxqqq", "zzzxqqq", "not_found"],
    ["miyagi_shori", "miyagi_shori", "corrected"],
    ["clover_hair_clip", "clover_hair_clip", "corrected"],
    ["ryza", "ryza", "alias"],
    ["kancolle", "kancolle", "alias"],
    ["half_up_braid", "half_up_braid", "exact"],
    ["miku", "miku", "partial"],
    ["sailor_fuku", "sailor_fuku", "partial"],
  ])("maps the %s capture to %s", async (fixtureName, query, status) => {
    const resolution = resolveAutocomplete(query, await autocomplete(fixtureName));

    expect(resolution.status).toBe(status as typeof resolution.status);
    expect(resolution.query).toBe(toNaiTag(query));
    if (status === "not_found") expect(resolution.tag).toBeUndefined();
    else expect(resolution.tag).not.toContain("_");
  });

  it("offers the next hits as alternatives only on corrected and partial matches", async () => {
    expect(resolveAutocomplete("miku", await autocomplete("miku")).alternatives).toEqual([
      "yuki miku",
      "asahina mikuru",
      "nakano miku",
    ]);
    expect(resolveAutocomplete("ryza", await autocomplete("ryza")).alternatives).toBeUndefined();
  });

  it("maps an unknown autocomplete type to partial instead of failing the lookup", async () => {
    const [first, ...rest] = await autocomplete("half_up_braid");

    expect(resolveAutocomplete("half_up_braid", [{ ...first, type: "tag-other" }, ...rest]).status).toBe("partial");
  });
});

describe("Danbooru character description", () => {
  it("keeps cosine order, drops cosplay tags, and trims signature tags", async () => {
    const names = (await relatedRated()).related_tags.map((entry) => entry.tag.name);
    const signature = shapeSignatureTags(names);

    expect(signature).toHaveLength(MAX_SIGNATURE_TAGS);
    expect(signature.slice(0, 3)).toEqual(["red shorts", "star necklace", "round-bottom flask"]);
    expect(signature.some((tag) => tag.includes("cosplay"))).toBe(false);
  });

  it("lists named outfits by post count and returns the cosplay tag separately", async () => {
    const prefixEntries = await autocomplete("reisalin_stout_prefix");
    const outfits = shapeOutfits("reisalin_stout", prefixEntries);

    expect(findCosplayTag("reisalin_stout", prefixEntries)).toEqual({
      tag: "reisalin stout (cosplay)",
      post_count: 97,
    });

    expect(outfits[0]).toEqual({ tag: "reisalin stout (late night alchemist)", post_count: 81 });
    expect(outfits.every((outfit) => outfit.tag.startsWith("reisalin stout ("))).toBe(true);
    expect(outfits.some((outfit) => outfit.tag.includes("cosplay"))).toBe(false);
    expect(outfits.map((outfit) => outfit.post_count)).toEqual(
      outfits.map((outfit) => outfit.post_count).toSorted((a, b) => b - a),
    );
  });

  it("summarizes the wiki intro before the appearance section, without DText links", async () => {
    const summary = summarizeWikiBody((await wiki()).body);

    expect(summary).toBeDefined();
    expect(summary?.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
    expect(summary).toContain("Atelier Ryza");
    expect(summary).not.toContain("[[");
    expect(summary).not.toContain("h4.");
    expect(summary).not.toContain("!post");
  });

  it("describes character tags only, with the fixed rating scope and the required request shape", async () => {
    const requests: RecordedRequest[] = [];
    fetchSpy = stubDanbooru(requests);

    const lookup = await lookupDanbooruTags(["ryza", "half_up_braid"]);

    expect(lookup.ok).toBe(true);
    if (!lookup.ok) return;
    expect(lookup.data.results.map((result) => result.status)).toEqual(["alias", "exact"]);
    expect(lookup.data.characters).toHaveLength(1);
    expect(lookup.data.characters[0]?.tag).toBe("reisalin stout");
    expect(lookup.data.characters[0]?.outfits?.length).toBeGreaterThan(0);
    expect(lookup.data.characters[0]?.cosplay?.tag).toBe("reisalin stout (cosplay)");
    expect(lookup.data.characters[0]?.summary).toBeDefined();

    const describedQueries = requests
      .filter((request) => request.url.pathname !== "/autocomplete.json")
      .map((request) => request.url.searchParams.get("search[query]") ?? request.url.pathname);
    expect(describedQueries.some((query) => query.includes("half_up_braid"))).toBe(false);
    const related = requests.find((request) => request.url.pathname === "/related_tag.json");
    expect(related?.url.searchParams.get("search[query]")).toBe("reisalin_stout rating:g,s");
    expect(related?.url.searchParams.get("search[order]")).toBe("Cosine");

    for (const request of requests) {
      expect(request.url.origin).toBe(DANBOORU_ORIGIN);
      expect(request.init?.redirect).toBe("error");
      expect(new Headers(request.init?.headers).get("User-Agent")).toStartWith("TomoriBot/");
    }
  });
});

describe("danbooru_search_tags tool", () => {
  const context = {
    tomoriState: createPersona(),
    locale: "en-US",
    provider: "google",
    channel: undefined,
    client: {},
  } as unknown as ToolContext;

  it("returns a tool failure and reports it when Danbooru's response fails validation", async () => {
    fetchSpy = stubGlobalFetch(() => Response.json({ unexpected: true }));
    const errorSpy = spyOn(log, "error").mockImplementation(async () => undefined);
    try {
      const result = await new DanbooruSearchTagsTool().execute({ queries: ["ryza"] }, context);

      expect(result).toEqual({ success: false, error: DANBOORU_FAILURE_MESSAGES.malformed });
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("refuses an empty query list before any request", async () => {
    const requests: RecordedRequest[] = [];
    fetchSpy = stubDanbooru(requests);

    const result = await new DanbooruSearchTagsTool().execute({ queries: ["  "] }, context);

    expect(result.success).toBe(false);
    expect(requests).toHaveLength(0);
  });
});

describe("danbooru_tags card", () => {
  const lookup: TagLookupResult = {
    results: [
      { query: "ryza", status: "alias", tag: "reisalin stout", category: "character", post_count: 4637 },
      { query: "zzzxqqq", status: "not_found" },
    ],
    characters: [
      {
        tag: "reisalin stout",
        signature_tags: ["red shorts", "star necklace", "white hat"],
        outfits: [{ tag: "reisalin stout (tropical summer)", post_count: 46 }],
        cosplay: { tag: "reisalin stout (cosplay)", post_count: 97 },
      },
    ],
  };

  it("reaches later turns as a [System: ...] line carrying the signature tags in every locale", () => {
    expectForEveryLocale((locale) => {
      const components = buildNoticeContainer({
        locale,
        color: ColorCode.INFO,
        titleKey: "tools.danbooru.tags_title",
        description: buildDanbooruTagCard(locale, lookup),
        configHint: true,
      });

      const result = processEmbedsFromMessage({
        embeds: [],
        components,
        content: "",
        imageAttachments: [],
        isTomoriAuthoredMessage: true,
        selfDebugEnabled: false,
        tomoriNickname: "Mirri",
      });

      expect(result.processedSystemEmbed).toBe(true);
      expect(result.content).toStartWith(`[System: ${localizedCopy(locale, "tools.danbooru.tags_title")}`);
      expect(result.content).toContain("red shorts, star necklace, white hat");
      expect(result.content).toContain("tropical summer");
      expect(result.content).toContain("reisalin stout (cosplay)");
    });
  });

  it("drops whole character blocks rather than cutting a code block open", () => {
    const longTags = Array.from(
      { length: MAX_SIGNATURE_TAGS },
      (_, index) => `long descriptive signature tag ${index}`,
    );
    const card = buildDanbooruTagCard("en-US", {
      results: lookup.results,
      characters: Array.from({ length: 3 }, (_, index) => ({
        tag: `character ${index}`,
        signature_tags: longTags,
        outfits: Array.from({ length: 16 }, (_, outfit) => ({
          tag: `character ${index} (outfit number ${outfit})`,
          post_count: 100 - outfit,
        })),
      })),
    });

    expect(card.length).toBeLessThanOrEqual(MAX_TAG_CARD_CHARS);
    expect((card.match(/```/g) ?? []).length % 2).toBe(0);
    expect(card).toContain("character 0");
    expect(card).not.toContain("character 2");
  });

  it("keeps query text inside its code span when it contains backticks", () => {
    const card = buildDanbooruTagCard("en-US", {
      results: [{ query: "a`@everyone`b", status: "not_found" }],
      characters: [],
    });

    expect(card).not.toContain("`@everyone`");
  });
});
