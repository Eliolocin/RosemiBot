import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { addPresetTargetTypeOption, applyPresetDefault } from "@/commands/persona/default";
import type { UserRow } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  addPresetTargetTypeOption(
    subcommand.setName("default").setDescription(localizer("en-US", "commands.nsfw.persona.default.description")),
  );

/** `/persona default` with NSFW presets listed; the `/nsfw` age restriction is the only gate. */
export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  await applyPresetDefault(client, interaction, userData, locale, { nsfw: true });
}
