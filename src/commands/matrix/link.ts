/**
 * /matrix link
 * Links a Discord channel to a Matrix room for bidirectional message relay.
 * Uses upsert semantics so re-linking replaces any existing mapping.
 *
 * Interaction pattern: Pattern 2 (defer before async work)
 * Permission required: ManageGuild
 */

import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { serverRepository } from "@/utils/db/repositories";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import {
  isMatrixConfigured,
  joinMatrixRoom,
  getRoomEncryptionState,
  invalidateMatrixLinkCache,
  sendMatrixLinkedSetupNotice,
} from "@/utils/bridges/matrix";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import type { UserRow, ErrorContext } from "@/types/db/schema";

/**
 * Configure the /matrix link subcommand builder.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("link")
    .setDescription(localizer("en-US", "commands.matrix.link.description"))
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription(localizer("en-US", "commands.matrix.link.channel_description"))
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("room")
        .setDescription(localizer("en-US", "commands.matrix.link.room_description"))
        .setRequired(true),
    );

/**
 * Execute the /matrix link command.
 * Links the chosen Discord channel to the given Matrix room ID.
 *
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  user: UserRow,
  locale: string,
): Promise<void> {
  const errorContext: ErrorContext = {
    userId: user.user_id,
    serverId: null,
    personaId: null,
  };

  try {
    if (!interaction.guild || !interaction.guildId) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.guild_only_title",
        descriptionKey: "general.errors.guild_only_description",
      });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.permission_denied_title",
        descriptionKey: "general.errors.permission_denied_description",
      });
      return;
    }

    // Defer before async work (Pattern 2)
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!isMatrixConfigured()) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "commands.matrix.link.matrix_not_configured_title",
        descriptionKey: "commands.matrix.link.matrix_not_configured_description",
      });
      return;
    }

    const tomoriState = await getCachedTomoriState(interaction.guildId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
      });
      return;
    }

    errorContext.serverId = tomoriState.server_id;
    errorContext.personaId = tomoriState.persona_id;

    const channel = interaction.options.getChannel("channel", true);
    const roomId = interaction.options.getString("room", true).trim();

    // Validate Matrix room ID format: must start with "!" and contain ":"
    if (!roomId.startsWith("!") || !roomId.includes(":")) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "commands.matrix.link.invalid_room_title",
        descriptionKey: "commands.matrix.link.invalid_room_description",
      });
      return;
    }

    // The homeserver answers state lookups only for members, so joining first lets an
    // invited room prove it is unencrypted.
    let joinFailed = false;
    try {
      await joinMatrixRoom(roomId);
    } catch (joinError) {
      log.warn(`Matrix link: could not auto-join room ${roomId}; the user must invite the bot`, joinError);
      joinFailed = true;
    }

    const botUserId = process.env.MATRIX_BOT_USER_ID ?? "the Matrix bot account";
    // Matrix encryption is permanent, and only a confirmed unencrypted room may carry plaintext relay.
    const encryptionState = await getRoomEncryptionState(roomId);
    if (encryptionState !== "unencrypted") {
      const isEncrypted = encryptionState === "encrypted";
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: isEncrypted
          ? "commands.matrix.link.encrypted_room_title"
          : "commands.matrix.link.encryption_unknown_title",
        descriptionKey: isEncrypted
          ? "commands.matrix.link.encrypted_room_description"
          : "commands.matrix.link.encryption_unknown_description",
        descriptionVars: { room_id: roomId, bot_user_id: botUserId },
      });
      return;
    }

    const oldRoomId = await serverRepository.getExistingMatrixLink(channel.id);
    if (!(await serverRepository.linkMatrix(tomoriState.server_id, channel.id, roomId))) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
      });
      return;
    }

    invalidateMatrixLinkCache(channel.id, oldRoomId ?? undefined);
    invalidateMatrixLinkCache(channel.id, roomId);
    const helpMatrixMention = commandRegistry.getCommandMention("help");

    if (joinFailed) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.WARN,
        titleKey: "commands.matrix.link.success_title",
        descriptionKey: "commands.matrix.link.join_failed_description",
        descriptionVars: {
          channel_id: channel.id,
          room_id: roomId,
          bot_user_id: botUserId,
          help_matrix: helpMatrixMention,
        },
      });
    } else {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.SUCCESS,
        titleKey: "commands.matrix.link.success_title",
        descriptionKey: "commands.matrix.link.success_description",
        descriptionVars: {
          channel_id: channel.id,
          room_id: roomId,
          help_matrix: helpMatrixMention,
        },
      });
    }

    if (!joinFailed && oldRoomId !== roomId) {
      const channelName = channel.name ?? channel.id;

      void sendMatrixLinkedSetupNotice(roomId, locale, channelName).catch((noticeError) => {
        log.warn(`Matrix link: failed to post onboarding notice to room ${roomId}`, noticeError);
      });
    }

    log.info(
      `Matrix bridge: linked channel ${channel.id} (${channel.name}) to room ${roomId} in guild ${interaction.guildId}`,
    );
  } catch (error) {
    log.error("Error executing /matrix link", error, errorContext);
    await replyInfoEmbed(interaction, locale, {
      color: ColorCode.ERROR,
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
    });
  }
}
