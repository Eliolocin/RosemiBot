import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { getChatDiagnostic } from "@/utils/chat/diagnosticTimeline";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import packageInfo from "../../../package.json";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("chat")
    .setDescription(localizer("en-US", "commands.troubleshoot.chat.description"))
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription(localizer("en-US", "commands.troubleshoot.chat.message_description"))
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName("minutes")
        .setDescription(localizer("en-US", "commands.troubleshoot.chat.minutes_description"))
        .setMinValue(1)
        .setMaxValue(60)
        .setRequired(false),
    );

function parseMessageLink(value: string, channelId: string, guildId: string | null): string | null {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      !["discord.com", "canary.discord.com", "ptb.discord.com"].includes(url.hostname) ||
      url.search ||
      url.hash
    )
      return null;
    const match = /^\/channels\/(\d+|@me)\/(\d+)\/(\d+)\/?$/.exec(url.pathname);
    if (!match || match[1] !== (guildId ?? "@me") || match[2] !== channelId) return null;
    return match[3] ?? null;
  } catch {
    return null;
  }
}

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const link = interaction.options.getString("message");
  const minutesAgo = interaction.options.getInteger("minutes");
  if (link && minutesAgo !== null) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.troubleshoot.chat.invalid_request_title",
      descriptionKey: "commands.troubleshoot.chat.choose_one",
      color: ColorCode.ERROR,
    });
    return;
  }
  if (minutesAgo !== null && (!Number.isInteger(minutesAgo) || minutesAgo < 1 || minutesAgo > 60)) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.troubleshoot.chat.invalid_request_title",
      descriptionKey: "commands.troubleshoot.chat.invalid_minutes",
      color: ColorCode.ERROR,
    });
    return;
  }
  const messageId = link ? parseMessageLink(link, interaction.channelId, interaction.guildId) : null;
  if (link && !messageId) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.troubleshoot.chat.invalid_request_title",
      descriptionKey: "commands.troubleshoot.chat.invalid_link",
      color: ColorCode.ERROR,
    });
    return;
  }

  const report = getChatDiagnostic({
    ownerId: interaction.user.id,
    channelId: interaction.channelId,
    guildId: interaction.guildId,
    messageId: messageId ?? undefined,
    minutesAgo: minutesAgo ?? undefined,
  });
  if (!report) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.troubleshoot.chat.no_recent_chat_title",
      descriptionKey: "commands.troubleshoot.chat.no_recent_chat",
      color: ColorCode.WARN,
    });
    return;
  }

  const attachment = new AttachmentBuilder(
    Buffer.from(`${JSON.stringify({ botVersion: packageInfo.version, ...report }, null, 2)}\n`, "utf-8"),
    {
      name: `tomoribot-chat-${report.reportId}.json`,
    },
  );
  let deliveredToDm = false;
  try {
    await interaction.user.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.troubleshoot.chat.dm_title"))
          .setDescription(localizer(locale, "commands.troubleshoot.chat.dm_description"))
          .setColor(ColorCode.INFO),
      ],
      files: [attachment],
    });
    deliveredToDm = true;
  } catch (error) {
    log.warn("Could not DM a chat troubleshooting file", error as Error);
  }
  if (deliveredToDm) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.troubleshoot.chat.success_title",
      descriptionKey: "commands.troubleshoot.chat.dm_sent",
      color: ColorCode.SUCCESS,
    });
  } else {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.troubleshoot.chat.success_title",
      descriptionKey: "commands.troubleshoot.chat.dm_fallback",
      color: ColorCode.SUCCESS,
      files: [attachment],
    });
  }
}
