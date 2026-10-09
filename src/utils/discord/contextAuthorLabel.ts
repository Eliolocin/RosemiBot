import type { GuildMember, Message } from "discord.js";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { userRepository } from "@/utils/db/repositories";
import { resolvePreferredDiscordDisplayName } from "@/utils/discord/displayName";
import { normalizeRenderModifierName } from "@/utils/discord/renderModifierParser";
import { resolveWebhookPersonaAuthor } from "@/utils/discord/webhookPersonaAuthor";
import { stripBridgePrefix } from "@/utils/bridges";
import { log } from "@/utils/misc/logger";
import { verifyMessageWebhook } from "@/utils/chat/webhookIdentity";

type ResolveContextAuthorLabelOptions = {
  guildId?: string | null;
  personalMemoriesEnabled?: boolean;
};

async function resolveGuildMember(message: Message, guildId?: string | null): Promise<GuildMember | null> {
  if (!guildId || guildId === "DM" || !message.guild) {
    return null;
  }

  return (
    message.member ??
    message.guild.members.cache.get(message.author.id) ??
    (await message.guild.members.fetch(message.author.id).catch(() => null))
  );
}

export async function resolveContextAuthorLabel(
  message: Message,
  options: ResolveContextAuthorLabelOptions = {},
): Promise<string> {
  const guildId = options.guildId ?? message.guildId;
  const trustedWebhook = await verifyMessageWebhook(message);
  const webhookName = trustedWebhook ? stripBridgePrefix(message.author.username) : message.author.username;

  if (message.webhookId) {
    if (trustedWebhook && guildId && guildId !== "DM") {
      try {
        const personas = await getCachedAllPersonas(guildId);
        const personaByNickname = new Map(
          personas.map((persona) => [normalizeRenderModifierName(persona.persona_nickname), persona]),
        );
        if (webhookName) {
          const resolvedPersona = await resolveWebhookPersonaAuthor(message.id, webhookName, personaByNickname);
          if (resolvedPersona) {
            return resolvedPersona.displayName;
          }
        }
      } catch (error) {
        log.warn("Failed to resolve persona name for webhook-authored boomerang context message", error);
      }
    }

    return webhookName || message.author.username || "Unknown";
  }

  // For direct bot messages (non-webhook), we can't know which persona authored them,
  // so use the bot's actual username rather than the currently active persona's nickname.
  if (message.client.user && message.author.id === message.client.user.id) {
    return message.author.username || "Tomori";
  }

  if (guildId && guildId !== "DM") {
    try {
      const userIsBlacklisted = await userRepository.isBlacklisted(guildId, message.author.id);
      const userRow = await userRepository.loadByDiscordId(message.author.id);
      const personalizationDisabled = options.personalMemoriesEnabled === false;

      if (!userIsBlacklisted && !personalizationDisabled && userRow?.user_nickname?.trim()) {
        return userRow.user_nickname.trim();
      }
    } catch (error) {
      log.warn("Failed to resolve DB nickname for boomerang context message author", error);
    }
  }

  const member = await resolveGuildMember(message, guildId);
  return resolvePreferredDiscordDisplayName({
    memberDisplayName: member?.displayName,
    user: message.author,
    fallback: stripBridgePrefix(message.author.username),
  });
}
