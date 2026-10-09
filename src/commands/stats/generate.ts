import { AttachmentBuilder, MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { PrivacyLevel } from "@/types/db/schema";
import { getCachedAllPersonas, getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { getCachedPrivacyLevel } from "@/utils/cache/userCache";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import {
  buildPersonaWorkflowNotice,
  completePersonaWorkflow,
  runPersonaPickerWorkflow,
} from "@/utils/discord/ui/personaWorkflow";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { DEFAULT_TIMEFRAME, type StatsScope, type Timeframe, TIMEFRAME_VALUES } from "@/utils/stats/statsDashboard";
import { gatherPersonalCardData } from "@/utils/stats/personalCardGatherer";
import { gatherPersonaCardData } from "@/utils/stats/personaCardGatherer";
import { gatherServerCardData } from "@/utils/stats/serverCardGatherer";
import {
  renderPersonalCard,
  renderPersonaCard,
  renderServerCard,
  CARD_W,
  getPersonalCardHeight,
  getPersonaCardHeight,
  getServerCardHeight,
} from "@/utils/stats/statsInfographic";
import { renderCardToPng } from "@/utils/stats/cardRenderer";

type CardType = "personal" | "persona" | "server";

/**
 * Configures the /stats generate subcommand: generates a shareable PNG image
 * card summarising personal, persona, or server stats for the chosen timeframe.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("generate")
    .setDescription(localizer("en-US", "commands.stats.generate.description"))
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription(localizer("en-US", "commands.stats.generate.type_description"))
        .setRequired(true)
        .addChoices(
          { name: localizer("en-US", "commands.stats.generate.personal_option"), value: "personal" },
          { name: localizer("en-US", "commands.stats.generate.persona_option"), value: "persona" },
          { name: localizer("en-US", "commands.stats.generate.server_option"), value: "server" },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("timeframe")
        .setDescription(localizer("en-US", "commands.stats.generate.timeframe_description"))
        .setRequired(false)
        .addChoices(
          ...TIMEFRAME_VALUES.map((value) => ({ name: localizer("en-US", `commands.choices.${value}`), value })),
        ),
    )
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.stats.generate.scope_description"))
        .setRequired(false)
        .addChoices(
          { name: localizer("en-US", "commands.choices.this_server"), value: "this_server" },
          { name: localizer("en-US", "commands.choices.global"), value: "global" },
        ),
    );

/**
 * Generates and sends the requested stats infographic card as a PNG attachment.
 *
 * Flow by card type:
 * - personal: privacy gate → deferReply → gather → render → editReply with PNG.
 * - persona:  show private picker → compact it → create exactly one public PNG response.
 * - server:   deferReply → gather → render → editReply with PNG.
 *
 * @param userData    - Caller's user row from the DB
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
    const cardType = interaction.options.getString("type", true) as CardType;
    const timeframe = (interaction.options.getString("timeframe") ?? DEFAULT_TIMEFRAME) as Timeframe;
    const scope = (interaction.options.getString("scope") ?? "this_server") as StatsScope;

    // Persona cards start with a private picker even though the final card is
    // public. Protect the state/persona reads before handing off to the picker.
    if (cardType === "persona") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

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

    if (cardType === "personal") {
      await executePersonalCard(interaction, userData, locale, serverId, timeframe, scope);
    } else if (cardType === "persona") {
      await executePersonaCard(interaction, userData, locale, serverId, guild, timeframe);
    } else {
      await executeServerCard(interaction, locale, serverId, guild.id, guild.name, timeframe);
    }
  } catch (error) {
    await log.error(`Error executing /stats generate for user ${userData.user_disc_id}`, error as Error, {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: { command: "stats generate" },
    });
  }
}

/**
 * Generates and sends the Personal "Wrapped" infographic card.
 * Fully-private users are refused immediately with an ephemeral error embed.
 *
 * @param userData    - Caller's user row
 * @param serverId    - Internal servers FK for "this server" scope queries
 * @param timeframe   - Selected time window
 * @param scope       - "this_server" or "global" scope for the personal card
 */
async function executePersonalCard(
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
  serverId: number,
  timeframe: Timeframe,
  scope: StatsScope,
): Promise<void> {
  const userId = userData.user_id;
  if (!userId) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // Privacy gate: fully-private users cannot generate personal cards.
  const privacyLevel = await getCachedPrivacyLevel(interaction.user.id);
  if (privacyLevel === PrivacyLevel.FULL) {
    // replyInfoEmbed defaults to ephemeral, so no extra flag needed.
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.stats.generate.privacy_title",
      descriptionKey: "commands.stats.generate.privacy_description",
      color: ColorCode.WARN,
    });
    return;
  }

  // Acknowledge the interaction before the DB reads start.
  await interaction.deferReply();

  const scopedServerId = scope === "this_server" ? serverId : undefined;
  const data = await gatherPersonalCardData({
    userId,
    serverId: scopedServerId,
    guildDiscId: interaction.guildId ?? "",
    username: interaction.user.displayName,
    userAvatarUrl: interaction.user.displayAvatarURL({ extension: "png", forceStatic: true, size: 128 }),
    locale,
    timeframe,
  });

  const node = renderPersonalCard(data);
  const png = await renderCardToPng(node, CARD_W, getPersonalCardHeight(data));
  const attachment = new AttachmentBuilder(png, { name: `stats_personal_${Date.now()}.png` });

  await interaction.editReply({ files: [attachment] });
}

/**
 * Opens the persona picker then generates the invoking user's Persona Affinity
 * card for the selected persona through the workflow's explicit public-result phase.
 *
 * @param interaction - The original slash command interaction (used for the picker)
 * @param timeframe   - Selected time window
 */
async function executePersonaCard(
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
  serverId: number,
  guild: import("discord.js").Guild,
  timeframe: Timeframe,
): Promise<void> {
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
      titleKey: "commands.stats.generate.no_personas_title",
      descriptionKey: "commands.stats.generate.no_personas_description",
      color: ColorCode.WARN,
    });
    return;
  }

  await runPersonaPickerWorkflow(interaction, locale, {
    personas,
    titleKey: "commands.stats.generate.picker_title",
    descriptionKey: "commands.stats.generate.picker_description",
    color: ColorCode.INFO,
    async onSelected(selection) {
      const selected = selection.persona;
      const publicReply = await selection.beginSeparatePublicReply(
        buildPersonaWorkflowNotice({
          locale,
          color: ColorCode.SUCCESS,
          titleKey: "commands.stats.persona.chosen_title",
          titleVars: { name: selected.persona_nickname },
        }),
      );

      try {
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
        const node = renderPersonaCard(data);
        const png = await renderCardToPng(node, CARD_W, getPersonaCardHeight(data));
        const attachment = new AttachmentBuilder(png, { name: `stats_persona_${Date.now()}.png` });
        await publicReply.reply({ files: [attachment] });
      } catch (error) {
        await selection.message.replace(
          buildPersonaWorkflowNotice({
            locale,
            color: ColorCode.ERROR,
            titleKey: "general.errors.unknown_error_title",
            descriptionKey: "general.errors.unknown_error_description",
          }),
        );
        throw error;
      }
      return completePersonaWorkflow();
    },
  });
}

/**
 * Generates and sends the Server Leaderboard infographic card.
 *
 * @param guildDiscId  - Discord guild snowflake (for persona cache)
 * @param serverName   - Guild display name shown on the card header
 * @param timeframe    - Selected time window
 */
async function executeServerCard(
  interaction: ChatInputCommandInteraction,
  locale: string,
  serverId: number,
  guildDiscId: string,
  serverName: string,
  timeframe: Timeframe,
): Promise<void> {
  // Acknowledge immediately, because DB reads can take a moment.
  await interaction.deferReply();

  const guild = interaction.guild;
  if (!guild) return;

  const data = await gatherServerCardData({
    serverId,
    guildDiscId,
    serverName,
    locale,
    timeframe,
    guild,
  });

  const node = renderServerCard(data);
  const png = await renderCardToPng(node, CARD_W, getServerCardHeight(data));
  const attachment = new AttachmentBuilder(png, { name: `stats_server_${Date.now()}.png` });

  await interaction.editReply({ files: [attachment] });
}
