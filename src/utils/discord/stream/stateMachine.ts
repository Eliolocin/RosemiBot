import type { Client, Message } from "discord.js";
import type { StreamResult } from "@/types/provider/interfaces";
import type {
  StreamOrchestrator as IStreamOrchestrator,
  ProcessedChunk,
  StreamConfig,
  StreamContext,
  StreamProvider,
} from "@/types/stream/interfaces";
import {
  type StreamMetrics,
  type StreamState,
  type TextProcessingConfig,
  type TypingSimulationConfig,
  createDefaultStreamMetrics,
  createDefaultStreamState,
  createTypingSimulationConfig,
  VisibleDeliveryMode,
} from "@/types/stream/types";
import { StreamBufferFlusher } from "@/utils/discord/stream/bufferFlusher";
import { StreamErrorUi } from "@/utils/discord/stream/errorUi";
import { StreamMessageDelivery } from "@/utils/discord/stream/messageDelivery";
import { StreamSegmentProcessor } from "@/utils/discord/stream/segmentProcessor";
import {
  cleanupOldStopRequests,
  clearStopRequest,
  deleteStopRequest,
  getAndClearStopContext,
  getStopReason,
  hasStopRequest,
  INTERNAL_STOP_REQUESTER_IDS,
  isFollowUpRequest,
  isSilentSpeakerGuardStop,
  peekStopRequest,
  requestFollowUp,
  requestStop,
  type StreamStopContext,
} from "@/utils/discord/stream/stopRequests";
import { isUserImpersonationStreamContext, StreamUiUpdater } from "@/utils/discord/stream/uiUpdater";
import { createStreamTextProcessingConfig } from "@/utils/discord/stream/textConfig";
import { normalizeProviderUsage } from "@/utils/text/tokenEstimate";
import { appendChunkThoughts, buildThoughtLogPayload, wasEmptyStreamResponse } from "@/utils/discord/stream/thoughtLog";
import { log } from "@/utils/misc/logger";

/**
 * Coordinates provider streaming as a state machine while delegating buffer, stop, UI, and error responsibilities.
 */
export class StreamOrchestrator implements IStreamOrchestrator {
  private readonly uiUpdater = new StreamUiUpdater({
    hasStopRequest: (channelId) => hasStopRequest(channelId),
    requestStop: (channelId, requesterId) => requestStop(channelId, requesterId),
    notifyStreamProgress: (context) => this.notifyStreamProgress(context),
  });

  private readonly delivery = new StreamMessageDelivery({
    hasStopRequest: (channelId) => hasStopRequest(channelId),
    uiUpdater: this.uiUpdater,
  });

  private readonly segmentProcessor = new StreamSegmentProcessor({
    delivery: this.delivery,
    requestStop: (channelId, requesterId) => requestStop(channelId, requesterId),
  });

  private readonly bufferFlusher = new StreamBufferFlusher({
    hasStopRequest: (channelId) => hasStopRequest(channelId),
    delivery: this.delivery,
    segmentProcessor: this.segmentProcessor,
  });

  private readonly errorUi = new StreamErrorUi();

  public static requestStop(channelId: string, requesterId?: string, stopContext?: StreamStopContext): boolean {
    return requestStop(channelId, requesterId, stopContext);
  }

  public static hasStopRequest(channelId: string): boolean {
    return hasStopRequest(channelId);
  }

  public static clearStopRequest(channelId: string): void {
    clearStopRequest(channelId);
  }

  public static getAndClearStopContext(channelId: string): { originalStopMessage: Message; client: Client } | null {
    return getAndClearStopContext(channelId);
  }

  public static requestFollowUp(channelId: string, requesterId: string): boolean {
    return requestFollowUp(channelId, requesterId);
  }

  public static isFollowUpRequest(channelId: string): boolean {
    return isFollowUpRequest(channelId);
  }

  public static cleanupOldStopRequests(maxAgeMs?: number): void {
    cleanupOldStopRequests(maxAgeMs);
  }

  async streamToDiscord(provider: StreamProvider, config: StreamConfig, context: StreamContext): Promise<StreamResult> {
    log.section("Universal Stream Orchestrator Started");
    log.info(
      `Starting stream to channel ${context.channel.id} (server: ${"guild" in context.channel ? context.channel.guild.id : "DM"}) using provider: ${provider.getProviderInfo().name}`,
    );

    const result = await this.executeStream(provider, config, context);
    // An empty prefix at the held ceiling is not an empty reply: rescheduling would regenerate the
    // same oversized output.
    if (
      result.status === "completed" &&
      !result.pendingResponse?.truncation &&
      !result.pendingResponse?.text.trim() &&
      wasEmptyStreamResponse(result) &&
      !context.suppressTextOutput
    ) {
      log.info("Empty response detected. Returning empty_response status for retry at tomoriChat level.");
      return {
        ...result,
        status: "empty_response",
      };
    }

    return result;
  }

  private async executeStream(
    provider: StreamProvider,
    config: StreamConfig,
    context: StreamContext,
  ): Promise<StreamResult & { messageSentCount?: number }> {
    const metrics = createDefaultStreamMetrics();
    const state = createDefaultStreamState();
    const textConfig = createStreamTextProcessingConfig(config, context);
    const typingConfig = createTypingSimulationConfig(config.humanizerDegree);
    let terminalDoneMetadata: Record<string, unknown> | undefined;
    let lastError: Error | undefined;

    try {
      await this.segmentProcessor.prepareOutputPrefill(context, textConfig, state);

      const streamGenerator = provider.startStream(config, context);
      const preStreamStop = await this.tryResolvePreStreamStop(context);
      if (preStreamStop) {
        return preStreamStop;
      }

      for await (const rawChunk of streamGenerator) {
        const stopResult = await this.tryResolveLoopStop(state, config, context, textConfig, metrics);
        if (stopResult) {
          return stopResult;
        }

        if (context.abortSignal?.aborted) {
          log.warn(`Stream loop breaking due to external abort signal for channel ${context.channel.id}.`);
          return { status: "error", data: new Error("Stream aborted by SDK call timeout"), usage: state.usage };
        }

        this.notifyStreamProgress(context);
        metrics.totalChunks++;

        const processedChunk = provider.processChunk(rawChunk);
        appendChunkThoughts(state, processedChunk.thoughts);
        // Record the OpenRouter serving backend (first non-empty wins) for the thought log.
        if (processedChunk.servingProvider && !state.servingProvider) {
          state.servingProvider = processedChunk.servingProvider;
        }
        if (processedChunk.type === "done" && processedChunk.metadata) {
          terminalDoneMetadata = processedChunk.metadata;
        }
        // Capture real provider usage from whichever chunk carries it: not only
        // the terminal `done`. OpenAI `include_usage` emits usage on a separate
        // trailing chunk and Anthropic clobbers its done metadata, so relying on
        // terminalDoneMetadata alone would miss both. Latest non-null wins.
        if (processedChunk.metadata?.usage) {
          const normalizedUsage = normalizeProviderUsage(processedChunk.metadata.usage);
          if (normalizedUsage) {
            state.usage = normalizedUsage;
          }
        }

        const result = await this.handleProcessedChunk(
          processedChunk,
          provider,
          config,
          context,
          textConfig,
          typingConfig,
          state,
          metrics,
        );

        if (result.status !== "continue") {
          return result;
        }

        // Delivery-side stops (send/flush limit) are raised while this chunk was written out.
        // Resolving them here rather than on the next iteration avoids awaiting one more chunk
        // that the provider would keep generating tokens for.
        const deliveryStopResult = await this.tryResolveLoopStop(state, config, context, textConfig, metrics);
        if (deliveryStopResult) {
          return deliveryStopResult;
        }
      }

      return await this.completeStreamAfterProviderEnd(
        state,
        textConfig,
        typingConfig,
        context,
        metrics,
        terminalDoneMetadata,
      );
    } catch (error) {
      lastError = error as Error;
      clearStopRequest(context.channel.id);
      log.error(`Stream orchestrator failed: ${lastError.message}`, lastError, {
        serverId: context.tomoriState.server_id,
        errorType: "StreamOrchestrator",
        metadata: {
          channelId: context.channel.id,
          provider: provider.getProviderInfo().name,
        },
      });

      if (!context.suppressUserErrors && !isUserImpersonationStreamContext(context)) {
        await this.errorUi.handleStreamError(lastError, context);
      } else {
        log.warn("Stream: Suppressing stream error embed due to retryable failure", lastError);
      }

      return { status: "error", data: lastError, usage: state.usage };
    }
  }

  private async tryResolvePreStreamStop(context: StreamContext): Promise<StreamResult | null> {
    if (!hasStopRequest(context.channel.id)) {
      return null;
    }

    if (isFollowUpRequest(context.channel.id)) {
      log.info(
        `Follow-up interrupt detected before stream started for channel ${context.channel.id}. Returning immediately.`,
      );
      deleteStopRequest(context.channel.id);
      return { status: "follow_up_interrupt" };
    }

    log.info(`Kill request detected before stream started for channel ${context.channel.id}. Aborting stream.`);
    const preStreamStopRequest = peekStopRequest(context.channel.id);
    const preStreamStopReason = getStopReason(preStreamStopRequest);
    clearStopRequest(context.channel.id);
    return { status: "stopped_by_user", stopReason: preStreamStopReason };
  }

  private async tryResolveLoopStop(
    state: StreamState,
    config: StreamConfig,
    context: StreamContext,
    textConfig: TextProcessingConfig,
    metrics: StreamMetrics,
  ): Promise<StreamResult | null> {
    if (!hasStopRequest(context.channel.id)) {
      return null;
    }

    if (isFollowUpRequest(context.channel.id)) {
      log.info(`Stream interrupted by follow-up message for channel ${context.channel.id}. Skipping buffer flush.`);
      deleteStopRequest(context.channel.id);
      return { status: "follow_up_interrupt", usage: state.usage };
    }

    log.info(`Stream loop breaking due to stop request for channel ${context.channel.id}.`);
    const stopRequest = peekStopRequest(context.channel.id);
    const stopReason = getStopReason(stopRequest);
    // A stop raised by the delivery layer has no reason to flush at all, and flushing is not
    // harmless: the clear below runs first, so by the time the flush reaches the send path there is
    // no stop left to consult and the text goes to Discord as a real call. For a destination the
    // bot cannot post into that means a second rejected send and a re-registered stop that outlives
    // the stream. The two caps below already skip for the same reason.
    const shouldSkipBufferFlush =
      context.holdResponseText ||
      ((stopRequest?.requesterId === "flush_limit" ||
        stopRequest?.requesterId === "speaker_guard" ||
        stopRequest?.requesterId === "channel_deleted" ||
        stopRequest?.requesterId === "missing_access" ||
        stopRequest?.requesterId === "send_message_limit") &&
        !stopRequest?.stopContext);

    clearStopRequest(context.channel.id);
    if ((state.buffer.length > 0 || this.delivery.hasPendingAggregatedText(state)) && !shouldSkipBufferFlush) {
      await this.bufferFlusher.flushPendingBuffer(
        state,
        createStreamTextProcessingConfig(config, context),
        createTypingSimulationConfig(config.humanizerDegree),
        context,
      );
    } else if (
      stopRequest?.requesterId === "speaker_guard" &&
      this.delivery.hasPendingAggregatedText(state) &&
      textConfig.visibleDeliveryMode === VisibleDeliveryMode.AGGREGATED_PHASE
    ) {
      await this.delivery.flushAggregatedTextBuffer(textConfig, context, state);
    } else if (shouldSkipBufferFlush) {
      log.info("Stream: Skipping buffer flush due to internal no-flush stop");
    }

    if (isSilentSpeakerGuardStop(stopRequest?.requesterId, state)) {
      log.warn("Stream: Silent speaker-guard stop produced no user-visible output; treating as empty response.");
      return { status: "empty_response", data: { emptyResponseReason: "speaker_guard" }, usage: state.usage };
    }

    // A held speaker-guard or ceiling stop leaves a valid prefix for review, the same text ordinary
    // streaming would already have sent before stopping.
    const completesHeldPrefix =
      context.holdResponseText && (stopReason === "speaker_guard" || stopReason === "pending_response_limit");
    // Carry the same payload `completeStreamAfterProviderEnd` assembles. A stop is an early return
    // out of the loop, so without this the turn's delivered text, usage, thoughts and sprite records
    // never reach short-term memory, stat recording, or the thought log.
    return {
      status: completesHeldPrefix ? "completed" : "stopped_by_user",
      pendingResponse: completesHeldPrefix
        ? this.collectPendingResponse(state, textConfig, context, createTypingSimulationConfig(config.humanizerDegree))
        : undefined,
      stopReason,
      accumulatedText: state.accumulatedText,
      detailsContent: state.detailsSegments.length > 0 ? state.detailsSegments.join("\n\n") : undefined,
      thoughtLog: buildThoughtLogPayload(state, Date.now() - metrics.startTime),
      spritesShown: state.spritesShown.length > 0 ? [...state.spritesShown] : undefined,
      usage: state.usage,
    };
  }

  private async handleProcessedChunk(
    chunk: ProcessedChunk,
    provider: StreamProvider,
    config: StreamConfig,
    context: StreamContext,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    state: StreamState,
    metrics: StreamMetrics,
  ): Promise<StreamResult | { status: "continue" }> {
    switch (chunk.type) {
      case "error":
        return await this.handleChunkError(chunk, provider, context, textConfig, typingConfig, state);
      case "function_call":
        if (chunk.functionCall) {
          if (state.buffer.length > 0 || this.delivery.hasPendingAggregatedText(state)) {
            await this.bufferFlusher.flushPendingBuffer(state, textConfig, typingConfig, context, true);
            if (hasStopRequest(context.channel.id)) {
              const stopped = await this.tryResolveLoopStop(state, config, context, textConfig, metrics);
              if (stopped) return stopped;
            }
          }
          return {
            status: "function_call",
            data: chunk.functionCall,
            pendingResponse: this.collectPendingResponse(state, textConfig, context, typingConfig),
            accumulatedText: state.accumulatedText,
            detailsContent: state.detailsSegments.length > 0 ? state.detailsSegments.join("\n\n") : undefined,
            thoughtLog: buildThoughtLogPayload(state, Date.now() - metrics.startTime),
            spritesShown: state.spritesShown.length > 0 ? [...state.spritesShown] : undefined,
            usage: state.usage,
          };
        }
        break;
      case "text":
        if (chunk.content) {
          await this.bufferFlusher.processTextChunk(
            chunk.content,
            config,
            context,
            textConfig,
            typingConfig,
            state,
            metrics,
          );
        }
        break;
      case "done": {
        const terminalFinishReason =
          typeof chunk.metadata?.finishReason === "string" ? chunk.metadata.finishReason : null;
        if (terminalFinishReason === "length") {
          log.warn(
            `Stream ended with finish_reason=length (output token cap). messageSentCount=${state.messageSentCount}, bufferChars=${state.buffer.length}, accumulatedChars=${state.accumulatedText.length}`,
          );
        }
        break;
      }
    }

    return { status: "continue" };
  }

  private async handleChunkError(
    chunk: ProcessedChunk,
    provider: StreamProvider,
    context: StreamContext,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    state: StreamState,
  ): Promise<StreamResult | { status: "continue" }> {
    if (!chunk.error) {
      return { status: "continue" };
    }

    if (state.buffer.length > 0 || this.delivery.hasPendingAggregatedText(state)) {
      log.info(
        `Stream: Flushing ${state.buffer.length} chars of buffered text before error handling` +
          `${this.delivery.hasPendingAggregatedText(state) ? ` (queued aggregate: ${state.pendingAggregatedText.length})` : ""}`,
      );
      await this.bufferFlusher.flushPendingBuffer(state, textConfig, typingConfig, context);
      if (hasStopRequest(context.channel.id)) {
        return {
          status: "stopped_by_user",
          stopReason: getStopReason(peekStopRequest(context.channel.id)),
        };
      }
    }

    if (!context.suppressUserErrors && !isUserImpersonationStreamContext(context)) {
      await this.errorUi.handleProviderError(chunk.error, provider, context);
    } else {
      log.warn("Stream: Suppressing provider error embed due to retryable failure", chunk.error);
    }
    return { status: "error", data: chunk.error, usage: state.usage };
  }

  private async completeStreamAfterProviderEnd(
    state: StreamState,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
    metrics: StreamMetrics,
    terminalDoneMetadata: Record<string, unknown> | undefined,
  ): Promise<StreamResult & { messageSentCount?: number }> {
    await this.bufferFlusher.flushFinalBuffer(state, textConfig, typingConfig, context);
    // The final flush can itself trip a delivery cap, and this path returns "completed", which no
    // downstream consumer treats as a stop. An uncleared internal request would survive the turn
    // and abort the next stream at its pre-stream check. `clearStopRequest` preserves any request
    // carrying a stopContext, so a real user stop awaiting its follow-up is untouched.
    if (INTERNAL_STOP_REQUESTER_IDS.has(peekStopRequest(context.channel.id)?.requesterId ?? "")) {
      clearStopRequest(context.channel.id);
    }

    metrics.endTime = Date.now();
    log.success(
      `Stream to channel ${context.channel.id} completed. Messages sent: ${state.messageSentCount}, Duration: ${metrics.endTime - metrics.startTime}ms`,
    );

    return {
      status: "completed",
      pendingResponse: this.collectPendingResponse(state, textConfig, context, typingConfig),
      messageSentCount: state.messageSentCount,

      accumulatedText: state.accumulatedText,
      detailsContent: state.detailsSegments.length > 0 ? state.detailsSegments.join("\n\n") : undefined,
      thoughtLog: buildThoughtLogPayload(state, metrics.endTime - metrics.startTime),
      data: terminalDoneMetadata,
      spritesShown: state.spritesShown.length > 0 ? [...state.spritesShown] : undefined,
      usage: state.usage,
    };
  }

  private collectPendingResponse(
    collected: StreamState,
    textConfig: TextProcessingConfig,
    context: StreamContext,
    typingConfig: TypingSimulationConfig,
  ): StreamResult["pendingResponse"] {
    if (!context.holdResponseText) return undefined;
    const segments = collected.pendingResponseSegments ?? [];
    let consumed = false;
    return {
      text: collected.pendingResponseText ?? "",
      retainedBytes: collected.pendingResponseBytes ?? 0,
      segments: segments.length,
      truncation: collected.pendingResponseTruncation,
      deliver: async (abortSignal) => {
        if (consumed) return { status: "completed" };
        consumed = true;
        const state = createDefaultStreamState();
        const deliveryContext = { ...context, holdResponseText: false, abortSignal };
        await this.segmentProcessor.prepareOutputPrefill(deliveryContext, textConfig, state);
        for (const segment of segments) {
          if (abortSignal?.aborted || hasStopRequest(context.channel.id)) break;
          state.isInsideCodeBlock = segment.codeBlock;
          await this.segmentProcessor.sendBufferSegment(
            segment.text,
            segment.boundary,
            textConfig,
            typingConfig,
            deliveryContext,
            state,
          );
        }
        // The reviewed prefix remains deliverable when replay reaches the same foreign-speaker boundary.
        const replayStop = peekStopRequest(context.channel.id);
        if (replayStop?.requesterId === "speaker_guard" && !replayStop.stopContext)
          clearStopRequest(context.channel.id);
        if (!abortSignal?.aborted && !hasStopRequest(context.channel.id)) {
          await this.segmentProcessor.flushHeldOrphanPunctuation(
            "final",
            textConfig,
            typingConfig,
            deliveryContext,
            state,
          );
          if (textConfig.visibleDeliveryMode === VisibleDeliveryMode.AGGREGATED_PHASE) {
            await this.delivery.flushAggregatedTextBuffer(textConfig, deliveryContext, state);
          }
        }
        const stop = peekStopRequest(context.channel.id);
        const status = abortSignal?.aborted || stop ? "stopped_by_user" : "completed";
        const stopReason = stop ? getStopReason(stop) : undefined;
        if (stop && INTERNAL_STOP_REQUESTER_IDS.has(stop.requesterId)) clearStopRequest(context.channel.id);
        return {
          status,
          stopReason,
          accumulatedText: state.accumulatedText,
          spritesShown: state.spritesShown.length ? state.spritesShown : undefined,
        };
      },
    };
  }

  private notifyStreamProgress(context: StreamContext): void {
    context.onStreamProgress?.();
  }
}
