/**
 * Cross-Channel Message Tool
 * Allows the AI to send an instant, natural message to a different channel in the same server.
 * Includes an optional "boomerang" mechanism that triggers a follow-up generation back in the
 * source channel to report what happened.
 */

import { PermissionFlagsBits } from "discord.js";
import type { GuildTextBasedChannel, Message } from "discord.js";
import { log } from "../../utils/misc/logger";
import { BaseTool, type ToolContext, type ToolResult, type ToolParameterSchema } from "../../types/tool/interfaces";
import type { StructuredContextItem } from "../../types/misc/context";
import { ContextItemTag } from "../../types/misc/context";
import { truncateHistoryAtRefreshMarker } from "@/utils/discord/refreshMarkerHistory";
import { resolveChannelTarget } from "@/utils/discord/targetResolver";
import { resolveContextAuthorLabel } from "@/utils/discord/contextAuthorLabel";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import { convertMentions } from "@/utils/text/contextBuilder";
import { PrivacyLevel } from "@/types/db/schema";
import { getCachedPrivacyLevel } from "@/utils/cache/userCache";
import { resolveMessageProxyMessageIdentitiesForHistory } from "@/utils/messageProxy/historyAttribution";

// Stores pending boomerang data keyed by source channel ID.
// After tomoriChat() completes in the target channel, the source channel
// consumes this data to trigger a separate follow-up generation.

/** Data stored for a pending boomerang report-back */
export interface PendingBoomerang {
  /** Channel ID where the original conversation happened */
  sourceChannelId: string;
  /** Human-readable name of the target channel */
  targetChannelName: string;
  /** Discord ID of the target channel */
  targetChannelId: string;
  /** The task that was dispatched */
  task: string;
  /** Whether the target generation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Persona ID to use for the boomerang generation */
  personaId?: number;
  /** Whether the source turn was a user impersonation */
  isUserImpersonation?: boolean;
  /** Impersonated Discord user ID to preserve across boomerang follow-up */
  impersonatedUserId?: string;
  /** Recent messages from the target channel (newest first) */
  targetChannelMessages: Array<{
    author: string;
    content: string;
    timestamp: string;
  }>;
  /**
   * Override for the opening lines of the boomerang context injection.
   * Defaults to the cross-channel "You have just returned from channel X." narrative.
   */
  introText?: string;
  /** Override for the closing instruction line of the boomerang context injection. */
  outroText?: string;
}

const pendingBoomerangs = new Map<string, PendingBoomerang>();

async function formatVisibleHistory(
  messages: Message[],
  context: ToolContext,
): Promise<PendingBoomerang["targetChannelMessages"]> {
  const proxyIdentities = await resolveMessageProxyMessageIdentitiesForHistory(messages);
  const visibleMessages: Message[] = [];
  for (const message of messages) {
    const authorId = proxyIdentities.get(message.id)?.senderDiscId ?? message.author.id;
    if ((await getCachedPrivacyLevel(authorId)) !== PrivacyLevel.FULL) {
      visibleMessages.push(message);
    }
  }

  return Promise.all(
    visibleMessages.map(async (message) => ({
      author: await resolveContextAuthorLabel(message, {
        guildId: context.guildId,
        personalMemoriesEnabled: context.tomoriState.config.personal_memories_enabled,
      }),
      content: message.content
        ? await convertMentions(
            message.content,
            context.client,
            context.guildId ?? "",
            undefined,
            context.tomoriState.persona_nickname,
            context.tomoriState.config.personal_memories_enabled,
          )
        : "(no text content)",
      timestamp: message.createdAt.toISOString(),
    })),
  );
}

/**
 * Exposed so other tools (e.g. create_thread) can register boomerangs
 * without duplicating the map or the consume/build logic.
 */
export function storePendingBoomerang(boomerang: PendingBoomerang): void {
  pendingBoomerangs.set(boomerang.sourceChannelId, boomerang);
}

function inferTargetChannelFromTask(task: unknown): string | undefined {
  if (typeof task !== "string") {
    return undefined;
  }

  const patterns: RegExp[] = [
    /\b(?:channel|thread)\s+(?:named|called)\s+`([^`]{1,120})`/iu,
    /\b(?:go|hop|move|jump|peek|check|read|look)\b.{0,80}\b(?:to|into|over\s+to)\s+`([^`]{1,120})`/iu,
    /\b(?:send|post|say|tell|ask|message|write)\b.{0,120}\b(?:in|to|into|over\s+in)\s+`([^`]{1,120})`/iu,
    /<#(\d{17,20})>/u,
    /\B#([A-Za-z0-9_-]{1,100})\b/u,
    /\b(?:channel|thread)\s+(?:named|called)\s+([A-Za-z0-9_-]{1,100})\b/iu,
  ];

  for (const pattern of patterns) {
    const match = task.match(pattern);
    const inferred = match?.[1]?.trim();
    if (inferred) {
      return inferred;
    }
  }

  return undefined;
}

/**
 * Consume (retrieve and delete) a pending boomerang for a given channel.
 * Called by tomoriChat after STM storage to check if a follow-up is needed.
 * @returns The boomerang data if one exists, otherwise undefined
 */
export function consumePendingBoomerang(channelId: string): PendingBoomerang | undefined {
  const boomerang = pendingBoomerangs.get(channelId);
  if (boomerang) {
    pendingBoomerangs.delete(channelId);
  }
  return boomerang;
}

/**
 * Build the injected context items for a boomerang report-back generation.
 * @param boomerang - The boomerang data to format
 */
export function buildBoomerangContext(boomerang: PendingBoomerang): StructuredContextItem[] {
  let messagesBlock = "";
  if (boomerang.targetChannelMessages.length > 0) {
    const formatted = boomerang.targetChannelMessages.map((m) => `"${m.author}: ${m.content}"`).join("\n");
    // Truncate if total exceeds ~1500 chars to stay within reasonable context size
    messagesBlock = formatted.length > 1500 ? `${formatted.substring(0, 1497)}...` : formatted;
  }

  const resultStr = boomerang.success ? "Success" : `Failed: ${boomerang.error ?? "unknown error"}`;

  const intro =
    boomerang.introText ??
    `You have just returned from channel \`${boomerang.targetChannelName}\`.\nReport back naturally on what happened there.`;
  const outro = boomerang.outroText ?? "Now continue the conversation here with a concise update.";

  let contextText = `[System: ${intro}\nOutcome: ${resultStr}.`;
  if (messagesBlock) {
    contextText += `\nHere is what was happening in channel \`${boomerang.targetChannelName}\` (last 10 messages, oldest first):\n${messagesBlock}`;
  }
  contextText += `\n${outro}]`;

  return [
    {
      role: "user",
      parts: [{ type: "text", text: contextText }],
      metadataTag: ContextItemTag.SYSTEM_INSTRUCTION_BLOCK,
    },
  ];
}

/**
 * Tool for sending an instant, natural message to a different channel in the same server,
 * or silently peeking its recent message context without sending anything.
 * Unlike create_task, this executes immediately rather than scheduling.
 */
export class CrossChannelMessageTool extends BaseTool {
  name = "cross_channel_message";
  description =
    "Dispatch yourself to a different channel in the same server to do work there right now, once, or silently peek its recent message history. Anything you can do here (generate an image, search, answer, say something) happens in that channel instead. For work at a later time or on a repeat, use create_task. Set peek_only to true to read what is happening there without sending any message. Optionally enable 'boomerang' to report back to the current channel about what you did.";
  category = "discord" as const;

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      target_channel: {
        type: "string",
        description:
          "Name of the target channel in the current server. If the conversation shows a channel in inline-code like `general` or `general (ID: ...)`, copy the exact name inside the backticks. A raw Discord channel ID is also accepted.",
      },
      task: {
        type: "string",
        description:
          "A descriptive task (2-4 sentences) explaining what you should do in the target channel. Be specific about the output wanted (for example, generate an image of X, or say Y), the TONE to use, and any context from the current conversation that's relevant. This instruction guides your message generation in the target channel. Not used when peek_only is true.",
      },
      boomerang: {
        type: "boolean",
        description:
          "If true, after sending the message in the target channel, you will automatically generate a follow-up message back in the current channel reporting what you did or found. Useful when someone asked you to go check on or say something in another channel. Ignored when peek_only is true.",
      },
      peek_only: {
        type: "boolean",
        description:
          "If true, fetch and return the target channel's recent message history without sending any message there. Use this when you want to silently read what is happening in another channel to inform your response here, without making your presence known in that channel. The number of messages fetched matches the server's configured message fetch limit.",
      },
    },
    required: ["target_channel", "task"],
  };

  /**
   * Check if cross-channel message tool is available for the given provider.
   * Excluded for NovelAI (GLM) due to token budget limitations.
   * @returns True if provider supports this tool
   */
  isAvailableFor(provider: string): boolean {
    return provider.toLowerCase() !== "novelai";
  }

  isAvailableForContext(provider: string, context?: ToolContext): boolean {
    if (!this.isAvailableFor(provider)) {
      return false;
    }

    if (context?.streamContext?.disableCrossChannelMessage) {
      log.info("CrossChannelMessageTool: Disabled for this turn to prevent nested cross-channel dispatch");
      return false;
    }

    return true;
  }

  /**
   * Execute cross-channel message dispatch.
   * 1. Validates parameters and resolves the target channel
   * 2. Fetches a context message from the target channel
   * 3. Calls tomoriChat() with injected task context
   * 4. Optionally stores boomerang data for follow-up
   */
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    if (context.streamContext?.disableCrossChannelMessage) {
      log.info("CrossChannelMessageTool: Execution blocked for this turn to prevent nested cross-channel dispatch");
      return {
        success: false,
        error: "Cross-channel messaging is temporarily disabled for this tool-driven follow-up turn.",
        data: {
          status: "cross_channel_failed_nested_dispatch_blocked",
          reason: "Cross-channel tool is disabled during an active cross-channel dispatch or boomerang follow-up.",
        },
      };
    }

    const targetChannelArg = args.target_channel as string | undefined;
    const legacyChannelIdArg = args.channel_id as string | undefined;
    const legacyChannelNameArg = args.channel_name as string | undefined;
    const taskArg = args.task as string | undefined;
    const boomerangArg = args.boomerang as boolean | undefined;
    const peekOnlyArg = args.peek_only as boolean | undefined;
    const isPeekOnly = peekOnlyArg === true;
    const inferredChannelFromTask = inferTargetChannelFromTask(taskArg);
    const requestedChannel =
      targetChannelArg?.trim() || legacyChannelNameArg?.trim() || legacyChannelIdArg?.trim() || inferredChannelFromTask;

    // Validate: at least one channel identifier must be provided
    if (!requestedChannel) {
      return {
        success: false,
        error: "The 'target_channel' parameter is required to identify the target channel.",
        data: {
          status: "cross_channel_failed_missing_channel",
          reason: "No target channel was provided.",
        },
      };
    }

    // Validate: task must be non-empty unless peeking
    if (!isPeekOnly && (typeof taskArg !== "string" || !taskArg.trim())) {
      return {
        success: false,
        error:
          "The 'task' parameter is required and must be a non-empty string describing what to do in the target channel.",
        data: {
          status: "cross_channel_failed_missing_task",
          reason: "Task is empty or missing.",
        },
      };
    }

    // DM guard: cross-channel only works within a guild
    if (!context.guildId) {
      return {
        success: false,
        error: "Cross-channel messaging is only available in server channels, not in DMs.",
        data: {
          status: "cross_channel_failed_dm_context",
          reason: "Cannot use cross-channel messaging in DMs.",
        },
      };
    }

    const guild = await context.client.guilds.fetch(context.guildId).catch(() => null);
    if (!guild) {
      return {
        success: false,
        error: "Failed to resolve the current server.",
        data: {
          status: "cross_channel_failed_guild_not_found",
          reason: "Could not fetch guild.",
        },
      };
    }

    const channelResolution = await resolveChannelTarget(requestedChannel, context);
    if (channelResolution.status === "ambiguous") {
      const shownCount = channelResolution.candidates.length;
      const overflowCount = channelResolution.totalCount - shownCount;
      const overflowNote = overflowCount > 0 ? ` (and ${overflowCount} more; use a raw channel ID for others)` : "";
      const candidateLabels = channelResolution.candidates.map((c) => c.label).join(", ");
      return {
        success: false,
        error: `Multiple channels match "${requestedChannel}". Please clarify by copying the exact inline-code label or using a raw ID:\n${candidateLabels}${overflowNote}`,
        data: {
          status: "cross_channel_failed_ambiguous_channel",
          reason: "Multiple channels matched the requested target.",
          candidates: channelResolution.candidates.map((c) => c.label),
          total_matches: channelResolution.totalCount,
        },
      };
    }

    if (channelResolution.status === "not_found") {
      return {
        success: false,
        error: `Could not find a channel matching "${requestedChannel}" in this server. If a channel was shown in backticks in the conversation (e.g. \`name (ID: ...)\`), use that exact label or the raw ID.`,
        data: {
          status: "cross_channel_failed_channel_not_found",
          reason: "Target channel was not found or is not text-based.",
        },
      };
    }

    const targetChannel: GuildTextBasedChannel = channelResolution.channel;

    // Same-channel guard
    if (targetChannel.id === context.channel.id) {
      return {
        success: false,
        error:
          "Cannot send a cross-channel message to the same channel you are already in. Just speak normally instead.",
        data: {
          status: "cross_channel_failed_same_channel",
          reason: "Target channel is the same as source.",
        },
      };
    }

    const blockedChannelIds = new Set(context.tomoriState.config.crosschannel_blocklist_ids ?? []);
    const isThreadTarget =
      "isThread" in targetChannel && typeof targetChannel.isThread === "function" && targetChannel.isThread();
    const effectiveBlockedChannelId = blockedChannelIds.has(targetChannel.id)
      ? targetChannel.id
      : isThreadTarget && targetChannel.parent && blockedChannelIds.has(targetChannel.parent.id)
        ? targetChannel.parent.id
        : null;

    if (effectiveBlockedChannelId) {
      const blockedTargetName =
        isThreadTarget && targetChannel.parent?.id === effectiveBlockedChannelId
          ? `#${targetChannel.parent.name}`
          : `#${targetChannel.name}`;

      return {
        success: false,
        error: `Cross-channel messaging is blocked for ${blockedTargetName} in this server.`,
        data: {
          status: "cross_channel_failed_blocklisted_target",
          reason: "The target channel is in the server cross-channel blocklist.",
        },
      };
    }

    // Permission check: ViewChannel always required; send permissions only for dispatch mode
    const botMember =
      guild.members.me ??
      (context.client.user ? await guild.members.fetch(context.client.user.id).catch(() => null) : null);
    const invokingMember =
      context.message?.member ?? (context.userId ? await guild.members.fetch(context.userId).catch(() => null) : null);

    if (!invokingMember) {
      return {
        success: false,
        error: `I could not verify the requesting user's permission to view channel \`${targetChannel.name}\`.`,
        data: {
          status: "cross_channel_failed_invoker_not_resolved",
          reason: "Invoker guild member could not be resolved for target channel visibility check.",
        },
      };
    }

    if ("permissionsFor" in targetChannel) {
      if (!botMember) {
        return {
          success: false,
          error: `I could not verify my permission to view channel \`${targetChannel.name}\`.`,
          data: {
            status: "cross_channel_failed_bot_not_resolved",
            reason: "Bot guild member could not be resolved for target channel permission checks.",
          },
        };
      }

      const perms = targetChannel.permissionsFor(botMember);

      // Check ViewChannel permission (required for both peek and dispatch)
      if (perms && !perms.has(PermissionFlagsBits.ViewChannel)) {
        return {
          success: false,
          error: `I don't have permission to view channel \`${targetChannel.name}\`.`,
          data: {
            status: "cross_channel_failed_no_view_permission",
            reason: "Missing ViewChannel permission.",
          },
        };
      }

      // Peek mode only needs ViewChannel: skip send permission check
      if (!isPeekOnly) {
        const isThread =
          "isThread" in targetChannel && typeof targetChannel.isThread === "function" && targetChannel.isThread();
        const sendPermission = isThread ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;

        if (perms && !perms.has(sendPermission)) {
          return {
            success: false,
            error: `I don't have permission to send messages in channel \`${targetChannel.name}\`.`,
            data: {
              status: "cross_channel_failed_no_send_permission",
              reason: `Missing ${isThread ? "SendMessagesInThreads" : "SendMessages"} permission.`,
            },
          };
        }
      }

      const invokerPerms = targetChannel.permissionsFor(invokingMember);
      if (!invokerPerms?.has(PermissionFlagsBits.ViewChannel)) {
        return {
          success: false,
          error: `The requesting user does not have permission to view channel \`${targetChannel.name}\`.`,
          data: {
            status: "cross_channel_failed_invoker_no_view_permission",
            reason: "Invoker is missing ViewChannel permission on the target channel.",
          },
        };
      }
    }

    // Peek-only path: fetch recent messages and return as context without dispatching
    if (isPeekOnly) {
      const fetchLimit = normalizeMessageFetchLimit(context.tomoriState.config.message_fetch_limit);
      let recentMessages: Awaited<ReturnType<typeof targetChannel.messages.fetch>> | null = null;
      try {
        recentMessages = await targetChannel.messages.fetch({ limit: fetchLimit });
      } catch (fetchError) {
        log.warn(`Cross-channel tool: Failed to fetch messages for peek from #${targetChannel.name}:`, fetchError);
      }

      if (!recentMessages || recentMessages.size === 0) {
        return {
          success: true,
          message: `Channel \`${targetChannel.name}\` has no messages.`,
          data: {
            status: "cross_channel_peek_complete",
            target_channel_name: targetChannel.name,
            message_count: 0,
            messages: [],
          },
        };
      }

      const filteredMessages = truncateHistoryAtRefreshMarker(
        [...recentMessages.values()],
        `Cross-channel tool: Peek hit refresh embed at ${targetChannel.name}`,
      );

      const formattedMessages = await formatVisibleHistory(filteredMessages, context);

      log.info(
        `Cross-channel tool: Peek complete for #${targetChannel.name} — ${formattedMessages.length} messages fetched`,
      );

      return {
        success: true,
        message: `Fetched ${formattedMessages.length} recent messages from channel \`${targetChannel.name}\`.`,
        data: {
          status: "cross_channel_peek_complete",
          target_channel_name: targetChannel.name,
          message_count: formattedMessages.length,
          messages: formattedMessages,
        },
      };
    }

    let lastMessage: Message | undefined;
    try {
      const messages = await targetChannel.messages.fetch({ limit: 1 });
      lastMessage = messages.first();
    } catch (fetchError) {
      log.warn(`Cross-channel tool: Failed to fetch last message from #${targetChannel.name}:`, fetchError);
    }

    // A placeholder message provides the anchor that later updates require.
    if (!lastMessage && "send" in targetChannel) {
      try {
        lastMessage = await targetChannel.send({
          content: "\u2800",
        });
        log.info(`Cross-channel tool: Seeded placeholder message in #${targetChannel.name}`);
      } catch (sendError) {
        log.warn(`Cross-channel tool: Failed to seed placeholder in #${targetChannel.name}:`, sendError);
      }
    }

    if (!lastMessage) {
      return {
        success: false,
        error: `Could not fetch or create a context message in channel \`${targetChannel.name}\`.`,
        data: {
          status: "cross_channel_failed_no_context_message",
          reason: "No messages available in target channel.",
        },
      };
    }

    const taskInjection: StructuredContextItem = {
      role: "user",
      parts: [
        {
          type: "text",
          text: `[System: You have been dispatched to this channel to perform a task.\nTask: "${(taskArg as string).trim()}".\nComplete this task in this channel, using your tools if needed.]`,
        },
      ],
      metadataTag: ContextItemTag.SYSTEM_INSTRUCTION_BLOCK,
    };

    // Suppress self-reply to avoid loop
    const { suppressNextSelfReply } = await import("../../events/messageCreate/tomoriChat");
    suppressNextSelfReply(targetChannel.id);

    const { tomoriChat } = await import("../../events/messageCreate/tomoriChat");

    const sourcePersonaId = context.activePersonaId ?? context.tomoriState.persona_id ?? undefined;
    const isSourceUserImpersonation = context.isUserImpersonation === true;
    const sourceImpersonatedUserId = context.impersonatedUserId;
    const manualTriggerInvoker = context.userId
      ? {
          userDiscId: context.userId,
          username: context.message?.author.username ?? "System",
          locale: context.locale,
          member: invokingMember,
        }
      : undefined;

    try {
      await tomoriChat({
        client: context.client,
        message: lastMessage,
        isFromQueue: false,
        isManuallyTriggered: true,
        forceReason: false,
        isStopResponse: false,
        selectedPersonaId: sourcePersonaId,
        isPersonaJob: false,
        isUserImpersonation: isSourceUserImpersonation,
        impersonatedUserId: sourceImpersonatedUserId,
        textQuotaSource: "system",
        injectedContextItems: [taskInjection],
        manualTriggerInvoker,
        manualStreamingContextOverrides: { disableCrossChannelMessage: true },
      });

      log.success(
        `Cross-channel tool: Successfully dispatched to #${targetChannel.name} (task: "${(taskArg as string).trim().substring(0, 80)}...")`,
      );

      // Handle boomerang: store data for follow-up generation in source channel
      if (boomerangArg) {
        // Fetch last 10 messages from target channel (including the one the bot just sent),
        // but respect refresh embed boundaries, only include messages after the most recent one
        let targetMessages: Array<{
          author: string;
          content: string;
          timestamp: string;
        }> = [];
        try {
          const recentMessages = await targetChannel.messages.fetch({
            limit: 10,
          });
          const filteredMessages = truncateHistoryAtRefreshMarker(
            [...recentMessages.values()],
            "Cross-channel tool: Boomerang message fetch hit refresh embed at",
          );
          targetMessages = await formatVisibleHistory(filteredMessages, context);
        } catch (msgFetchError) {
          log.warn(`Cross-channel tool: Failed to fetch target channel messages for boomerang:`, msgFetchError);
        }

        pendingBoomerangs.set(context.channel.id, {
          sourceChannelId: context.channel.id,
          targetChannelName: targetChannel.name,
          targetChannelId: targetChannel.id,
          task: (taskArg as string).trim(),
          success: true,
          personaId: sourcePersonaId,
          isUserImpersonation: isSourceUserImpersonation,
          impersonatedUserId: sourceImpersonatedUserId,
          targetChannelMessages: targetMessages,
        });

        log.info(
          `Cross-channel tool: Boomerang stored for source channel ${context.channel.id} → #${targetChannel.name}`,
        );
      }

      // When boomerang is enabled, end the LLM's current turn immediately.
      // The boomerang mechanism will trigger a separate generation with the actual
      // target channel context, so we must prevent the LLM from fabricating a report here.
      if (boomerangArg) {
        return {
          success: true,
          endTurn: true,
          message: `You just returned from channel \`${targetChannel.name}\`.`,
          data: {
            status: "cross_channel_visit_complete",
            target_channel_name: targetChannel.name,
            boomerang: true,
            note: `You are back from channel \`${targetChannel.name}\`. Report what happened there without restating the full assignment.`,
          },
        };
      }

      return {
        success: true,
        message: `Message sent to channel \`${targetChannel.name}\`.`,
        data: {
          status: "cross_channel_message_sent",
          target_channel_name: targetChannel.name,
          boomerang: false,
        },
      };
    } catch (error) {
      log.error(`Cross-channel tool: Failed to dispatch to #${targetChannel.name}:`, error as Error);

      // Store failed boomerang if requested
      if (boomerangArg) {
        pendingBoomerangs.set(context.channel.id, {
          sourceChannelId: context.channel.id,
          targetChannelName: targetChannel.name,
          targetChannelId: targetChannel.id,
          task: (taskArg as string).trim(),
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          personaId: sourcePersonaId,
          isUserImpersonation: isSourceUserImpersonation,
          impersonatedUserId: sourceImpersonatedUserId,
          targetChannelMessages: [],
        });
      }

      return {
        success: false,
        error: `Failed to send message in channel \`${targetChannel.name}\`: ${error instanceof Error ? error.message : "Unknown error"}`,
        data: {
          status: "cross_channel_failed_dispatch_error",
          reason: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }
}
