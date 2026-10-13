/**
 * AI-Powered Preset Generation for the NVIDIA NIM provider.
 *
 * Tries json_schema response format first; falls back to json_object
 * (with schema injected into the system prompt) if the model does not
 * support json_schema. Includes a full tool-calling loop for models
 * with web-search tools enabled (has_tools=true).
 */
import { log } from "@/utils/misc/logger";
import { executeTool } from "@/tools/toolRegistry";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import type { GeneratePresetParams, PresetGenerationResult } from "@/types/provider/featureInterfaces";
import { getNvidiaToolAdapter } from "@/providers/nvidia/nvidiaToolAdapter";
import { NVIDIA_CHAT_COMPLETIONS_URL } from "@/providers/nvidia/nvidiaConstants";
import {
  buildPresetResponseSchema,
  buildPresetPrompt,
  extractResponseText,
  extractPresetGenerationFields,
  buildToolErrorResult,
  PRESET_SCHEMA_MISS_CODES,
  presetGenerationFailureErrorType,
  presetGenerationFailureMessage,
  type PresetContentPart,
  type PresetMessage,
  type PresetToolCall,
} from "@/providers/utils/presetCommon";
import { resolvePresetGenerationMaxOutputTokens } from "@/utils/provider/maxOutputTokens";

interface NvidiaPresetGenerationOptions {
  model: string;
  temperature?: number;
  tools?: Array<Record<string, unknown>>;
  toolContext?: ToolContext;
  maxToolRounds?: number;
}

/**
 * Determine whether an HTTP error indicates that the response_format
 * parameter is not supported by the model, warranting a json_object fallback.
 */
function shouldFallbackResponseFormat(status: number, errorBody: string): boolean {
  if (status !== 400 && status !== 422) {
    return false;
  }
  const normalized = errorBody.toLowerCase();
  const mentionsFormat =
    normalized.includes("response_format") ||
    normalized.includes("json_schema") ||
    normalized.includes("json_object") ||
    normalized.includes("schema");
  const indicatesUnsupported =
    normalized.includes("unsupported") ||
    normalized.includes("unknown") ||
    normalized.includes("invalid") ||
    normalized.includes("not allowed") ||
    normalized.includes("unrecognized");
  return mentionsFormat && indicatesUnsupported;
}

/**
 * Build a system prompt that steers the model toward the preset JSON schema.
 * Used for json_object fallback mode when the model does not support json_schema.
 */
function buildNvidiaPresetSystemPrompt(): string {
  const schema = buildPresetResponseSchema();
  return [
    "You are a JSON-only character preset generator.",
    "Return a valid JSON object only.",
    "Target JSON schema for preset_export_data:",
    JSON.stringify(schema, null, 2),
    "Do not include <think> tags, reasoning summaries, or any text outside the JSON.",
    "Do not wrap the JSON in markdown fences and do not add extra prose.",
  ].join("\n\n");
}

/**
 * Generate preset data from user prompts using the NVIDIA NIM API.
 *
 * @param _locale - User's locale (reserved for future error localisation)
 * @returns Generated preset or a typed error result
 */
export async function generatePresetFromPromptNvidia(
  apiKey: string,
  params: GeneratePresetParams,
  _locale: string,
  options: NvidiaPresetGenerationOptions,
): Promise<PresetGenerationResult> {
  if (!apiKey || apiKey.trim().length < 10) {
    return { error: "Invalid NVIDIA API key", errorType: "API_KEY" };
  }

  const nvidiaAdapter = getNvidiaToolAdapter();
  const tools = options.tools ?? [];
  const toolContext = options.toolContext;
  const toolsEnabled = tools.length > 0 && toolContext;

  // Build the initial user message content (text + optional image)
  const contentParts: PresetContentPart[] = [{ type: "text", text: buildPresetPrompt(params) }];

  if (params.imageBase64 && params.imageMimeType) {
    contentParts.push({
      type: "image_url",
      image_url: {
        url: `data:${params.imageMimeType};base64,${params.imageBase64}`,
      },
    });
    log.info("NVIDIA preset generation: image included in prompt");
  }

  const userContent =
    contentParts.length === 1 && contentParts[0].type === "text" ? contentParts[0].text : contentParts;

  // Messages start with just the user prompt; system message is prepended
  // on each request when in json_object fallback mode
  const messages: PresetMessage[] = [{ role: "user", content: userContent }];

  type FormatMode = "json_schema" | "json_object";
  let formatMode: FormatMode = "json_schema";
  let formatFallbackDone = false;

  const maxToolRounds = options.maxToolRounds ?? 3;
  let toolRounds = 0;
  const maxOutputTokens = resolvePresetGenerationMaxOutputTokens({ configured: params.maxOutputTokens });

  while (true) {
    const responseFormat =
      formatMode === "json_schema"
        ? {
            type: "json_schema",
            json_schema: {
              name: "preset_export_data",
              description: "Structured persona preset data",
              schema: buildPresetResponseSchema(),
            },
          }
        : { type: "json_object" };

    const requestMessages: PresetMessage[] =
      formatMode === "json_object"
        ? [{ role: "system", content: buildNvidiaPresetSystemPrompt() }, ...messages]
        : messages;

    const body: Record<string, unknown> = {
      model: options.model,
      messages: requestMessages,
      temperature: options.temperature ?? 1.0,
      max_tokens: maxOutputTokens,
      response_format: responseFormat,
      stream: false,
    };

    if (toolsEnabled) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const response = await fetch(NVIDIA_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();

      // Fall back to json_object if json_schema is not supported by this model
      if (
        !formatFallbackDone &&
        formatMode === "json_schema" &&
        shouldFallbackResponseFormat(response.status, errorBody)
      ) {
        log.warn("NVIDIA preset generation: json_schema unsupported, retrying with json_object.", {
          model: options.model,
          status: response.status,
        });
        formatMode = "json_object";
        formatFallbackDone = true;
        continue;
      }

      log.error("NVIDIA preset generation request failed", new Error(errorBody), {
        errorType: "NvidiaPresetHttpError",
        metadata: {
          model: options.model,
          status: response.status,
          errorBody,
        },
      });
      return {
        error: `NVIDIA request failed (HTTP ${response.status}).`,
        errorType: "CONNECTION",
      };
    }

    const result = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: unknown;
          tool_calls?: PresetToolCall[];
        };
      }>;
    };

    const message = result.choices?.[0]?.message;
    if (!message) {
      return {
        error: "NVIDIA returned an empty response.",
        errorType: "EMPTY_RESPONSE",
      };
    }

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length > 0) {
      if (!toolsEnabled || !toolContext) {
        return {
          error: "NVIDIA requested tool calls but tools are not available.",
          errorType: "MODEL_ERROR",
        };
      }

      toolRounds += 1;
      if (toolRounds > maxToolRounds) {
        return {
          error: "NVIDIA tool call loop exceeded limit.",
          errorType: "TIMEOUT",
        };
      }

      const normalizedToolCalls = toolCalls.map((tc, idx) => ({
        ...tc,
        id: tc.id ?? `tool_call_${toolRounds}_${idx}`,
      }));

      messages.push({
        role: "assistant",
        content: typeof message.content === "string" ? message.content : null,
        tool_calls: normalizedToolCalls,
      });

      for (const toolCall of normalizedToolCalls) {
        const functionName = toolCall.function?.name;
        const rawArgs = toolCall.function?.arguments ?? "";
        let toolResult: ToolResult | undefined;
        let parsedArgs: Record<string, unknown> = {};

        if (!functionName) {
          toolResult = buildToolErrorResult("Tool call missing function name");
        } else {
          if (rawArgs) {
            try {
              parsedArgs = JSON.parse(rawArgs);
            } catch (parseError) {
              log.warn(`NVIDIA tool call args parse failed for ${functionName}: ${rawArgs}`, parseError as Error);
              toolResult = buildToolErrorResult(`Invalid tool arguments for ${functionName}`);
            }
          }

          if (!toolResult) {
            log.info(`Executing NVIDIA preset tool call: ${functionName} with args: ${JSON.stringify(parsedArgs)}`);
            toolResult = await executeTool(functionName, parsedArgs, toolContext);
          }
        }

        const convertedResult = nvidiaAdapter.convertResult(
          toolResult ?? buildToolErrorResult("Tool execution failed"),
        );
        const resultContent =
          typeof convertedResult.content === "string"
            ? convertedResult.content
            : JSON.stringify(convertedResult.content);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id ?? "tool_call_unknown",
          content: resultContent,
        });
      }

      continue;
    }

    // Extract and parse the final JSON response
    const responseText = extractResponseText(message.content);
    if (!responseText) {
      return {
        error: "NVIDIA returned an empty response.",
        errorType: "EMPTY_RESPONSE",
      };
    }

    const decoded = extractPresetGenerationFields(responseText, JSON.parse, (parseError) =>
      log.error("NVIDIA preset generation response could not be parsed", parseError),
    );
    if (!decoded.ok) {
      log.error(`NVIDIA preset generation rejected: ${decoded.failure.code}`);
      return {
        error: PRESET_SCHEMA_MISS_CODES.includes(decoded.failure.code)
          ? presetGenerationFailureMessage(decoded.failure)
          : "Invalid JSON response from NVIDIA.",
        errorType: presetGenerationFailureErrorType(decoded.failure),
      };
    }

    const preset = {
      tomori_nickname: params.characterName,
      trigger_words: [params.characterName],
      ...decoded.preset,
    };

    log.success(`NVIDIA preset generation successful for ${params.characterName}`);
    return { preset };
  }
}
