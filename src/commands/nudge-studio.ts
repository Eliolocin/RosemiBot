import type { ChatInputCommandInteraction, Client, SlashCommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { executeNudgeStudioCommand } from "@/modules/natural-nudges/discord/studioRoutes";
import { localizer } from "@/utils/text/localizer";

export const guildOnly = true;
export const managerOnly = true;

export const configureCommand = (command: SlashCommandBuilder) =>
  command.setName("nudge-studio").setDescription(localizer("en-US", "commands.nudge-studio.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  await executeNudgeStudioCommand(interaction, locale);
}
