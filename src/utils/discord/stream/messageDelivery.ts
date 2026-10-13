import { AttachmentBuilder, type Message } from "discord.js";
import { HumanizerDegree } from "@/types/db/schema";
import type { StreamContext } from "@/types/stream/interfaces";
import type {
  SpriteMessageRecordInfo,
  StreamState,
  TextProcessingConfig,
  TypingSimulationConfig,
} from "@/types/stream/types";
import { VisibleDeliveryMode, DISCORD_STREAMING_CONSTANTS } from "@/types/stream/types";
import { log } from "@/utils/misc/logger";
import { renderMarkdownTableToPng } from "@/utils/image/markdownTableRenderer";
import { attachShowMarkdownCollector, createShowMarkdownButtonRow } from "@/utils/discord/markdownTableButton";
import { resolveManagedChannelWebhook } from "@/utils/discord/webhook/webhookCore";
import { setCachedRenderedMarkdownTable } from "@/utils/text/markdownTableCache";
import { extractMarkdownTableSegments, MARKDOWN_TABLE_ATTACHMENT_PREFIX } from "@/utils/text/markdownTable";
import { chunkMessage } from "@/utils/text/processors/chunkProcessor";
import { humanizeString } from "@/utils/text/processors/formatters";
import type { StreamSendPayload, StreamUiUpdater } from "@/utils/discord/stream/uiUpdater";
import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import type { ChatSendReason } from "@/utils/chat/diagnosticTimeline";

type DeliveryChunk = { content: string; diagnosticReason: ChatSendReason };

export type BufferedDeliveryBoundary =
  | "code_open"
  | "code_close"
  | "newline"
  | "period"
  | "overflow"
  | "attachment"
  | "final"
  | "tool_call";

export type StreamDeliveryOptions = {
  identityOverride?: ResolvedWebhookIdentity;
  accumulatedTextPrefix?: string;
  /** Sprite mapping persisted after a successful webhook send (clean-name sprite renders). */
  spriteRecord?: SpriteMessageRecordInfo;
  /** The persona's base appearance under an identity override, which is not a copied identity. */
  isNeutralAppearance?: boolean;
};

type StreamMessageDeliveryDependencies = {
  hasStopRequest: (channelId: string) => boolean;
  uiUpdater: StreamUiUpdater;
};

/**
 * Owns Discord message delivery, typing simulation, aggregate-mode flushing, and table attachments.
 */
export class StreamMessageDelivery {
  public constructor(private readonly deps: StreamMessageDeliveryDependencies) {}

  public hasPendingAggregatedText(state: StreamState): boolean {
    return Boolean(state.pendingAggregatedText.trim());
  }

  public queueAggregatedSegment(
    segment: string,
    boundary: BufferedDeliveryBoundary | undefined,
    state: StreamState,
  ): void {
    const joinWithBlankLine = state.pendingAggregateJoinNextWithBlankLine && state.pendingAggregatedText.length > 0;
    if (joinWithBlankLine) {
      const trimmedExisting = state.pendingAggregatedText.replace(/\n+$/u, "");
      const trimmedIncoming = segment.replace(/^\n+/u, "");
      state.pendingAggregatedText = `${trimmedExisting}\n\n${trimmedIncoming}`;
    } else {
      state.pendingAggregatedText += segment;
    }

    state.pendingAggregateJoinNextWithBlankLine = boundary === "newline";
    log.info(
      `Stream Aggregate: Queued ${segment.length} chars (boundary=${boundary ?? "none"}, total=${state.pendingAggregatedText.length})`,
    );
  }

  public async flushAggregatedTextBuffer(
    textConfig: TextProcessingConfig,
    context: StreamContext,
    state: StreamState,
  ): Promise<void> {
    if (!this.hasPendingAggregatedText(state)) {
      state.pendingAggregatedText = "";
      state.pendingAggregateJoinNextWithBlankLine = false;
      return;
    }

    const aggregatedText = state.pendingAggregatedText;
    state.pendingAggregatedText = "";
    state.pendingAggregateJoinNextWithBlankLine = false;

    const messageChunks = chunkMessage(aggregatedText, HumanizerDegree.NONE, textConfig.maxMessageLength);
    const finalMessageChunks = messageChunks.filter((chunk) => chunk.trim());
    if (!finalMessageChunks.length) {
      return;
    }

    log.info(
      `Stream Aggregate: Flushing ${aggregatedText.length} chars as ${finalMessageChunks.length} Discord message(s)`,
    );
    await this.sendChunksImmediate(
      finalMessageChunks.map((content, index) => ({
        content,
        diagnosticReason:
          index === 0
            ? "stream_segment"
            : aggregatedText.length > textConfig.maxMessageLength
              ? "length_split"
              : "formatting_split",
      })),
      context,
      state,
    );
  }

  public async flushHeldOrphanPunctuation(
    boundary: BufferedDeliveryBoundary,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
    state: StreamState,
    options?: StreamDeliveryOptions,
  ): Promise<void> {
    if (!state.pendingOrphanPunctuation) {
      return;
    }

    const orphan = state.pendingOrphanPunctuation;
    state.pendingOrphanPunctuation = undefined;
    log.info(`Stream Orphan: Releasing held "${orphan}" at ${boundary} boundary.`);
    await this.sendSegment(orphan, boundary, textConfig, typingConfig, context, state, options);
  }

  public async sendRenderedMarkdownTable(
    tableMarkdown: string,
    fallbackText: string,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
    state: StreamState,
    options?: StreamDeliveryOptions,
  ): Promise<void> {
    const tableSegments = extractMarkdownTableSegments(tableMarkdown);
    const firstTableSegment = tableSegments.find((segment) => segment.type === "table");
    if (!firstTableSegment || firstTableSegment.type !== "table") {
      await this.sendSegment(fallbackText, undefined, textConfig, typingConfig, context, state, options);
      return;
    }

    const renderedBuffer = await renderMarkdownTableToPng(firstTableSegment.table);
    if (!renderedBuffer) {
      await this.sendSegment(fallbackText, undefined, textConfig, typingConfig, context, state, options);
      return;
    }

    await this.flushHeldOrphanPunctuation("attachment", textConfig, typingConfig, context, state, options);
    if (textConfig.visibleDeliveryMode === VisibleDeliveryMode.AGGREGATED_PHASE) {
      await this.flushAggregatedTextBuffer(textConfig, context, state);
    }

    const attachment = new AttachmentBuilder(renderedBuffer, {
      name: `${MARKDOWN_TABLE_ATTACHMENT_PREFIX}${Date.now()}.png`,
    });

    const sentMessage = await this.sendSinglePayload(
      {
        files: [attachment],
        components: [createShowMarkdownButtonRow(context.locale)],
        allowedMentions: {
          parse: [],
          repliedUser: false,
        },
        identityOverride: options?.identityOverride,
        accumulatedTextPrefix: options?.accumulatedTextPrefix,
        spriteRecord: options?.spriteRecord,
        isNeutralAppearance: options?.isNeutralAppearance,
        diagnosticReason: "table_attachment",
      },
      tableMarkdown,
      context,
      state,
    );

    if (sentMessage) {
      // Cache first: the collector reads the source back out of the cache on every press,
      // so the entry must exist before the button can be clicked.
      setCachedRenderedMarkdownTable(sentMessage.id, tableMarkdown.trim());

      // A webhook-authored message can only be edited through the webhook that sent it, so
      // hand the collector whichever webhook actually delivered this table, plus the thread
      // id a parent-channel webhook needs to address a message posted inside a thread.
      // A sprite render can put the main persona on the webhook path without ever populating
      // `context.webhook`, so resolve it lazily in that case; the lookup is cached.
      const authoringWebhook = sentMessage.webhookId
        ? (context.webhook ?? (await resolveManagedChannelWebhook(context.channel)) ?? undefined)
        : undefined;
      const threadId =
        "isThread" in context.channel && typeof context.channel.isThread === "function" && context.channel.isThread()
          ? context.channel.id
          : undefined;
      attachShowMarkdownCollector(sentMessage, context.locale, authoringWebhook, threadId);
    }
  }

  public async sendSegment(
    segment: string,
    boundary: BufferedDeliveryBoundary | undefined,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
    state: StreamState,
    options?: StreamDeliveryOptions,
  ): Promise<void> {
    if (!segment.trim()) return;

    if (textConfig.visibleDeliveryMode === VisibleDeliveryMode.AGGREGATED_PHASE && !options?.identityOverride) {
      this.queueAggregatedSegment(segment, boundary, state);
      return;
    }

    if (textConfig.visibleDeliveryMode === VisibleDeliveryMode.AGGREGATED_PHASE && options?.identityOverride) {
      await this.flushAggregatedTextBuffer(textConfig, context, state);
    }

    const rawMessageChunks = chunkMessage(segment, textConfig.humanizerDegree, textConfig.maxMessageLength);
    if (!rawMessageChunks.length) return;

    const finalMessageChunks: DeliveryChunk[] = [];
    for (const [chunkIndex, chunk] of rawMessageChunks.entries()) {
      const chunkReason: ChatSendReason =
        chunkIndex === 0
          ? "stream_segment"
          : segment.length > textConfig.maxMessageLength
            ? "length_split"
            : "formatting_split";
      if (textConfig.humanizerDegree === HumanizerDegree.HEAVY) {
        // A humanizer flush becomes a real extra entry here, so it goes out as its own sent
        // message (with typing simulation in between) rather than a linebreak inside one message.
        const humanizedPieces = humanizeString(chunk);
        if (humanizedPieces.length > 1 || humanizedPieces[0] !== chunk) {
          log.info(`Stream Send: Humanized (D3) from "${chunk}" to ${JSON.stringify(humanizedPieces)}`);
        }
        for (const [pieceIndex, piece] of humanizedPieces.entries()) {
          if (piece.trim()) {
            finalMessageChunks.push({
              content: piece,
              diagnosticReason: pieceIndex === 0 ? chunkReason : "humanizer_split",
            });
          }
        }
        continue;
      }
      if (chunk.trim()) {
        finalMessageChunks.push({ content: chunk, diagnosticReason: chunkReason });
      }
    }
    if (!finalMessageChunks.length) return;

    if (typingConfig.enabled) {
      await this.sendChunksWithTyping(finalMessageChunks, typingConfig, context, state, options);
    } else {
      await this.sendChunksImmediate(finalMessageChunks, context, state, options);
    }
  }

  public async sendSinglePayload(
    payload: StreamSendPayload,
    textForState: string,
    context: StreamContext,
    state: StreamState,
  ): Promise<Message | null> {
    return await this.deps.uiUpdater.sendSinglePayload(payload, textForState, context, state);
  }

  private async sendChunksWithTyping(
    chunks: DeliveryChunk[],
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
    state: StreamState,
    options?: StreamDeliveryOptions,
  ): Promise<void> {
    if (this.deps.hasStopRequest(context.channel.id)) {
      log.info("Stream Send: Stop request detected before sending chunks with typing");
      return;
    }

    const firstChunk = chunks[0];
    await this.sendSingleMessage(firstChunk.content, context, state, options, firstChunk.diagnosticReason);

    for (let i = 1; i < chunks.length; i++) {
      if (this.deps.hasStopRequest(context.channel.id)) {
        log.info(`Stream Send: Stop request detected before sending chunk ${i + 1}/${chunks.length}`);
        return;
      }

      const chunkToSend = chunks[i];
      let typingTime = Math.min(
        chunkToSend.content.length * typingConfig.baseSpeedMsPerChar,
        typingConfig.maxTypingTimeMs,
      );
      typingTime = Math.max(typingTime, typingConfig.minVisibleDurationMs);
      if (chunkToSend.content.includes("```")) {
        typingTime = Math.max(typingTime, typingConfig.minVisibleDurationMs * 1.25);
      }

      log.info(`Stream Sim: Typing for ${Math.round(typingTime)}ms`);
      const cancelled = await this.interruptibleDelay(typingTime, context.channel.id);
      if (cancelled) {
        log.info("Stream Send: Stop request detected during typing simulation");
        return;
      }

      await this.sendSingleMessage(
        chunkToSend.content,
        context,
        state,
        {
          ...options,
          accumulatedTextPrefix: undefined,
        },
        chunkToSend.diagnosticReason,
      );

      if (i < chunks.length - 1 && typingConfig.randomPauseEnabled) {
        const pauseCancelled = await this.addThinkingPauseInterruptible(typingConfig, context);
        if (pauseCancelled) {
          log.info("Stream Send: Stop request detected during thinking pause");
          return;
        }
      }
    }
  }

  private async sendChunksImmediate(
    chunks: DeliveryChunk[],
    context: StreamContext,
    state: StreamState,
    options?: StreamDeliveryOptions,
  ): Promise<void> {
    for (const [index, chunk] of chunks.entries()) {
      if (this.deps.hasStopRequest(context.channel.id)) {
        log.info("Stream Send: Stop request detected before sending chunk in immediate mode");
        return;
      }

      await this.sendSingleMessage(
        chunk.content,
        context,
        state,
        {
          ...options,
          accumulatedTextPrefix: index === 0 ? options?.accumulatedTextPrefix : undefined,
        },
        chunk.diagnosticReason,
      );
    }
  }

  private async sendSingleMessage(
    content: string,
    context: StreamContext,
    state: StreamState,
    options?: StreamDeliveryOptions,
    diagnosticReason: ChatSendReason = "stream_segment",
  ): Promise<void> {
    await this.sendSinglePayload(
      {
        content,
        identityOverride: options?.identityOverride,
        accumulatedTextPrefix: options?.accumulatedTextPrefix,
        spriteRecord: options?.spriteRecord,
        isNeutralAppearance: options?.isNeutralAppearance,
        diagnosticReason,
      },
      content,
      context,
      state,
    );
  }

  private async addThinkingPauseInterruptible(
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
  ): Promise<boolean> {
    const isThinkingPause = Math.random() < typingConfig.thinkingPauseChance;
    let pauseTime = Math.floor(
      DISCORD_STREAMING_CONSTANTS.MIN_RANDOM_PAUSE_MS +
        Math.random() *
          (DISCORD_STREAMING_CONSTANTS.MAX_RANDOM_PAUSE_MS - DISCORD_STREAMING_CONSTANTS.MIN_RANDOM_PAUSE_MS),
    );

    if (isThinkingPause) {
      pauseTime = Math.max(pauseTime * 1.5, typingConfig.minVisibleDurationMs);
    }

    log.info(`Stream Sim: Pausing for ${Math.round(pauseTime)}ms${isThinkingPause ? " (thinking pause)" : ""}`);
    return await this.interruptibleDelay(pauseTime, context.channel.id);
  }

  private async interruptibleDelay(delayMs: number, channelId: string): Promise<boolean> {
    const checkInterval = Math.min(250, delayMs / 4);
    const endTime = Date.now() + delayMs;

    while (Date.now() < endTime) {
      if (this.deps.hasStopRequest(channelId)) {
        return true;
      }

      const timeLeft = endTime - Date.now();
      const waitTime = Math.min(checkInterval, timeLeft);
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    return false;
  }
}
