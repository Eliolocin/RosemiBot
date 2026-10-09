import { EmbedBuilder, type BaseGuildTextChannel, type Channel, type Client } from "discord.js";
import type { ThoughtLogPayload } from "@/types/provider/interfaces";
import { getLlmDisplayName } from "@/utils/provider/modelDisplay";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { StreamContext } from "@/types/stream/interfaces";
import type { TomoriState } from "@/types/db/schema";
import { getOrCreateWebhook } from "@/utils/discord/webhook/lifecycle";
import { canMirrorToThoughtLog } from "@/utils/discord/thoughtLogAudience";
import { resolvePersonaWebhookIdentity, type ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import { sendWebhookMessagesWithIdentity } from "@/utils/discord/webhook/personaDispatch";

const EMBED_DESCRIPTION_LIMIT = 4096;

function normalizeThoughtLogText(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function takeEmbedChunk(
  value: string,
  maxLength: number,
): {
  chunk: string;
  remaining: string;
} {
  if (value.length <= maxLength) {
    return {
      chunk: value.trim(),
      remaining: "",
    };
  }

  let splitIndex = Math.max(value.lastIndexOf("\n", maxLength), value.lastIndexOf(" ", maxLength));
  if (splitIndex <= 0) {
    splitIndex = maxLength;
  } else {
    splitIndex += 1;
  }

  return {
    chunk: value.slice(0, splitIndex).trim(),
    remaining: value.slice(splitIndex).trim(),
  };
}

function formatGenerationDuration(durationMs?: number): string | undefined {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
    return undefined;
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

function buildThoughtLogEmbeds(args: {
  locale: string;
  tomoriState: TomoriState;
  sourceChannel: StreamContext["channel"];
  thoughtLog: ThoughtLogPayload;
  attributionLine?: string;
}): EmbedBuilder[] {
  const { locale, tomoriState, sourceChannel, thoughtLog, attributionLine } = args;
  const embeds: EmbedBuilder[] = [];
  // Raw jump URL auto-links in Discord embeds; masked links with channel mentions don't render cleanly.
  const sourceLine = thoughtLog.firstReplyUrl ?? sourceChannel.toString();
  const descriptionLines = [
    localizer(locale, "genai.thought_log.description", {
      source_line: sourceLine,
    }),
    attributionLine?.trim(),
  ].filter((line): line is string => Boolean(line?.trim()));
  const description = descriptionLines.join("\n").slice(0, EMBED_DESCRIPTION_LIMIT);
  // For OpenRouter, the upstream serving backend (e.g. "minimax-cn") is appended so admins
  // can identify a backend that bled reasoning into content and pin/avoid it.
  const provider = thoughtLog.servingProvider
    ? localizer(locale, "genai.thought_log.provider_with_serving", {
        provider: getProviderDisplayName(tomoriState.llm.llm_provider),
        serving_provider: thoughtLog.servingProvider,
      })
    : getProviderDisplayName(tomoriState.llm.llm_provider);
  const model = getLlmDisplayName(tomoriState.llm, tomoriState.config.custom_model_name);
  const hasThinkingContent = Boolean(
    normalizeThoughtLogText(thoughtLog.summary) || normalizeThoughtLogText(thoughtLog.raw),
  );
  const generationTime = hasThinkingContent ? formatGenerationDuration(thoughtLog.generationDurationMs) : undefined;
  const footerText = generationTime
    ? localizer(locale, "genai.thought_log.footer_with_generation_time", {
        provider,
        model,
        generation_time: generationTime,
      })
    : localizer(locale, "genai.thought_log.footer", {
        provider,
        model,
      });

  const sections = [
    {
      label: localizer(locale, "genai.thought_log.summary_field"),
      content: normalizeThoughtLogText(thoughtLog.summary),
      /** Whether to wrap the content in a code block */
      codeBlock: false,
    },
    {
      label: localizer(locale, "genai.thought_log.raw_field"),
      content: normalizeThoughtLogText(thoughtLog.raw),
      codeBlock: false,
    },
    {
      label: localizer(locale, "genai.thought_log.fetched_content_field"),
      content: normalizeThoughtLogText(thoughtLog.fetchedContent),
      codeBlock: true,
    },
  ].filter(
    (section): section is { label: string; content: string; codeBlock: boolean } =>
      typeof section.content === "string" && section.content.length > 0,
  );

  if (sections.length === 0) {
    embeds.push(
      new EmbedBuilder()
        .setColor(ColorCode.INFO)
        .setTitle(localizer(locale, "genai.thought_log.title"))
        .setDescription(description)
        .setTimestamp()
        .setFooter({ text: footerText }),
    );
    return embeds;
  }

  let metadataAttached = false;
  for (const section of sections) {
    // Code-block sections: split content across multiple embeds, each with
    // properly opened and closed triple-backtick fences.
    if (section.codeBlock) {
      const fenceOverhead = "```\n\n```".length; // Opening + closing backticks with newlines
      const sectionHeader = `**${section.label}**\n`;
      let remaining = section.content;

      while (remaining.length > 0) {
        const prefix = !metadataAttached && embeds.length === 0 ? `${description}\n\n${sectionHeader}` : sectionHeader;
        const availableLength = Math.max(1, EMBED_DESCRIPTION_LIMIT - prefix.length - fenceOverhead);
        const { chunk, remaining: nextRemaining } = takeEmbedChunk(remaining, availableLength);

        embeds.push(
          new EmbedBuilder()
            .setColor(ColorCode.INFO)
            .setTitle(localizer(locale, "genai.thought_log.title"))
            .setDescription(`${prefix}\`\`\`\n${chunk}\n\`\`\``)
            .setTimestamp()
            .setFooter({ text: footerText }),
        );

        remaining = nextRemaining;
        metadataAttached = true;
      }
      continue;
    }

    let remaining = section.content;

    while (remaining.length > 0) {
      const sectionHeader = `**${section.label}**\n`;
      const prefix = !metadataAttached && embeds.length === 0 ? `${description}\n\n${sectionHeader}` : sectionHeader;
      const availableLength = Math.max(1, EMBED_DESCRIPTION_LIMIT - prefix.length);
      const { chunk, remaining: nextRemaining } = takeEmbedChunk(remaining, availableLength);

      embeds.push(
        new EmbedBuilder()
          .setColor(ColorCode.INFO)
          .setTitle(localizer(locale, "genai.thought_log.title"))
          .setDescription(`${prefix}${chunk}`)
          .setTimestamp()
          .setFooter({ text: footerText }),
      );

      remaining = nextRemaining;
      metadataAttached = true;
    }
  }

  return embeds;
}

export function hasThoughtLogContent(payload?: ThoughtLogPayload | null): boolean {
  return Boolean(
    normalizeThoughtLogText(payload?.summary) ||
      normalizeThoughtLogText(payload?.raw) ||
      normalizeThoughtLogText(payload?.fetchedContent),
  );
}

interface SendThoughtLogEmbedArgs {
  client: Client;
  locale: string;
  tomoriState: TomoriState;
  sourceChannel: StreamContext["channel"];
  thoughtLogChannelId: string;
  thoughtLog: ThoughtLogPayload;
  owner?: ThoughtLogOwner;
  attributionLine?: string;
}

export type ThoughtLogOwner =
  | { type: "default" }
  | { type: "persona"; persona: TomoriState }
  | {
      type: "user_impersonation";
      username: string;
      avatarUrl?: string | null;
    };

async function resolveThoughtLogOwnerIdentity(
  owner: ThoughtLogOwner | undefined,
  thoughtLogChannel: BaseGuildTextChannel,
): Promise<ResolvedWebhookIdentity | null> {
  if (!owner || owner.type === "default") {
    return null;
  }

  if (owner.type === "user_impersonation") {
    return {
      username: owner.username,
      avatarUrl: owner.avatarUrl ?? undefined,
    };
  }

  if (!owner.persona.is_alter) {
    return null;
  }

  return await resolvePersonaWebhookIdentity(owner.persona, thoughtLogChannel.guild);
}

/**
 * Sends a standalone attribution embed to the thought-logs channel when a
 * personal provider was used but the model produced no reasoning/thinking
 * content (so no thought-log embed was emitted). This ensures server admins
 * can always see whose credentials were used, regardless of model type.
 */
export async function sendAttributionOnlyEmbed({
  client,
  locale,
  tomoriState,
  sourceChannel,
  thoughtLogChannelId,
  attributionLine,
}: {
  client: Client;
  locale: string;
  tomoriState: TomoriState;
  sourceChannel: StreamContext["channel"];
  thoughtLogChannelId: string;
  attributionLine: string;
}): Promise<void> {
  const thoughtLogChannel = await client.channels.fetch(thoughtLogChannelId).catch(() => null);

  if (
    !thoughtLogChannel ||
    !("send" in thoughtLogChannel) ||
    typeof thoughtLogChannel.send !== "function" ||
    ("isDMBased" in thoughtLogChannel &&
      typeof thoughtLogChannel.isDMBased === "function" &&
      thoughtLogChannel.isDMBased())
  ) {
    log.warn(`Thought log channel ${thoughtLogChannelId} is missing or unavailable. Skipping attribution-only post.`);
    return;
  }
  if (
    !canMirrorToThoughtLog(sourceChannel as Channel, thoughtLogChannel, tomoriState.config.private_channel_ids ?? [])
  ) {
    return;
  }

  const descriptionLines = [
    localizer(locale, "genai.thought_log.description", { source_line: sourceChannel.toString() }),
    attributionLine.trim(),
  ].filter((line): line is string => Boolean(line.trim()));
  const footerText = localizer(locale, "genai.thought_log.footer", {
    provider: tomoriState.llm.llm_provider,
    model: getLlmDisplayName(tomoriState.llm, tomoriState.config.custom_model_name),
  });

  const embed = new EmbedBuilder()
    .setColor(ColorCode.INFO)
    .setTitle(localizer(locale, "genai.thought_log.personal_attribution_title"))
    .setDescription(descriptionLines.join("\n").slice(0, EMBED_DESCRIPTION_LIMIT))
    .setTimestamp()
    .setFooter({ text: footerText });

  try {
    await thoughtLogChannel.send({
      embeds: [embed],
      allowedMentions: { parse: [] as [] },
      flags: ["SuppressNotifications"] as const,
    });
    log.info(`Posted attribution-only embed to channel ${thoughtLogChannelId}`);
  } catch (error) {
    log.warn(
      `Failed to send attribution-only embed to channel ${thoughtLogChannelId}`,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

export async function sendThoughtLogEmbed({
  client,
  locale,
  tomoriState,
  sourceChannel,
  thoughtLogChannelId,
  thoughtLog,
  owner,
  attributionLine,
}: SendThoughtLogEmbedArgs): Promise<void> {
  if (!hasThoughtLogContent(thoughtLog)) {
    return;
  }

  const thoughtLogChannel = await client.channels.fetch(thoughtLogChannelId).catch(() => null);

  if (
    !thoughtLogChannel ||
    !("send" in thoughtLogChannel) ||
    typeof thoughtLogChannel.send !== "function" ||
    ("isDMBased" in thoughtLogChannel &&
      typeof thoughtLogChannel.isDMBased === "function" &&
      thoughtLogChannel.isDMBased())
  ) {
    log.warn(`Thought log channel ${thoughtLogChannelId} is missing or unavailable. Skipping thought log post.`);
    return;
  }
  if (
    !canMirrorToThoughtLog(sourceChannel as Channel, thoughtLogChannel, tomoriState.config.private_channel_ids ?? [])
  ) {
    return;
  }

  const embeds = buildThoughtLogEmbeds({
    locale,
    tomoriState,
    sourceChannel,
    thoughtLog,
    attributionLine,
  });

  try {
    const payloads = embeds.map((embed) => ({
      embeds: [embed],
      allowedMentions: { parse: [] as [] },
      flags: ["SuppressNotifications"] as const,
    }));
    const shouldUseWebhook =
      owner && owner.type !== "default" && "fetchWebhooks" in thoughtLogChannel && "createWebhook" in thoughtLogChannel;

    if (shouldUseWebhook) {
      const webhookResult = await getOrCreateWebhook(thoughtLogChannel as BaseGuildTextChannel);
      const identity = await resolveThoughtLogOwnerIdentity(owner, thoughtLogChannel as BaseGuildTextChannel);

      if (webhookResult.webhook && identity?.username) {
        await sendWebhookMessagesWithIdentity(webhookResult.webhook, payloads, identity, thoughtLogChannel.id);
      } else {
        for (const payload of payloads) {
          await thoughtLogChannel.send(payload);
        }
      }
    } else {
      for (const payload of payloads) {
        await thoughtLogChannel.send(payload);
      }
    }
    log.info(`Posted ${embeds.length} thought log embed(s) to channel ${thoughtLogChannelId}`);
  } catch (error) {
    log.warn(
      `Failed to send thought log embed to channel ${thoughtLogChannelId}`,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}
