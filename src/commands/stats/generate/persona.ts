import { TIMEFRAME_LABEL_KEYS } from "@/utils/discord/statsDashboardCatalog";
import { AttachmentBuilder, MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { getCachedAllPersonas, getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { handleServerPersonaAutocomplete } from "@/utils/discord/autocomplete/personaAutocomplete";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { resolveSelectedPersona } from "@/utils/persona/personaOptionValue";
import { DEFAULT_TIMEFRAME, type Timeframe, TIMEFRAME_VALUES } from "@/utils/stats/statsDashboard";
import { gatherPersonaCardData } from "@/utils/stats/personaCardGatherer";
import { renderPersonaCard, CARD_W, getPersonaCardHeight } from "@/utils/stats/statsInfographic";
import { renderCardToPng } from "@/utils/stats/cardRenderer";

/**
 * Configures the /stats generate persona subcommand: renders the caller's Persona Affinity card
 * for a persona chosen through autocomplete.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("persona")
    .setDescription(localizer("en-US", "commands.stats.generate.persona.description"))
    .addStringOption((option) =>
      option
        .setName("persona")
        .setDescription(localizer("en-US", "commands.stats.generate.persona.persona_description"))
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName("timeframe")
        .setDescription(localizer("en-US", "commands.stats.generate.persona.timeframe_description"))
        .setRequired(false)
        .addChoices(
          ...TIMEFRAME_VALUES.map((value) => ({ name: localizer("en-US", TIMEFRAME_LABEL_KEYS[value]), value })),
        ),
    );

export const autocomplete = handleServerPersonaAutocomplete;

/**
 * Validates the selected persona privately, then sends the caller's Persona Affinity card as a
 * public PNG.
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

    const personas = await getCachedAllPersonas(guild.id);
    if (personas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.stats.generate.persona.no_personas_title",
        descriptionKey: "commands.stats.generate.persona.no_personas_description",
        color: ColorCode.WARN,
      });
      return;
    }

    const selected = resolveSelectedPersona(personas, interaction.options.getString("persona"));
    if (!selected) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.stats.persona.not_found_title",
        descriptionKey: "commands.stats.persona.not_found_description",
        color: ColorCode.WARN,
      });
      return;
    }

    // The ephemeral defer only covers validation; leaving it in place would sit beside the public card.
    await interaction.deleteReply().catch(() => {});

    const timeframe = (interaction.options.getString("timeframe") ?? DEFAULT_TIMEFRAME) as Timeframe;
    const data = await gatherPersonaCardData({
      serverId,
      guildDiscId: guild.id,
      lineageId: selected.persona_lineage_id ?? 0,
      userId,
      username: interaction.user.displayName,
      userAvatarUrl: interaction.user.displayAvatarURL({ extension: "png", forceStatic: true, size: 128 }),
      locale,
      timeframe,
      guild,
    });

    const png = await renderCardToPng(renderPersonaCard(data), CARD_W, getPersonaCardHeight(data));
    const attachment = new AttachmentBuilder(png, { name: `stats_persona_${Date.now()}.png` });
    await interaction.followUp({ files: [attachment] });
  } catch (error) {
    await log.error(`Error executing /stats generate persona for user ${userData.user_disc_id}`, error as Error, {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: { command: "stats generate persona" },
    });
  }
}
