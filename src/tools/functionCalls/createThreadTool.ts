/**
 * Create Thread Tool
 * Allows the active persona to create a public thread and send the first message into it.
 */

import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type NewsChannel,
  type TextChannel,
  type Webhook,
} from "discord.js";
import { BaseTool, type ToolContext, type ToolParameterSchema, type ToolResult } from "@/types/tool/interfaces";
import { resolveChannelTarget } from "@/utils/discord/targetResolver";
import { getKnownPersonaSpeakerNames, stripLeadingKnownSpeakerPrefixes } from "@/utils/discord/modelAuthoredText";
import { getOrCreateWebhook } from "@/utils/discord/webhook/lifecycle";
import { sendPersonaPostViaWebhook } from "@/utils/discord/webhook/personaPost";
import { log } from "@/utils/misc/logger";
import { storePendingBoomerang, type PendingBoomerang } from "@/tools/functionCalls/crossChannelMessageTool";
import { resolveContextAuthorLabel } from "@/utils/discord/contextAuthorLabel";
import { convertMentions } from "@/utils/text/contextBuilder";
import { isRefreshMarkerEmbed } from "@/utils/discord/embedDetection";
import type { Message } from "discord.js";

const MAX_THREAD_NAME_LENGTH = 100;
const MAX_FIRST_MESSAGE_LENGTH = 2000;

type ThreadParentChannel = TextChannel | NewsChannel;

function isThreadParentChannel(channel: unknown): channel is ThreadParentChannel {
  if (!channel || typeof channel !== "object" || !("type" in channel)) {
    return false;
  }

  const channelType = Number((channel as { type: number }).type);
  return channelType === ChannelType.GuildText || channelType === ChannelType.GuildAnnouncement;
}

function isThreadChannel(channel: unknown): boolean {
  return (
    !!channel &&
    typeof channel === "object" &&
    "isThread" in channel &&
    typeof (channel as { isThread?: () => boolean }).isThread === "function" &&
    (channel as { isThread: () => boolean }).isThread()
  );
}

async function resolveGuild(context: ToolContext): Promise<Guild | null> {
  if (!context.guildId) {
    return null;
  }

  return (
    context.client.guilds.cache.get(context.guildId) ??
    (await context.client.guilds.fetch(context.guildId).catch(() => null))
  );
}

async function resolveTargetChannel(
  requestedChannel: string | undefined,
  context: ToolContext,
): Promise<{ ok: true; channel: ThreadParentChannel } | { ok: false; result: ToolResult }> {
  if (!requestedChannel) {
    if (isThreadChannel(context.channel)) {
      return {
        ok: false,
        result: {
          success: false,
          error: "Cannot create a thread inside another thread. Provide a parent channel name instead.",
          data: {
            status: "create_thread_failed_current_channel_is_thread",
            reason: "Current channel is already a thread.",
          },
        },
      };
    }

    if (isThreadParentChannel(context.channel)) {
      return { ok: true, channel: context.channel };
    }

    return {
      ok: false,
      result: {
        success: false,
        error: "Threads can only be created in regular server text or announcement channels.",
        data: {
          status: "create_thread_failed_unsupported_current_channel",
          reason: "Current channel cannot host threads.",
        },
      },
    };
  }

  const channelResolution = await resolveChannelTarget(requestedChannel, context);
  if (channelResolution.status === "ambiguous") {
    const shownCount = channelResolution.candidates.length;
    const overflowCount = channelResolution.totalCount - shownCount;
    const overflowNote = overflowCount > 0 ? ` (and ${overflowCount} more - use a raw channel ID for others)` : "";
    const candidateLabels = channelResolution.candidates.map((candidate) => candidate.label).join(", ");
    return {
      ok: false,
      result: {
        success: false,
        error: `Multiple channels match "${requestedChannel}". Please clarify by copying the exact inline-code label or using a raw ID:\n${candidateLabels}${overflowNote}`,
        data: {
          status: "create_thread_failed_ambiguous_channel",
          reason: "Multiple channels matched the requested target.",
          candidates: channelResolution.candidates.map((candidate) => candidate.label),
          total_matches: channelResolution.totalCount,
        },
      },
    };
  }

  if (channelResolution.status === "not_found") {
    return {
      ok: false,
      result: {
        success: false,
        error: `Could not find a channel matching "${requestedChannel}" in this server. If a channel was shown in backticks in the conversation (e.g. \`name (ID: ...)\`), use that exact label or the raw ID.`,
        data: {
          status: "create_thread_failed_channel_not_found",
          reason: "Target channel was not found.",
        },
      },
    };
  }

  if (isThreadChannel(channelResolution.channel)) {
    return {
      ok: false,
      result: {
        success: false,
        error: `Cannot create a thread inside thread \`${channelResolution.channel.name}\`. Provide its parent channel instead.`,
        data: {
          status: "create_thread_failed_target_is_thread",
          reason: "Target channel is already a thread.",
        },
      },
    };
  }

  if (!isThreadParentChannel(channelResolution.channel)) {
    return {
      ok: false,
      result: {
        success: false,
        error: `Channel \`${channelResolution.channel.name}\` cannot host a regular public thread.`,
        data: {
          status: "create_thread_failed_unsupported_target_channel",
          reason: "Resolved target channel cannot host threads.",
        },
      },
    };
  }

  return { ok: true, channel: channelResolution.channel };
}

async function resolvePersonaWebhook(
  context: ToolContext,
  targetChannel: ThreadParentChannel,
): Promise<Webhook | null> {
  if (!context.personaUsername) {
    return null;
  }

  const webhookResult = await getOrCreateWebhook(targetChannel);
  return webhookResult.webhook;
}

export class CreateThreadTool extends BaseTool {
  name = "create_thread";
  description =
    "Create a new public thread in the current server and send the first message into it as the active persona. ONLY invoke this tool when the user has explicitly and unambiguously requested the creation of a new thread. Do not infer thread creation intent from conversational context, topic changes, or suggestions. If a thread was already created earlier in this conversation, do not create another one unless the user makes a new, explicit request for a separate thread. If channel_name is omitted or blank, the thread is created in the current channel. Use channel_name to target another text or announcement channel by the same channel-name resolution rules as cross_channel_message.";
  category = "discord" as const;
  requiresFeatureFlag = "thread_creation";

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      thread_name: {
        type: "string",
        description: "Name of the new thread. Must be 1-100 characters.",
      },
      first_message: {
        type: "string",
        description:
          "The first message you send inside the newly created thread. This message should usually be you acknowledging and finishing the creation of the thread. Or, if in a story or roleplay, this could be the first message of the story or roleplay.",
      },
      channel_name: {
        type: "string",
        description:
          "Optional target channel name in the current server. If blank, defaults to the current channel. A raw Discord channel ID or copyable `#name (ID: ...)` label is also accepted.",
      },
    },
    required: ["thread_name", "first_message"],
  };

  isAvailableFor(_provider: string): boolean {
    return true;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const validation = this.validateParameters(args);
    if (!validation.isValid) {
      return {
        success: false,
        error: `Invalid parameters: ${validation.errors?.join(", ") || validation.missingParams?.join(", ") || "unknown validation error"}`,
        message: "The thread creation arguments were invalid.",
      };
    }

    if (!context.guildId) {
      return {
        success: false,
        error: "Thread creation is only available in server channels, not in DMs.",
        data: {
          status: "create_thread_failed_dm_context",
          reason: "Cannot create a server thread from a DM.",
        },
      };
    }

    if (!context.tomoriState.config.thread_creation_enabled) {
      return {
        success: false,
        error: "Thread creation is disabled on this server.",
        data: {
          status: "create_thread_failed_feature_disabled",
          reason: "thread_creation_enabled is disabled.",
        },
      };
    }

    const threadName = (args.thread_name as string).trim();
    const firstMessageRaw = (args.first_message as string).trim();
    const requestedChannel =
      typeof args.channel_name === "string" && args.channel_name.trim() ? args.channel_name.trim() : undefined;

    if (!threadName) {
      return {
        success: false,
        error: "The thread_name parameter must be a non-empty string.",
        data: {
          status: "create_thread_failed_empty_thread_name",
        },
      };
    }

    if (threadName.length > MAX_THREAD_NAME_LENGTH) {
      return {
        success: false,
        error: `Thread names must be ${MAX_THREAD_NAME_LENGTH} characters or fewer.`,
        data: {
          status: "create_thread_failed_thread_name_too_long",
          max_length: MAX_THREAD_NAME_LENGTH,
        },
      };
    }

    if (!firstMessageRaw) {
      return {
        success: false,
        error: "The first_message parameter must be a non-empty string.",
        data: {
          status: "create_thread_failed_empty_first_message",
        },
      };
    }

    const speakerNames = await getKnownPersonaSpeakerNames(context.guildId, [
      context.personaUsername,
      context.tomoriState.persona_nickname,
    ]);
    const firstMessage = stripLeadingKnownSpeakerPrefixes(firstMessageRaw, speakerNames).trim();

    if (!firstMessage) {
      return {
        success: false,
        error: "The first message collapsed after removing a speaker label.",
        message: "That thread starter began with a character name label, so I didn't send it as-is.",
        data: {
          status: "create_thread_failed_first_message_speaker_label",
        },
      };
    }

    if (firstMessage.length > MAX_FIRST_MESSAGE_LENGTH) {
      return {
        success: false,
        error: `The first message must be ${MAX_FIRST_MESSAGE_LENGTH} characters or fewer.`,
        data: {
          status: "create_thread_failed_first_message_too_long",
          max_length: MAX_FIRST_MESSAGE_LENGTH,
        },
      };
    }

    const guild = await resolveGuild(context);
    if (!guild) {
      return {
        success: false,
        error: "Failed to resolve the current server.",
        data: {
          status: "create_thread_failed_guild_not_found",
          reason: "Could not fetch guild.",
        },
      };
    }

    const targetResult = await resolveTargetChannel(requestedChannel, context);
    if (!targetResult.ok) {
      return targetResult.result;
    }
    const targetChannel = targetResult.channel;

    // Blocklist guard: mirrors the cross_channel_message check so blocked channels
    // cannot be targeted via thread creation either.
    const blockedChannelIds = new Set(context.tomoriState.config.crosschannel_blocklist_ids ?? []);
    if (blockedChannelIds.has(targetChannel.id)) {
      return {
        success: false,
        error: `Thread creation is blocked for \`#${targetChannel.name}\` in this server.`,
        data: {
          status: "create_thread_failed_blocklisted_channel",
          reason: "The target channel is in the server cross-channel blocklist.",
        },
      };
    }

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
          status: "create_thread_failed_invoker_not_resolved",
          reason: "Invoker guild member could not be resolved for target channel visibility check.",
        },
      };
    }

    if (!botMember) {
      return {
        success: false,
        error: `I could not verify my permissions in channel \`${targetChannel.name}\`.`,
        data: {
          status: "create_thread_failed_bot_not_resolved",
          reason: "Bot guild member could not be resolved for target channel permission checks.",
        },
      };
    }

    const botPerms = targetChannel.permissionsFor(botMember);
    if (!botPerms?.has(PermissionFlagsBits.ViewChannel)) {
      return {
        success: false,
        error: `I don't have permission to view channel \`${targetChannel.name}\`.`,
        data: {
          status: "create_thread_failed_no_view_permission",
          reason: "Missing ViewChannel permission.",
        },
      };
    }

    if (!botPerms.has(PermissionFlagsBits.CreatePublicThreads)) {
      return {
        success: false,
        error: `I don't have permission to create public threads in channel \`${targetChannel.name}\`.`,
        data: {
          status: "create_thread_failed_no_create_threads_permission",
          reason: "Missing CreatePublicThreads permission.",
        },
      };
    }

    if (!botPerms.has(PermissionFlagsBits.SendMessagesInThreads)) {
      return {
        success: false,
        error: `I don't have permission to send messages in threads under channel \`${targetChannel.name}\`.`,
        data: {
          status: "create_thread_failed_no_thread_send_permission",
          reason: "Missing SendMessagesInThreads permission.",
        },
      };
    }

    const invokerPerms = targetChannel.permissionsFor(invokingMember);
    if (!invokerPerms?.has(PermissionFlagsBits.ViewChannel)) {
      return {
        success: false,
        error: `The requesting user does not have permission to view channel \`${targetChannel.name}\`.`,
        data: {
          status: "create_thread_failed_invoker_no_view_permission",
          reason: "Invoker is missing ViewChannel permission on the target channel.",
        },
      };
    }

    let personaWebhook: Webhook | null = null;
    if (context.personaUsername) {
      personaWebhook = await resolvePersonaWebhook(context, targetChannel);
      if (!personaWebhook) {
        return {
          success: false,
          error: `I could not get a webhook for channel \`${targetChannel.name}\` to send as the active persona.`,
          data: {
            status: "create_thread_failed_webhook_unavailable",
            reason: "Active persona identity requires a webhook in the target channel.",
          },
        };
      }
    }

    try {
      const thread = await targetChannel.threads.create({
        name: threadName,
        reason: "TomoriBot create_thread tool",
      });

      if (personaWebhook && context.personaUsername) {
        await sendPersonaPostViaWebhook(
          personaWebhook,
          {
            content: firstMessage,
            allowedMentions: { parse: [] },
            threadId: thread.id,
          },
          {
            username: context.personaUsername,
            avatarUrl: context.personaAvatarUrl,
            personaId: context.tomoriState.persona_id,
          },
          thread,
        );
      } else {
        await thread.send({
          content: firstMessage,
          allowedMentions: { parse: [] },
        });
      }

      let threadMessages: PendingBoomerang["targetChannelMessages"] = [];
      try {
        const fetched = await thread.messages.fetch({ limit: 10 });
        const messagesArray = [...fetched.values()];
        const filtered: Message[] = [];
        for (const m of messagesArray) {
          if (m.embeds.length > 0 && m.embeds.some(isRefreshMarkerEmbed)) {
            break;
          }
          filtered.push(m);
        }
        filtered.reverse();
        threadMessages = await Promise.all(
          filtered.map(async (m) => ({
            author: await resolveContextAuthorLabel(m, {
              guildId: context.guildId,
              personalMemoriesEnabled: context.tomoriState.config.personal_memories_enabled,
            }),
            content: m.content
              ? await convertMentions(
                  m.content,
                  context.client,
                  context.guildId ?? "",
                  undefined,
                  context.tomoriState.persona_nickname,
                  context.tomoriState.config.personal_memories_enabled,
                )
              : "(no text content)",
            timestamp: m.createdAt.toISOString(),
          })),
        );
      } catch (msgFetchError) {
        log.warn(`CreateThreadTool: Failed to fetch thread messages for boomerang:`, msgFetchError);
      }

      storePendingBoomerang({
        sourceChannelId: context.channel.id,
        targetChannelName: thread.name,
        targetChannelId: thread.id,
        task: `Created thread '${thread.name}' in #${targetChannel.name} and sent the first message.`,
        success: true,
        personaId: context.activePersonaId ?? context.tomoriState.persona_id ?? undefined,
        isUserImpersonation: context.isUserImpersonation === true,
        impersonatedUserId: context.impersonatedUserId,
        targetChannelMessages: threadMessages,
        introText:
          `You have just finished creating a new thread named \`${thread.name}\` in \`#${targetChannel.name}\`. ` +
          `The thread is live and the first message has already been sent; do not attempt to create another thread.`,
        outroText: "Now give a short, natural acknowledgment back right now saying that the thread is ready.",
      });

      log.info(`CreateThreadTool: Boomerang stored for source channel ${context.channel.id} → thread #${thread.name}`);

      return {
        success: true,
        endTurn: true,
        message: `Created thread \`${thread.name}\` in channel \`${targetChannel.name}\` and sent the first message.`,
        data: {
          status: "thread_created_successfully",
          thread_id: thread.id,
          thread_name: thread.name,
          parent_channel_id: targetChannel.id,
          parent_channel_name: targetChannel.name,
          used_webhook_context: Boolean(personaWebhook && context.personaUsername),
          boomerang: true,
        },
      };
    } catch (error) {
      log.error(`CreateThreadTool: Failed to create thread in #${targetChannel.name}`, error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown thread creation failure",
        message: "I couldn't create the thread or send its first message due to an unexpected Discord error.",
        data: {
          status: "create_thread_failed_discord_error",
          parent_channel_name: targetChannel.name,
        },
      };
    }
  }
}
