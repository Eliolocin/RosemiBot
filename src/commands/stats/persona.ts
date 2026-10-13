import {
  AttachmentBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { getCachedAllPersonas, getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { handleServerPersonaAutocomplete } from "@/utils/discord/autocomplete/personaAutocomplete";
import { replyInfoEmbed } from "@/utils/discord/ui/interactionCore";
import {
  isLocalPersonaAvatarPath,
  loadStoredPersonaAvatarBuffer,
  resolvePersonaAvatarPublicUrl,
} from "@/utils/storage/avatarStorage";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { resolveSelectedPersona } from "@/utils/persona/personaOptionValue";
import * as statsDashboard from "@/utils/stats/statsDashboard";

/**
 * Configures the /stats persona subcommand: select a persona via autocomplete, then view
 * that persona's usage stats on this server for the chosen timeframe.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("persona")
    .setDescription(localizer("en-US", "commands.stats.persona.description"))
    .addStringOption((option) =>
      option
        .setName("persona")
        .setDescription(localizer("en-US", "commands.stats.persona.persona_description"))
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName("timeframe")
        .setDescription(localizer("en-US", "commands.stats.persona.timeframe_description"))
        .setRequired(false)
        .addChoices(
          ...statsDashboard.TIMEFRAME_VALUES.map((value) => ({
            name: localizer("en-US", `commands.choices.${value}`),
            value,
          })),
        ),
    );

export const autocomplete = handleServerPersonaAutocomplete;

/**
 * Executes the /stats persona command: validates the selected persona, loads telemetry,
 * and renders the public stats dashboard.
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

    const personas = await getCachedAllPersonas(guild.id);
    if (personas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.stats.persona.no_personas_title",
        descriptionKey: "commands.stats.persona.no_personas_description",
        color: ColorCode.WARN,
      });
      return;
    }

    const rawPersona = interaction.options.getString("persona");
    const selected = resolveSelectedPersona(personas, rawPersona);
    if (!selected) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.stats.persona.not_found_title",
        descriptionKey: "commands.stats.persona.not_found_description",
        color: ColorCode.WARN,
      });
      return;
    }
    if (
      typeof selected.persona_id !== "number" ||
      !Number.isSafeInteger(selected.persona_id) ||
      selected.persona_id <= 0
    ) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.stats.persona.not_found_title",
        descriptionKey: "commands.stats.persona.not_found_description",
        color: ColorCode.WARN,
      });
      return;
    }

    // Keep the private picker only for validation; leaving it during stats reads would
    // create a transient acknowledgement alongside the eventual public dashboard.
    await interaction.deleteReply().catch(() => {});

    const timeframe = (interaction.options.getString("timeframe") ??
      statsDashboard.DEFAULT_TIMEFRAME) as statsDashboard.Timeframe;
    const from = statsDashboard.resolveWindowFrom(timeframe);

    const lineageId = selected.persona_lineage_id ?? 0;
    const subtitle = statsDashboard.buildSubtitle(locale, timeframe);
    const tabs = await statsDashboard.buildPersonaTabs({
      locale,
      serverId,
      guildId: guild.id,
      lineageId,
      personaName: selected.persona_nickname,
      timeframe,
      from,
      subtitle: `${selected.persona_nickname} • ${subtitle}`,
    });

    let personaIconUrl: string | undefined;
    let personaIconFile: AttachmentBuilder | undefined;
    if (selected.is_alter) {
      const publicUrl = resolvePersonaAvatarPublicUrl(selected.webhook_avatar_url);
      if (publicUrl) {
        personaIconUrl = publicUrl;
      } else if (selected.webhook_avatar_url && isLocalPersonaAvatarPath(selected.webhook_avatar_url)) {
        const buffer = await loadStoredPersonaAvatarBuffer(selected.webhook_avatar_url);
        if (buffer) {
          const name = "stats_persona_icon.png";
          personaIconFile = new AttachmentBuilder(buffer, { name });
          personaIconUrl = `attachment://${name}`;
        }
      }
    } else {
      personaIconUrl = guild.members.me?.displayAvatarURL({ extension: "png", size: 256 }) ?? undefined;
    }

    await statsDashboard.renderStatsDashboardWithReply(
      (payload) => interaction.followUp(payload),
      {
        view: "persona",
        locale,
        ownerId: interaction.user.id,
        serverId,
        guildId: guild.id,
        timeframe,
        personaId: selected.persona_id,
      },
      tabs,
      personaIconUrl,
      personaIconFile,
    );
  } catch (error) {
    await log.error(`Error executing /stats persona for user ${userData.user_disc_id}`, error as Error, {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: { command: "stats persona" },
    });
  }
}
