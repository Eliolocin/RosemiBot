import { verifyMessageWebhook } from "@/utils/chat/webhookIdentity";
/**
 * Recent Message Interaction Tool
 * Lets Tomori react to or reply to a recent message without needing message-management permissions.
 */

import type { BaseGuildTextChannel, Guild, Message, Webhook } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { BaseTool, type ToolContext, type ToolParameterSchema, type ToolResult } from "@/types/tool/interfaces";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { DISCORD_ID_PATTERN, findFuzzyMessageMatch } from "@/utils/text/fuzzyMessageMatch";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import { getOrCreateWebhook } from "@/utils/discord/webhook/lifecycle";
import { log } from "@/utils/misc/logger";
import { cleanToolReplyText } from "@/utils/discord/toolReplyText";
import { getReplyContextAuthorName, sendWebhookReplyWithContext } from "@/utils/discord/webhookReply";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { resolvePersonaForMessage } from "@/utils/chat/webhookIdentity";
import { resolvePersonaWebhookIdentity, type ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";

const PREVIEW_MAX_LENGTH = 120;
const CUSTOM_EMOJI_PATTERN = /^<(a?):([A-Za-z0-9_~]+):(\d{17,20})>$/;
const NAMED_EMOJI_PATTERN = /^:([A-Za-z0-9_~]+):$/;

type InteractionAction = "react" | "reply";

function normalizePreview(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "[No text content]";
  }

  return compact.length > PREVIEW_MAX_LENGTH ? `${compact.slice(0, PREVIEW_MAX_LENGTH - 3)}...` : compact;
}

function buildMessagePreview(message: Message): string {
  const textPreview = normalizePreview(message.cleanContent || message.content || "");
  const attachmentParts: string[] = [];
  let imageCount = 0;
  let videoCount = 0;
  let fileCount = 0;

  for (const attachment of message.attachments.values()) {
    const contentType = attachment.contentType?.toLowerCase() ?? "";
    if (contentType.startsWith("image/")) {
      imageCount++;
      continue;
    }
    if (contentType.startsWith("video/")) {
      videoCount++;
      continue;
    }
    fileCount++;
  }

  if (imageCount > 0) {
    attachmentParts.push(`${imageCount} image${imageCount === 1 ? "" : "s"}`);
  }
  if (videoCount > 0) {
    attachmentParts.push(`${videoCount} video${videoCount === 1 ? "" : "s"}`);
  }
  if (message.stickers.size > 0) {
    attachmentParts.push(`${message.stickers.size} sticker${message.stickers.size === 1 ? "" : "s"}`);
  }
  if (fileCount > 0) {
    attachmentParts.push(`${fileCount} file${fileCount === 1 ? "" : "s"}`);
  }

  if (attachmentParts.length === 0) {
    return textPreview;
  }

  if (textPreview === "[No text content]") {
    return `[${attachmentParts.join(", ")}]`;
  }

  return `${textPreview} [+ ${attachmentParts.join(", ")}]`;
}

function resolveWebhookHostChannel(channel: ToolContext["channel"]): BaseGuildTextChannel | null {
  const isThread = "isThread" in channel && typeof channel.isThread === "function" && channel.isThread();
  if (isThread) {
    return channel.parent && "fetchWebhooks" in channel.parent ? (channel.parent as BaseGuildTextChannel) : null;
  }

  return "fetchWebhooks" in channel && "createWebhook" in channel ? (channel as BaseGuildTextChannel) : null;
}

function resolveWebhookThreadId(channel: ToolContext["channel"]): string | undefined {
  return "isThread" in channel && typeof channel.isThread === "function" && channel.isThread() ? channel.id : undefined;
}

type WebhookReplyContext = {
  webhook: Webhook;
  threadId?: string;
};

type ReplyDeliveryContext =
  | {
      kind: "direct";
      senderPersona?: TomoriState;
      targetPersonaMatched: boolean;
    }
  | {
      kind: "webhook";
      webhook: Webhook;
      threadId?: string;
      identity: ResolvedWebhookIdentity;
      senderPersona?: TomoriState;
      targetPersonaMatched: boolean;
    };

export class InteractWithRecentMessageTool extends BaseTool {
  name = "interact_with_recent_message";
  description =
    "Interact with a recent message in the current channel for expressive follow-up behavior. `react` adds an emoji reaction. `reply` sends a short reply or backtrack comment about an earlier message. Replies are always sent as yourself, even when the target is another persona's message. Use `reveal_message_metadata` first when you need fresh `ref_N` handles or sent timestamps.";
  category = "discord" as const;

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["react", "reply"],
        description:
          "Which expressive interaction to perform: react to a recent message with an emoji, or reply to a recent message with new text.",
      },
      message_id: {
        type: "string",
        description: "The target recent message reference, usually a `ref_N` handle from recent message metadata.",
      },
      content: {
        type: "string",
        description:
          "Required interaction content. For `react`, provide the emoji, it can be a custom emoji. For `reply`, provide the reply text.",
      },
    },
    required: ["action", "message_id", "content"],
  };

  isAvailableFor(_provider: string): boolean {
    return true;
  }

  isAvailableForContext(provider: string, context?: ToolContext): boolean {
    if (!this.isAvailableFor(provider)) {
      return false;
    }

    if (context?.streamContext?.disableAllTools) {
      log.info("InteractWithRecentMessageTool: Disabled for this turn because tools are suppressed");
      return false;
    }

    return true;
  }

  private resolveMessageId(
    rawValue: unknown,
    context: ToolContext,
  ): { ok: true; rawValue: string; resolvedId: string } | { ok: false; result: ToolResult } {
    if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
      return {
        ok: false,
        result: {
          success: false,
          error: "Missing required parameter: message_id",
          message: "I need a message_id string to interact with a recent message.",
        },
      };
    }

    const normalizedValue = rawValue.trim();
    const resolvedId = MessageIdMap.isOpaqueKey(normalizedValue)
      ? (context.messageIdMap?.resolve(normalizedValue) ?? normalizedValue)
      : normalizedValue;

    if (!DISCORD_ID_PATTERN.test(resolvedId)) {
      const errorMessage = MessageIdMap.isOpaqueKey(normalizedValue)
        ? "That message reference is not present in the current recent-message context. Call `reveal_message_metadata` first to expose `ref_N` handles for recent messages, then retry with a ref from that listing."
        : "The message_id value does not look like a valid message reference or Discord message ID.";

      return {
        ok: false,
        result: {
          success: false,
          error: "Invalid message ID format",
          message: errorMessage,
          data: {
            status: "invalid_message_id_format",
            attempted_id: normalizedValue,
          },
        },
      };
    }

    return {
      ok: true,
      rawValue: normalizedValue,
      resolvedId,
    };
  }

  private canReactInChannel(context: ToolContext): boolean {
    if (!("guild" in context.channel) || !context.channel.guild) {
      return true;
    }

    const clientUser = context.client.user;
    if (!clientUser || !("permissionsFor" in context.channel)) {
      return false;
    }

    return Boolean(context.channel.permissionsFor(clientUser)?.has("AddReactions"));
  }

  private canSendReplyInChannel(context: ToolContext): boolean {
    if (!("guild" in context.channel) || !context.channel.guild) {
      return "send" in context.channel;
    }

    const clientUser = context.client.user;
    if (!clientUser || !("permissionsFor" in context.channel)) {
      return false;
    }

    const permissions = context.channel.permissionsFor(clientUser);
    if (!permissions) {
      return false;
    }

    const isThread =
      "isThread" in context.channel && typeof context.channel.isThread === "function" && context.channel.isThread();
    return permissions.has(isThread ? "SendMessagesInThreads" : "SendMessages");
  }

  private resolveReactionEmoji(rawValue: string, context: ToolContext): string {
    const normalized = rawValue.trim();
    if (CUSTOM_EMOJI_PATTERN.test(normalized)) {
      return normalized;
    }

    const namedEmojiMatch = normalized.match(NAMED_EMOJI_PATTERN);
    const candidateName = namedEmojiMatch?.[1] ?? normalized;
    if ("guild" in context.channel && context.channel.guild) {
      const matchedEmoji = context.channel.guild.emojis.cache.find(
        (emoji) => emoji.name?.toLowerCase() === candidateName.toLowerCase(),
      );
      if (matchedEmoji) {
        return matchedEmoji.animated
          ? `<a:${matchedEmoji.name}:${matchedEmoji.id}>`
          : `<:${matchedEmoji.name}:${matchedEmoji.id}>`;
      }
    }

    return normalized;
  }

  private async resolveWebhookReplyContext(context: ToolContext): Promise<WebhookReplyContext | null> {
    if (context.webhook) {
      return {
        webhook: context.webhook,
        threadId: resolveWebhookThreadId(context.channel),
      };
    }

    const webhookHostChannel = resolveWebhookHostChannel(context.channel);
    if (!webhookHostChannel) {
      return null;
    }

    const webhookResult = await getOrCreateWebhook(webhookHostChannel);
    if (!webhookResult.webhook) {
      return null;
    }

    return {
      webhook: webhookResult.webhook,
      threadId: resolveWebhookThreadId(context.channel),
    };
  }

  private resolveContextGuild(context: ToolContext): Guild | null {
    if ("guild" in context.channel && context.channel.guild) {
      return context.channel.guild;
    }

    return context.guildId ? (context.client.guilds.cache.get(context.guildId) ?? null) : null;
  }

  private async loadPersonasForContext(context: ToolContext): Promise<TomoriState[]> {
    if (context.guildId) {
      const cachedPersonas = await getCachedAllPersonas(context.guildId);
      if (cachedPersonas.length > 0) {
        return cachedPersonas;
      }
    }

    return [context.tomoriState];
  }

  private async resolveReplyDeliveryContext(
    context: ToolContext,
    targetMessage: Message,
  ): Promise<ReplyDeliveryContext> {
    const allPersonas = await this.loadPersonasForContext(context);
    await verifyMessageWebhook(targetMessage);
    const targetPersona = resolvePersonaForMessage(targetMessage, allPersonas, context.client.user?.id);

    // Only a backtrack on the active persona's own message may speak as the target's identity.
    // Routing a reply to ANOTHER persona's message through that persona posts the active
    // persona's words under someone else's name.
    if (
      targetPersona &&
      context.activePersonaId !== undefined &&
      targetPersona.persona_id === context.activePersonaId
    ) {
      if (!targetPersona.is_alter) {
        return {
          kind: "direct",
          senderPersona: targetPersona,
          targetPersonaMatched: true,
        };
      }

      const guild = this.resolveContextGuild(context);
      const identity = guild
        ? await resolvePersonaWebhookIdentity(targetPersona, guild)
        : { username: targetPersona.persona_nickname };
      const webhookReplyContext = await this.resolveWebhookReplyContext(context);
      if (webhookReplyContext) {
        return {
          kind: "webhook",
          webhook: webhookReplyContext.webhook,
          threadId: webhookReplyContext.threadId,
          identity,
          senderPersona: targetPersona,
          targetPersonaMatched: true,
        };
      }

      return {
        kind: "direct",
        senderPersona: targetPersona,
        targetPersonaMatched: true,
      };
    }

    const webhookReplyContext = context.personaUsername ? await this.resolveWebhookReplyContext(context) : null;
    if (webhookReplyContext && context.personaUsername) {
      return {
        kind: "webhook",
        webhook: webhookReplyContext.webhook,
        threadId: webhookReplyContext.threadId,
        identity: {
          username: context.personaUsername,
          avatarUrl: context.personaAvatarUrl,
          avatarDataUri: context.personaAvatarUrl?.startsWith("data:image/") ? context.personaAvatarUrl : undefined,
        },
        targetPersonaMatched: false,
      };
    }

    return {
      kind: "direct",
      targetPersonaMatched: false,
    };
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    if (context.streamContext?.disableAllTools) {
      log.info("InteractWithRecentMessageTool: Execution blocked because tools are suppressed for this turn");
      return {
        success: false,
        error: "Message interaction tools are disabled for this turn.",
        data: {
          status: "message_interaction_disabled_for_turn",
        },
      };
    }

    const validation = this.validateParameters(args);
    if (!validation.isValid) {
      return {
        success: false,
        error: `Invalid parameters: ${validation.errors?.join(", ") || validation.missingParams?.join(", ") || "unknown validation error"}`,
        message: "The recent-message interaction arguments were invalid.",
      };
    }

    const action = args.action as InteractionAction;
    const messageIdResult = this.resolveMessageId(args.message_id, context);
    if (!messageIdResult.ok) {
      return messageIdResult.result;
    }

    const interactionContent = typeof args.content === "string" ? args.content.trim() : "";
    if (interactionContent.length === 0) {
      return {
        success: false,
        error: "Missing required content",
        message: action === "react" ? "Reacting requires an emoji." : "Replying requires non-empty text.",
        data: {
          status: action === "react" ? "missing_reaction_emoji" : "missing_reply_content",
        },
      };
    }

    if (action === "reply" && context.streamContext?.disableRecentMessageReplyTool) {
      log.info("InteractWithRecentMessageTool: Reply action blocked because this turn is already a queued reply");
      return {
        success: false,
        error: "Message reply interaction is disabled for this turn.",
        message: "This turn is already replying to the queued message directly.",
        data: {
          status: "message_reply_interaction_disabled_for_turn",
        },
      };
    }

    const rawMessageId = (
      typeof args.__original_message_id === "string" ? (args.__original_message_id as string) : messageIdResult.rawValue
    ).trim();

    const fetchLimit = normalizeMessageFetchLimit(context.tomoriState.config.message_fetch_limit);
    const recentMessages = await context.channel.messages.fetch({ limit: fetchLimit });

    let targetMessage = recentMessages.get(messageIdResult.resolvedId);

    const originalWasOpaque = MessageIdMap.isOpaqueKey(rawMessageId);
    const canFuzzyMatch = !originalWasOpaque && DISCORD_ID_PATTERN.test(rawMessageId);

    if (!targetMessage && canFuzzyMatch) {
      const fuzzyMatch = findFuzzyMessageMatch(recentMessages, messageIdResult.resolvedId);
      if (fuzzyMatch) {
        targetMessage = fuzzyMatch.message;
        log.info(
          `InteractWithRecentMessageTool: Fuzzy-matched message ID "${messageIdResult.resolvedId}" -> "${fuzzyMatch.message.id}" (diff=${fuzzyMatch.diff})`,
        );
      }
    }

    if (!targetMessage) {
      return {
        success: false,
        error: "Message not found",
        message: `I couldn't find that message in the recent conversation window (last ${fetchLimit} messages).`,
        data: {
          status: "message_not_found_in_recent",
          attempted_id: messageIdResult.rawValue,
          fetch_limit: fetchLimit,
        },
      };
    }

    const targetRef =
      context.messageIdMap?.getOpaque(targetMessage.id, "ref") ??
      context.messageIdMap?.register(targetMessage.id, "ref");

    if (action === "react") {
      const resolvedEmoji = this.resolveReactionEmoji(interactionContent, context);

      if (!this.canReactInChannel(context)) {
        return {
          success: false,
          error: "Insufficient permissions to react",
          message: "I don't currently have permission to add reactions in this channel.",
          data: {
            status: "insufficient_reaction_permissions",
            message_ref: targetRef,
            emoji: interactionContent,
          },
        };
      }

      try {
        await targetMessage.react(resolvedEmoji);
        return {
          success: true,
          message: "Reaction added successfully.",
          data: {
            status: "message_reacted_successfully",
            message_ref: targetRef,
            emoji: interactionContent,
            author: getReplyContextAuthorName(
              targetMessage,
              context.client.user?.id,
              context.tomoriState.persona_nickname,
            ),
            preview: buildMessagePreview(targetMessage),
          },
        };
      } catch (error) {
        log.error(`InteractWithRecentMessageTool: Failed to react to message ${targetMessage.id}`, error as Error);

        if (error instanceof Error) {
          if (error.message.includes("10014") || error.message.includes("Unknown Emoji")) {
            return {
              success: false,
              error: "Invalid emoji",
              message: "I couldn't use that emoji as a Discord reaction here.",
              data: {
                status: "invalid_reaction_emoji",
                message_ref: targetRef,
                emoji: interactionContent,
              },
            };
          }

          if (error.message.includes("Missing Permissions") || error.message.includes("50013")) {
            return {
              success: false,
              error: "Insufficient permissions to react",
              message: "I don't currently have permission to add reactions in this channel.",
              data: {
                status: "insufficient_reaction_permissions",
                message_ref: targetRef,
                emoji: interactionContent,
              },
            };
          }
        }

        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown reaction failure",
          message: "I couldn't add that reaction due to an unexpected Discord error.",
          data: {
            status: "reaction_operation_failed",
            message_ref: targetRef,
            emoji: interactionContent,
          },
        };
      }
    }

    const replyDeliveryContext = await this.resolveReplyDeliveryContext(context, targetMessage);

    if (replyDeliveryContext.kind !== "webhook" && !this.canSendReplyInChannel(context)) {
      return {
        success: false,
        error: "Insufficient permissions to reply",
        message: "I don't currently have permission to send a reply in this channel.",
        data: {
          status: "insufficient_reply_permissions",
          message_ref: targetRef,
        },
      };
    }

    try {
      const sanitizedReplyContent = await cleanToolReplyText(interactionContent, context);
      if (!sanitizedReplyContent) {
        return {
          success: false,
          error: "Reply content collapsed after cleaning",
          message: "That reply collapsed to nothing after stripping character-name labels, so I didn't send it as-is.",
          data: {
            status: "reply_content_rejected_speaker_label",
            message_ref: targetRef,
          },
        };
      }

      let sentMessage: Message;

      if (replyDeliveryContext.kind === "webhook") {
        sentMessage = await sendWebhookReplyWithContext(
          replyDeliveryContext.webhook,
          targetMessage,
          context.locale,
          sanitizedReplyContent,
          replyDeliveryContext.identity,
          {
            threadId: replyDeliveryContext.threadId,
          },
        );

        if (context.streamContext?.replyNoticeState) {
          context.streamContext.replyNoticeState.attempted = true;
          context.streamContext.replyNoticeState.sent = true;
        }
      } else {
        sentMessage = await targetMessage.reply({
          content: sanitizedReplyContent,
          allowedMentions: {
            repliedUser: false,
          },
        });
      }

      const sentMessageRef =
        context.messageIdMap?.getOpaque(sentMessage.id, "ref") ?? context.messageIdMap?.register(sentMessage.id, "ref");

      return {
        success: true,
        message: "Reply sent successfully.",
        data: {
          status: "message_replied_successfully",
          message_ref: targetRef,
          reply_message_ref: sentMessageRef,
          author: getReplyContextAuthorName(
            targetMessage,
            context.client.user?.id,
            context.tomoriState.persona_nickname,
          ),
          preview: normalizePreview(sanitizedReplyContent),
          used_webhook_context: replyDeliveryContext.kind === "webhook",
          target_persona_reply_routed: replyDeliveryContext.targetPersonaMatched,
          reply_sender_persona: replyDeliveryContext.senderPersona?.persona_nickname,
          reply_sender_persona_id: replyDeliveryContext.senderPersona?.persona_id,
        },
        endTurn: true,
      };
    } catch (error) {
      log.error(`InteractWithRecentMessageTool: Failed to reply to message ${targetMessage.id}`, error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown reply failure",
        message: "I couldn't send that reply due to an unexpected Discord error.",
        data: {
          status: "reply_operation_failed",
          message_ref: targetRef,
        },
      };
    }
  }
}
