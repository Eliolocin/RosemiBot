import type { SlashCommandBuilder } from "discord.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { UserRow } from "@/types/db/schema";
import { localizedStatusTitle } from "@/utils/discord/ui/statusTitle";

export const configureCommand = (command: SlashCommandBuilder) =>
  command.setName("ping").setDescription(localizer("en-US", "commands.ping.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  // Defer reply for timing measurement
  await interaction.deferReply();

  const reply = await interaction.fetchReply();
  const responseTime = reply.createdTimestamp - interaction.createdTimestamp;

  const isLaggy = responseTime > 250;
  const embedColor = isLaggy ? ColorCode.WARN : ColorCode.SUCCESS;

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(localizedStatusTitle(locale, "commands.ping.title", embedColor))
    .setDescription(
      localizer(locale, isLaggy ? "commands.ping.response_slow" : "commands.ping.response_fast", {
        response_time: responseTime,
      }),
    );

  await interaction.editReply({ embeds: [embed] });
}
