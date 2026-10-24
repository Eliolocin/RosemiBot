import { z } from "zod";
import { DANBOORU_FAILURE_MESSAGES, reportDanbooruFailure } from "@/tools/restAPIs/danbooru/danbooruService";
import {
  type CharacterDescription,
  lookupDanbooruTags,
  normalizeTagQueries,
  type TagCategory,
  type TagLookupResult,
  type TagResolution,
} from "@/tools/restAPIs/danbooru/tagLookup";
import { BaseTool, type ToolContext, type ToolParameterSchema, type ToolResult } from "@/types/tool/interfaces";
import { sendToolNoticeContainer } from "@/utils/discord/expandableEmbedNotice";
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
    "Look up exact Danbooru tags. Turns names, nicknames, typos, and tag guesses into real tags with post counts. For a character or outfit tag it also returns signature tags, named outfits, and a short summary. Call it before an image tool whenever you are unsure of a tag or of how a character looks. Put every name in one call. A corrected or partial match may be a different thing than you meant, so check it against alternatives. A not_found query has no exact tag, but plain descriptive words for it still work in image prompts. A low post_count means the image model knows that tag poorly.";
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
