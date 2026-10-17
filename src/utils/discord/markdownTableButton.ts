import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ComponentType,
  type Message,
  MessageFlags,
  type Webhook,
} from "discord.js";
import { getCachedRenderedMarkdownTable } from "@/utils/text/markdownTableCache";
import { log } from "@/utils/misc/logger";
import { resolveAuthoringWebhook } from "@/utils/discord/webhook/fallback";
import { localizer } from "@/utils/text/localizer";

/** Custom id carried by every rendered-table "Show Markdown" button. */
const SHOW_MARKDOWN_BUTTON_ID = "markdown_table_show_source";

// Two hours, matching the markdown-table cache TTL: a live button whose cache entry already
// expired would only ever return the expired notice.
const SHOW_MARKDOWN_BUTTON_TIMEOUT_MS = 7_200_000;

/** Discord's per-message content limit, minus room for the ```markdown fence and newlines. */
const MARKDOWN_FENCE_OVERHEAD = 32;
const DISCORD_MESSAGE_CONTENT_LIMIT = 2000;

/**
 * Builds the single-button row attached to a rendered markdown-table image.
 *
 * @param locale - Viewer locale for the button label
 * @param disabled - True to render the button greyed out (used after the collector ends)
 * @returns An action row holding the "Show Markdown" button
 */
export function createShowMarkdownButtonRow(locale: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SHOW_MARKDOWN_BUTTON_ID)
      .setLabel(localizer(locale, "genai.markdown_table.show_button"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

/**
 * Wraps table markdown in a fenced block for the ephemeral reply.
 *
 * @param markdown - Raw markdown table source
 * @returns The fenced block, ready to send as message content
 */
function buildFencedMarkdown(markdown: string): string {
  return `\`\`\`markdown\n${markdown}\n\`\`\``;
}

/**
 * Sends the raw table markdown back to whoever pressed the button, visible only to them.
 *
 * Tables wider than a Discord message go out as a `.md` attachment rather than being
 * truncated, so a half table is useless for the copy/paste the button exists to enable.
 *
 * @param interaction - The button press to respond to
 * @param locale - Viewer locale for the expired notice
 * @param markdown - Cached table source, or null when the cache entry has expired
 */
async function replyWithMarkdownSource(
  interaction: ButtonInteraction,
  locale: string,
  markdown: string | null,
): Promise<void> {
  if (!markdown) {
    await interaction.reply({
      content: localizer(locale, "genai.markdown_table.source_expired"),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const fenced = buildFencedMarkdown(markdown);
  if (fenced.length <= DISCORD_MESSAGE_CONTENT_LIMIT - MARKDOWN_FENCE_OVERHEAD) {
    await interaction.reply({
      content: fenced,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: localizer(locale, "genai.markdown_table.source_attached"),
    files: [new AttachmentBuilder(Buffer.from(markdown, "utf8"), { name: "table.md" })],
    flags: MessageFlags.Ephemeral,
  });
}

async function disableShowMarkdownButton(
  message: Message,
  locale: string,
  webhook?: Webhook,
  threadId?: string,
): Promise<void> {
  const disabledRow = createShowMarkdownButtonRow(locale, true);

  if (message.webhookId) {
    try {
      const author = await resolveAuthoringWebhook(message.channel, message.webhookId, webhook);
      if (!author) throw new Error("Authoring webhook unavailable for markdown button edit");
      await author.editMessage(message.id, {
        components: [disabledRow],
        ...(threadId ? { threadId } : {}),
      });
    } catch (error) {
      log.warn("[MarkdownTable] Failed to disable Show Markdown button via webhook", error);
    }
    return;
  }

  await message
    .edit({ components: [disabledRow] })
    .catch((error: unknown) => log.warn("[MarkdownTable] Failed to disable Show Markdown button", error));
}

/**
 * Attaches the collector that serves table markdown when the button is pressed.
 *
 * The source is read from the shared markdown-table cache on each press rather than being
 * captured here, so a press after the cache TTL degrades to a clear notice instead of
 * pinning every rendered table's source in memory for the collector's whole lifetime.
 *
 * @param message - The message carrying the rendered table and its button
 * @param locale - Viewer locale for button label and notices
 * @param threadId - Thread the message lives in, when applicable
 */
export function attachShowMarkdownCollector(
  message: Message,
  locale: string,
  webhook?: Webhook,
  threadId?: string,
): void {
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: SHOW_MARKDOWN_BUTTON_TIMEOUT_MS,
    filter: (interaction) => interaction.customId === SHOW_MARKDOWN_BUTTON_ID && !interaction.user.bot,
  });

  collector.on("collect", async (interaction) => {
    try {
      await replyWithMarkdownSource(interaction, locale, getCachedRenderedMarkdownTable(message.id));
    } catch (error) {
      log.warn("[MarkdownTable] Show Markdown button reply failed", error as Error);
    }
  });

  collector.on("end", async () => {
    await disableShowMarkdownButton(message, locale, webhook, threadId);
  });
}
