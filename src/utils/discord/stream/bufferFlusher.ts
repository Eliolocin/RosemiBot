import type { StreamConfig, StreamContext } from "@/types/stream/interfaces";
import {
  type StreamMetrics,
  type StreamState,
  type TextProcessingConfig,
  type TypingSimulationConfig,
  DISCORD_STREAMING_CONSTANTS,
  VisibleDeliveryMode,
} from "@/types/stream/types";
import { log } from "@/utils/misc/logger";
import {
  autoCloseIncompleteMarkers as autoCloseStreamBufferMarkers,
  drainDetailsBlocksFromBuffer,
  drainThinkBlocksFromBuffer,
  findRegularOverflowFlushIndex,
  processBufferContent as processStreamBufferContent,
  stripSummaryTag,
} from "@/utils/discord/stream/bufferManager";
import { STREAM_CHUNK_DEDUP_MIN_CHARS, STREAM_CHUNK_DEDUP_TAIL_CHARS } from "@/utils/discord/stream/constants";
import type { StreamMessageDelivery } from "@/utils/discord/stream/messageDelivery";
import type { StreamSegmentProcessor } from "@/utils/discord/stream/segmentProcessor";

type StreamBufferFlusherDependencies = {
  hasStopRequest: (channelId: string) => boolean;
  delivery: StreamMessageDelivery;
  segmentProcessor: StreamSegmentProcessor;
};

/**
 * Owns streaming text buffer mutation and final/pending flush behavior.
 */
export class StreamBufferFlusher {
  public constructor(private readonly deps: StreamBufferFlusherDependencies) {}

  public async processTextChunk(
    textContent: string,
    config: StreamConfig,
    context: StreamContext,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    state: StreamState,
    metrics: StreamMetrics,
  ): Promise<void> {
    if (!context.holdResponseText) log.info(`Stream API: Raw chunk received: "${textContent}"`);

    const normalizedTextContent = this.deduplicateIncomingTextChunk(textContent, state);
    if (normalizedTextContent !== textContent) {
      log.info(`Stream API: Trimmed overlapping chunk (${textContent.length} -> ${normalizedTextContent.length})`);
    }
    if (!normalizedTextContent) {
      return;
    }

    if (normalizedTextContent.trim() && context.currentTurnModelParts) {
      context.currentTurnModelParts.push({ text: normalizedTextContent });
    }

    if (context.suppressTextOutput) {
      return;
    }

    if (state.isInsideThinkBlock) {
      state.thinkBlockBuffer += normalizedTextContent;
    } else if (state.isInsideDetailsBlock) {
      state.detailsBlockBuffer += normalizedTextContent;
    } else {
      state.buffer += normalizedTextContent;
    }
    metrics.totalCharacters += normalizedTextContent.length;

    drainThinkBlocksFromBuffer(state);
    drainDetailsBlocksFromBuffer(state);
    state.buffer = state.buffer.replace(/(^|\n)-#[ \t]*\n+/g, "$1-# ");

    let processedSomething: boolean;
    do {
      processedSomething = false;
      const processingResult = processStreamBufferContent(state, config);

      if (processingResult.shouldFlush && processingResult.segmentToFlush) {
        await this.deps.segmentProcessor.sendBufferSegment(
          processingResult.segmentToFlush,
          processingResult.breakType,
          textConfig,
          typingConfig,
          context,
          state,
        );

        state.buffer = processingResult.updatedBuffer;
        if (this.deps.hasStopRequest(context.channel.id)) {
          return;
        }
        processedSomething = true;
      }

      if (processingResult.newCodeBlockState !== undefined) {
        state.isInsideCodeBlock = processingResult.newCodeBlockState;
      }
    } while (
      processedSomething &&
      state.buffer.length > 0 &&
      !state.isInsideCodeBlock &&
      !state.isInsideThinkBlock &&
      !state.isInsideDetailsBlock &&
      !state.hasSemanticMarkers
    );

    while (
      !state.isInsideCodeBlock &&
      !state.isInsideThinkBlock &&
      !state.isInsideDetailsBlock &&
      !state.hasSemanticMarkers &&
      state.buffer.length >= DISCORD_STREAMING_CONSTANTS.FLUSH_BUFFER_SIZE_REGULAR
    ) {
      const flushIndex = findRegularOverflowFlushIndex(
        state.buffer,
        DISCORD_STREAMING_CONSTANTS.FLUSH_BUFFER_SIZE_REGULAR,
      );

      // A zero index means every candidate breakpoint would split a markdown table. Hold the
      // buffer instead, so the table stays whole and the final flush renders it as one image.
      if (flushIndex <= 0) {
        log.info("Stream Seg: Deferring oversized buffer flush to keep a markdown table intact");
        break;
      }

      const segmentToFlush = state.buffer.substring(0, flushIndex);
      const updatedBuffer = state.buffer.substring(flushIndex);

      log.info(
        `Stream Seg: Flushing oversized regular buffer at safe breakpoint (total: ${state.buffer.length}, flush: ${segmentToFlush.length}, retain: ${updatedBuffer.length})`,
      );

      await this.deps.segmentProcessor.sendBufferSegment(
        segmentToFlush,
        "overflow",
        textConfig,
        typingConfig,
        context,
        state,
      );
      state.buffer = updatedBuffer;
      if (this.deps.hasStopRequest(context.channel.id)) {
        return;
      }
    }

    if (context.holdResponseText && this.deps.segmentProcessor.exceedsHeldRetention(state.buffer, context, state)) {
      const unflushable = state.buffer;
      state.buffer = "";
      await this.deps.segmentProcessor.sendBufferSegment(
        unflushable,
        "overflow",
        textConfig,
        typingConfig,
        context,
        state,
      );
    }
  }

  public async flushFinalBuffer(
    state: StreamState,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
  ): Promise<void> {
    if (state.buffer.length > 0) {
      const blockStatus = state.isInsideCodeBlock
        ? "still in code block"
        : state.hasSemanticMarkers
          ? "contains semantic markers"
          : "regular";

      if (!context.holdResponseText)
        log.info(`Stream Seg: Flushing final buffer content (${blockStatus}): "${state.buffer}"`);

      if (state.isInsideCodeBlock) {
        log.warn("Stream Seg: Final flush occurred while still inside a code block. The block might be incomplete.");
      }

      if (state.hasSemanticMarkers) {
        log.info("Stream Seg: Final flush has incomplete semantic markers. Auto-closing them to prevent message loss.");
        state.buffer = autoCloseStreamBufferMarkers(state.buffer);
      }

      await this.deps.segmentProcessor.sendBufferSegment(
        state.buffer,
        "final",
        textConfig,
        typingConfig,
        context,
        state,
      );
      state.buffer = "";
      state.isInsideCodeBlock = false;
      state.hasSemanticMarkers = false;
    }

    await this.deps.segmentProcessor.flushHeldOrphanPunctuation("final", textConfig, typingConfig, context, state);
    if (textConfig.visibleDeliveryMode === VisibleDeliveryMode.AGGREGATED_PHASE) {
      await this.deps.delivery.flushAggregatedTextBuffer(textConfig, context, state);
    }

    if (state.isInsideThinkBlock && state.thinkBlockBuffer.trim()) {
      const thinkContent = state.thinkBlockBuffer.trim();
      state.thoughtRawSegments.push(thinkContent);
      log.info(
        `Stream Seg: Captured ${thinkContent.length} chars of unterminated think block to thought log on final flush`,
      );
      state.thinkBlockBuffer = "";
      state.isInsideThinkBlock = false;
    }

    if (state.isInsideDetailsBlock && state.detailsBlockBuffer.trim()) {
      const detailsContent = stripSummaryTag(state.detailsBlockBuffer);
      if (detailsContent) {
        state.detailsSegments.push(detailsContent);
        log.info(
          `Stream Seg: Captured ${detailsContent.length} chars of unterminated details block to STM on final flush`,
        );
      }
      state.detailsBlockBuffer = "";
      state.isInsideDetailsBlock = false;
    }
  }

  public async flushPendingBuffer(
    state: StreamState,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
    trimTrailingIncompleteClause: boolean = false,
  ): Promise<void> {
    if (state.isInsideThinkBlock) {
      const thinkContent = state.thinkBlockBuffer.trim();
      if (thinkContent) {
        state.thoughtRawSegments.push(thinkContent);
        log.info(`Stream Seg: Captured ${thinkContent.length} chars of think block to thought log before flush`);
      }
      state.thinkBlockBuffer = "";
      state.isInsideThinkBlock = false;
    }

    if (state.isInsideDetailsBlock) {
      const detailsContent = stripSummaryTag(state.detailsBlockBuffer);
      if (detailsContent) {
        state.detailsSegments.push(detailsContent);
        log.info(`Stream Seg: Captured ${detailsContent.length} chars of details block to STM before flush`);
      }
      state.detailsBlockBuffer = "";
      state.isInsideDetailsBlock = false;
    }

    if (state.isInsideCodeBlock) {
      log.warn("Stream Seg: Function call received while inside a code block. Flushing incomplete block.");
      state.isInsideCodeBlock = false;
    }

    if (state.hasSemanticMarkers) {
      log.info(
        "Stream Seg: Function call received with incomplete semantic markers. Auto-closing them before flushing.",
      );
      state.buffer = autoCloseStreamBufferMarkers(state.buffer);
      state.hasSemanticMarkers = false;
    }

    let segmentToProcess = state.buffer;
    if (trimTrailingIncompleteClause) {
      const trimmedSegment = this.trimTrailingIncompleteClause(segmentToProcess);
      if (trimmedSegment !== segmentToProcess) {
        log.info(
          `Stream Seg: Removed trailing incomplete clause before function call (kept: ${trimmedSegment.length}, removed: ${segmentToProcess.length - trimmedSegment.length})`,
        );
        segmentToProcess = trimmedSegment;
      }
    }
    if (!context.holdResponseText) log.info(`Stream Seg: Flushing buffer for function call: "${segmentToProcess}"`);

    await this.deps.segmentProcessor.sendBufferSegment(
      segmentToProcess,
      "tool_call",
      textConfig,
      typingConfig,
      context,
      state,
    );
    await this.deps.segmentProcessor.flushHeldOrphanPunctuation("tool_call", textConfig, typingConfig, context, state);
    if (textConfig.visibleDeliveryMode === VisibleDeliveryMode.AGGREGATED_PHASE) {
      await this.deps.delivery.flushAggregatedTextBuffer(textConfig, context, state);
    }
    state.buffer = "";
  }

  private deduplicateIncomingTextChunk(textContent: string, state: StreamState): string {
    if (!textContent || textContent.length < STREAM_CHUNK_DEDUP_MIN_CHARS) {
      return textContent;
    }

    const recentText = this.getRecentStreamTextTail(state);
    if (!recentText) {
      return textContent;
    }

    if (recentText.endsWith(textContent)) {
      return "";
    }

    const maxOverlap = Math.min(recentText.length, textContent.length);
    for (let overlap = maxOverlap; overlap >= STREAM_CHUNK_DEDUP_MIN_CHARS; overlap--) {
      if (recentText.slice(recentText.length - overlap) === textContent.slice(0, overlap)) {
        return textContent.slice(overlap);
      }
    }

    return textContent;
  }

  private getRecentStreamTextTail(state: StreamState): string {
    const combined = `${state.accumulatedText}${state.pendingResponseText ?? ""}${state.pendingAggregatedText}${state.buffer}`;
    if (!combined) {
      return "";
    }

    if (combined.length <= STREAM_CHUNK_DEDUP_TAIL_CHARS) {
      return combined;
    }

    return combined.slice(-STREAM_CHUNK_DEDUP_TAIL_CHARS);
  }

  private trimTrailingIncompleteClause(text: string): string {
    if (!text) {
      return text;
    }

    const textWithoutTrailingWhitespace = text.replace(/\s+$/u, "");
    if (!textWithoutTrailingWhitespace) {
      return text;
    }

    if (/[.!?。！？…](?:[)"'\]\u300d\u300f\u300b\u3011]+)?$/u.test(textWithoutTrailingWhitespace)) {
      return text;
    }

    let lastBoundaryIndex = -1;
    for (let i = textWithoutTrailingWhitespace.length - 1; i >= 0; i--) {
      const ch = textWithoutTrailingWhitespace[i];
      if (/[.!?。！？…\n]/u.test(ch)) {
        lastBoundaryIndex = i;
        break;
      }
    }

    if (lastBoundaryIndex === -1) {
      return text;
    }

    const trimmedCore = textWithoutTrailingWhitespace.slice(0, lastBoundaryIndex + 1);
    const originalTrailingWhitespace = text.slice(textWithoutTrailingWhitespace.length);
    return `${trimmedCore}${originalTrailingWhitespace}`;
  }
}
