import type { Guild, GuildMember, Message } from "discord.js";
import type { TomoriState, UserRow } from "@/types/db/schema";
import { PrivacyLevel } from "@/types/db/schema";
import { DatabaseUnavailableError } from "@/types/errors";
import { getCachedUserRow, getCachedBlacklistStatus, getCachedPrivacyLevel } from "@/utils/cache/userCache";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { configRepository, userRepository, whitelistRepository } from "@/utils/db/repositories";
import { isPersonaAllowedForTrigger } from "@/utils/persona/personaAccess";
import { resolvePreferredDiscordDisplayName } from "@/utils/discord/displayName";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { TOMORIBOT_ERROR_FOOTER_KEY } from "@/utils/discord/stream/errorUi";
import { ColorCode, log } from "@/utils/misc/logger";
import {
  CredentialUnavailableError,
  PersonalProviderRequiredError,
  resolveCapabilityCredentials,
} from "@/utils/provider/credentialResolver";
import {
  checkTextQuotaForAdmission,
  enforceGlobalRateLimit,
  enforceServerTriggerCooldownForAdmission,
  evaluateChatAccess,
  resolveChannelScope,
  shouldApplyServerTextQuota,
  validateDirectChatTrigger,
} from "@/utils/chat/admissionGuards";
import { channelLocks, queueScenePersonaJobsAtFront, setActiveChannelTurnState } from "@/utils/chat/channelQueue";
import { shouldSurfaceChatUserErrors } from "@/utils/chat/errorVisibility";
import { queueAdditionalPersonaTurns } from "@/utils/chat/personaQueue";
import { shouldBotReply } from "@/utils/chat/replyDecision";
import { buildSceneTextQuotaTriggerKey, buildSceneTurnDirective } from "@/utils/chat/sceneTurn";
import {
  determineMatchingPersonas,
  getAutochatAssignedPersonaId,
  getAutochatRange,
  isAutochatAlwaysReplyChannelActive,
  isAutochatConfiguredChannel,
  isAutochatCounterChannelActive,
  isAutochatCounterHit,
  isAutochatOverrideChannel,
  isAutochatQualifyingMessage,
  isMatrixRelayMessage,
  isMessageProxyMessage,
  isSelfTriggerMessage,
} from "@/utils/chat/triggerProcessor";
import { getLastRespondedPersonaId, getSelfReplyChainState } from "@/utils/chat/selfReplyState";
import type { TextQuotaTriggerState } from "@/utils/chat/textQuotaState";
import type { ChatIncoming, ChatTurn, ChatTurnPlan, LockedChatTurn } from "@/utils/chat/types";
import { userNamingRepository, userPersonaNamingPairKey } from "@/utils/db/repositories/UserNamingRepository";
import { resolveEffectiveUserNaming } from "@/utils/text/userNaming";
const DEFAULT_CASCADE_LIMIT = 3;
const MAX_CASCADE_LIMIT = 10;
const DEFAULT_MATCH_LIMIT = 3;
const MIN_MATCH_LIMIT = 1;
const MAX_MATCH_LIMIT = 10;
type SendableChannel = Parameters<typeof sendStandardEmbed>[0];
export async function planChatTurns(lockedTurn: LockedChatTurn): Promise<ChatTurnPlan> {
  const admission = lockedTurn.admission;
  const incoming = admission.incoming;
  const { client, message } = incoming;
  const channel = message.channel;
  const guild = admission.guild ?? message.guild ?? null;
  const serverDiscId = admission.serverDiscId ?? guild?.id ?? message.author.id;
  const userDiscId = admission.userDiscId ?? incoming.manualTriggerInvoker?.userDiscId ?? message.author.id;
  const cooldownUserDiscId = admission.cooldownUserDiscId ?? userDiscId;
  const isDMChannel = admission.isDMChannel ?? !guild;
  const allPersonas = admission.allPersonas?.length ? admission.allPersonas : await getCachedAllPersonas(serverDiscId);
  const mainPersona = allPersonas.find((persona) => !persona.is_alter) ?? null;
  const fallbackPersona = mainPersona ?? allPersonas[0] ?? null;
  const tomoriState = admission.tomoriState ?? fallbackPersona;
  if (!tomoriState) {
    const shouldSurfaceNoStateError = shouldSurfaceChatUserErrors({
      incoming,
      client,
      message,
      isDMChannel,
      allPersonas,
      referencedMessage: admission.referencedMessage,
    });
    incoming.shouldSurfaceUserErrors = shouldSurfaceNoStateError;
    if (shouldSurfaceNoStateError) {
      await validateDirectChatTrigger({
        client,
        message,
        referencedMessage: admission.referencedMessage,
        guild,
        allPersonas,
        tomoriState: null,
        isDMChannel,
        isManuallyTriggered: incoming.isManuallyTriggered,
        userDiscId,
        serverDiscId,
        locale: admission.locale ?? "en-US",
      });
    }
    log.info(`No persona state available for message ${message.id} in server ${serverDiscId}.`);
    return { lockedTurn, turns: [] };
  }

  const userRow = await loadOrRegisterTriggerUser(message, guild, userDiscId, incoming.manualTriggerInvoker);
  // A borrowed trigger's author is a bystander, so a guild turn speaks the server's language, not theirs.
  const locale =
    incoming.borrowsTriggerMessage && guild
      ? (guild.preferredLocale ?? "en-US")
      : (userRow.language_pref ?? incoming.manualTriggerInvoker?.locale ?? admission.locale);
  admission.locale = locale;
  admission.userRow = userRow;
  admission.tomoriState = tomoriState;
  admission.allPersonas = allPersonas;

  const isSelfMessage = isSelfTriggerMessage(message, allPersonas);
  const isMessageProxy = isMessageProxyMessage(message);
  if (
    (message.author.bot || message.webhookId) &&
    !isSelfMessage &&
    !incoming.isManuallyTriggered &&
    !isMatrixRelayMessage(message) &&
    !isMessageProxy
  ) {
    return { lockedTurn, turns: [] };
  }

  const directTrigger = await validateDirectChatTrigger({
    client,
    message,
    referencedMessage: admission.referencedMessage,
    guild,
    allPersonas,
    tomoriState,
    isDMChannel,
    isManuallyTriggered: incoming.isManuallyTriggered,
    userDiscId,
    serverDiscId,
    locale,
  });
  if (!directTrigger.shouldContinue) {
    return { lockedTurn, turns: [] };
  }
  if (directTrigger.isUserImpersonation) {
    incoming.isUserImpersonation = true;
    incoming.impersonatedUserId = directTrigger.impersonatedUserId;
  }
  const shouldSurfaceUserErrors = shouldSurfaceChatUserErrors({
    incoming,
    client,
    message,
    isDMChannel,
    allPersonas,
    referencedMessage: admission.referencedMessage,
    isReplyToBotOrPersona: directTrigger.isReplyToBot || Boolean(directTrigger.replyPersona),
    isBotMentioned: directTrigger.isBotMentioned,
  });
  incoming.shouldSurfaceUserErrors = shouldSurfaceUserErrors;

  if (!isDMChannel && tomoriState.config.thought_log_channel_disc_id === channel.id) {
    log.info(`Skipping normal chat trigger in configured thought-log channel ${channel.id}.`);
    return { lockedTurn, turns: [] };
  }

  await updateAutochatCounter(message, tomoriState, serverDiscId);

  const channelIds = resolveChannelScope(message);
  const isAutochatOverride = isAutochatOverrideChannel(tomoriState.config, channelIds.effectiveChannelId);
  const accessState = await evaluateChatAccess({
    isStopResponse: !!incoming.isStopResponse,
    isDMChannel,
    isManuallyTriggered: incoming.isManuallyTriggered,
    isSelfMessage,
    isAutochatOverride,
    guildDiscId: serverDiscId,
    fallbackUserDiscId: userDiscId,
    message,
    memberRoleDiscIds: incoming.manualTriggerInvoker?.member
      ? incoming.manualTriggerInvoker.member.roles.cache.map((role) => role.id)
      : (message.member?.roles.cache.map((role) => role.id) ?? undefined),
    parentChannelId: channelIds.parentChannelId,
    effectiveChannelId: channelIds.effectiveChannelId,
    serverId: tomoriState.server_id,
    userId: userRow.user_id,
    allPersonas,
  });
  // Reminder turns are system-initiated because the role whitelist guards against unauthorized
  // users triggering Tomori, but reminders were authorized at creation time. The channel
  // whitelist (is this channel allowed at all?) still applies via whitelistStatus.isTriggerAllowed,
  // but role-based rejection that derives from the last message author is skipped.
  const isSystemInitiatedTurn = isSystemInitiatedIncoming(incoming);
  if (accessState.rejectedByWhitelist && !isSystemInitiatedTurn) {
    return { lockedTurn, turns: [] };
  }

  if (
    !incoming.isManuallyTriggered &&
    !shouldBotReply(message, tomoriState, allPersonas, {
      personalAutoTriggerPersonaId: accessState.personalSpotlightStatus?.autoTriggerPersonaId ?? null,
      allowedPersonaIds: accessState.allowedPersonaIds,
      personalDtm: (userRow.personal_dtm as "off" | "follow" | "on") ?? "follow",
      referencedMessage: admission.referencedMessage,
    })
  ) {
    return { lockedTurn, turns: [] };
  }

  const credentialPolicy = await resolveTextCredentialPolicy({
    tomoriState,
    isSelfMessage,
    isPersonaJob: incoming.isPersonaJob,
    isManuallyTriggered: incoming.isManuallyTriggered,
    isUserImpersonation: incoming.isUserImpersonation,
    borrowsTriggerMessage: incoming.borrowsTriggerMessage === true,
    userRow,
    channel,
    locale,
    isDMChannel,
    shouldSurfaceUserErrors,
  });
  if (!credentialPolicy) {
    return { lockedTurn, turns: [] };
  }

  let personasToRespond = selectPersonasForTurn({
    lockedTurn,
    allPersonas,
    tomoriState,
    mainPersona,
    fallbackPersona,
    directTrigger,
    isSelfMessage,
    matchLimit: getMatchLimit(tomoriState),
    channelId: channel.id,
    effectiveChannelId: channelIds.effectiveChannelId,
    allowedPersonaIds: accessState.allowedPersonaIds,
    personalAutoTriggerPersonaId: accessState.personalSpotlightStatus?.autoTriggerPersonaId ?? null,
    whitelistStatus: accessState.whitelistStatus,
    personalSpotlightStatus: accessState.personalSpotlightStatus,
    userRow,
  });

  if (personasToRespond.length === 0) {
    log.info(`No personas matched trigger for message ${message.id} in server ${serverDiscId}`);
    return { lockedTurn, turns: [] };
  }

  if (
    !(await enforceTurnGuards(
      lockedTurn,
      tomoriState,
      userRow,
      personasToRespond,
      credentialPolicy.source,
      shouldSurfaceUserErrors,
    ))
  ) {
    return { lockedTurn, turns: [] };
  }

  const textQuota = await prepareTextQuota(
    lockedTurn,
    tomoriState,
    credentialPolicy.source,
    userRow,
    shouldSurfaceUserErrors,
  );
  if (!textQuota.allowed) {
    return { lockedTurn, turns: [] };
  }

  const triggeredPersonaIds =
    incoming.triggeredPersonaIds ??
    personasToRespond.map((persona) => persona.persona_id).filter((personaId): personaId is number => !!personaId);

  const lockEntry = channelLocks.get(lockedTurn.channelId);
  if (lockEntry) {
    setActiveChannelTurnState(lockEntry, {
      activePersonaId: personasToRespond[0]?.persona_id ?? undefined,
      triggeredPersonaIds,
      followUpEligible: personasToRespond[0]?.persona_id !== undefined,
      isUserImpersonation: incoming.isUserImpersonation,
      impersonatedUserId: incoming.impersonatedUserId,
    });
  }

  if (
    incoming.sceneTurn &&
    incoming.sceneTurn.turnIndex === 0 &&
    !incoming.skipLock &&
    incoming.retryCount === 0 &&
    lockEntry
  ) {
    const rootSceneTurn = incoming.sceneTurn;
    const remainingSceneJobs = rootSceneTurn.sequence.slice(1).map((speaker, offset) => {
      const sceneTurn = {
        ...rootSceneTurn,
        turnIndex: offset + 1,
      };

      return {
        personaName: speaker.personaName,
        selectedPersonaId: speaker.personaId,
        sceneTurn,
        manualSystemPrompt: buildSceneTurnDirective(sceneTurn),
        textQuotaTriggerKey: buildSceneTextQuotaTriggerKey(sceneTurn),
      };
    });

    if (remainingSceneJobs.length > 0) {
      queueScenePersonaJobsAtFront({
        lockEntry,
        message,
        sceneJobs: remainingSceneJobs,
        triggeredPersonaIds,
        forceReason: incoming.forceReason,
        reasoningQuery: incoming.reasoningQuery,
        llmOverrideCodename: incoming.llmOverrideCodename,
        textQuotaSource: incoming.textQuotaSource,
        textQuotaUserDiscId: incoming.textQuotaUserDiscId ?? cooldownUserDiscId,
        shouldSurfaceUserErrors,
        injectedContextItems: incoming.injectedContextItems,
        forcedMentions: incoming.forcedMentions,
        manualTriggerInvoker: incoming.manualTriggerInvoker,
        manualStreamingContextOverrides: incoming.manualStreamingContextOverrides,
      });
    }
  }

  if (
    !incoming.isManuallyTriggered &&
    !incoming.reminderRecipientID &&
    !incoming.reminderData?.self_reminder &&
    !incoming.isStopResponse &&
    personasToRespond.length > 1 &&
    lockEntry
  ) {
    personasToRespond = queueAdditionalPersonaTurns({
      lockEntry,
      message,
      personasToRespond,
      triggeredPersonaIds,
      forceReason: incoming.forceReason,
      reasoningQuery: incoming.reasoningQuery,
      llmOverrideCodename: incoming.llmOverrideCodename,
      textQuotaSource: incoming.textQuotaSource,
      textQuotaTriggerKey: textQuota.triggerKey,
      textQuotaUserDiscId: incoming.textQuotaUserDiscId ?? cooldownUserDiscId,
      shouldSurfaceUserErrors,
      injectedContextItems: incoming.injectedContextItems,
      forcedMentions: incoming.forcedMentions,
    });
  }

  const requestSnapshot = {
    tomoriState,
    triggererUserRow: userRow,
    isTriggererBlacklisted: await getCachedBlacklistStatus(serverDiscId, userDiscId),
    isTriggererOptedOut: (await getCachedPrivacyLevel(userDiscId)) === PrivacyLevel.FULL,
    triggererPrivacyLevel: await getCachedPrivacyLevel(userDiscId),
    preloadedMember: !isDMChannel && guild ? await guild.members.fetch(userDiscId).catch(() => null) : null,
  };
  const naming = await resolveNamingSubject({
    incoming,
    message,
    guild,
    serverDiscId,
    userRow,
    preloadedMember: requestSnapshot.preloadedMember,
    isTriggererBlacklisted: requestSnapshot.isTriggererBlacklisted,
  });
  if (!naming) {
    log.warn(`Dropping Reach-out turn for message ${message.id}: its target's user row could not be read.`);
    return { lockedTurn, turns: [] };
  }
  const { displayName, row: namingRow } = naming;
  let triggererName =
    naming.blacklisted || tomoriState.config.personal_memories_enabled === false || !namingRow.user_nickname
      ? displayName
      : namingRow.user_nickname;
  const canUsePersonalizedNaming = !naming.blacklisted && tomoriState.config.personal_memories_enabled !== false;
  const namingPreferences = namingRow.user_id
    ? await userNamingRepository.loadPreferences(
        personasToRespond.map((persona) => ({
          userId: namingRow.user_id as number,
          personaLineageId: persona.persona_lineage_id,
        })),
      )
    : new Map();

  // Scene turns are a scripted persona-to-persona chain: each speaker responds to the
  // PREVIOUS speaker, so {{user}} (which resolves to triggererName) should be that prior
  // persona rather than the command invoker: matching how a normal self-reply queue
  // resolves the triggerer to the last persona in the chain. Turn 0 has no prior speaker
  // and keeps the invoker as the entity being responded to.
  if (incoming.sceneTurn && incoming.sceneTurn.turnIndex > 0) {
    const previousSpeakerName = incoming.sceneTurn.sequence[incoming.sceneTurn.turnIndex - 1]?.personaName.trim();
    if (previousSpeakerName) {
      triggererName = previousSpeakerName;
    }
  }

  const turns: ChatTurn[] = personasToRespond.map((persona, personaIndex) => {
    const isPersonaSceneTarget = Boolean(incoming.sceneTurn && incoming.sceneTurn.turnIndex > 0);
    const preference = namingRow.user_id
      ? namingPreferences.get(userPersonaNamingPairKey(namingRow.user_id, persona.persona_lineage_id))
      : undefined;
    const effectiveNaming = resolveEffectiveUserNaming({
      global: {
        userNickname: canUsePersonalizedNaming ? namingRow.user_nickname : null,
        prefixOverride: canUsePersonalizedNaming ? (namingRow.prefix_override ?? null) : null,
        suffixOverride: canUsePersonalizedNaming ? (namingRow.suffix_override ?? null) : null,
        addressingStyle: canUsePersonalizedNaming ? (namingRow.addressing_style ?? null) : null,
      },
      liveDisplayName: displayName,
      persona: canUsePersonalizedNaming ? persona.naming_config : undefined,
      preference: canUsePersonalizedNaming ? preference : null,
    });
    const perPersonaTriggererName = isPersonaSceneTarget ? triggererName : effectiveNaming.nickname;
    const triggererFormattedName = isPersonaSceneTarget ? triggererName : effectiveNaming.formattedName;

    return {
      lockedTurn,
      persona,
      personaIndex,
      totalPersonas: personasToRespond.length,
      allPersonas,
      tomoriState: persona,
      mainPersona,
      userRow,
      requestSnapshot,
      serverDiscId,
      guild,
      isDMChannel,
      isSelfMessage,
      userDiscId,
      cooldownUserDiscId,
      triggererName: perPersonaTriggererName,
      triggererFormattedName,
      triggererAddressTerm: effectiveNaming.addressTerm,
      channelName: isDMChannel
        ? "Direct Message"
        : "name" in channel
          ? (channel.name ?? "Unknown Channel")
          : "Unknown Channel",
      channelDescription: isDMChannel ? null : "topic" in channel ? channel.topic : null,
      serverName: isDMChannel ? "Direct Message" : (guild?.name ?? "Unknown Server"),
      serverDescription: isDMChannel ? null : (guild?.description ?? null),
      textCredentialSource: credentialPolicy.source,
      personalRoutingUserId: credentialPolicy.personalRoutingUserId,
      personalTextProvider: credentialPolicy.personalTextProvider,
      shouldApplyTextQuota: textQuota.shouldApply,
      textQuotaTriggerKey: textQuota.triggerKey,
      textQuotaState: textQuota.state,
      shouldSurfaceUserErrors,
      forcedMentions: incoming.forcedMentions,
      isUserImpersonation: incoming.isUserImpersonation,
      impersonatedUserId: incoming.impersonatedUserId,
      triggeredPersonaIds,
    };
  });

  log.info(
    `${turns.length} persona(s) will respond to message ${message.id}: ${turns
      .map((turn) => turn.persona.persona_nickname)
      .join(", ")}`,
  );
  return { lockedTurn, turns };
}

/**
 * The user whose name `{user}` and the triggerer name carry. A Reach-out speaks to its target, not to
 * whoever posted the message it borrowed as a trigger, so only naming moves to the target: credentials,
 * quotas, and stats stay with the trigger message's author. Null when the target's row is unreadable.
 */
async function resolveNamingSubject(params: {
  incoming: ChatIncoming;
  message: Message;
  guild: Guild | null;
  serverDiscId: string;
  userRow: UserRow;
  preloadedMember: GuildMember | null;
  isTriggererBlacklisted: boolean;
}): Promise<{ row: UserRow; displayName: string; blacklisted: boolean } | null> {
  const { incoming, message } = params;
  const targetId = incoming.naturalNudge?.targetUserDiscId;
  if (!targetId) {
    return {
      row: params.userRow,
      blacklisted: params.isTriggererBlacklisted,
      displayName: resolvePreferredDiscordDisplayName({
        memberDisplayName:
          incoming.manualTriggerInvoker?.member?.displayName ??
          params.preloadedMember?.displayName ??
          message.member?.displayName,
        user: incoming.manualTriggerInvoker ? { username: incoming.manualTriggerInvoker.username } : message.author,
        fallback: incoming.manualTriggerInvoker?.username ?? message.author.username,
      }),
    };
  }
  const [row, member, blacklisted] = await Promise.all([
    getCachedUserRow(targetId),
    params.guild ? params.guild.members.fetch(targetId).catch(() => null) : Promise.resolve(null),
    getCachedBlacklistStatus(params.serverDiscId, targetId),
  ]);
  if (!row) return null;
  return {
    row,
    blacklisted,
    displayName: resolvePreferredDiscordDisplayName({ memberDisplayName: member?.displayName, user: member?.user }),
  };
}

async function loadOrRegisterTriggerUser(
  message: Message,
  guild: Guild | null,
  userDiscId: string,
  manualTriggerInvoker: LockedChatTurn["admission"]["incoming"]["manualTriggerInvoker"],
): Promise<UserRow> {
  const existing = await getCachedUserRow(userDiscId);
  if (existing) return existing;

  const locale = manualTriggerInvoker?.locale ?? guild?.preferredLocale ?? "en-US";
  const displayName = resolvePreferredDiscordDisplayName({
    memberDisplayName: manualTriggerInvoker?.member?.displayName ?? message.member?.displayName,
    user: manualTriggerInvoker ? { username: manualTriggerInvoker.username } : message.author,
    fallback: manualTriggerInvoker?.username ?? message.author.username,
  });
  const registered = await userRepository.register(userDiscId, displayName, locale);
  if (!registered) {
    throw new Error(`Failed to register trigger user ${userDiscId}.`);
  }
  return registered;
}

async function updateAutochatCounter(message: Message, tomoriState: TomoriState, serverDiscId: string): Promise<void> {
  const { minThreshold, maxThreshold } = getAutochatRange(tomoriState.config);
  const effectiveChannelId = message.channel.isThread()
    ? (message.channel.parentId ?? message.channel.id)
    : message.channel.id;
  if (!isAutochatCounterChannelActive(tomoriState.config, effectiveChannelId) || !isRealUserMessage(message)) {
    return;
  }
  if (!tomoriState.persona_id) {
    log.error(`Tomori ID missing for server ${serverDiscId} during counter increment.`);
    return;
  }

  try {
    const updatedTomoriRow = await configRepository.incrementTomoriCounter(
      tomoriState.persona_id,
      minThreshold,
      maxThreshold,
    );
    if (!updatedTomoriRow) {
      log.warn(`Failed to update auto-message counter for server ${serverDiscId}.`);
      return;
    }
    tomoriState.autoch_counter = updatedTomoriRow.autoch_counter;
    tomoriState.autoch_next_target = updatedTomoriRow.autoch_next_target;
  } catch (error) {
    log.error(`Error updating auto-message counter for server ${serverDiscId}`, error);
  }
}

/**
 * A borrowed-trigger turn counts as system-initiated because an admin configured it (random trigger
 * or Natural Nudges allow-list), as creation authorizes a reminder.
 */
function isSystemInitiatedIncoming(incoming: ChatIncoming): boolean {
  return Boolean(
    incoming.reminderRecipientID || incoming.reminderData?.self_reminder || incoming.borrowsTriggerMessage,
  );
}

function isRealUserMessage(message: Message): boolean {
  return (!message.author.bot && !message.webhookId) || isMatrixRelayMessage(message) || isMessageProxyMessage(message);
}

function getMatchLimit(tomoriState: TomoriState): number {
  const rawMatchLimit = tomoriState.config.match_limit ?? DEFAULT_MATCH_LIMIT;
  return Math.min(Math.max(rawMatchLimit, MIN_MATCH_LIMIT), MAX_MATCH_LIMIT);
}

async function resolveTextCredentialPolicy(params: {
  tomoriState: TomoriState;
  isSelfMessage: boolean;
  isPersonaJob: boolean;
  isManuallyTriggered?: boolean;
  isUserImpersonation: boolean;
  borrowsTriggerMessage: boolean;
  userRow: UserRow;
  channel: Message["channel"];
  locale: string;
  isDMChannel: boolean;
  shouldSurfaceUserErrors: boolean;
}): Promise<{
  source: "server" | "personal";
  personalRoutingUserId: number | null;
  personalTextProvider: string | null;
} | null> {
  // A borrowed trigger's author is whoever spoke last, so a personal key there would bill a bystander.
  const personalRoutingUserId =
    params.borrowsTriggerMessage ||
    (params.isSelfMessage && !params.isPersonaJob && !params.isManuallyTriggered && !params.isUserImpersonation)
      ? null
      : (params.userRow.user_id ?? null);

  try {
    const textCreds = await resolveCapabilityCredentials(params.tomoriState.server_id, "text", {
      userId: personalRoutingUserId,
    });
    return {
      source: textCreds.source,
      personalRoutingUserId,
      personalTextProvider: textCreds.source === "personal" ? textCreds.provider : null,
    };
  } catch (error) {
    // Checked ahead of CredentialUnavailableError because an unreadable database used to arrive
    // here as `no_saved_config` and render "API Key Missing", telling an admin to run
    // /config setup during a transient blip. That embed logged 41 times in one cascade.
    if (error instanceof DatabaseUnavailableError) {
      if (params.shouldSurfaceUserErrors) {
        await sendStandardEmbed(params.channel as SendableChannel, params.locale, {
          color: ColorCode.ERROR,
          titleKey: "general.errors.database_unavailable_title",
          descriptionKey: "general.errors.database_unavailable_description",
          footerKey: TOMORIBOT_ERROR_FOOTER_KEY,
        });
      } else {
        log.warn("Suppressing database-unavailable embed for non-deliberate chat turn.", error);
      }
      return null;
    }
    if (error instanceof PersonalProviderRequiredError) {
      if (params.shouldSurfaceUserErrors) {
        log.warn(`Personal provider required for deliberate chat turn in channel ${params.channel.id}`, error, {
          serverId: params.tomoriState.server_id,
          personaId: params.tomoriState.persona_id,
          metadata: {
            channelId: params.channel.id,
          },
        });
        await sendStandardEmbed(params.channel as SendableChannel, params.locale, {
          color: ColorCode.ERROR,
          titleKey: "general.errors.personal_provider_required_title",
          descriptionKey: "general.errors.personal_provider_required_description",
        });
      } else {
        log.warn("Suppressing personal-provider-required embed for non-deliberate chat turn.", error);
      }
      return null;
    }
    if (error instanceof CredentialUnavailableError) {
      if (
        error.reason === "missing_model_id" &&
        personalRoutingUserId === null &&
        params.tomoriState.config.user_byok_mode
      ) {
        log.info(`Skipping server-initiated turn in BYOK-only mode for server ${params.tomoriState.server_id}.`);
        return null;
      }
      const isPersonalError = error.source === "personal";
      const isMissingConfig = error.reason === "no_saved_config" || error.reason === "missing_model_id";
      if (params.shouldSurfaceUserErrors) {
        log.warn(
          `Credential unavailable for deliberate chat turn in channel ${params.channel.id}: source=${error.source}, reason=${error.reason}`,
          error,
          {
            serverId: params.tomoriState.server_id,
            personaId: params.tomoriState.persona_id,
            metadata: {
              channelId: params.channel.id,
              source: error.source,
              reason: error.reason,
            },
          },
        );
        await sendStandardEmbed(params.channel as SendableChannel, params.locale, {
          color: ColorCode.ERROR,
          titleKey: isPersonalError
            ? "general.errors.personal_provider_credentials_error_title"
            : isMissingConfig
              ? "general.errors.api_key_missing_title"
              : "general.errors.api_key_error_title",
          descriptionKey: isPersonalError
            ? "general.errors.personal_provider_credentials_error_description"
            : isMissingConfig
              ? "general.errors.api_key_missing_description"
              : "general.errors.api_key_error_description",
          ...(params.isDMChannel && !isPersonalError ? { footerKey: "general.errors.tomori_not_setup_dm_footer" } : {}),
        });
      } else {
        log.warn("Suppressing credential error embed for non-deliberate chat turn.", error);
      }
      return null;
    }
    throw error;
  }
}

function selectPersonasForTurn(args: {
  lockedTurn: LockedChatTurn;
  allPersonas: TomoriState[];
  tomoriState: TomoriState;
  mainPersona: TomoriState | null;
  fallbackPersona: TomoriState | null;
  directTrigger: Awaited<ReturnType<typeof validateDirectChatTrigger>>;
  isSelfMessage: boolean;
  matchLimit: number;
  channelId: string;
  effectiveChannelId: string;
  allowedPersonaIds: Set<number> | null;
  personalAutoTriggerPersonaId: number | null;
  whitelistStatus: Awaited<ReturnType<typeof evaluateChatAccess>>["whitelistStatus"];
  personalSpotlightStatus: Awaited<ReturnType<typeof evaluateChatAccess>>["personalSpotlightStatus"];
  userRow: UserRow;
}): TomoriState[] {
  const incoming = args.lockedTurn.admission.incoming;
  const selectedPersona = incoming.selectedPersonaId
    ? (args.allPersonas.find((persona) => persona.persona_id === incoming.selectedPersonaId) ?? args.fallbackPersona)
    : args.fallbackPersona;
  const isAllowedByAccessState = (persona: TomoriState | null | undefined): persona is TomoriState =>
    Boolean(
      persona &&
        (!args.allowedPersonaIds ||
          (typeof persona.persona_id === "number" && args.allowedPersonaIds.has(persona.persona_id))),
    );

  // Reminder and Natural Nudges turns are system-initiated: bypass personal spotlight and user
  // blocks (preferences that govern which persona responds *to that user*, not system-triggered
  // events). Only the persona-channel whitelist is still enforced so channel admins can restrict personas.
  if (isSystemInitiatedIncoming(incoming)) {
    return selectedPersona &&
      whitelistRepository.isPersonaAllowedByWhitelistStatus(args.whitelistStatus, selectedPersona.persona_id)
      ? [selectedPersona]
      : [];
  }
  if (incoming.isManuallyTriggered) {
    return selectedPersona &&
      isPersonaAllowedForTrigger(args.whitelistStatus, args.personalSpotlightStatus, selectedPersona.persona_id) &&
      isAllowedByAccessState(selectedPersona)
      ? [selectedPersona]
      : [];
  }
  if (incoming.isStopResponse) {
    const mainTurn = args.mainPersona ? [args.mainPersona] : [];
    return mainTurn;
  }

  const config = args.tomoriState.config;
  const personalAutoTriggerPersonaId = isPersonaAllowedForTrigger(
    args.whitelistStatus,
    args.personalSpotlightStatus,
    args.personalAutoTriggerPersonaId,
  )
    ? (args.personalAutoTriggerPersonaId ?? null)
    : null;
  const isPersonalAutoTriggerActive =
    personalAutoTriggerPersonaId !== null &&
    isAutochatQualifyingMessage(args.lockedTurn.admission.message, args.isSelfMessage);
  const isAutoMsgHit =
    !isPersonalAutoTriggerActive &&
    isAutochatQualifyingMessage(args.lockedTurn.admission.message, args.isSelfMessage) &&
    isAutochatCounterHit(args.tomoriState, args.effectiveChannelId);
  const serverAutoTriggerPersonaId = getAutochatAssignedPersonaId(config, args.effectiveChannelId);
  const isScopedAlwaysReplyActive =
    isAutochatAlwaysReplyChannelActive(config, args.effectiveChannelId) &&
    isAutochatQualifyingMessage(args.lockedTurn.admission.message, args.isSelfMessage);
  const serverDtmEnabled = !!config.deliberate_trigger_mode;
  const personalDtmMode = args.userRow.personal_dtm ?? "follow";
  const isDtmActive =
    (personalDtmMode === "on" || (personalDtmMode === "follow" && serverDtmEnabled)) &&
    !!args.lockedTurn.admission.message.guild &&
    !isMatrixRelayMessage(args.lockedTurn.admission.message);
  const isAlwaysReplyActive =
    (!!config.always_reply_enabled &&
      isAutochatQualifyingMessage(args.lockedTurn.admission.message, args.isSelfMessage)) ||
    isScopedAlwaysReplyActive ||
    isPersonalAutoTriggerActive;

  let personasToRespond = determineMatchingPersonas(
    args.lockedTurn.admission.message,
    args.allPersonas,
    args.lockedTurn.admission.client,
    args.lockedTurn.admission.referencedMessage,
    args.directTrigger.isReplyToBot,
    args.directTrigger.replyPersona,
    args.directTrigger.isBotMentioned,
    isAutoMsgHit,
    isAlwaysReplyActive,
    personalAutoTriggerPersonaId ?? serverAutoTriggerPersonaId,
    isPersonalAutoTriggerActive
      ? personalAutoTriggerPersonaId
      : isScopedAlwaysReplyActive
        ? serverAutoTriggerPersonaId
        : null,
    isDtmActive,
    isAutochatConfiguredChannel(config, args.effectiveChannelId) || isPersonalAutoTriggerActive,
    args.allowedPersonaIds,
  );

  if (args.isSelfMessage) {
    const lastRespondedId = getLastRespondedPersonaId(args.channelId);
    if (lastRespondedId !== null) {
      personasToRespond = personasToRespond.filter((persona) => persona.persona_id !== lastRespondedId);
    }
  }

  return personasToRespond.slice(0, args.matchLimit);
}

async function enforceTurnGuards(
  lockedTurn: LockedChatTurn,
  tomoriState: TomoriState,
  userRow: UserRow,
  personasToRespond: TomoriState[],
  textCredentialSource: "server" | "personal",
  shouldSurfaceUserErrors: boolean,
): Promise<boolean> {
  const admission = lockedTurn.admission;
  const incoming = admission.incoming;
  const message = admission.message;
  const channel = admission.channel;
  const serverDiscId = admission.serverDiscId ?? message.guild?.id ?? message.author.id;
  const userDiscId = admission.userDiscId ?? userRow.user_disc_id;
  const isSelfMessage = isSelfTriggerMessage(message, admission.allPersonas ?? personasToRespond);

  if (!incoming.skipLock && !incoming.isStopResponse && !incoming.isPersonaJob) {
    const rateLimitAllowed = await enforceGlobalRateLimit({
      userDiscId,
      serverDiscId,
      channel: channel as SendableChannel,
      guild: admission.guild ?? message.guild ?? null,
      client: admission.client,
      messageId: message.id,
      userActiveCountAdjustment: -1,
      serverActiveCountAdjustment: -1,
      notifyUser: shouldSurfaceUserErrors,
    });
    if (!rateLimitAllowed) return false;
  }

  if (!incoming.isStopResponse && !incoming.isPersonaJob && !isSelfMessage && textCredentialSource !== "personal") {
    const cooldownAllowed = await enforceServerTriggerCooldownForAdmission({
      serverDiscId,
      cooldownUserDiscId: admission.cooldownUserDiscId ?? userDiscId,
      message,
      tomoriState,
      locale: admission.locale,
      notifyUser: shouldSurfaceUserErrors,
    });
    if (!cooldownAllowed) return false;
  }

  const cascadeLimit = Math.min(
    Math.max(tomoriState.config.cascade_limit ?? DEFAULT_CASCADE_LIMIT, 0),
    MAX_CASCADE_LIMIT,
  );
  const triggerState = getSelfReplyChainState(channel.id);
  if (
    (isSelfMessage || (incoming.isPersonaJob && !incoming.sceneTurn)) &&
    !incoming.reminderRecipientID &&
    !incoming.reminderData?.self_reminder &&
    !incoming.isStopResponse
  ) {
    if (triggerState.triggerCount >= cascadeLimit + 1) {
      log.info(`Cascade trigger limit reached for message ${message.id} in channel ${channel.id}.`);
      return false;
    }
  }

  return true;
}

async function prepareTextQuota(
  lockedTurn: LockedChatTurn,
  tomoriState: TomoriState,
  textCredentialSource: "server" | "personal",
  userRow: UserRow,
  shouldSurfaceUserErrors: boolean,
): Promise<{ allowed: boolean; shouldApply: boolean; triggerKey: string; state: TextQuotaTriggerState | null }> {
  const incoming = lockedTurn.admission.incoming;
  const triggerKey = incoming.textQuotaTriggerKey ?? lockedTurn.admission.message.id;
  const shouldTreatAsQuotaSharedPersonaJob = incoming.isPersonaJob && !incoming.sceneTurn;
  // A personal route spends the user's own credentials, so it never draws on the server's quota.
  // The server route a personal turn can still fall back to admits itself, in generationTurn.
  const shouldApply =
    textCredentialSource === "server" && shouldApplyServerTextQuota(incoming, lockedTurn.admission.isDMChannel);

  const quota = await checkTextQuotaForAdmission({
    shouldApplyTextQuota: shouldApply,
    isPersonaJob: shouldTreatAsQuotaSharedPersonaJob,
    triggerKey,
    serverId: tomoriState.server_id,
    userDiscId: incoming.textQuotaUserDiscId ?? lockedTurn.admission.cooldownUserDiscId ?? userRow.user_disc_id,
    channel: lockedTurn.admission.channel as SendableChannel,
    locale: lockedTurn.admission.locale,
    notifyUser: shouldSurfaceUserErrors,
  });

  return {
    allowed: quota.allowed,
    shouldApply,
    triggerKey,
    state: quota.allowed ? quota.state : null,
  };
}
