/**
 * Preset Export Command
 * Exports TomoriBot's personality as a PNG file with embedded metadata,
 * or as an importable JSON file (same payload, no avatar image)
 */

import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { AttachmentBuilder, MessageFlags, EmbedBuilder } from "discord.js";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import type { UserRow } from "../../types/db/schema";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";
import { getServerAvatar } from "../../utils/image/avatarHelper";
import { embedMetadataInPNG } from "../../utils/image/pngMetadata";
import { personaRepository } from "@/utils/db/repositories";
import { sanitizeAttachmentFilenamePart } from "@/utils/discord/attachmentFilename";
import { convertToPNG } from "@/utils/image/imageProcessor";
import { loadStoredPersonaAvatarBuffer } from "@/utils/storage/avatarStorage";
import { localizedStatusTitle } from "@/utils/discord/ui/statusTitle";
import { handleWorkspacePersonaAutocomplete } from "@/utils/discord/autocomplete/personaAutocomplete";
import { resolveSelectedPersona } from "@/utils/persona/personaOptionValue";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("export")
    .setDescription(localizer("en-US", "commands.persona.export.description"))
    .addStringOption((option) =>
      option
        .setName("persona")
        .setDescription(localizer("en-US", "commands.persona.export.persona_description"))
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addBooleanOption((option) =>
      option
        .setName("export_json")
        .setDescription(localizer("en-US", "commands.persona.export.export_json_description"))
        .setRequired(false),
    );

export const autocomplete = handleWorkspacePersonaAutocomplete;

/**
 * Exports the selected persona as a PNG with embedded preset metadata, or as an importable JSON
 * file when `export_json` is true, and posts it publicly in the channel.
 */
export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    const serverDiscId = interaction.guild?.id ?? interaction.user.id;
    const allPersonas = await personaRepository.loadAllForServer(serverDiscId);
    const selectedPersona = resolveSelectedPersona(allPersonas, interaction.options.getString("persona", true));
    if (!selectedPersona?.persona_id) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const exportJson = interaction.options.getBoolean("export_json") ?? false;

    // Defer reply while we process (not ephemeral for transparency)
    await interaction.deferReply();

    const exportResult = await presetRepository.exportPresetData(serverDiscId, selectedPersona.persona_id);

    if (!exportResult.success) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.persona.export.failed_title",
        descriptionKey: exportResult.error,
        color: ColorCode.ERROR,
      });
      return;
    }

    const presetData = exportResult.data;
    if (exportJson) {
      const nickname = presetData.data.tomori_nickname;
      const sanitizedNickname = sanitizeAttachmentFilenamePart(nickname, {
        fallback: "persona",
        maxLength: 50,
      });
      const timestamp = Date.now();
      const filename = `tomori-preset-${sanitizedNickname}-${timestamp}.json`;

      // Canonical PresetExport payload (identical to the PNG tEXt chunk) so the
      // file round-trips through /persona import's validatePresetFile() path.
      // The `note` and `readable` extras are for humans only: the import Zod
      // schemas use non-strict z.object(), which strips unknown keys on parse.
      const importableJsonExport = {
        ...presetData,
        note: localizer(locale, "commands.persona.export.json_importable_note"),
        readable: {
          is_alter: selectedPersona.is_alter === true,
          webhook_avatar_url: selectedPersona.webhook_avatar_url ?? null,
          sample_dialogues: presetData.data.sample_dialogues_in.map((input, index) => ({
            user_input: input,
            persona_output: presetData.data.sample_dialogues_out[index] ?? "",
          })),
        },
      };

      const attachment = new AttachmentBuilder(
        Buffer.from(`${JSON.stringify(importableJsonExport, null, 2)}\n`, "utf8"),
        {
          name: filename,
        },
      );

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizedStatusTitle(locale, "commands.persona.export.success_title", ColorCode.SUCCESS))
            .setDescription(
              localizer(locale, "commands.persona.export.success_description_json", {
                nickname,
              }),
            )
            .setColor(ColorCode.SUCCESS),
        ],
        files: [attachment],
      });

      log.success(
        `Successfully exported importable JSON preset for ${interaction.guild ? "guild" : "DM"} ${serverDiscId}: ${nickname}`,
      );
      return;
    }

    // Resolve avatar image (alter persona avatar when available, otherwise server avatar)
    let avatarBuffer: Buffer;
    try {
      let selectedAvatarBuffer: Buffer | null = null;
      if (selectedPersona.is_alter && selectedPersona.webhook_avatar_url) {
        const storedAvatarBuffer = await loadStoredPersonaAvatarBuffer(selectedPersona.webhook_avatar_url);
        if (storedAvatarBuffer) {
          try {
            selectedAvatarBuffer = await convertToPNG(storedAvatarBuffer);
          } catch (error) {
            log.warn(
              `Failed to convert alter avatar to PNG for tomori ${selectedPersona.persona_id}; falling back to server avatar`,
              error as Error,
            );
          }
        } else {
          log.warn(
            `Failed to download alter avatar for tomori ${selectedPersona.persona_id}; falling back to server avatar`,
          );
        }
      }

      avatarBuffer =
        selectedAvatarBuffer ??
        // In DMs, getServerAvatar will return bot's default avatar when guild is null
        (await getServerAvatar(interaction.guild, client));
    } catch (error) {
      log.error(`Failed to get avatar for ${interaction.guild ? "guild" : "DM"} ${serverDiscId}:`, error as Error);
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.persona.export.avatar_failed_title",
        descriptionKey: "commands.persona.export.avatar_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    let pngWithMetadata: Buffer;
    try {
      pngWithMetadata = embedMetadataInPNG(avatarBuffer, presetData);
    } catch (error) {
      log.error(
        `Failed to embed metadata into PNG for ${interaction.guild ? "guild" : "DM"} ${serverDiscId}:`,
        error as Error,
      );
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.persona.export.embed_failed_title",
        descriptionKey: "commands.persona.export.embed_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const nickname = presetData.data.tomori_nickname;
    const sanitizedNickname = sanitizeAttachmentFilenamePart(nickname, {
      fallback: "persona",
      maxLength: 50,
    });
    const timestamp = Date.now();
    const filename = `tomori-preset-${sanitizedNickname}-${timestamp}.png`;

    const attachment = new AttachmentBuilder(pngWithMetadata, {
      name: filename,
    });

    // Send to channel with embedded image (visible to everyone for transparency)
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizedStatusTitle(locale, "commands.persona.export.success_title", ColorCode.SUCCESS))
          .setDescription(
            localizer(locale, "commands.persona.export.success_description", {
              nickname: nickname,
            }),
          )
          .setColor(ColorCode.SUCCESS)
          .setImage(`attachment://${filename}`),
      ],
      files: [attachment],
    });

    log.success(`Successfully exported preset for ${interaction.guild ? "guild" : "DM"} ${serverDiscId}: ${nickname}`);
  } catch (error) {
    log.error("Error executing preset export command:", error, {
      errorType: "CommandExecutionError",
      metadata: { commandName: "preset export" },
    });

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
