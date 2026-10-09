import {
  AttachmentBuilder,
  DiscordAPIError,
  SnowflakeUtil,
  type Message,
  type MessageCreateOptions,
  type Sticker,
  type Webhook,
} from "discord.js";
import type { StickerSelection } from "@/types/discord/stickerSelection";
import type { ToolResult } from "@/types/tool/interfaces";
import type { ChatTurnContext } from "@/utils/chat/types";
import { statRepository } from "@/utils/db/repositories";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { isStickerUnusableError, markStickerRejected } from "@/utils/discord/stickerAvailability";
import { customExpressionIsEligible, nativeStickerIsEligible } from "@/utils/discord/stickerCandidates";
import {
  type DeliveredSpeaker,
  getChannelLastDelivery,
  recordChannelDeliveredBotMessage,
  recordChannelDeliveredWebhookIdentity,
} from "@/utils/discord/stream/channelDeliveryContinuity";
import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import {
  resolveManagedChannelWebhook,
  sendWebhookMessageOnce,
  WebhookExpressionRateLimitTimeoutError,
} from "@/utils/discord/webhook/webhookCore";
import { log } from "@/utils/misc/logger";
import { EXPRESSION_MEDIA_MAX_BYTES } from "@/utils/storage/expressionMedia";
import { loadExpressionMedia } from "@/utils/storage/expressionStorage";

/** Discord acceptance of one expression message. Internal only: the model sees the name alone. */
interface ExpressionDeliveryReceipt {
  /** Native sticker id or custom expression id, which is what a repeated call is compared by. */
  expressionKey: string;
  name: string;
  messageId: string;
}

/**
 * The one-expression-per-turn allowance. It lives on the persona turn rather than the stream state,
 * because the stream state is rebuilt for every SDK request and the allowance must survive tool-loop
 * continuations, context restarts, model fallbacks, and the empty-response retry.
 *
 * The single-expression ceiling is a product choice, not a Discord limit. A demonstrated need for
 * several distinct reactions in one reply is what would justify a bounded multi-delivery policy.
 */
export interface ExpressionDeliveryState {
  delivered: ExpressionDeliveryReceipt | null;
  /**
   * Set while a send is in flight and kept when Discord never confirmed the outcome. It blocks every
   * later send this turn, since the earlier message may already be visible and a resend would double it.
   */
  unconfirmedKey: string | null;
}

export type SettledExpressionDelivery =
  | { status: "delivered" | "already_delivered" | "limit_reached"; receipt: ExpressionDeliveryReceipt }
  | { status: "unconfirmed" | "unavailable" | "rejected" };

export type ExpressionDeliveryOutcome = SettledExpressionDelivery | { status: "cancelled" };

type PreparedExpression =
  | { kind: "native"; sticker: Sticker }
  | { kind: "custom"; serverId: number; id: string; payload: MessageCreateOptions };

type DeliveryRoute =
  | { via: "webhook"; identity: ResolvedWebhookIdentity; speaker: DeliveredSpeaker | null }
  | { via: "bot"; reply: boolean };

/** Nothing could be posted because no usable route exists, which is a definite non-delivery. */
class ExpressionSendRejected extends Error {}

/** A stop observed immediately before a POST, so nothing was posted. */
class ExpressionSendCancelled extends Error {}

/** The fields delivery reads from either transport's created message. */
type SentExpressionMessage = Pick<Message, "id" | "webhookId">;

export function createExpressionDeliveryState(): ExpressionDeliveryState {
  return { delivered: null, unconfirmedKey: null };
}

/**
 * Sends the resolved expression as its own message and records the turn's receipt.
 *
 * Text emitted before the tool call is already committed by the stream's function-call flush, so
 * the expression lands after it. Eligibility, whitelist, and stored media are rechecked here because
 * resolution happened earlier and an edit can land in between.
 *
 * @param isCancelled - Checked immediately before each outbound POST, after webhook resolution and any
 *   avatar update, so a stop raised while those are in flight prevents the send instead of racing it
 */
export async function deliverExpression(
  context: ChatTurnContext,
  selection: StickerSelection,
  name: string,
  isCancelled: () => boolean,
): Promise<ExpressionDeliveryOutcome> {
  const state = context.expressionDelivery;
  const expressionKey = selection.kind === "native" ? selection.sticker.id : selection.expressionId;
  if (state.delivered) {
    return {
      status: state.delivered.expressionKey === expressionKey ? "already_delivered" : "limit_reached",
      receipt: state.delivered,
    };
  }
  if (state.unconfirmedKey) return { status: "unconfirmed" };

  const prepared = await prepareExpression(context, selection);
  if (!prepared) return { status: "unavailable" };
  const route = resolveDeliveryRoute(context);
  const assertNotCancelled = () => {
    if (isCancelled()) throw new ExpressionSendCancelled();
  };

  state.unconfirmedKey = expressionKey;
  let message: SentExpressionMessage;
  let deliveredRoute: DeliveryRoute;
  try {
    ({ message, route: deliveredRoute } = await sendPreparedExpression(context, prepared, route, assertNotCancelled));
  } catch (error) {
    if (!(error instanceof ExpressionSendCancelled)) return recordFailedSend(context, prepared, error);
    state.unconfirmedKey = null;
    return { status: "cancelled" };
  }

  state.unconfirmedKey = null;
  state.delivered = { expressionKey, name, messageId: message.id };
  recordDeliveryContinuity(context, deliveredRoute, message);
  recordExpressionUsage(context, prepared);
  log.info(`Delivered expression '${name}' at tool invocation (${deliveredRoute.via}).`);
  return { status: "delivered", receipt: state.delivered };
}

/**
 * Translates a delivery outcome into the tool result the model reads. Only the ordinary name and
 * the outcome are exposed: never the media kind, storage reference, source link, or ids.
 */
export function buildExpressionToolResult(outcome: SettledExpressionDelivery, requestedName: string): ToolResult {
  switch (outcome.status) {
    case "delivered":
      return {
        success: true,
        responseDelivered: true,
        message: "Sticker sent",
        data: {
          status: "sticker_sent",
          sticker_name: outcome.receipt.name,
          note: "The sticker is now posted as its own message after any text you already wrote. Continue your reply if you have more to say, without describing the sticker.",
        },
      };
    case "already_delivered":
      return {
        success: true,
        responseDelivered: true,
        message: "Sticker already sent",
        data: {
          status: "sticker_already_sent",
          sticker_name: outcome.receipt.name,
          note: "This sticker was already sent in this reply, so it was not sent again.",
        },
      };
    case "limit_reached":
      return {
        success: false,
        error: "Sticker limit reached",
        message: `This reply already sent the sticker "${outcome.receipt.name}". Only one sticker can be sent per reply, and the sent one cannot be replaced, so "${requestedName}" was not sent. Continue without another sticker.`,
      };
    case "unconfirmed":
      return {
        success: false,
        error: "Sticker delivery unconfirmed",
        message:
          "Discord did not confirm whether the sticker was sent, so it may already be visible. Do not call select_sticker_for_response again in this reply.",
      };
    case "unavailable":
      return {
        success: false,
        error: "Sticker unavailable",
        message: `"${requestedName}" can no longer be sent, so nothing was posted. Choose another sticker or continue without one.`,
      };
    case "rejected":
      return {
        success: false,
        error: "Sticker send rejected",
        message: `Discord rejected "${requestedName}", so nothing was posted. Choose another sticker or continue without one.`,
      };
  }
}

async function prepareExpression(
  context: ChatTurnContext,
  selection: StickerSelection,
): Promise<PreparedExpression | null> {
  if (selection.kind === "native") {
    const canUseExternal =
      !!context.client.user &&
      "permissionsFor" in context.channel &&
      !!context.channel.permissionsFor(context.client.user)?.has("UseExternalStickers");
    if (!context.guild || !nativeStickerIsEligible(selection.sticker, context.guild, canUseExternal)) return null;
    return { kind: "native", sticker: selection.sticker };
  }

  const { serverId, expressionId: id } = selection;
  const personaId = context.currentPersona.persona_id;
  if (context.isDMChannel || serverId !== context.tomoriState.server_id || !personaId) return null;
  try {
    const row = await serverRepository.loadCustomExpression(serverId, id);
    if (!row || !customExpressionIsEligible(row, personaId)) return null;
    const payload: MessageCreateOptions = { allowedMentions: { parse: [] } };
    if (row.delivery_kind === "link") {
      if (!row.original_link) return null;
      payload.content = row.original_link;
    } else {
      if (!row.storage_reference || !row.extension) return null;
      const buffer = await loadExpressionMedia(row.storage_reference, serverId, id);
      if (buffer.length !== row.byte_size || buffer.length > EXPRESSION_MEDIA_MAX_BYTES) {
        log.warn("Stored expression exceeds its validated delivery size", { serverId, metadata: { expressionId: id } });
        return null;
      }
      payload.files = [new AttachmentBuilder(buffer, { name: `expression-${id}.${row.extension}` })];
    }
    // Storage reads can outlive an edit or whitelist change, so the row is rechecked after them.
    const current = await serverRepository.loadCustomExpression(serverId, id);
    if (!current || current.revision !== row.revision || !customExpressionIsEligible(current, personaId)) return null;
    return { kind: "custom", serverId, id, payload };
  } catch (error) {
    log.warn("Custom expression preparation failed", {
      serverId,
      errorType: "CustomExpressionDeliveryError",
      metadata: { expressionId: id, errorName: error instanceof Error ? error.name : "unknown" },
    });
    return null;
  }
}

/**
 * Picks who posts the expression. Text this turn already delivered is what Discord will group
 * against, so its recorded identity is reused verbatim, including a sprite-decorated username.
 * Before any text, the persona's own response target decides: the channel's continuity at that
 * point describes an earlier turn, which may belong to another persona or sprite.
 */
function resolveDeliveryRoute(context: ChatTurnContext): DeliveryRoute {
  const turnHasDeliveredText = (context.streamingContext.deliveredMessageRefs?.length ?? 0) > 0;
  const personaId = context.currentPersona.persona_id ?? null;
  if (turnHasDeliveredText) {
    const last = getChannelLastDelivery(context.channel.id);
    if (last?.via === "webhook") return { via: "webhook", identity: last.identity, speaker: last.speaker };
    if (last?.via === "bot") return { via: "bot", reply: false };
  }
  const target = context.responseTarget;
  if (target?.webhook && target.personaUsername) {
    return {
      via: "webhook",
      identity: {
        username: target.personaUsername,
        avatarUrl: target.personaAvatarUrl,
        avatarDataUri: target.personaAvatarUrl?.startsWith("data:image/") ? target.personaAvatarUrl : undefined,
      },
      speaker: { personaId, kind: "appearance" },
    };
  }
  // Scene turns share one trigger message, so replying to it would make every persona answer the same line.
  const incoming = context.turn.lockedTurn.admission.incoming;
  return { via: "bot", reply: context.isFromQueue && !incoming.sceneTurn && !turnHasDeliveredText };
}

async function sendPreparedExpression(
  context: ChatTurnContext,
  prepared: PreparedExpression,
  route: DeliveryRoute,
  beforePost: () => void,
): Promise<{ message: SentExpressionMessage; route: DeliveryRoute }> {
  if (route.via === "webhook") {
    const webhook = await resolveWebhook(context);
    if (webhook) {
      try {
        return { message: await sendViaWebhook(context, webhook, prepared, route.identity, beforePost), route };
      } catch (error) {
        // Only a definite refusal may fall back. Any other failure might have posted the message.
        if (prepared.kind === "custom" || !(error instanceof DiscordAPIError)) throw error;
        log.warn("Webhook sticker send was rejected, falling back to a bot sticker send", error);
      }
    } else if (prepared.kind === "custom") {
      throw new ExpressionSendRejected("No webhook is available for the persona's identity.");
    }
  }
  const botRoute: DeliveryRoute = { via: "bot", reply: route.via === "bot" && route.reply };
  beforePost();
  return { message: await sendViaBot(context, prepared, botRoute.reply), route: botRoute };
}

/** Returns a webhook that can execute, or null, which is a definite non-delivery on that route. */
async function resolveWebhook(context: ChatTurnContext): Promise<Webhook | null> {
  try {
    const webhook = context.responseTarget?.webhook ?? (await resolveManagedChannelWebhook(context.channel));
    return webhook?.token ? webhook : null;
  } catch (error) {
    log.warn("Could not resolve a managed webhook for expression delivery", error);
    return null;
  }
}

function sendViaWebhook(
  context: ChatTurnContext,
  webhook: Webhook,
  prepared: PreparedExpression,
  identity: ResolvedWebhookIdentity,
  beforePost: () => void,
): Promise<SentExpressionMessage> {
  // Webhooks cannot attach native stickers, so a native sticker goes out as its media link.
  const payload = prepared.kind === "native" ? { content: prepared.sticker.url } : prepared.payload;
  return sendWebhookMessageOnce(
    webhook,
    {
      ...(payload.content ? { content: payload.content } : {}),
      ...(payload.files ? { files: payload.files } : {}),
      allowedMentions: { parse: [] },
      ...(context.channel.isThread() ? { threadId: context.channel.id } : {}),
    },
    identity,
    beforePost,
  );
}

async function sendViaBot(context: ChatTurnContext, prepared: PreparedExpression, reply: boolean): Promise<Message> {
  const payload: MessageCreateOptions =
    prepared.kind === "native" ? { stickers: [prepared.sticker.id] } : { ...prepared.payload };
  // discord.js retries a timed-out or 5xx request on its own. The enforced nonce makes Discord
  // return the first message for those retries instead of posting a second one. Webhook
  // execution has no nonce, so the webhook path disables transport retries instead.
  payload.nonce = SnowflakeUtil.generate().toString();
  payload.enforceNonce = true;
  if (reply) return context.message.reply({ ...payload, failIfNotExists: false });
  if (!("send" in context.channel) || typeof context.channel.send !== "function") {
    throw new ExpressionSendRejected(`Channel ${context.channel.id} does not support expression sends.`);
  }
  return context.channel.send(payload);
}

function recordFailedSend(
  context: ChatTurnContext,
  prepared: PreparedExpression,
  error: unknown,
): SettledExpressionDelivery {
  const unsendable = error instanceof ExpressionSendRejected;
  const definite =
    unsendable || error instanceof DiscordAPIError || error instanceof WebhookExpressionRateLimitTimeoutError;
  if (definite) context.expressionDelivery.unconfirmedKey = null;
  const discordCode = error instanceof DiscordAPIError && typeof error.code === "number" ? error.code : undefined;
  if (prepared.kind === "native") {
    // A 50081 refusal is permanent for that sticker id, so retiring it stops the model reselecting it.
    if (isStickerUnusableError(error)) {
      markStickerRejected(prepared.sticker.id);
      log.warn(`Discord rejected sticker '${prepared.sticker.name}' (${prepared.sticker.id}) as unusable.`);
    } else {
      log.warn(`Sticker '${prepared.sticker.name}' was not delivered`, error);
    }
  } else {
    // Discord errors can echo the submitted content, including signed media links, so only metadata is logged.
    log.warn("Custom expression delivery failed", {
      serverId: prepared.serverId,
      errorType: discordCode === 40005 ? "CustomExpressionUploadRejected" : "CustomExpressionDeliveryError",
      metadata: {
        expressionId: prepared.id,
        discordCode,
        definite,
        errorName: error instanceof Error ? error.name : "unknown",
      },
    });
  }
  return { status: unsendable ? "unavailable" : definite ? "rejected" : "unconfirmed" };
}

function recordDeliveryContinuity(
  context: ChatTurnContext,
  route: DeliveryRoute,
  message: SentExpressionMessage,
): void {
  if (route.via === "webhook" && message.webhookId) {
    recordChannelDeliveredWebhookIdentity(context.channel.id, route.identity, message.id, route.speaker);
    return;
  }
  const persona = context.currentPersona;
  recordChannelDeliveredBotMessage(context.channel.id, {
    personaId: persona.is_alter ? null : (persona.persona_id ?? null),
    kind: "appearance",
  });
}

/**
 * Records one verified use at acceptance, so a later stop or failed model request does not erase a
 * reaction that stays visible. DMs are skipped because `stat_counters.server_id` is a NOT NULL FK.
 */
function recordExpressionUsage(context: ChatTurnContext, prepared: PreparedExpression): void {
  const serverId = context.tomoriState.server_id;
  const userId = context.triggererUserId;
  if (context.isDMChannel || !serverId || !userId) return;
  try {
    statRepository.recordStat({
      serverId,
      userId,
      lineageId: context.currentPersona.persona_lineage_id ?? context.tomoriState.persona_lineage_id ?? 0,
      metric: prepared.kind === "native" ? "sticker_used" : "custom_expression_used",
      // `sticker_used` keys on the name because getEmotionBreakdown joins on `server_stickers.sticker_name`.
      metricKey: prepared.kind === "native" ? prepared.sticker.name : prepared.id,
    });
  } catch (error) {
    log.warn("Failed to record expression usage", error);
  }
}
