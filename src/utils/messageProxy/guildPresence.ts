import type { Guild } from "discord.js";
import type { MessageProxyInstanceContext } from "@/utils/messageProxy/instances";

const UNKNOWN_MEMBER_ERROR_CODE = 10007;
const ABSENT_BOT_CACHE_TTL_MS = 30_000;
const absentBotUntil = new Map<string, number>();

function absenceKey(guildId: string, botUserId: string): string {
  return `${guildId}\0${botUserId}`;
}

function discordErrorCode(error: unknown): string | number | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? code : null;
}

export async function isMessageProxyInstanceBotPresent(
  guild: Guild,
  instance: MessageProxyInstanceContext,
): Promise<boolean> {
  const botUserId = instance.botUserId?.trim();
  if (!botUserId) return true;

  const key = absenceKey(guild.id, botUserId);
  if (guild.members.cache.has(botUserId)) {
    absentBotUntil.delete(key);
    return true;
  }

  const absentUntil = absentBotUntil.get(key);
  if (absentUntil && absentUntil > Date.now()) return false;
  if (absentUntil) absentBotUntil.delete(key);

  try {
    await guild.members.fetch(botUserId);
    absentBotUntil.delete(key);
    return true;
  } catch (error) {
    const code = discordErrorCode(error);
    if (code === UNKNOWN_MEMBER_ERROR_CODE || code === String(UNKNOWN_MEMBER_ERROR_CODE)) {
      absentBotUntil.set(key, Date.now() + ABSENT_BOT_CACHE_TTL_MS);
      return false;
    }

    // Presence is only an optimization gate. A transient Discord failure must not disable
    // message-proxy handling, because the selected bot may still be installed.
    return true;
  }
}

export function clearMessageProxyGuildPresenceStateForTests(): void {
  absentBotUntil.clear();
}
