/**
 * Persona Remove Command
 * Removes an alter persona from the server
 */

import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import { invalidateTomoriStateCache } from "../../utils/cache/tomoriStateCache";
import type { TomoriState, UserRow } from "../../types/db/schema";
import { personaRepository } from "@/utils/db/repositories";
import { deletePersonaAvatarFromStorage } from "../../utils/storage/avatarStorage";
import { respondWithPersonaChoices } from "@/utils/discord/autocomplete/personaAutocomplete";
import { resolveSelectedPersona } from "@/utils/persona/personaOptionValue";

function isDuplicateTaggedName(name: string): boolean {
  return /\[dup-\d+\]\s*$/i.test(name.trim());
}

/** Duplicate-tagged rows from schema migration cleanup stay removable even when marked as main. */
function isRemovablePersona(persona: Pick<TomoriState, "is_alter" | "persona_nickname">): boolean {
  return persona.is_alter || isDuplicateTaggedName(persona.persona_nickname);
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("remove")
    .setDescription(localizer("en-US", "commands.persona.remove.description"))
    .addStringOption((option) =>
      option
        .setName("persona")
        .setDescription(localizer("en-US", "commands.persona.remove.persona_description"))
        .setRequired(true)
        .setAutocomplete(true),
    );

export const autocomplete = async (_client: Client, interaction: AutocompleteInteraction): Promise<void> =>
  respondWithPersonaChoices(interaction, interaction.guild?.id, isRemovablePersona);

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
    const removablePersonas = allPersonas.filter(isRemovablePersona);

    if (removablePersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.persona.remove.no_alters_error_title",
        descriptionKey: "commands.persona.remove.no_alters_error_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const personaToRemove = resolveSelectedPersona(removablePersonas, interaction.options.getString("persona", true));
    if (!personaToRemove?.persona_id) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const personaId = personaToRemove.persona_id;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // For non-alter duplicate-tagged rows, ensure at least one main persona remains.
    if (!personaToRemove.is_alter) {
      const mainCount = await personaRepository.countMainPersonasForServer(personaToRemove.server_id);
      if (mainCount <= 1) {
        await replyInfoEmbed(interaction, locale, {
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
      await replyInfoEmbed(interaction, locale, {
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

    await replyInfoEmbed(interaction, locale, {
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

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
