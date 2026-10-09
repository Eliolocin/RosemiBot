import type { ChatInputCommandInteraction, Client, SlashCommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { getCachedAllPersonas, getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { handleServerPersonaAutocomplete } from "@/utils/discord/autocomplete/personaAutocomplete";
import { buildContextUsagePayload } from "@/utils/discord/ui/contextUsagePanel";
import { deliverGuardedPanel, replyInfoEmbed } from "@/utils/discord/ui/interactionCore";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { assemblePromptInspection, resolveInspectedPersona } from "@/utils/text/promptInspection/assemble";
import { canViewPromptText } from "@/utils/text/promptInspection/delivery";

export const guildOnly = true;

export const configureCommand = (command: SlashCommandBuilder) =>
  command
    .setName("context")
    .setDescription(localizer("en-US", "commands.context.description"))
    .addStringOption((option) =>
      option
        .setName("persona")
        .setDescription(localizer("en-US", "commands.context.persona_description"))
        .setAutocomplete(true),
    );

export const autocomplete = handleServerPersonaAutocomplete;

/**
 * Shows how much of the model's context window a persona's prompt fills in this channel. Token
 * counts are open to every member; the full-prompt buttons follow the prompt snapshot setting.
 *
 * @param userData - Invoker's user row, passed to buildContext so STM loads correctly
 */
export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const guild = interaction.guild;
  const channel = interaction.channel;
  if (!guild || !channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const tomoriState = await getCachedTomoriState(guild.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const personas = await getCachedAllPersonas(guild.id);
    const selectedPersona = resolveInspectedPersona(personas, interaction.options.getString("persona"));
    if (!selectedPersona) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.context.persona_not_found_title",
        descriptionKey: "commands.context.persona_not_found_description",
        color: ColorCode.WARN,
      });
      return;
    }

    const inspection = await assemblePromptInspection({
      client,
      guild,
      channel,
      user: interaction.user,
      userData,
      tomoriState,
      personas,
      selectedPersona,
      includeTools: true,
    });
    if (!inspection) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.context.build_failed_title",
        descriptionKey: "commands.context.build_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const canViewText = canViewPromptText(interaction.memberPermissions, tomoriState);
    await deliverGuardedPanel(interaction, buildContextUsagePayload(locale, inspection, canViewText), {
      locale,
      method: "editReply",
    });
  } catch (error) {
    log.error("Error executing /context:", error as Error, {
      errorType: "CommandExecutionError",
      metadata: { commandName: "context", guildId: guild.id },
    });

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
