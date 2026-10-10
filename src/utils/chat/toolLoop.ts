import { expandDeliberateToolAllowedNames } from "@/utils/tools/deliberateToolMode";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import {
  MAX_RESPONSE_REVISIONS,
  MAX_TOOL_REVIEWS,
  MAX_TOOL_CORRECTIONS,
  reviewResponseCandidate,
  recordResponseReviewUsage,
  remainingPendingResponseLimit,
  reviewToolCandidate,
  toolRequestIdentity,
  responseReviewCancelled,
  responseRevisionInstruction,
} from "@/utils/chat/responseReview";
import { charsToTokensText, estimateContextItemsTokens } from "@/utils/text/tokenEstimate";
import type { LLMProvider, ProviderConfig, StreamResult } from "@/types/provider/interfaces";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { ToolRegistry } from "@/tools/toolRegistry";
import { statRepository } from "@/utils/db/repositories";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { routeHiddenToolNotice } from "@/utils/discord/toolProgressNotice";
import { ColorCode, log } from "@/utils/misc/logger";
import { providerUsesApiFamily } from "@/utils/provider/providerInfoRegistry";
import {
  channelLocks,
  getChannelTurnAbortSignal,
  incrementChannelFollowUpCount,
  queueStopResponseAtFront,
  resetChannelFollowUpCount,
  setChannelActiveToolName,
  setChannelStreamKill,
  setChannelToolCallChainActive,
  runUnderWatchdog,
  touchChannelLock,
} from "@/utils/chat/channelQueue";
import {
  annotateRecentMessageMetadataInContext,
  buildRevealedMessageMetadataTailDirective,
  buildTailDirectiveMessage,
} from "@/utils/chat/contextAnnotations";
import { answersQueuedTriggerMessage } from "@/utils/chat/contextDirectives";
import { takeEnhancedContextItem } from "@/utils/chat/pendingEnhancedContext";
import { foldPrefillIntoToolHistory } from "@/utils/chat/assistantPrefill";
import { buildExpressionToolResult, deliverExpression } from "@/utils/chat/expressionDelivery";
import { recordChatDiagnostic, runWithChatDiagnosticStage } from "@/utils/chat/diagnosticTimeline";
import { parseIntegerEnvFlag } from "@/utils/misc/envFlags";
import type { ChatTurnContext, GenerationTurnResult, ToolHistoryEntry } from "@/utils/chat/types";
import { DISCORD_STREAMING_CONSTANTS } from "@/types/stream/types";
import { neutralizeFenceRuns } from "@/utils/text/discordTextLimits";
import { redactToolParametersForStorage } from "@/utils/tools/toolParameterRedaction";

/** Hard ceiling on provider round trips in one turn; the loop exits with `buildResult("timeout")`. */
export const MAX_FUNCTION_CALL_ITERATIONS = 100;
const SOFT_WARN_ITERATION_THRESHOLD = 20;
/** Consecutive tool failures before the loop gives up and surfaces a tool-error embed. */
export const MAX_CONSECUTIVE_TOOL_ERRORS = 5;
/** NovelAI failures after visible pre-tool text before the retry-exhausted embed ends the turn. */
export const NAI_TOOL_FAILURE_RETRY_THRESHOLD = 3;
const STREAM_SDK_CALL_TIMEOUT_MS = parseIntegerEnvFlag(process.env.STREAM_SDK_CALL_TIMEOUT_MS, 120000, 10000);
const STREAM_FIRST_TOKEN_TIMEOUT_MS = Math.max(
  STREAM_SDK_CALL_TIMEOUT_MS,
  DISCORD_STREAMING_CONSTANTS.FIRST_TOKEN_TIMEOUT_MS,
);
// After the SDK-call watchdog aborts a stalled stream, how long to wait for the abandoned
// `streamToDiscord` promise to actually settle before returning. `Promise.race` does not cancel the
// loser and `abort()` only tears down the HTTP request, so a Discord send it already dispatched can
// still be in flight; waiting for it guarantees that send is recorded in `deliveredMessageRefs`
// before the fallback path's superseded-message cleanup runs, so it cannot leak past cleanup.
const STREAM_ABANDONED_SETTLE_TIMEOUT_MS = 5000;
const TOOL_EXECUTION_TIMEOUT_MS = parseIntegerEnvFlag(process.env.TOOL_EXECUTION_TIMEOUT_MS, 300000, 10000);
const TOOLS_SUPPRESS_FOLLOWUP_AFTER_PRETOOL_TEXT = new Set(["update_short_term_memory"]);
const TOOL_FAILURE_NOTICE_LIMIT = 1800;
/**
 * Fed back to the model when a provider cut a tool call's arguments short. It names the
 * cause and the outcome so the retry is a fresh attempt rather than a repeat of the same
 * call, and so the model does not assume the update landed.
 */
const TOOL_ARGUMENTS_TRUNCATED_REASON =
  "The provider truncated this tool call's arguments mid-payload, so the call was not executed and nothing was updated. Reissue the call with the complete arguments in one message.";

export interface ToolLoopParams {
  context: ChatTurnContext;
  provider: LLMProvider;
  providerConfig: ProviderConfig;
  tomoriState: ChatTurnContext["tomoriState"];
}

export function providerIsApiFamily(
  providerName: string,
  apiFamily: Parameters<typeof providerUsesApiFamily>[1],
): boolean {
  return providerUsesApiFamily(providerName, apiFamily);
}

export async function runToolLoop(params: ToolLoopParams): Promise<GenerationTurnResult> {
  const streamResults: StreamResult[] = [];
  const review = params.context.responseReview;
  const functionHistory: ToolHistoryEntry[] = review?.functionHistory ?? [];
  const accumulatedModelParts: Array<Record<string, unknown>> = [];
  let finalText = "";
  let detailsText = "";
  let consecutiveToolErrors = 0;
  let naiConsecutiveToolFailures = 0;
  let thoughtLog: GenerationTurnResult["thoughtLog"];
  // An expression an earlier attempt of this turn delivered is still visible, so it still counts.
  let toolResponseDelivered = params.context.expressionDelivery.delivered !== null;
  let lastToolName: string | undefined;

  const completeResponse = async (): Promise<GenerationTurnResult | null> => {
    // The send limit is deliberate operator config and stays silent, as it does when streaming.
    const cutByLengthLimit = review?.pending.some(
      (part) => part.truncation === "flush_limit" || part.truncation === "retention_limit",
    );
    if (!review?.pending.some((part) => part.text.trim())) {
      if (cutByLengthLimit) await emitHeldResponseLimitNotice(params.context);
      return buildResult(
        "completed",
        params.context,
        streamResults,
        finalText,
        detailsText,
        thoughtLog,
        toolResponseDelivered,
      );
    }
    const verdict = await reviewResponseCandidate(params.context, params.provider, params.providerConfig);
    if (verdict.status === "cancelled" || responseReviewCancelled(params.context)) {
      review.pending = [];
      const followUp = StreamOrchestrator.isFollowUpRequest(params.context.channel.id);
      if (followUp) incrementChannelFollowUpCount(params.context.channel.id);
      queueStopResponseIfPresent(params.context);
      return buildResult(
        followUp ? "follow_up_interrupt" : "stopped_by_user",
        params.context,
        streamResults,
        "",
        "",
        thoughtLog,
        toolResponseDelivered,
      );
    }
    if (verdict.status === "revise" && review.revisions < MAX_RESPONSE_REVISIONS) {
      review.feedback = verdict;
      review.revisionDraft = review.pending.map((part) => part.text).join("\n");
      review.revisions++;
      review.pending = [];
      accumulatedModelParts.length = 0;
      detailsText = "";
      return null;
    }
    if (verdict.status === "revise")
      log.info(
        `Response review exhausted ${JSON.stringify({ reviews: review.responseReviews, revisions: review.revisions })}`,
      );
    const delivered: string[] = [];
    let deliveryStatus: GenerationTurnResult["status"] | undefined;
    let replayStopReason: StreamResult["stopReason"];
    for (const pending of review.pending) {
      if (responseReviewCancelled(params.context)) break;
      const presentation = await pending.deliver(getChannelTurnAbortSignal(params.context.channel.id));
      streamResults.push(presentation);
      if (presentation.accumulatedText) delivered.push(presentation.accumulatedText);
      if (presentation.status !== "completed") {
        deliveryStatus = presentation.status;
        replayStopReason = presentation.stopReason;
        break;
      }
    }
    review.pending = [];
    if (responseReviewCancelled(params.context)) {
      const followUp = StreamOrchestrator.isFollowUpRequest(params.context.channel.id);
      deliveryStatus = followUp ? "follow_up_interrupt" : "stopped_by_user";
      if (followUp) incrementChannelFollowUpCount(params.context.channel.id);
      queueStopResponseIfPresent(params.context);
    } else if (cutByLengthLimit && replayStopReason !== "flush_limit") {
      // A replay that reaches the flush cap already posted this notice through ordinary delivery.
      await emitHeldResponseLimitNotice(params.context);
    }
    finalText = delivered.join("\n");
    return buildResult(
      deliveryStatus ??
        (responseReviewCancelled(params.context)
          ? "stopped_by_user"
          : finalText.trim()
            ? "completed"
            : "empty_response"),
      params.context,
      streamResults,
      finalText,
      finalText.trim() ? detailsText : "",
      thoughtLog,
      toolResponseDelivered,
    );
  };

  for (let iteration = 0; iteration < MAX_FUNCTION_CALL_ITERATIONS; iteration++) {
    if (iteration > 0) {
      recordChatDiagnostic({
        kind: "tool_continuation",
        iteration: iteration + 1,
        historyEntries: functionHistory.length,
        contextItems: params.context.contextItems.length,
      });
    }
    if (iteration === SOFT_WARN_ITERATION_THRESHOLD && params.context.shouldSurfaceUserErrors) {
      await sendStandardEmbed(
        params.context.channel as Parameters<typeof sendStandardEmbed>[0],
        params.context.locale,
        {
          color: ColorCode.WARN,
          titleKey: "genai.still_working_title",
          descriptionKey: "genai.still_working_description",
        },
      );
    }

    const streamResult = await runWithChatDiagnosticStage({ toolIteration: iteration + 1 }, () =>
      streamOnce(params, accumulatedModelParts, functionHistory),
    );
    streamResults.push(streamResult);
    if (review) {
      // Stopping at the held ceiling ends the stream before providers send trailing usage. Ordinary
      // turns fall back to the same estimates, so the cut pass is not recorded as free.
      const usage =
        streamResult.usage ??
        (streamResult.pendingResponse?.truncation
          ? {
              inputTokens: estimateContextItemsTokens(params.context.contextItems),
              outputTokens: charsToTokensText(streamResult.pendingResponse.text.length),
            }
          : undefined);
      if (usage)
        recordResponseReviewUsage(review, { kind: "author", model: params.tomoriState.llm.llm_codename, usage });
      if (streamResult.pendingResponse) review.pending.push(streamResult.pendingResponse);
    }
    thoughtLog = streamResult.thoughtLog ?? thoughtLog;

    switch (streamResult.status) {
      case "completed":
        resetChannelFollowUpCount(params.context.channel.id);
        finalText = streamResult.accumulatedText ?? finalText;
        detailsText = mergeDetails(detailsText, streamResult.detailsContent);
        {
          const completed = await completeResponse();
          if (completed) return completed;
          continue;
        }
      case "error":
      case "timeout":
        resetChannelFollowUpCount(params.context.channel.id);
        return buildResult(
          streamResult.status,
          params.context,
          streamResults,
          finalText,
          detailsText,
          thoughtLog,
          toolResponseDelivered,
        );
      case "empty_response": {
        if (review?.pending.some((part) => part.text.trim())) {
          const completed = await completeResponse();
          if (completed) return completed;
          continue;
        }
        // The turn-level retry regenerates the whole reply, so after delivered text it posts a second
        // reply under the first. It is skipped only when the empty follow-up is the model having
        // nothing to add; a lookup result still waiting to be presented, or a failure the retry
        // handles specifically, keeps it.
        const deliveredText = streamResults.findLast((result) => result.accumulatedText?.trim())?.accumulatedText;
        if (
          (deliveredText || toolResponseDelivered) &&
          (await isSettledAfterTool(params, streamResult, lastToolName))
        ) {
          resetChannelFollowUpCount(params.context.channel.id);
          return buildResult(
            "completed",
            params.context,
            streamResults,
            deliveredText ?? finalText,
            detailsText,
            thoughtLog,
            toolResponseDelivered,
          );
        }
        return buildResult(
          "empty_response",
          params.context,
          streamResults,
          finalText,
          detailsText,
          thoughtLog,
          toolResponseDelivered,
        );
      }
      case "stopped_by_user":
        queueStopResponseIfPresent(params.context);
        resetChannelFollowUpCount(params.context.channel.id);
        // Text already delivered before the stop still has to reach short-term memory, or Tomori
        // forgets what it just said in the channel whenever a turn is cut short.
        finalText = streamResult.accumulatedText ?? finalText;
        detailsText = mergeDetails(detailsText, streamResult.detailsContent);
        return buildResult(
          "stopped_by_user",
          params.context,
          streamResults,
          finalText,
          detailsText,
          thoughtLog,
          toolResponseDelivered,
        );
      case "follow_up_interrupt":
        incrementChannelFollowUpCount(params.context.channel.id);
        return buildResult(
          "follow_up_interrupt",
          params.context,
          streamResults,
          finalText,
          detailsText,
          thoughtLog,
          toolResponseDelivered,
        );
      case "function_call": {
        detailsText = mergeDetails(detailsText, streamResult.detailsContent);
        setChannelToolCallChainActive(channelLocks.get(params.context.turn.lockedTurn.channelId), true);
        const toolOutcome = await executeToolCall(params, streamResult, iteration);
        recordChatDiagnostic({
          kind: "tool_outcome",
          outcome: toolOutcome.kind,
          ...(toolOutcome.kind === "history"
            ? { success: toolOutcome.success, reviewStatus: toolOutcome.reviewStatus }
            : {}),
        });
        if (toolOutcome.kind === "restart") {
          consecutiveToolErrors = 0;
          naiConsecutiveToolFailures = 0;
          continue;
        }
        if (toolOutcome.kind === "abort") {
          if (review) review.pending = [];
          if (toolOutcome.status === "follow_up_interrupt") incrementChannelFollowUpCount(params.context.channel.id);
          if (toolOutcome.status === "stopped_by_user") {
            // A /kill that exits here was never consumed by the stream's own stop check, and an
            // unconsumed request aborts the channel's next turn at its pre-stream check.
            queueStopResponseIfPresent(params.context);
            resetChannelFollowUpCount(params.context.channel.id);
          }
          return buildResult(
            toolOutcome.status,
            params.context,
            streamResults,
            finalText,
            detailsText,
            thoughtLog,
            toolResponseDelivered,
          );
        }

        functionHistory.push(toolOutcome.historyEntry);
        lastToolName = toolOutcome.functionName;
        toolResponseDelivered ||= toolOutcome.responseDelivered;
        // Visible text emitted before the tool call now lives on that history
        // entry's assistant tool-call turn. Remove the same buffered parts from
        // the trailing prefill so providers do not receive it a second time.
        accumulatedModelParts.length = 0;
        if (toolOutcome.success) {
          consecutiveToolErrors = 0;
          naiConsecutiveToolFailures = 0;
        } else if (toolOutcome.reviewStatus !== "rejected") {
          consecutiveToolErrors += 1;
          if (consecutiveToolErrors >= MAX_CONSECUTIVE_TOOL_ERRORS) {
            await emitToolErrorLoop(params.context);
            return buildResult(
              "error",
              params.context,
              streamResults,
              finalText,
              detailsText,
              thoughtLog,
              toolResponseDelivered,
            );
          }
        }

        if (toolOutcome.endTurn) {
          if (review) {
            const completed = await completeResponse();
            if (completed) return completed;
            continue;
          }
          return buildResult(
            "completed",
            params.context,
            streamResults,
            streamResult.accumulatedText ?? finalText,
            detailsText,
            thoughtLog,
            toolResponseDelivered,
          );
        }

        const hasPreToolText = (streamResult.accumulatedText ?? "").trim().length > 0;
        const providerName = params.provider.getInfo().name;
        if (
          !toolOutcome.success &&
          toolOutcome.reviewStatus !== "rejected" &&
          hasPreToolText &&
          providerIsApiFamily(providerName, "novelai")
        ) {
          naiConsecutiveToolFailures += 1;
          if (naiConsecutiveToolFailures >= NAI_TOOL_FAILURE_RETRY_THRESHOLD) {
            log.warn(
              `NovelAI GLM: Tool "${toolOutcome.functionName}" failed ${naiConsecutiveToolFailures} consecutive times after text was sent — showing error embed and ending turn`,
            );
            await emitNaiToolRetryExhausted(params.context);
            return buildResult(
              "completed",
              params.context,
              streamResults,
              streamResult.accumulatedText ?? finalText,
              detailsText,
              thoughtLog,
              toolResponseDelivered,
            );
          }

          params.context.streamingContext.suppressTextOutput = true;
          log.info(
            `NovelAI GLM: Tool "${toolOutcome.functionName}" failed (attempt ${naiConsecutiveToolFailures}/${NAI_TOOL_FAILURE_RETRY_THRESHOLD}) — suppressing text output for retry`,
          );
          continue;
        }

        if (
          toolOutcome.success &&
          (await shouldEndAfterPreToolText(
            params.provider,
            streamResult,
            toolOutcome.functionName,
            params.tomoriState.server_id,
          ))
        ) {
          if (review) {
            const completed = await completeResponse();
            if (completed) return completed;
            continue;
          }
          return buildResult(
            "completed",
            params.context,
            streamResults,
            streamResult.accumulatedText ?? finalText,
            detailsText,
            thoughtLog,
            toolResponseDelivered,
          );
        }

        if (toolOutcome.success && hasPreToolText && providerIsApiFamily(providerName, "novelai")) {
          params.context.streamingContext.suppressTextOutput = false;
        }
        break;
      }
      default: {
        const exhaustive: never = streamResult.status;
        throw new Error(`Unhandled stream status: ${String(exhaustive)}`);
      }
    }
  }

  if (params.context.shouldSurfaceUserErrors) {
    await sendStandardEmbed(params.context.channel as Parameters<typeof sendStandardEmbed>[0], params.context.locale, {
      color: ColorCode.WARN,
      titleKey: "genai.max_iterations_title",
      descriptionKey: "genai.max_iterations_streaming_description",
      tipKeys: ["genai.tips.refresh_context"],
    });
  }
  return buildResult(
    "timeout",
    params.context,
    streamResults,
    finalText,
    detailsText,
    thoughtLog,
    toolResponseDelivered,
  );
}

/**
 * Sends the SDK-call timeout notice for an attempt.
 *
 * Usually sent while the attempt is still running. It is exported because a suppressed attempt
 * defers it, and the generation-turn loop is the only caller that knows whether the model fallback
 * it was suppressed for ever materialized.
 */
export async function sendStreamTimeoutNotice(params: {
  channel: Parameters<typeof sendStandardEmbed>[0];
  locale: string;
  providerName: string;
  textCredentialSource: "server" | "personal" | undefined;
  sawStreamProgress: boolean;
}): Promise<void> {
  await sendStandardEmbed(params.channel, params.locale, {
    titleKey: "genai.stream.inactivity_timeout_title",
    descriptionKey: params.sawStreamProgress
      ? "genai.stream.inactivity_timeout_description"
      : "genai.stream.first_token_timeout_description",
    color: ColorCode.WARN,
    tipKeys:
      params.providerName === "nvidia"
        ? [
            params.textCredentialSource === "personal"
              ? "genai.tips.nvidia_register_free_model_personal"
              : "genai.tips.nvidia_register_free_model",
          ]
        : undefined,
  }).catch((embedError) => {
    log.warn(
      "Failed to send SDK call timeout embed",
      embedError instanceof Error ? embedError : new Error(String(embedError)),
    );
  });
}

async function streamOnce(
  params: ToolLoopParams,
  accumulatedModelParts: Array<Record<string, unknown>>,
  functionHistory: ToolHistoryEntry[],
): Promise<StreamResult> {
  const channelId = params.context.channel.id;
  const abortController = new AbortController();
  params.context.streamingContext.abortSignal = abortController.signal;
  // A notice held by an earlier attempt describes that attempt, not this one.
  params.context.streamingContext.deferredTimeoutNotice = undefined;
  params.context.streamingContext.pendingResponseLimit = params.context.responseReview
    ? remainingPendingResponseLimit(params.context.responseReview)
    : undefined;
  let timeoutId: NodeJS.Timeout | null = null;

  // Unified kill: aborts the HTTP request AND rejects the Promise.race.
  // Stored on the lock entry so /kill and stale-lock release can trigger it externally.
  let killStream: ((reason: Error) => void) | null = null;

  const armTimeout = (budgetMs: number) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      killStream?.(new Error("SDK_CALL_TIMEOUT: provider streamToDiscord call timed out."));
    }, budgetMs);
    touchChannelLock(channelId);
  };
  let sawStreamProgress = false;
  params.context.streamingContext.onStreamProgress = () => {
    sawStreamProgress = true;
    armTimeout(STREAM_SDK_CALL_TIMEOUT_MS);
  };
  armTimeout(STREAM_FIRST_TOKEN_TIMEOUT_MS);

  const replyToMessage = answersQueuedTriggerMessage(params.context.turn.lockedTurn.admission.incoming)
    ? params.context.message
    : undefined;

  // Keep a handle to the provider call so the timeout branch can await it settling. Under
  // Promise.race the loser is otherwise abandoned (never awaited); its rejection is still observed
  // by race's internal handlers, so holding this reference does not create an unhandled rejection.
  const correction = params.context.responseReview && responseRevisionInstruction(params.context.responseReview);
  const pendingNarration =
    params.context.responseReview && functionHistory.some((entry) => entry.preToolCallTextParts?.length)
      ? {
          role: "user" as const,
          parts: [
            {
              type: "text" as const,
              text: "Assistant narration in tool history is pending and has not reached the user. Continue without repeating it.",
            },
          ],
        }
      : undefined;
  const request = foldPrefillIntoToolHistory(
    pendingNarration || correction
      ? [
          ...params.context.contextItems,
          ...(pendingNarration ? [pendingNarration] : []),
          ...(correction ? [correction] : []),
        ]
      : params.context.contextItems,
    params.context.streamingContext.outputPrefill,
    functionHistory,
  );
  const streamPromise = params.provider.streamToDiscord(
    params.context.channel as Parameters<LLMProvider["streamToDiscord"]>[0],
    params.context.client,
    params.tomoriState,
    params.providerConfig,
    request.contextItems,
    accumulatedModelParts,
    params.context.emojiStrings,
    request.functionHistory.length > 0 ? request.functionHistory : undefined,
    undefined,
    replyToMessage,
    params.context.streamingContext,
    params.context.locale,
    params.context.responseTarget?.webhook,
    params.context.responseTarget?.personaAvatarUrl,
    params.context.responseTarget?.personaUsername,
    params.context.responseTarget?.prefixStrippingName,
  );

  try {
    const result = await runUnderWatchdog(channelId, () =>
      Promise.race([
        streamPromise,
        new Promise<never>((_, reject) => {
          killStream = (reason: Error) => {
            abortController.abort();
            reject(reason);
          };
          setChannelStreamKill(channelId, killStream);
        }),
      ]),
    );
    // Leaving the chunk loop closes the provider generator, but an adapter that does not cancel its
    // reader on early return would keep the request generating text nobody can deliver.
    if (result.stopReason === "pending_response_limit") abortController.abort();
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("SDK_CALL_TIMEOUT:")) {
      // A pending stop request (e.g. /kill) makes this a terminal stop; no fallback runs, so
      // no superseded-message cleanup will consume in-flight sends. Return immediately; settling
      // here would just make the kill wait out the abandoned stream for no benefit.
      if (StreamOrchestrator.hasStopRequest(channelId)) {
        const settled = params.context.responseReview ? await settleAbandonedStream(streamPromise) : undefined;
        return { status: "stopped_by_user", usage: settled?.usage };
      }

      const providerName = params.tomoriState.llm.llm_provider;
      const phase = sawStreamProgress ? "idle" : "first_token";
      log.metric("stream_sdk_timeout", { provider: providerName, phase });
      log.warn(
        `Stream SDK call timed out (${providerName}, ${phase}): ${error.message.slice("SDK_CALL_TIMEOUT:".length).trim()}`,
      );

      // Genuine timeout → the fallback path may run. The stream was aborted, not cancelled: wait
      // (bounded) for it to actually settle so any Discord send it had already dispatched is recorded
      // in `deliveredMessageRefs` BEFORE the fallback path's superseded-message cleanup runs. Without
      // this, a late straggler would land after cleanup and be misattributed to the surviving
      // fallback attempt; leaving the exact orphaned partial message this feature exists to remove.
      const settled = await settleAbandonedStream(streamPromise);

      if (!params.context.streamingContext.suppressUserErrors) {
        await sendStreamTimeoutNotice({
          channel: params.context.channel as Parameters<typeof sendStandardEmbed>[0],
          locale: params.context.locale,
          providerName,
          textCredentialSource: params.context.streamingContext.textCredentialSource,
          sawStreamProgress,
        });
      } else {
        // The notice is held for the caller: this attempt was suppressed because a later model may
        // still answer, and only the caller knows whether one did.
        params.context.streamingContext.deferredTimeoutNotice = { providerName, sawStreamProgress };
      }
      return { status: "timeout", data: error, usage: settled?.usage };
    }
    if (params.context.responseReview && StreamOrchestrator.hasStopRequest(channelId)) {
      const settled = await settleAbandonedStream(streamPromise);
      return { status: "stopped_by_user", usage: settled?.usage };
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    params.context.streamingContext.onStreamProgress = undefined;
    setChannelStreamKill(channelId, null);
  }
}

/**
 * Waits for an aborted-but-abandoned `streamToDiscord` promise to settle, bounded by
 * {@link STREAM_ABANDONED_SETTLE_TIMEOUT_MS} so a genuinely hung send cannot block the fallback path
 * indefinitely. After `abortController.abort()` the provider generator throws promptly, so in the
 * common (stalled-provider) case this resolves almost immediately; the wait only matters when a
 * Discord send was mid-flight when the watchdog fired, and it exists solely so that send is recorded
 * before the caller proceeds. Reported usage survives a timed-out or cancelled attempt.
 */
async function settleAbandonedStream(streamPromise: Promise<StreamResult>): Promise<StreamResult | undefined> {
  if (STREAM_ABANDONED_SETTLE_TIMEOUT_MS <= 0) {
    return;
  }
  let guardTimer: ReturnType<typeof setTimeout> | null = null;
  const settleGuard = new Promise<undefined>((resolve) => {
    guardTimer = setTimeout(() => resolve(undefined), STREAM_ABANDONED_SETTLE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      streamPromise.then(
        (result) => result,
        () => undefined,
      ),
      settleGuard,
    ]);
  } finally {
    if (guardTimer) clearTimeout(guardTimer);
  }
}

async function executeToolCall(
  params: ToolLoopParams,
  streamResult: StreamResult,
  iteration: number,
): Promise<
  | { kind: "restart" }
  | { kind: "abort"; status: GenerationTurnResult["status"] }
  | {
      kind: "history";
      functionName: string;
      success: boolean;
      reviewStatus?: "rejected" | "reused";
      endTurn: boolean;
      responseDelivered: boolean;
      historyEntry: ToolHistoryEntry;
    }
> {
  if (!streamResult.data || typeof streamResult.data !== "object" || !("name" in streamResult.data)) {
    log.error("Function call status received without function-call data", streamResult);
    return { kind: "abort", status: "error" };
  }

  const rawCall = streamResult.data as ToolHistoryEntry["functionCall"];
  const functionCall = params.context.responseReview ? structuredClone(rawCall) : rawCall;
  let functionName = functionCall.name?.trim() ?? "";
  if (!functionName) {
    return { kind: "abort", status: "error" };
  }

  const cancelReviewedCall = () => {
    if (params.context.responseReview) params.context.responseReview.pending = [];
    return {
      kind: "abort" as const,
      status: StreamOrchestrator.isFollowUpRequest(params.context.channel.id)
        ? ("follow_up_interrupt" as const)
        : ("stopped_by_user" as const),
    };
  };
  if (params.context.responseReview && responseReviewCancelled(params.context)) return cancelReviewedCall();
  if (shouldAbortToolCallForStopRequest(params.context.channel.id)) {
    return { kind: "abort", status: "stopped_by_user" };
  }

  const turnAbortSignal = getChannelTurnAbortSignal(params.context.channel.id);
  const toolContext: ToolContext = {
    channel: params.context.channel as ToolContext["channel"],
    client: params.context.client,
    message: params.context.message,
    userId: params.context.userDiscId,
    internalUserId: params.context.personalRoutingUserId ?? undefined,
    guildId: params.context.guild?.id,
    tomoriState: params.tomoriState,
    locale: params.context.locale,
    provider: params.provider.getInfo().name,
    streamContext: params.context.streamingContext,
    webhook: params.context.responseTarget?.webhook,
    personaUsername: params.context.responseTarget?.personaUsername,
    personaAvatarUrl: params.context.responseTarget?.personaAvatarUrl,
    activePersonaId: params.context.currentPersona.persona_id ?? undefined,
    isUserImpersonation: params.context.isUserImpersonation,
    impersonatedUserId: params.context.impersonatedUserId,
    suppressProgressNotices: !params.context.shouldSurfaceUserErrors || undefined,
    contextItems: params.context.contextItems,
    messageIdMap: params.context.messageIdMap,
    showKillHint: iteration >= SOFT_WARN_ITERATION_THRESHOLD,
    abortSignal: turnAbortSignal,
    isExecutionCancelled: params.context.responseReview ? () => responseReviewCancelled(params.context) : undefined,
  };

  // Deliberate-tool-mode allowlist enforcement. When mode is active and
  // the model attempts a tool that wasn't exposed for this turn, short-circuit
  // with a synthetic failure response (visible to the model) so it can adapt.
  const families: Record<string, string> = {};
  const requestedNames = params.context.streamingContext.deliberateToolAllowedNames;
  if (
    params.context.deliberateToolModeActive &&
    requestedNames?.some((name) => name === "fetch_url" || name === "web_search") &&
    params.tomoriState.server_id
  ) {
    try {
      const { routes } = await getGuildMcpManager().getGuildMCPRouting(params.tomoriState.server_id);
      for (const [name, route] of routes) families[name] = route.config.server_type ?? "general";
    } catch {
      // Execution refuses unreadable registrations; an unavailable service grants no extra intent.
    }
  }
  const allowedNames = expandDeliberateToolAllowedNames(requestedNames, families);
  const deliberateAllowedSet = allowedNames?.length ? new Set(allowedNames) : null;
  const isBlockedByDeliberateAllowlist =
    params.context.deliberateToolModeActive && deliberateAllowedSet !== null && !deliberateAllowedSet.has(functionName);

  // A truncated argument payload recovered by the adapter holds only the keys that arrived
  // whole. Dispatching with that subset is worse than not dispatching at all: a tool whose
  // arguments replace stored state (a category map, for instance) would write the surviving
  // keys and silently drop the rest. No tool's semantics survive a partial call, so the
  // model gets a synthetic failure instead and can retry with a complete one.
  if (functionCall.argumentsTruncated) {
    // `log.error` rather than `log.warn`, which is filtered out whenever RUN_ENV=production,
    // the only environment this truncation happens in. The error sink is also how the
    // incident that prompted this path was found.
    await log.error(
      `Tool call "${functionName}" was not dispatched: the provider truncated its argument payload`,
      undefined,
      {
        serverId: params.tomoriState.server_id,
        errorType: "TOOL_ARGUMENTS_TRUNCATED",
        metadata: {
          channelId: params.context.channel.id,
          recoveredKeys: Object.keys(functionCall.args ?? {}).length,
        },
      },
    );
    // The recovered subset is not a meaningful call, so it is dropped from the replayed
    // assistant turn rather than shown to the model as the arguments it produced.
    functionCall.args = undefined;
    const refusal: ToolResult = { success: false, error: TOOL_ARGUMENTS_TRUNCATED_REASON };
    // The ordinary failure path emits this notice, and a refusal that returns before it
    // would otherwise leave the truncation invisible in the thought log.
    await emitFailedToolCallThoughtLog(toolContext, functionName, {}, refusal);
    return {
      kind: "history",
      functionName,
      success: false,
      endTurn: false,
      responseDelivered: false,
      historyEntry: {
        functionCall,
        functionResponse: {
          functionResponse: {
            name: functionName,
            response: {
              result: {
                status: "tool_execution_failed",
                tool_name: functionName,
                reason: TOOL_ARGUMENTS_TRUNCATED_REASON,
              },
            },
          },
        },
        preToolCallTextParts: buildPreToolCallTextParts(streamResult),
      },
    };
  }

  let executionArgs = functionCall.args ?? {};
  let requestIdentity: string | undefined;
  const review = params.context.responseReview;
  if (review && !isBlockedByDeliberateAllowlist) {
    const prepared = await runUnderWatchdog(params.context.channel.id, () =>
      ToolRegistry.prepareToolRequest(functionName, executionArgs, toolContext),
    );
    if (responseReviewCancelled(params.context)) return cancelReviewedCall();
    functionName = prepared.name;
    executionArgs = prepared.args;
    toolContext.preparedToolRequest = prepared;
    requestIdentity = toolRequestIdentity(prepared);
    const completed = review.successfulTools.get(requestIdentity);
    if (completed)
      return {
        kind: "history",
        functionName,
        success: true,
        reviewStatus: "reused",
        endTurn: false,
        responseDelivered: false,
        historyEntry: {
          ...completed,
          functionCall,
          functionResponse: {
            functionResponse: {
              ...(completed.functionResponse.functionResponse as Record<string, unknown>),
              name: functionCall.name,
            },
          },
          preToolCallTextParts: buildPreToolCallTextParts(streamResult),
        },
      };
    const tool = ToolRegistry.getTool(functionName);
    const available =
      !tool ||
      ToolRegistry.getAvailableTools(toolContext.provider, toolContext).some((entry) => entry.name === functionName);
    if (available) {
      const verdict = await reviewToolCandidate(params.context, params.provider, params.providerConfig, prepared);
      if (verdict.status === "cancelled" || responseReviewCancelled(params.context)) return cancelReviewedCall();
      if (verdict.status === "revise") {
        const correctionAllowed =
          !review.unavailable &&
          review.toolReviews < MAX_TOOL_REVIEWS &&
          review.toolCorrections < MAX_TOOL_CORRECTIONS &&
          !review.rejectedChains.get(functionName)?.retried;
        return {
          kind: "history",
          functionName,
          success: false,
          reviewStatus: "rejected",
          endTurn: false,
          responseDelivered: false,
          historyEntry: {
            functionCall,
            functionResponse: {
              functionResponse: {
                name: functionCall.name,
                response: {
                  result: {
                    status: "review_rejected",
                    findings: verdict.findings,
                    actionExecuted: false,
                    correctionAllowed,
                    reason: correctionAllowed
                      ? "The action has not happened. Correct the proposal once or continue using available results. Identical rejected requests will not execute."
                      : "The action has not happened and no correction remains for this chain. Finish using available results; do not re-propose this rejected action.",
                  },
                },
              },
            },
            preToolCallTextParts: buildPreToolCallTextParts(streamResult),
          },
        };
      }
    }
  }
  if (review && responseReviewCancelled(params.context)) return cancelReviewedCall();

  const startedAt = Date.now();

  const killPromise: Promise<ToolResult> | null = turnAbortSignal
    ? new Promise<ToolResult>((resolve) => {
        if (turnAbortSignal.aborted) {
          resolve({ success: false, error: `Tool "${functionName}" was killed.` });
          return;
        }
        turnAbortSignal.addEventListener(
          "abort",
          () => resolve({ success: false, error: `Tool "${functionName}" was killed.` }),
          { once: true },
        );
      })
    : null;

  const executedResult: ToolResult = isBlockedByDeliberateAllowlist
    ? {
        success: false,
        error: `Tool "${functionName}" was not exposed for this deliberate tool mode turn.`,
        data: {
          status: "blocked_by_deliberate_tool_mode",
          functionName,
          allowedToolNames: deliberateAllowedSet ? [...deliberateAllowedSet] : [],
        },
      }
    : await runUnderWatchdog(params.context.channel.id, () => {
        setChannelActiveToolName(params.context.channel.id, functionName);
        return Promise.race([
          ToolRegistry.executeTool(functionName, executionArgs, toolContext),
          new Promise<ToolResult>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  success: false,
                  error: `Tool "${functionName}" timed out after ${TOOL_EXECUTION_TIMEOUT_MS / 1000}s.`,
                }),
              TOOL_EXECUTION_TIMEOUT_MS,
            ),
          ),
          ...(killPromise ? [killPromise] : []),
        ]).finally(() => setChannelActiveToolName(params.context.channel.id, undefined));
      });

  if (review && responseReviewCancelled(params.context)) return cancelReviewedCall();

  // If /kill fired, exit the turn immediately; don't feed the failed result back to the model.
  if (shouldAbortToolCallForStopRequest(params.context.channel.id)) {
    return { kind: "abort", status: "stopped_by_user" };
  }

  // The send is awaited outside the timeout and kill race above, so Discord's verdict is always
  // known before history is built and a stop can never leave an accepted send unrecorded.
  let toolResult = executedResult;
  const stickerSelection = executedResult.success ? executedResult.stickerSelection : undefined;
  if (stickerSelection) {
    const stickerName = (executedResult.data as { sticker_name?: string } | undefined)?.sticker_name ?? "";
    const delivery = await runUnderWatchdog(params.context.channel.id, () =>
      deliverExpression(
        params.context,
        stickerSelection,
        stickerName,
        () => turnAbortSignal?.aborted === true || shouldAbortToolCallForStopRequest(params.context.channel.id),
      ),
    );
    if (delivery.status === "cancelled") return { kind: "abort", status: "stopped_by_user" };
    toolResult = buildExpressionToolResult(delivery, stickerName);
  }

  if (isBlockedByDeliberateAllowlist) {
    log.warn(
      `Deliberate tool mode blocked unexposed tool call "${functionName}" in channel ${params.context.channel.id}. Allowed: ${
        deliberateAllowedSet ? [...deliberateAllowedSet].join(", ") : ""
      }`,
    );
  }
  log.info(`Function call completed: ${functionName} (${Date.now() - startedAt}ms)`);

  // Record tool usage at the single tool-dispatch chokepoint (covers every
  // built-in / REST / MCP tool). metric_key is the tool name, so per-tool
  // breakdowns (web search, sticker, memory, reminder, …) fall out for free.
  // Only successful, non-blocked calls count. Fire-and-forget so stat tracking
  // never adds latency; DMs are skipped (server_id is a NOT NULL FK).
  if (toolResult.success && !isBlockedByDeliberateAllowlist && !params.context.isDMChannel) {
    const serverId = params.tomoriState.server_id;
    const userId = params.context.triggererUserId;
    if (serverId && userId) {
      const lineageId = params.context.currentPersona.persona_lineage_id ?? params.tomoriState.persona_lineage_id ?? 0;
      // userId is carried on the context (resolved once at turn planning), so no
      // per-tool-call DB lookup: recordStat just buffers in memory.
      // `sticker_used` is not recorded here: a successful call can be a repeat that sent
      // nothing, so the per-sticker count belongs to `deliverExpression` at Discord acceptance.
      try {
        statRepository.recordStat({
          serverId,
          userId,
          lineageId,
          metric: "tool_used",
          metricKey: functionName,
        });
      } catch (statError) {
        log.warn(`Failed to record tool_used stat for ${functionName}: ${statError}`);
      }
    }
  }

  // When a tool call fails, surface a hidden thought-log notice explaining why.
  if (!toolResult.success) {
    await emitFailedToolCallThoughtLog(
      toolContext,
      functionName,
      redactToolParametersForStorage(functionName, functionCall.args ?? {}),
      toolResult,
    );
  }

  // When deliberate-tool-mode admitted the tool via a specific trigger,
  // post a hidden notice (thought-log only) explaining why it fired.
  const deliberateToolTriggerMatch = params.context.deliberateToolTriggerMatchByToolName.get(functionName);
  if (params.context.deliberateToolModeActive && deliberateToolTriggerMatch && !isBlockedByDeliberateAllowlist) {
    const safeTrigger = deliberateToolTriggerMatch.trigger.replace(/`/g, "'");
    await routeHiddenToolNotice(
      toolContext,
      {
        color: ColorCode.INFO,
        titleKey: "genai.thought_log.title",
        description:
          `Tool \`${functionName}\` was used after deliberate tool mode exposed it.\n` +
          `Trigger: \`${safeTrigger}\`\n` +
          `Source: ${deliberateToolTriggerMatch.source}`,
      },
      "Deliberate tool trigger log",
    );
  }

  if (review && requestIdentity && toolResult.success)
    review.successfulTools.set(requestIdentity, {
      functionCall,
      functionResponse: {
        functionResponse: { name: functionCall.name, response: { result: toolResult.data ?? { status: "completed" } } },
      },
      imageMetadata: toolResult.imageMetadata,
    });

  if (toolResult.success && handleEnhancedContextRestart(params, toolResult.data)) {
    if (params.context.responseReview)
      params.context.responseReview.functionHistory.push({
        functionCall,
        functionResponse: {
          functionResponse: {
            name: functionCall.name,
            response: { result: toolResult.data ?? { status: "completed" } },
          },
        },
        preToolCallTextParts: buildPreToolCallTextParts(streamResult),
      });
    return { kind: "restart" };
  }

  if (functionName === "update_short_term_memory" && toolResult.success) {
    params.context.streamingContext.disableShortTermMemoryUpdate = true;
    log.info("Short-term memory updated; disabling further STM calls for this turn");
  }

  const functionResponse = toolResult.success
    ? ((toolResult.data as Record<string, unknown>) ?? { status: "completed" })
    : {
        status: "tool_execution_failed",
        reason: toolResult.message || toolResult.error || "Tool execution failed without specific error",
        tool_name: functionName,
      };

  // Preserve pre-tool narration for continuity. Collection keeps it pending until review.
  const preToolCallTextParts = buildPreToolCallTextParts(streamResult);
  if (preToolCallTextParts) {
    log.info(
      `Preserving ${preToolCallTextParts.length} pre-tool-call text part(s) in function history to prevent repetition`,
    );
  }

  return {
    kind: "history",
    functionName,
    success: toolResult.success,
    endTurn: toolResult.endTurn === true,
    responseDelivered: toolResult.success && toolResult.responseDelivered === true,
    historyEntry: {
      functionCall,
      functionResponse: {
        functionResponse: {
          name: functionCall.name,
          response: { result: functionResponse },
        },
      },
      imageMetadata: toolResult.imageMetadata,
      preToolCallTextParts,
    },
  };
}

/**
 * Builds the pre-tool-call text parts for a function-call history entry.
 *
 * `streamResult.accumulatedText` is this stream iteration's visible text at the
 * function-call boundary (each iteration gets a fresh stream state, so earlier
 * iterations' text is carried by their own history entries). Provider adapters
 * merge these parts into the synthetic assistant tool-call turn on the next call.
 */
function buildPreToolCallTextParts(streamResult: StreamResult): Array<Record<string, unknown>> | undefined {
  const text = streamResult.pendingResponse?.text ?? streamResult.accumulatedText;
  return text?.trim() ? [{ type: "text", text }] : undefined;
}

async function emitFailedToolCallThoughtLog(
  context: ToolContext,
  functionName: string,
  args: Record<string, unknown>,
  toolResult: ToolResult,
): Promise<void> {
  const noticeContext: ToolContext = {
    ...context,
    suppressProgressNotices: false,
  };

  await routeHiddenToolNotice(
    noticeContext,
    {
      color: ColorCode.ERROR,
      titleKey: "genai.thought_log.title",
      description: buildFailedToolCallDescription(functionName, args, toolResult),
    },
    "Failed tool call thought-log notice",
  );
}

function buildFailedToolCallDescription(
  functionName: string,
  args: Record<string, unknown>,
  toolResult: ToolResult,
): string {
  const reason = toolResult.message || toolResult.error || "Tool execution failed without specific error.";
  const details = safeStringifyToolFailureDetails({
    args,
    data: toolResult.data,
  });
  const lines = [`Tool \`${functionName}\` failed.`, `Reason: ${reason}`];
  if (details) {
    lines.push("", "Details:", codeBlock(truncateToolFailureNotice(details)));
  }

  return lines.join("\n");
}

function safeStringifyToolFailureDetails(value: unknown): string | undefined {
  try {
    const json = JSON.stringify(value, null, 2);
    return json === undefined || json === "{}" ? undefined : json;
  } catch {
    return String(value);
  }
}

function truncateToolFailureNotice(value: string): string {
  if (value.length <= TOOL_FAILURE_NOTICE_LIMIT) {
    return value;
  }
  return `${value.slice(0, TOOL_FAILURE_NOTICE_LIMIT - 3)}...`;
}

function codeBlock(value: string): string {
  return `\`\`\`json\n${neutralizeFenceRuns(value)}\n\`\`\``;
}

function handleEnhancedContextRestart(params: ToolLoopParams, data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  if (!type.startsWith("context_restart_")) return false;

  if (type.includes("message_metadata")) {
    const { annotatedCount, patchedReplyReferenceCount } = annotateRecentMessageMetadataInContext({
      simplifiedMessages: params.context.simplifiedMessages,
      contextSegments: params.context.contextItems,
      messageIdMap: params.context.messageIdMap,
    });
    const metadataActionHint = buildTailDirectiveMessage(buildRevealedMessageMetadataTailDirective());
    if (metadataActionHint) {
      params.context.contextItems.push(metadataActionHint);
    }
    log.info(
      `Recent message metadata reveal annotated ${annotatedCount} message(s) and patched ${patchedReplyReferenceCount} reply reference(s).`,
    );
  }

  const enhancedContextItem = resolveEnhancedContextItem(record, type);
  if (enhancedContextItem && typeof enhancedContextItem === "object") {
    params.context.contextItems.push(enhancedContextItem as ChatTurnContext["contextItems"][number]);
  }
  if (type.includes("youtube")) params.context.streamingContext.disableYouTubeProcessing = true;
  if (type.includes("image")) params.context.streamingContext.disableProfilePictureProcessing = true;
  if (type.includes("gif")) params.context.streamingContext.disableGifProcessing = true;
  if (type.includes("message_metadata")) params.context.streamingContext.disableMessageMetadataContext = true;
  log.info(`Tool requested enhanced-context restart: ${type}`);
  return true;
}

/**
 * Resolves the enrichment payload from either transport: inline `enhanced_context_item`,
 * or `pending_context_key` for tools whose payload is too heavy to sit in `ToolResult.data`.
 */
function resolveEnhancedContextItem(record: Record<string, unknown>, type: string): unknown {
  const pendingContextKey = typeof record.pending_context_key === "string" ? record.pending_context_key : undefined;
  if (!pendingContextKey) return record.enhanced_context_item;

  const stashedItem = takeEnhancedContextItem(pendingContextKey);
  if (!stashedItem) {
    log.warn(
      `Enhanced-context restart '${type}' referenced pending key ${pendingContextKey}, but no payload was stashed. The enriched media will be missing from this turn.`,
    );
  }
  return stashedItem ?? record.enhanced_context_item;
}

async function shouldEndAfterPreToolText(
  provider: LLMProvider,
  streamResult: StreamResult,
  functionName: string,
  serverId: number | undefined,
): Promise<boolean> {
  const hasPreToolText = (streamResult.accumulatedText ?? "").trim().length > 0;
  if (!hasPreToolText) return false;
  const providerName = provider.getInfo().name;
  const applies =
    providerIsApiFamily(providerName, "novelai") || TOOLS_SUPPRESS_FOLLOWUP_AFTER_PRETOOL_TEXT.has(functionName);
  if (!applies) return false;
  if (functionName === "update_short_term_memory") return true;
  return !(await ToolRegistry.requiresFollowUp(functionName, serverId));
}

/**
 * Whether an empty stream after a tool means the model had nothing to add. A held NovelAI fragment,
 * an output-token cap (the retry trims context for it), and a speaker-guard discard (the retry
 * injects the speaker directive) are failures. A tool that requires follow-up returned data only
 * the follow-up can present, so an empty one lost the answer.
 */
async function isSettledAfterTool(
  params: ToolLoopParams,
  emptyResult: StreamResult,
  lastToolName: string | undefined,
): Promise<boolean> {
  if (!lastToolName || emptyResult.naiContinuationPrefill) return false;
  const data = emptyResult.data as { finishReason?: unknown; emptyResponseReason?: unknown } | undefined;
  if (data?.finishReason === "length" || data?.emptyResponseReason) return false;
  return !(await ToolRegistry.requiresFollowUp(lastToolName, params.tomoriState.server_id));
}

async function emitNaiToolRetryExhausted(context: ChatTurnContext): Promise<void> {
  await sendStandardEmbed(
    context.channel as Parameters<typeof sendStandardEmbed>[0],
    context.locale,
    {
      color: ColorCode.ERROR,
      titleKey: "genai.nai_tool_retry_exhausted_title",
      descriptionKey: "genai.nai_tool_retry_exhausted_description",
    },
    {
      webhook: context.responseTarget?.webhook,
      personaUsername: context.responseTarget?.personaUsername,
      personaAvatarUrl: context.responseTarget?.personaAvatarUrl,
    },
  );
}

function shouldAbortToolCallForStopRequest(channelId: string): boolean {
  if (!StreamOrchestrator.hasStopRequest(channelId)) return false;
  if (!StreamOrchestrator.isFollowUpRequest(channelId)) return true;

  log.info(
    `Follow-up request found during tool execution for channel ${channelId}. Clearing interrupt to preserve tool chain progress — follow-up is queued.`,
  );
  StreamOrchestrator.clearStopRequest(channelId);
  return false;
}

async function emitToolErrorLoop(context: ChatTurnContext): Promise<void> {
  if (context.isUserImpersonation) {
    throw new Error("User impersonation aborted: model failed too many tool calls in a row.");
  }
  if (!context.shouldSurfaceUserErrors) {
    log.warn(`Suppressing tool error loop embed for non-deliberate chat turn ${context.message.id}`);
    return;
  }
  await sendStandardEmbed(
    context.channel as Parameters<typeof sendStandardEmbed>[0],
    context.locale,
    {
      color: ColorCode.ERROR,
      titleKey: "genai.tool_error_loop_title",
      descriptionKey: "genai.tool_error_loop_description",
      tipKeys: ["genai.tips.refresh_context"],
    },
    {
      webhook: context.responseTarget?.webhook,
      personaUsername: context.responseTarget?.personaUsername,
      personaAvatarUrl: context.responseTarget?.personaAvatarUrl,
    },
  );
}

/** Matches the notice ordinary streaming posts when a reply reaches its length cap. */
async function emitHeldResponseLimitNotice(context: ChatTurnContext): Promise<void> {
  if (!context.shouldSurfaceUserErrors) return;
  await sendStandardEmbed(
    context.channel as Parameters<typeof sendStandardEmbed>[0],
    context.locale,
    {
      color: ColorCode.WARN,
      titleKey: "genai.stream.flush_limit_title",
      descriptionKey: "genai.stream.flush_limit_description",
    },
    {
      webhook: context.responseTarget?.webhook,
      personaUsername: context.responseTarget?.personaUsername,
      personaAvatarUrl: context.responseTarget?.personaAvatarUrl,
    },
  ).catch((embedError) => {
    log.warn(
      "Failed to send held response limit notice",
      embedError instanceof Error ? embedError : new Error(String(embedError)),
    );
  });
}

function queueStopResponseIfPresent(context: ChatTurnContext): void {
  const stopContext = StreamOrchestrator.getAndClearStopContext(context.channel.id);
  if (!stopContext) {
    StreamOrchestrator.clearStopRequest(context.channel.id);
    return;
  }

  queueStopResponseAtFront({
    channelId: context.channel.id,
    message: stopContext.originalStopMessage,
    llmOverrideCodename: context.turn.lockedTurn.admission.incoming.llmOverrideCodename,
    selectedPersonaId: context.currentPersona.persona_id ?? undefined,
    textQuotaTriggerKey: context.textQuotaTriggerKey,
    shouldSurfaceUserErrors: true,
  });
}

function buildResult(
  status: GenerationTurnResult["status"],
  context: ChatTurnContext,
  streamResults: StreamResult[],
  responseText: string,
  detailsText: string,
  thoughtLog: GenerationTurnResult["thoughtLog"],
  toolResponseDelivered = false,
): GenerationTurnResult {
  const text =
    detailsText.trim() && (!context.responseReview || responseText.trim())
      ? `${responseText.trim()}\n\n[Scene Metadata]\n${detailsText.trim()}`
      : responseText.trim();
  return {
    status,
    streamResults,
    usageEntries: context.responseReview?.usage,
    personaResponses:
      text.length > 0
        ? [
            {
              personaName: context.currentPersona.persona_nickname,
              text,
              personaId: context.currentPersona.persona_id,
              personaLineageId: context.currentPersona.persona_lineage_id,
            },
          ]
        : [],
    toolResponseDelivered: toolResponseDelivered || undefined,
    thoughtLog,
    thoughtLogOwner: thoughtLog ? resolveThoughtLogOwner(context) : undefined,
  };
}

function resolveThoughtLogOwner(context: ChatTurnContext): GenerationTurnResult["thoughtLogOwner"] {
  if (context.isUserImpersonation) {
    return {
      type: "user_impersonation",
      username: context.responseTarget?.personaUsername ?? "User",
      avatarUrl: context.responseTarget?.personaAvatarUrl,
    };
  }
  return context.currentPersona.is_alter ? { type: "persona", persona: context.currentPersona } : { type: "default" };
}

function mergeDetails(existing: string, incoming: string | undefined): string {
  if (!incoming?.trim()) return existing;
  return existing ? `${existing}\n\n${incoming}` : incoming;
}
