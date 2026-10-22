import type {
  DecisionInput,
  DecisionModelReference,
  DecisionResult,
  DecisionApiStyle,
  GeneratePresetParams,
  PresetGenerationResult,
  CompactConversationResult,
  ProviderCompactSummaryRequest as ProviderCapabilityCompactSummaryRequest,
  ProviderPresetGenerationRequest as ProviderCapabilityPresetGenerationRequest,
  StructuredOutputResult,
} from "@/types/provider/featureInterfaces";
import { decisionModelReferenceSchema } from "@/types/provider/featureInterfaces";
import type { OpenRouterModelScope } from "@/utils/db/repositories/LlmModelRepository";
import { llmModelRepo } from "@/utils/db/repositories/LlmModelRepository";
import { llmProviderRepo } from "@/utils/db/repositories/LlmProviderRepository";
import { loadCustomConnectionCredential } from "@/utils/provider/customEndpointService";
import { parseCustomProvider } from "@/utils/provider/customProviderUtils";
import { decryptApiKey } from "@/utils/security/crypto";
import { decisionTrace, reportDecisionFailure, validDecisionInput } from "@/providers/utils/decisions";
import {
  buildExpressionResponseSchema,
  type ExpressionBatchResult,
  ExpressionBatchResultSchema,
} from "@/providers/utils/structuredOutput";
import {
  buildHistoryExtractionResponseSchema,
  HistoryExtractionResultSchema,
  type HistoryMemoryEntry,
} from "@/providers/utils/historyExtractionSchema";
import type { TomoriState } from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import { log } from "@/utils/misc/logger";
import {
  resolveConversationCompactionCapability,
  resolvePresetGenerationCapability,
  resolveStructuredOutputCapability,
  resolveDecisionsCapability,
} from "@/utils/provider/providerCapabilityResolver";
import { isSupporterBillingEnabled } from "@/modules/supporter-billing/config";
import { resolveEnvironment } from "@/types/config";
import { resolveSupporterFunding } from "@/modules/supporter-billing/runtime/funding";
import { resolveSupporterCapabilityCredentials } from "@/modules/supporter-billing/runtime/managedProvider";
import { recordSupporterUsage } from "@/modules/supporter-billing/runtime/usageStatistics";
import {
  findSupporterRequestDeniedError,
  SupporterRequestDeniedError,
} from "@/modules/supporter-billing/runtime/funding";
import type { SupporterFundingContext } from "@/modules/supporter-billing/runtime/types";
import { supporterSponsorshipRepository } from "@/modules/supporter-billing/db";

export interface DecisionExecutionRequest extends DecisionInput {
  scope: OpenRouterModelScope;
  reference: DecisionModelReference | null;
  supporterFunding?: SupporterFundingContext;
}

export async function loadDecisionModelsForScope(scope: OpenRouterModelScope) {
  const funding = await resolveSupporterFunding({
    scope:
      scope.kind === "server"
        ? { kind: "server", serverId: scope.ownerId }
        : { kind: "personal", userId: scope.ownerId },
    capability: "decision",
  });
  return llmModelRepo.loadDecisionModelOptions(scope, funding.ok);
}

export async function callDecisionsForProvider(request: DecisionExecutionRequest): Promise<DecisionResult> {
  const correlationId = crypto.randomUUID();
  const startedAt = Date.now();
  if (!request.reference) return { status: "unavailable", reason: "not-selected", correlationId, errorLogged: false };
  if (!decisionModelReferenceSchema.safeParse(request.reference).success || !validDecisionInput(request)) {
    return { status: "invalid-input", correlationId, errorLogged: false };
  }
  const reference = request.reference;
  if (
    reference.provider === "openrouter" &&
    request.supporterFunding &&
    !isSupporterBillingEnabled(resolveEnvironment())
  )
    return {
      status: "denied",
      error: new SupporterRequestDeniedError("unsupported_capability", undefined, "decision", request.scope.kind),
      correlationId,
      errorLogged: false,
    };
  if (
    request.supporterFunding &&
    (request.supporterFunding.fundingScope !== request.scope.kind ||
      (request.scope.kind === "personal" && request.supporterFunding.personalUserId !== request.scope.ownerId))
  )
    return { status: "unavailable", reason: "not-owned", correlationId, errorLogged: false };
  let apiStyle: DecisionApiStyle = reference.provider === "openrouter" ? "openrouter-decisions" : "system-one";
  const trace = () => ({ reference, apiStyle, correlationId });
  const cancelled = (): DecisionResult => {
    decisionTrace(trace(), "cancelled", { questionCount: request.questions.length, elapsedMs: Date.now() - startedAt });
    return { status: "cancelled", correlationId, errorLogged: false };
  };
  if (request.abortSignal?.aborted) return cancelled();
  try {
    const options = await loadDecisionModelsForScope(request.scope);
    const selected = options.find(
      (option) =>
        option.reference.provider === reference.provider &&
        option.reference.modelId === reference.modelId &&
        option.reference.registrationId === reference.registrationId &&
        option.reference.customEndpointId === reference.customEndpointId,
    );
    if (!selected) return { status: "unavailable", reason: "not-owned", correlationId, errorLogged: false };
    const custom = parseCustomProvider(reference.provider);
    const connection = custom ? await llmProviderRepo.loadCustomEndpointConnectionById(custom.connectionId) : null;
    if (
      custom &&
      (!connection ||
        connection.capability !== "decision" ||
        (request.scope.kind === "server"
          ? connection.server_id !== request.scope.ownerId || connection.user_id != null
          : connection.user_id !== request.scope.ownerId || connection.server_id != null) ||
        (connection.api_style !== "system-one" && connection.api_style !== "openai-decisions"))
    ) {
      return { status: "unavailable", reason: "not-owned", correlationId, errorLogged: false };
    }
    if (connection?.api_style === "system-one" || connection?.api_style === "openai-decisions")
      apiStyle = connection.api_style;
    const failureContext = {
      errorType: "DecisionOperationFailed",
      metadata: {
        operation: "decision-request",
        stage: "resolution",
        category: "credentials",
        provider: custom ? "custom" : "openrouter",
        apiStyle,
        modelId: reference.modelId,
        registrationId: reference.registrationId,
        customEndpointId: reference.customEndpointId,
        correlation: correlationId,
        elapsedMs: Date.now() - startedAt,
      },
    };
    let apiKey: string | null = null;
    let memberFunding: SupporterFundingContext | null = null;
    if (
      reference.provider === "openrouter" &&
      isSupporterBillingEnabled(resolveEnvironment()) &&
      (request.supporterFunding ||
        (request.scope.kind === "server" &&
          (await supporterSponsorshipRepository.loadActiveSponsorshipForServer(request.scope.ownerId))))
    ) {
      const managed = await resolveSupporterCapabilityCredentials({
        scope:
          request.scope.kind === "server"
            ? { kind: "server", serverId: request.scope.ownerId }
            : { kind: "personal", userId: request.scope.ownerId },
        capability: "decision",
        modelId: selected.model.decision_model_id,
      }).catch((error: unknown) => {
        if (error instanceof SupporterRequestDeniedError && error.reason === "model_not_allowed") return null;
        throw error;
      });
      if (managed) {
        apiKey = managed.apiKey;
        memberFunding = managed.funding;
      }
    }
    try {
      if (connection) apiKey = await loadCustomConnectionCredential(connection, failureContext);
      else if (!apiKey) {
        const nativeConfig =
          request.scope.kind === "server"
            ? await llmProviderRepo.loadSavedProviderConfig(request.scope.ownerId, reference.provider)
            : await llmProviderRepo.loadUserSavedProviderConfig(request.scope.ownerId, reference.provider);
        apiKey = nativeConfig?.api_key
          ? await decryptApiKey(nativeConfig.api_key, nativeConfig.key_version, failureContext)
          : null;
      }
    } catch {
      // Credential decryption reports its safe cause with the operation context before throwing.
      return { status: "failed", category: "credentials", correlationId, errorLogged: true };
    }
    if (request.abortSignal?.aborted) return cancelled();
    if (!apiKey && (!connection || connection.requires_auth)) {
      return await reportDecisionFailure(trace(), "credentials", "resolution", startedAt);
    }
    const capability = await resolveDecisionsCapability(custom ? "custom" : reference.provider);
    if (!capability) return { status: "unavailable", reason: "unsupported", correlationId, errorLogged: false };
    const result = await capability.callDecisions({
      ...request,
      reference,
      correlationId,
      model: selected.model.codename,
      inputTokenLimit: selected.model.input_token_limit,
      apiStyle,
      apiKey,
      endpointUrl: connection?.endpoint_url,
      onUsage: (usage) => {
        request.onUsage?.(usage);
        recordSupporterUsage(memberFunding, {
          modelCodename: selected.model.codename,
          costUsd: usage.costUsd,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
      },
    });
    const denied =
      result.status === "failed"
        ? findSupporterRequestDeniedError(result.cause, memberFunding)
        : result.status === "denied"
          ? findSupporterRequestDeniedError(result.error, memberFunding)
          : null;
    return denied ? { status: "denied", error: denied, correlationId, errorLogged: false } : result;
  } catch (error) {
    if (request.abortSignal?.aborted) return cancelled();
    const denied = findSupporterRequestDeniedError(error);
    if (denied) return { status: "denied", error: denied, correlationId, errorLogged: false };
    return await reportDecisionFailure(trace(), "unexpected", "execution", startedAt);
  }
}

export interface ProviderPresetGenerationRequest {
  providerName: string;
  apiKey: string;
  tomoriState: TomoriState;
  params: GeneratePresetParams;
  locale: string;
  toolContext?: ToolContext;
  maxToolRounds?: number;
  onUsage?: (usage: import("@/utils/text/tokenEstimate").TokenUsage) => void;
}

export interface ProviderCompactSummaryRequest extends ProviderCapabilityCompactSummaryRequest {
  providerName: string;
}

export interface ProviderExpressionInitializationRequest {
  providerName: string;
  apiKey: string;
  model: string;
  endpointUrl?: string;
  systemPrompt: string;
  userPrompt: string;
  images: Array<{ url: string; name: string }>;
  temperature?: number;
  onUsage?: (usage: import("@/utils/text/tokenEstimate").TokenUsage) => void;
}

export interface ProviderHistoryExtractionRequest {
  providerName: string;
  apiKey: string;
  model: string;
  endpointUrl?: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  onUsage?: (usage: import("@/utils/text/tokenEstimate").TokenUsage) => void;
}

export async function generatePresetForProvider(
  request: ProviderPresetGenerationRequest,
): Promise<PresetGenerationResult> {
  const capability = await resolvePresetGenerationCapability(request.providerName);
  if (!capability) {
    return {
      error: `Preset generation is not implemented for provider ${request.providerName}.`,
      errorType: "MODEL_ERROR",
    };
  }

  const capabilityRequest: ProviderCapabilityPresetGenerationRequest = {
    apiKey: request.apiKey,
    locale: request.locale,
    params: request.params,
    tomoriState: request.tomoriState,
    toolContext: request.toolContext,
    maxToolRounds: request.maxToolRounds,
    onUsage: request.onUsage,
  };

  return await capability.generatePreset(capabilityRequest);
}

export async function generateConversationSummaryForProvider(
  request: ProviderCompactSummaryRequest,
): Promise<CompactConversationResult> {
  const capability = await resolveConversationCompactionCapability(request.providerName);
  if (!capability) {
    return {
      error: `Conversation compaction is not implemented for provider ${request.providerName}.`,
    };
  }

  return await capability.generateConversationSummary(request);
}

export async function callExpressionInitializationForProvider(
  request: ProviderExpressionInitializationRequest,
): Promise<StructuredOutputResult<ExpressionBatchResult>> {
  const capability = await resolveStructuredOutputCapability(request.providerName);
  if (!capability) {
    return {
      success: false,
      error: `Expression initialization is not implemented for provider ${request.providerName}.`,
    };
  }

  return await capability.callStructuredJSON(
    {
      apiKey: request.apiKey,
      model: request.model,
      endpointUrl: request.endpointUrl,
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      images: request.images,
      temperature: request.temperature,
      schemaName: "expression_batch_result",
      onUsage: request.onUsage,
    },
    buildExpressionResponseSchema(),
    ExpressionBatchResultSchema,
  );
}

/**
 * Outcome of a single history-extraction window.
 *
 * Distinguishes a genuine empty result (`ok: true` with zero entries) from a real
 * failure, so callers can tell "this window held nothing worth extracting" apart from
 * "the model/provider could not produce structured output". Collapsing both into an
 * empty array is what previously surfaced provider errors as "No Facts Extracted".
 */
export type HistoryExtractionOutcome =
  /** `discarded` counts entries the model returned that could not be validated. */
  | { ok: true; entries: HistoryMemoryEntry[]; discarded: number }
  /** `unsupported`: provider exposes no structured-output capability at all. `failed`: the call itself errored. */
  | { ok: false; reason: "unsupported" | "failed"; error: string; cause?: Error };

export async function extractHistoryWindowForProvider(
  request: ProviderHistoryExtractionRequest,
): Promise<HistoryExtractionOutcome> {
  const capability = await resolveStructuredOutputCapability(request.providerName);
  if (!capability) {
    const error = `History extraction is not implemented for provider ${request.providerName}.`;
    log.warn(error);
    return { ok: false, reason: "unsupported", error };
  }

  const responseSchema = buildHistoryExtractionResponseSchema();
  const structuredRequest = {
    apiKey: request.apiKey,
    model: request.model,
    endpointUrl: request.endpointUrl,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
    temperature: request.temperature,
    maxOutputTokens: request.maxOutputTokens,
    schemaName: "history_extraction_result",
    onUsage: request.onUsage,
  };

  const result = await capability.callStructuredJSON(structuredRequest, responseSchema, HistoryExtractionResultSchema);

  if (result.success) {
    if (result.data.discarded > 0) {
      log.warn(
        `History extraction (${request.providerName}) discarded ${result.data.discarded} malformed ` +
          `entries, keeping ${result.data.memories.length}.`,
      );
    }
    return { ok: true, entries: result.data.memories, discarded: result.data.discarded };
  }

  log.warn(`History extraction failed (${request.providerName}): ${result.error}`);
  return { ok: false, reason: "failed", error: result.error, cause: result.cause };
}
