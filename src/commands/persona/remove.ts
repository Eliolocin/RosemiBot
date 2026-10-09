/**
 * Persona Remove Command
 * Removes an alter persona from the server
 */

import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags, EmbedBuilder } from "discord.js";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed, promptWithPaginatedModal, safeSelectOptionText } from "../../utils/discord/interactionHelper";
import { invalidateTomoriStateCache } from "../../utils/cache/tomoriStateCache";
import type { UserRow } from "../../types/db/schema";
import type { SelectOption } from "../../types/discord/modal";
import { personaRepository } from "@/utils/db/repositories";
import { deletePersonaAvatarFromStorage } from "../../utils/storage/avatarStorage";
import { localizedStatusTitle } from "@/utils/discord/ui/statusTitle";

const MODAL_CUSTOM_ID = "persona_remove_modal";
const PERSONA_SELECT_ID = "persona_select";

function isDuplicateTaggedName(name: string): boolean {
  return /\[dup-\d+\]\s*$/i.test(name.trim());
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.persona.remove.description"));

/**
 * Executes the 'remove' command
 * Removes an alter persona from the server
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    // Check if command is run in a guild (not DMs)
    if (!interaction.guild) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.guild_only_title",
        descriptionKey: "general.errors.guild_only_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check permissions (ManageGuild required)
    const hasPermission = interaction.memberPermissions?.has("ManageGuild") ?? false;

    if (!hasPermission) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.persona.remove.no_permission_title",
        descriptionKey: "commands.persona.remove.no_permission_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const allPersonas = await personaRepository.loadAllForServer(interaction.guild.id);

    // Filter to removable personas:
    // - all alters
    // - duplicate-tagged personas created by schema migration cleanup, even if marked as main
    const removablePersonas = allPersonas.filter((p) => p.is_alter || isDuplicateTaggedName(p.persona_nickname));

    if (removablePersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.persona.remove.no_alters_error_title",
        descriptionKey: "commands.persona.remove.no_alters_error_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const alterSelectOptions: SelectOption[] = removablePersonas.map((persona, index) => ({
      label: safeSelectOptionText(persona.persona_nickname),
      value: index.toString(), // Use index to avoid truncation issues
    }));

    const modalResult = await promptWithPaginatedModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.persona.remove.modal_title",
      pageSelectTitleKey: "general.pagination.select_persona_title",
      pageSelectDescriptionKey: "general.pagination.select_persona_page_description",
      components: [
        {
          customId: PERSONA_SELECT_ID,
          labelKey: "commands.persona.remove.select_label",
          placeholder: "commands.persona.remove.select_placeholder",
          required: true,
          options: alterSelectOptions,
        },
      ],
    });

    if (modalResult.outcome !== "submit") {
      log.info(`Persona removal modal ${modalResult.outcome} for user ${interaction.user.id}`);
      return;
    }

    // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
    const modalSubmitInteraction = modalResult.interaction!;
    if (!modalSubmitInteraction.deferred && !modalSubmitInteraction.replied) {
      await modalSubmitInteraction.deferReply({
        flags: MessageFlags.Ephemeral,
      });
    }
    const selectedIndex = Number.parseInt(
      // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
      modalResult.values![PERSONA_SELECT_ID],
      10,
    );
    const personaToRemove = removablePersonas[selectedIndex];
    if (!personaToRemove?.persona_id) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      log.warn("Persona removal failed due to missing persona_id for selected alter.");
      return;
    }
    const personaId = personaToRemove.persona_id;

    // For non-alter duplicate-tagged rows, ensure at least one main persona remains.
    if (!personaToRemove.is_alter) {
      const mainCount = await personaRepository.countMainPersonasForServer(personaToRemove.server_id);
      if (mainCount <= 1) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const removed = await personaRepository.removePersona(personaId);
    if (!removed) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (personaToRemove.webhook_avatar_url) {
      await deletePersonaAvatarFromStorage(personaToRemove.webhook_avatar_url);
    }

    // Invalidate cache
    invalidateTomoriStateCache(interaction.guild.id);

    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.persona.remove.success_title",
      description: localizer(locale, "commands.persona.remove.success_description", {
        nickname: personaToRemove.persona_nickname,
      }),
      color: ColorCode.SUCCESS,
    });

    log.success(
      `Removed alter persona "${personaToRemove.persona_nickname}" (ID: ${personaId}) from guild ${interaction.guild.id}`,
    );
  } catch (error) {
    log.error("Error executing persona remove command:", error, {
      errorType: "CommandExecutionError",
      metadata: { commandName: "persona remove" },
    });

    if (!interaction.replied && !interaction.deferred) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizedStatusTitle(locale, "general.errors.unknown_error_title", ColorCode.ERROR))
            .setDescription(localizer(locale, "general.errors.unknown_error_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
    }
  }
}
