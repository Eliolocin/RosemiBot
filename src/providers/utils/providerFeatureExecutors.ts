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

export interface DecisionExecutionRequest extends DecisionInput {
  scope: OpenRouterModelScope;
  reference: DecisionModelReference | null;
}

export const loadDecisionModelsForScope = (scope: OpenRouterModelScope) => llmModelRepo.loadDecisionModelOptions(scope);

export async function callDecisionsForProvider(request: DecisionExecutionRequest): Promise<DecisionResult> {
  const correlationId = crypto.randomUUID();
  const startedAt = Date.now();
  if (!request.reference) return { status: "unavailable", reason: "not-selected", correlationId, errorLogged: false };
  if (!decisionModelReferenceSchema.safeParse(request.reference).success || !validDecisionInput(request)) {
    return { status: "invalid-input", correlationId, errorLogged: false };
  }
  const reference = request.reference;
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
    const nativeConfig = connection
      ? null
      : request.scope.kind === "server"
        ? await llmProviderRepo.loadSavedProviderConfig(request.scope.ownerId, reference.provider)
        : await llmProviderRepo.loadUserSavedProviderConfig(request.scope.ownerId, reference.provider);
    let apiKey: string | null;
    try {
      if (connection) apiKey = await loadCustomConnectionCredential(connection, failureContext);
      else {
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
    return await capability.callDecisions({
      ...request,
      reference,
      correlationId,
      model: selected.model.codename,
      inputTokenLimit: selected.model.input_token_limit,
      apiStyle,
      apiKey,
      endpointUrl: connection?.endpoint_url,
    });
  } catch {
    if (request.abortSignal?.aborted) return cancelled();
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
  | { ok: false; reason: "unsupported" | "failed"; error: string };

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
  return { ok: false, reason: "failed", error: result.error };
}
