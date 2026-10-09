import type { AnyThreadChannel, BaseGuildVoiceChannel, Client, Guild, GuildMember, Message, User } from "discord.js";
import type { BaseGuildTextChannel, DMChannel, TextChannel } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { CooldownType } from "@/types/db/schema";
import { getCachedPersonalSpotlightStatus } from "@/utils/cache/personalSpotlightCache";
import { getCachedActiveBlocksForUser } from "@/utils/cache/personaUserBlockCache";
import { getCachedWhitelistStatus } from "@/utils/cache/channelWhitelistCache";
import { getCachedBlacklistStatus, getCachedUserRow } from "@/utils/cache/userCache";
import { getLastDbError } from "@/utils/cache/tomoriStateCache";
import { cooldownRepository } from "@/utils/db/repositories/CooldownRepository";
import { isPersonaAllowedForTrigger } from "@/utils/persona/personaAccess";
import { sendCooldownDM } from "@/utils/discord/cooldownDM";
import { createStandardEmbed, sendStandardEmbed } from "@/utils/discord/embedHelper";
import { ColorCode, log } from "@/utils/misc/logger";
import { checkTextQuota } from "@/utils/quota/textQuotaManager";
import { checkServerRateLimit, checkUserRateLimit } from "@/utils/security/rateLimiter";
import { isBaseTriggerWordMatch } from "@/utils/chat/errorVisibility";
import { isAutochatOverrideChannel } from "@/utils/chat/triggerProcessor";
import type { ChatIncoming } from "@/utils/chat/types";
import {
  buildTextQuotaResetInfo,
  textQuotaTriggerStates,
  type TextQuotaTriggerState,
} from "@/utils/chat/textQuotaState";
import { getServerActiveMessageCount, getUserActiveMessageCount } from "@/utils/chat/channelActivity";
import { resolveReferencedWebhookTarget, verifyMessageWebhook } from "@/utils/chat/webhookIdentity";
import { normalizeRenderModifierName } from "@/utils/discord/renderModifierParser";

export interface ChatAccessState {
  whitelistStatus: Awaited<ReturnType<typeof getCachedWhitelistStatus>> | null;
  personalSpotlightStatus: Awaited<ReturnType<typeof getCachedPersonalSpotlightStatus>> | null;
  allowedPersonaIds: Set<number> | null;
  blockedPersonaIds: Set<number>;
  rejectedByWhitelist: boolean;
  personalDtm?: "off" | "follow" | "on";
}

export interface DirectChatTriggerValidation {
  shouldContinue: boolean;
  isReplyToBot: boolean;
  replyPersona: TomoriState | null;
  isBotMentioned: boolean;
  isDirectUserIntent: boolean;
  isUserImpersonation: boolean;
  impersonatedUserId?: string;
}
export async function enforceGlobalRateLimit(params: {
  userDiscId: string;
  serverDiscId: string;
  channel: TextChannel | DMChannel | BaseGuildTextChannel | AnyThreadChannel | BaseGuildVoiceChannel;
  guild: Guild | null;
  client: Client;
  messageId: string;
  userActiveCountAdjustment?: number;
  serverActiveCountAdjustment?: number;
  notifyUser?: boolean;
}): Promise<boolean> {
  const {
    userDiscId,
    serverDiscId,
    channel,
    guild,
    client,
    messageId,
    userActiveCountAdjustment = 0,
    serverActiveCountAdjustment = 0,
    notifyUser = true,
  } = params;

  const userActiveCount = Math.max(getUserActiveMessageCount(userDiscId) + userActiveCountAdjustment, 0);
  const userRateCheck = checkUserRateLimit(userActiveCount);
  if (!userRateCheck.allowed) {
    const currentCount = userRateCheck.currentCount ?? userActiveCount;
    log.warn(
      `User ${userDiscId} exceeded rate limit (${currentCount}/${userRateCheck.maxLimit} active messages). Dropping message ${messageId}.`,
    );

    if (notifyUser) {
      const tempUserRow = await getCachedUserRow(userDiscId);
      const userLocale = tempUserRow?.language_pref ?? guild?.preferredLocale ?? "en-US";
      await sendUserRateLimitDM(userDiscId, client, userLocale, currentCount);
    }

    return false;
  }

  const serverActiveCount = Math.max(getServerActiveMessageCount(serverDiscId) + serverActiveCountAdjustment, 0);
  const serverRateCheck = checkServerRateLimit(serverActiveCount);
  if (!serverRateCheck.allowed) {
    const currentCount = serverRateCheck.currentCount ?? serverActiveCount;
    log.warn(
      `Server ${serverDiscId} exceeded rate limit (${currentCount}/${serverRateCheck.maxLimit} active messages). Dropping message ${messageId}.`,
    );

    if (notifyUser) {
      const serverLocale = guild?.preferredLocale ?? "en-US";
      await sendServerRateLimitEmbed(channel, serverLocale, currentCount);
    }

    return false;
  }

  return true;
}

export async function rejectOnMessageTriggerCooldown(params: {
  serverDiscId: string;
  userDiscId: string;
  channelId: string;
  cooldownType: CooldownType;
  member: GuildMember | null;
  isAutochatOverride: boolean;
  author: User;
  locale: string;
  botName: string;
  notifyUser?: boolean;
}): Promise<boolean> {
  const cooldownResult = await cooldownRepository.checkMessageTriggerCooldownWithWhitelist(
    params.serverDiscId,
    params.userDiscId,
    params.channelId,
    params.cooldownType,
    params.member,
    params.isAutochatOverride,
  );

  if (!cooldownResult.isOnCooldown) {
    return false;
  }

  if (params.notifyUser !== false) {
    const footerKey = cooldownRepository.getCooldownTypeFooterKey(cooldownResult.cooldownType);
    await sendCooldownDM(
      params.author,
      params.locale,
      "general.message_cooldown_title",
      "general.message_cooldown",
      {
        seconds: cooldownResult.remainingSeconds.toString(),
        botName: params.botName,
      },
      footerKey,
    );
  }
  log.info(
    `Message trigger cooldown active for ${
      cooldownResult.cooldownType === CooldownType.PER_USER
        ? `user ${params.userDiscId}`
        : cooldownResult.cooldownType === CooldownType.PER_CHANNEL
          ? `channel ${params.channelId}`
          : `server ${params.serverDiscId}`
    }. ${cooldownResult.remainingSeconds}s remaining.`,
  );
  return true;
}

export async function setMessageTriggerCooldownForAdmission(params: {
  serverDiscId: string;
  userDiscId: string;
  channelId: string;
  cooldownType: CooldownType;
  cooldownLength: number;
  member: GuildMember | null;
}): Promise<void> {
  await cooldownRepository.setMessageTriggerCooldownWithWhitelist(
    params.serverDiscId,
    params.userDiscId,
    params.channelId,
    params.cooldownType,
    params.cooldownLength,
    params.member,
  );
}

/**
 * The channel a message's channel-scoped configuration applies to.
 *
 * A thread's messages carry their parent's scope for settings such as the auto-chat override,
 * while reads and writes keyed on the message itself keep the thread's own id.
 */
export function resolveChannelScope(message: Message): { effectiveChannelId: string; parentChannelId?: string } {
  const isThread =
    "isThread" in message.channel && typeof message.channel.isThread === "function" && message.channel.isThread();
  const parentChannelId = isThread && "parent" in message.channel ? message.channel.parent?.id : undefined;
  return { effectiveChannelId: parentChannelId ?? message.channelId, parentChannelId };
}

/**
 * Applies the server's message-trigger cooldown to a turn that answers on the server's credentials.
 *
 * Planning runs this for a server-sourced turn. The server route a personal turn can fall back to
 * has to run it as well, because the server is now the one paying: without it, a personal provider
 * that fails on every message would buy a server reply on every message for as long as the server's
 * quota allows, and a server that leaves quota off would never stop.
 *
 * @returns false when the caller must not proceed, the same answer planning gives a cooldown hit.
 */
export async function enforceServerTriggerCooldownForAdmission(params: {
  serverDiscId: string;
  cooldownUserDiscId: string;
  message: Message;
  tomoriState: TomoriState;
  locale: string;
  notifyUser?: boolean;
}): Promise<boolean> {
  const cooldownType = params.tomoriState.config.cooldown_type ?? CooldownType.OFF;
  const rejectedByCooldown = await rejectOnMessageTriggerCooldown({
    serverDiscId: params.serverDiscId,
    userDiscId: params.cooldownUserDiscId,
    channelId: params.message.channelId,
    cooldownType,
    member: params.message.member,
    isAutochatOverride: isAutochatOverrideChannel(
      params.tomoriState.config,
      resolveChannelScope(params.message).effectiveChannelId,
    ),
    author: params.message.author,
    locale: params.locale,
    botName: params.tomoriState.persona_nickname,
    notifyUser: params.notifyUser,
  });
  if (rejectedByCooldown) {
    return false;
  }

  await setMessageTriggerCooldownForAdmission({
    serverDiscId: params.serverDiscId,
    userDiscId: params.cooldownUserDiscId,
    channelId: params.message.channelId,
    cooldownType,
    cooldownLength: params.tomoriState.config.cooldown_length ?? 5,
    member: params.message.member,
  });
  return true;
}

/**
 * Whether this turn draws on a server's text quota once it runs on the server's credentials.
 *
 * Direct messages, system-initiated turns, reminder deliveries, and stop responses never count
 * against a server's text quota. The caller decides the credential route separately, because a
 * turn planned on personal credentials only reaches this quota if it falls back to the server.
 */
export function shouldApplyServerTextQuota(incoming: ChatIncoming, isDMChannel: boolean | undefined): boolean {
  return (
    incoming.textQuotaSource === "user" &&
    !isDMChannel &&
    !incoming.isStopResponse &&
    !incoming.reminderRecipientID &&
    !incoming.reminderData?.self_reminder
  );
}

export async function checkTextQuotaForAdmission(params: {
  shouldApplyTextQuota: boolean;
  isPersonaJob: boolean;
  triggerKey: string;
  serverId: number;
  userDiscId: string;
  channel: TextChannel | DMChannel | BaseGuildTextChannel | AnyThreadChannel | BaseGuildVoiceChannel;
  locale: string;
  notifyUser?: boolean;
}): Promise<{ allowed: true; state: TextQuotaTriggerState | null } | { allowed: false; state: null }> {
  if (!params.shouldApplyTextQuota) {
    return { allowed: true, state: null };
  }

  const existingTextQuotaState = textQuotaTriggerStates.get(params.triggerKey);

  if (params.isPersonaJob) {
    return {
      allowed: true,
      state: existingTextQuotaState ?? null,
    };
  }

  if (existingTextQuotaState) {
    return {
      allowed: true,
      state: existingTextQuotaState,
    };
  }

  const quotaCheck = await checkTextQuota(params.serverId, params.userDiscId);

  if (!quotaCheck.allowed) {
    const resetInfo = buildTextQuotaResetInfo(params.locale, quotaCheck);
    let descriptionKey = "genai.text_quota_exceeded_description";

    if (quotaCheck.reason === "user_quota_exceeded") {
      descriptionKey = "genai.text_user_quota_exceeded_description";
    } else if (quotaCheck.reason === "serverwide_quota_exceeded") {
      descriptionKey = "genai.text_serverwide_quota_exceeded_description";
    }

    if (params.notifyUser !== false) {
      await sendStandardEmbed(params.channel, params.locale, {
        color: ColorCode.ERROR,
        titleKey: "genai.text_quota_exceeded_title",
        descriptionKey,
        descriptionVars: {
          reset_info: resetInfo,
        },
        footerKey: "genai.text_quota_exceeded_footer",
      });
    }
    return { allowed: false, state: null };
  }

  const textQuotaStateForTrigger: TextQuotaTriggerState = {
    serverId: params.serverId,
    userDiscId: params.userDiscId,
    consumed: false,
    createdAt: Date.now(),
  };
  textQuotaTriggerStates.set(params.triggerKey, textQuotaStateForTrigger);

  return {
    allowed: true,
    state: textQuotaStateForTrigger,
  };
}

export async function evaluateChatAccess(params: {
  isStopResponse: boolean;
  isDMChannel: boolean;
  isManuallyTriggered?: boolean;
  isSelfMessage: boolean;
  isAutochatOverride: boolean;
  guildDiscId: string;
  fallbackUserDiscId: string;
  message: Message;
  memberRoleDiscIds?: string[];
  parentChannelId?: string;
  effectiveChannelId: string;
  serverId: number;
  userId?: number | null;
  allPersonas: TomoriState[];
}): Promise<ChatAccessState> {
  if (params.isStopResponse) {
    return {
      whitelistStatus: null,
      personalSpotlightStatus: null,
      allowedPersonaIds: null,
      blockedPersonaIds: new Set(),
      rejectedByWhitelist: false,
    };
  }

  const whitelistStatus = await getCachedWhitelistStatus(
    params.guildDiscId || params.fallbackUserDiscId,
    params.message.channelId,
    params.memberRoleDiscIds,
    params.parentChannelId,
  );
  const personalSpotlightStatus =
    !params.isDMChannel && params.userId
      ? await getCachedPersonalSpotlightStatus(params.serverId, params.userId, params.effectiveChannelId)
      : null;

  const shouldEnforceWhitelistGate = params.isManuallyTriggered || !params.isSelfMessage;
  const rejectedByWhitelist =
    shouldEnforceWhitelistGate && !whitelistStatus.isTriggerAllowed && !params.isAutochatOverride;
  if (rejectedByWhitelist) {
    log.info(
      `Message ${params.message.id} in channel ${params.message.channelId} rejected by whitelist policy (${whitelistStatus.blockReason ?? "unknown"})`,
    );
  }

  const policyAllowedPersonaIds =
    whitelistStatus.hasActivePersonaWhitelist || personalSpotlightStatus
      ? new Set(
          params.allPersonas.flatMap((persona) =>
            typeof persona.persona_id === "number" &&
            isPersonaAllowedForTrigger(whitelistStatus, personalSpotlightStatus, persona.persona_id)
              ? [persona.persona_id]
              : [],
          ),
        )
      : null;
  const blockedPersonaIds = await resolveBlockedPersonaIdsForTrigger(params);
  const allowedPersonaIds =
    blockedPersonaIds.size === 0
      ? policyAllowedPersonaIds
      : filterAllowedPersonaIdsByBlocks(params.allPersonas, policyAllowedPersonaIds, blockedPersonaIds);

  return {
    whitelistStatus,
    personalSpotlightStatus,
    allowedPersonaIds,
    blockedPersonaIds,
    rejectedByWhitelist,
  };
}

async function resolveBlockedPersonaIdsForTrigger(params: {
  isDMChannel: boolean;
  isStopResponse: boolean;
  guildDiscId: string;
  serverId: number;
  fallbackUserDiscId: string;
  allPersonas: TomoriState[];
}): Promise<Set<number>> {
  if (params.isDMChannel || params.isStopResponse) {
    return new Set();
  }

  const knownPersonaIds = new Set(
    params.allPersonas.flatMap((persona) => (typeof persona.persona_id === "number" ? [persona.persona_id] : [])),
  );

  // A server blacklist entry is a block on every persona, so every trigger path that already
  // honours persona blocks refuses a blacklisted member without a separate check.
  if (params.guildDiscId && (await getCachedBlacklistStatus(params.guildDiscId, params.fallbackUserDiscId))) {
    return knownPersonaIds;
  }

  const activeBlocks = await getCachedActiveBlocksForUser(params.serverId, params.fallbackUserDiscId);
  if (activeBlocks.length === 0) {
    return new Set();
  }

  return new Set(
    activeBlocks
      .map((block) => block.persona_id)
      .filter((personaId): personaId is number => knownPersonaIds.has(personaId)),
  );
}

function filterAllowedPersonaIdsByBlocks(
  allPersonas: TomoriState[],
  policyAllowedPersonaIds: Set<number> | null,
  blockedPersonaIds: Set<number>,
): Set<number> {
  const baseAllowedPersonaIds =
    policyAllowedPersonaIds ??
    new Set(allPersonas.flatMap((persona) => (typeof persona.persona_id === "number" ? [persona.persona_id] : [])));
  const filtered = new Set<number>();
  for (const personaId of baseAllowedPersonaIds) {
    if (!blockedPersonaIds.has(personaId)) {
      filtered.add(personaId);
    }
  }
  return filtered;
}

export async function validateDirectChatTrigger(params: {
  client: Client;
  message: Message;
  guild: Guild | null;
  allPersonas: TomoriState[];
  tomoriState: TomoriState | null | undefined;
  isDMChannel: boolean;
  isManuallyTriggered?: boolean;
  userDiscId: string;
  serverDiscId: string;
  locale: string;
}): Promise<DirectChatTriggerValidation> {
  const personaByNickname = new Map<string, TomoriState>();
  for (const persona of params.allPersonas) {
    const nicknameKey = persona.persona_nickname ? normalizeRenderModifierName(persona.persona_nickname) : "";
    if (!nicknameKey || personaByNickname.has(nicknameKey)) continue;
    personaByNickname.set(nicknameKey, persona);
  }

  let isReplyToBot = false;
  let replyPersona: TomoriState | null = null;
  let isUserImpersonation = false;
  let impersonatedUserId: string | undefined;

  if (params.message.reference?.messageId) {
    try {
      const referenceMessage = await params.message.channel.messages.fetch(params.message.reference.messageId);
      if (referenceMessage) {
        if (referenceMessage.author.id === params.client.user?.id) {
          isReplyToBot = true;
        } else if (referenceMessage.webhookId) {
          await verifyMessageWebhook(referenceMessage);
          const webhookReplyTarget = resolveReferencedWebhookTarget(referenceMessage, personaByNickname, params.guild);

          if (webhookReplyTarget.replyPersona) {
            replyPersona = webhookReplyTarget.replyPersona;
          } else if (webhookReplyTarget.impersonatedUserId) {
            isReplyToBot = true;
            isUserImpersonation = true;
            impersonatedUserId = webhookReplyTarget.impersonatedUserId;
            log.info(
              `Reply ${params.message.id} matched user impersonation webhook. Target user: ${impersonatedUserId}`,
            );
          }
        }
      }
    } catch (fetchError) {
      log.warn("Could not fetch reference message for reply check", fetchError);
    }
  }

  const isReplyToPersona = isReplyToBot || !!replyPersona;
  const isBaseTriggerWord = isBaseTriggerWordMatch(params.message.content);
  const isBotMentioned = !!(params.client.user && params.message.mentions.users.has(params.client.user.id));
  const isDirectUserIntent = isBaseTriggerWord || isReplyToPersona || isBotMentioned;
  const shouldValidateState =
    isBaseTriggerWord ||
    isReplyToPersona ||
    isBotMentioned ||
    params.isManuallyTriggered ||
    (params.isDMChannel && params.message.author.id !== params.client.user?.id);

  if (shouldValidateState && !params.tomoriState) {
    const contextMessage = params.isDMChannel
      ? `User tried to use Tomori in DM but no Tomori instance found for user ${params.userDiscId}.`
      : `User mentioned Tomori in server ${params.serverDiscId} but Tomori not set up.`;
    log.info(contextMessage);

    const dbError = getLastDbError(params.serverDiscId);
    const responseChannel = params.message.channel as
      | TextChannel
      | DMChannel
      | BaseGuildTextChannel
      | AnyThreadChannel
      | BaseGuildVoiceChannel;
    if (dbError) {
      await sendStandardEmbed(responseChannel, params.locale, {
        color: ColorCode.WARN,
        titleKey: "general.errors.tomori_updating_title",
        descriptionKey: "general.errors.tomori_updating_description",
      });
    } else {
      await sendStandardEmbed(responseChannel, params.locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        ...(params.isDMChannel && {
          footerKey: "general.errors.tomori_not_setup_dm_footer",
        }),
      });
    }

    return {
      shouldContinue: false,
      isReplyToBot,
      replyPersona,
      isBotMentioned,
      isDirectUserIntent,
      isUserImpersonation,
      impersonatedUserId,
    };
  }

  if (shouldValidateState && params.tomoriState && !params.tomoriState.config.api_key) {
    const contextMessage = params.isDMChannel
      ? `No server API key configured for DM user ${params.userDiscId}; deferring final credential resolution.`
      : `No server API key configured for server ${params.serverDiscId}; deferring final credential resolution.`;
    log.info(contextMessage);
  }

  if (!shouldValidateState && !params.tomoriState) {
    return {
      shouldContinue: false,
      isReplyToBot,
      replyPersona,
      isBotMentioned,
      isDirectUserIntent,
      isUserImpersonation,
      impersonatedUserId,
    };
  }

  return {
    shouldContinue: true,
    isReplyToBot,
    replyPersona,
    isBotMentioned,
    isDirectUserIntent,
    isUserImpersonation,
    impersonatedUserId,
  };
}

async function sendUserRateLimitDM(
  userDiscId: string,
  client: Client,
  userLocale: string,
  currentCount: number,
): Promise<void> {
  try {
    const user = await client.users.fetch(userDiscId);
    const rateLimitEmbed = createStandardEmbed(userLocale, {
      titleKey: "rate_limit.user_exceeded_title",
      descriptionKey: "rate_limit.user_exceeded_description",
      color: ColorCode.WARN,
    });

    await user.send({ embeds: [rateLimitEmbed] });
    log.info(`Sent rate limit DM to user ${userDiscId} (${currentCount} active messages)`);
  } catch (error) {
    log.info(
      `Could not send rate limit DM to user ${userDiscId}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

async function sendServerRateLimitEmbed(
  channel: TextChannel | DMChannel | BaseGuildTextChannel | AnyThreadChannel | BaseGuildVoiceChannel,
  locale: string,
  currentCount: number,
): Promise<void> {
  try {
    await sendStandardEmbed(channel, locale, {
      titleKey: "rate_limit.server_exceeded_title",
      descriptionKey: "rate_limit.server_exceeded_description",
      color: ColorCode.WARN,
    });
    log.info(`Sent rate limit embed to channel ${channel.id} (${currentCount} active messages in server)`);
  } catch (error) {
    log.warn(`Failed to send rate limit embed to channel ${channel.id}`, error);
  }
}
