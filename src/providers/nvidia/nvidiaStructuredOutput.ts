import {
  parsePrivateStructuredOutput,
  privateStructuredFailure,
  readStructuredResponse,
} from "@/providers/utils/structuredReview";
import type { z } from "zod";
import type {
  ProviderImageInput,
  ProviderStructuredJsonRequest,
  StructuredOutputResult,
} from "@/types/provider/featureInterfaces";
import { fetchAndOptimizeImage } from "@/utils/image/imageProcessor";
import { log } from "@/utils/misc/logger";
import {
  NVIDIA_CHAT_COMPLETIONS_URL,
  NVIDIA_STRUCTURED_OUTPUT_MODELS,
  NVIDIA_STRUCTURED_OUTPUT_VISION_MODELS,
} from "@/providers/nvidia/nvidiaConstants";

type NvidiaStructuredOutputRequest = ProviderStructuredJsonRequest;

type NvidiaMessage = { role: "system"; content: string } | { role: "user"; content: string | NvidiaUserContentPart[] };

type NvidiaUserContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

function buildExampleJsonFromSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") {
    return {};
  }

  const record = schema as Record<string, unknown>;

  if ("const" in record) {
    return record.const;
  }

  if (Array.isArray(record.enum) && record.enum.length > 0) {
    return record.enum[0];
  }

  if (Array.isArray(record.anyOf) && record.anyOf.length > 0) {
    return buildExampleJsonFromSchema(record.anyOf[0]);
  }

  const schemaType = record.type;
  if (schemaType === "object") {
    const properties =
      record.properties && typeof record.properties === "object" ? (record.properties as Record<string, unknown>) : {};
    const example: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      example[key] = buildExampleJsonFromSchema(value);
    }
    return example;
  }

  if (schemaType === "array") {
    return [buildExampleJsonFromSchema(record.items)];
  }

  if (schemaType === "integer" || schemaType === "number") {
    const minimum = typeof record.minimum === "number" && Number.isFinite(record.minimum) ? record.minimum : 0;
    return minimum;
  }

  if (schemaType === "boolean") {
    return false;
  }

  if (schemaType === "string") {
    return "<string>";
  }

  return {};
}

function buildNvidiaStructuredSystemPrompt(
  systemPrompt: string,
  responseSchema: Record<string, unknown>,
  schemaName?: string,
): string {
  const schemaLabel = schemaName ?? "structured_output_result";
  const exampleObject = buildExampleJsonFromSchema(responseSchema);

  return [
    systemPrompt.trim(),
    "Return a valid JSON object only.",
    `Target JSON schema for ${schemaLabel}:`,
    JSON.stringify(responseSchema, null, 2),
    "Example JSON object:",
    JSON.stringify(exampleObject, null, 2),
    "Do not include <think> tags, reasoning summaries, or any text outside the JSON.",
    "Do not wrap the JSON in markdown fences and do not add extra prose.",
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

function shouldFallbackStructuredMode(status: number, errorBody: string): boolean {
  if (status !== 400 && status !== 422) {
    return false;
  }

  const normalized = errorBody.toLowerCase();
  const mentionsStructuredOutput =
    normalized.includes("response_format") ||
    normalized.includes("json_schema") ||
    normalized.includes("json_object") ||
    normalized.includes("schema");
  const indicatesUnsupportedParam =
    normalized.includes("unsupported") ||
    normalized.includes("unknown") ||
    normalized.includes("invalid") ||
    normalized.includes("not allowed") ||
    normalized.includes("unrecognized");

  return mentionsStructuredOutput && indicatesUnsupportedParam;
}

function stripThinkBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .trim();
}

function parseNvidiaJsonResponse(text: string): unknown {
  const cleanedText = stripThinkBlocks(text);

  try {
    return JSON.parse(cleanedText);
  } catch {
    // Continue to fallback extraction attempts below.
  }

  const fencedMatch = cleanedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return JSON.parse(fencedMatch[1]);
  }

  const firstBracket = cleanedText.indexOf("[");
  const lastBracket = cleanedText.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    return JSON.parse(cleanedText.slice(firstBracket, lastBracket + 1));
  }

  const firstBrace = cleanedText.indexOf("{");
  const lastBrace = cleanedText.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(cleanedText.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("Invalid JSON response from NVIDIA.");
}

function extractResponseText(messageContent: unknown): string {
  if (typeof messageContent === "string") {
    return messageContent.trim();
  }

  if (!Array.isArray(messageContent)) {
    return "";
  }

  return messageContent
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        (part as { type?: string }).type === "text" &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("")
    .trim();
}

async function buildNvidiaUserContent(
  userPrompt: string,
  images?: ProviderImageInput[],
): Promise<string | NvidiaUserContentPart[]> {
  if (!images || images.length === 0) {
    return userPrompt;
  }

  const contentParts: NvidiaUserContentPart[] = [{ type: "text", text: userPrompt }];

  for (const image of images) {
    try {
      const optimized = await fetchAndOptimizeImage(image.url, image.mimeType);
      contentParts.push({
        type: "image_url",
        image_url: {
          url: `data:${optimized.mimeType};base64,${optimized.data}`,
        },
      });
    } catch (fetchError) {
      log.error(`Error fetching NVIDIA structured-output image ${image.name ?? image.url}`, fetchError as Error, {
        errorType: "NvidiaStructuredOutputImageFetchError",
        metadata: {
          imageName: image.name ?? null,
          imageUrl: image.url,
        },
      });
    }
  }

  return contentParts.length === 1 ? userPrompt : contentParts;
}

async function buildNvidiaMessages(params: {
  systemPrompt: string;
  userPrompt: string;
  images?: ProviderImageInput[];
}): Promise<NvidiaMessage[]> {
  return [
    {
      role: "system",
      content: params.systemPrompt,
    },
    {
      role: "user",
      content: await buildNvidiaUserContent(params.userPrompt, params.images),
    },
  ];
}

async function executeStructuredJsonRequest<T>(params: {
  request: NvidiaStructuredOutputRequest;
  systemPrompt: string;
  responseSchema: Record<string, unknown>;
  zodSchema: z.ZodType<T>;
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
  const messages = await buildNvidiaMessages({
    systemPrompt: params.systemPrompt,
    userPrompt: params.request.userPrompt,
    images: params.request.images,
  });

  const body: Record<string, unknown> = {
    model: params.request.model,
    messages,
    max_tokens: params.request.maxOutputTokens ?? 8192,
    stream: false,
    temperature: params.request.temperature ?? 1.0,
  };

  if (params.responseFormat) {
    body.response_format = params.responseFormat;
  }

  try {
    const response = await fetch(params.request.endpointUrl || NVIDIA_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.request.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: params.request.abortSignal,
    });

    if (!response.ok) {
      if (params.request.privateOutput) {
        await response.body?.cancel();
        return privateStructuredFailure(params.request, "transport", response.status);
      }
      const errorBody = await response.text();
      log.error(`${params.logLabel} request failed`, new Error(errorBody), {
        errorType: "NvidiaStructuredJSONHttpError",
        metadata: {
          model: params.request.model,
          status: response.status,
          statusText: response.statusText,
        },
      });
      return {
        success: false,
        error: response.status === 0 ? errorBody : `NVIDIA request failed: ${response.status} ${response.statusText}`,
        status: response.status,
        statusText: response.statusText,
        errorBody,
      };
    }

    const result = (await readStructuredResponse(params.request, response)) as {
      usage?: unknown;
      choices?: Array<{ message?: { content?: unknown; refusal?: unknown } }>;
    };
    const responseText = extractResponseText(result.choices?.[0]?.message?.content);
    if (params.request.privateOutput)
      return parsePrivateStructuredOutput(
        params.request,
        responseText,
        params.zodSchema,
        result.usage,
        Boolean(result.choices?.[0]?.message?.refusal),
      );
    if (!responseText) {
      return {
        success: false,
        error: "NVIDIA returned an empty structured output response.",
      };
    }

    let parsed: unknown;
    try {
      parsed = parseNvidiaJsonResponse(responseText);
    } catch (parseError) {
      log.error(`${params.logLabel} parse failed`, parseError as Error, {
        errorType: "NvidiaStructuredJSONParseError",
        metadata: {
          model: params.request.model,
          responsePreview: responseText.slice(0, 1000),
        },
      });
      return {
        success: false,
        error: parseError instanceof Error ? parseError.message : "Invalid JSON response from NVIDIA.",
      };
    }

    const validationResult = params.zodSchema.safeParse(parsed);
    if (!validationResult.success) {
      log.error(`${params.logLabel} validation failed`, validationResult.error, {
        errorType: "NvidiaStructuredJSONValidationError",
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
  } catch (error) {
    if (params.request.privateOutput) return privateStructuredFailure(params.request);
    log.error(`${params.logLabel} request failed`, error as Error, {
      errorType: "NvidiaStructuredJSONRequestError",
      metadata: {
        model: params.request.model,
      },
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function callNvidiaStructuredJSON<T>(
  request: NvidiaStructuredOutputRequest,
  responseSchema: Record<string, unknown>,
  zodSchema: z.ZodType<T>,
): Promise<StructuredOutputResult<T>> {
  if (!NVIDIA_STRUCTURED_OUTPUT_MODELS.has(request.model)) {
    return {
      success: false,
      error: `Structured output is not enabled for NVIDIA model ${request.model}.`,
    };
  }

  const images = request.images ?? [];
  if (images.length > 0 && !NVIDIA_STRUCTURED_OUTPUT_VISION_MODELS.has(request.model)) {
    return {
      success: false,
      error: `NVIDIA structured output with images is only supported on ${Array.from(NVIDIA_STRUCTURED_OUTPUT_VISION_MODELS).join(", ")}. Current model: ${request.model}`,
    };
  }

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
        schema: responseSchema,
      },
    },
    logLabel: "NVIDIA structured JSON",
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

  log.warn("NVIDIA structured JSON schema mode unsupported, retrying with json_object fallback.", {
    model: request.model,
    status: jsonSchemaResult.status ?? null,
  });

  const promptSteeredSystemPrompt = buildNvidiaStructuredSystemPrompt(request.systemPrompt, responseSchema, schemaName);

  const jsonObjectResult = await executeStructuredJsonRequest({
    request,
    systemPrompt: promptSteeredSystemPrompt,
    responseSchema,
    zodSchema,
    responseFormat: {
      type: "json_object",
    },
    logLabel: "NVIDIA structured JSON (json_object fallback)",
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

  log.warn("NVIDIA json_object mode unsupported, retrying without response_format.", {
    model: request.model,
    status: jsonObjectResult.status ?? null,
  });

  const plainJsonResult = await executeStructuredJsonRequest({
    request,
    systemPrompt: promptSteeredSystemPrompt,
    responseSchema,
    zodSchema,
    logLabel: "NVIDIA structured JSON (plain fallback)",
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
