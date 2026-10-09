import { parsePrivateStructuredOutput, privateStructuredFailure } from "@/providers/utils/structuredReview";
import type { ZodType } from "zod";
import {
  buildCustomMessages,
  buildSchemaSteeredSystemPrompt,
  callCustomChatCompletions,
  extractCustomResponseText,
  parseCustomJsonResponse,
  shouldFallbackStructuredMode,
} from "@/providers/custom/customOpenAICompatibleUtils";
import type { ProviderStructuredJsonRequest, StructuredOutputResult } from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSingleRootArraySchema(responseSchema: Record<string, unknown>): {
  rootKey: string;
  arraySchema: Record<string, unknown>;
} | null {
  const properties = responseSchema.properties;
  if (!isRecord(properties)) {
    return null;
  }

  const entries = Object.entries(properties);
  if (entries.length !== 1) {
    return null;
  }

  const [rootKey, schema] = entries[0];
  if (!isRecord(schema) || schema.type !== "array") {
    return null;
  }

  return {
    rootKey,
    arraySchema: schema,
  };
}

function getRequiredObjectKeys(schema: Record<string, unknown>): string[] {
  const required = schema.required;
  if (!Array.isArray(required)) {
    return [];
  }

  return required.filter((key): key is string => typeof key === "string");
}

function matchesArrayItemShape(value: unknown, arraySchema: Record<string, unknown>): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const itemSchema = arraySchema.items;
  if (!isRecord(itemSchema) || itemSchema.type !== "object") {
    return false;
  }

  const requiredKeys = getRequiredObjectKeys(itemSchema);
  if (requiredKeys.length === 0) {
    return false;
  }

  return requiredKeys.every((key) => key in value);
}

function matchesArrayItemListShape(value: unknown, arraySchema: Record<string, unknown>): boolean {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.length === 0 || value.every((item) => matchesArrayItemShape(item, arraySchema));
}

function normalizeExpressionItemAliases(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const normalized = { ...value };

  if (!("emotion_key" in normalized) && typeof normalized.emotion === "string") {
    normalized.emotion_key = normalized.emotion;
  }

  if (!("name" in normalized)) {
    if (typeof normalized.expression_name === "string") {
      normalized.name = normalized.expression_name;
    } else if (typeof normalized.emoji_name === "string") {
      normalized.name = normalized.emoji_name;
    } else if (typeof normalized.sticker_name === "string") {
      normalized.name = normalized.sticker_name;
    }
  }

  return normalized;
}

function normalizeStructuredResponseAliases(parsed: unknown, responseSchema: Record<string, unknown>): unknown {
  const rootArraySchema = getSingleRootArraySchema(responseSchema);
  if (!rootArraySchema) {
    return parsed;
  }

  const { rootKey } = rootArraySchema;
  if (rootKey !== "expressions") {
    return parsed;
  }

  if (Array.isArray(parsed)) {
    return parsed.map((item) => normalizeExpressionItemAliases(item));
  }

  if (!isRecord(parsed)) {
    return parsed;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (Array.isArray(value)) {
      normalized[key] = value.map((item) => normalizeExpressionItemAliases(item));
      continue;
    }

    normalized[key] = normalizeExpressionItemAliases(value);
  }

  return normalized;
}

function normalizeStructuredResponseShape(parsed: unknown, responseSchema: Record<string, unknown>): unknown {
  const rootArraySchema = getSingleRootArraySchema(responseSchema);
  if (!rootArraySchema) {
    return parsed;
  }

  const { rootKey, arraySchema } = rootArraySchema;

  if (matchesArrayItemListShape(parsed, arraySchema)) {
    return {
      [rootKey]: parsed,
    };
  }

  if (!isRecord(parsed) || rootKey in parsed) {
    return parsed;
  }

  if (matchesArrayItemShape(parsed, arraySchema)) {
    return {
      [rootKey]: [parsed],
    };
  }

  const arrayCandidates = Object.values(parsed).filter((value) => matchesArrayItemListShape(value, arraySchema));
  if (arrayCandidates.length === 1) {
    return {
      [rootKey]: arrayCandidates[0],
    };
  }

  const objectCandidates = Object.values(parsed).filter((value) => matchesArrayItemShape(value, arraySchema));
  if (objectCandidates.length === 1) {
    return {
      [rootKey]: [objectCandidates[0]],
    };
  }

  return parsed;
}

async function executeStructuredJsonRequest<T>(params: {
  request: ProviderStructuredJsonRequest;
  systemPrompt: string;
  responseSchema: Record<string, unknown>;
  zodSchema: ZodType<T>;
  responseFormat?: Record<string, unknown>;
  logLabel: string;
}): Promise<
  | { success: true; data: T }
  | {
      success: false;
      error: string;
      failure?: "transport" | "malformed" | "refusal" | "cancelled";
      httpStatus?: number;
      status?: number;
      statusText?: string;
      errorBody?: string;
    }
> {
  const messages = await buildCustomMessages({
    systemPrompt: params.systemPrompt,
    userPrompt: params.request.userPrompt,
    images: params.request.images,
  });

  const body: Record<string, unknown> = {
    ...(params.request.model !== "other-model" ? { model: params.request.model } : {}),
    messages,
    temperature: params.request.temperature ?? 1.0,
    max_tokens: params.request.maxOutputTokens ?? 8192,
    stream: false,
  };

  if (params.responseFormat) {
    body.response_format = params.responseFormat;
  }

  const response = await callCustomChatCompletions({
    endpointUrl: params.request.endpointUrl,
    apiKey: params.request.apiKey,
    body,
    logLabel: params.logLabel,
    messagesForLog: params.request.privateOutput ? undefined : (messages as Array<Record<string, unknown>>),
    abortSignal: params.request.abortSignal,
    privateOutput: params.request.privateOutput,
  });

  if (!response.success) {
    if (params.request.privateOutput)
      return privateStructuredFailure(params.request, "transport", response.error.status);
    log.error(`${params.logLabel} request failed`, new Error(response.error.errorBody), {
      errorType: "CustomStructuredJSONHttpError",
      metadata: {
        model: params.request.model,
        status: response.error.status,
        statusText: response.error.statusText,
      },
    });
    return {
      success: false,
      error:
        response.error.status === 0
          ? response.error.errorBody
          : `Custom endpoint request failed: ${response.error.status} ${response.error.statusText}`,
      status: response.error.status,
      statusText: response.error.statusText,
      errorBody: response.error.errorBody,
    };
  }

  const responseText = extractCustomResponseText(response.data.choices?.[0]?.message?.content);
  if (params.request.privateOutput)
    return parsePrivateStructuredOutput(
      params.request,
      responseText,
      params.zodSchema,
      response.data.usage,
      Boolean(response.data.choices?.[0]?.message?.refusal),
    );
  if (!responseText) {
    return {
      success: false,
      error: "Custom endpoint returned an empty response.",
    };
  }

  let parsed: unknown;
  try {
    parsed = parseCustomJsonResponse(responseText);
  } catch (parseError) {
    log.error(`${params.logLabel} parse failed`, parseError as Error, {
      errorType: "CustomStructuredJSONParseError",
      metadata: {
        model: params.request.model,
        responsePreview: responseText.slice(0, 1000),
      },
    });
    return {
      success: false,
      error: parseError instanceof Error ? parseError.message : "Invalid JSON response from custom endpoint.",
    };
  }

  const aliasNormalizedParsed = normalizeStructuredResponseAliases(parsed, params.responseSchema);
  const normalizedParsed = normalizeStructuredResponseShape(aliasNormalizedParsed, params.responseSchema);

  if (aliasNormalizedParsed !== parsed) {
    log.warn(`${params.logLabel} normalized response aliases`, {
      model: params.request.model,
      normalizationTarget: Object.keys(params.responseSchema.properties ?? {})[0] ?? null,
    });
  }

  if (normalizedParsed !== aliasNormalizedParsed) {
    log.warn(`${params.logLabel} normalized response shape`, {
      model: params.request.model,
      normalizationTarget: Object.keys(params.responseSchema.properties ?? {})[0] ?? null,
    });
  }

  const validationResult = params.zodSchema.safeParse(normalizedParsed);
  if (!validationResult.success) {
    log.error(`${params.logLabel} validation failed`, validationResult.error, {
      errorType: "CustomStructuredJSONValidationError",
      metadata: {
        model: params.request.model,
        responsePreview: responseText.slice(0, 1000),
      },
    });
    return {
      success: false,
      error: `Invalid response structure: ${validationResult.error.message}`,
    };
  }

  return {
    success: true,
    data: validationResult.data,
  };
}

export async function callCustomStructuredJSON<T>(
  request: ProviderStructuredJsonRequest,
  responseSchema: Record<string, unknown>,
  zodSchema: ZodType<T>,
): Promise<StructuredOutputResult<T>> {
  const schemaName = request.schemaName ?? "structured_output_result";

  const jsonSchemaResult = await executeStructuredJsonRequest({
    request,
    systemPrompt: request.systemPrompt,
    responseSchema,
    zodSchema,
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: schemaName,
        description: `Structured output for ${schemaName}`,
        schema: responseSchema,
      },
    },
    logLabel: "Custom structured JSON",
  });

  if (request.privateOutput) return jsonSchemaResult;
  if (jsonSchemaResult.success) {
    return {
      success: true,
      data: jsonSchemaResult.data,
    };
  }

  if (!shouldFallbackStructuredMode(jsonSchemaResult.status ?? 0, jsonSchemaResult.errorBody ?? "")) {
    return {
      success: false,
      error: jsonSchemaResult.error,
    };
  }

  log.warn("Custom structured JSON schema mode unsupported, retrying with json_object fallback.", {
    model: request.model,
    status: jsonSchemaResult.status ?? null,
  });

  const promptSteeredSystemPrompt = buildSchemaSteeredSystemPrompt(request.systemPrompt, responseSchema, schemaName);

  const jsonObjectResult = await executeStructuredJsonRequest({
    request,
    systemPrompt: promptSteeredSystemPrompt,
    responseSchema,
    zodSchema,
    responseFormat: {
      type: "json_object",
    },
    logLabel: "Custom structured JSON (json_object fallback)",
  });

  if (jsonObjectResult.success) {
    return {
      success: true,
      data: jsonObjectResult.data,
    };
  }

  if (!shouldFallbackStructuredMode(jsonObjectResult.status ?? 0, jsonObjectResult.errorBody ?? "")) {
    return {
      success: false,
      error: jsonObjectResult.error,
    };
  }

  log.warn("Custom json_object mode unsupported, retrying without response_format.", {
    model: request.model,
    status: jsonObjectResult.status ?? null,
  });

  const plainJsonResult = await executeStructuredJsonRequest({
    request,
    systemPrompt: promptSteeredSystemPrompt,
    responseSchema,
    zodSchema,
    logLabel: "Custom structured JSON (plain fallback)",
  });

  if (plainJsonResult.success) {
    return {
      success: true,
      data: plainJsonResult.data,
    };
  }

  return {
    success: false,
    error: plainJsonResult.error,
  };
}
