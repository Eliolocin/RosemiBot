import { escapeMarkdown, type BaseGuildTextChannel, type Channel } from "discord.js";
import type { StandardEmbedOptions } from "@/types/discord/embed";
import type { ToolContext } from "@/types/tool/interfaces";
import type { AssembledServerConfig } from "@/types/db/schema";
import { type ToolNoticeKey, TOOL_NOTICE_DEFINITIONS, VERBOSITY_EXEMPT_NOTICE_KEYS } from "@/constants/toolNotices";
import { sendStandardEmbed, type WebhookEmbedContext } from "@/utils/discord/embedHelper";
import { getOrCreateWebhook } from "@/utils/discord/webhook/lifecycle";
import { canMirrorToThoughtLog } from "@/utils/discord/thoughtLogAudience";
import { localizer } from "@/utils/text/localizer";
import { log } from "@/utils/misc/logger";

// Keyed on the text rather than the locale: the description may already have fallen back to
// English. Hangul is excluded because Korean prose ends sentences with an ASCII period.
const FULL_WIDTH_SENTENCE_SCRIPT_END = /[぀-ヿ㐀-鿿豈-﫿＀-￯]$/;

const KILL_HINT_FOOTER_KEY = "tools.tool_notice.kill_hint";
const IMAGE_NOTICE_PROMPT_PREVIEW_LENGTH = 700;

function resolveDescription(locale: string, options: StandardEmbedOptions): string {
  const baseDescription = options.description
    ? options.description
    : options.descriptionKey
      ? localizer(locale, options.descriptionKey, options.descriptionVars)
      : "";
  const existingFooter = options.footerKey ? localizer(locale, options.footerKey, options.footerVars) : "";

  return [baseDescription.trim(), existingFooter.trim()].filter((part) => part.length > 0).join(" ");
}

function buildToolNoticeOptions(
  locale: string,
  options: StandardEmbedOptions,
  sourceLine?: string,
  showKillHint?: boolean,
): StandardEmbedOptions {
  const description = resolveDescription(locale, options);
  const sourceDescription = sourceLine
    ? localizer(locale, "genai.thought_log.description", {
        source_line: sourceLine,
      })
    : "";

  return {
    ...options,
    minimal: undefined,
    description: [sourceDescription, description].filter((part) => part.length > 0).join("\n\n"),
    footerKey: showKillHint ? KILL_HINT_FOOTER_KEY : undefined,
    footerVars: undefined,
    configHint: true,
  };
}

/**
 * Prefixes a hidden notice's body with the link back to the message that caused it, so a reader
 * of the thought log can tell which conversation the rerouted notice belongs to.
 */
export function withThoughtLogSource(context: ToolContext, options: StandardEmbedOptions): StandardEmbedOptions {
  const sourceDescription = localizer(context.locale, "genai.thought_log.description", {
    source_line: getSourceLine(context),
  });
  const body = options.description
    ? options.description
    : options.descriptionKey
      ? localizer(context.locale, options.descriptionKey, options.descriptionVars)
      : "";

  return {
    ...options,
    description: [sourceDescription, body.trim()].filter((part) => part.length > 0).join("\n\n"),
  };
}

function getWebhookContext(context: ToolContext) {
  return {
    webhook: context.webhook,
    personaUsername: context.personaUsername,
    personaAvatarUrl: context.personaAvatarUrl,
  };
}

function getSourceLine(context: ToolContext): string {
  return context.message?.url ?? context.channel.toString();
}

function truncateNoticeText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function joinNoticeLines(lines: string[]): string {
  const paragraphs: string[] = [];
  let currentParagraph: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
      if (currentParagraph.length > 0) {
        paragraphs.push(currentParagraph.join("\n"));
        currentParagraph = [];
      }
      continue;
    }
    currentParagraph.push(trimmedLine);
  }

  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph.join("\n"));
  }

  return paragraphs.join("\n\n");
}

function buildLabeledGenerationNoticeDescription(
  locale: string,
  baseDescription: string,
  modelLineKey: string,
  promptLineKey: string,
  model: string,
  prompt: string,
  timingLine: string,
  extraLines: string[] = [],
  metadataExtraLines: string[] = [],
): string {
  const safeModel = `\`${escapeMarkdown(model.trim())}\``;
  const safePrompt = `\`${escapeMarkdown(truncateNoticeText(prompt, IMAGE_NOTICE_PROMPT_PREVIEW_LENGTH))}\``;
  const trimmedBaseDescription = baseDescription.trim();
  const trimmedTimingLine = timingLine.trim();
  const baseWithTiming =
    trimmedTimingLine.length === 0
      ? trimmedBaseDescription
      : /[.!?。！？…]$/.test(trimmedBaseDescription)
        ? `${trimmedBaseDescription} ${trimmedTimingLine}`
        : FULL_WIDTH_SENTENCE_SCRIPT_END.test(trimmedBaseDescription)
          ? `${trimmedBaseDescription}。${trimmedTimingLine}`
          : `${trimmedBaseDescription}. ${trimmedTimingLine}`;
  const metadataLines = [
    localizer(locale, modelLineKey, { model: safeModel }),
    localizer(locale, promptLineKey, { prompt: safePrompt }),
    ...metadataExtraLines.map((line) => line.trim()).filter((line) => line.length > 0),
  ].filter((line) => line.length > 0);
  const trailingLines = joinNoticeLines(extraLines);

  return [baseWithTiming, metadataLines.join("\n"), trailingLines].filter((part) => part.length > 0).join("\n\n");
}

export function buildImageToolNoticeDescription(
  locale: string,
  baseDescription: string,
  model: string,
  prompt: string,
  timingLine: string,
  extraLines: string[] = [],
  metadataExtraLines: string[] = [],
): string {
  return buildLabeledGenerationNoticeDescription(
    locale,
    baseDescription,
    "tools.image.notice_model_line",
    "tools.image.notice_prompt_line",
    model,
    prompt,
    timingLine,
    extraLines,
    metadataExtraLines,
  );
}

export function buildReferencedMessageUrl(context: ToolContext, messageId: string): string | null {
  const trimmedMessageId = messageId.trim();
  if (!trimmedMessageId) {
    return null;
  }

  if (
    "guildId" in context.channel &&
    typeof context.channel.guildId === "string" &&
    context.channel.guildId.length > 0
  ) {
    return `https://discord.com/channels/${context.channel.guildId}/${context.channel.id}/${trimmedMessageId}`;
  }

  if (
    "isDMBased" in context.channel &&
    typeof context.channel.isDMBased === "function" &&
    context.channel.isDMBased()
  ) {
    return `https://discord.com/channels/@me/${context.channel.id}/${trimmedMessageId}`;
  }

  return null;
}

export function buildVideoToolNoticeDescription(
  locale: string,
  baseDescription: string,
  model: string,
  prompt: string,
  timingLine: string,
  extraLines: string[] = [],
): string {
  return buildLabeledGenerationNoticeDescription(
    locale,
    baseDescription,
    "tools.video.notice_model_line",
    "tools.video.notice_prompt_line",
    model,
    prompt,
    timingLine,
    extraLines,
  );
}

export function isNoticeEmbedVisible(config: AssembledServerConfig, key: ToolNoticeKey): boolean {
  return !(config.tool_notice_hidden_keys ?? []).includes(key);
}

export function isToolNoticeVisible(config: AssembledServerConfig, key: ToolNoticeKey): boolean {
  return isNoticeEmbedVisible(config, key);
}

/**
 * Whether a notice posted in the conversation renders Minimal.
 *
 * Minimal notices post only their title in conversation while mirroring the full card to the
 * thought log. Verbose notices post the full card in conversation alone to avoid redundancy.
 */
export function isMinimalNotice(config: AssembledServerConfig, key: ToolNoticeKey): boolean {
  return !VERBOSITY_EXEMPT_NOTICE_KEYS.has(key) && config.tool_notice_verbosity !== "verbose";
}

/** Where a hidden notice is rerouted, with the persona identity to post it under when available. */
export interface ThoughtLogTarget {
  channel: BaseGuildTextChannel;
  webhookContext: WebhookEmbedContext | undefined;
}

async function resolveThoughtLogTarget(context: ToolContext, logLabel: string): Promise<ThoughtLogTarget | null> {
  const thoughtLogChannelId = context.tomoriState.config.thought_log_channel_disc_id;
  if (!thoughtLogChannelId) {
    return null;
  }

  const thoughtLogChannel = await context.client.channels.fetch(thoughtLogChannelId).catch(() => null);
  if (
    !thoughtLogChannel ||
    !("send" in thoughtLogChannel) ||
    typeof thoughtLogChannel.send !== "function" ||
    ("isDMBased" in thoughtLogChannel &&
      typeof thoughtLogChannel.isDMBased === "function" &&
      thoughtLogChannel.isDMBased())
  ) {
    log.warn(`${logLabel}: Thought log channel ${thoughtLogChannelId} is missing or unavailable. Skipping reroute.`);
    return null;
  }
  if (
    !canMirrorToThoughtLog(
      context.channel as Channel,
      thoughtLogChannel,
      context.tomoriState.config.private_channel_ids ?? [],
    )
  ) {
    return null;
  }

  let rerouteWebhookContext: WebhookEmbedContext | undefined;
  if (context.personaUsername && "fetchWebhooks" in thoughtLogChannel && "createWebhook" in thoughtLogChannel) {
    const webhookResult = await getOrCreateWebhook(thoughtLogChannel as BaseGuildTextChannel);
    if (webhookResult.webhook) {
      rerouteWebhookContext = {
        webhook: webhookResult.webhook,
        personaUsername: context.personaUsername,
        personaAvatarUrl: context.personaAvatarUrl,
      };
    } else if (context.webhook) {
      log.warn(
        `${logLabel}: Failed to get webhook for thought log channel ${thoughtLogChannelId}. Falling back to bot send.`,
      );
    }
  }

  return { channel: thoughtLogChannel as BaseGuildTextChannel, webhookContext: rerouteWebhookContext };
}

/**
 * Resolves where a hidden notice should go instead of the conversation channel.
 *
 * @returns `null` when the notice must be dropped: no thought log is set, it is unreachable, or
 *   its readers are not demonstrably allowed to read the source (see `canMirrorToThoughtLog`).
 */
export async function resolveHiddenNoticeTarget(
  context: ToolContext,
  logLabel: string,
): Promise<ThoughtLogTarget | null> {
  return resolveThoughtLogTarget(context, logLabel);
}

export async function routeToolNoticeToThoughtLog(
  context: ToolContext,
  options: StandardEmbedOptions,
  logLabel: string,
): Promise<boolean> {
  const target = await resolveThoughtLogTarget(context, logLabel);
  if (!target) {
    return false;
  }

  await sendStandardEmbed(
    target.channel,
    context.locale,
    buildToolNoticeOptions(context.locale, options, getSourceLine(context), context.showKillHint),
    target.webhookContext,
  );

  return true;
}

export async function sendToolNotice(
  context: ToolContext,
  noticeKey: ToolNoticeKey,
  options: StandardEmbedOptions,
  logLabel: string,
): Promise<void> {
  if (context.suppressProgressNotices) return;
  try {
    const { config } = context.tomoriState;
    const isVisible = isToolNoticeVisible(config, noticeKey);
    const isMinimal = isVisible && isMinimalNotice(config, noticeKey);
    if (isVisible) {
      const visibleOptions = isMinimal
        ? { ...options, minimal: true }
        : buildToolNoticeOptions(context.locale, options, undefined, context.showKillHint);
      await sendStandardEmbed(context.channel, context.locale, visibleOptions, getWebhookContext(context));
      if (!isMinimal) {
        return;
      }
    }

    await routeToolNoticeToThoughtLog(context, options, logLabel);
  } catch (error) {
    log.warn(`${logLabel}: Failed to send tool notice embed`, error as Error);
  }
}

export async function routeHiddenToolNotice(
  context: ToolContext,
  options: StandardEmbedOptions,
  logLabel: string,
): Promise<boolean> {
  if (context.suppressProgressNotices) return false;

  try {
    return await routeToolNoticeToThoughtLog(context, options, logLabel);
  } catch (error) {
    log.warn(`${logLabel}: Failed to route hidden tool notice`, error as Error);
    return false;
  }
}

export async function sendToolProgressNotice(
  context: ToolContext,
  noticeKey: ToolNoticeKey,
  options: StandardEmbedOptions,
  logLabel: string,
): Promise<void> {
  await sendToolNotice(context, noticeKey, options, logLabel);
}

export { TOOL_NOTICE_DEFINITIONS };
