import { z } from "zod";
import { log } from "@/utils/misc/logger";
import { reportProviderFailure } from "@/utils/provider/providerErrorMetrics";
import { readBoundedResponse, ResponseSizeError } from "@/utils/security/boundedResponse";

export const DANBOORU_ORIGIN = "https://danbooru.donmai.us";

// Required because Danbooru answers 403 with a Cloudflare challenge to requests without a User-Agent.
const USER_AGENT = "TomoriBot/1.0 (+https://github.com/Bredrumb/TomoriBot)";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_FAILURE_DETAIL_CHARS = 500;

/** Requests one tool call may have in flight at once, which keeps a 20-query lookup under Danbooru's rate limit. */
export const DANBOORU_REQUEST_CONCURRENCY = 4;

/**
 * Emoticon tags whose underscore is part of the drawing, so the NovelAI form keeps it.
 * Ceiling: an emoticon missing here renders with a space; add it when a user reports one.
 */
const EMOTICON_TAGS: ReadonlySet<string> = new Set(["^_^", ">_<", "o_o", "x_x", "u_u", "._.", "0_0"]);

/** Converts a Danbooru tag to the spaced form NovelAI prompts use. */
export function toNaiTag(tag: string): string {
  return EMOTICON_TAGS.has(tag) ? tag : tag.replaceAll("_", " ");
}

/** Converts a spaced or underscored tag to the lowercase, underscored form Danbooru requires. */
export function toDanbooruTag(tag: string): string {
  const trimmed = tag.trim().toLowerCase();
  return EMOTICON_TAGS.has(trimmed) ? trimmed : trimmed.replace(/\s+/g, "_");
}

export type DanbooruEndpoint = "autocomplete" | "related_tag" | "wiki_page";

export type DanbooruFailureKind =
  | "refused"
  | "rate_limited"
  | "unavailable"
  | "tag_limit"
  | "not_found"
  | "malformed"
  | "cancelled";

export interface DanbooruFailure {
  kind: DanbooruFailureKind;
  endpoint: DanbooruEndpoint;
  status?: number;
  detail?: string;
}

export type DanbooruResult<T> = { ok: true; data: T } | { ok: false; failure: DanbooruFailure };

/** Model-facing tool errors; Danbooru's own response text stays in the logs. */
export const DANBOORU_FAILURE_MESSAGES: Record<DanbooruFailureKind, string> = {
  refused: "Danbooru refused the request. Tell the user Danbooru is unavailable right now.",
  rate_limited: "Danbooru rate-limited the request. Tell the user to try again in a minute.",
  unavailable: "Danbooru did not respond. Tell the user to try again later.",
  tag_limit: "Danbooru searches allow at most 2 tags. Retry with the 1 or 2 most specific tags.",
  not_found: "Danbooru has no page for that tag.",
  malformed: "Danbooru returned a response TomoriBot could not read.",
  cancelled: "The Danbooru lookup was cancelled.",
};

const EXPECTED_FAILURE_KINDS: ReadonlySet<DanbooruFailureKind> = new Set(["rate_limited", "tag_limit", "cancelled"]);

const autocompleteEntrySchema = z.object({
  type: z.string(),
  value: z.string(),
  category: z.number().int().optional(),
  post_count: z.number().int().optional(),
  antecedent: z.string().nullish(),
});
const autocompleteResponseSchema = z.array(autocompleteEntrySchema);
export type DanbooruAutocompleteEntry = z.infer<typeof autocompleteEntrySchema>;

const relatedTagResponseSchema = z.object({
  related_tags: z.array(z.object({ tag: z.object({ name: z.string() }) })),
});

const wikiPageSchema = z.object({ body: z.string() });

/**
 * One post as requested with an `only=` field list. Restricted posts omit their file URLs, and only the
 * single-post read asks for meta tags.
 */
export const danbooruPostSchema = z.object({
  id: z.number().int(),
  rating: z.enum(["g", "s", "q", "e"]),
  score: z.number().int(),
  source: z.string().optional(),
  file_ext: z.string().optional(),
  is_banned: z.boolean().optional(),
  file_url: z.string().optional(),
  large_file_url: z.string().optional(),
  tag_string_character: z.string(),
  tag_string_copyright: z.string(),
  tag_string_artist: z.string(),
  tag_string_meta: z.string().optional(),
  tag_string_general: z.string(),
});
export type DanbooruPost = z.infer<typeof danbooruPostSchema>;

export const danbooruPostListSchema = z.array(danbooruPostSchema);

const tagLimitErrorSchema = z.object({ error: z.literal("PostQuery::TagLimitError") });

function isTagLimitBody(body: string): boolean {
  try {
    return tagLimitErrorSchema.safeParse(JSON.parse(body)).success;
  } catch {
    return false;
  }
}

function failureForStatus(endpoint: DanbooruEndpoint, status: number, body: string): DanbooruFailure {
  const detail = `HTTP ${status}: ${body.slice(0, MAX_FAILURE_DETAIL_CHARS)}`;
  if (status === 404) return { kind: "not_found", endpoint, status, detail };
  if (status === 429) return { kind: "rate_limited", endpoint, status, detail };
  if (status >= 500) return { kind: "unavailable", endpoint, status, detail };
  if (status === 422 && isTagLimitBody(body)) return { kind: "tag_limit", endpoint, status, detail };
  return { kind: "refused", endpoint, status, detail };
}

async function readText(response: Response, signal: AbortSignal): Promise<string> {
  try {
    return (await readBoundedResponse(response, MAX_RESPONSE_BYTES, signal)).toString("utf8");
  } catch {
    return "";
  }
}

async function danbooruGet<T>(
  endpoint: DanbooruEndpoint,
  path: string,
  params: Record<string, string>,
  schema: z.ZodType<T>,
  externalSignal: AbortSignal | undefined,
): Promise<DanbooruResult<T>> {
  const url = new URL(path, DANBOORU_ORIGIN);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      redirect: "error",
      signal,
    });
  } catch (error) {
    const kind = externalSignal?.aborted ? "cancelled" : "unavailable";
    const outcome = externalSignal?.aborted ? "cancelled" : timeoutSignal.aborted ? "timeout" : "network";
    log.metric("danbooru_request", { endpoint, status: outcome });
    return { ok: false, failure: { kind, endpoint, detail: `${outcome}: ${(error as Error).message}` } };
  }

  log.metric("danbooru_request", { endpoint, status: response.status });
  if (!response.ok) {
    return { ok: false, failure: failureForStatus(endpoint, response.status, await readText(response, signal)) };
  }

  try {
    const body = await readBoundedResponse(response, MAX_RESPONSE_BYTES, signal);
    const parsed = schema.safeParse(JSON.parse(body.toString("utf8")));
    if (parsed.success) return { ok: true, data: parsed.data };
    return { ok: false, failure: { kind: "malformed", endpoint, detail: parsed.error.message } };
  } catch (error) {
    if (externalSignal?.aborted) return { ok: false, failure: { kind: "cancelled", endpoint } };
    const kind = error instanceof ResponseSizeError || error instanceof SyntaxError ? "malformed" : "unavailable";
    return { ok: false, failure: { kind, endpoint, detail: (error as Error).message } };
  }
}

/** Autocomplete over tag names, aliases, and typo corrections. */
export function fetchTagAutocomplete(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<DanbooruResult<DanbooruAutocompleteEntry[]>> {
  return danbooruGet(
    "autocomplete",
    "/autocomplete.json",
    { "search[query]": query, "search[type]": "tag_query", limit: String(limit) },
    autocompleteResponseSchema,
    signal,
  );
}

/**
 * General tags most associated with `tag`, in cosine order, over general and sensitive posts only.
 * The rating scope is fixed so a character's description never draws on explicit posts.
 */
export async function fetchRelatedGeneralTags(
  tag: string,
  limit: number,
  signal?: AbortSignal,
): Promise<DanbooruResult<string[]>> {
  const result = await danbooruGet(
    "related_tag",
    "/related_tag.json",
    {
      "search[query]": `${tag} rating:g,s`,
      "search[category]": "general",
      "search[order]": "Cosine",
      "search[limit]": String(limit),
    },
    relatedTagResponseSchema,
    signal,
  );
  return result.ok ? { ok: true, data: result.data.related_tags.map((entry) => entry.tag.name) } : result;
}

/** The DText body of a tag's wiki page; a tag with no wiki fails with `not_found`. */
export async function fetchWikiBody(tag: string, signal?: AbortSignal): Promise<DanbooruResult<string>> {
  const result = await danbooruGet(
    "wiki_page",
    `/wiki_pages/${encodeURIComponent(tag)}.json`,
    {},
    wikiPageSchema,
    signal,
  );
  return result.ok ? { ok: true, data: result.data.body } : result;
}

/**
 * Logs a Danbooru failure at the point a caller turns it into a tool error or reply.
 * Rate limits, the 2-tag limit, and cancellation are expected refusals.
 */
export async function reportDanbooruFailure(
  failure: DanbooruFailure,
  scope: { operation: string; serverId?: number | null; userId?: number | null },
): Promise<void> {
  await reportProviderFailure({
    summary: "Danbooru request failed",
    errorType: "DanbooruRequestFailed",
    error: undefined,
    expected: EXPECTED_FAILURE_KINDS.has(failure.kind),
    detail: failure.detail,
    serverId: scope.serverId,
    userId: scope.userId,
    dimensions: {
      operation: scope.operation,
      endpoint: failure.endpoint,
      kind: failure.kind,
      status: failure.status ?? "none",
    },
  });
}

/**
 * Runs tasks with at most `limit` in flight. A finishing task hands its slot straight to the next
 * waiter, so a new caller cannot claim it in between and exceed the limit.
 */
export function createRequestLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async (task) => {
    if (active < limit) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
