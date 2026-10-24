import { ProviderRequestDeniedError } from "@/utils/provider/providerUsage";
import {
  parsePrivateStructuredOutput,
  privateStructuredFailure,
  readStructuredResponse,
} from "@/providers/utils/structuredReview";
import type { z } from "zod";
import type { ProviderStructuredJsonRequest, StructuredOutputResult } from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { normalizeProviderUsage } from "@/utils/text/tokenEstimate";
import { fetchAndOptimizeImage } from "@/utils/image/imageProcessor";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";
import { buildOpenRouterReasoningRequest } from "@/utils/provider/thinkingControl";
import { buildOpenrouterProviderRouting } from "@/providers/openrouter/providerRouting";
import { readOpenRouterLimitError, readOpenRouterLimitResponse } from "@/providers/openrouter/openrouterLimit";
import { getOpenRouterSupportedParameters } from "@/utils/cache/openrouterCapabilityCache";
import { fetchWithProviderRequest } from "@/utils/provider/providerRequestHook";
type GenericStructuredOutputRequest = ProviderStructuredJsonRequest;

type OpenrouterContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

type OpenrouterMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | OpenrouterContentPart[] };

/**
 * Call OpenRouter with structured output using a generic JSON schema.
 */
export async function callOpenrouterStructuredJSON<T>(
  request: GenericStructuredOutputRequest,
  responseSchema: Record<string, unknown>,
  zodSchema: z.ZodType<T>,
  schemaName: string,
): Promise<StructuredOutputResult<T>> {
  try {
    const contentParts: OpenrouterContentPart[] = [{ type: "text", text: request.userPrompt }];

    if (request.images) {
      for (const image of request.images) {
        try {
          const optimized = await fetchAndOptimizeImage(image.url);
          contentParts.push({
            type: "image_url",
            image_url: {
              url: `data:${optimized.mimeType};base64,${optimized.data}`,
            },
          });
        } catch (fetchError) {
          log.error(`Error fetching image ${image.name}`, fetchError as Error, {
            errorType: "ImageFetchError",
            metadata: { imageName: image.name, imageUrl: image.url },
          });
        }
      }
    }

    const userContent =
      contentParts.length === 1 && contentParts[0].type === "text" ? contentParts[0].text : contentParts;

    const messages: OpenrouterMessage[] = [
      {
        role: "system",
        content: request.systemPrompt,
      },
      {
        role: "user",
        content: userContent,
      },
    ];

    const responseFormat = {
      type: "json_schema" as const,
      json_schema: {
        name: schemaName,
        description: `Structured output for ${schemaName}`,
        schema: responseSchema,
      },
    };

    const body = {
      ...(request.model !== "other-model" ? { model: request.model } : {}),
      messages,
      temperature: request.temperature ?? 1.0,
      max_tokens: request.maxOutputTokens ?? 8192,
      response_format: responseFormat,
      provider: buildOpenrouterProviderRouting({ requiresParameterSupport: true }),
      plugins: [{ id: "response-healing" }],
      stream: false,
      // `require_parameters` turns an unsupported `reasoning` into a 404 for the whole request, and a
      // schema-honoring reply matters more than reasoning control, so it is sent only when advertised.
      ...(request.thinkingLevel !== undefined && getOpenRouterSupportedParameters(request.model)?.has("reasoning")
        ? buildOpenRouterReasoningRequest(request.thinkingLevel)
        : {}),
    };

    const response = await fetchWithProviderRequest("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        "Content-Type": "application/json",
        ...buildOpenRouterAttributionHeaders(),
      },
      body: JSON.stringify(body),
      signal: request.abortSignal,
    });

    if (!response.ok) {
      if (request.privateOutput) {
        const limit = await readOpenRouterLimitResponse(response);
        return privateStructuredFailure(request, "transport", response.status, undefined, limit ?? undefined);
      }
      const errorBody = await response.text();
      const limit = readOpenRouterLimitError(response.status, response.headers, errorBody);
      log.error("OpenRouter structured JSON request failed", new Error(errorBody), {
        errorType: "OpenrouterStructuredJSONHttpError",
        metadata: { model: request.model, status: response.status },
      });
      return {
        success: false,
        error: `OpenRouter request failed: ${response.status} ${response.statusText}`,
        httpStatus: response.status,
        cause: limit ?? undefined,
      };
    }

    const result = (await readStructuredResponse(request, response)) as {
      usage?: unknown;
      choices?: Array<{ message?: { content?: unknown; refusal?: unknown } }>;
    };
    const usage = request.privateOutput ? null : normalizeProviderUsage(result.usage);
    if (usage) request.onUsage?.(usage);
    const messageContent = result.choices?.[0]?.message?.content;
    const responseText =
      typeof messageContent === "string"
        ? messageContent
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
      return {
        success: false,
        error: "OpenRouter returned an empty response.",
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseError) {
      log.error("OpenRouter structured JSON parse failed", parseError as Error, {
        errorType: "OpenrouterStructuredJSONParseError",
        metadata: { model: request.model, responseText },
      });
      return {
        success: false,
        error: "Invalid JSON response from OpenRouter.",
      };
    }

    const validationResult = zodSchema.safeParse(parsed);
    if (!validationResult.success) {
      log.error("OpenRouter structured JSON validation failed", validationResult.error);
      return {
        success: false,
        error: `Invalid response structure: ${validationResult.error.message}`,
      };
    }

    return { success: true, data: validationResult.data };
  } catch (error) {
    if (error instanceof ProviderRequestDeniedError) return { success: false, error: error.message, cause: error };
    if (request.privateOutput) return privateStructuredFailure(request);
    log.error("Error calling OpenRouter structured JSON", error as Error, {
      errorType: "OpenrouterStructuredJSONError",
      metadata: { model: request.model },
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
