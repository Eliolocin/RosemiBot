import type { GuildMember } from "discord.js";
import type { PersonaUserBlockRow, PersonaUserBlockType } from "@/types/db/schema";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { invalidatePersonaUserBlockCache } from "@/utils/cache/personaUserBlockCache";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { resolveUserTarget } from "@/utils/discord/targetResolver";
import { personaUserBlockRepository } from "@/utils/db/repositories";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { formatTimeWithOffset, formatUTCOffset } from "@/utils/text/timezoneHelper";

/** One week, the ceiling a persona may block a user for in a single tool call. */
export const DEFAULT_BLOCK_USER_MAX_DURATION_HOURS = 168;

export type ParsedBlockUserArgs =
  | {
      ok: true;
      blockedUser: string;
      blockType: PersonaUserBlockType;
      durationHours: number;
      reason: string;
    }
  | {
      ok: false;
      status:
        | "user_block_failed_invalid_target"
        | "user_block_failed_invalid_type"
        | "user_block_failed_invalid_duration"
        | "user_block_failed_invalid_reason";
      reason: string;
    };

export type ResolvedBlockTarget =
  | {
      ok: true;
      userDiscId: string;
      displayLabel: string;
      member: GuildMember | null;
    }
  | {
      ok: false;
      status:
        | "user_block_failed_ambiguous_user"
        | "user_block_failed_user_not_found"
        | "user_block_failed_bridge_user"
        | "user_block_failed_bot_target"
        | "user_block_failed_internal_error";
      reason: string;
      candidates?: string[];
    };

export function parseBlockUserArgs(
  args: Record<string, unknown>,
  maxDurationHours = DEFAULT_BLOCK_USER_MAX_DURATION_HOURS,
): ParsedBlockUserArgs {
  const blockedUserArg = args.blocked_user;
  if (typeof blockedUserArg !== "string" || blockedUserArg.trim().length === 0) {
    return {
      ok: false,
      status: "user_block_failed_invalid_target",
      reason: "The 'blocked_user' argument must be a non-empty user name.",
    };
  }

  const blockTypeArg = args.block_type;
  if (blockTypeArg !== "mute" && blockTypeArg !== "block") {
    return {
      ok: false,
      status: "user_block_failed_invalid_type",
      reason: "The 'block_type' argument must be either 'mute' or 'block'.",
    };
  }

  const durationArg = args.block_duration_hours;
  if (
    typeof durationArg !== "number" ||
    !Number.isSafeInteger(durationArg) ||
    durationArg <= 0 ||
    durationArg > maxDurationHours
  ) {
    return {
      ok: false,
      status: "user_block_failed_invalid_duration",
      reason: `The 'block_duration_hours' argument must be an integer from 1 to ${maxDurationHours}.`,
    };
  }

  const reasonArg = args.block_reason;
  if (typeof reasonArg !== "string" || reasonArg.trim().length === 0) {
    return {
      ok: false,
      status: "user_block_failed_invalid_reason",
      reason: "The 'block_reason' argument must be a non-empty string.",
    };
  }

  return {
    ok: true,
    blockedUser: blockedUserArg.trim(),
    blockType: blockTypeArg,
    durationHours: durationArg,
    reason: reasonArg.trim(),
  };
}

export function buildFailureResult(status: string, reason: string, extraData?: Record<string, unknown>): ToolResult {
  return {
    success: false,
    error: reason,
    data: {
      status,
      reason,
      ...extraData,
    },
  };
}

export async function missingBlockNoticePermission(context: ToolContext): Promise<string | null> {
  if (!context.guildId) return null;
  const guild = context.client.guilds.cache.get(context.guildId);
  const member = guild?.members.me ?? (await guild?.members.fetchMe().catch(() => null));
  const permissions = member && "permissionsFor" in context.channel ? context.channel.permissionsFor(member) : null;
  const sendPermission = context.channel.isThread() ? "SendMessagesInThreads" : "SendMessages";
  for (const permission of ["ViewChannel", sendPermission, "EmbedLinks"] as const) {
    if (!permissions?.has(permission)) return permission;
  }
  return null;
}

export async function resolveDiscordBlockTarget(input: string, context: ToolContext): Promise<ResolvedBlockTarget> {
  const resolution = await resolveUserTarget(input, context);
  if (resolution.status === "ambiguous") {
    return {
      ok: false,
      status: "user_block_failed_ambiguous_user",
      reason: `Multiple users match "${input}". Please clarify: ${resolution.candidates
        .map((candidate) => candidate.label)
        .join(", ")}.`,
      candidates: resolution.candidates.map((candidate) => candidate.label),
    };
  }

  if (resolution.status === "not_found") {
    return {
      ok: false,
      status: "user_block_failed_user_not_found",
      reason: `Could not find a Discord user matching "${input}" in this conversation or server.`,
    };
  }

  if (resolution.isBridgeUser) {
    return {
      ok: false,
      status: "user_block_failed_bridge_user",
      reason: "Persona user blocks currently support Discord server members only.",
    };
  }

  const guild = context.guildId
    ? (context.client.guilds.cache.get(context.guildId) ??
      (await context.client.guilds.fetch(context.guildId).catch(() => null)))
    : null;
  const member = guild ? await guild.members.fetch(resolution.targetId).catch(() => null) : null;
  const fetchedUser = member?.user ?? (await context.client.users.fetch(resolution.targetId).catch(() => null));

  if (fetchedUser?.bot) {
    return {
      ok: false,
      status: "user_block_failed_bot_target",
      reason: "Bots cannot be targeted by persona user blocks.",
    };
  }

  if (!fetchedUser && !member) {
    return {
      ok: false,
      status: "user_block_failed_user_not_found",
      reason: `Could not find a Discord user matching "${input}" in this server.`,
    };
  }

  return {
    ok: true,
    userDiscId: resolution.targetId,
    displayLabel: resolution.displayLabel,
    member,
  };
}

/**
 * Builds the dialogue-history placeholder shown in place of a 'block'-type user's
 * live messages. Instead of silently dropping their messages from context, the
 * persona sees a single English `[System: ...]` notice (mirroring reminder/join
 * system injections, which are intentionally LLM-facing and not localized).
 *
 * @param displayName - Name the persona knows the blocked user by.
 * @param expiresAt - When the active block lapses; used to derive hours remaining.
 * @param now - Reference time, injectable for deterministic tests (defaults to now).
 * @returns A `[System: ...]` notice string for the simplified history.
 */
export function formatBlockedUserNoticeContent(displayName: string, expiresAt: Date, now: Date = new Date()): string {
  // Round remaining time up to whole hours, flooring at 1 so a block that is
  //    minutes from expiry still reads as "1 more hour" rather than "0".
  const hoursRemaining = Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 3_600_000));
  // Pluralize the unit so the notice reads naturally for the persona.
  const hourLabel = hoursRemaining === 1 ? "hour" : "hours";
  return `[System: ${displayName} sent a message but is currently blocked by you for ${hoursRemaining} more ${hourLabel}.]`;
}

function formatExpiry(expiresAt: Date, timezoneOffset: number, locale: string): string {
  return `${formatTimeWithOffset(
    expiresAt,
    timezoneOffset,
    {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
    locale,
  )} (${formatUTCOffset(timezoneOffset)})`;
}

export function getBlockTypeLabel(locale: string, blockType: PersonaUserBlockType): string {
  return localizer(locale, `tools.user_block.type_${blockType}`);
}

export function getBlockEffectText(locale: string, blockType: PersonaUserBlockType): string {
  return localizer(locale, `tools.user_block.effect_${blockType}`);
}

export async function sendUserBlockedEmbed(params: {
  context: ToolContext;
  targetDisplayName: string;
  blockType: PersonaUserBlockType;
  durationHours: number;
  reason: string;
  expiresAt: Date;
}): Promise<void> {
  const personaName =
    params.context.personaUsername ||
    params.context.tomoriState.persona_nickname ||
    params.context.client.user?.username ||
    "TomoriBot";
  const timezoneOffset = params.context.tomoriState.config.timezone_offset ?? 0;
  const locale = params.context.locale;

  await sendStandardEmbed(
    params.context.channel,
    locale,
    {
      titleKey:
        params.blockType === "mute" ? "tools.user_block.block_mute_title" : "tools.user_block.block_block_title",
      titleVars: {
        persona_name: personaName,
        user_name: params.targetDisplayName,
        duration_hours: params.durationHours,
      },
      descriptionKey:
        params.blockType === "mute"
          ? "tools.user_block.mute_success_description"
          : "tools.user_block.block_success_description",
      descriptionVars: {
        user_name: params.targetDisplayName,
        persona_name: personaName,
        block_type: getBlockTypeLabel(locale, params.blockType),
        effect: getBlockEffectText(locale, params.blockType),
        duration_hours: params.durationHours,
        expires_at: formatExpiry(params.expiresAt, timezoneOffset, locale),
      },
      footerKey: "tools.user_block.block_footer",
      color: params.blockType === "mute" ? ColorCode.WARN : ColorCode.ERROR,
    },
    {
      webhook: params.context.webhook,
      personaUsername: params.context.personaUsername,
      personaAvatarUrl: params.context.personaAvatarUrl,
    },
  );
}

export async function sendUserUnblockedEmbed(params: {
  context: ToolContext;
  targetDisplayName: string;
  removedBlock: PersonaUserBlockRow;
}): Promise<void> {
  const personaName =
    params.context.personaUsername ||
    params.context.tomoriState.persona_nickname ||
    params.context.client.user?.username ||
    "TomoriBot";
  const locale = params.context.locale;

  await sendStandardEmbed(
    params.context.channel,
    locale,
    {
      titleKey:
        params.removedBlock.block_type === "mute"
          ? "tools.user_block.unmute_success_title"
          : "tools.user_block.unblock_success_title",
      titleVars: {
        persona_name: personaName,
        user_name: params.targetDisplayName,
      },
      descriptionKey: "tools.user_block.unblock_success_description",
      descriptionVars: {
        user_name: params.targetDisplayName,
        persona_name: personaName,
        block_type: getBlockTypeLabel(locale, params.removedBlock.block_type),
      },
      color: ColorCode.SUCCESS,
    },
    {
      webhook: params.context.webhook,
      personaUsername: params.context.personaUsername,
      personaAvatarUrl: params.context.personaAvatarUrl,
    },
  );
}

export async function upsertPersonaUserBlock(params: {
  context: ToolContext;
  userDiscId: string;
  blockType: PersonaUserBlockType;
  reason: string;
  expiresAt: Date;
}): Promise<PersonaUserBlockRow | null> {
  const personaId = params.context.tomoriState.persona_id;
  const serverId = params.context.tomoriState.server_id;
  if (!personaId || !serverId) {
    log.error("Missing persona/server ID for persona user block upsert");
    return null;
  }

  const row = await personaUserBlockRepository.upsertBlock({
    serverId,
    personaId,
    userDiscId: params.userDiscId,
    blockType: params.blockType,
    reason: params.reason,
    expiresAt: params.expiresAt,
  });

  if (row) {
    invalidatePersonaUserBlockCache(serverId, personaId, params.userDiscId);
  }
  return row;
}

export async function removePersonaUserBlock(params: {
  context: ToolContext;
  userDiscId: string;
}): Promise<PersonaUserBlockRow | null> {
  const personaId = params.context.tomoriState.persona_id;
  const serverId = params.context.tomoriState.server_id;
  if (!personaId || !serverId) {
    log.error("Missing persona/server ID for persona user block removal");
    return null;
  }

  const row = await personaUserBlockRepository.removeActiveBlock(serverId, personaId, params.userDiscId);
  if (row) {
    invalidatePersonaUserBlockCache(serverId, personaId, params.userDiscId);
  }
  return row;
}
