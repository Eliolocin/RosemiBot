/**
 * Discord Message Management Tool
 * Allows the bot to pin any recent message and edit/delete recent messages it sent directly
 * or through its managed character webhooks.
 */

import type { BaseGuildTextChannel, Message, Webhook } from "discord.js";
import { BaseTool, type ToolContext, type ToolParameterSchema, type ToolResult } from "@/types/tool/interfaces";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { DISCORD_ID_PATTERN, findFuzzyMessageMatch } from "@/utils/text/fuzzyMessageMatch";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import { getKnownPersonaSpeakerNames, stripLeadingKnownSpeakerPrefixes } from "@/utils/discord/modelAuthoredText";
import { resolveManagedWebhookForChannel } from "@/utils/discord/webhook/fallback";
import { log } from "@/utils/misc/logger";
import { isMatrixBridgeWebhookUsername, stripBridgePrefix } from "@/utils/bridges";
import { parseRenderModifierWebhookName } from "@/utils/discord/renderModifierParser";
import { revealGroupBreakName } from "@/utils/text/groupBreakName";

const PREVIEW_MAX_LENGTH = 120;

type ManageAction = "pin" | "edit" | "delete";
type ManagedMessageMutationAction = Extract<ManageAction, "edit" | "delete">;

type TargetResolution = { kind: "direct" } | { kind: "webhook"; webhook: Webhook; threadId?: string };

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

/**
 * Sprite delivery renames persona webhooks: a lookalike-letter group-break name ("Tomorі"), a
 * decorated fallback ("ともり (mad)"), or an identity sprite ("The Voice (Locke)"). Any of those
 * still belongs to a persona, so each spelling is checked against the lowercased persona names.
 */
export function isPersonaWebhookName(username: string, personaNameSet: ReadonlySet<string>): boolean {
  const webhookName = revealGroupBreakName(stripBridgePrefix(username));
  const decorated = parseRenderModifierWebhookName(webhookName);
  return [webhookName, decorated?.sourceName, decorated?.modifier].some(
    (name) => name !== undefined && personaNameSet.has(name.toLowerCase()),
  );
}

function getDisplayAuthorName(message: Message): string {
  return message.member?.displayName ?? message.author.globalName ?? stripBridgePrefix(message.author.username);
}

export class ManageMessageTool extends BaseTool {
  name = "manage_message";
  description =
    "Manage a recent message in the current channel. `pin` can pin any recent message if Discord permissions allow it. `edit` and `delete` only work on recent messages you or another character owns. Use `reveal_message_metadata` first when you need fresh `ref_N` handles or sent timestamps.";
  category = "discord" as const;
  requiresFeatureFlag = "manage_message";

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["pin", "edit", "delete"],
        description:
          "Which action to perform: pin a message, edit a manageable message, or delete one or more manageable messages.",
      },
      message_id: {
        type: "string",
        description:
          "The target message reference. Accepts a `ref_N` handle from recent message metadata or a `media_N` handle from an image or video in the current context.",
      },
      end_message_id: {
        type: "string",
        description: "Optional inclusive end of the delete range. Only valid when action is `delete`.",
      },
      content: {
        type: "string",
        description:
          "Required new message content when action is `edit`. Content-only edits preserve existing embeds, files, and components where Discord allows.",
      },
    },
    required: ["action", "message_id"],
  };

  isAvailableFor(_provider: string): boolean {
    return true;
  }

  private resolveMessageId(
    rawValue: unknown,
    context: ToolContext,
    fieldName: "message_id" | "end_message_id",
  ): { ok: true; rawValue: string; resolvedId: string } | { ok: false; result: ToolResult } {
    if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
      return {
        ok: false,
        result: {
          success: false,
          error: `Missing required parameter: ${fieldName}`,
          message: `I need a ${fieldName} string to manage a message.`,
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
        : `The ${fieldName} value does not look like a valid message reference or Discord message ID.`;

      return {
        ok: false,
        result: {
          success: false,
          error: "Invalid message ID format",
          message: errorMessage,
          data: {
            status: "invalid_message_id_format",
            field: fieldName,
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

  private async resolveTargetType(
    message: Message,
    context: ToolContext,
    personaNameSet: Set<string>,
    action: ManagedMessageMutationAction,
  ): Promise<TargetResolution | null> {
    if (message.author.id === context.client.user?.id) {
      const canMutate = action === "edit" ? message.editable : message.deletable;
      return canMutate ? { kind: "direct" } : null;
    }

    if (!message.webhookId || isMatrixBridgeWebhookUsername(message.author.username)) {
      return null;
    }

    const webhookHostChannel = resolveWebhookHostChannel(context.channel);
    if (!webhookHostChannel) {
      return null;
    }

    const managedWebhook = await resolveManagedWebhookForChannel(webhookHostChannel, message.webhookId);
    if (!managedWebhook || !isPersonaWebhookName(message.author.username, personaNameSet)) {
      return null;
    }

    return {
      kind: "webhook",
      webhook: managedWebhook,
      threadId: resolveWebhookThreadId(context.channel),
    };
  }

  private canPinInChannel(context: ToolContext): boolean {
    if (!("guild" in context.channel) || !context.channel.guild) {
      return false;
    }

    const clientUser = context.client.user;
    if (!clientUser || !("permissionsFor" in context.channel)) {
      return false;
    }

    return Boolean(context.channel.permissionsFor(clientUser)?.has("ManageMessages"));
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const validation = this.validateParameters(args);
    if (!validation.isValid) {
      return {
        success: false,
        error: `Invalid parameters: ${validation.errors?.join(", ") || validation.missingParams?.join(", ") || "unknown validation error"}`,
        message: "The message-management arguments were invalid.",
      };
    }

    const action = args.action as ManageAction;
    const messageIdResult = this.resolveMessageId(args.message_id, context, "message_id");
    if (!messageIdResult.ok) {
      return messageIdResult.result;
    }

    const rawMessageId = (
      typeof args.__original_message_id === "string" ? (args.__original_message_id as string) : messageIdResult.rawValue
    ).trim();

    if (action !== "delete" && typeof args.end_message_id === "string") {
      return {
        success: false,
        error: "end_message_id is only valid for delete",
        message: "Ranges are only supported for delete actions. Use a single message_id for pin or edit.",
        data: {
          status: "invalid_range_for_action",
          action,
        },
      };
    }

    const editContent = typeof args.content === "string" ? args.content : undefined;
    if (action === "edit" && (!editContent || editContent.trim().length === 0)) {
      return {
        success: false,
        error: "Missing required content for edit",
        message: "Editing a message requires non-empty replacement content.",
        data: {
          status: "missing_edit_content",
        },
      };
    }

    const speakerNameSet = await getKnownPersonaSpeakerNames(context.guildId, [
      context.personaUsername,
      context.tomoriState.persona_nickname,
    ]);
    const personaNameSet = new Set([...speakerNameSet].map((speakerName) => speakerName.toLowerCase()));
    const fetchLimit = normalizeMessageFetchLimit(context.tomoriState.config.message_fetch_limit);
    const recentMessages = await context.channel.messages.fetch({ limit: fetchLimit });
    const chronologicalMessages = [...recentMessages.values()].reverse();

    let targetMessage = recentMessages.get(messageIdResult.resolvedId);

    const originalWasOpaque = MessageIdMap.isOpaqueKey(rawMessageId);
    const canFuzzyMatch =
      !originalWasOpaque &&
      DISCORD_ID_PATTERN.test(rawMessageId) &&
      !args.end_message_id &&
      (action === "pin" || action === "edit" || action === "delete");

    if (!targetMessage && canFuzzyMatch) {
      const fuzzyMatch = findFuzzyMessageMatch(recentMessages, messageIdResult.resolvedId);
      if (fuzzyMatch) {
        targetMessage = fuzzyMatch.message;
        log.info(
          `ManageMessageTool: Fuzzy-matched single-target message ID "${messageIdResult.resolvedId}" -> "${fuzzyMatch.message.id}" (diff=${fuzzyMatch.diff})`,
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

    if (action === "pin") {
      if (!("guild" in context.channel) || !context.channel.guild) {
        return {
          success: false,
          error: "Message pinning not available in DMs",
          message: "Pinning messages is not available in Direct Messages.",
          data: {
            status: "pin_not_available_in_dm",
            message_ref: targetRef,
          },
        };
      }

      if (!this.canPinInChannel(context)) {
        return {
          success: false,
          error: "Insufficient permissions to pin messages",
          message:
            "I don't currently have the Discord `Manage Messages` permission in this channel, so I can't pin messages here.",
          data: {
            status: "insufficient_permissions",
            required_permission: "MANAGE_MESSAGES",
            message_ref: targetRef,
          },
        };
      }

      if (targetMessage.pinned) {
        return {
          success: false,
          error: "Message is already pinned",
          message: "That message is already pinned in this channel.",
          data: {
            status: "message_already_pinned",
            message_ref: targetRef,
            author: getDisplayAuthorName(targetMessage),
            preview: buildMessagePreview(targetMessage),
          },
        };
      }

      try {
        await targetMessage.pin();
        return {
          success: true,
          message: "Message pinned successfully.",
          data: {
            status: "message_pinned_successfully",
            message_ref: targetRef,
            author: getDisplayAuthorName(targetMessage),
            preview: buildMessagePreview(targetMessage),
          },
        };
      } catch (error) {
        log.error(`ManageMessageTool: Failed to pin message ${targetMessage.id}`, error as Error);

        if (error instanceof Error) {
          if (error.message.includes("Missing Permissions") || error.message.includes("50013")) {
            return {
              success: false,
              error: "Insufficient permissions to pin messages",
              message:
                "I don't currently have the Discord `Manage Messages` permission in this channel, so I can't pin messages here.",
              data: {
                status: "insufficient_permissions",
                required_permission: "MANAGE_MESSAGES",
                message_ref: targetRef,
              },
            };
          }

          if (error.message.includes("50019") || error.message.includes("pin limit")) {
            return {
              success: false,
              error: "Channel pin limit reached",
              message: "This channel already has the maximum number of pinned messages (50).",
              data: {
                status: "pin_limit_reached",
                message_ref: targetRef,
              },
            };
          }
        }

        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown pin failure",
          message: "I couldn't pin that message due to an unexpected Discord error.",
          data: {
            status: "pin_operation_failed",
            message_ref: targetRef,
          },
        };
      }
    }

    if (action === "edit") {
      const targetType = await this.resolveTargetType(targetMessage, context, personaNameSet, "edit");
      if (!targetType) {
        return {
          success: false,
          error: "Message is not editable by the current bot identity",
          message:
            "I can only edit recent messages that were sent directly by me or through one of the current character identities, and are still editable in this channel.",
          data: {
            status: "message_not_editable_by_current_identity",
            message_ref: targetRef,
          },
        };
      }

      const sanitizedEditContent = stripLeadingKnownSpeakerPrefixes(editContent?.trim() ?? "", speakerNameSet);
      if (!sanitizedEditContent) {
        return {
          success: false,
          error: "Edit content collapsed after removing a speaker label",
          message: "That edit started with a character name label, so I didn't apply it as-is.",
          data: {
            status: "edit_content_rejected_speaker_label",
            message_ref: targetRef,
          },
        };
      }

      try {
        if (targetType.kind === "direct") {
          await targetMessage.edit({ content: sanitizedEditContent });
        } else {
          await targetType.webhook.editMessage(targetMessage.id, {
            content: sanitizedEditContent,
            ...(targetType.threadId ? { threadId: targetType.threadId } : {}),
          });
        }

        return {
          success: true,
          message: "Message edited successfully.",
          data: {
            status: "message_edited_successfully",
            message_ref: targetRef,
            author: getDisplayAuthorName(targetMessage),
            preview: normalizePreview(sanitizedEditContent),
          },
        };
      } catch (error) {
        log.error(`ManageMessageTool: Failed to edit message ${targetMessage.id}`, error as Error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown edit failure",
          message: "I couldn't edit that message due to an unexpected Discord error.",
          data: {
            status: "edit_operation_failed",
            message_ref: targetRef,
          },
        };
      }
    }

    if (typeof args.end_message_id !== "string" || args.end_message_id.trim().length === 0) {
      const targetType = await this.resolveTargetType(targetMessage, context, personaNameSet, "delete");
      if (!targetType) {
        return {
          success: false,
          error: "Message is not deletable by the current bot identity",
          message:
            "I can only delete recent messages that were sent directly by me or through one of the current character identities, and are still deletable in this channel.",
          data: {
            status: "message_not_deletable_by_current_identity",
            message_ref: targetRef,
          },
        };
      }

      try {
        if (targetType.kind === "direct") {
          await targetMessage.delete();
        } else {
          await targetType.webhook.deleteMessage(targetMessage.id, targetType.threadId);
        }

        return {
          success: true,
          message: "Message deleted successfully.",
          data: {
            status: "message_deleted_successfully",
            message_ref: targetRef,
            author: getDisplayAuthorName(targetMessage),
            preview: buildMessagePreview(targetMessage),
          },
        };
      } catch (error) {
        log.error(`ManageMessageTool: Failed to delete message ${targetMessage.id}`, error as Error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown delete failure",
          message: "I couldn't delete that message due to an unexpected Discord error.",
          data: {
            status: "delete_operation_failed",
            message_ref: targetRef,
          },
        };
      }
    }

    const endMessageIdResult = this.resolveMessageId(args.end_message_id, context, "end_message_id");
    if (!endMessageIdResult.ok) {
      return endMessageIdResult.result;
    }

    const startIndex = chronologicalMessages.findIndex((message) => message.id === targetMessage.id);
    const endIndex = chronologicalMessages.findIndex((message) => message.id === endMessageIdResult.resolvedId);
    if (endIndex === -1) {
      return {
        success: false,
        error: "Range end message not found",
        message: `I couldn't find the end of that delete range in the recent conversation window (last ${fetchLimit} messages).`,
        data: {
          status: "range_end_not_found_in_recent",
          attempted_id: endMessageIdResult.rawValue,
          fetch_limit: fetchLimit,
        },
      };
    }

    const rangeStartIndex = Math.min(startIndex, endIndex);
    const rangeEndIndex = Math.max(startIndex, endIndex);
    const rangeMessages = chronologicalMessages.slice(rangeStartIndex, rangeEndIndex + 1);

    const deletedRefs: string[] = [];
    const skippedRefs: string[] = [];

    for (const message of rangeMessages) {
      const messageRef =
        context.messageIdMap?.getOpaque(message.id, "ref") ?? context.messageIdMap?.register(message.id, "ref");
      const targetType = await this.resolveTargetType(message, context, personaNameSet, "delete");
      if (!targetType) {
        skippedRefs.push(messageRef ?? message.id);
        continue;
      }

      try {
        if (targetType.kind === "direct") {
          await message.delete();
        } else {
          await targetType.webhook.deleteMessage(message.id, targetType.threadId);
        }
        deletedRefs.push(messageRef ?? message.id);
      } catch (error) {
        log.warn(`ManageMessageTool: Skipping failed delete for range message ${message.id}`, error);
        skippedRefs.push(messageRef ?? message.id);
      }
    }

    if (deletedRefs.length === 0) {
      return {
        success: false,
        error: "No manageable messages found in range",
        message: "I couldn't find any recent messages in that range that I can currently delete.",
        data: {
          status: "no_eligible_messages_in_range",
          deleted_count: 0,
          skipped_count: skippedRefs.length,
          skipped_refs: skippedRefs,
        },
      };
    }

    return {
      success: true,
      message:
        skippedRefs.length > 0
          ? `Deleted ${deletedRefs.length} manageable message(s) and skipped ${skippedRefs.length} in the requested range.`
          : `Deleted ${deletedRefs.length} manageable message(s) in the requested range.`,
      data: {
        status: skippedRefs.length > 0 ? "range_delete_partial_success" : "range_delete_success",
        deleted_count: deletedRefs.length,
        skipped_count: skippedRefs.length,
        deleted_refs: deletedRefs,
        skipped_refs: skippedRefs,
      },
    };
  }
}
