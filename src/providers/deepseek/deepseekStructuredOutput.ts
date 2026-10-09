import {
  parsePrivateStructuredOutput,
  privateStructuredFailure,
  readStructuredResponse,
} from "@/providers/utils/structuredReview";
import type { z } from "zod";
import { toDeepseekApiModelName } from "@/providers/deepseek/deepseekShared";
import type { ProviderStructuredJsonRequest, StructuredOutputResult } from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { fetchAndOptimizeImage } from "@/utils/image/imageProcessor";

type DeepseekStructuredOutputRequest = ProviderStructuredJsonRequest;

type DeepseekContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

type DeepseekStructuredMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | DeepseekContentPart[] };

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

function buildDeepseekStructuredSystemPrompt(
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

function parseDeepseekJsonResponse(text: string): unknown {
  const cleanedText = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .trim();

  try {
    return JSON.parse(cleanedText);
  } catch {
    // Continue to fallback extraction attempts below.
  }

  const fencedMatch = cleanedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1]);
    } catch {}
  }

  const firstBrace = cleanedText.indexOf("{");
  const lastBrace = cleanedText.lastIndexOf("}");
  const firstBracket = cleanedText.indexOf("[");
  const lastBracket = cleanedText.lastIndexOf("]");

  const hasBrackets = firstBracket !== -1 && lastBracket > firstBracket;
  const hasBraces = firstBrace !== -1 && lastBrace > firstBrace;

  // Inspect whichever delimiter appears first so array roots enclosing objects are not stripped
  if (hasBrackets && (!hasBraces || firstBracket < firstBrace)) {
    try {
      return JSON.parse(cleanedText.slice(firstBracket, lastBracket + 1));
    } catch {}
  }

  if (hasBraces) {
    try {
      return JSON.parse(cleanedText.slice(firstBrace, lastBrace + 1));
    } catch {}
  }

  if (hasBrackets) {
    try {
      return JSON.parse(cleanedText.slice(firstBracket, lastBracket + 1));
    } catch {}
  }

  return JSON.parse(cleanedText);
}

/**
 * Call DeepSeek with JSON Output (`response_format: json_object`).
 * DeepSeek does not currently expose a schema-enforced JSON mode in the stable API,
 * so we inject explicit json instructions plus a schema/example into the system prompt
 * and validate the parsed response locally with Zod.
 */
export async function callDeepseekStructuredJSON<T>(
  request: DeepseekStructuredOutputRequest,
  responseSchema: Record<string, unknown>,
  zodSchema: z.ZodType<T>,
): Promise<StructuredOutputResult<T>> {
  try {
    const contentParts: DeepseekContentPart[] = [{ type: "text", text: request.userPrompt }];

    if (request.images && request.images.length > 0) {
      for (const image of request.images) {
        try {
          const optimized = await fetchAndOptimizeImage(image.url, image.mimeType);
          contentParts.push({
            type: "image_url",
            image_url: {
              url: `data:${optimized.mimeType};base64,${optimized.data}`,
            },
          });
        } catch (fetchError) {
          log.error(`Error fetching DeepSeek image ${image.name ?? image.url}`, fetchError as Error, {
            errorType: "DeepseekImageFetchError",
            metadata: {
              imageName: image.name ?? null,
              imageUrl: image.url,
            },
          });
        }
      }
    }

    const userContent =
      contentParts.length === 1 && contentParts[0].type === "text" ? contentParts[0].text : contentParts;

    const messages: DeepseekStructuredMessage[] = [
      {
        role: "system",
        content: buildDeepseekStructuredSystemPrompt(request.systemPrompt, responseSchema, request.schemaName),
      },
      {
        role: "user",
        content: userContent,
      },
    ];

    const body: Record<string, unknown> = {
      model: toDeepseekApiModelName(request.model),
      messages,
      response_format: {
        type: "json_object",
      },
      max_tokens: request.maxOutputTokens ?? 8192,
      stream: false,
    };

    if (request.model !== "deepseek-reasoner") {
      body.temperature = request.temperature ?? 1.0;
    }

    const endpointUrl = request.endpointUrl || "https://api.deepseek.com/chat/completions";
    const response = await fetch(endpointUrl, {
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
      log.error("DeepSeek structured JSON request failed", new Error(errorBody), {
        errorType: "DeepseekStructuredJSONHttpError",
        metadata: {
          model: request.model,
          status: response.status,
        },
      });
      return {
        success: false,
        error: `DeepSeek request failed: ${response.status} ${response.statusText}`,
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
      log.warn("DeepSeek structured JSON returned empty response", {
        model: request.model,
      });
      return {
        success: false,
        error: "DeepSeek returned an empty structured output response. Retry the request.",
      };
    }

    let parsed: unknown;
    try {
      parsed = parseDeepseekJsonResponse(responseText);
    } catch (parseError) {
      log.error("DeepSeek structured JSON parse failed", parseError as Error, {
        errorType: "DeepseekStructuredJSONParseError",
        metadata: {
          model: request.model,
          responseLength: responseText.length,
          responsePreview: responseText.slice(0, 1000),
        },
      });
      return {
        success: false,
        error: "Invalid JSON response from DeepSeek.",
      };
    }

    const validationResult = zodSchema.safeParse(parsed);
    if (!validationResult.success) {
      log.error("DeepSeek structured JSON validation failed", validationResult.error);
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
    log.error("Error calling DeepSeek structured JSON", error as Error, {
      errorType: "DeepseekStructuredJSONError",
      metadata: {
        model: request.model,
      },
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
