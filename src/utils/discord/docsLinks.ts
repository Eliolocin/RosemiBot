import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type MessageActionRowComponentBuilder } from "discord.js";
import { DOCS_BASE_URL, DOCS_ROUTES, buildLocalizedDocsPath } from "@/constants/docsLocales";
import { truncateDiscordText } from "@/utils/text/discordTextLimits";
import { DISCORD_BUTTON_LABEL_MAX } from "@/utils/discord/ui/componentsV2Limits";
import { localizer } from "@/utils/text/localizer";

export { DOCS_ROUTES as DOCS_PATHS };
export type { DocsRoute as DocsPath } from "@/constants/docsLocales";

export const SUPPORT_SERVER_URL = "https://discord.gg/bjCfHm9QsB";

/**
 * Absolute docs URL for a locale-less route from `DOCS_PATHS`.
 *
 * The locale prefix comes from the shared docs locale configuration, so a language whose docs tree
 * does not exist yet links English rather than a route that would 404.
 */
export function buildDocsUrl(locale: string, path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${DOCS_BASE_URL}${buildLocalizedDocsPath(locale, path)}`;
}

export function buildDocsLinkRow(
  locale: string,
  path: string,
  labelKey = "general.docs.open_button_label",
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  // Link buttons render grey by API contract, so an emoji is the only way to add visual weight.
  const button = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setEmoji("✨")
    .setLabel(truncateDiscordText(localizer(locale, labelKey), DISCORD_BUTTON_LABEL_MAX))
    .setURL(buildDocsUrl(locale, path));

  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(button);
}
