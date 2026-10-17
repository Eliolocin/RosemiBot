import {
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { buildInitialPersonalConfigPanel } from "@/utils/discord/interactions/personalConfigRoutes";
import { deliverGuardedPanel } from "@/utils/discord/interactions/panelController";
import { localizer } from "@/utils/text/localizer";
import {
  autocompleteManagedIdentity,
  parseIdentityOption,
} from "@/utils/discord/interactions/managedIdentityPanelRoutes";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("config")
    .setDescription(localizer("en-US", "commands.personal.config.description"))
    .addStringOption((option) =>
      option
        .setName("identity")
        .setDescription(localizer("en-US", "commands.personal.config.identity_description"))
        .setAutocomplete(true),
    );

export async function autocomplete(_client: Client, interaction: AutocompleteInteraction): Promise<void> {
  await autocompleteManagedIdentity(interaction);
}

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rawIdentity = interaction.options.getString("identity");
  const identityId = parseIdentityOption(rawIdentity);
  await deliverGuardedPanel(
    interaction,
    await buildInitialPersonalConfigPanel(
      interaction,
      locale,
      undefined,
      rawIdentity && !identityId ? -1 : (identityId ?? undefined),
    ),
    {
      method: "editReply",
      locale,
    },
  );
}
