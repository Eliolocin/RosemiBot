import {
  parsePrivateStructuredOutput,
  privateStructuredFailure,
  readStructuredResponse,
} from "@/providers/utils/structuredReview";
import type { z } from "zod";
import type { ProviderStructuredJsonRequest, StructuredOutputResult } from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import {
  toZaiApiModelName,
  ZAI_GENERAL_CHAT_COMPLETIONS_URL,
  ZAI_REASONING_MODELS,
  ZAI_VISION_MODEL,
} from "@/providers/zai/zaiShared";

/**
 * Build an example JSON object from a JSON Schema definition.
 * Used to steer the model toward the correct output shape.
 */
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

/**
 * Build a system prompt that steers the model toward valid JSON output
 * matching the provided schema.
 */
function buildZaiStructuredSystemPrompt(
  systemPrompt: string,
  responseSchema: Record<string, unknown>,
  schemaName?: string,
): string {
  const schemaLabel = schemaName ?? "structured_output_result";
  const exampleObject = buildExampleJsonFromSchema(responseSchema);

  return [
    systemPrompt.trim(),
    "Return a valid json object only.",
    "The word json is intentional and required.",
    `Target json schema for ${schemaLabel}:`,
    JSON.stringify(responseSchema, null, 2),
    "Example json object:",
    JSON.stringify(exampleObject, null, 2),
    "Do not wrap the json in markdown fences and do not add extra prose.",
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

/**
 * Call Z.ai with JSON Output (`response_format: json_object`).
 * Uses prompt-steered schema injection + Zod validation,
 * similar to the DeepSeek structured output approach.
 * @param responseSchema - JSON Schema describing the expected response shape
 * @param zodSchema - Zod schema for runtime validation of the parsed response
 * @returns Structured output result with parsed data or error
 */
export async function callZaiStructuredJSON<T>(
  request: ProviderStructuredJsonRequest,
  responseSchema: Record<string, unknown>,
  zodSchema: z.ZodType<T>,
): Promise<StructuredOutputResult<T>> {
  const apiModel = toZaiApiModelName(request.model);

  // Only glm-4.6v supports image inputs
  const images = request.images ?? [];
  if (images.length > 0 && apiModel !== ZAI_VISION_MODEL) {
    return {
      success: false,
      error: `Z.ai structured output with images is only supported on ${ZAI_VISION_MODEL}. Current model: ${apiModel}`,
    };
  }

  try {
    const body: Record<string, unknown> = {
      model: apiModel,
      messages: [
        {
          role: "system",
          content: buildZaiStructuredSystemPrompt(request.systemPrompt, responseSchema, request.schemaName),
        },
        {
          role: "user",
          content:
            images.length > 0
              ? [
                  { type: "text", text: request.userPrompt },
                  ...images.map((img) => ({
                    type: "image_url",
                    image_url: {
                      url: img.url,
                    },
                  })),
                ]
              : request.userPrompt,
        },
      ],
      response_format: {
        type: "json_object",
      },
      max_tokens: request.maxOutputTokens ?? 8192,
      stream: false,
    };

    // Skip temperature for reasoning models
    if (!ZAI_REASONING_MODELS.includes(apiModel)) {
      body.temperature = request.temperature ?? 1.0;
    }

    const response = await fetch(request.endpointUrl || ZAI_GENERAL_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: request.abortSignal,
    });

    if (!response.ok) {
      if (request.privateOutput) {
        await response.body?.cancel();
        return privateStructuredFailure(request, "transport", response.status);
      }
      const errorBody = await response.text();
      log.error("Z.ai structured JSON request failed", new Error(errorBody), {
        errorType: "ZaiStructuredJSONHttpError",
        metadata: {
          model: apiModel,
          status: response.status,
        },
      });
      return {
        success: false,
        error: `Z.ai request failed: ${response.status} ${response.statusText}`,
      };
    }

    const result = (await readStructuredResponse(request, response)) as {
      usage?: unknown;
      choices?: Array<{ message?: { content?: unknown; refusal?: unknown } }>;
    };
    const messageContent = result.choices?.[0]?.message?.content;
    const responseText =
      typeof messageContent === "string"
        ? messageContent.trim()
        : Array.isArray(messageContent)
          ? messageContent
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
              .trim()
          : "";

    if (request.privateOutput)
      return parsePrivateStructuredOutput(
        request,
        responseText,
        zodSchema,
        result.usage,
        Boolean(result.choices?.[0]?.message?.refusal),
      );
    if (!responseText) {
      log.warn("Z.ai structured JSON returned empty response", {
        model: apiModel,
      });
      return {
        success: false,
        error: "Z.ai returned an empty structured output response. Retry the request.",
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseError) {
      log.error("Z.ai structured JSON parse failed", parseError as Error, {
        errorType: "ZaiStructuredJSONParseError",
        metadata: {
          model: apiModel,
          responseLength: responseText.length,
          responsePreview: responseText.slice(0, 1000),
        },
      });
      return {
        success: false,
        error: "Invalid JSON response from Z.ai.",
      };
    }

    const validationResult = zodSchema.safeParse(parsed);
    if (!validationResult.success) {
      log.error("Z.ai structured JSON validation failed", validationResult.error);
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
    if (request.privateOutput) return privateStructuredFailure(request);
    log.error("Error calling Z.ai structured JSON", error as Error, {
      errorType: "ZaiStructuredJSONError",
      metadata: {
        model: apiModel,
      },
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
