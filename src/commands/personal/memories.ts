import {
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { buildInitialPersonalMemoriesPanel } from "@/utils/discord/interactions/personalMemoriesRoutes";
import { deliverGuardedPanel } from "@/utils/discord/interactions/panelController";
import { localizer } from "@/utils/text/localizer";
import {
  autocompleteManagedIdentity,
  parseIdentityOption,
} from "@/utils/discord/interactions/managedIdentityPanelRoutes";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("memories")
    .setDescription(localizer("en-US", "commands.personal.memories.description"))
    .addStringOption((option) =>
      option
        .setName("identity")
        .setDescription(localizer("en-US", "commands.personal.memories.identity_description"))
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
    await buildInitialPersonalMemoriesPanel(
      interaction,
      locale,
      undefined,
      undefined,
      rawIdentity ? (identityId ?? -1) : undefined,
    ),
    {
      method: "editReply",
      locale,
    },
  );
}
