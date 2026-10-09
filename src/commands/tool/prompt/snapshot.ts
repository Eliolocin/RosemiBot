import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { getCachedAllPersonas, getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { handleServerPersonaAutocomplete } from "@/utils/discord/autocomplete/personaAutocomplete";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { assemblePromptInspection, resolveInspectedPersona } from "@/utils/text/promptInspection/assemble";
import { canViewPromptText, deliverPromptSnapshot } from "@/utils/text/promptInspection/delivery";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("snapshot")
    .setDescription(localizer("en-US", "commands.tool.prompt.snapshot.description"))
    .addStringOption((option) =>
      option
        .setName("persona")
        .setDescription(localizer("en-US", "commands.tool.prompt.snapshot.persona_description"))
        .setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName("format")
        .setDescription(localizer("en-US", "commands.tool.prompt.snapshot.format_description"))
        .addChoices(
          { name: localizer("en-US", "commands.tool.prompt.snapshot.text_option"), value: "text" },
          { name: localizer("en-US", "commands.tool.prompt.snapshot.json_option"), value: "json" },
        ),
    )
    .addBooleanOption((option) =>
      option
        .setName("fetch_tools")
        .setDescription(localizer("en-US", "commands.tool.prompt.snapshot.fetch_tools_description")),
    );

export const autocomplete = handleServerPersonaAutocomplete;

/**
 * Dumps the compiled LLM prompt for a persona in the current channel to a file, then sends it to
 * the invoking user via DM (or as a private attachment if DMs are closed).
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
      titleKey: "commands.tool.prompt.snapshot.guild_only_title",
      descriptionKey: "commands.tool.prompt.snapshot.guild_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
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

    if (!canViewPromptText(interaction.memberPermissions, tomoriState)) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.tool.prompt.snapshot.no_permission_title",
        descriptionKey: "commands.tool.prompt.snapshot.no_permission_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const personas = await getCachedAllPersonas(guild.id);
    if (personas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.tool.prompt.snapshot.no_personas_title",
        descriptionKey: "commands.tool.prompt.snapshot.no_personas_description",
        color: ColorCode.WARN,
      });
      return;
    }

    const selectedPersona = resolveInspectedPersona(personas, interaction.options.getString("persona"));
    if (!selectedPersona) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.tool.prompt.snapshot.persona_not_found_title",
        descriptionKey: "commands.tool.prompt.snapshot.persona_not_found_description",
        color: ColorCode.WARN,
      });
      return;
    }

    const format = interaction.options.getString("format") === "json" ? "json" : "text";
    const fetchTools = interaction.options.getBoolean("fetch_tools") ?? false;

    const inspection = await assemblePromptInspection({
      client,
      guild,
      channel,
      user: interaction.user,
      userData,
      tomoriState,
      personas,
      selectedPersona,
      // TXT intentionally omits tools, so users are directed to use JSON for tools.
      includeTools: fetchTools && format === "json",
    });
    if (!inspection) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.tool.prompt.snapshot.build_failed_title",
        descriptionKey: "commands.tool.prompt.snapshot.build_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    await deliverPromptSnapshot({
      inspection,
      format,
      guildId: guild.id,
      user: interaction.user,
      locale,
      toolsRequested: fetchTools,
      includeRerunHints: true,
      editReply: (options) => interaction.editReply(options),
    });
  } catch (error) {
    log.error("Error executing /tool prompt snapshot:", error as Error, {
      errorType: "CommandExecutionError",
      metadata: { commandName: "tool prompt snapshot", guildId: guild.id },
    });

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
