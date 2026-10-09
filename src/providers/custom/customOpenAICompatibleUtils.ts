import { readStructuredResponse } from "@/providers/utils/structuredReview";
import { CUSTOM_PROVIDER_PLACEHOLDER_API_KEY, normalizeCustomApiUrl } from "@/providers/custom/customStreamAdapter";
import { logSanitizedOpenAICompatibleRequest } from "@/providers/openaiCompatible/openaiCompatibleMessageBuilder";
import type { ProviderImageInput } from "@/types/provider/featureInterfaces";
import { fetchAndOptimizeImage } from "@/utils/image/imageProcessor";
import { log } from "@/utils/misc/logger";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";
import { tryRepairIncompleteJson } from "@/utils/text/jsonRepair";

type CustomContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type CustomMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | CustomContentPart[] };

export interface CustomChatCompletionResponse {
  usage?: unknown;
  choices?: Array<{
    message?: {
      content?: unknown;
      refusal?: unknown;
    };
  }>;
}

export interface CustomChatCompletionError {
  status: number;
  statusText: string;
  errorBody: string;
}

export function buildCustomHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey.trim() !== "" && apiKey !== CUSTOM_PROVIDER_PLACEHOLDER_API_KEY) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

async function buildCustomUserContent(
  userPrompt: string,
  images?: ProviderImageInput[],
): Promise<string | CustomContentPart[]> {
  if (!images || images.length === 0) {
    return userPrompt;
  }

  const contentParts: CustomContentPart[] = [{ type: "text", text: userPrompt }];

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
      log.error(`Error fetching custom provider image ${image.name ?? image.url}`, fetchError as Error, {
        errorType: "CustomProviderImageFetchError",
        metadata: {
          imageName: image.name ?? null,
          imageUrl: image.url,
        },
      });
    }
  }

  return contentParts.length === 1 ? userPrompt : contentParts;
}

export async function buildCustomMessages(params: {
  systemPrompt?: string;
  userPrompt: string;
  images?: ProviderImageInput[];
}): Promise<CustomMessage[]> {
  const messages: CustomMessage[] = [];

  if (params.systemPrompt?.trim()) {
    messages.push({
      role: "system",
      content: params.systemPrompt,
    });
  }

  messages.push({
    role: "user",
    content: await buildCustomUserContent(params.userPrompt, params.images),
  });

  return messages;
}

export async function callCustomChatCompletions(params: {
  endpointUrl?: string;
  apiKey: string;
  body: Record<string, unknown>;
  logLabel: string;
  messagesForLog?: Array<Record<string, unknown>>;
  abortSignal?: AbortSignal;
  privateOutput?: boolean;
}): Promise<
  { success: true; data: CustomChatCompletionResponse } | { success: false; error: CustomChatCompletionError }
> {
  if (!params.endpointUrl?.trim()) {
    return {
      success: false,
      error: {
        status: 0,
        statusText: "Missing endpoint URL",
        errorBody: "Custom endpoint URL is not configured.",
      },
    };
  }

  if (params.messagesForLog) {
    logSanitizedOpenAICompatibleRequest(params.logLabel, params.messagesForLog);
  }

  try {
    const response = await fetchUserRemoteUrl(normalizeCustomApiUrl(params.endpointUrl), {
      method: "POST",
      headers: buildCustomHeaders(params.apiKey),
      body: JSON.stringify(params.body),
      signal: params.abortSignal,
    });

    if (!response.ok) {
      if (params.privateOutput) await response.body?.cancel();
      return {
        success: false,
        error: {
          status: response.status,
          statusText: response.statusText,
          errorBody: params.privateOutput ? "HTTP failure" : await response.text(),
        },
      };
    }

    return {
      success: true,
      data: (await readStructuredResponse(
        { apiKey: params.apiKey, model: "", systemPrompt: "", userPrompt: "", privateOutput: params.privateOutput },
        response,
      )) as CustomChatCompletionResponse,
    };
  } catch (error) {
    return {
      success: false,
      error: {
        status: 0,
        statusText: "Request failed",
        errorBody: params.privateOutput ? "Request failed" : error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function extractCustomResponseText(messageContent: unknown): string {
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

export function buildSchemaSteeredSystemPrompt(
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

export function shouldFallbackStructuredMode(status: number, errorBody: string): boolean {
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

export function parseCustomJsonResponse(text: string): unknown {
  const cleanedText = stripThinkBlocks(text);

  try {
    return JSON.parse(cleanedText);
  } catch {}

  const fencedMatch = cleanedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    // Not every candidate below is valid JSON, so each is tried in turn rather than
    // returning (and throwing past the remaining candidates) on the first match.
    try {
      return JSON.parse(fencedMatch[1]);
    } catch {}
  }

  const firstBracket = cleanedText.indexOf("[");
  const lastBracket = cleanedText.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      return JSON.parse(cleanedText.slice(firstBracket, lastBracket + 1));
    } catch {}
  }

  const firstBrace = cleanedText.indexOf("{");
  const lastBrace = cleanedText.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(cleanedText.slice(firstBrace, lastBrace + 1));
    } catch {}
  }

  // A response cut off by max_tokens never reaches a closing brace, so every attempt
  // above fails. Repairing the tail from the first brace recovers whatever fields
  // finished instead of discarding an otherwise-complete object.
  if (firstBrace !== -1) {
    const repaired = tryRepairIncompleteJson(cleanedText.slice(firstBrace));
    if (repaired) {
      return repaired;
    }
  }

  throw new Error("Invalid JSON response from custom endpoint.");
}
