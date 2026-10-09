import type { ErrorContext } from "@/types/db/schema";
import { isAvatarUpdateRateLimited } from "@/utils/discord/avatarRateLimit";
import { log } from "@/utils/misc/logger";

const GUILD_IDENTITY_TIMEOUT_MS = 15000;

function discordErrorFields(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    if (key === "_errors") return prefix ? [prefix] : [];
    return discordErrorFields(child, prefix ? `${prefix}.${key}` : key);
  });
}

function discordErrorSummary(body: string): { code: number | string; fields: string[] } {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { code: "unknown", fields: [] };
    const error = parsed as Record<string, unknown>;
    return {
      code: typeof error.code === "number" || typeof error.code === "string" ? error.code : "unknown",
      fields: [...new Set(discordErrorFields(error.errors))].slice(0, 20),
    };
  } catch {
    return { code: "unknown", fields: [] };
  }
}

export interface GuildIdentityWriteResult {
  success: boolean;
  error?: "timeout" | "rate_limited" | "api_error";
  details?: string;
}

function guildMemberSelfEndpoint(guildId: string): string {
  return `https://discord.com/api/v10/guilds/${guildId}/members/@me`;
}

async function patchGuildMemberSelf(
  guildId: string,
  payload: Record<string, unknown>,
  operation: string,
  timeoutMs = GUILD_IDENTITY_TIMEOUT_MS,
): Promise<GuildIdentityWriteResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(guildMemberSelfEndpoint(guildId), {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      const summary = discordErrorSummary(errorText);

      // Discord throttles guild identity changes far below its documented buckets, so this is an
      // expected outcome rather than a fault: keep it off the error sink and tell the user to wait
      // instead of showing them raw API JSON.
      if (isAvatarUpdateRateLimited(response.status, errorText)) {
        log.metric("guild_identity_patch_failure", {
          guildId,
          operation,
          httpStatus: response.status,
          discordCode: String(summary.code),
          fields: summary.fields.join(",") || "none",
        });
        return { success: false, error: "rate_limited" };
      }

      const context: ErrorContext = {
        errorType: "DiscordApiError",
        metadata: {
          guildId,
          operation,
          httpStatus: response.status,
          discordCode: summary.code,
          fields: summary.fields,
        },
      };
      await log.error(
        `Failed to update guild ${operation}: ${response.status} ${response.statusText}`,
        undefined,
        context,
      );
      return {
        success: false,
        error: "api_error",
        details: `${response.status} ${response.statusText}`,
      };
    }

    return { success: true };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      log.warn(`Discord API call for guild ${operation} timed out`, { metadata: { guildId } });
      return {
        success: false,
        error: "timeout",
        details: `Discord API call timed out after ${timeoutMs}ms`,
      };
    }

    await log.error(`Error updating guild ${operation} via Discord API`, error, {
      errorType: "DiscordApiError",
      metadata: { guildId, operation },
    });
    return {
      success: false,
      error: "api_error",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

/** A null data URI removes the avatar. */
export function setGuildBotAvatar(
  guildId: string,
  avatarDataUri: string | null,
  timeoutMs?: number,
): Promise<GuildIdentityWriteResult> {
  return patchGuildMemberSelf(guildId, { avatar: avatarDataUri }, "avatar", timeoutMs);
}

export function setGuildBotNickname(guildId: string, nickname: string): Promise<GuildIdentityWriteResult> {
  return patchGuildMemberSelf(guildId, { nick: nickname }, "nickname");
}
