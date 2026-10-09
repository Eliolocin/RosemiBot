/**
 * AI-Powered Preset Generation for the Anthropic provider.
 *
 * Uses the forced tool-use pattern for structured output, where a single
 * tool whose input_schema matches the preset response schema is defined and
 * the model is forced to call it via tool_choice.
 *
 * Includes a tool-calling loop for models with web-search tools enabled.
 */

import { log } from "@/utils/misc/logger";
import { executeTool } from "@/tools/toolRegistry";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import type { GeneratePresetParams, PresetGenerationResult } from "@/types/provider/featureInterfaces";
import { getAnthropicToolAdapter } from "@/providers/anthropic/anthropicToolAdapter";
import {
  buildPresetResponseSchema,
  buildPresetPrompt,
  buildToolErrorResult,
  extractPresetGenerationFields,
  presetGenerationFailureErrorType,
  presetGenerationFailureMessage,
  validatePresetGenerationFields,
} from "@/providers/utils/presetCommon";
import { resolvePresetGenerationMaxOutputTokens } from "@/utils/provider/maxOutputTokens";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

interface AnthropicPresetGenerationOptions {
  model: string;
  temperature?: number;
  tools?: Array<Record<string, unknown>>;
  toolContext?: ToolContext;
  maxToolRounds?: number;
}

/**
 * Injects the response schema so the model knows the expected output shape.
 */
function buildAnthropicPresetSystemPrompt(): string {
  const schema = buildPresetResponseSchema();
  return [
    "You are a JSON-only character preset generator.",
    "Return a valid json object only.",
    "Target json schema for preset_export_data:",
    JSON.stringify(schema, null, 2),
    "Do not wrap the json in markdown fences and do not add extra prose.",
  ].join("\n\n");
}

/**
 * Anthropic tool call format from streaming response
 */
interface AnthropicToolCallBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Generate preset data from user prompts using the Anthropic Messages API.
 */
export async function generatePresetFromPromptAnthropic(
  apiKey: string,
  params: GeneratePresetParams,
  _locale: string,
  options: AnthropicPresetGenerationOptions,
): Promise<PresetGenerationResult> {
  if (!apiKey || apiKey.trim().length < 10) {
    return { error: "Invalid Anthropic API key", errorType: "API_KEY" };
  }

  const anthropicAdapter = getAnthropicToolAdapter();
  const tools = options.tools ?? [];
  const toolContext = options.toolContext;
  const toolsEnabled = tools.length > 0 && toolContext;

  // Build the preset tool definition (forced tool use for structured output)
  const presetToolDef = {
    name: "preset_export_data",
    description: "Generate structured character preset data",
    input_schema: buildPresetResponseSchema(),
  };

  const messages: Array<Record<string, unknown>> = [{ role: "user", content: buildPresetPrompt(params) }];

  const allTools: Array<Record<string, unknown>> = [presetToolDef];
  if (toolsEnabled) {
    allTools.push(...tools);
  }

  const maxToolRounds = options.maxToolRounds ?? 3;
  let toolRounds = 0;
  const maxOutputTokens = resolvePresetGenerationMaxOutputTokens({ configured: params.maxOutputTokens });

  while (true) {
    const body: Record<string, unknown> = {
      model: options.model,
      max_tokens: maxOutputTokens,
      system: buildAnthropicPresetSystemPrompt(),
      messages,
      tools: allTools,
      stream: false,
      temperature: options.temperature ?? 1.0,
    };

    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log.error("Anthropic preset generation request failed", new Error(errorBody), {
        errorType: "AnthropicPresetHttpError",
        metadata: {
          model: options.model,
          status: response.status,
          errorBody,
        },
      });
      return {
        error: `Anthropic request failed (HTTP ${response.status}).`,
        errorType: "CONNECTION",
      };
    }

    const result = (await response.json()) as {
      content?: Array<Record<string, unknown>>;
      stop_reason?: string;
    };

    if (!result.content || result.content.length === 0) {
      return {
        error: "Anthropic returned an empty response.",
        errorType: "EMPTY_RESPONSE",
      };
    }

    const toolUseBlocks = result.content.filter(
      (block) => block.type === "tool_use",
    ) as unknown as AnthropicToolCallBlock[];

    const textBlocks = result.content.filter((block) => block.type === "text");

    const searchToolCalls = toolUseBlocks.filter((tc) => tc.name !== "preset_export_data");

    if (searchToolCalls.length > 0) {
      if (!toolsEnabled || !toolContext) {
        return {
          error: "Anthropic requested tool calls but tools are not available.",
          errorType: "MODEL_ERROR",
        };
      }

      toolRounds += 1;
      if (toolRounds > maxToolRounds) {
        return {
          error: "Anthropic tool call loop exceeded limit.",
          errorType: "TIMEOUT",
        };
      }

      messages.push({
        role: "assistant",
        content: result.content,
      });

      const toolResultBlocks: Array<Record<string, unknown>> = [];

      for (const toolCall of searchToolCalls) {
        const functionName = toolCall.name;
        const toolArgs = toolCall.input;

        log.info(`Executing Anthropic preset tool call: ${functionName} with args: ${JSON.stringify(toolArgs)}`);

        let toolResult: ToolResult | undefined;
        try {
          toolResult = await executeTool(functionName, toolArgs, toolContext);
        } catch (execErr) {
          log.warn(`Anthropic tool call execution failed: ${functionName}`, execErr as Error);
          toolResult = buildToolErrorResult(
            `Tool execution failed: ${execErr instanceof Error ? execErr.message : String(execErr)}`,
          );
        }

        const convertedResult = anthropicAdapter.convertResult(
          toolResult ?? buildToolErrorResult("Tool execution failed"),
        );

        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content:
            typeof convertedResult.content === "string"
              ? convertedResult.content
              : JSON.stringify(convertedResult.content),
        });
      }

      messages.push({
        role: "user",
        content: toolResultBlocks,
      });

      continue;
    }

    const presetToolCall = toolUseBlocks.find((tc) => tc.name === "preset_export_data");

    if (presetToolCall) {
      // The tool-call path hands over an already-decoded object, so there is no text to
      // parse and no truncation to repair; only the preset contract is left to enforce.
      const decoded = validatePresetGenerationFields(presetToolCall.input);

      if (!decoded.ok) {
        log.error(`Anthropic preset generation rejected: ${decoded.failure.code}`);
        return {
          error: presetGenerationFailureMessage(decoded.failure),
          errorType: presetGenerationFailureErrorType(decoded.failure),
        };
      }

      const preset = {
        tomori_nickname: params.characterName,
        trigger_words: [params.characterName],
        ...decoded.preset,
      };

      log.success(`Anthropic preset generation successful for ${params.characterName}`);
      return { preset };
    }

    // If no tool_use blocks, try to parse text content as JSON (fallback)
    const responseText = textBlocks
      .map((b) => (b as { text?: string }).text ?? "")
      .join("")
      .trim();

    if (!responseText) {
      return {
        error: "Anthropic returned an empty response.",
        errorType: "EMPTY_RESPONSE",
      };
    }

    const decoded = extractPresetGenerationFields(responseText, JSON.parse, (parseError) =>
      log.error("Anthropic preset generation response could not be parsed", parseError),
    );
    if (!decoded.ok) {
      log.error(`Anthropic preset generation rejected: ${decoded.failure.code}`);
      return {
        // A payload nothing could read is a provider fault worth naming; a schema miss is
        // the model's, and the shared message is the instruction the user can act on.
        error:
          decoded.failure.code === "PARSE_FAILED"
            ? "Invalid JSON response from Anthropic."
            : presetGenerationFailureMessage(decoded.failure),
        errorType: presetGenerationFailureErrorType(decoded.failure),
      };
    }

    const preset = {
      tomori_nickname: params.characterName,
      trigger_words: [params.characterName],
      ...decoded.preset,
    };

    log.success(`Anthropic preset generation successful (text fallback) for ${params.characterName}`);
    return { preset };
  }
}
