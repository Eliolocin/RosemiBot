import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { ComponentType } from "discord.js";
import {
  buildDanbooruTagCard,
  DanbooruGetPostTool,
  DanbooruSearchPostsTool,
  DanbooruSearchTagsTool,
  MAX_TAG_CARD_CHARS,
} from "@/tools/functionCalls/danbooruTools";
import {
  DANBOORU_FAILURE_MESSAGES,
  DANBOORU_ORIGIN,
  type DanbooruAutocompleteEntry,
  type DanbooruPost,
  danbooruPostListSchema,
  danbooruPostSchema,
  fetchTagAutocomplete,
  toDanbooruTag,
  toNaiTag,
} from "@/tools/restAPIs/danbooru/danbooruService";
import {
  isAgeRestrictedChannel,
  MAX_POSTED_IMAGES,
  parseDanbooruPostReference,
  selectPostableImages,
} from "@/tools/restAPIs/danbooru/posts";
import {
  findCosplayTag,
  lookupDanbooruTags,
  MAX_SIGNATURE_TAGS,
  MAX_SUMMARY_CHARS,
  resolveAutocomplete,
  shapeOutfits,
  shapeSignatureTags,
  suggestDanbooruTags,
  summarizeWikiBody,
  type TagLookupResult,
} from "@/tools/restAPIs/danbooru/tagLookup";
import type { ToolContext } from "@/types/tool/interfaces";
import { processEmbedsFromMessage } from "@/utils/chat/contextEmbeds";
import { buildDanbooruGalleryPayload } from "@/utils/discord/danbooruGalleryMessage";
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

const posts = () => fixture<DanbooruPost[]>("posts_reisalin_stout");

const guildChannel = (nsfw: boolean, sent: unknown[] = []) => ({
  id: "channel",
  nsfw,
  isDMBased: () => false,
  isThread: () => false,
  send: async (payload: unknown) => {
    sent.push(payload);
    return { id: "message" };
  },
});
const threadUnder = (parentNsfw: boolean) => ({
  id: "thread",
  isDMBased: () => false,
  isThread: () => true,
  parent: { nsfw: parentNsfw },
});
const dmChannel = { id: "dm", isDMBased: () => true, isThread: () => false };

function contextIn(channel: unknown): ToolContext {
  return {
    tomoriState: createPersona(),
    locale: "en-US",
    provider: "google",
    channel,
    client: {},
    suppressProgressNotices: true,
  } as unknown as ToolContext;
}

describe("Danbooru post references", () => {
  it.each([
    ["11218685", 11218685],
    ["https://danbooru.donmai.us/posts/11218685", 11218685],
    ["https://danbooru.donmai.us/posts/11218685?q=reisalin_stout#comments", 11218685],
    ["<https://danbooru.donmai.us/posts/11218685>", 11218685],
    ["danbooru.donmai.us/posts/11218685", 11218685],
    ["https://safebooru.donmai.us/posts/11218685", null],
    ["https://evil.com/posts/1", null],
    ["https://danbooru.donmai.us.evil.com/posts/1", null],
    ["https://danbooru.donmai.us:8443/posts/1", null],
    ["https://danbooru.donmai.us/posts/1/edit", null],
    ["0", null],
  ])("parses %s as %p", (input, expected) => {
    expect(parseDanbooruPostReference(input)).toBe(expected);
  });

  it("refuses a non-Danbooru link before any request", async () => {
    const requests: RecordedRequest[] = [];
    fetchSpy = stubDanbooru(requests);

    const result = await new DanbooruGetPostTool().execute(
      { post: "https://safebooru.donmai.us/posts/11218685" },
      contextIn(guildChannel(false)),
    );

    expect(result.success).toBe(false);
    expect(requests).toHaveLength(0);
  });
});

describe("Danbooru age-restricted channels", () => {
  it("reads a guild channel's flag, a thread's parent flag, and treats DMs as not age-restricted", () => {
    const failures = [
      ["normal channel", guildChannel(false), false],
      ["age-restricted channel", guildChannel(true), true],
      ["thread under a normal channel", threadUnder(false), false],
      ["thread under an age-restricted channel", threadUnder(true), true],
      ["DM", dmChannel, false],
    ].flatMap(([label, channel, expected]) =>
      isAgeRestrictedChannel(channel as unknown as Parameters<typeof isAgeRestrictedChannel>[0]) === expected
        ? []
        : [label],
    );

    expect(failures).toEqual([]);
  });
});

describe("Danbooru post filtering", () => {
  it("drops posts outside the rating set, with a blocked tag, a non-CDN URL, or an unpostable file", async () => {
    const [base] = await posts();
    const candidates: DanbooruPost[] = [
      { ...base, id: 1, rating: "s" },
      { ...base, id: 2, rating: "q" },
      { ...base, id: 3, rating: "s", tag_string_general: `${base.tag_string_general} loli` },
      { ...base, id: 4, large_file_url: "https://evil.example/sample.jpg" },
      { ...base, id: 5, file_url: undefined, large_file_url: undefined },
      { ...base, id: 6, file_ext: "mp4" },
      { ...base, id: 7, is_banned: true },
    ];

    const picked = selectPostableImages(candidates, ["g", "s"], MAX_POSTED_IMAGES).map(({ post }) => post.id);

    expect(picked).toEqual([1]);
  });

  it("never selects a post with a blocked tag at s, q, or e, even where every rating is allowed", async () => {
    const [base] = await posts();
    const blocked = (["s", "q", "e"] as const).map((rating, index) => ({
      ...base,
      id: index + 1,
      rating,
      tag_string_general: `${base.tag_string_general} shota`,
    }));

    expect(selectPostableImages(blocked, ["g", "s", "q", "e"], MAX_POSTED_IMAGES)).toEqual([]);
  });

  it("picks at most the requested count from what survives", async () => {
    const picked = selectPostableImages(await posts(), ["g", "s"], 3);

    expect(picked).toHaveLength(3);
    expect(new Set(picked.map(({ post }) => post.id)).size).toBe(3);
  });
});

describe("Danbooru gallery", () => {
  it("spoilers every image rated above general and leaves general images open", async () => {
    const [base] = await posts();
    const images = (["g", "s", "q", "e"] as const).map((rating, index) => ({
      post: { ...base, id: index + 1, rating },
      imageUrl: base.large_file_url ?? "",
    }));

    const gallery = buildDanbooruGalleryPayload("en-US", ["reisalin stout"], images).components.find(
      (component) => "type" in component && component.type === ComponentType.MediaGallery,
    ) as { items: Array<{ spoiler?: boolean }> } | undefined;

    expect(gallery?.items.map((item) => item.spoiler)).toEqual([false, true, true, true]);
  });

  it("shows what was typed beside a tag that resolution changed, and only there", async () => {
    const [base] = await posts();
    const images = [{ post: base, imageUrl: base.large_file_url ?? "" }];

    const footer = buildDanbooruGalleryPayload("en-US", ["reisalin stout", "swimsuit"], images, [
      "ryza",
      "swimsuit",
    ]).components.find((component) => "type" in component && component.type === ComponentType.TextDisplay) as
      | { content: string }
      | undefined;

    const resolved = localizedCopy("en-US", "tools.danbooru.gallery_resolved_tag", {
      typed: "ryza",
      tag: "reisalin stout",
    });
    expect(footer?.content).toContain(`${resolved}, \`swimsuit\``);
  });
});

describe("Danbooru tag suggestions", () => {
  it("returns spaced tags and answers a repeated prefix from the cache", async () => {
    const requests: RecordedRequest[] = [];
    fetchSpy = stubDanbooru(requests);

    const first = await suggestDanbooruTags("ryza");
    const second = await suggestDanbooruTags("Ryza ");

    expect(first.ok && first.data[0]).toEqual({ tag: "reisalin stout", post_count: 4637 });
    expect(second).toEqual(first);
    expect(requests).toHaveLength(1);
  });
});

describe("danbooru_search_posts tool", () => {
  it("refuses more than 2 tags and a restricted rating in a normal channel before any request", async () => {
    const requests: RecordedRequest[] = [];
    fetchSpy = stubDanbooru(requests);
    const tool = new DanbooruSearchPostsTool();
    const context = contextIn(guildChannel(false));

    const tooMany = await tool.execute({ tags: ["reisalin stout", "beach", "hat"] }, context);
    const restricted = await tool.execute({ tags: ["reisalin stout"], rating: ["explicit"] }, context);
    const restrictedInDm = await tool.execute(
      { tags: ["reisalin stout"], rating: ["questionable"] },
      contextIn(dmChannel),
    );

    expect(tooMany).toEqual({ success: false, error: DANBOORU_FAILURE_MESSAGES.tag_limit });
    expect(restricted.success).toBe(false);
    expect(restrictedInDm.success).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("sends the encoded query and posts one gallery of CDN images from the persona's channel", async () => {
    const requests: RecordedRequest[] = [];
    const rawUrls: string[] = [];
    fetchSpy = stubGlobalFetch(async (input, init) => {
      rawUrls.push(String(input));
      requests.push({ url: new URL(String(input)), init });
      return Response.json(await posts());
    });
    const sent: Array<{ components: Array<{ type: ComponentType; items?: Array<{ media: { url: string } }> }> }> = [];

    const result = await new DanbooruSearchPostsTool().execute(
      { tags: ["Reisalin Stout"] },
      contextIn(guildChannel(false, sent)),
    );

    expect(result.success).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url.searchParams.get("tags")).toBe("reisalin_stout rating:g,s score:>=3 -status:deleted");
    expect(rawUrls[0]).toContain("score%3A%3E%3D3");
    expect(requests[0]?.init?.redirect).toBe("error");

    expect(sent).toHaveLength(1);
    const gallery = sent[0]?.components.find((component) => component.type === ComponentType.MediaGallery);
    expect(gallery?.items).toHaveLength(MAX_POSTED_IMAGES);
    expect(gallery?.items?.every((item) => item.media.url.startsWith("https://cdn.donmai.us/"))).toBe(true);
    const shape = JSON.parse(result.message ?? "{}") as { status: string; posted: Array<{ characters: string[] }> };
    expect(shape.status).toBe("posted");
    expect(shape.posted.every((post) => post.characters.includes("reisalin stout"))).toBe(true);
  });

  it("posts nothing when no post survives the filters", async () => {
    const [base] = await posts();
    fetchSpy = stubGlobalFetch(() => Response.json([{ ...base, rating: "q" }]));
    const sent: unknown[] = [];

    const result = await new DanbooruSearchPostsTool().execute(
      { tags: ["reisalin stout"] },
      contextIn(guildChannel(false, sent)),
    );

    expect(JSON.parse(result.message ?? "{}").status).toBe("no_results");
    expect(sent).toHaveLength(0);
  });
});

describe("danbooru_get_post tool", () => {
  const readPost = async (rating: DanbooruPost["rating"], channel: unknown, extraGeneral = "") => {
    const post = await fixture<DanbooruPost>("post_11218685");
    fetchSpy = stubGlobalFetch(() =>
      Response.json({ ...post, rating, tag_string_general: `${post.tag_string_general}${extraGeneral}` }),
    );
    const result = await new DanbooruGetPostTool().execute({ post: "11218685" }, contextIn(channel));
    fetchSpy.mockRestore();
    fetchSpy = null;
    return JSON.parse(result.message ?? "{}") as { status: string; rating?: string; tags?: Record<string, string[]> };
  };

  it("returns grouped NovelAI-form tags for g and s posts in a normal channel", async () => {
    for (const rating of ["g", "s"] as const) {
      const shape = await readPost(rating, guildChannel(false));

      expect(shape.status).toBe("read");
      expect(shape.tags?.character).toEqual(["miyagi shiori", "sendai hazuki"]);
      expect(shape.tags?.general).toContain("half up braid");
    }
  });

  it("withholds tags of q and e posts outside age-restricted channels and shows them inside", async () => {
    for (const rating of ["q", "e"] as const) {
      expect(await readPost(rating, guildChannel(false))).toEqual({
        status: "rating_restricted",
        rating: rating === "q" ? "questionable" : "explicit",
      });
      expect((await readPost(rating, threadUnder(true))).status).toBe("read");
    }
  });

  it("withholds tags of a non-g post with a blocked tag in every channel", async () => {
    expect(await readPost("e", guildChannel(true), " loli")).toEqual({ status: "blocked" });
    expect(await readPost("s", guildChannel(false), " toddlercon")).toEqual({ status: "blocked" });
  });
});
