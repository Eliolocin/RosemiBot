import type { BaseGuildTextChannel, Message, ReplyOptions, Webhook } from "discord.js";
import type { StreamContext } from "@/types/stream/interfaces";
import type { SpriteMessageRecordInfo, StreamState } from "@/types/stream/types";
import { recordPersonaSpriteMessage } from "@/utils/cache/personaSpriteMessageCache";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import {
  isChannelGoneError,
  isMissingChannelAccessError,
  MissingChannelAccessError,
  resolveSendableChannel,
  resolveReplyChannel,
  type ChannelUnreachableReason,
  type SendableChannel,
} from "@/utils/discord/resolveSendableChannel";
import { getOrCreateWebhook } from "@/utils/discord/webhook/lifecycle";
import { invalidateWebhookCache } from "@/utils/discord/webhook/cache";
import { sendWebhookMessageWithIdentity } from "@/utils/discord/webhook/personaDispatch";
import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import { getWebhookStoredAvatarDataUri, type WebhookIdentitySendOptions } from "@/utils/discord/webhook/webhookCore";
import { WebhookAvatarEditDeferredError } from "@/utils/discord/webhook/avatarEditRateLimit";
import { resolveAvatarPatchFallback } from "@/utils/discord/stream/avatarPatchFallback";
import { sendWebhookReplyNotice } from "@/utils/discord/webhookReply";
import { classifySendFailure, clearSendFailure, noteSendFailure } from "@/utils/discord/stream/sendFailureCache";
import {
  type DeliveredSpeaker,
  getChannelLastDelivery,
  recordChannelDeliveredBotMessage,
  recordChannelDeliveredWebhookIdentity,
} from "@/utils/discord/stream/channelDeliveryContinuity";
import { ColorCode, log } from "@/utils/misc/logger";
import { STREAMING_LIMITS } from "@/utils/security/rateLimiter";
import { recordChatDiagnostic, recordChatMessageSent } from "@/utils/chat/diagnosticTimeline";
import type { ChatSendReason } from "@/utils/chat/diagnosticTimeline";

export type StreamSendPayload = {
  content?: string;
  files?: import("discord.js").AttachmentBuilder[];
  /** Interactive rows attached to the sent message (e.g. the rendered table's "Show Markdown" button). */
  components?: import("discord.js").ActionRowBuilder<import("discord.js").ButtonBuilder>[];
  identityOverride?: ResolvedWebhookIdentity;
  accumulatedTextPrefix?: string;
  /** Sprite mapping persisted after a successful webhook send (clean-name sprite renders). */
  spriteRecord?: SpriteMessageRecordInfo;
  /** The persona's base appearance under an identity override, which is not a copied identity. */
  isNeutralAppearance?: boolean;
  allowedMentions?: {
    parse?: Array<"users" | "roles" | "everyone">;
    repliedUser?: boolean;
  };
  diagnosticReason?: ChatSendReason;
};

type StreamUiUpdaterDependencies = {
  hasStopRequest: (channelId: string) => boolean;
  requestStop: (channelId: string, requesterId?: string) => boolean;
  notifyStreamProgress: (context: StreamContext) => void;
};

function isInvalidWebhookError(error: unknown): boolean {
  const code = (error as { code?: number | string })?.code;
  return code === 10015 || code === "10015" || code === 50027 || code === "50027";
}

/**
 * Detects transient webhook send failures (network aborts/timeouts) where the
 * webhook itself is still valid, so the individual HTTP request just did not land.
 * Unlike {@link isInvalidWebhookError}, these are safe to retry with the same
 * persona identity so the persona avatar/username is preserved on the retry.
 *
 * @returns True when the failure is a transient abort worth a single retry
 */
function isTransientWebhookError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function resolveWebhookTargetChannel(channel: StreamContext["channel"]): BaseGuildTextChannel | null {
  const isThread = "isThread" in channel && typeof channel.isThread === "function" && channel.isThread();
  if (isThread) {
    return channel.parent && "fetchWebhooks" in channel.parent ? (channel.parent as BaseGuildTextChannel) : null;
  }
  return "fetchWebhooks" in channel && "createWebhook" in channel ? (channel as BaseGuildTextChannel) : null;
}

function resolveWebhookThreadId(channel: StreamContext["channel"]): string | undefined {
  return "isThread" in channel && typeof channel.isThread === "function" && channel.isThread() ? channel.id : undefined;
}

/**
 * Signals that the destination channel cannot be reached, raised before a send is attempted.
 *
 * A deleted channel is not retryable and no fallback can rescue it, so this carries the same code
 * a REST 10003 would report and takes the quiet teardown path in the send catch rather than the
 * error path.
 */
class ChannelGoneError extends Error {
  public readonly code = 10003;

  public constructor(channelId: string | undefined) {
    super(`Destination channel ${channelId ?? "unknown"} is gone`);
    this.name = "ChannelGoneError";
  }
}

/**
 * Names the condition behind a failure, so the stop reason and the log agree.
 *
 * The code decides rather than the error class: the same 50001 arrives from a REST send and from
 * this file's own resolver, and only one of those is an instance of the local error.
 */
function unreachableReasonFor(error: unknown): ChannelUnreachableReason {
  return isMissingChannelAccessError(error) ? "missing_access" : "channel_deleted";
}

/**
 * Raises the failure that matches why the destination could not be reached.
 *
 * Both reasons stop the stream, but they are different operator problems, so the stop reason and
 * the log have to name the one that happened. A revoked access grant reported as a deletion sends
 * an operator looking for a channel that still exists.
 */
function unreachableChannelError(
  reason: ChannelUnreachableReason,
  channelId: string | undefined,
): ChannelGoneError | MissingChannelAccessError {
  return reason === "missing_access"
    ? new MissingChannelAccessError(channelId ?? "unknown")
    : new ChannelGoneError(channelId);
}

/**
 * Stops a stream whose destination cannot receive anything, naming the condition that caused it.
 *
 * The two reasons are terminal for the same reason: no retry, key rotation, or fallback model
 * reaches a channel the bot cannot post into, so both tear down quietly rather than producing an
 * error row per remaining arm.
 */
function stopForUnreachableChannel(
  deps: StreamUiUpdaterDependencies,
  channelId: string,
  reason: ChannelUnreachableReason,
  cause: unknown,
): void {
  const described = reason === "missing_access" ? "is not accessible to the bot" : "is gone";
  log.warn(`Stream Send: destination channel ${channelId} ${described}, stopping the stream`, cause);
  deps.requestStop(channelId, reason);
}

/**
 * Picks the channel that will receive the next stream message, and the reply reference when the
 * turn is answering a source message.
 *
 * `replyToMessage.reply()` cannot be used here: discord.js resolves `message.channel` from the
 * cache at call time and throws `ChannelNotCached` when the entry is absent, which a turn that
 * streams for minutes can outlive. This resolves the destination by id instead, and the reply is
 * carried as an explicit reference, which is the same payload `Message#reply` would build.
 *
 * A restored channel is written back onto the context because one stream sends many chunks and
 * only the first consults this helper. Leaving the context pointing at a channel that cannot be
 * sent into would break every later chunk, which takes the `context.channel.send` branch once
 * `hasRepliedToOriginalMessage` is set.
 *
 * @param context - Turn context, whose channel was captured at admission
 * @returns The destination channel and reply reference, or the reason it is unreachable
 */
async function resolveReplyTarget(
  context: StreamContext,
): Promise<
  | { channel: SendableChannel; reply: ReplyOptions | undefined; failed?: undefined }
  | { channel?: undefined; reply?: undefined; failed: ChannelUnreachableReason }
> {
  // The channel captured at admission is an object, so it survives cache eviction and needs no
  // lookup. A partial entry is the one case where it cannot be sent into, and that is what falls
  // through to the REST lookup that separates "never cached" from "deleted".
  const captured = context.channel;
  if (typeof (captured as { send?: unknown }).send === "function") {
    return { channel: captured as SendableChannel, reply: buildReplyReference(context, captured.id) };
  }

  const resolved = await resolveReplyChannel(context.client, context.replyToMessage, captured.id);
  if (!resolved.channel) return { failed: resolved.failed };

  context.channel = resolved.channel;
  return { channel: resolved.channel, reply: buildReplyReference(context, resolved.channel.id) };
}

/**
 * Builds the reply reference, or omits it when the reference would point out of the target channel.
 *
 * Discord rejects a reference whose message lives in another channel, so a turn whose source
 * channel is unreachable has to post a plain message into the reachable one rather than a reply
 * that cannot be delivered. Without this the send fails with 10008 from a path that already
 * decided the destination was usable.
 */
function buildReplyReference(context: StreamContext, targetChannelId: string): ReplyOptions | undefined {
  const source = context.replyToMessage;
  if (!source || source.channelId !== targetChannelId) return undefined;

  return { messageReference: source.id, failIfNotExists: false };
}

export function isUserImpersonationStreamContext(context: StreamContext): boolean {
  return Boolean(context.personaUsername && !context.tomoriState.is_alter);
}

/**
 * Classifies who a webhook line presents, for the rate-limited avatar fallback. An identity
 * override without a sprite record is a copied identity unless it is the persona's own base
 * appearance; an alter's plain line has no override and is that alter's base appearance.
 */
function classifyWebhookSpeaker(
  payload: Pick<StreamSendPayload, "identityOverride" | "spriteRecord" | "isNeutralAppearance">,
  context: StreamContext,
  strictUserImpersonation: boolean,
): DeliveredSpeaker {
  const personaId = context.tomoriState.persona_id ?? null;
  if (strictUserImpersonation) return { personaId, kind: "copied" };
  if (payload.spriteRecord) {
    return {
      personaId: payload.spriteRecord.personaId,
      kind: payload.spriteRecord.isIdentity ? "identity_sprite" : "appearance",
    };
  }
  if (payload.identityOverride && !payload.isNeutralAppearance) return { personaId, kind: "copied" };
  return { personaId, kind: "appearance" };
}

/**
 * A bot-user line always shows the bot's own name and avatar, which is the main persona's
 * appearance. An alter's line only lands there as a failed-webhook fallback, where the face shown
 * is not the alter's, so it is recorded as an unknown speaker.
 */
function classifyBotSpeaker(context: StreamContext): DeliveredSpeaker {
  return {
    personaId: context.tomoriState.is_alter ? null : (context.tomoriState.persona_id ?? null),
    kind: "appearance",
  };
}

function resolveBotGuildAvatarUrl(context: StreamContext): string | undefined {
  const guild = "guild" in context.channel ? context.channel.guild : null;
  return guild?.members.me?.displayAvatarURL();
}

export class StreamUiUpdater {
  public constructor(private readonly deps: StreamUiUpdaterDependencies) {}

  public async sendSinglePayload(
    payload: StreamSendPayload,
    textForState: string,
    context: StreamContext,
    state: StreamState,
  ): Promise<Message | null> {
    if (!payload.content?.trim() && (!payload.files || payload.files.length === 0)) {
      return null;
    }

    const {
      identityOverride,
      accumulatedTextPrefix,
      spriteRecord: _spriteRecord,
      isNeutralAppearance: _isNeutralAppearance,
      diagnosticReason: _diagnosticReason,
      ...discordPayload
    } = payload;
    const textForAccumulation = `${accumulatedTextPrefix ?? ""}${textForState}`;
    const strictUserImpersonation = isUserImpersonationStreamContext(context);
    let replyNoticeMessage: Message | null = null;
    const threadId = resolveWebhookThreadId(context.channel);
    const webhookAllowedMentions = payload.allowedMentions ?? {
      parse: ["users", "roles"] as Array<"users" | "roles">,
      repliedUser: false,
    };
    const regularAllowedMentions = payload.allowedMentions ?? {
      repliedUser: false,
    };

    if (context.abortSignal?.aborted || this.deps.hasStopRequest(context.channel.id)) {
      log.info("Stream Send: Stop request detected before Discord API call, skipping message send");
      return null;
    }

    const sendMessageLimit = context.tomoriState.config.send_message_limit ?? 0;
    if (sendMessageLimit > 0 && state.messageSentCount >= sendMessageLimit) {
      log.info(
        `Send message limit reached: ${state.messageSentCount} messages sent (server limit: ${sendMessageLimit})`,
      );
      // Deliberate operator config, not a failure, and never reached before the first send
      // (messageSentCount only increments after one lands). Treating it as an error would make
      // generationTurn retry across every fallback key and model, each burning tokens on a
      // limit that can never pass.
      this.deps.requestStop(context.channel.id, "send_message_limit");
      return null;
    }

    if (state.messageSentCount >= STREAMING_LIMITS.MAX_FLUSH_COUNT) {
      log.warn(
        `Flush limit exceeded: ${state.messageSentCount} messages sent (limit: ${STREAMING_LIMITS.MAX_FLUSH_COUNT})`,
      );

      // Deterministic like the send limit above, so throwing would only buy pointless retries
      // across every fallback key and model. The warn above is the operator-facing signal.
      // The embed stays off during impersonation for the same reason every other notice in this
      // subsystem does: a bot-authored embed under a user's identity breaks the disguise.
      if (!context.suppressUserErrors && !strictUserImpersonation) {
        await sendStandardEmbed(context.channel, context.locale, {
          titleKey: "genai.stream.flush_limit_title",
          descriptionKey: "genai.stream.flush_limit_description",
          color: ColorCode.WARN,
        }).catch((embedError) => {
          log.warn(
            "Failed to send flush limit warning embed",
            embedError instanceof Error ? embedError : new Error(String(embedError)),
          );
        });
      }

      this.deps.requestStop(context.channel.id, "flush_limit");
      return null;
    }

    try {
      if (strictUserImpersonation && !context.webhook) {
        throw new Error("User impersonation requires a temporary webhook, but none is available.");
      }

      let sentMessage: Message | null = null;
      // Captured so recordSuccessfulSend can remember exactly which identity Discord saw:
      // including the decorated group-break username: for later sends to reuse.
      let deliveredWebhookIdentity: ResolvedWebhookIdentity | undefined;
      let deliveredSpeaker: DeliveredSpeaker | undefined;
      const webhookForIdentity = identityOverride
        ? await this.resolveWebhookForIdentityOverride(context)
        : context.webhook;
      const shouldUseWebhook =
        Boolean(identityOverride && webhookForIdentity) || Boolean(context.webhook && context.personaUsername);

      if (shouldUseWebhook && webhookForIdentity) {
        // A partial channel cannot be sent into, and the chunks after the first one send through
        // `context.channel` regardless of which branch delivered this one. Resolving it here keeps
        // a webhook-delivered first chunk from leaving every later chunk on an unusable object.
        //
        // The captured channel is the one resolved, not the reply source: this send is not a reply,
        // so retargeting the stream to another channel to satisfy a reference that is not being
        // built would move later chunks as well.
        if (typeof (context.channel as { send?: unknown }).send !== "function") {
          try {
            const resolvedChannel = await resolveSendableChannel(context.client, context.channel.id);
            if (resolvedChannel.channel) {
              context.channel = resolvedChannel.channel;
            } else {
              stopForUnreachableChannel(this.deps, context.channel.id, resolvedChannel.failed, undefined);
              return null;
            }
          } catch (resolveError) {
            // A transient failure here is not a reason to drop the message: this resolution only
            // upgrades what the later chunks can use, and the webhook below is what actually
            // delivers this one. Killing the send would turn a rate limit into a lost reply.
            log.warn(
              `Stream Send: could not resolve channel ${context.channel.id} before a webhook send; continuing with the captured channel`,
              resolveError as Error,
            );
          }
        }

        const identity =
          identityOverride ??
          ({
            username: context.personaUsername,
            avatarUrl: context.personaAvatarUrl,
            avatarDataUri: context.personaAvatarUrl?.startsWith("data:image/") ? context.personaAvatarUrl : undefined,
          } satisfies ResolvedWebhookIdentity);
        const speaker = classifyWebhookSpeaker(payload, context, strictUserImpersonation);
        log.info(
          `Stream Send: Using webhook for persona "${identity.username ?? context.personaUsername ?? "unknown"}"${
            identity.avatarUrl || identity.avatarDataUri ? " with custom avatar" : " (default avatar)"
          }`,
        );

        // Any webhook delivery forfeits Discord's native reply (webhooks cannot reply), so the
        // standalone notice embed is the only reply indicator available: for the main persona
        // rendering a sprite just as much as for an alter. Gating this on `is_alter` hid the
        // notice whenever the main persona switched to a webhook for a sprite, and gating on
        // `!identityOverride` hid it from sprite renders generally, alters included.
        //
        // Sprites are the persona speaking as itself, so a notice is correct; COPIED identities
        // (impersonating a user or another persona) must stay silent, since a notice posted
        // under the disguise would attribute the reply to the wrong speaker. `spriteRecord` is
        // exactly what distinguishes the two.
        const isSpriteIdentity = Boolean(payload.spriteRecord);
        if (
          (!identityOverride || isSpriteIdentity) &&
          !strictUserImpersonation &&
          context.replyToMessage &&
          context.replyNoticeState &&
          !context.replyNoticeState.attempted &&
          state.messageSentCount === 0
        ) {
          context.replyNoticeState.attempted = true;
          const replyToMessage = context.replyToMessage;
          try {
            replyNoticeMessage = (
              await this.sendWebhookWithAvatarFallback(
                webhookForIdentity,
                identity,
                speaker,
                context,
                "reply_notice",
                (sendIdentity, sendOptions) =>
                  sendWebhookReplyNotice(webhookForIdentity, replyToMessage, context.locale, sendIdentity, {
                    threadId,
                    botUserId: context.client.user?.id,
                    botName: context.tomoriState.persona_nickname,
                    ...sendOptions,
                  }),
              )
            ).result;
            context.replyNoticeState.sent = true;
          } catch (noticeError) {
            log.warn("Stream Send: Failed to send standalone alter reply notice", noticeError as Error);
          }
        }

        const webhookSend = await this.sendWebhookWithAvatarFallback(
          webhookForIdentity,
          identity,
          speaker,
          context,
          "message",
          (sendIdentity, sendOptions) =>
            sendWebhookMessageWithIdentity(
              webhookForIdentity,
              {
                ...(discordPayload.content !== undefined ? { content: discordPayload.content } : {}),
                ...(discordPayload.files?.length ? { files: discordPayload.files } : {}),
                ...(discordPayload.components?.length ? { components: discordPayload.components } : {}),
                allowedMentions: webhookAllowedMentions,
                ...(threadId ? { threadId } : {}),
              },
              sendIdentity,
              undefined,
              sendOptions,
            ),
        );

        sentMessage = webhookSend.result;
        // The avatar Discord actually showed, which differs from `identity` after a fallback. The
        // sprite record and the active render modifier keep the intended sprite, so the next line
        // retries the edit and the model's history still names the sprite it chose.
        deliveredWebhookIdentity = webhookSend.identity;
        deliveredSpeaker = speaker;
        state.hasRepliedToOriginalMessage = true;
      } else if (!state.hasRepliedToOriginalMessage && context.replyToMessage) {
        const target = await resolveReplyTarget(context);
        if (!target.channel) {
          throw unreachableChannelError(target.failed, context.replyToMessage.channelId);
        }

        sentMessage = await target.channel.send({
          ...(discordPayload.content !== undefined ? { content: discordPayload.content } : {}),
          ...(discordPayload.files?.length ? { files: discordPayload.files } : {}),
          ...(discordPayload.components?.length ? { components: discordPayload.components } : {}),
          ...(target.reply ? { reply: target.reply } : {}),
          allowedMentions: regularAllowedMentions,
        });
        state.hasRepliedToOriginalMessage = true;
      } else {
        sentMessage = await context.channel.send({
          ...(discordPayload.content !== undefined ? { content: discordPayload.content } : {}),
          ...(discordPayload.files?.length ? { files: discordPayload.files } : {}),
          ...(discordPayload.components?.length ? { components: discordPayload.components } : {}),
          allowedMentions: regularAllowedMentions,
        });
      }

      // Clears any cached refusal so a lifted timeout or a granted permission takes effect at
      // once, rather than after the remainder of the TTL.
      clearSendFailure(context.channel.id);
      this.recordSuccessfulSend(
        payload,
        textForAccumulation,
        context,
        state,
        sentMessage,
        deliveredWebhookIdentity,
        "normal",
        deliveredSpeaker,
      );
      return sentMessage;
    } catch (discordError) {
      // An unreachable destination is final: nothing can be posted, and neither webhook recovery
      // nor the bot fallback can change that. Tearing the stream down quietly is the same treatment
      // the deterministic limits above get, and it keeps one deletion from producing a burst of
      // error rows across the orchestrator, the generation turn, and the queue.
      if (isChannelGoneError(discordError)) {
        stopForUnreachableChannel(this.deps, context.channel.id, unreachableReasonFor(discordError), discordError);
        return null;
      }

      const recoveredMessage = await this.tryRecoverWebhookSend(
        discordError,
        payload,
        textForAccumulation,
        context,
        state,
        webhookAllowedMentions,
        identityOverride,
      );
      if (recoveredMessage) {
        return recoveredMessage;
      }

      if (
        !strictUserImpersonation &&
        ((context.webhook && context.personaUsername) || identityOverride) &&
        !state.hasRepliedToOriginalMessage
      ) {
        const fallbackMessage = await this.tryFallbackBotSend(
          discordError,
          replyNoticeMessage,
          threadId,
          payload,
          textForAccumulation,
          context,
          state,
          regularAllowedMentions,
          identityOverride,
        );
        if (fallbackMessage) {
          return fallbackMessage;
        }
      }

      if (strictUserImpersonation) {
        log.warn(
          "Stream Send: User impersonation webhook send failed; not falling back to a regular bot message",
          discordError as Error,
        );
      }

      // A refused send is cached so the admission gate can stop generating for this channel.
      // Only the first refusal of an episode is logged at error level: the rest are the same
      // fact repeated, and at error level they crowd out unrelated signal.
      const sendFailureReason = classifySendFailure(discordError);
      recordChatDiagnostic({ kind: "send_failed", reason: sendFailureReason ?? "other" });
      const isFirstOfEpisode = sendFailureReason
        ? noteSendFailure(context.channel.id, sendFailureReason).isFirstOfEpisode
        : true;

      const sendErrorMetadata = {
        serverId: context.tomoriState?.server_id,
        errorType: "StreamOrchestrator",
        metadata: {
          channelId: context.channel.id,
          contentLength: textForAccumulation.length,
          contentPreview: textForAccumulation.substring(0, 200),
          usingWebhook: !!context.webhook || !!identityOverride,
          ...(sendFailureReason ? { sendFailureReason } : {}),
        },
      };

      if (isFirstOfEpisode) {
        log.error("Stream Send: Discord API error when sending message", discordError, sendErrorMetadata);
      } else {
        log.warn(
          `Stream Send: suppressed repeat ${sendFailureReason} for channel ${context.channel.id}`,
          discordError as Error,
        );
      }

      throw new Error(
        `Discord send failed: ${discordError instanceof Error ? discordError.message : String(discordError)}`,
      );
    }
  }

  private recordSuccessfulSend(
    payload: StreamSendPayload,
    textForState: string,
    context: StreamContext,
    state: StreamState,
    sentMessage: Message | null,
    deliveredWebhookIdentity?: ResolvedWebhookIdentity,
    route: "normal" | "webhook_recovery" | "bot_fallback" = "normal",
    deliveredSpeaker?: DeliveredSpeaker,
  ): void {
    if (!state.firstReplyUrl && sentMessage?.url) {
      state.firstReplyUrl = sentMessage.url;
    }

    // Remember what Discord will group against, so artifacts that follow (expressions, the
    // "Fallback Used" notice) can reuse the same author instead of splitting off under a
    // different name. A bot-message send clears it: reverting to the bot means artifacts must
    // follow, or they would group with nothing.
    if (sentMessage) {
      if (deliveredWebhookIdentity && sentMessage.webhookId) {
        recordChannelDeliveredWebhookIdentity(
          context.channel.id,
          deliveredWebhookIdentity,
          sentMessage.id,
          deliveredSpeaker ?? null,
        );
      } else {
        recordChannelDeliveredBotMessage(context.channel.id, classifyBotSpeaker(context));
      }
    }
    // Persist the message → sprite mapping fire-and-forget; webhook sends only
    // (bot-fallback messages can't carry persona identity in context anyway).
    // A lost row degrades the future context label to the plain persona name.
    if (payload.spriteRecord && sentMessage?.webhookId) {
      void recordPersonaSpriteMessage({
        messageDiscId: sentMessage.id,
        personaId: payload.spriteRecord.personaId,
        spriteName: payload.spriteRecord.spriteName,
        channelDiscId: sentMessage.channelId,
      }).catch((recordError) => {
        log.warn("Stream Send: Failed to record sprite message mapping", recordError as Error);
      });
      // Track the delivered sprite label so the post-turn stat recorder can count
      // `sprite_shown` / `sprite_emotion` (the stream layer has no internal user id;
      // post-turn does). isIdentity rides along so identity sprites are kept out of
      // the emotion count while still counting toward sprite_shown.
      state.spritesShown.push({
        name: payload.spriteRecord.spriteName,
        isIdentity: payload.spriteRecord.isIdentity,
      });
    }
    state.messageSentCount++;
    if (sentMessage) {
      recordChatMessageSent(
        sentMessage.id,
        sentMessage.webhookId ? "webhook" : "bot",
        payload.diagnosticReason,
        state.messageSentCount,
        route,
      );
    }
    if (textForState) {
      state.accumulatedText += textForState;
    }
    // Record the committed message so a later fallback attempt can delete this attempt's partial
    // output if it turns out to be superseded (see runGenerationTurn). The array is a shared
    // reference off StreamingContext, so appends survive an abandoned (timed-out) stream promise.
    if (context.deliveredMessageRefs && sentMessage) {
      context.deliveredMessageRefs.push({
        messageId: sentMessage.id,
        channelId: sentMessage.channelId,
        isWebhook: Boolean(sentMessage.webhookId),
      });
    }
    this.deps.notifyStreamProgress(context);
    const logPreview = textForState
      ? textForState.length > 100
        ? `${textForState.substring(0, 100)}...`
        : textForState
      : `[attachment payload: ${payload.files?.length ?? 0} file(s)]`;
    log.info(`Stream Send: Sent message (${state.messageSentCount}): "${logPreview}"`);
  }

  /**
   * Sends through the webhook, delivering under the last displayed avatar instead of waiting when
   * the line's own avatar edit is rate-limited and the fallback cannot misattribute the speaker.
   * Any line that is not eligible waits out the limit exactly as before.
   */
  private async sendWebhookWithAvatarFallback<T>(
    webhook: Webhook,
    intended: ResolvedWebhookIdentity,
    speaker: DeliveredSpeaker,
    context: StreamContext,
    phase: "reply_notice" | "message",
    send: (identity: ResolvedWebhookIdentity, options: WebhookIdentitySendOptions) => Promise<T>,
  ): Promise<{ result: T; identity: ResolvedWebhookIdentity }> {
    let deferral: WebhookAvatarEditDeferredError;
    try {
      return { result: await send(intended, { deferAvatarEditOnRateLimit: true }), identity: intended };
    } catch (error) {
      if (!(error instanceof WebhookAvatarEditDeferredError)) throw error;
      deferral = error;
    }

    const fallback = resolveAvatarPatchFallback(
      intended,
      speaker,
      getChannelLastDelivery(context.channel.id),
      getWebhookStoredAvatarDataUri(webhook.id),
      resolveBotGuildAvatarUrl(context),
    );
    const outcome = fallback ? "fell_back" : "waited";
    log.warn(
      `Stream Send: webhook avatar edit rate-limited for ${deferral.timeToResetMs}ms (${phase}); ${
        fallback ? `delivering under the previous avatar (${fallback.source})` : "waiting for the edit"
      }`,
    );
    log.metric("webhook_avatar_patch_rate_limited", {
      webhook_id: deferral.webhookId,
      channel_id: context.channel.id,
      persona_id: speaker.personaId ?? "unknown",
      speaker_kind: speaker.kind,
      time_to_reset_ms: deferral.timeToResetMs,
      phase,
      outcome,
      ...(fallback ? { fallback_source: fallback.source } : {}),
    });

    if (fallback) {
      try {
        return {
          result: await send(fallback.identity, { deferAvatarEditOnRateLimit: true }),
          identity: fallback.identity,
        };
      } catch (fallbackError) {
        // Another send changed the stored avatar between the decision and this one, so the
        // fallback itself now needs the edit; waiting for the intended avatar is the safe answer.
        if (!(fallbackError instanceof WebhookAvatarEditDeferredError)) throw fallbackError;
      }
    }

    return { result: await send(intended, {}), identity: intended };
  }

  private async resolveWebhookForIdentityOverride(
    context: StreamContext,
  ): Promise<import("discord.js").Webhook | null> {
    if (context.webhook) {
      return context.webhook;
    }

    const webhookTargetChannel = resolveWebhookTargetChannel(context.channel);
    if (!webhookTargetChannel) {
      return null;
    }

    const webhookResult = await getOrCreateWebhook(webhookTargetChannel);
    if (!webhookResult.webhook) {
      return null;
    }

    context.webhook = webhookResult.webhook;
    return webhookResult.webhook;
  }

  private async tryRecoverWebhookSend(
    discordError: unknown,
    payload: StreamSendPayload,
    textForState: string,
    context: StreamContext,
    state: StreamState,
    webhookAllowedMentions: NonNullable<StreamSendPayload["allowedMentions"]>,
    identityOverride?: ResolvedWebhookIdentity,
  ): Promise<Message | null> {
    // Recover whenever a webhook-backed persona identity was in play: mirror
    //    the send/fallback gate (context.webhook && personaUsername) rather than
    //    limiting to alters, since non-alter sprite personas send via webhook too.
    // Retry on invalid-webhook errors (stale webhook -> recreate) AND transient
    //    aborts (webhook still valid -> recreate + resend preserves persona avatar).
    const shouldRecoverWebhook =
      context.webhook &&
      (context.personaUsername || identityOverride) &&
      (isInvalidWebhookError(discordError) || isTransientWebhookError(discordError));

    if (!shouldRecoverWebhook) {
      return null;
    }

    const webhookTargetChannel = resolveWebhookTargetChannel(context.channel);
    if (!webhookTargetChannel) {
      return null;
    }

    try {
      invalidateWebhookCache(webhookTargetChannel.id);
      const recreatedWebhookResult = await getOrCreateWebhook(webhookTargetChannel);
      const recreatedWebhook = recreatedWebhookResult.webhook;
      if (!recreatedWebhook) {
        return null;
      }

      const recoveredThreadId = resolveWebhookThreadId(context.channel);
      const recoveredIdentity =
        identityOverride ??
        ({
          username: context.personaUsername,
          avatarUrl: context.personaAvatarUrl,
          avatarDataUri: context.personaAvatarUrl?.startsWith("data:image/") ? context.personaAvatarUrl : undefined,
        } satisfies ResolvedWebhookIdentity);

      const recoveredReplyMessage = await sendWebhookMessageWithIdentity(
        recreatedWebhook,
        {
          ...(payload.content !== undefined ? { content: payload.content } : {}),
          ...(payload.files?.length ? { files: payload.files } : {}),
          ...(payload.components?.length ? { components: payload.components } : {}),
          allowedMentions: webhookAllowedMentions,
          ...(recoveredThreadId ? { threadId: recoveredThreadId } : {}),
        },
        recoveredIdentity,
      );

      context.webhook = recreatedWebhook;
      state.hasRepliedToOriginalMessage = true;
      this.recordSuccessfulSend(
        payload,
        textForState,
        context,
        state,
        recoveredReplyMessage,
        undefined,
        "webhook_recovery",
      );
      log.info("Stream Send: Recreated webhook after invalid webhook error and resumed persona sending");
      return recoveredReplyMessage;
    } catch (recoveryError) {
      log.warn(
        "Stream Send: Webhook recovery attempt failed, falling back to regular bot message",
        recoveryError as Error,
      );
      return null;
    }
  }

  private async tryFallbackBotSend(
    discordError: unknown,
    replyNoticeMessage: Message | null,
    threadId: string | undefined,
    payload: StreamSendPayload,
    textForState: string,
    context: StreamContext,
    state: StreamState,
    regularAllowedMentions: NonNullable<StreamSendPayload["allowedMentions"]>,
    identityOverride?: ResolvedWebhookIdentity,
  ): Promise<Message | null> {
    log.warn("Stream Send: Webhook send failed, falling back to regular bot message", discordError);

    try {
      if (!identityOverride && replyNoticeMessage && context.webhook) {
        await context.webhook.deleteMessage(replyNoticeMessage.id, threadId).catch((deleteError) => {
          log.warn("Stream Send: Failed to delete standalone alter reply notice after webhook fallback", deleteError);
        });
      }

      const target = await resolveReplyTarget(context);
      if (!target.channel) {
        throw unreachableChannelError(target.failed, context.replyToMessage?.channelId ?? context.channel.id);
      }

      const fallbackMessage = await target.channel.send({
        ...(payload.content !== undefined ? { content: payload.content } : {}),
        ...(payload.files?.length ? { files: payload.files } : {}),
        ...(payload.components?.length ? { components: payload.components } : {}),
        ...(target.reply ? { reply: target.reply } : {}),
        allowedMentions: regularAllowedMentions,
      });

      state.hasRepliedToOriginalMessage = true;
      this.recordSuccessfulSend(payload, textForState, context, state, fallbackMessage, undefined, "bot_fallback");
      log.info("Stream Send: Successfully sent message via fallback after webhook failure");
      return fallbackMessage;
    } catch (fallbackError) {
      // This path is a retry of a send that already failed, so an unreachable channel reaches it
      // whenever the webhook was the first thing to notice it. Returning null lets the caller's
      // own handler stop the stream; treating it as a plain failure here would log an error and
      // leave generation running against a channel that cannot receive anything.
      if (isChannelGoneError(fallbackError)) {
        stopForUnreachableChannel(this.deps, context.channel.id, unreachableReasonFor(fallbackError), fallbackError);
        return null;
      }

      log.error("Stream Send: Both webhook and fallback failed", fallbackError, {
        serverId: context.tomoriState?.server_id,
        errorType: "StreamOrchestrator",
        metadata: {
          channelId: context.channel.id,
          webhookError: String(discordError),
          fallbackError: String(fallbackError),
        },
      });
      return null;
    }
  }
}
