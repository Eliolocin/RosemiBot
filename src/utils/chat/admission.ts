import type { AnyThreadChannel, Guild } from "discord.js";
import { BaseGuildTextChannel, ChannelType, DMChannel, EmbedBuilder, MessageReferenceType } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { PrivacyLevel } from "@/types/db/schema";
import { getCachedBlacklistStatus, getCachedPrivacyLevel, getCachedUserRow } from "@/utils/cache/userCache";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { setCachedVoiceTranscript } from "@/utils/audio/voiceTranscriptCache";
import { transcribeMessageAudioAttachment } from "@/utils/audio/audioAttachmentTranscription";
import { extractBridgeUserId } from "@/utils/bridges";
import { createStandardEmbed, sendStandardEmbed } from "@/utils/discord/embedHelper";
import { extractTextDisplayContent } from "@/utils/discord/componentNoticeReader";
import { sendUserTranscriptViaWebhook } from "@/utils/discord/webhook/webhookCore";
import { getBlockedSendReason } from "@/utils/discord/stream/sendFailureCache";
import { ColorCode, log } from "@/utils/misc/logger";
import {
  doesMessageMatchTrigger,
  isMatrixRelayMessage,
  isRealUserLikeMessage,
  isSelfTriggerMessage,
} from "@/utils/chat/triggerProcessor";
import { getCachedImpersonatedUserIdForWebhook } from "@/utils/chat/webhookIdentity";
import { escapeRegExp, isUnspacedScriptText, wrapWithWordBoundary } from "@/utils/text/processors/regexUtils";
import {
  interruptNudgeScene,
  isActiveNaturalStopTurn,
  isNudgeOutputActive,
  selfReplySuppressionUntil,
} from "@/utils/chat/channelQueue";
import { cleanupTextQuotaTriggerStates } from "@/utils/chat/textQuotaState";
import { evaluateAdmissionQueueAndTriggerGate } from "@/utils/chat/admissionQueue";
import {
  applyMessageProxyReference,
  cancelPendingMessageProxyExpectation,
  createMessageProxyExpectation,
  consumeVerifiedRepostExpectation,
  getMessageProxyMessageRecord,
  getLiveMessageProxyExpectationInstances,
  hasLiveMessageProxyExpectations,
  markMessageProxyExpectationProxied,
  rememberMessageProxyMessage,
  waitForMessageProxyExpectation,
  type MessageProxyMessageRecord,
} from "@/utils/messageProxy/proxyExpectation";
import {
  getSelfReplyChainOriginUser,
  setSelfReplyChainOriginUser,
  updateSelfReplyChainState,
} from "@/utils/chat/selfReplyState";
import type { ChatAdmission, ChatIncoming, NonRunnableChatAdmission, TomoriChatInput } from "@/utils/chat/types";
import { resolveConfiguredProxyService } from "@/utils/messageProxy/registry";
import { formatMessageProxyIdentityUserId } from "@/utils/messageProxy/identityUserId";
import { MAX_CANDIDATE_INSTANCES, routeMessageProxyMessage } from "@/utils/messageProxy/router";
import { persistMessageProxyAttestationIdentity } from "@/utils/messageProxy/persistence";
import { messageProxyInstanceRepository } from "@/utils/db/repositories/MessageProxyInstanceRepository";
import { isMessageProxyInstanceBotPresent } from "@/utils/messageProxy/guildPresence";
import type { Message } from "discord.js";
import { verifyMessageWebhook, isManagedWebhookMessage } from "@/utils/chat/webhookIdentity";

/**
 * Whether a moderator has timed the bot out in this guild.
 *
 * Reads the cached member only. Fetching would turn a per-turn gate into a Discord round trip,
 * and a stale answer is self-correcting: the send path still classifies the resulting 50013.
 */
function isBotTimedOut(guild: Guild, client: ChatIncoming["client"]): boolean {
  if (!client.user) return false;
  const botMember = guild.members.cache.get(client.user.id);
  return botMember?.isCommunicationDisabled() ?? false;
}

/**
 * Admission runs before the trigger user is loaded or registered, so their stored language
 * preference is unavailable; the invoker's client locale and then the guild locale are the best
 * signals at this depth.
 */
function resolveAdmissionNoticeLocale(incoming: ChatIncoming): string {
  return incoming.manualTriggerInvoker?.locale ?? incoming.message.guild?.preferredLocale ?? "en-US";
}

export function normalizeChatInvocation(input: TomoriChatInput): ChatIncoming {
  return {
    client: input.client,
    message: input.message,
    isFromQueue: input.isFromQueue,
    isManuallyTriggered: input.isManuallyTriggered,
    forceReason: input.forceReason,
    reasoningQuery: input.reasoningQuery,
    llmOverrideCodename: input.llmOverrideCodename,
    isStopResponse: input.isStopResponse,
    retryCount: input.retryCount ?? 0,
    skipLock: input.skipLock ?? false,
    reminderRecipientID: input.reminderRecipientID,
    reminderData: input.reminderData,
    selectedPersonaId: input.selectedPersonaId,
    triggeredPersonaIds: input.triggeredPersonaIds,
    isPersonaJob: input.isPersonaJob ?? false,
    isUserImpersonation: input.isUserImpersonation ?? false,
    impersonatedUserId: input.impersonatedUserId,
    textQuotaSource: input.textQuotaSource ?? "user",
    textQuotaTriggerKey: input.textQuotaTriggerKey,
    textQuotaUserDiscId: input.textQuotaUserDiscId,
    manualSystemPrompt: input.manualSystemPrompt,
    manualPrefill: input.manualPrefill,
    naiContinuationPrefill: input.naiContinuationPrefill,
    emptyResponseFinishReason: input.emptyResponseFinishReason,
    shouldSurfaceUserErrors: input.shouldSurfaceUserErrors,
    injectedContextItems: input.injectedContextItems,
    forcedMentions: input.forcedMentions,
    manualTriggerInvoker: input.manualTriggerInvoker,
    systemTriggerIdentity: input.systemTriggerIdentity,
    manualStreamingContextOverrides: input.manualStreamingContextOverrides,
    sceneTurn: input.sceneTurn,
    naturalNudge: input.naturalNudge,
    nudgeSceneCatcherPersonaId: input.nudgeSceneCatcherPersonaId,
    borrowsTriggerMessage: input.borrowsTriggerMessage,
    carriedExpressionDelivery: input.carriedExpressionDelivery,
    onGenerationResult: input.onGenerationResult,
    onQueueDiscard: input.onQueueDiscard,
  };
}

const BASE_TRIGGER_WORDS = process.env.BASE_TRIGGER_WORDS?.split(",").map((word) => word.trim()) || [
  "tomori",
  "tomo",
  "トモリ",
  "ともり",
];
const audioTranscriptionHandledMessages = new WeakSet<Message>();

export async function evaluateChatAdmission(incoming: ChatIncoming): Promise<ChatAdmission> {
  cleanupTextQuotaTriggerStates();

  const { client, message } = incoming;
  const channel = message.channel;
  await verifyMessageWebhook(message);
  let referencedMessagePromise: Promise<Message | null> | undefined;
  const getReferencedMessage = () => (referencedMessagePromise ??= resolveReferencedMessage(message));
  const isBotAuthor = message.author.bot;
  const isWebhookMessage = Boolean(message.webhookId);
  const isInteractionResponse = Boolean(message.interaction);
  const isFromClientUser = Boolean(client.user && message.author.id === client.user.id);
  const isMatrixRelay = isMatrixRelayMessage(message);
  const messageProxyRecord = await resolveMessageProxyRecord(message, isWebhookMessage, isMatrixRelay);
  const isMessageProxy = Boolean(messageProxyRecord);
  const isLikelySelfMessage =
    !isMatrixRelay && !isMessageProxy && (isFromClientUser || isManagedWebhookMessage(message));
  const isRealUserMessage = isRealUserLikeMessage(message);
  const isActiveNaturalStopMessage =
    !incoming.isStopResponse &&
    !incoming.isManuallyTriggered &&
    isRealUserMessage &&
    isNaturalStopMessage(message.content) &&
    isActiveNaturalStopTurn(channel.id, message.author.id);

  const ignored = (reason: string): NonRunnableChatAdmission => ({
    incoming,
    disposition: "ignore",
    locale: "en-US",
    reason,
  });

  const blocked = (reason: string): NonRunnableChatAdmission => ({
    incoming,
    disposition: "blocked",
    locale: "en-US",
    reason,
  });

  if (isWebhookMessage && !isManagedWebhookMessage(message) && !isMessageProxy && !incoming.isManuallyTriggered) {
    return ignored("untrusted_webhook");
  }

  const isSeedPlaceholderMessage =
    isFromClientUser &&
    !isWebhookMessage &&
    message.content === "\u2800" &&
    message.embeds.length === 0 &&
    message.attachments.size === 0;
  if (isSeedPlaceholderMessage && !incoming.isManuallyTriggered) {
    updateSelfReplyChainState(channel.id, false);
    return ignored("seed_placeholder");
  }

  const suppressionUntil = selfReplySuppressionUntil.get(channel.id);
  if (
    !incoming.isManuallyTriggered &&
    isLikelySelfMessage &&
    typeof suppressionUntil === "number" &&
    Date.now() < suppressionUntil
  ) {
    selfReplySuppressionUntil.delete(channel.id);
    updateSelfReplyChainState(channel.id, false);
    return ignored("self_reply_suppressed");
  }

  if (!incoming.isManuallyTriggered && isLikelySelfMessage && isNudgeOutputActive(channel.id)) {
    updateSelfReplyChainState(channel.id, false);
    return ignored("nudge_output");
  }

  if (!incoming.isManuallyTriggered && isLikelySelfMessage && message.reference?.messageId) {
    const referencedMessage = await getReferencedMessage();
    if (
      referencedMessage &&
      (referencedMessage.author.id === client.user?.id || isManagedWebhookMessage(referencedMessage))
    ) {
      updateSelfReplyChainState(channel.id, false);
      return ignored("self_reply_reference");
    }
  }

  if (isRealUserMessage && !isActiveNaturalStopMessage && !incoming.isPersonaJob) {
    updateSelfReplyChainState(channel.id, false);
    // Before every gate below, so a member the trigger checks would ignore still ends the scene.
    if (!incoming.isManuallyTriggered && !incoming.isFromQueue) {
      incoming.nudgeSceneCatcherPersonaId = interruptNudgeScene(channel.id);
    }
  }

  if (channel.type === ChannelType.DM && isBotAuthor && !incoming.isManuallyTriggered) {
    updateSelfReplyChainState(channel.id, false);
    return ignored("bot_dm_message");
  }

  if (isBotAuthor && !incoming.isManuallyTriggered) {
    if (isInteractionResponse) {
      updateSelfReplyChainState(channel.id, false);
      return ignored("bot_interaction_response");
    }
    if (!isFromClientUser && !isWebhookMessage) {
      updateSelfReplyChainState(channel.id, false);
      return ignored("other_bot_message");
    }
  }

  if (isLikelySelfMessage && !incoming.isManuallyTriggered) {
    incoming.isPersonaJob = true;
  }

  if (incoming.isStopResponse) {
    log.info(`Processing stop response for message ${message.id} using original message as passport`);
  }

  if (message.content === "$whoami" && "send" in channel) {
    const whoAmIEmbed = new EmbedBuilder()
      .setTitle("トモリですよ！")
      .setURL("https://github.com/Bredrumb/TomoriBot/")
      .setColor(ColorCode.INFO);

    await channel.send({
      embeds: [whoAmIEmbed],
    });
    return ignored("whoami_easter_egg");
  }

  const chainOriginUserDiscId =
    !incoming.isManuallyTriggered && isLikelySelfMessage ? getSelfReplyChainOriginUser(channel.id) : null;
  // System-initiated turns (reminders, boomerangs) pass whatever message was last in the
  // channel as their trigger, which in a DM is frequently one of Tomori's own. Falling back
  // to the author there would resolve the DM owner (and thus the DM's server key) to the
  // bot itself, so prefer the channel's recipient whenever the author is the client user.
  const dmOwnerDiscId = channel instanceof DMChannel ? (channel.recipientId ?? null) : null;
  const authorFallbackDiscId =
    dmOwnerDiscId && message.author.id === client.user?.id ? dmOwnerDiscId : message.author.id;
  // A system turn borrows an arbitrary channel message as its trigger, so its declared
  // identity outranks a proxy sender that only happens to own that message.
  const userDiscId =
    incoming.manualTriggerInvoker?.userDiscId ??
    incoming.systemTriggerIdentity?.userDiscId ??
    messageProxyRecord?.senderDiscId ??
    chainOriginUserDiscId ??
    authorFallbackDiscId;
  const matrixRelayUserId = isMatrixRelay ? extractBridgeUserId(message.author.username) : undefined;
  const cooldownUserDiscId = matrixRelayUserId ?? userDiscId;

  if (incoming.isManuallyTriggered || !isLikelySelfMessage) {
    setSelfReplyChainOriginUser(channel.id, userDiscId);
  }

  if (!incoming.isManuallyTriggered && !incoming.reminderRecipientID && !incoming.reminderData?.self_reminder) {
    const userPrivacyLevel = await getCachedPrivacyLevel(userDiscId);
    if (userPrivacyLevel === PrivacyLevel.FULL) {
      return blocked("full_privacy_user");
    }
  }

  const channelScope = await resolveAdmissionChannelScope(incoming, userDiscId);
  if (!channelScope) {
    return blocked("unsupported_channel");
  }

  incoming.isManuallyTriggered = channelScope.isManuallyTriggered;

  // Rejected here rather than in the trigger gate because audio admission below spends STT quota
  // and can echo the transcript through a webhook before the trigger gate ever runs.
  if (
    !channelScope.isDMChannel &&
    !incoming.isStopResponse &&
    !incoming.borrowsTriggerMessage &&
    (await getCachedBlacklistStatus(channelScope.serverDiscId, userDiscId))
  ) {
    return blocked("server_blacklisted_user");
  }

  if (!channelScope.isDMChannel && "permissionsFor" in channel) {
    const permissions = client.user ? channel.permissionsFor(client.user) : null;
    if (!permissions) {
      return blocked("missing_channel_permissions");
    }
    const canSend = channelScope.isThreadChannel
      ? permissions.has("SendMessagesInThreads")
      : permissions.has("SendMessages");
    if (!canSend) {
      return blocked("cannot_send_in_channel");
    }

    // A timed-out member keeps every permission bit, so the check above passes while Discord
    // rejects the send with 50013 regardless. Nothing in the bitfield expresses this, so it
    // has to be read from the member rather than inferred from permissions.
    if (isBotTimedOut(channel.guild, client)) {
      return blocked("bot_timed_out_in_guild");
    }

    // Backstop for whatever the two checks above cannot see. They both reason about state that
    // should predict a refusal; this one reacts to a refusal that actually happened, so it holds
    // for causes not yet identified. Cleared the moment a send lands.
    if (getBlockedSendReason(channel.id)) {
      return blocked("recent_send_refused");
    }
  }

  const messageProxyOriginalDisposition = await evaluateMessageProxyOriginalSpeedbump({
    incoming,
    userDiscId,
    isRealUserMessage,
    ignored,
  });
  if (messageProxyOriginalDisposition) {
    return messageProxyOriginalDisposition;
  }

  const { earlyTomoriState, earlyAllPersonas } = await loadEarlyTomoriState(channelScope.serverDiscId, channel.id);

  const referencedMessage = await getReferencedMessage();
  const botReplyBlockReason = await shouldBlockReplyToOtherBot({
    incoming,
    earlyAllPersonas,
    isBotAuthor,
    referencedMessage,
  });
  if (botReplyBlockReason) {
    updateSelfReplyChainState(channel.id, false);
    return ignored(botReplyBlockReason);
  }

  const audioDisposition = await evaluateAudioTranscriptionAdmission({
    incoming,
    earlyTomoriState,
    isWebhookMessage,
    isBotAuthor,
  });
  if (audioDisposition) {
    return audioDisposition;
  }

  const queueDisposition = await evaluateAdmissionQueueAndTriggerGate({
    incoming,
    channelScope,
    earlyTomoriState,
    earlyAllPersonas,
    userDiscId,
    cooldownUserDiscId,
    isActiveNaturalStopMessage,
    isNaturalStopMessage: isNaturalStopMessage(message.content),
    messageProxyRecord,
    referencedMessage,
  });
  if (queueDisposition) {
    return queueDisposition;
  }

  return {
    incoming,
    disposition: "run",
    locale: "en-US",
    client: incoming.client,
    message: incoming.message,
    channel: incoming.message.channel,
    guild: channelScope.guild,
    serverDiscId: channelScope.serverDiscId,
    userDiscId,
    isDMChannel: channelScope.isDMChannel,
    tomoriState: earlyTomoriState ?? undefined,
    allPersonas: earlyAllPersonas,
    cooldownUserDiscId,
    referencedMessage,
  };
}

async function resolveMessageProxyRecord(
  message: Message,
  isWebhookMessage: boolean,
  isMatrixRelay: boolean,
): Promise<MessageProxyMessageRecord | null> {
  const knownRecord = getMessageProxyMessageRecord(message.id);
  if (knownRecord) {
    applyMessageProxyReference(message);
    return knownRecord;
  }

  if (!isWebhookMessage || isMatrixRelay || !hasLiveMessageProxyExpectations(message.channelId)) {
    return null;
  }

  // Client-owned webhooks (persona replies, user impersonation) can never be message-proxy reposts.
  // Skipping them avoids guaranteed transport misses that would stall this message's admission for
  // the full retry cap and extend live speedbump waits. Managed webhook ownership is verified
  // before this check, so a proxy member may safely share a persona's display name.
  if (getCachedImpersonatedUserIdForWebhook(message.webhookId)) {
    return null;
  }
  if (message.guildId) {
    const allPersonas = await getCachedAllPersonas(message.guildId);
    if (isSelfTriggerMessage(message, allPersonas)) {
      return null;
    }
  }

  const liveInstances = getLiveMessageProxyExpectationInstances(message.channelId);
  if (liveInstances.length > MAX_CANDIDATE_INSTANCES) return null;
  const enabledInstances = await Promise.all(
    liveInstances.map((instance) => messageProxyInstanceRepository.getEnabled(instance.serviceId, instance.instanceId)),
  );
  const route = await routeMessageProxyMessage({
    message,
    candidateInstances: enabledInstances.filter((instance) => instance !== null),
  });
  if (route.status !== "matched_trigger_only" && route.status !== "matched_stable_identity") {
    return null;
  }

  const senderRow = await getCachedUserRow(route.attestation.senderDiscordId);
  const selectedService = resolveConfiguredProxyService(senderRow?.message_proxy_service);
  if (
    selectedService !== route.attestation.serviceId ||
    (senderRow?.message_proxy_instance_id ?? `${selectedService}:official`) !== route.attestation.instanceId
  )
    return null;

  await persistMessageProxyAttestationIdentity({
    messageDiscId: message.id,
    attestation: route.attestation,
    serverDiscId: message.guildId ?? null,
    avatarUrl: message.author.avatar ? message.author.displayAvatarURL() : null,
  });

  markMessageProxyExpectationProxied(route.expectation);
  const record = rememberMessageProxyMessage({
    messageDiscId: message.id,
    channelId: message.channelId,
    expectation: route.expectation,
    identityUserDiscId: route.attestation.identity
      ? formatMessageProxyIdentityUserId(
          route.attestation.serviceId,
          route.attestation.identity.externalKey,
          route.attestation.identity.instanceId,
        )
      : null,
    verifiedRepostOnly: route.attestation.originalMessageId === null,
    verifiedRepostReference: route.attestation.replyTarget
      ? {
          channelId: route.attestation.replyTarget.channelId,
          guildId: message.guildId ?? undefined,
          messageId: route.attestation.replyTarget.messageId,
          type: MessageReferenceType.Default,
        }
      : null,
  });
  if (route.attestation.originalMessageId === null) {
    consumeVerifiedRepostExpectation(route.expectation);
  }
  applyMessageProxyReference(message);
  if (route.attestation.serviceId === "pluralbuddy" && !message.content.trim()) {
    const text = extractTextDisplayContent(message.components);
    if (text) {
      Object.defineProperty(message, "content", { value: text, configurable: true, writable: true });
    }
  }

  log.info(
    `Confirmed ${route.attestation.serviceId} message-proxy message ${message.id} in channel ${message.channelId}`,
  );
  return record;
}

/** @internal Exported for focused admission regression tests. */
export async function evaluateMessageProxyOriginalSpeedbump(args: {
  incoming: ChatIncoming;
  userDiscId: string;
  isRealUserMessage: boolean;
  ignored: (reason: string) => NonRunnableChatAdmission;
}): Promise<NonRunnableChatAdmission | null> {
  const { incoming, userDiscId, isRealUserMessage, ignored } = args;
  const { message } = incoming;
  if (
    incoming.isFromQueue ||
    incoming.isManuallyTriggered ||
    incoming.isStopResponse ||
    incoming.reminderRecipientID ||
    incoming.reminderData?.self_reminder ||
    incoming.isPersonaJob ||
    !isRealUserMessage ||
    message.author.bot ||
    message.webhookId ||
    !message.guild
  ) {
    return null;
  }

  const userRow = await getCachedUserRow(userDiscId);
  const serviceId = resolveConfiguredProxyService(userRow?.message_proxy_service);
  if (!serviceId) return null;
  const instance = await messageProxyInstanceRepository.getEnabled(serviceId, userRow?.message_proxy_instance_id);
  if (!instance) return null;

  const expectation = createMessageProxyExpectation({
    instance,
    channelId: message.channelId,
    originalMessageId: message.id,
    senderDiscId: userDiscId,
    originalMessage: message,
    originalReference: message.reference,
  });
  void isMessageProxyInstanceBotPresent(message.guild, instance).then((present) => {
    if (!present) cancelPendingMessageProxyExpectation(expectation);
  });

  const waitResult = await waitForMessageProxyExpectation(expectation);
  if (waitResult === "proxied") {
    return ignored("message_proxy_proxied");
  }

  return null;
}

async function evaluateAudioTranscriptionAdmission(args: {
  incoming: ChatIncoming;
  earlyTomoriState: TomoriState | null;
  isWebhookMessage: boolean;
  isBotAuthor: boolean;
}): Promise<NonRunnableChatAdmission | null> {
  const { incoming, earlyTomoriState, isWebhookMessage, isBotAuthor } = args;
  const { message } = incoming;
  if (hasHandledAudioTranscription(message) || !earlyTomoriState || isWebhookMessage || isBotAuthor) {
    return null;
  }

  const transcriptionResult = await transcribeMessageAudioAttachment(message, earlyTomoriState.server_id);
  if (!transcriptionResult.hasAudio) {
    return null;
  }

  markAudioTranscriptionHandled(message);
  if (transcriptionResult.transcriptText) {
    const isChatMode = earlyTomoriState.config?.voice_transcript_chat_mode ?? true;
    const supportsTranscriptWebhook =
      message.channel instanceof BaseGuildTextChannel ||
      message.channel.type === ChannelType.PublicThread ||
      message.channel.type === ChannelType.PrivateThread ||
      message.channel.type === ChannelType.AnnouncementThread;
    if (isChatMode && supportsTranscriptWebhook) {
      const displayName = message.member?.displayName ?? message.author.displayName;
      const avatarUrl = (message.member ?? message.author).displayAvatarURL({
        size: 256,
        extension: "png",
        forceStatic: true,
      });
      await sendUserTranscriptViaWebhook(
        message.channel as BaseGuildTextChannel | AnyThreadChannel,
        displayName,
        avatarUrl,
        transcriptionResult.transcriptText,
      );
      log.info(
        `[VoiceChat] Posted transcript webhook | msg=${message.id} | chars=${transcriptionResult.transcriptText.length}`,
      );
    } else {
      setCachedVoiceTranscript(message.id, transcriptionResult.transcriptText, "user_stt");
      log.info(`[VoiceCache] SET user_stt | msg=${message.id} | chars=${transcriptionResult.transcriptText.length}`);
    }

    const existingText = message.content.trim();
    const voiceContent = existingText
      ? `${existingText}\n[System: This was sent as a voice message.]\n${transcriptionResult.transcriptText}`
      : `[System: This was sent as a voice message.]\n${transcriptionResult.transcriptText}`;
    applyEffectiveMessageContent(message, voiceContent);
    return null;
  }

  log.warn(
    `Audio transcription failed for message ${message.id}: ${transcriptionResult.failureReason ?? "unknown"}${transcriptionResult.failureDetails ? ` (${transcriptionResult.failureDetails})` : ""}`,
  );
  const hasVisualMedia = message.attachments
    ? [...message.attachments.values()].some((att) => {
        const mime = att.contentType?.toLowerCase() ?? "";
        if (mime.startsWith("video/") || mime.startsWith("image/")) {
          return true;
        }
        return /\.(png|jpe?g|webp|gif|heic|heif|mp4|webm|mov|mpeg|avi)$/i.test(att.name ?? "");
      })
    : false;
  if (message.content.trim().length === 0 && !hasVisualMedia) {
    const shouldSurfaceTranscriptionFailure =
      incoming.shouldSurfaceUserErrors ??
      (Boolean(incoming.manualTriggerInvoker || incoming.reminderRecipientID || incoming.reminderData?.self_reminder) ||
        message.channel.type === ChannelType.DM);
    if (
      shouldSurfaceTranscriptionFailure &&
      transcriptionResult.failureReason !== "no_endpoint" &&
      transcriptionResult.failureReason !== "missing_api_key"
    ) {
      await sendStandardEmbed(
        message.channel as Parameters<typeof sendStandardEmbed>[0],
        resolveAdmissionNoticeLocale(incoming),
        {
          color: ColorCode.WARN,
          titleKey: "general.errors.voice_transcription_failed_title",
          descriptionKey: "general.errors.voice_transcription_failed_description",
        },
      );
    }
    return {
      incoming,
      disposition: "ignore",
      locale: "en-US",
      reason: "voice_transcription_failed",
    };
  }

  return null;
}

function markAudioTranscriptionHandled(message: Message): void {
  audioTranscriptionHandledMessages.add(message);
}

function hasHandledAudioTranscription(message: Message): boolean {
  return audioTranscriptionHandledMessages.has(message);
}

function applyEffectiveMessageContent(message: Message, content: string): void {
  try {
    Object.defineProperty(message, "content", {
      value: content,
      configurable: true,
      writable: true,
    });
  } catch (error) {
    log.warn(`Failed to override message.content for voice transcript on message ${message.id}`, error);
  }

  try {
    Object.defineProperty(message, "cleanContent", {
      value: content,
      configurable: true,
      writable: true,
    });
  } catch (error) {
    log.warn(`Failed to override message.cleanContent for voice transcript on message ${message.id}`, error);
  }
}

export async function handleChatDisposition(admission: NonRunnableChatAdmission): Promise<void> {
  if (admission.error) {
    log.warn(`Chat admission ended with ${admission.disposition}: ${admission.reason}`, admission.error);
    return;
  }

  log.info(`Chat admission ended with ${admission.disposition}: ${admission.reason}`);
}

function isNaturalStopMessage(content: string): boolean {
  if (!content?.trim()) return false;
  return NATURAL_STOP_PATTERNS.some((pattern) => pattern.test(content.toLowerCase()));
}

function createNaturalStopPatterns(): RegExp[] {
  const basicStops = ["wait", "stop", "enough", "chill", "halt", "pause", "quit"];
  const politeStops = ["okay\\s+(stop|enough)", "that's\\s+(enough|good|fine)", "alright\\s+stop", "please\\s+stop"];
  const dismissive = ["nevermind", "never\\s*mind", "cut\\s+it\\s+out", "tone\\s+it\\s+down", "knock\\s+it\\s+off"];
  const japanese = [
    "やめて",
    "ストップ",
    "もういい",
    "十分",
    "もう十分",
    "いいよ",
    "もうやめて",
    "待って",
    "ちょっと待って",
  ];

  // Only the single-word English stops take a word boundary. The Japanese phrases must stay
  // unwrapped: Japanese writes without inter-word spaces, so a boundary would reject every
  // natural form that continues past the phrase (「もういい」 inside 「もういいよ」).
  const patterns: RegExp[] = [];
  for (const stop of basicStops) {
    patterns.push(new RegExp(wrapWithWordBoundary(stop), "iu"));
  }
  for (const polite of politeStops) {
    patterns.push(new RegExp(polite, "i"));
  }
  for (const dismiss of dismissive) {
    patterns.push(new RegExp(wrapWithWordBoundary(dismiss), "iu"));
  }
  for (const jp of japanese) {
    patterns.push(new RegExp(jp, "i"));
  }
  return patterns;
}

const NATURAL_STOP_PATTERNS = createNaturalStopPatterns();

export async function resolveAdmissionChannelScope(
  incoming: ChatIncoming,
  userDiscId: string,
): Promise<{
  guild: Guild | null;
  serverDiscId: string;
  isDMChannel: boolean;
  isThreadChannel: boolean;
  isManuallyTriggered?: boolean;
} | null> {
  const { client, message } = incoming;
  const channel = message.channel;
  const isThreadChannel =
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread;
  const isVoiceChannel = channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice;

  if (channel instanceof BaseGuildTextChannel || isThreadChannel || isVoiceChannel) {
    return {
      guild: message.guild,
      serverDiscId: message.guild?.id ?? userDiscId,
      isDMChannel: false,
      isThreadChannel,
      isManuallyTriggered: incoming.isManuallyTriggered,
    };
  }

  if (channel instanceof DMChannel) {
    // A DM's synthetic server key is its human recipient, which is a property of the
    // channel and not of whoever authored the trigger message. Guilds get this for free
    // via guild.id; DMs must not fall back to the author or a bot-authored trigger
    // message would key the lookup to the bot and report the DM as unconfigured.
    const serverDiscId = incoming.systemTriggerIdentity?.serverDiscId ?? channel.recipientId ?? userDiscId;
    log.info(`Processing DM from user ${userDiscId} in channel ${channel.id}`);
    return {
      guild: null,
      serverDiscId,
      isDMChannel: true,
      isThreadChannel: false,
      isManuallyTriggered: true,
    };
  }

  const hasExplicitErrorVisibility = typeof incoming.shouldSurfaceUserErrors === "boolean";
  let shouldShowError =
    incoming.shouldSurfaceUserErrors ??
    Boolean(incoming.manualTriggerInvoker || incoming.reminderRecipientID || incoming.reminderData?.self_reminder);
  if (!hasExplicitErrorVisibility && !shouldShowError && message.content) {
    shouldShowError = BASE_TRIGGER_WORDS.some((baseWord) => {
      if (isUnspacedScriptText(baseWord)) {
        return message.content.includes(baseWord);
      }
      return new RegExp(wrapWithWordBoundary(escapeRegExp(baseWord)), "iu").test(message.content);
    });
  }
  if (!hasExplicitErrorVisibility && !shouldShowError && client.user && message.mentions.users.has(client.user.id)) {
    shouldShowError = true;
  }
  if (!hasExplicitErrorVisibility && !shouldShowError && message.reference?.messageId) {
    try {
      const referenceMessage = await message.channel.messages.fetch(message.reference.messageId);
      if (referenceMessage && referenceMessage.author.id === client.user?.id) {
        shouldShowError = true;
      }
    } catch {}
  }

  if (shouldShowError && "send" in channel && message.author.id !== client.user?.id) {
    const errorEmbed = createStandardEmbed(resolveAdmissionNoticeLocale(incoming), {
      color: ColorCode.ERROR,
      titleKey: "general.errors.channel_not_supported_title",
      descriptionKey: "general.errors.channel_not_supported_description",
    });

    try {
      await channel.send({ embeds: [errorEmbed] });
    } catch (sendError) {
      log.error("Failed to send unsupported channel type message", sendError);
    }
  }

  return null;
}

async function loadEarlyTomoriState(
  serverDiscId: string,
  channelId: string,
): Promise<{
  earlyTomoriState: TomoriState | null;
  earlyAllPersonas: TomoriState[];
}> {
  try {
    const earlyAllPersonas = await getCachedAllPersonas(serverDiscId);
    return {
      earlyAllPersonas,
      earlyTomoriState: earlyAllPersonas.find((persona) => !persona.is_alter) ?? null,
    };
  } catch (error) {
    await log.error(`Failed to load TomoriState early for server ${serverDiscId} in chat admission.`, error, {
      errorType: "EarlyStateLoadingError",
      metadata: { serverDiscId, channelId },
    });
    return {
      earlyAllPersonas: [],
      earlyTomoriState: null,
    };
  }
}

/**
 * Downstream reply-target readers must use this instance rather than the channel cache, because the
 * capped cache can evict the target and webhook trust is recorded per message object.
 *
 * @internal Exported for focused admission regression tests.
 */
export async function resolveReferencedMessage(message: Message): Promise<Message | null> {
  const referenceId = message.reference?.messageId;
  if (!referenceId || !("messages" in message.channel)) {
    return null;
  }

  let referencedMessage = message.channel.messages.cache.get(referenceId) ?? null;
  // A cached partial has a null author, so it is fetched to hydrate it before any author check.
  if (!referencedMessage || referencedMessage.partial) {
    referencedMessage = await message.channel.messages.fetch(referenceId).catch(() => null);
  }
  if (referencedMessage) await verifyMessageWebhook(referencedMessage);
  return referencedMessage;
}

/** @internal Exported for focused admission regression tests. */
export async function shouldBlockReplyToOtherBot(args: {
  incoming: ChatIncoming;
  earlyAllPersonas: TomoriState[];
  isBotAuthor: boolean;
  referencedMessage: Message | null;
}): Promise<string | null> {
  const { incoming, earlyAllPersonas, isBotAuthor, referencedMessage } = args;
  const { client, message } = incoming;

  if (incoming.isManuallyTriggered || isBotAuthor || !referencedMessage) {
    return null;
  }

  const referencedAuthor = referencedMessage.author;
  if (!referencedAuthor?.bot || referencedAuthor.id === client.user?.id || referencedMessage.webhookId) {
    return null;
  }

  const isBotDirectlyAddressed =
    (client.user && message.mentions.users.has(client.user.id)) ||
    BASE_TRIGGER_WORDS.some((word) => {
      if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(word)) {
        return message.content.includes(word);
      }
      return new RegExp(wrapWithWordBoundary(escapeRegExp(word)), "iu").test(message.content);
    }) ||
    earlyAllPersonas.some((persona) => {
      const triggers = persona.trigger_words ?? [];

      return triggers.some((trigger: string) => doesMessageMatchTrigger(message, trigger));
    });

  return isBotDirectlyAddressed ? null : "reply_to_other_bot";
}
