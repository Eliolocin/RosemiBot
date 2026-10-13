import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { executeExpressionsManageCommand } from "@/utils/discord/interactions/expressionsRoutes";
import { localizer } from "@/utils/text/localizer";

export const guildOnly = true;
export const managerOnly = true;
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("manage").setDescription(localizer("en-US", "commands.expressions.manage.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  await executeExpressionsManageCommand(interaction, locale);
}
