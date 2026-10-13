import type { Guild, Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { CooldownType } from "@/types/db/schema";
import { getCachedUserRow } from "@/utils/cache/userCache";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { ColorCode, log } from "@/utils/misc/logger";
import {
  hasExplicitCrossPersonaTrigger,
  isAutochatCounterChannelActive,
  isAutochatOverrideChannel,
  isAutochatQualifyingMessage,
  isSelfTriggerMessage,
} from "@/utils/chat/triggerProcessor";
import {
  enqueueBusyChannelMessage,
  getOrCreateChannelLockEntry,
  queueFollowUpForLockedTurn,
  releaseStaleChannelLockIfExpired,
  requestNaturalStopForLockedTurn,
} from "@/utils/chat/channelQueue";
import {
  enforceGlobalRateLimit,
  evaluateChatAccess,
  rejectOnMessageTriggerCooldown,
  type ChatAccessState,
} from "@/utils/chat/admissionGuards";
import { shouldBotReply } from "@/utils/chat/replyDecision";
import { shouldSurfaceChatUserErrors } from "@/utils/chat/errorVisibility";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import type { ChatIncoming, NonRunnableChatAdmission } from "@/utils/chat/types";
import type { MessageProxyMessageRecord } from "@/utils/messageProxy/proxyExpectation";

type RateLimitedChannel = Parameters<typeof enforceGlobalRateLimit>[0]["channel"];
type SendableChannel = Parameters<typeof sendStandardEmbed>[0];

const LOG_CHANNEL_NOTICE_COOLDOWN_MS = 10 * 60_000;
/** One entry per channel ever configured as a log channel, so it stays small without a sweeper. */
const logChannelNoticeSentAt = new Map<string, number>();

type AdmissionQueueAndTriggerArgs = {
  incoming: ChatIncoming;
  channelScope: {
    guild: Guild | null;
    serverDiscId: string;
    isDMChannel: boolean;
  };
  earlyTomoriState: TomoriState | null;
  earlyAllPersonas: TomoriState[];
  userDiscId: string;
  cooldownUserDiscId: string;
  isActiveNaturalStopMessage: boolean;
  isNaturalStopMessage: boolean;
  /** Confirmed repost record; its original, when attested, carries the trigger verdict. */
  messageProxyRecord?: MessageProxyMessageRecord | null;
};

export async function evaluateAdmissionQueueAndTriggerGate(
  args: AdmissionQueueAndTriggerArgs,
): Promise<NonRunnableChatAdmission | null> {
  const { incoming, messageProxyRecord } = args;
  // PluralBuddy can verify a repost after the original's wait has ended. The original may
  // already have started a reply, so admitting the repost would answer the same message twice.
  if (
    messageProxyRecord &&
    !messageProxyRecord.originalSuppressed &&
    !incoming.isManuallyTriggered &&
    !incoming.isStopResponse &&
    !incoming.isPersonaJob &&
    !incoming.reminderRecipientID &&
    !incoming.reminderData?.self_reminder
  ) {
    return {
      incoming,
      disposition: "ignore",
      locale: "en-US",
      reason: "proxy_original_already_processed",
    };
  }

  const lockDisposition = await evaluateLockedChannelAdmission(args);
  if (lockDisposition) {
    return lockDisposition;
  }

  return await evaluatePreLockReplyGate(args);
}

async function evaluateLockedChannelAdmission(
  args: AdmissionQueueAndTriggerArgs,
): Promise<NonRunnableChatAdmission | null> {
  const { incoming, channelScope, earlyTomoriState, earlyAllPersonas, userDiscId, cooldownUserDiscId } = args;
  const { client, message } = incoming;
  const triggerMessage = args.messageProxyRecord?.originalMessage ?? message;
  if (incoming.skipLock) {
    return null;
  }
  const shouldSurfaceUserErrors = shouldSurfaceChatUserErrors({
    incoming,
    client,
    message,
    isDMChannel: channelScope.isDMChannel,
    allPersonas: earlyAllPersonas,
  });

  const channelId = message.channel.id;
  const lockEntry = getOrCreateChannelLockEntry(channelId, channelScope.serverDiscId);
  releaseStaleChannelLockIfExpired(channelId, lockEntry);
  if (!lockEntry.isLocked) {
    return null;
  }

  const ignored = (reason: string): NonRunnableChatAdmission => ({
    incoming,
    disposition: "ignore",
    locale: "en-US",
    reason,
  });

  if (StreamOrchestrator.hasStopRequest(channelId) && !StreamOrchestrator.isFollowUpRequest(channelId)) {
    return ignored("locked_stop_requested");
  }

  if (args.isActiveNaturalStopMessage) {
    await requestNaturalStopForLockedTurn({
      channelId,
      serverDiscId: channelScope.serverDiscId,
      lockEntry,
      message,
      client,
    });
    return ignored("locked_natural_stop_requested");
  }

  const textQuotaTriggerKey = incoming.textQuotaTriggerKey ?? message.id;
  const textQuotaUserDiscId = incoming.textQuotaUserDiscId ?? cooldownUserDiscId;
  const followUpOverrides = {
    ...(incoming.manualStreamingContextOverrides?.disableCrossChannelMessage
      ? { disableCrossChannelMessage: true }
      : {}),
    disableRecentMessageReplyTool: true,
  };
  // Skip follow-up path if the message explicitly targets a different persona.
  // activePersonaId must be set (i.e. turn state is established) for this to apply.
  const hasCrossPersonaTrigger =
    lockEntry.activePersonaId !== undefined &&
    hasExplicitCrossPersonaTrigger(triggerMessage, earlyAllPersonas, lockEntry.activePersonaId);

  if (
    !incoming.isStopResponse &&
    !incoming.isPersonaJob &&
    !incoming.isManuallyTriggered &&
    !hasCrossPersonaTrigger &&
    queueFollowUpForLockedTurn({
      lockEntry,
      channelId,
      userDiscId,
      message,
      verifiedProxySenderDiscId: args.messageProxyRecord?.originalSuppressed
        ? args.messageProxyRecord.senderDiscId
        : undefined,
      textQuotaSource: incoming.textQuotaSource,
      textQuotaTriggerKey,
      textQuotaUserDiscId,
      manualStreamingContextOverrides: followUpOverrides,
      isNaturalStopMessage: args.isNaturalStopMessage,
      shouldSurfaceUserErrors: true,
      isUserImpersonation: incoming.isUserImpersonation,
      impersonatedUserId: incoming.impersonatedUserId,
      onGenerationResult: incoming.onGenerationResult,
      onQueueDiscard: incoming.onQueueDiscard,
    })
  ) {
    return {
      incoming,
      disposition: "queued",
      locale: "en-US",
      reason: "locked_follow_up_queued",
    };
  }

  if (!earlyTomoriState) {
    log.info(
      `Channel ${channelId} is busy (msg ${lockEntry.currentMessageId}), but Tomori is not set up on this server. Message ${message.id} ignored for queue.`,
    );
    return ignored("locked_no_persona_state");
  }

  const channelIds = resolveMessageChannelScope(triggerMessage);
  const accessState = await evaluateEarlyAccessState({
    incoming,
    channelScope,
    tomoriState: earlyTomoriState,
    allPersonas: earlyAllPersonas,
    userDiscId,
    channelIds,
    isSelfMessage: isSelfTriggerMessage(triggerMessage, earlyAllPersonas),
    triggerMessage,
  });
  if (accessState.rejectedByWhitelist) {
    return ignored("locked_rejected_by_whitelist");
  }

  const stateForQueueCheck: TomoriState = {
    ...earlyTomoriState,
    autoch_counter: 0,
  };
  const wouldReply =
    incoming.isManuallyTriggered ||
    shouldBotReply(triggerMessage, stateForQueueCheck, earlyAllPersonas, {
      personalAutoTriggerPersonaId: accessState.personalSpotlightStatus?.autoTriggerPersonaId ?? null,
      allowedPersonaIds: accessState.allowedPersonaIds,
    });

  if (!wouldReply) {
    log.info(
      `Channel ${channelId} is busy (msg ${lockEntry.currentMessageId}), but message ${message.id} would not have triggered a reply (autoch_counter simulated as 0 for this check). Ignoring for queue.`,
    );
    return ignored("locked_non_trigger");
  }

  if (!incoming.isStopResponse && !incoming.isPersonaJob) {
    const rateLimitAllowed = await enforceGlobalRateLimit({
      userDiscId,
      serverDiscId: channelScope.serverDiscId,
      channel: message.channel as RateLimitedChannel,
      guild: channelScope.guild,
      client,
      messageId: message.id,
      notifyUser: shouldSurfaceUserErrors,
    });
    if (!rateLimitAllowed) {
      return ignored("locked_rate_limited");
    }
  }

  if (!incoming.isStopResponse && !message.author.bot && !message.webhookId) {
    const tempUserRow = await getCachedUserRow(userDiscId);
    const cooldownLocale = tempUserRow?.language_pref ?? channelScope.guild?.preferredLocale ?? "en-US";
    const rejectedByCooldown = await rejectOnMessageTriggerCooldown({
      serverDiscId: channelScope.serverDiscId,
      userDiscId: cooldownUserDiscId,
      channelId: message.channelId,
      cooldownType: earlyTomoriState.config.cooldown_type ?? CooldownType.OFF,
      member: message.member,
      isAutochatOverride: isAutochatOverrideChannel(earlyTomoriState.config, channelIds.effectiveChannelId),
      author: message.author,
      locale: cooldownLocale,
      botName: earlyTomoriState.persona_nickname,
      notifyUser: shouldSurfaceUserErrors,
    });
    if (rejectedByCooldown) {
      log.info(`Message ${message.id} rejected before queuing due to cooldown.`);
      return ignored("locked_cooldown");
    }
  }

  enqueueBusyChannelMessage({
    lockEntry,
    channelId,
    simulatedAutochatCounterReset: true,
    queuedMessage: {
      message,
      isManuallyTriggered: incoming.isManuallyTriggered,
      forceReason: incoming.forceReason,
      reasoningQuery: incoming.reasoningQuery,
      llmOverrideCodename: incoming.llmOverrideCodename,
      selectedPersonaId: incoming.selectedPersonaId,
      triggeredPersonaIds: incoming.triggeredPersonaIds,
      isPersonaJob: incoming.isPersonaJob,
      isUserImpersonation: incoming.isUserImpersonation || undefined,
      impersonatedUserId: incoming.impersonatedUserId,
      textQuotaSource: incoming.textQuotaSource,
      textQuotaTriggerKey,
      textQuotaUserDiscId,
      manualSystemPrompt: incoming.manualSystemPrompt,
      manualPrefill: incoming.manualPrefill,
      shouldSurfaceUserErrors,
      injectedContextItems: incoming.injectedContextItems,
      forcedMentions: incoming.forcedMentions,
      manualTriggerInvoker: incoming.manualTriggerInvoker,
      systemTriggerIdentity: incoming.systemTriggerIdentity,
      reminderRecipientID: incoming.reminderRecipientID,
      reminderData: incoming.reminderData,
      onGenerationResult: incoming.onGenerationResult,
      onQueueDiscard: incoming.onQueueDiscard,
      sceneTurn: incoming.sceneTurn,
      manualStreamingContextOverrides: incoming.manualStreamingContextOverrides
        ? {
            ...(incoming.manualStreamingContextOverrides.disableCrossChannelMessage
              ? { disableCrossChannelMessage: true }
              : {}),
            ...(incoming.manualStreamingContextOverrides.disableRecentMessageReplyTool
              ? { disableRecentMessageReplyTool: true }
              : {}),
            ...(incoming.manualStreamingContextOverrides.disableReminderTool ? { disableReminderTool: true } : {}),
          }
        : undefined,
    },
  });

  return {
    incoming,
    disposition: "queued",
    locale: "en-US",
    reason: "locked_busy_queued",
  };
}

async function evaluatePreLockReplyGate(args: AdmissionQueueAndTriggerArgs): Promise<NonRunnableChatAdmission | null> {
  const { incoming, channelScope, earlyTomoriState, earlyAllPersonas, userDiscId } = args;
  const message = incoming.message;
  const triggerMessage = args.messageProxyRecord?.originalMessage ?? message;
  if (
    incoming.isManuallyTriggered ||
    incoming.isStopResponse ||
    incoming.isFromQueue ||
    incoming.reminderRecipientID ||
    incoming.reminderData?.self_reminder ||
    incoming.isPersonaJob ||
    !earlyTomoriState
  ) {
    return null;
  }

  if (!channelScope.isDMChannel && earlyTomoriState.config.thought_log_channel_disc_id === message.channel.id) {
    log.info(`Skipping normal chat trigger in configured thought-log channel ${message.channel.id}.`);
    await noticeMentionInLogChannel(incoming, channelScope.guild, userDiscId);
    return {
      incoming,
      disposition: "ignore",
      locale: "en-US",
      reason: "thought_log_channel",
    };
  }

  const channelIds = resolveMessageChannelScope(triggerMessage);
  const isSelfMessage = isSelfTriggerMessage(triggerMessage, earlyAllPersonas);
  const accessState = await evaluateEarlyAccessState({
    incoming,
    channelScope,
    tomoriState: earlyTomoriState,
    allPersonas: earlyAllPersonas,
    userDiscId,
    channelIds,
    isSelfMessage,
    triggerMessage,
  });
  if (accessState.rejectedByWhitelist) {
    return {
      incoming,
      disposition: "ignore",
      locale: "en-US",
      reason: "rejected_by_whitelist_pre_lock",
    };
  }

  const stateForReplyCheck =
    isAutochatCounterChannelActive(earlyTomoriState.config, channelIds.effectiveChannelId) &&
    isAutochatQualifyingMessage(triggerMessage, isSelfMessage)
      ? {
          ...earlyTomoriState,
          autoch_counter: earlyTomoriState.autoch_counter + 1,
        }
      : earlyTomoriState;

  if (
    shouldBotReply(triggerMessage, stateForReplyCheck, earlyAllPersonas, {
      personalAutoTriggerPersonaId: accessState.personalSpotlightStatus?.autoTriggerPersonaId ?? null,
      allowedPersonaIds: accessState.allowedPersonaIds,
      personalDtm: accessState.personalDtm,
    })
  ) {
    return null;
  }

  return {
    incoming,
    disposition: "ignore",
    locale: "en-US",
    reason: "non_trigger_pre_lock",
  };
}

/**
 * Explains a direct mention that the log-channel gate is about to drop.
 *
 * Without this the skip is invisible: chat goes silent in that one channel while slash commands
 * still work there, which admins misread as a Discord permission problem.
 */
async function noticeMentionInLogChannel(
  incoming: ChatIncoming,
  guild: Guild | null,
  userDiscId: string,
): Promise<void> {
  const { client, message } = incoming;
  if (message.author.bot || !client.user || !message.mentions.users.has(client.user.id)) {
    return;
  }

  const lastNoticeAt = logChannelNoticeSentAt.get(message.channelId);
  if (lastNoticeAt !== undefined && Date.now() - lastNoticeAt < LOG_CHANNEL_NOTICE_COOLDOWN_MS) {
    return;
  }
  // Claimed before the send so a burst of mentions cannot each pass the check while the first is in flight.
  logChannelNoticeSentAt.set(message.channelId, Date.now());

  const userRow = await getCachedUserRow(userDiscId);
  const locale = userRow?.language_pref ?? guild?.preferredLocale ?? "en-US";
  try {
    await sendStandardEmbed(message.channel as SendableChannel, locale, {
      color: ColorCode.WARN,
      titleKey: "genai.log_channel_chat_notice_title",
      descriptionKey: "genai.log_channel_chat_notice_description",
    });
  } catch (error) {
    log.warn(`Failed to send log channel notice to channel ${message.channelId}`, error);
  }
}

async function evaluateEarlyAccessState(args: {
  incoming: ChatIncoming;
  channelScope: {
    guild: Guild | null;
    serverDiscId: string;
    isDMChannel: boolean;
  };
  tomoriState: TomoriState;
  allPersonas: TomoriState[];
  userDiscId: string;
  channelIds: { effectiveChannelId: string; parentChannelId?: string };
  isSelfMessage: boolean;
  triggerMessage: Message;
}): Promise<ChatAccessState> {
  const cachedTriggerUser =
    !args.channelScope.isDMChannel && args.tomoriState.server_id ? await getCachedUserRow(args.userDiscId) : null;
  const personalDtm = (cachedTriggerUser?.personal_dtm as "off" | "follow" | "on" | undefined) ?? "follow";

  if (!args.channelScope.guild) {
    return {
      whitelistStatus: null,
      personalSpotlightStatus: null,
      allowedPersonaIds: null,
      blockedPersonaIds: new Set(),
      rejectedByWhitelist: false,
      personalDtm,
    };
  }

  const accessState = await evaluateChatAccess({
    isStopResponse: !!args.incoming.isStopResponse,
    isDMChannel: args.channelScope.isDMChannel,
    isManuallyTriggered: args.incoming.isManuallyTriggered,
    isSelfMessage: args.isSelfMessage,
    isAutochatOverride: isAutochatOverrideChannel(args.tomoriState.config, args.channelIds.effectiveChannelId),
    guildDiscId: args.channelScope.serverDiscId,
    fallbackUserDiscId: args.userDiscId,
    message: args.triggerMessage,
    memberRoleDiscIds: args.incoming.manualTriggerInvoker?.member
      ? args.incoming.manualTriggerInvoker.member.roles.cache.map((role) => role.id)
      : (args.triggerMessage.member?.roles.cache.map((role) => role.id) ?? undefined),
    parentChannelId: args.channelIds.parentChannelId,
    effectiveChannelId: args.channelIds.effectiveChannelId,
    serverId: args.tomoriState.server_id,
    userId: cachedTriggerUser?.user_id,
    allPersonas: args.allPersonas,
  });
  return { ...accessState, personalDtm };
}

function resolveMessageChannelScope(message: Message): { effectiveChannelId: string; parentChannelId?: string } {
  const isThread =
    "isThread" in message.channel && typeof message.channel.isThread === "function" && message.channel.isThread();
  const parentChannelId = isThread && "parent" in message.channel ? message.channel.parent?.id : undefined;
  return {
    effectiveChannelId: parentChannelId ?? message.channelId,
    parentChannelId,
  };
}
