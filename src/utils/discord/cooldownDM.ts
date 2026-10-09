import type { ChatInputCommandInteraction, MessageFlags, User } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { log } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode } from "@/utils/misc/logger";
import { localizedStatusTitle } from "@/utils/discord/ui/statusTitle";

/**
 * Sends a cooldown notification to the user via DM, with fallback to ephemeral channel reply
 * @param locale - User's locale for localization
 * @param footerKey - Optional localization key for embed footer
 * @param interaction - Optional interaction for ephemeral fallback (slash commands only)
 * @param ephemeralFlags - Optional MessageFlags for ephemeral replies
 */
export async function sendCooldownDM(
  user: User,
  locale: string,
  titleKey: string,
  descriptionKey: string,
  descriptionVars?: Record<string, string | number>,
  footerKey?: string,
  interaction?: ChatInputCommandInteraction,
  ephemeralFlags?: MessageFlags.SuppressEmbeds | MessageFlags.Ephemeral | MessageFlags.SuppressNotifications,
): Promise<void> {
  try {
    const cooldownEmbed = new EmbedBuilder()
      .setTitle(localizedStatusTitle(locale, titleKey, ColorCode.WARN))
      .setDescription(localizer(locale, descriptionKey, descriptionVars))
      .setColor(ColorCode.WARN)
      .setTimestamp();

    if (footerKey) {
      cooldownEmbed.setFooter({ text: localizer(locale, footerKey) });
    }

    // Attempt to send DM
    await user.send({ embeds: [cooldownEmbed] });
    log.info(`Sent cooldown DM to user ${user.id} (${descriptionKey})`);
  } catch (error) {
    // DM failed (user has DMs disabled or blocked the bot)
    log.info(
      `Could not send cooldown DM to user ${user.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );

    // Fallback to ephemeral reply if interaction is provided
    if (interaction) {
      try {
        await replyInfoEmbed(
          interaction,
          locale,
          {
            titleKey,
            descriptionKey,
            descriptionVars,
            footerKey,
            color: ColorCode.WARN,
          },
          ephemeralFlags,
        );
        log.info(`Sent cooldown ephemeral fallback to user ${user.id} in channel`);
      } catch (fallbackError) {
        log.warn(
          `Could not send cooldown DM or ephemeral fallback to user ${user.id}: ${fallbackError instanceof Error ? fallbackError.message : "Unknown error"}`,
        );
      }
    }
  }
}
