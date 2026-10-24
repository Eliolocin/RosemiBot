import { TIMEFRAME_LABEL_KEYS } from "@/utils/discord/statsDashboardCatalog";
import { AttachmentBuilder } from "discord.js";
import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { PrivacyLevel } from "@/types/db/schema";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { getCachedPrivacyLevel } from "@/utils/cache/userCache";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { DEFAULT_TIMEFRAME, type StatsScope, type Timeframe, TIMEFRAME_VALUES } from "@/utils/stats/statsDashboard";
import { gatherPersonalCardData } from "@/utils/stats/personalCardGatherer";
import { renderPersonalCard, CARD_W, getPersonalCardHeight } from "@/utils/stats/statsInfographic";
import { renderCardToPng } from "@/utils/stats/cardRenderer";

/**
 * Configures the /stats generate personal subcommand: renders the caller's Personal Wrapped card.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("personal")
    .setDescription(localizer("en-US", "commands.stats.generate.personal.description"))
    .addStringOption((option) =>
      option
        .setName("timeframe")
        .setDescription(localizer("en-US", "commands.stats.generate.personal.timeframe_description"))
        .setRequired(false)
        .addChoices(
          ...TIMEFRAME_VALUES.map((value) => ({ name: localizer("en-US", TIMEFRAME_LABEL_KEYS[value]), value })),
        ),
    )
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.stats.generate.personal.scope_description"))
        .setRequired(false)
        .addChoices(
          { name: localizer("en-US", "commands.choices.this_server"), value: "this_server" },
          { name: localizer("en-US", "commands.choices.global"), value: "global" },
        ),
    );

/**
 * Sends the caller's Personal Wrapped card as a public PNG. Fully-private users are refused
 * before the reply is deferred so the refusal stays ephemeral.
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
    const scope = (interaction.options.getString("scope") ?? "this_server") as StatsScope;

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

    const userId = userData.user_id;
    if (!userId) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const privacyLevel = await getCachedPrivacyLevel(interaction.user.id);
    if (privacyLevel === PrivacyLevel.FULL) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.stats.generate.personal.privacy_title",
        descriptionKey: "commands.stats.generate.personal.privacy_description",
        color: ColorCode.WARN,
      });
      return;
    }

    await interaction.deferReply();

    const data = await gatherPersonalCardData({
      userId,
      serverId: scope === "this_server" ? serverId : undefined,
      guildDiscId: guild.id,
      username: interaction.user.displayName,
      userAvatarUrl: interaction.user.displayAvatarURL({ extension: "png", forceStatic: true, size: 128 }),
      locale,
      timeframe,
    });

    const png = await renderCardToPng(renderPersonalCard(data), CARD_W, getPersonalCardHeight(data));
    const attachment = new AttachmentBuilder(png, { name: `stats_personal_${Date.now()}.png` });
    await interaction.editReply({ files: [attachment] });
  } catch (error) {
    await log.error(`Error executing /stats generate personal for user ${userData.user_disc_id}`, error as Error, {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: { command: "stats generate personal" },
    });
  }
}
