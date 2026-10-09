import { MessageFlags } from "discord.js";
import { getCachedAllPersonas, getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { userRepository } from "@/utils/db/repositories";
import type { GlobalInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import { CONTEXT_ROUTE_NAMESPACE, CONTEXT_ROUTE_VERSION } from "@/utils/discord/ui/contextUsagePanel";
import { replyInfoEmbed } from "@/utils/discord/ui/interactionCore";
import { ColorCode } from "@/utils/misc/logger";
import { resolveSelectedPersona } from "@/utils/persona/personaOptionValue";
import { assemblePromptInspection } from "@/utils/text/promptInspection/assemble";
import { canViewPromptText, deliverPromptSnapshot } from "@/utils/text/promptInspection/delivery";

/**
 * Handles the `/context` "View as Text" and "View as JSON" buttons. Access is checked again on
 * every click: a disabled button is only a hint, and the moderation setting may have changed
 * since the panel was drawn.
 */
export const contextInteractionRoute: GlobalInteractionRoute = {
  namespace: CONTEXT_ROUTE_NAMESPACE,
  version: CONTEXT_ROUTE_VERSION,
  async execute(client, interaction, route): Promise<void> {
    const [action, rawPersonaId, format] = route.segments;
    if (!interaction.isButton() || action !== "snapshot" || (format !== "text" && format !== "json")) {
      throw new Error(`Unsupported context interaction route: ${route.segments.join(":")}`);
    }

    const locale = interaction.locale ?? interaction.guildLocale ?? "en-US";
    const guild = interaction.guild;
    const channel = interaction.channel;
    if (!guild || !channel) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.guild_only_title",
        descriptionKey: "general.errors.guild_only_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const tomoriState = await getCachedTomoriState(guild.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (!canViewPromptText(interaction.memberPermissions, tomoriState)) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.context.no_permission_title",
        descriptionKey: "commands.context.no_permission_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const personas = await getCachedAllPersonas(guild.id);
    const selectedPersona = resolveSelectedPersona(personas, rawPersonaId);
    const userData = await userRepository.loadByDiscordId(interaction.user.id);
    if (!selectedPersona || !userData) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.context.persona_not_found_title",
        descriptionKey: "commands.context.persona_not_found_description",
        color: ColorCode.WARN,
      });
      return;
    }

    const inspection = await assemblePromptInspection({
      client,
      guild,
      channel,
      user: interaction.user,
      userData,
      tomoriState,
      personas,
      selectedPersona,
      includeTools: format === "json",
    });
    if (!inspection) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.context.build_failed_title",
        descriptionKey: "commands.context.build_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    await deliverPromptSnapshot({
      inspection,
      format,
      guildId: guild.id,
      user: interaction.user,
      locale,
      toolsRequested: format === "json",
      includeRerunHints: false,
      editReply: (options) => interaction.editReply(options),
    });
  },
};
