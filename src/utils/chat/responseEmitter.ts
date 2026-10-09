import type { AnyThreadChannel, BaseGuildTextChannel, Client, Message, TextChannel } from "discord.js";
import { ChannelType } from "discord.js";
import type { WebhookCreateErrorReason } from "@/utils/discord/webhook/fallback";
import { getOrCreateWebhook, resolvePersonaWebhookIdentity } from "@/utils/discord/webhookManager";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { ColorCode, log } from "@/utils/misc/logger";
import { channelLocks, setActiveChannelTurnState, setChannelToolCallChainActive } from "@/utils/chat/channelQueue";
import { cacheUserImpersonationWebhook, resolveImpersonatedIdentity } from "@/utils/chat/webhookIdentity";
import type { ChatResponseSink, ChatResponseTarget, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import type { ProviderError } from "@/types/stream/interfaces";

const WEBHOOK_ERROR_COOLDOWN_MS = 10 * 60_000;
const webhookErrorCooldowns = new Map<string, number>();

function shouldSendWebhookError(channelId: string): boolean {
  const now = Date.now();
  const lastSent = webhookErrorCooldowns.get(channelId) ?? 0;

  if (now - lastSent < WEBHOOK_ERROR_COOLDOWN_MS) {
    return false;
  }

  webhookErrorCooldowns.set(channelId, now);
  return true;
}

async function sendWebhookErrorEmbed(
  channel: BaseGuildTextChannel | AnyThreadChannel,
  locale: string,
  reason: WebhookCreateErrorReason,
): Promise<void> {
  if (!shouldSendWebhookError(channel.id)) {
    return;
  }

  const titleKey =
    reason === "missing_permissions"
      ? "general.errors.webhook_missing_permissions_title"
      : reason === "max_webhooks"
        ? "general.errors.webhook_limit_title"
        : "general.errors.webhook_unknown_error_title";
  const descriptionKey =
    reason === "missing_permissions"
      ? "general.errors.webhook_missing_permissions_description"
      : reason === "max_webhooks"
        ? "general.errors.webhook_limit_description"
        : "general.errors.webhook_unknown_error_description";

  await sendStandardEmbed(channel, locale, {
    color: ColorCode.WARN,
    titleKey,
    descriptionKey,
  });
}

export function createChatResponseSink(context: ChatTurnContext): ChatResponseSink {
  let target: ChatResponseTarget | undefined;
  let temporaryWebhookReleased = false;

  // Guarded so the guaranteed cleanup path and a normal finalize cannot both issue the delete
  // and log a spurious 404 warning for the second one.
  const releaseTemporaryWebhook = async (): Promise<void> => {
    if (!target?.temporaryWebhook || temporaryWebhookReleased) return;
    temporaryWebhookReleased = true;
    await target.temporaryWebhook.delete("User impersonation complete").catch((error: unknown) => {
      log.warn("Failed to delete temporary user impersonation webhook", error);
    });
  };

  return {
    async prepare() {
      target = await resolveResponseTarget(context);
      context.responseTarget = target;
      const lockEntry = channelLocks.get(context.turn.lockedTurn.channelId);
      if (lockEntry) {
        setActiveChannelTurnState(lockEntry, {
          activePersonaId: context.currentPersona.persona_id ?? undefined,
          triggeredPersonaIds: context.turn.triggeredPersonaIds,
          followUpEligible: context.currentPersona.persona_id !== undefined,
          isUserImpersonation: context.isUserImpersonation,
          impersonatedUserId: context.impersonatedUserId,
        });
        setChannelToolCallChainActive(lockEntry, false);
      }
      return target;
    },
    async emitStreamResult(result) {
      if (result.status !== "error") return;
      // ProviderErrors are already surfaced by the state machine's handleProviderError.
      // Calling emitGenerationError here would send a second, generic embed on top of the
      // specific one (e.g. "🔴️ Provider Content Filter" + "Generation Error"). Skip it.
      if (isProviderError(result.data)) return;
      await emitGenerationError(context, result.data);
    },
    async emitError(error: unknown) {
      await emitGenerationError(context, error);
    },
    async finalize(result: GenerationTurnResult) {
      await releaseTemporaryWebhook();
      log.info(
        `Chat response finalized for message ${context.message.id} with status ${result.status} and ${result.personaResponses.length} captured response(s).`,
      );
    },
    async cleanup() {
      await releaseTemporaryWebhook();
    },
  };
}

async function resolveResponseTarget(context: ChatTurnContext): Promise<ChatResponseTarget | undefined> {
  const { channel, currentPersona, guild } = context;
  if (context.isDMChannel || !guild || !supportsWebhookDelivery(channel)) {
    return undefined;
  }

  const webhookTargetChannel = channel.isThread() && channel.parent ? channel.parent : channel;
  if (!("fetchWebhooks" in webhookTargetChannel) || !("createWebhook" in webhookTargetChannel)) {
    return undefined;
  }

  if (context.isUserImpersonation && context.impersonatedUserId) {
    return await createUserImpersonationTarget(context, webhookTargetChannel as TextChannel);
  }

  if (!currentPersona.is_alter) {
    return undefined;
  }

  const webhookResult = await getOrCreateWebhook(webhookTargetChannel as BaseGuildTextChannel);
  if (!webhookResult.webhook) {
    if (webhookResult.errorReason && context.shouldSurfaceUserErrors) {
      await sendWebhookErrorEmbed(
        channel as BaseGuildTextChannel | AnyThreadChannel,
        context.locale,
        webhookResult.errorReason,
      );
    }
    return undefined;
  }

  const identity = await resolvePersonaWebhookIdentity(currentPersona, guild);
  return {
    webhook: webhookResult.webhook,
    personaUsername: identity.username ?? currentPersona.persona_nickname,
    personaAvatarUrl: identity.avatarDataUri ?? identity.avatarUrl,
    webhookTargetChannel: webhookTargetChannel as BaseGuildTextChannel,
  };
}

async function createUserImpersonationTarget(
  context: ChatTurnContext,
  webhookTargetChannel: TextChannel,
): Promise<ChatResponseTarget | undefined> {
  if (!context.impersonatedUserId) return undefined;

  const identity = await resolveImpersonatedIdentity(
    context.client,
    context.guild,
    context.impersonatedUserId,
    undefined,
  );
  // A whitespace-only display name is truthy, so it would reach Discord as the webhook name.
  const displayName = identity.displayName.trim() || "User";
  const webhook = await webhookTargetChannel.createWebhook({
    name: displayName,
    avatar: identity.avatarUrl || undefined,
    reason: "TomoriBot user impersonation",
  });

  cacheUserImpersonationWebhook(webhook.id, context.impersonatedUserId);
  return {
    webhook,
    temporaryWebhook: webhook,
    personaUsername: displayName,
    personaAvatarUrl: identity.avatarUrl,
    prefixStrippingName: displayName,
    webhookTargetChannel,
  };
}

function supportsWebhookDelivery(channel: ChatTurnContext["channel"]): boolean {
  return (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread
  );
}

function isProviderError(value: unknown): value is ProviderError {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "retryable" in value &&
    typeof (value as ProviderError).retryable === "boolean"
  );
}

async function emitGenerationError(context: ChatTurnContext, error: unknown): Promise<void> {
  if (context.streamingContext?.generationErrorReported) {
    // The same failed turn reports through the stream result and again from the turn's catch
    // block. Logging both turns one failure into two `Generation failed` rows for one message id
    // and sends the user a second error embed.
    log.warn(`Suppressing repeat generation error report for message ${context.message.id}`, error);
    return;
  }
  if (context.streamingContext) {
    context.streamingContext.generationErrorReported = true;
  }

  log.error(`Generation failed for message ${context.message.id}`, error);
  if (context.isUserImpersonation) {
    throw error instanceof Error ? error : new Error("User impersonation failed before a reply could be sent.");
  }
  if (!context.shouldSurfaceUserErrors) {
    log.warn(`Suppressing generation error embed for non-deliberate chat turn ${context.message.id}`);
    return;
  }

  await sendStandardEmbed(
    context.channel as Parameters<typeof sendStandardEmbed>[0],
    context.locale,
    {
      color: ColorCode.ERROR,
      titleKey: "genai.generic_error_title",
      descriptionKey: "genai.stream.streaming_failed_description",
      tipKeys: ["genai.tips.refresh_context"],
    },
    {
      webhook: context.responseTarget?.webhook,
      personaUsername: context.responseTarget?.personaUsername,
      personaAvatarUrl: context.responseTarget?.personaAvatarUrl,
    },
  ).catch((embedError: unknown) => {
    // Reporting a failure must not itself fail. The two causes worth naming are a channel the
    // send cannot reach (deleted, or the bot lost access), where the retry this would trigger
    // reports the same failure again and turns one error into a burst, and the same refusal
    // the original send already reported.
    log.warn(`Failed to send the generation error embed for message ${context.message.id}`, embedError);
  });
}

export async function handleStopResponse(originalStopMessage: Message, client: Client): Promise<void> {
  try {
    log.info(
      `Generating stop response for message ${originalStopMessage.id} in channel ${originalStopMessage.channel.id}`,
    );

    const { tomoriChat } = await import("@/events/messageCreate/tomoriChat");
    await tomoriChat({
      client,
      message: originalStopMessage,
      isFromQueue: true,
      isManuallyTriggered: true,
      forceReason: false,
      isStopResponse: true,
      shouldSurfaceUserErrors: true,
    });
  } catch (error) {
    log.error("Failed to handle stop response:", error);
  }
}
