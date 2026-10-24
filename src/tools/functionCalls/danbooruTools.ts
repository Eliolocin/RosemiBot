import type { Message } from "discord.js";
import { z } from "zod";
import {
  DANBOORU_FAILURE_MESSAGES,
  type DanbooruRating,
  fetchPost,
  reportDanbooruFailure,
  toDanbooruTag,
  toNaiTag,
} from "@/tools/restAPIs/danbooru/danbooruService";
import {
  allowedRatingsFor,
  DANBOORU_PUBLIC_RATINGS,
  danbooruPostUrl,
  hasBlockedTag,
  isAgeRestrictedChannel,
  MAX_POST_SEARCH_TAGS,
  MAX_POSTED_IMAGES,
  parseDanbooruPostReference,
  searchDanbooruPosts,
} from "@/tools/restAPIs/danbooru/posts";
import {
  type CharacterDescription,
  lookupDanbooruTags,
  normalizeTagQueries,
  type TagCategory,
  type TagLookupResult,
  type TagResolution,
} from "@/tools/restAPIs/danbooru/tagLookup";
import { BaseTool, type ToolContext, type ToolParameterSchema, type ToolResult } from "@/types/tool/interfaces";
import { buildDanbooruGalleryPayload, type DanbooruGalleryPayload } from "@/utils/discord/danbooruGalleryMessage";
import { sendToolNoticeContainer } from "@/utils/discord/expandableEmbedNotice";
import { sendToolProgressNotice } from "@/utils/discord/toolProgressNotice";
import { sendPersonaPostViaWebhook } from "@/utils/discord/webhook/personaPost";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

/** Stays under Discord's 4000-character text display limit with room for the title and footer. */
export const MAX_TAG_CARD_CHARS = 3500;

const INVALID_QUERIES_ERROR = "Pass queries as a list of 1 to 20 character names, outfit names, or tags.";

const searchTagsInputSchema = z.object({ queries: z.array(z.string()).min(1) });

const CATEGORY_LABEL_KEYS: Readonly<Record<TagCategory, string>> = {
  general: "tools.danbooru.category_general",
  artist: "tools.danbooru.category_artist",
  copyright: "tools.danbooru.category_copyright",
  character: "tools.danbooru.category_character",
  meta: "tools.danbooru.category_meta",
};

/** Backticks would close the card's code spans, letting tag text escape them. */
function codeSafe(text: string): string {
  return text.replaceAll("`", "'");
}

function formatResolutionLine(locale: string, resolution: TagResolution, formatCount: (n: number) => string): string {
  if (!resolution.tag || !resolution.category || resolution.post_count === undefined) {
    return localizer(locale, "tools.danbooru.tag_line_not_found", { query: codeSafe(resolution.query) });
  }
  const vars = {
    query: codeSafe(resolution.query),
    tag: codeSafe(resolution.tag),
    category: localizer(locale, CATEGORY_LABEL_KEYS[resolution.category]),
    post_count: formatCount(resolution.post_count),
  };
  return resolution.tag === resolution.query
    ? localizer(locale, "tools.danbooru.tag_line_exact", vars)
    : localizer(locale, "tools.danbooru.tag_line_resolved", vars);
}

function formatCharacterSection(
  locale: string,
  character: CharacterDescription,
  formatCount: (n: number) => string,
): string | null {
  const outfits = character.outfits ?? [];
  if (character.signature_tags.length === 0 && outfits.length === 0 && !character.cosplay) return null;
  const lines = [localizer(locale, "tools.danbooru.signature_heading", { tag: codeSafe(character.tag) })];
  if (character.signature_tags.length > 0) {
    lines.push(`\`\`\`\n${codeSafe(character.signature_tags.join(", "))}\n\`\`\``);
  }
  if (outfits.length > 0) {
    const costumePrefix = `${character.tag} (`;
    const outfitList = outfits
      .map(({ tag, post_count }) => {
        const name = tag.startsWith(costumePrefix) && tag.endsWith(")") ? tag.slice(costumePrefix.length, -1) : tag;
        return `\`${codeSafe(name)}\` (${formatCount(post_count)})`;
      })
      .join(", ");
    lines.push(localizer(locale, "tools.danbooru.outfits_line", { outfits: outfitList }));
  }
  if (character.cosplay) {
    lines.push(
      localizer(locale, "tools.danbooru.cosplay_line", {
        tag: codeSafe(character.cosplay.tag),
        post_count: formatCount(character.cosplay.post_count),
      }),
    );
  }
  return lines.join("\n");
}

/**
 * The card body: one line per query, then one block per described character. Blocks that would
 * pass MAX_TAG_CARD_CHARS are left out whole, so a code block is never cut open.
 */
export function buildDanbooruTagCard(locale: string, lookup: TagLookupResult): string {
  const numberFormat = new Intl.NumberFormat(locale);
  const formatCount = (n: number) => numberFormat.format(n);
  const blocks = [
    ...lookup.results.map((resolution) => formatResolutionLine(locale, resolution, formatCount)),
    ...lookup.characters.flatMap((character) => {
      const section = formatCharacterSection(locale, character, formatCount);
      return section ? [`\n${section}`] : [];
    }),
  ];

  let body = "";
  for (const block of blocks) {
    const next = body ? `${body}\n${block}` : block;
    if (next.length > MAX_TAG_CARD_CHARS) break;
    body = next;
  }
  return body;
}

async function sendTagCard(context: ToolContext, lookup: TagLookupResult): Promise<void> {
  if (!context.channel) return;
  try {
    await sendToolNoticeContainer(context, "danbooru_tags", {
      titleKey: "tools.danbooru.tags_title",
      description: buildDanbooruTagCard(context.locale, lookup),
      color: ColorCode.INFO,
    });
  } catch (error) {
    log.warn("Failed to send the Danbooru tag lookup notice", error as Error);
  }
}

export class DanbooruSearchTagsTool extends BaseTool {
  name = "danbooru_search_tags";
  description =
    "Look up exact Danbooru tags. Turns names, nicknames, typos, and tag guesses into real tags with post counts. For a character or outfit tag it also returns signature tags, named outfits, and a short summary. Call it before an image tool or danbooru_search_posts whenever you are unsure of a tag or of how a character looks. Put every name in one call. A corrected or partial match may be a different thing than you meant, so check it against alternatives. A not_found query has no exact tag, but plain descriptive words for it still work in image prompts. A low post_count means the image model knows that tag poorly.";
  category = "utility" as const;
  requiresFeatureFlag = "danbooru";
  requiresFollowUp = true;

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      queries: {
        type: "array",
        items: { type: "string" },
        description:
          "Up to 20 character names, nicknames, series, outfit names, or tag guesses, e.g. ['ryza', 'clover hair clip']. Spaces or underscores both work.",
      },
    },
    required: ["queries"],
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const parsed = searchTagsInputSchema.safeParse(args);
    const queries = parsed.success ? normalizeTagQueries(parsed.data.queries) : [];
    if (queries.length === 0) return { success: false, error: INVALID_QUERIES_ERROR };

    const lookup = await lookupDanbooruTags(queries, context.abortSignal);
    if (!lookup.ok) {
      await reportDanbooruFailure(lookup.failure, {
        operation: "search_tags",
        serverId: context.tomoriState.server_id,
        userId: context.internalUserId ?? null,
      });
      return { success: false, error: DANBOORU_FAILURE_MESSAGES[lookup.failure.kind] };
    }

    await sendTagCard(context, lookup.data);
    const message = JSON.stringify(lookup.data);
    return { success: true, message, data: { status: "tags_resolved", summary: message } };
  }
}

type RatingName = "general" | "sensitive" | "questionable" | "explicit";

const RATING_NAMES: Readonly<Record<DanbooruRating, RatingName>> = {
  g: "general",
  s: "sensitive",
  q: "questionable",
  e: "explicit",
};

const RATING_LETTERS: Readonly<Record<RatingName, DanbooruRating>> = {
  general: "g",
  sensitive: "s",
  questionable: "q",
  explicit: "e",
};

const INVALID_POST_REFERENCE_ERROR = "That is not a Danbooru post ID or danbooru.donmai.us/posts/ link.";
const INVALID_POST_SEARCH_ERROR = "Pass tags as a list of 1 or 2 Danbooru tags.";
const RESTRICTED_RATING_ERROR =
  "questionable and explicit results are only allowed in age-restricted channels. Retry with general or sensitive, or tell the user to use an age-restricted channel.";
const GALLERY_SEND_ERROR = "The Danbooru images could not be posted to the chat.";

const ratingNameSchema = z.enum(["general", "sensitive", "questionable", "explicit"]);
const searchPostsInputSchema = z.object({
  tags: z.array(z.string()).min(1),
  rating: z.union([z.array(ratingNameSchema), ratingNameSchema.transform((rating) => [rating])]).optional(),
  count: z.number().optional(),
});
const getPostInputSchema = z.object({ post: z.union([z.string(), z.number().transform(String)]) });

function splitTags(tagString: string | undefined): string[] {
  return tagString ? tagString.split(" ").filter(Boolean).map(toNaiTag) : [];
}

function toolResult(shape: { status: string } & Record<string, unknown>): ToolResult {
  const message = JSON.stringify(shape);
  return { success: true, message, data: { status: shape.status, summary: message } };
}

async function sendGallery(context: ToolContext, payload: DanbooruGalleryPayload): Promise<Message> {
  const threadId =
    "isThread" in context.channel && typeof context.channel.isThread === "function" && context.channel.isThread()
      ? context.channel.id
      : undefined;
  if (context.webhook && context.personaUsername) {
    return await sendPersonaPostViaWebhook(
      context.webhook,
      { ...payload, withComponents: true, ...(threadId ? { threadId } : {}) },
      {
        username: context.personaUsername,
        avatarUrl: context.personaAvatarUrl,
        personaId: context.tomoriState.persona_id,
      },
      context.channel,
    );
  }
  return await context.channel.send(payload);
}

export class DanbooruGetPostTool extends BaseTool {
  name = "danbooru_get_post";
  description =
    "Read the tags of one Danbooru post, grouped into character, copyright, artist, meta, and general. Use it when someone shares a Danbooru post link or asks what a post is tagged with. Returns text only.";
  category = "utility" as const;
  requiresFeatureFlag = "danbooru";
  requiresFollowUp = true;

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      post: {
        type: "string",
        description: "A post ID such as '11218685', or a danbooru.donmai.us/posts/ link.",
      },
    },
    required: ["post"],
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const parsed = getPostInputSchema.safeParse(args);
    const id = parsed.success ? parseDanbooruPostReference(parsed.data.post) : null;
    if (id === null) return { success: false, error: INVALID_POST_REFERENCE_ERROR };

    await sendToolProgressNotice(
      context,
      "web_fetch",
      {
        titleKey: "tools.danbooru.post_title",
        titleVars: { id: String(id) },
        description: localizer(context.locale, "tools.danbooru.post_description", { url: danbooruPostUrl(id) }),
        color: ColorCode.INFO,
      },
      "DanbooruGetPostTool",
    );

    const result = await fetchPost(id, context.abortSignal);
    if (!result.ok) {
      await reportDanbooruFailure(result.failure, {
        operation: "get_post",
        serverId: context.tomoriState.server_id,
        userId: context.internalUserId ?? null,
      });
      return { success: false, error: DANBOORU_FAILURE_MESSAGES[result.failure.kind] };
    }

    const post = result.data;
    const rating = RATING_NAMES[post.rating];
    if (!allowedRatingsFor(isAgeRestrictedChannel(context.channel)).includes(post.rating)) {
      return toolResult({ status: "rating_restricted", rating });
    }
    if (hasBlockedTag(post)) return toolResult({ status: "blocked" });

    return toolResult({
      status: "read",
      id: post.id,
      rating,
      score: post.score,
      ...(post.source ? { source: post.source } : {}),
      tags: {
        character: splitTags(post.tag_string_character),
        copyright: splitTags(post.tag_string_copyright),
        artist: splitTags(post.tag_string_artist),
        meta: splitTags(post.tag_string_meta),
        general: splitTags(post.tag_string_general),
      },
    });
  }
}

export class DanbooruSearchPostsTool extends BaseTool {
  name = "danbooru_search_posts";
  description =
    "Post up to 4 existing images from Danbooru into the chat as you. Use it when someone wants to see existing art rather than new art. Danbooru allows only 2 tags per search, so pass the 1 or 2 most specific tags (usually the character or series), checked with danbooru_search_tags if unsure. Results are random picks among well-rated posts.";
  category = "utility" as const;
  requiresFeatureFlag = "danbooru";
  requiresFollowUp = true;

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      tags: {
        type: "array",
        items: { type: "string" },
        description: "1 or 2 Danbooru tags, e.g. ['reisalin stout'] or ['hatsune miku', 'beach'].",
      },
      rating: {
        type: "array",
        items: { type: "string", enum: ["general", "sensitive", "questionable", "explicit"] },
        description:
          "Ratings to include. Default ['general', 'sensitive']. questionable and explicit work only in age-restricted channels.",
      },
      count: {
        type: "number",
        description: "How many images to post, 1-4. Default 4.",
      },
    },
    required: ["tags"],
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const parsed = searchPostsInputSchema.safeParse(args);
    if (!parsed.success) return { success: false, error: INVALID_POST_SEARCH_ERROR };
    const tags = [...new Set(parsed.data.tags.map(toDanbooruTag).filter((tag) => tag.length > 0))];
    if (tags.length === 0) return { success: false, error: INVALID_POST_SEARCH_ERROR };
    if (tags.length > MAX_POST_SEARCH_TAGS) return { success: false, error: DANBOORU_FAILURE_MESSAGES.tag_limit };

    const ratings = parsed.data.rating
      ? [...new Set(parsed.data.rating.map((name) => RATING_LETTERS[name]))]
      : DANBOORU_PUBLIC_RATINGS;
    const channelRatings = allowedRatingsFor(isAgeRestrictedChannel(context.channel));
    if (ratings.some((rating) => !channelRatings.includes(rating))) {
      return { success: false, error: RESTRICTED_RATING_ERROR };
    }
    const count = Math.min(MAX_POSTED_IMAGES, Math.max(1, Math.trunc(parsed.data.count ?? MAX_POSTED_IMAGES)));

    const search = await searchDanbooruPosts(tags, ratings, count, context.abortSignal);
    if (!search.ok) {
      await reportDanbooruFailure(search.failure, {
        operation: "search_posts",
        serverId: context.tomoriState.server_id,
        userId: context.internalUserId ?? null,
      });
      return { success: false, error: DANBOORU_FAILURE_MESSAGES[search.failure.kind] };
    }

    const { query, totalSeen, images } = search.data;
    if (images.length === 0) return toolResult({ status: "no_results", query });
    if (context.abortSignal?.aborted) return { success: false, error: DANBOORU_FAILURE_MESSAGES.cancelled };

    try {
      await sendGallery(context, buildDanbooruGalleryPayload(context.locale, tags.map(toNaiTag), images));
    } catch (error) {
      log.error("Failed to post the Danbooru gallery", error as Error, {
        serverId: context.tomoriState.server_id,
        metadata: { imageCount: images.length },
      });
      return { success: false, error: GALLERY_SEND_ERROR };
    }

    return toolResult({
      status: "posted",
      query,
      total_seen: totalSeen,
      posted: images.map(({ post }) => ({
        id: post.id,
        rating: RATING_NAMES[post.rating],
        score: post.score,
        characters: splitTags(post.tag_string_character),
        copyright: splitTags(post.tag_string_copyright),
        artist: splitTags(post.tag_string_artist),
      })),
    });
  }
}
