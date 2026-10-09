import {
  parsePrivateStructuredOutput,
  privateStructuredFailure,
  readStructuredResponse,
} from "@/providers/utils/structuredReview";
/**
 * Anthropic structured output via forced tool use.
 *
 * Anthropic does not support `response_format: { type: "json_schema" }` like OpenAI.
 * Instead, structured output is achieved by:
 * 1. Defining a tool whose `input_schema` matches the desired output schema
 * 2. Setting `tool_choice: { type: "tool", name: schemaName }` to force the model
 *    to call that specific tool
 * 3. Extracting the tool call arguments as the structured output
 * 4. Validating with Zod
 */

import type { z } from "zod";
import type {
  ProviderStructuredJsonRequest,
  StructuredOutputResult,
  ProviderImageInput,
} from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

/**
 * Build Anthropic messages from the request's system and user prompts.
 * Handles image inputs by converting them to Anthropic's base64 content block format.
 */
function buildAnthropicMessages(
  systemPrompt: string,
  userPrompt: string,
  images?: ProviderImageInput[],
): { system: string; messages: Array<Record<string, unknown>> } {
  const messages: Array<Record<string, unknown>> = [];

  if (images && images.length > 0) {
    const contentBlocks: Array<Record<string, unknown>> = [{ type: "text", text: userPrompt }];

    for (const image of images) {
      if (image.url.startsWith("data:")) {
        const dataUriMatch = image.url.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUriMatch) {
          contentBlocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: dataUriMatch[1],
              data: dataUriMatch[2],
            },
          });
        }
      } else {
        // HTTP URL: Anthropic supports URL-based images too
        contentBlocks.push({
          type: "image",
          source: {
            type: "url",
            url: image.url,
          },
        });
      }
    }

    messages.push({ role: "user", content: contentBlocks });
  } else {
    messages.push({ role: "user", content: userPrompt });
  }

  return { system: systemPrompt, messages };
}

/**
 * Make a non-streaming Anthropic API request with forced tool use
 * for structured JSON output.
 */
async function callAnthropicApi(
  apiKey: string,
  model: string,
  system: string,
  messages: Array<Record<string, unknown>>,
  toolDefinition: Record<string, unknown>,
  toolChoice: Record<string, unknown>,
  maxTokens: number = 8192,
  request?: ProviderStructuredJsonRequest,
): Promise<Record<string, unknown>> {
  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages,
    tools: [toolDefinition],
    tool_choice: toolChoice,
    stream: false,
  };

  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify(body),
    signal: request?.abortSignal,
  });

  if (!response.ok) {
    if (request?.privateOutput) {
      await response.body?.cancel();
      throw new Error("Structured HTTP failure");
    }
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  return (request ? await readStructuredResponse(request, response) : await response.json()) as Record<string, unknown>;
}

/**
 * Extract the tool use content block from an Anthropic response.
 */
function extractToolUseFromResponse(
  response: Record<string, unknown>,
  toolName: string,
): Record<string, unknown> | null {
  const content = response.content as Array<Record<string, unknown>> | undefined;
  if (!content) return null;

  for (const block of content) {
    if (block.type === "tool_use" && block.name === toolName) {
      return block.input as Record<string, unknown>;
    }
  }

  return null;
}

/**
 * Call Anthropic with structured JSON output via forced tool use.
 *
 * @param schemaName - Name for the forced tool (defaults to "structured_output")
 */
export async function callAnthropicStructuredJSON<T>(
  request: ProviderStructuredJsonRequest,
  responseSchema: Record<string, unknown>,
  zodSchema: z.ZodType<T>,
  schemaName: string = "structured_output",
): Promise<StructuredOutputResult<T>> {
  try {
    const toolDefinition = {
      name: schemaName,
      description: `Generate structured output matching the ${schemaName} schema`,
      input_schema: responseSchema,
    };

    // Force the model to call this specific tool
    const toolChoice = {
      type: "tool" as const,
      name: schemaName,
    };

    const { system, messages } = buildAnthropicMessages(request.systemPrompt, request.userPrompt, request.images);

    const response = await callAnthropicApi(
      request.apiKey,
      request.model,
      system,
      messages,
      toolDefinition,
      toolChoice,
      request.maxOutputTokens,
      request,
    );

    const toolInput = extractToolUseFromResponse(response, schemaName);
    if (request.privateOutput)
      return parsePrivateStructuredOutput(
        request,
        toolInput,
        zodSchema,
        response.usage,
        response.stop_reason === "refusal",
      );
    if (!toolInput) {
      log.warn("Anthropic structured JSON: No tool_use block found in response", {
        model: request.model,
        responseContent: JSON.stringify(response.content).substring(0, 500),
      });
      return {
        success: false,
        error: "Anthropic did not return the expected structured output tool call. Retry the request.",
      };
    }

    const validationResult = zodSchema.safeParse(toolInput);
    if (!validationResult.success) {
      log.error("Anthropic structured JSON validation failed", validationResult.error);
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
    log.error("Error calling Anthropic structured JSON", error as Error, {
      errorType: "AnthropicStructuredJSONError",
      metadata: { model: request.model },
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
