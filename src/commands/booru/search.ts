import {
  type ApplicationCommandOptionChoiceData,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import {
  type DanbooruFailure,
  type DanbooruRating,
  reportDanbooruFailure,
  toDanbooruTag,
} from "@/tools/restAPIs/danbooru/danbooruService";
import {
  allowedRatingsFor,
  DANBOORU_PUBLIC_RATINGS,
  DANBOORU_RATING_LETTERS,
  type DanbooruRatingName,
  isAgeRestrictedChannel,
  MAX_POSTED_IMAGES,
  searchDanbooruPosts,
} from "@/tools/restAPIs/danbooru/posts";
import { resolveDanbooruTag, suggestDanbooruTags } from "@/tools/restAPIs/danbooru/tagLookup";
import type { UserRow } from "@/types/db/schema";
import { buildDanbooruGalleryPayload } from "@/utils/discord/danbooruGalleryMessage";
import { replyInfoEmbed, safeSelectOptionText } from "@/utils/discord/ui/interactionCore";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

const MIN_AUTOCOMPLETE_CHARS = 2;
/** Leaves room inside Discord's 3-second autocomplete window to send the empty answer. */
const AUTOCOMPLETE_TIMEOUT_MS = 2_000;
const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_LENGTH = 100;

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("search")
    .setDescription(localizer("en-US", "commands.booru.search.description"))
    .addStringOption((option) =>
      option
        .setName("tag")
        .setDescription(localizer("en-US", "commands.booru.search.tag_description"))
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName("second_tag")
        .setDescription(localizer("en-US", "commands.booru.search.second_tag_description"))
        .setRequired(false)
        .setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName("rating")
        .setDescription(localizer("en-US", "commands.booru.search.rating_description"))
        .setRequired(false)
        .addChoices(
          { name: localizer("en-US", "commands.booru.search.general_option"), value: "general" },
          { name: localizer("en-US", "commands.booru.search.sensitive_option"), value: "sensitive" },
          { name: localizer("en-US", "commands.booru.search.questionable_option"), value: "questionable" },
          { name: localizer("en-US", "commands.booru.search.explicit_option"), value: "explicit" },
        ),
    );

function ratingsForChoice(choice: string | null): readonly DanbooruRating[] {
  if (choice === null || !Object.hasOwn(DANBOORU_RATING_LETTERS, choice)) return DANBOORU_PUBLIC_RATINGS;
  return [DANBOORU_RATING_LETTERS[choice as DanbooruRatingName]];
}

export async function autocomplete(_client: Client, interaction: AutocompleteInteraction): Promise<void> {
  let choices: ApplicationCommandOptionChoiceData<string>[] = [];
  let failure: DanbooruFailure | null = null;
  const prefix = toDanbooruTag(interaction.options.getFocused());

  if (prefix.length >= MIN_AUTOCOMPLETE_CHARS) {
    const result = await suggestDanbooruTags(prefix, AbortSignal.timeout(AUTOCOMPLETE_TIMEOUT_MS));
    if (result.ok) {
      const numberFormat = new Intl.NumberFormat(interaction.locale);
      choices = result.data
        .filter(({ tag }) => tag.length <= MAX_CHOICE_LENGTH)
        .slice(0, MAX_AUTOCOMPLETE_CHOICES)
        .map(({ tag, post_count }) => ({
          name: safeSelectOptionText(`${tag} (${numberFormat.format(post_count)})`, MAX_CHOICE_LENGTH),
          value: tag,
        }));
    } else {
      failure = result.failure;
    }
  }

  try {
    await interaction.respond(choices);
  } catch {
    // Discord rejects an answer after the 3-second autocomplete window, and an expired autocomplete has no other reply.
  }

  // Reported after answering, so a slow report can never push the answer past Discord's window.
  if (failure) await reportDanbooruFailure(failure, { operation: "booru_autocomplete", expected: true });
}

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const ratings = ratingsForChoice(interaction.options.getString("rating"));
  const channelRatings = allowedRatingsFor(interaction.channel ? isAgeRestrictedChannel(interaction.channel) : false);
  if (ratings.some((rating) => !channelRatings.includes(rating))) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.booru.search.rating_restricted_title",
      descriptionKey: "commands.booru.search.rating_restricted_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const rawTags = [interaction.options.getString("tag", true), interaction.options.getString("second_tag")];
  const typedTags = rawTags.map((tag) => (tag ? toDanbooruTag(tag) : "")).filter((tag) => tag.length > 0);
  // Without a tag the query is only metatags, which would post random images from all of Danbooru.
  if (typedTags.length === 0) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.booru.search.no_results_title",
      descriptionKey: "commands.booru.search.no_results_description",
      descriptionVars: { query: `\`${rawTags[0]}\`` },
      color: ColorCode.WARN,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const reportScope = { operation: "booru_search", userId: userData.user_id ?? null };
  const replyFailure = async (failure: DanbooruFailure) => {
    await reportDanbooruFailure(failure, reportScope);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.booru.search.error_title",
      descriptionKey: "commands.booru.search.error_description",
      color: ColorCode.ERROR,
    });
  };

  const pairs: Array<{ typed: string; tag: string }> = [];
  for (const resolution of await Promise.all(typedTags.map((tag) => resolveDanbooruTag(tag)))) {
    if (!resolution.ok) {
      await replyFailure(resolution.failure);
      return;
    }
    const typed = resolution.data.query;
    const tag = resolution.data.tag ?? typed;
    if (!pairs.some((pair) => pair.tag === tag)) pairs.push({ typed, tag });
  }

  const search = await searchDanbooruPosts(
    pairs.map(({ tag }) => toDanbooruTag(tag)),
    ratings,
    MAX_POSTED_IMAGES,
  );
  if (!search.ok) {
    await replyFailure(search.failure);
    return;
  }

  if (search.data.images.length === 0) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.booru.search.no_results_title",
      descriptionKey: "commands.booru.search.no_results_description",
      descriptionVars: { query: pairs.map(({ tag }) => `\`${tag.replaceAll("`", "'")}\``).join(", ") },
      color: ColorCode.WARN,
    });
    return;
  }

  await interaction.editReply(
    buildDanbooruGalleryPayload(
      locale,
      pairs.map(({ tag }) => tag),
      search.data.images,
      pairs.map(({ typed }) => typed),
    ),
  );
}
