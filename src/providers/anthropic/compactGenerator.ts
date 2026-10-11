/**
 * Conversation compaction for the Anthropic provider.
 *
 * - Plain-text conversation summaries via a direct POST to the
 *   Anthropic Messages API (non-streaming).
 * - Roleplay structured summaries delegated to callAnthropicStructuredJSON,
 *   which uses the forced tool-use pattern for structured output.
 */

import { log } from "@/utils/misc/logger";
import type {
  CompactConversationResult,
  CompactRoleplayResult,
  ProviderCompactSummaryRequest,
} from "@/types/provider/featureInterfaces";
import { callAnthropicStructuredJSON } from "@/providers/anthropic/anthropicStructuredOutput";
import { buildRoleplaySchema, CompactRoleplaySummarySchema } from "@/providers/utils/compactCommon";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

/**
 * Generate a plain-text conversation summary using the Anthropic Messages API.
 */
export async function generateConversationSummaryAnthropic(
  request: ProviderCompactSummaryRequest,
): Promise<CompactConversationResult> {
  try {
    if (!request.apiKey || request.apiKey.trim().length < 10) {
      return { error: "Invalid Anthropic API key" };
    }

    const messages: Array<Record<string, unknown>> = [{ role: "user", content: request.userPrompt }];

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: 4096,
      messages,
      stream: false,
      temperature: request.temperature ?? 0.7,
    };

    // Add system prompt if provided (Anthropic uses top-level system parameter)
    if (request.systemPrompt) {
      body.system = request.systemPrompt;
    }

    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "x-api-key": request.apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log.error("Anthropic compact summary request failed", new Error(errorBody), {
        errorType: "AnthropicCompactHttpError",
        metadata: {
          model: request.model,
          status: response.status,
          errorBody,
        },
      });
      return {
        error: `Anthropic request failed (${response.status}): ${response.statusText}`,
      };
    }

    const result = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    const textBlocks = result.content?.filter((b) => b.type === "text") ?? [];
    const responseText = textBlocks
      .map((b) => b.text ?? "")
      .join("")
      .trim();

    if (!responseText) {
      return { error: "Anthropic returned an empty response." };
    }

    return { summary: responseText };
  } catch (error) {
    log.error("Anthropic compact summary failed", error as Error);
    return {
      error: error instanceof Error ? error.message : "Unknown Anthropic error",
    };
  }
}

/**
 * Generate a structured roleplay summary using the Anthropic API.
 */
export async function generateRoleplaySummaryAnthropic(
  request: ProviderCompactSummaryRequest,
): Promise<CompactRoleplayResult> {
  const result = await callAnthropicStructuredJSON(
    {
      apiKey: request.apiKey,
      model: request.model,
      systemPrompt: request.systemPrompt ?? "",
      userPrompt: request.userPrompt,
      temperature: request.temperature,
    },
    buildRoleplaySchema(),
    CompactRoleplaySummarySchema,
  );

  if (!result.success) {
    return { error: result.error };
  }

  return { summary: result.data };
}
