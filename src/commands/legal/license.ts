import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { ColorCode } from "@/utils/misc/logger";
import type { UserRow } from "@/types/db/schema";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("license").setDescription(localizer("en-US", "commands.legal.license.description"));

/**
 * Executes the 'license' command
 * Shows a link to the AGPLv3 LICENSE file on GitHub
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  // Build GitHub URL to LICENSE file (always in root, no locale variation)
  const githubUrl = "https://github.com/Bredrumb/TomoriBot/blob/main/LICENSE";

  const embed = new EmbedBuilder()
    .setTitle(localizer(locale, "commands.legal.license.title"))
    .setDescription(localizer(locale, "commands.legal.license.description_text"))
    .addFields({
      name: localizer(locale, "commands.legal.license.link_title"),
      value: githubUrl,
    })
    .setColor(ColorCode.INFO)
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}
