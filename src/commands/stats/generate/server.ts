import { TIMEFRAME_LABEL_KEYS } from "@/utils/discord/statsDashboardCatalog";
import { AttachmentBuilder } from "discord.js";
import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { DEFAULT_TIMEFRAME, type Timeframe, TIMEFRAME_VALUES } from "@/utils/stats/statsDashboard";
import { gatherServerCardData } from "@/utils/stats/serverCardGatherer";
import { renderServerCard, CARD_W, getServerCardHeight } from "@/utils/stats/statsInfographic";
import { renderCardToPng } from "@/utils/stats/cardRenderer";

/**
 * Configures the /stats generate server subcommand: renders this server's Server Leaderboard card.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("server")
    .setDescription(localizer("en-US", "commands.stats.generate.server.description"))
    .addStringOption((option) =>
      option
        .setName("timeframe")
        .setDescription(localizer("en-US", "commands.stats.generate.server.timeframe_description"))
        .setRequired(false)
        .addChoices(
          ...TIMEFRAME_VALUES.map((value) => ({ name: localizer("en-US", TIMEFRAME_LABEL_KEYS[value]), value })),
        ),
    );

/**
 * Sends this server's Server Leaderboard card as a public PNG.
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
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
    const timeframe = (interaction.options.getString("timeframe") ?? DEFAULT_TIMEFRAME) as Timeframe;

    const tomoriState = await getCachedTomoriState(guild.id);
    const serverId = tomoriState?.server_id;
    if (!serverId) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    await interaction.deferReply();

    const data = await gatherServerCardData({
      serverId,
      guildDiscId: guild.id,
      serverName: guild.name,
      locale,
      timeframe,
      guild,
    });

    const png = await renderCardToPng(renderServerCard(data), CARD_W, getServerCardHeight(data));
    const attachment = new AttachmentBuilder(png, { name: `stats_server_${Date.now()}.png` });
    await interaction.editReply({ files: [attachment] });
  } catch (error) {
    await log.error(`Error executing /stats generate server for user ${userData.user_disc_id}`, error as Error, {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: { command: "stats generate server" },
    });
  }
}
