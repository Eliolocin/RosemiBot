import { withProviderUsageContext } from "@/utils/provider/providerUsage";
import { createResponseReviewState } from "@/utils/chat/responseReview";
import type { FallbackEntry, LlmRow, TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { LLMProvider, ProviderConfig, StreamResult } from "@/types/provider/interfaces";
import type { ProviderError } from "@/types/stream/interfaces";
import type { ToolContext } from "@/types/tool/interfaces";
import { resolveServerTextModel } from "@/utils/provider/textModelSelection";
import { llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import { type FallbackNoticeAttempt, sendFallbackModelUsageNotice } from "@/utils/discord/fallbackModelNotice";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { classifySendFailure } from "@/utils/discord/stream/sendFailureCache";
import { ColorCode, log } from "@/utils/misc/logger";
import { buildCustomProviderName } from "@/utils/provider/customProviderUtils";
import { getProviderForTomori, ProviderFactory } from "@/utils/provider/providerFactory";
import { formatProviderErrorCodeForDisplay } from "@/utils/provider/providerErrorClassification";
import { applyProviderContextTruncation } from "@/utils/provider/contextBudget";
import { applyPersonalProviderSelectionsToTomoriState } from "@/utils/provider/personalProviderRuntime";
import { withSavedProviderConfig } from "@/utils/provider/savedProviderConfig";
import { decryptApiKey } from "@/utils/security/crypto";
import {
  buildSupporterFallbackTomoriState,
  buildSupporterPrimaryTomoriState,
  getSupporterUsageContext,
  resolveSupporterFunding,
  recordSupporterUsage,
  resolveSupporterManagedProviderConfig,
  type SupporterFundingContext,
} from "@/modules/supporter-billing/runtime";
import { isSupporterBillingEnabled } from "@/modules/supporter-billing/config";
import {
  SupporterRequestDeniedError,
  findSupporterRequestDeniedError,
} from "@/modules/supporter-billing/runtime/funding";
import { getSupporterRequestFailureCopy } from "@/modules/supporter-billing/discord/requestFailure";
import { resolveEnvironment } from "@/types/config";
import { resolveMediaForModel } from "@/utils/text/context/mediaResolver";
import {
  hasAvailableRotationKey,
  MAX_KEY_ATTEMPTS,
  recordKeyError,
  recordKeySuccess,
  selectApiKey,
} from "@/utils/security/keyRotation";
import { buildVerbatimToolDefinitionsContextItem } from "@/utils/text/context/toolDefinitions";
import {
  checkTextQuotaForAdmission,
  enforceServerTriggerCooldownForAdmission,
  shouldApplyServerTextQuota,
} from "@/utils/chat/admissionGuards";
import {
  claimCredentialRefusalNotice,
  hasTextQuotaBeenRefused,
  markTextQuotaRefused,
} from "@/utils/chat/textQuotaState";
import {
  recordChatAttemptStarted,
  recordChatDiagnostic,
  recordChatProviderContext,
  runWithChatDiagnosticStage,
} from "@/utils/chat/diagnosticTimeline";
import { applyAssistantPrefill } from "@/utils/chat/assistantPrefill";
import { getChannelTurnAbortSignal } from "@/utils/chat/channelQueue";
import { setTimeout as sleep } from "node:timers/promises";
import type { ChatResponseSink, ChatTurnContext, GenerationTurnResult, TextCredentialSource } from "@/utils/chat/types";
import {
  carryDeliveredOutput,
  type DeliveredTurnOutput,
  prependDeliveredOutput,
  providerIsApiFamily,
  runToolLoop,
  sendStreamTimeoutNotice,
} from "@/utils/chat/toolLoop";
import {
  VERBATIM_TOOL_CALLING_CONTEXT_DEPTH,
  VERBATIM_TOOL_CALLING_NUDGE,
  shouldInjectVerbatimToolCallingNudge,
} from "@/utils/tools/verbatimToolCalling";

/** The channel shape quota notices are sent through, matching the admission path's own alias. */
type SendableChannel = Parameters<typeof sendStandardEmbed>[0];

interface GenerationAttempt {
  credentialSource: TextCredentialSource;
  funding: SupporterFundingContext | null;
  label: string;
  tomoriState: TomoriState;
  provider: LLMProvider;
  providerConfig: ProviderConfig;
  successModel: LlmRow;
  /** Rotation key ID used for this attempt; null when rotation pool is inactive. */
  rotationKeyId: number | null;
}

/** The route a turn was planned on, plus the server route it may still reach. */
interface GenerationPlan {
  attempts: GenerationAttempt[];
  /** A subscription refusal raised while building the planned route's attempts. */
  plannedRouteRefusal: SupporterRequestDeniedError | null;
  /**
   * Materializes the server route's attempts, or null when this turn owns no server fallback.
   *
   * Resolution is deferred until every attempt so far has failed, because building the pool eagerly
   * prepares server provider config and spends the server's text quota admission on turns that
   * never leave their planned route.
   */
  extendWithServerRoute: ((startIndex: number) => Promise<GenerationAttempt[]>) | null;
}

/**
 * How many of the oldest history exchange pairs each retry drops when OpenRouter stopped a
 * reply on `length` with no content. Scaling by `retryCount` widens the trim on every retry,
 * so a reply that overflowed once keeps losing context until it fits.
 */
const OPENROUTER_LENGTH_EMPTY_RETRY_DROP_PAIRS = 2;

/**
 * Longest `Retry-After` a chat turn waits out before retrying a subscription attempt that hit
 * OpenRouter's in-flight budget; longer waits go to the user as a retry time instead of a stall.
 */
const SUPPORTER_CAPACITY_RETRY_MAX_WAIT_MS = 10_000;

export async function runGenerationTurn(
  context: ChatTurnContext,
  responseSink: ChatResponseSink,
): Promise<GenerationTurnResult> {
  try {
    // Inside the try because prepare() is what creates the temporary webhook: a throw in the
    // channel-lock bookkeeping that follows creation would otherwise strand it with no cleanup.
    const responseTarget = await responseSink.prepare?.(context);
    if (responseTarget) {
      context.responseTarget = responseTarget;
    }

    return await runGenerationAttempts(context, responseSink);
  } finally {
    // emitGenerationError rethrows for user impersonation, so the error handler in
    // runGenerationAttempts can itself throw and never reach finalize. Without this the
    // turn's temporary webhook would survive in the channel.
    await responseSink.cleanup?.();
  }
}

async function runGenerationAttempts(
  context: ChatTurnContext,
  responseSink: ChatResponseSink,
): Promise<GenerationTurnResult> {
  try {
    context.responseReview = createResponseReviewState(context);
    context.streamingContext.holdResponseText = Boolean(context.responseReview);
    const plan = await buildGenerationPlan(context);
    const attempts = plan.attempts;
    const exhaustedIdentities = new Set<number>();
    const canUseAttempt = (attempt: GenerationAttempt) =>
      !attempt.funding || !exhaustedIdentities.has(attempt.funding.sponsorIdentityId);
    const failures: FallbackNoticeAttempt[] = [];
    const baseContextItems = context.contextItems;

    // Initialized once per turn so expression delivery sees text any attempt of this turn posted.
    context.streamingContext.deliveredMessageRefs ??= [];
    const carried: DeliveredTurnOutput = { text: "", details: "", streamResults: [] };
    let supersededResult: GenerationTurnResult | undefined;
    // Index the server route's attempts start at, null until that route contributes any. Only the
    // receipt needs it: a success on the server route of a personal turn has an opt-out to name.
    let serverRouteStartIndex: number | null = null;

    if (attempts.length === 0 && plan.extendWithServerRoute) {
      const extend = plan.extendWithServerRoute;
      plan.extendWithServerRoute = null;
      serverRouteStartIndex = 0;
      attempts.push(...(await extend(0)).filter(canUseAttempt));
    }
    const unservedRefusal = attempts.length === 0 ? plan.plannedRouteRefusal : null;

    for (let index = 0; index < attempts.length; index++) {
      const attempt = attempts[index];
      if (!attempt) continue;
      context.textCredentialSource = attempt.credentialSource;
      context.streamingContext.textCredentialSource = attempt.credentialSource;
      context.usageContext = attempt.funding ? getSupporterUsageContext(attempt.funding) : undefined;
      context.streamingContext.usageContext = context.usageContext;
      recordChatAttemptStarted(
        index + 1,
        context.textCredentialSource,
        `${attempt.successModel.llm_provider}:${attempt.successModel.llm_codename}`,
      );
      // A server route that has not been built yet still counts as a pending model, so the last
      // planned attempt keeps its errors suppressed while a later model may yet answer.
      const hasPendingModelFallback = index < attempts.length - 1 || plan.extendWithServerRoute !== null;
      context.tomoriState = attempt.tomoriState;
      const attemptContextItems = await prepareProviderContextItems({
        contextItems: baseContextItems,
        tomoriState: attempt.tomoriState,
        deliberateToolAllowedNames: context.streamingContext.deliberateToolAllowedNames,
      });

      // Key rotation inner loop: try multiple keys for this attempt before giving up.
      let rotationKeyId = attempt.rotationKeyId;
      const excludedKeyIds = new Set<number>();
      let result!: GenerationTurnResult;
      let keyAttemptCount = 0;
      let capacityRetried = false;
      context.streamingContext.rotationKeyRetriesUsed = false;

      while (true) {
        keyAttemptCount++;
        if (keyAttemptCount > MAX_KEY_ATTEMPTS) {
          log.warn(`Exceeded MAX_KEY_ATTEMPTS (${MAX_KEY_ATTEMPTS}) for ${attempt.label}.`);
          break;
        }

        const retryExcludedKeyIds = getRetryExcludedKeyIds(excludedKeyIds, rotationKeyId);
        const hasFallbackKey =
          attempt.credentialSource === "server" &&
          (await hasAvailableRotationKey(attempt.tomoriState, retryExcludedKeyIds));
        setStreamUserErrorSuppression(
          context,
          hasFallbackKey || hasPendingModelFallback || Boolean(context.supporterProviderFailure),
        );
        context.streamingContext.forceModelFallback = hasPendingModelFallback;

        if (context.responseReview) {
          context.responseReview.pending = [];
        } else if (supersededResult) {
          carryDeliveredOutput(carried, supersededResult);
        }
        supersededResult = undefined;
        // Rebuilt per key attempt because a key-rotation retry continues what the failed key posted.
        const prefilled = await applyAssistantPrefill({
          contextItems: attemptContextItems,
          prefill: carried.text ? { text: carried.text, source: "continuation" } : context.assistantPrefill,
          tomoriState: attempt.tomoriState,
          forceReason: context.streamingContext.forceReason,
        });
        // applyAssistantPrefill only appends, so this is exactly the prefill turn or directive.
        const prefillItems = prefilled.contextItems.slice(attemptContextItems.length);
        context.contextItems = [
          ...(await fitProviderContextBudget({
            contextItems: attemptContextItems,
            reservedTailItems: prefillItems,
            tomoriState: attempt.tomoriState,
            serverDiscId: context.serverDiscId,
            emptyResponseFinishReason: context.turn.lockedTurn.admission.incoming.emptyResponseFinishReason,
            retryCount: context.turn.lockedTurn.admission.incoming.retryCount,
          })),
          ...prefillItems,
        ];
        context.streamingContext.outputPrefill = prefilled.outputPrefill;
        recordChatProviderContext(
          index + 1,
          context.contextItems.flatMap((item) =>
            item.metadataTag === ContextItemTag.DIALOGUE_HISTORY && item.messageId ? [item.messageId] : [],
          ),
        );
        result = await runWithChatDiagnosticStage({ attempt: index + 1, keyAttempt: keyAttemptCount }, () =>
          withProviderUsageContext(context.usageContext, async () =>
            runToolLoop({
              context,
              provider: attempt.provider,
              providerConfig: attempt.providerConfig,
              supporterFunding: attempt.funding ?? undefined,
              tomoriState: attempt.tomoriState,
            }),
          ),
        );
        supersededResult = result;
        if (carried.text && result.status === "empty_response" && !isRetryableEmptyResponse(result)) {
          result = { ...result, status: "completed" };
        }

        recordAttemptUsage(attempt, result);

        if (result.status !== "error") {
          // Don't credit a timed-out key as successful : a timeout is not a clean completion.
          if (result.status !== "timeout" && rotationKeyId != null) await recordKeySuccess(rotationKeyId);
          break;
        }

        const capacityRetryMs = capacityRetried ? null : getSupporterCapacityRetryDelayMs(attempt, result);
        if (capacityRetryMs !== null) {
          capacityRetried = true;
          if (!(await waitForSupporterCapacity(context, capacityRetryMs))) break;
          log.warn(`Retrying ${attempt.label} after OpenRouter's in-flight budget Retry-After.`);
          continue;
        }

        if (!hasFallbackKey) break;

        context.streamingContext.rotationKeyRetriesUsed = true;
        if (rotationKeyId != null) {
          const errorCode = extractErrorCode(result.streamResults.at(-1));
          const errorType = errorCode.includes("rate_limit") || errorCode.includes("429") ? "rate_limit" : "api_error";
          await recordKeyError(rotationKeyId, errorType, errorCode);
          excludedKeyIds.add(rotationKeyId);
        }

        const nextKey = await selectApiKey(attempt.tomoriState, [...Array.from(excludedKeyIds)]);
        if (!nextKey) break;

        attempt.providerConfig.apiKey = nextKey.apiKey;
        rotationKeyId = nextKey.rotationKeyId;
        log.warn(
          `Key rotation: retrying ${attempt.label} with key ${rotationKeyId ?? "main"} (attempt ${keyAttemptCount + 1}).`,
        );
      }

      recordChatDiagnostic({
        kind: "attempt_finished",
        ordinal: index + 1,
        status: result?.status ?? "skipped",
        keyAttempts: keyAttemptCount,
      });

      // A destination the bot cannot post into fails for every key and every model alike, whether
      // the channel was deleted or access to it was revoked. Retrying would burn a full generation
      // per fallback arm and then discard it at the same send, so this attempt is terminal: the
      // status it returns is a stop, which `isRetryableStatus` below already excludes, and this
      // break keeps the model fallback loop from picking it up.
      if (isUnreachableDestinationResult(result)) {
        log.warn(`Abandoning ${attempt.label}: the destination channel cannot receive messages.`);
        break;
      }

      const isRetryableStatus =
        (result.status === "error" || result.status === "timeout") && !isUnreachableDestinationResult(result);

      const denied = findAttemptSupporterFailure(attempt, result);
      if (attempt.funding && (denied?.reason === "allowance_exhausted" || denied?.reason === "capacity_unavailable")) {
        context.supporterProviderFailure ??= {
          reason: denied.reason,
          funding: attempt.funding,
          details: denied.details,
        };
        // Capacity rejections skip nothing else: OpenRouter estimates each request separately, so a
        // cheaper fallback can still fit the operator's remaining budget.
        if (denied.reason === "allowance_exhausted") {
          exhaustedIdentities.add(attempt.funding.sponsorIdentityId);
          const remaining = attempts.slice(index + 1).filter(canUseAttempt);
          attempts.splice(index + 1, attempts.length - index - 1, ...remaining);
        }
      }

      // The planned route is exhausted. Extend once with the server route, which admits itself and
      // may refuse, so this is also the point a fallback the server does not owe the user stops.
      if (isRetryableStatus && index === attempts.length - 1 && plan.extendWithServerRoute) {
        const extendWithServerRoute = plan.extendWithServerRoute;
        plan.extendWithServerRoute = null;
        let serverAttempts: GenerationAttempt[] = [];
        try {
          serverAttempts = (await extendWithServerRoute(attempts.length)).filter(canUseAttempt);
        } catch (error) {
          // Preparing the server route is best effort, like each pool entry: a failure here leaves
          // the planned route's own failure as the turn's outcome instead of replacing it.
          log.warn("Failed to prepare the server model fallback route.", error as Error);
        }
        if (serverAttempts.length > 0) {
          serverRouteStartIndex = attempts.length;
          attempts.push(...serverAttempts);
        }
      }

      if (!isRetryableStatus || index === attempts.length - 1) {
        if (index > 0 && shouldSendFallbackNotice(context, result)) {
          log.info(`Fallback generation succeeded with ${attempt.label} after ${failures.length} failed attempt(s).`);
          await sendFallbackNoticeIfNeeded(context, attempt, failures, {
            offerPersonalFallbackOptOut: serverRouteStartIndex !== null && index >= serverRouteStartIndex,
          });
        } else if (context.supporterProviderFailure && (result.status === "error" || result.status === "timeout")) {
          await sendSupporterFailureNotice(context);
        }
        setStreamUserErrorSuppression(context, false);
        context.streamingContext.forceModelFallback = false;

        // A timeout notice is normally sent while its attempt is still running, and it is held back
        // when a later model may still answer. If the server route then contributed nothing, this is
        // the only place left to report it: no error result carries a timeout, so the branch below
        // would leave the user with silence.
        if (result.status === "timeout") {
          await sendDeferredTimeoutNoticeIfPending(context);
        }

        if (result.status === "error" && !context.supporterProviderFailure) {
          await emitStreamErrors(responseSink, result.streamResults);
        }
        // After the errors are emitted, because a carried attempt's error was suppressed for the
        // retry and must not surface as a second embed.
        const finalResult = prependDeliveredOutput(result, context, carried);
        if (context.responseReview) finalResult.usageEntries = context.responseReview.usage;
        await responseSink.finalize(finalResult);
        return finalResult;
      }

      failures.push({
        modelCodename: attempt.tomoriState.llm.llm_codename,
        errorDetail: denied
          ? getSupporterRequestFailureCopy(denied, context.locale, true).description
          : extractErrorDetail(result.streamResults.at(-1)),
      });
    }

    const skipped: GenerationTurnResult = {
      status: "skipped",
      streamResults: [],
      personaResponses: [],
    };
    setStreamUserErrorSuppression(context, false);
    context.streamingContext.forceModelFallback = false;
    await sendSupporterFailureNotice(context, unservedRefusal ?? undefined);
    if (context.responseReview) skipped.usageEntries = context.responseReview.usage;
    await responseSink.finalize(skipped);
    return skipped;
  } catch (error) {
    setStreamUserErrorSuppression(context, false);
    context.streamingContext.forceModelFallback = false;
    if (context.supporterProviderFailure) await sendSupporterFailureNotice(context);
    else await responseSink.emitError(error);
    const result: GenerationTurnResult = {
      status: "error",
      streamResults: [{ status: "error", data: error }],
      personaResponses: [],
    };
    if (context.responseReview) result.usageEntries = context.responseReview.usage;
    await responseSink.finalize(result);
    return result;
  }
}

function findAttemptSupporterFailure(
  attempt: GenerationAttempt,
  result: GenerationTurnResult,
): SupporterRequestDeniedError | null {
  for (const entry of result.streamResults) {
    const denied = findSupporterRequestDeniedError(entry.data, attempt.funding);
    if (denied) return denied;
  }
  return null;
}

function recordAttemptUsage(attempt: GenerationAttempt, result: GenerationTurnResult): void {
  for (const entry of result.streamResults) {
    recordSupporterUsage(attempt.funding, {
      modelCodename: attempt.tomoriState.llm.llm_codename,
      costUsd: entry.usage?.costUsd,
      inputTokens: entry.usage?.inputTokens,
      outputTokens: entry.usage?.outputTokens,
    });
  }
}

function getSupporterCapacityRetryDelayMs(attempt: GenerationAttempt, result: GenerationTurnResult): number | null {
  const denied = findAttemptSupporterFailure(attempt, result);
  const delayMs =
    denied?.reason === "capacity_unavailable" && denied.details?.retryAt
      ? denied.details.retryAt.getTime() - Date.now()
      : null;
  return delayMs !== null && delayMs <= SUPPORTER_CAPACITY_RETRY_MAX_WAIT_MS ? Math.max(delayMs, 0) : null;
}

async function waitForSupporterCapacity(context: ChatTurnContext, delayMs: number): Promise<boolean> {
  const signal = getChannelTurnAbortSignal(context.channel.id);
  try {
    await sleep(delayMs, undefined, signal ? { signal } : undefined);
  } catch {
    return false;
  }
  return !StreamOrchestrator.hasStopRequest(context.channel.id);
}

async function sendSupporterFailureNotice(
  context: ChatTurnContext,
  refusal?: SupporterRequestDeniedError,
): Promise<void> {
  if (
    !context.shouldSurfaceUserErrors ||
    context.isUserImpersonation ||
    StreamOrchestrator.hasStopRequest(context.channel.id)
  )
    return;
  const failure = context.supporterProviderFailure;
  const error =
    refusal ??
    (failure
      ? new SupporterRequestDeniedError(
          failure.reason,
          failure.details,
          failure.funding.capability,
          failure.funding.fundingScope,
          failure.funding,
        )
      : null);
  if (!error) return;
  if (refusal && !claimCredentialRefusalNotice(context.textQuotaTriggerKey)) return;
  await sendStandardEmbed(context.channel as SendableChannel, context.locale, {
    ...getSupporterRequestFailureCopy(error, context.locale),
    color: ColorCode.ERROR,
  }).catch((sendError) => log.warn("Failed to send subscription usage notice", sendError));
}

function setStreamUserErrorSuppression(context: ChatTurnContext, temporarySuppressed: boolean): void {
  context.streamingContext.suppressUserErrors = temporarySuppressed || !context.shouldSurfaceUserErrors;
}

async function buildGenerationPlan(context: ChatTurnContext): Promise<GenerationPlan> {
  const plannedRoute = await buildPlannedRouteAttempts(context);
  return {
    attempts: plannedRoute.attempts,
    plannedRouteRefusal: plannedRoute.refusal,
    extendWithServerRoute: resolveServerRouteExtension(context),
  };
}

/**
 * The server route a personal text turn can still reach, or null when this turn owns none.
 *
 * A personal route spends the user's own credentials, so a server model is a separate phase with
 * its own admission rather than another member of the personal pool. Two policies withhold it
 * outright: a server that requires members to bring their own provider never lends its models to a
 * member-triggered turn, and the account-wide setting below is the user's own refusal.
 */
function resolveServerRouteExtension(
  context: ChatTurnContext,
): ((startIndex: number) => Promise<GenerationAttempt[]>) | null {
  const isPersonal =
    context.textCredentialSource === "personal" || context.supporterFunding?.fundingScope === "personal";
  if (
    !isPersonal ||
    context.isUserImpersonation ||
    (context.isDMChannel &&
      (context.serverDiscId !== context.userDiscId ||
        context.supporterFunding?.fundingScope === "personal" ||
        context.personalTextProvider === "supporter"))
  ) {
    return null;
  }
  if (context.currentPersona.config.user_byok_mode) {
    log.info(
      `Withholding the server model fallback for user ${context.userDiscId}: server ${context.serverDiscId} requires personal providers.`,
    );
    return null;
  }
  // Only an explicit opt-out withholds the route. The column is NOT NULL DEFAULT true and the
  // projection reports that default for an account with no personalization row yet, so an account
  // that never touched the setting keeps the fallback it already had.
  if (context.turn.userRow.personal_server_fallback_enabled === false) {
    log.info(`Skipping the server model fallback for user ${context.userDiscId}: disabled in their personal config.`);
    return null;
  }
  return (startIndex) => buildServerRouteAttempts(context, startIndex);
}

async function buildPlannedRouteAttempts(context: ChatTurnContext): Promise<{
  attempts: GenerationAttempt[];
  refusal: SupporterRequestDeniedError | null;
}> {
  const disableAllTools = !!context.streamingContext.disableAllTools;
  const primaryState = await resolveTomoriStateForRoute(context, "planned");
  const funding = primaryState.llm.llm_provider === "openrouter" ? context.supporterFunding : null;
  const personalUserId =
    context.textCredentialSource === "personal" || funding?.fundingScope === "personal"
      ? (context.personalRoutingUserId ?? null)
      : null;
  const fallbackEntries = resolveFallbackEntries(primaryState);

  const pool: FallbackEntry[] = [
    {
      kind: "llm",
      model: primaryState.llm,
      ...(funding ||
      context.personalTextProvider === "supporter" ||
      (personalUserId === null &&
        primaryState.llm.llm_provider === "openrouter" &&
        primaryState.config.subscription_capabilities.includes("text"))
        ? { credentialProvider: "supporter" as const }
        : {}),
    },
    ...fallbackEntries,
  ];

  // Model randomizer: when enabled, splice a random pool member to the front so a different model
  // leads each turn. When disabled, the pool order is unchanged from the legacy behavior.
  applyModelRandomizer(pool, primaryState.config.model_randomizer_enabled);

  // Materialize attempts from the (possibly reordered) pool. Reusing createFallbackAttempt for the
  //    primary's own llm entry yields a state equivalent to primaryState (provider matches, no config
  //    swap), so index 0 stays semantically identical to the old dedicated "primary" attempt.
  const attempts: GenerationAttempt[] = [];
  let refusal: SupporterRequestDeniedError | null = null;
  for (const [index, entry] of pool.entries()) {
    try {
      const attempt = await createFallbackAttempt(
        context,
        primaryState,
        entry,
        index,
        disableAllTools,
        personalUserId,
        funding,
      );
      if (!attempt) {
        continue;
      }
      // Keep logs readable: the lead is always labelled "primary" regardless of the random draw.
      //    The true model still surfaces via successModel for log verification.
      if (index === 0) {
        attempt.label = "primary";
      }
      attempts.push(attempt);
    } catch (error) {
      if (error instanceof SupporterRequestDeniedError) refusal ??= error;
      log.warn(`Skipping pool entry ${index}: failed to prepare provider config.`, error as Error);
    }
  }

  return { attempts, refusal };
}

/**
 * Builds the server's own text route, reached only after every personal attempt has failed.
 *
 * The pool comes from the unmodified server state rather than from the personal overlay, so each
 * attempt carries the server's credentials and draws on the server's own randomizer setting even
 * when the two routes name models from one provider. A refused quota admission yields no attempts,
 * which leaves the personal failure as the turn's outcome.
 */
async function buildServerRouteAttempts(context: ChatTurnContext, startIndex: number): Promise<GenerationAttempt[]> {
  const disableAllTools = !!context.streamingContext.disableAllTools;
  if (!(await admitServerRoute(context))) {
    return [];
  }

  const serverState = await resolveTomoriStateForRoute(context, "server");
  const serverPool: FallbackEntry[] = [
    {
      kind: "llm",
      model: serverState.llm,
      ...(serverState.llm.llm_provider === "openrouter" && serverState.config.subscription_capabilities.includes("text")
        ? { credentialProvider: "supporter" as const }
        : {}),
    },
    ...resolveFallbackEntries(serverState),
  ];
  applyModelRandomizer(serverPool, serverState.config.model_randomizer_enabled);

  const attempts: GenerationAttempt[] = [];
  for (const entry of serverPool) {
    const fallbackIndex = startIndex + attempts.length;
    try {
      const attempt = await createFallbackAttempt(
        context,
        serverState,
        entry,
        fallbackIndex,
        disableAllTools,
        null,
        null,
      );
      if (attempt) {
        attempts.push(attempt);
      }
    } catch (error) {
      log.warn(
        `Skipping server fallback pool entry ${fallbackIndex}: failed to prepare provider config.`,
        error as Error,
      );
    }
  }

  return attempts;
}

function resolveFallbackEntries(state: TomoriState): FallbackEntry[] {
  return state.fallback_chain ?? state.fallback_llms?.map((model) => ({ kind: "llm" as const, model })) ?? [];
}

/**
 * Splices a random pool member to the front so a different model leads each turn. The remainder
 * keeps its relative order as the failover tail, and because the reorder is a splice rather than a
 * replacement, every model stays in the chain, so failover semantics are preserved.
 */
function applyModelRandomizer(pool: FallbackEntry[], enabled: boolean): void {
  if (!enabled || pool.length <= 1) {
    return;
  }
  const leadIdx = Math.floor(Math.random() * pool.length);
  pool.unshift(...pool.splice(leadIdx, 1));
}

/**
 * Applies the server's own admissions to the route a personal turn is about to borrow.
 *
 * Planning skipped both of them because the personal route was paying: the message-trigger
 * cooldown and the text quota. The server's model is exempt from neither, and a refusal here
 * contributes no attempts, so the personal failure stays the outcome.
 */
async function admitServerRoute(context: ChatTurnContext): Promise<boolean> {
  if (!(await admitServerRouteCooldown(context))) {
    return false;
  }
  return await admitServerRouteTextQuota(context);
}

/**
 * Applies the server's message-trigger cooldown, which planning only runs for server-sourced turns.
 *
 * Without it a broken personal provider would buy a server reply on every message within reach of
 * the server's quota, and a server that leaves quota off would never stop at all.
 */
async function admitServerRouteCooldown(context: ChatTurnContext): Promise<boolean> {
  const incoming = context.turn.lockedTurn.admission.incoming;
  // The exemptions planning applies: a stop response, a persona job that shares its group's
  // admission, and the bot's own message (same predicate that produced `turn.isSelfMessage`).
  if (incoming.isStopResponse || incoming.isPersonaJob || context.isSelfMessage) {
    return true;
  }

  const allowed = await enforceServerTriggerCooldownForAdmission({
    serverDiscId: context.serverDiscId,
    cooldownUserDiscId: context.turn.lockedTurn.admission.cooldownUserDiscId ?? context.userDiscId,
    message: context.message,
    tomoriState: context.currentPersona,
    locale: context.locale,
    notifyUser: context.shouldSurfaceUserErrors,
  });
  if (!allowed) {
    log.info(
      `Refusing the server model fallback for user ${context.userDiscId}: the server's message cooldown is active.`,
    );
  }
  return allowed;
}

/**
 * Admits the server route against the server's text quota and arms the post-turn consumption.
 *
 * Planning exempts a personal turn from server text quota because it spends the user's own
 * credentials, so this turn arrives unadmitted. The server's model is not exempt: without this the
 * fallback would answer on quota nobody checked and nobody paid.
 */
async function admitServerRouteTextQuota(context: ChatTurnContext): Promise<boolean> {
  const incoming = context.turn.lockedTurn.admission.incoming;
  if (!shouldApplyServerTextQuota(incoming, context.isDMChannel)) {
    return true;
  }

  // The embed is sent once for the trigger: a refusal grants nothing, so a later persona turn in
  // the same reply would otherwise re-check and re-post the same notice.
  const alreadyReported = hasTextQuotaBeenRefused(context.textQuotaTriggerKey);

  const quota = await checkTextQuotaForAdmission({
    shouldApplyTextQuota: true,
    // A persona job normally reuses its group's admission, but a group whose earlier turns all ran
    // on personal credentials has none yet, so this turn has to take the check itself.
    isPersonaJob: false,
    triggerKey: context.textQuotaTriggerKey,
    serverId: context.currentPersona.server_id,
    userDiscId:
      incoming.textQuotaUserDiscId ?? context.turn.lockedTurn.admission.cooldownUserDiscId ?? context.userDiscId,
    channel: context.channel as SendableChannel,
    locale: context.locale,
    notifyUser: context.shouldSurfaceUserErrors && !alreadyReported,
  });

  if (!quota.allowed) {
    markTextQuotaRefused(context.textQuotaTriggerKey);
    log.info(`Refusing the server model fallback for user ${context.userDiscId}: the server text quota is exhausted.`);
    return false;
  }

  context.shouldApplyTextQuota = true;
  context.textQuotaState = quota.state;
  return true;
}

// Must run before provider.createConfig : providers eagerly attach the full tool
// list and the streaming path won't strip them if has_tools flips later.
function applyDeliberateToolKillSwitch(state: TomoriState, disableAllTools: boolean): TomoriState {
  if (disableAllTools && state.llm.has_tools) {
    return { ...state, llm: { ...state.llm, has_tools: false } };
  }
  return state;
}

function getRetryExcludedKeyIds(excludedKeyIds: Set<number>, rotationKeyId: number | null): number[] {
  const ids = new Set(excludedKeyIds);
  if (rotationKeyId != null) {
    ids.add(rotationKeyId);
  }
  return [...ids];
}

/**
 * A destination the bot cannot post into fails for every key and every model alike, whether the
 * channel was deleted or access to it was revoked.
 *
 * Retrying would burn a full generation per fallback arm and then discard it at the same send.
 * The classifier is shared with the send path so the "retrying cannot help" set has one
 * definition. A refused send after a permission change or a timeout is deliberately excluded: it
 * can clear on its own, so it keeps its fallback arms.
 *
 * The reason arrives as a stop more often than as an error, because the send path raises the stop
 * itself, so both routes are read here rather than depending on the status alone. An error-level
 * result keeps its fallback arms unless this says otherwise, and a 50001 that reached the turn as
 * data would otherwise be retried across every arm.
 */
function isUnreachableDestinationResult(result: GenerationTurnResult): boolean {
  return result.streamResults.some((streamResult) => {
    const classified = classifySendFailure(streamResult.data);
    return (
      classified === "channel_gone" ||
      classified === "missing_access" ||
      streamResult.stopReason === "channel_deleted" ||
      streamResult.stopReason === "missing_access"
    );
  });
}

/**
 * Whether an empty continuation is a failure the turn-level retry repairs (output-token cap,
 * speaker-guard discard, held NovelAI fragment) rather than the model having nothing to add.
 */
function isRetryableEmptyResponse(result: GenerationTurnResult): boolean {
  const streamResult = result.streamResults.at(-1);
  const data = streamResult?.data as { finishReason?: unknown; emptyResponseReason?: unknown } | undefined;
  return (
    Boolean(streamResult?.naiContinuationPrefill) ||
    data?.finishReason === "length" ||
    data?.emptyResponseReason === "speaker_guard"
  );
}

async function emitStreamErrors(responseSink: ChatResponseSink, streamResults: StreamResult[]): Promise<void> {
  for (const streamResult of streamResults) {
    if (streamResult.status === "error") {
      await responseSink.emitStreamResult(streamResult);
    }
  }
}

async function sendFallbackNoticeIfNeeded(
  context: ChatTurnContext,
  attempt: GenerationAttempt,
  failures: FallbackNoticeAttempt[],
  options: { offerPersonalFallbackOptOut: boolean },
): Promise<void> {
  if (context.isUserImpersonation || failures.length === 0 || !context.shouldSurfaceUserErrors) {
    return;
  }

  await sendFallbackModelUsageNotice({
    context: {
      channel: context.channel as ToolContext["channel"],
      client: context.client,
      message: context.message,
      tomoriState: context.tomoriState,
      locale: context.locale,
      provider: attempt.provider.getInfo().name,
      webhook: context.responseTarget?.webhook,
      personaUsername: context.responseTarget?.personaUsername,
      personaAvatarUrl: context.responseTarget?.personaAvatarUrl,
    },
    failures,
    successModel: attempt.successModel,
    offerPersonalFallbackOptOut: options.offerPersonalFallbackOptOut,
  });
}

/**
 * Sends the timeout notice an attempt deferred while a model fallback was still pending.
 *
 * Only reaches the caller when nothing followed that attempt, which is exactly the case where the
 * user would otherwise see no reason for the silence.
 */
async function sendDeferredTimeoutNoticeIfPending(context: ChatTurnContext): Promise<void> {
  const notice = context.streamingContext.deferredTimeoutNotice;
  if (!notice) {
    return;
  }
  context.streamingContext.deferredTimeoutNotice = undefined;
  // The tool loop also defers on turns that suppress errors on purpose, such as auto-chat and
  // random triggers nobody addressed directly, and a bot-authored embed breaks an impersonation.
  // Those turns stayed silent before deferral existed and must stay silent here.
  if (context.isUserImpersonation || !context.shouldSurfaceUserErrors || context.supporterProviderFailure) {
    return;
  }

  await sendStreamTimeoutNotice({
    channel: context.channel as SendableChannel,
    locale: context.locale,
    providerName: notice.providerName,
    textCredentialSource: context.streamingContext.textCredentialSource,
    sawStreamProgress: notice.sawStreamProgress,
  });
}

function shouldSendFallbackNotice(context: ChatTurnContext, result: GenerationTurnResult): boolean {
  if (result.status !== "completed") {
    return false;
  }

  if (!StreamOrchestrator.hasStopRequest(context.channel.id)) {
    return true;
  }

  log.info(
    `Skipping fallback model notice for channel ${context.channel.id} because a stop or follow-up interrupt is pending.`,
  );
  StreamOrchestrator.clearStopRequest(context.channel.id);
  return false;
}

/**
 * Which routing rules a resolved state should draw on.
 *
 * `planned` is the route the turn was planned on: a personal text route applies the
 * personal-provider overlay and ignores the channel override, and every other turn resolves the
 * server route exactly as `server` does. `server` is the route a personal turn falls back to, which
 * never applies the overlay.
 */
type TextRoute = "planned" | "server";

async function resolveTomoriStateForRoute(context: ChatTurnContext, route: TextRoute): Promise<TomoriState> {
  const incoming = context.turn.lockedTurn.admission.incoming;
  const funding = context.supporterFunding;
  const usePersonalRoute =
    route === "planned" && (context.textCredentialSource === "personal" || funding?.fundingScope === "personal");
  const base = usePersonalRoute
    ? (
        await applyPersonalProviderSelectionsToTomoriState(
          context.currentPersona,
          context.personalRoutingUserId,
          context.personalTextProvider === "supporter",
        )
      ).tomoriState
    : context.currentPersona;
  const overriddenLlm = usePersonalRoute
    ? incoming.llmOverrideCodename
      ? ((await llmModelRepo.loadByProviderAndCodename(base.llm.llm_provider, incoming.llmOverrideCodename)) ?? {
          ...base.llm,
          llm_codename: incoming.llmOverrideCodename,
        })
      : base.llm
    : await resolveServerTextModel(base, context.channel, context.isUserImpersonation, incoming.llmOverrideCodename);
  if (
    route === "planned" &&
    context.textCredentialSource === "supporter" &&
    overriddenLlm.llm_provider === "openrouter"
  ) {
    if (funding?.modelCodename === overriddenLlm.llm_codename) {
      return buildSupporterPrimaryTomoriState({
        baseState: base,
        funding,
        loadModel: (provider, codename) => llmModelRepo.loadByProviderAndCodename(provider, codename),
      });
    }
    return { ...base, llm: overriddenLlm, config: { ...base.config, api_key: null } };
  }

  let state: TomoriState = { ...base, llm: overriddenLlm };

  if (overriddenLlm.llm_provider.toLowerCase() !== base.llm.llm_provider.toLowerCase()) {
    state = await applySavedProviderConfig(state, overriddenLlm.llm_provider);
  }

  return state;
}

async function createFallbackAttempt(
  context: ChatTurnContext,
  primaryState: TomoriState,
  entry: FallbackEntry,
  fallbackIndex: number,
  disableAllTools: boolean,
  personalUserId: number | null,
  funding: SupporterFundingContext | null,
): Promise<GenerationAttempt | null> {
  if (entry.kind === "llm" && entry.credentialProvider === "supporter") {
    if (!isSupporterBillingEnabled(resolveEnvironment()) || entry.model.llm_provider.toLowerCase() !== "openrouter")
      return null;
    if (entry.model.is_deprecated) return null;
    const resolvedFunding =
      funding?.modelCodename === entry.model.llm_codename
        ? { ok: true as const, context: funding }
        : await resolveSupporterFunding({
            scope:
              personalUserId === null
                ? { kind: "server", serverId: primaryState.server_id }
                : { kind: "personal", userId: personalUserId },
            capability: "text",
            requestedModelCodename: entry.model.llm_codename,
          });
    if (!resolvedFunding.ok)
      throw new SupporterRequestDeniedError(
        resolvedFunding.reason,
        undefined,
        "text",
        personalUserId === null ? "server" : "personal",
      );
    const supporterState = buildSupporterFallbackTomoriState(primaryState, entry);
    if (!supporterState) {
      log.warn("Skipping custom endpoint fallback: Supporter routing requires OpenRouter.");
      return null;
    }
    const label = `fallback ${fallbackIndex}: ${entry.model.llm_codename}`;
    return await createAttempt(
      context,
      label,
      supporterState,
      undefined,
      disableAllTools,
      resolvedFunding.context,
      "supporter",
    );
  }

  if (entry.kind === "custom_endpoint") {
    const endpointServerId = personalUserId === null ? primaryState.server_id : null;
    if (
      (entry.endpoint.user_id ?? null) !== personalUserId ||
      (entry.endpoint.server_id ?? null) !== endpointServerId
    ) {
      return null;
    }
    if (!entry.endpoint.connection_id) {
      log.warn(`Skipping custom endpoint fallback ${entry.endpoint.label}: missing connection_id.`);
      return null;
    }
    const customProviderName = buildCustomProviderName(entry.endpoint.connection_id);
    const endpointUserId = entry.endpoint.user_id ?? null;
    const savedConfig = endpointUserId
      ? await llmProviderRepo.loadUserSavedProviderConfig(endpointUserId, customProviderName)
      : await llmProviderRepo.loadSavedProviderConfig(primaryState.server_id, customProviderName);
    if (!savedConfig?.api_key) {
      log.warn(`Skipping custom endpoint fallback ${entry.endpoint.label}: no saved key.`);
      return null;
    }

    const state: TomoriState = {
      ...primaryState,
      config: {
        ...primaryState.config,
        api_key: savedConfig.api_key,
        key_version: savedConfig.key_version ?? 1,
        custom_endpoint_url: entry.endpoint.endpoint_url,
        custom_model_name: entry.endpoint.model_name ?? null,
        custom_num_ctx: entry.endpoint.num_ctx ?? null,
      },
      llm: {
        ...primaryState.llm,
        llm_id: entry.endpoint.model_ref_id ?? primaryState.llm.llm_id,
        llm_codename: entry.endpoint.model_name ?? entry.endpoint.label,
        llm_provider: customProviderName,
        has_tools: entry.endpoint.has_tools,
        sees_images: entry.endpoint.sees_images,
        sees_videos: entry.endpoint.sees_videos,
        supports_structoutput: entry.endpoint.supports_structoutput,
        strict_role_alternation: entry.endpoint.strict_role_alternation,
        supports_prefix_completion: entry.endpoint.supports_prefix_completion,
        supports_assistant_prefill: entry.endpoint.supports_assistant_prefill,
        verbatim_tool_calling: entry.endpoint.verbatim_tool_calling,
      },
    };
    return await createAttempt(
      context,
      `fallback ${fallbackIndex}: ${entry.endpoint.label}`,
      state,
      "custom",
      disableAllTools,
      null,
      personalUserId ? "personal" : "server",
    );
  }

  let state: TomoriState = { ...primaryState, llm: entry.model };
  if (
    funding ||
    primaryState.config.api_key === null ||
    entry.model.llm_provider.toLowerCase() !== primaryState.llm.llm_provider.toLowerCase()
  ) {
    const recredentialed = await applyCrossProviderConfig(state, entry.model.llm_provider, personalUserId);
    if (!recredentialed) {
      log.warn(
        `Skipping fallback ${entry.model.llm_codename}: no ${personalUserId ? "personal" : "server"} key saved for provider ${entry.model.llm_provider}.`,
      );
      return null;
    }
    state = recredentialed;
  }
  return await createAttempt(
    context,
    `fallback ${fallbackIndex}: ${entry.model.llm_codename}`,
    state,
    undefined,
    disableAllTools,
    null,
    personalUserId ? "personal" : "server",
  );
}

async function createAttempt(
  context: ChatTurnContext,
  label: string,
  tomoriState: TomoriState,
  forcedProviderName?: string,
  disableAllTools = false,
  funding: SupporterFundingContext | null = null,
  credentialSource: TextCredentialSource = context.textCredentialSource,
): Promise<GenerationAttempt> {
  const effectiveState = applyDeliberateToolKillSwitch(tomoriState, disableAllTools);

  const provider = forcedProviderName
    ? await ProviderFactory.getProviderByName(forcedProviderName)
    : await getProviderForTomori(effectiveState);

  if (funding) {
    const providerConfig = await resolveSupporterManagedProviderConfig(provider, effectiveState, {
      funding,
    });
    return {
      credentialSource,
      funding,
      label,
      tomoriState: effectiveState,
      provider,
      providerConfig,
      successModel: effectiveState.llm,
      rotationKeyId: null,
    };
  }

  const rotationSelection = credentialSource === "server" ? await selectApiKey(effectiveState) : null;
  const apiKey = rotationSelection ? rotationSelection.apiKey : await resolveApiKey(effectiveState);
  const rotationKeyId = rotationSelection?.rotationKeyId ?? null;

  const providerConfig = await provider.createConfig(effectiveState, apiKey);

  return {
    credentialSource,
    funding: null,
    label,
    tomoriState: effectiveState,
    provider,
    providerConfig,
    successModel: effectiveState.llm,
    rotationKeyId,
  };
}

async function resolveApiKey(tomoriState: TomoriState): Promise<string> {
  const encryptedKey = tomoriState.config.api_key;
  if (!encryptedKey) {
    throw new Error("API key is not configured for the selected text provider.");
  }

  return await decryptApiKey(encryptedKey, tomoriState.config.key_version || 1);
}

/**
 * Re-credentials a fallback attempt whose model belongs to a different provider
 * than the primary's.
 *
 * A personal-routed turn resolves against the user's own saved providers and
 * never falls through to the server's, so a chain the user configured cannot
 * silently spend the server owner's key. Returns null when no key exists in the
 * applicable scope, which drops the entry from the pool.
 */
async function applyCrossProviderConfig(
  tomoriState: TomoriState,
  providerName: string,
  personalUserId: number | null,
): Promise<TomoriState | null> {
  const provider = providerName.toLowerCase();
  const savedConfig = personalUserId
    ? await llmProviderRepo.loadUserSavedProviderConfig(personalUserId, provider)
    : await llmProviderRepo.loadSavedProviderConfig(tomoriState.server_id, provider);

  return savedConfig?.api_key ? withSavedProviderConfig(tomoriState, savedConfig) : null;
}

/**
 * Server-scoped variant for the primary attempt, which cannot be skipped the way a
 * fallback entry can and so raises instead of returning null.
 */
async function applySavedProviderConfig(tomoriState: TomoriState, providerName: string): Promise<TomoriState> {
  const state = await applyCrossProviderConfig(tomoriState, providerName, null);
  if (!state) {
    throw new Error(`No saved credentials found for provider ${providerName}.`);
  }

  return state;
}

function extractErrorCode(streamResult: StreamResult | undefined): string {
  const data = streamResult?.data;
  if (!data || typeof data !== "object") {
    return streamResult?.status ?? "unknown";
  }
  if (data instanceof Error) {
    return data.message || "error";
  }
  const record = data as Record<string, unknown>;
  return String(record.code ?? record.type ?? record.message ?? streamResult?.status ?? "unknown");
}

/**
 * Classified failure reason for the public "Fallback Model Used" notice. Context assembly reads
 * the notice back for the model, and an endpoint can echo request headers in its message, so the
 * upstream text stays in the operator log the error path already wrote.
 * @param streamResult - The last stream result recorded for the failed attempt.
 */
function extractErrorDetail(streamResult: StreamResult | undefined): string {
  const data = streamResult?.data;
  if (data && typeof data === "object" && !(data instanceof Error) && "type" in data) {
    const error = data as ProviderError;
    return `${formatProviderErrorCodeForDisplay(error.type)} (${formatProviderErrorCodeForDisplay(error.code)})`;
  }
  return streamResult?.status ?? "unknown";
}

async function prepareProviderContextItems(args: {
  contextItems: StructuredContextItem[];
  tomoriState: TomoriState;
  deliberateToolAllowedNames: string[] | undefined;
}): Promise<StructuredContextItem[]> {
  let contextItems = await resolveMediaForModel(args.contextItems, args.tomoriState, args.deliberateToolAllowedNames);

  // Verbatim prompt scaffolding is decided once, against the primary model, but every attempt
  // carries its own provider and parser. Adapt the shared base per attempt so a fallback in either
  // direction gets the shape its own adapter understands. `filter` and the spread helpers below
  // produce new arrays, leaving the shared base intact for the other attempts.
  //
  // Each half is checked and applied independently: the schema dump is dropped when no tools resolve
  // (or resolution throws), so a context can carry the nudge without it. Keying the whole decision on
  // the dump alone would then leave the nudge on a native attempt, or inject a second copy of it.
  const attemptNeedsVerbatim = shouldInjectVerbatimToolCallingNudge(args.tomoriState);
  if (attemptNeedsVerbatim) {
    // A verbatim attempt needs both halves. The native-primary -> custom-fallback case reaches here
    // with neither: without them the custom model receives no tool schemas and no calling-format
    // instructions, so every tool (voice messages included) fails.
    if (!contextItems.some((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS)) {
      const toolItem = await buildVerbatimToolDefinitionsContextItem({ tomoriState: args.tomoriState });
      if (toolItem) {
        contextItems = injectVerbatimToolDefinitionsItem(contextItems, toolItem);
      }
    }
    if (!contextItems.some(isVerbatimNudgeItem)) {
      contextItems = injectVerbatimNudgeItem(contextItems);
    }
  } else if (contextItems.some(isAnyVerbatimItem)) {
    // Verbatim-primary -> native-fallback. Both halves must go: the schema dump alone would leave
    // conflicting text-form instructions beside the native tool payload, and this provider has no
    // verbatim parser to execute whatever the model then writes into chat.
    contextItems = stripAllVerbatimItems(contextItems);
  }
  return contextItems;
}

/**
 * Trims history to the attempt's budget with the prefill's tokens reserved. The prefill is left out
 * of the list itself because an instruction-mode directive is a dialogue user turn, which the
 * truncator would protect as the newest request in place of the real trigger.
 */
async function fitProviderContextBudget(args: {
  contextItems: StructuredContextItem[];
  reservedTailItems: StructuredContextItem[];
  tomoriState: TomoriState;
  serverDiscId: string;
  emptyResponseFinishReason: string | null | undefined;
  retryCount: number;
}): Promise<StructuredContextItem[]> {
  let contextItems = await applyProviderContextTruncation(
    args.contextItems,
    args.tomoriState,
    args.serverDiscId,
    args.reservedTailItems,
  );
  if (
    shouldApplyLengthEmptyRetryTrim(args.tomoriState.llm.llm_provider, args.emptyResponseFinishReason, args.retryCount)
  ) {
    const requestedPairDrops = OPENROUTER_LENGTH_EMPTY_RETRY_DROP_PAIRS * args.retryCount;
    const { truncated, historyPairsDropped } = dropOldestHistoryExchangePairs(contextItems, requestedPairDrops);
    if (historyPairsDropped > 0) {
      log.warn(
        `OpenRouter length-empty retry trimming: dropped ${historyPairsDropped}/${requestedPairDrops} oldest history exchange pair(s) on retry ${args.retryCount}.`,
      );
      contextItems = truncated;
    }
  }
  return contextItems;
}

/**
 * The exact text the verbatim nudge is rendered as inside a context-note item
 * (see `appendDialogueHistoryContext`). Matching on the text rather than the tag
 * is required because the user's global context note shares
 * `ContextItemTag.CONTEXT_NOTE_INJECTION`.
 */
const VERBATIM_NUDGE_CONTEXT_TEXT = `[System: ${VERBATIM_TOOL_CALLING_NUDGE}]`;

function isVerbatimNudgeItem(item: StructuredContextItem): boolean {
  if (item.metadataTag !== ContextItemTag.CONTEXT_NOTE_INJECTION) {
    return false;
  }
  const text = item.parts.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");
  return text === VERBATIM_NUDGE_CONTEXT_TEXT;
}

/** Either half of the verbatim scaffolding, which are toggled together across the fallback chain. */
function isAnyVerbatimItem(item: StructuredContextItem): boolean {
  return item.metadataTag === ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS || isVerbatimNudgeItem(item);
}

/** Returns a new array with both verbatim halves removed: the schema dump and the nudge note. */
function stripAllVerbatimItems(items: StructuredContextItem[]): StructuredContextItem[] {
  return items.filter((item) => !isAnyVerbatimItem(item));
}

/**
 * Inserts the schema dump ahead of the first dialogue item, the same side of the dialogue boundary
 * that stage 07b occupies in a natively-built context. It lands later than that stage's own slot
 * (which sits ahead of server documents) because the pre-dialogue region cannot be re-derived here.
 */
function injectVerbatimToolDefinitionsItem(
  items: StructuredContextItem[],
  toolItem: StructuredContextItem,
): StructuredContextItem[] {
  const firstDialogueIndex = items.findIndex((item) => item.metadataTag === ContextItemTag.DIALOGUE_HISTORY);
  const insertionIndex = firstDialogueIndex >= 0 ? firstDialogueIndex : items.length;
  return [...items.slice(0, insertionIndex), toolItem, ...items.slice(insertionIndex)];
}

/**
 * Inserts the nudge note near the dialogue tail, `VERBATIM_TOOL_CALLING_CONTEXT_DEPTH` dialogue items
 * from the end.
 *
 * This counts `DIALOGUE_HISTORY` items, not messages, so date spacers and detached system parts
 * inflate the count and pull the note slightly earlier than the message-indexed placement stage 11
 * uses. The note only has to sit near the tail to steer the next call; exact index parity is not
 * load-bearing, and the count is the only one recoverable from an already-assembled context.
 */
function injectVerbatimNudgeItem(items: StructuredContextItem[]): StructuredContextItem[] {
  const nudgeItem: StructuredContextItem = {
    role: "user",
    parts: [{ type: "text", text: VERBATIM_NUDGE_CONTEXT_TEXT }],
    metadataTag: ContextItemTag.CONTEXT_NOTE_INJECTION,
  };
  const dialogueItemCount = items.filter((item) => item.metadataTag === ContextItemTag.DIALOGUE_HISTORY).length;
  const targetDialogueIndex = Math.max(0, dialogueItemCount - VERBATIM_TOOL_CALLING_CONTEXT_DEPTH);

  let dialogueSeen = 0;
  let insertionIndex = items.length;
  for (const [index, item] of items.entries()) {
    if (item.metadataTag !== ContextItemTag.DIALOGUE_HISTORY) {
      continue;
    }
    if (dialogueSeen === targetDialogueIndex) {
      insertionIndex = index;
      break;
    }
    dialogueSeen += 1;
  }
  return [...items.slice(0, insertionIndex), nudgeItem, ...items.slice(insertionIndex)];
}

function dropOldestHistoryExchangePairs(
  contextItems: StructuredContextItem[],
  pairsToDrop: number,
): { truncated: StructuredContextItem[]; historyPairsDropped: number } {
  if (pairsToDrop <= 0) {
    return { truncated: contextItems, historyPairsDropped: 0 };
  }

  const items = [...contextItems];
  let historyPairsDropped = 0;
  while (historyPairsDropped < pairsToDrop) {
    const oldestHistoryIndex = items.findIndex((item) => item.metadataTag === ContextItemTag.DIALOGUE_HISTORY);
    if (oldestHistoryIndex < 0) {
      break;
    }
    const followingModelIndex = items.findIndex(
      (item, index) =>
        index > oldestHistoryIndex && item.metadataTag === ContextItemTag.DIALOGUE_HISTORY && item.role === "model",
    );
    if (followingModelIndex > oldestHistoryIndex) {
      items.splice(oldestHistoryIndex, followingModelIndex - oldestHistoryIndex + 1);
    } else {
      items.splice(oldestHistoryIndex, 1);
    }
    historyPairsDropped++;
  }

  return { truncated: items, historyPairsDropped };
}

function shouldApplyLengthEmptyRetryTrim(
  providerName: string,
  emptyResponseFinishReason: string | null | undefined,
  retryCount: number,
): boolean {
  return emptyResponseFinishReason === "length" && retryCount > 0 && providerIsApiFamily(providerName, "openrouter");
}
