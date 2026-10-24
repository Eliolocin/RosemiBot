import {
  createRequestLimiter,
  DANBOORU_REQUEST_CONCURRENCY,
  type DanbooruAutocompleteEntry,
  type DanbooruFailure,
  type DanbooruResult,
  fetchRelatedGeneralTags,
  fetchTagAutocomplete,
  fetchWikiBody,
  toDanbooruTag,
  toNaiTag,
} from "@/tools/restAPIs/danbooru/danbooruService";
import { log } from "@/utils/misc/logger";

const MAX_TAG_QUERIES = 20;
const MAX_DESCRIBED_TAGS = 3;
export const MAX_SIGNATURE_TAGS = 25;
export const MAX_SUMMARY_CHARS = 300;
const MAX_ALTERNATIVES = 3;
const AUTOCOMPLETE_LIMIT = 10;
const OUTFIT_AUTOCOMPLETE_LIMIT = 20;
/** Fetched beyond MAX_SIGNATURE_TAGS so dropping `_(cosplay)` tags still leaves a full list. */
const RELATED_TAG_LIMIT = 40;
const SUGGESTION_LIMIT = 20;
const SUGGESTION_CACHE_TTL_MS = 10 * 60_000;
const MAX_AUTOCOMPLETE_CACHE_ENTRIES = 500;

type TagStatus = "exact" | "alias" | "corrected" | "partial" | "not_found";
export type TagCategory = "general" | "artist" | "copyright" | "character" | "meta";

const TAG_CATEGORIES: Readonly<Record<number, TagCategory>> = {
  0: "general",
  1: "artist",
  3: "copyright",
  4: "character",
  5: "meta",
};

/** One query's resolution. Every tag is in spaced NovelAI form. */
export interface TagResolution {
  query: string;
  status: TagStatus;
  tag?: string;
  category?: TagCategory;
  post_count?: number;
  alternatives?: string[];
}

export interface CharacterDescription {
  tag: string;
  signature_tags: string[];
  outfits?: Array<{ tag: string; post_count: number }>;
  cosplay?: { tag: string; post_count: number };
  summary?: string;
}

export interface TagLookupResult {
  results: TagResolution[];
  characters: CharacterDescription[];
}

interface TagEntry {
  type: string;
  value: string;
  category: TagCategory;
  post_count: number;
  antecedent?: string | null;
}

/** Normalizes model-supplied queries to Danbooru form, dropping blanks and duplicates. */
export function normalizeTagQueries(queries: readonly string[]): string[] {
  const normalized = queries.map(toDanbooruTag).filter((query) => query.length > 0);
  return [...new Set(normalized)].slice(0, MAX_TAG_QUERIES);
}

/** Metatag and static suggestions carry no category or post count, so they never resolve a query. */
function toTagEntries(entries: readonly DanbooruAutocompleteEntry[]): TagEntry[] {
  return entries.flatMap((entry) => {
    const category = entry.category === undefined ? undefined : TAG_CATEGORIES[entry.category];
    if (!category || entry.post_count === undefined) return [];
    return [{ ...entry, category, post_count: entry.post_count }];
  });
}

function statusFor(query: string, hit: TagEntry): TagStatus {
  if (hit.type === "tag-autocorrect") return "corrected";
  if (hit.type !== "tag-word") {
    log.warn("Unknown Danbooru autocomplete type", undefined, { metadata: { type: hit.type } });
    return "partial";
  }
  if (hit.antecedent) return "alias";
  return hit.value === query ? "exact" : "partial";
}

/** Maps a query's autocomplete hits to its resolution, using the first hit as the answer. */
export function resolveAutocomplete(query: string, entries: readonly DanbooruAutocompleteEntry[]): TagResolution {
  const [hit, ...rest] = toTagEntries(entries);
  if (!hit) return { query: toNaiTag(query), status: "not_found" };
  const status = statusFor(query, hit);
  const alternatives =
    status === "corrected" || status === "partial"
      ? rest.slice(0, MAX_ALTERNATIVES).map((entry) => toNaiTag(entry.value))
      : [];
  return {
    query: toNaiTag(query),
    status,
    tag: toNaiTag(hit.value),
    category: hit.category,
    post_count: hit.post_count,
    ...(alternatives.length > 0 ? { alternatives } : {}),
  };
}

/** One Danbooru-form query's resolution, without the character description lookupDanbooruTags adds. */
export async function resolveDanbooruTag(query: string, signal?: AbortSignal): Promise<DanbooruResult<TagResolution>> {
  const result = await fetchTagAutocomplete(query, AUTOCOMPLETE_LIMIT, signal);
  return result.ok ? { ok: true, data: resolveAutocomplete(query, result.data) } : result;
}

export interface TagSuggestion {
  tag: string;
  post_count: number;
}

/**
 * Ceiling: the cache lives in one process, so every process warms its own copy. Move it to a shared
 * store when the bot runs as several processes or a measured hit rate shows it missing.
 */
const suggestionCache = new Map<string, { expiresAt: number; suggestions: TagSuggestion[] }>();

/** Tags matching a typed prefix (aliases and typo corrections included) in spaced form, cached by prefix. */
export async function suggestDanbooruTags(
  prefix: string,
  signal?: AbortSignal,
): Promise<DanbooruResult<TagSuggestion[]>> {
  const key = toDanbooruTag(prefix);
  const cached = suggestionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { ok: true, data: cached.suggestions };

  const result = await fetchTagAutocomplete(key, SUGGESTION_LIMIT, signal);
  if (!result.ok) return result;

  const seen = new Set<string>();
  const suggestions = toTagEntries(result.data).flatMap((entry) => {
    if (seen.has(entry.value)) return [];
    seen.add(entry.value);
    return [{ tag: toNaiTag(entry.value), post_count: entry.post_count }];
  });

  // Deleting first moves the key to the end of insertion order, because eviction removes the first key as the oldest.
  suggestionCache.delete(key);
  if (suggestionCache.size >= MAX_AUTOCOMPLETE_CACHE_ENTRIES) {
    const oldest = suggestionCache.keys().next();
    if (!oldest.done) suggestionCache.delete(oldest.value);
  }
  suggestionCache.set(key, { expiresAt: Date.now() + SUGGESTION_CACHE_TTL_MS, suggestions });
  return { ok: true, data: suggestions };
}

/** Related tags in Danbooru's order, minus cosplay tags, which describe other characters' wearers. */
export function shapeSignatureTags(relatedTags: readonly string[]): string[] {
  return relatedTags
    .filter((tag) => !tag.endsWith("_(cosplay)"))
    .slice(0, MAX_SIGNATURE_TAGS)
    .map(toNaiTag);
}

/** Named costume tags for a character, most used first. */
export function shapeOutfits(
  characterTag: string,
  entries: readonly DanbooruAutocompleteEntry[],
): Array<{ tag: string; post_count: number }> {
  const prefix = `${characterTag}_(`;
  return toTagEntries(entries)
    .filter(
      (entry) =>
        entry.category === "character" && entry.value.startsWith(prefix) && entry.value !== `${characterTag}_(cosplay)`,
    )
    .sort((a, b) => b.post_count - a.post_count)
    .map((entry) => ({ tag: toNaiTag(entry.value), post_count: entry.post_count }));
}

/**
 * The character's `_(cosplay)` tag, for drawing someone else dressed as them.
 * Ceiling: the prefix response holds the top 20 tags by post count, so a lower-ranked cosplay tag is
 * missed; widen the request if a popular character lacks one in a live test.
 */
export function findCosplayTag(
  characterTag: string,
  entries: readonly DanbooruAutocompleteEntry[],
): { tag: string; post_count: number } | undefined {
  const cosplay = toTagEntries(entries).find((entry) => entry.value === `${characterTag}_(cosplay)`);
  return cosplay ? { tag: toNaiTag(cosplay.value), post_count: cosplay.post_count } : undefined;
}

/**
 * The wiki's opening prose: text before the first `h4.`-`h6.` header (appearance sections and post
 * embeds follow it), with DText links reduced to their labels and cut at a sentence end.
 */
export function summarizeWikiBody(body: string): string | undefined {
  const intro = body.split(/^h[4-6]\./m)[0] ?? "";
  const text = intro
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MAX_SUMMARY_CHARS) return text || undefined;
  const cut = text.slice(0, MAX_SUMMARY_CHARS);
  const sentenceEnd = cut.lastIndexOf(". ");
  return sentenceEnd > 0 ? cut.slice(0, sentenceEnd + 1) : `${cut.trimEnd()}…`;
}

/**
 * Resolves every query, then describes up to MAX_DESCRIBED_TAGS character tags (costume tags are
 * character tags too). The first failed request stops the requests not yet started.
 */
export async function lookupDanbooruTags(
  queries: readonly string[],
  signal?: AbortSignal,
): Promise<DanbooruResult<TagLookupResult>> {
  const limit = createRequestLimiter(DANBOORU_REQUEST_CONCURRENCY);
  let failure: DanbooruFailure | null = null;
  const request = async <T>(run: () => Promise<DanbooruResult<T>>): Promise<DanbooruResult<T> | null> =>
    limit(async () => {
      if (failure) return null;
      const result = await run();
      if (!result.ok) failure ??= result.failure;
      return result;
    });

  const autocompleted = await Promise.all(
    queries.map((query) => request(() => fetchTagAutocomplete(query, AUTOCOMPLETE_LIMIT, signal))),
  );
  if (failure) return { ok: false, failure };

  const resolvedTags: string[] = [];
  const results = queries.map((query, index) => {
    const response = autocompleted[index];
    const resolution = resolveAutocomplete(query, response?.ok ? response.data : []);
    if (resolution.category === "character" && resolution.tag) resolvedTags.push(toDanbooruTag(resolution.tag));
    return resolution;
  });

  const describedTags = [...new Set(resolvedTags)].slice(0, MAX_DESCRIBED_TAGS);
  const characters = await Promise.all(
    describedTags.map(async (tag): Promise<CharacterDescription> => {
      const [related, outfits, wiki] = await Promise.all([
        request(() => fetchRelatedGeneralTags(tag, RELATED_TAG_LIMIT, signal)),
        request(() => fetchTagAutocomplete(`${tag}_`, OUTFIT_AUTOCOMPLETE_LIMIT, signal)),
        request(async () => {
          const result = await fetchWikiBody(tag, signal);
          return !result.ok && result.failure.kind === "not_found" ? { ok: true as const, data: "" } : result;
        }),
      ]);
      const outfitList = outfits?.ok ? shapeOutfits(tag, outfits.data) : [];
      const cosplay = outfits?.ok ? findCosplayTag(tag, outfits.data) : undefined;
      const summary = wiki?.ok ? summarizeWikiBody(wiki.data) : undefined;
      return {
        tag: toNaiTag(tag),
        signature_tags: related?.ok ? shapeSignatureTags(related.data) : [],
        ...(outfitList.length > 0 ? { outfits: outfitList } : {}),
        ...(cosplay ? { cosplay } : {}),
        ...(summary ? { summary } : {}),
      };
    }),
  );
  if (failure) return { ok: false, failure };

  return { ok: true, data: { results, characters } };
}
