import { TIMEFRAME_LABEL_KEYS } from "@/utils/discord/statsDashboardCatalog";
import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { resolveStatsServerId } from "@/utils/stats/statsServerContext";
import {
  buildServerTabs,
  buildSubtitle,
  DEFAULT_TIMEFRAME,
  renderStatsDashboard,
  resolveWindowFrom,
  type Timeframe,
  TIMEFRAME_VALUES,
} from "@/utils/stats/statsDashboard";

/**
 * Configures the /stats server subcommand: server-wide usage stats for the chosen
 * timeframe (leaderboard, models, tools, expression, generations).
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("server")
    .setDescription(localizer("en-US", "commands.stats.server.description"))
    .addStringOption((option) =>
      option
        .setName("timeframe")
        .setDescription(localizer("en-US", "commands.stats.server.timeframe_description"))
        .setRequired(false)
        .addChoices(
          ...TIMEFRAME_VALUES.map((value) => ({ name: localizer("en-US", TIMEFRAME_LABEL_KEYS[value]), value })),
        ),
    );

/**
 * Renders the server-wide stats dashboard.
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // Acknowledge publicly before DB reads (dashboard is a public message).
  await interaction.deferReply();

  const guild = interaction.guild;
  if (!guild) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  try {
    const serverId = await resolveStatsServerId(interaction, locale);
    if (!serverId) return;

    const timeframe = (interaction.options.getString("timeframe") ?? DEFAULT_TIMEFRAME) as Timeframe;
    const from = resolveWindowFrom(timeframe);
    const subtitle = buildSubtitle(locale, timeframe);

    const tabs = await buildServerTabs({
      locale,
      serverId,
      guildId: guild.id,
      timeframe,
      from,
      subtitle: `${guild.name} • ${subtitle}`,
    });

    // Pin the server's icon to the dashboard's top-right corner (null when the guild
    // has no custom icon, so the card simply renders without one).
    const iconUrl = guild.iconURL({ extension: "png", size: 256 }) ?? undefined;
    await renderStatsDashboard(
      interaction,
      {
        view: "server",
        locale,
        ownerId: interaction.user.id,
        serverId,
        guildId: guild.id,
        timeframe,
      },
      tabs,
      iconUrl,
    );
  } catch (error) {
    await log.error(`Error executing /stats server for user ${userData.user_disc_id}`, error as Error, {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: { command: "stats server" },
    });
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
