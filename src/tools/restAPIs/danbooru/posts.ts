import type { BaseChannel } from "discord.js";
import {
  DANBOORU_ORIGIN,
  type DanbooruPost,
  type DanbooruRating,
  type DanbooruResult,
  fetchPosts,
} from "@/tools/restAPIs/danbooru/danbooruService";

/** Anonymous searches allow 2 tags, and negations and `order:` count toward it, so filtering happens locally. */
export const MAX_POST_SEARCH_TAGS = 2;
export const MAX_POSTED_IMAGES = 4;
const POST_SEARCH_LIMIT = 20;
/** Keeps random picks among posts other users have upvoted. */
const MIN_POST_SCORE = 3;

// Discord's Community Guidelines keep nudity in age-restricted channels, so q and e stay out of every other channel.
export const DANBOORU_PUBLIC_RATINGS: readonly DanbooruRating[] = ["g", "s"];
const DANBOORU_ALL_RATINGS: readonly DanbooruRating[] = ["g", "s", "q", "e"];

export type DanbooruRatingName = "general" | "sensitive" | "questionable" | "explicit";

export const DANBOORU_RATING_LETTERS: Readonly<Record<DanbooruRatingName, DanbooruRating>> = {
  general: "g",
  sensitive: "s",
  questionable: "q",
  explicit: "e",
};

// Discord prohibits sexualized depictions of minors even in age-restricted channels, so no server setting lifts this.
const DANBOORU_BLOCKED_TAGS: ReadonlySet<string> = new Set(["loli", "shota", "toddlercon"]);

const DANBOORU_CDN_PREFIX = "https://cdn.donmai.us/";
const POSTABLE_FILE_EXTENSIONS: ReadonlySet<string> = new Set(["jpg", "png", "gif", "webp"]);
const POST_PATH_PATTERN = /^\/posts\/(\d{1,12})\/?$/;
const DANBOORU_HOSTNAME = new URL(DANBOORU_ORIGIN).hostname;

export interface PostableImage {
  post: DanbooruPost;
  imageUrl: string;
}

export interface PostSearchResult {
  query: string;
  totalSeen: number;
  images: PostableImage[];
}

/** DMs are never age-restricted, and a thread takes its parent's setting. */
export function isAgeRestrictedChannel(channel: Pick<BaseChannel, "isDMBased" | "isThread">): boolean {
  if (channel.isDMBased()) return false;
  const rated = channel.isThread() ? channel.parent : channel;
  return rated !== null && "nsfw" in rated && rated.nsfw === true;
}

export function allowedRatingsFor(ageRestricted: boolean): readonly DanbooruRating[] {
  return ageRestricted ? DANBOORU_ALL_RATINGS : DANBOORU_PUBLIC_RATINGS;
}

/** Checked on the returned tags rather than negated in the query, because negations count toward the 2-tag limit. */
export function hasBlockedTag(post: DanbooruPost): boolean {
  if (post.rating === "g") return false;
  return post.tag_string_general.split(" ").some((tag) => DANBOORU_BLOCKED_TAGS.has(tag));
}

export function danbooruPostUrl(id: number): string {
  return `${DANBOORU_ORIGIN}/posts/${id}`;
}

/** A bare post ID, or a link whose host is exactly danbooru.donmai.us and whose path is `/posts/{id}`. */
export function parseDanbooruPostReference(input: string): number | null {
  const trimmed = input.trim().replace(/^<(.*)>$/, "$1");
  if (/^\d{1,12}$/.test(trimmed)) return Number(trimmed) || null;

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname !== DANBOORU_HOSTNAME || url.port || url.username || url.password) return null;
  const match = POST_PATH_PATTERN.exec(url.pathname);
  return match ? Number(match[1]) || null : null;
}

/** The tags plus the rating scope, score floor, and deleted-post filter, which Danbooru does not count as tags. */
function buildPostSearchQuery(tags: readonly string[], ratings: readonly DanbooruRating[]): string {
  return [...tags, `rating:${ratings.join(",")}`, `score:>=${MIN_POST_SCORE}`, "-status:deleted"].join(" ");
}

function postableImageUrl(post: DanbooruPost, ratings: readonly DanbooruRating[]): string | null {
  const imageUrl = post.large_file_url ?? post.file_url;
  if (!post.file_url || !imageUrl || post.is_banned) return null;
  if (!post.file_ext || !POSTABLE_FILE_EXTENSIONS.has(post.file_ext)) return null;
  if (!imageUrl.startsWith(DANBOORU_CDN_PREFIX)) return null;
  if (!ratings.includes(post.rating) || hasBlockedTag(post)) return null;
  return imageUrl;
}

/** Up to `count` random posts that pass every image, rating, and blocklist check. */
export function selectPostableImages(
  posts: readonly DanbooruPost[],
  ratings: readonly DanbooruRating[],
  count: number,
): PostableImage[] {
  const candidates = posts.flatMap((post) => {
    const imageUrl = postableImageUrl(post, ratings);
    return imageUrl ? [{ post, imageUrl }] : [];
  });
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, count);
}

/** Searches with Danbooru-form tags already within MAX_POST_SEARCH_TAGS and ratings already cleared for the channel. */
export async function searchDanbooruPosts(
  tags: readonly string[],
  ratings: readonly DanbooruRating[],
  count: number,
  signal?: AbortSignal,
): Promise<DanbooruResult<PostSearchResult>> {
  const query = buildPostSearchQuery(tags, ratings);
  const result = await fetchPosts(query, POST_SEARCH_LIMIT, signal);
  if (!result.ok) return result;
  return {
    ok: true,
    data: { query, totalSeen: result.data.length, images: selectPostableImages(result.data, ratings, count) },
  };
}
