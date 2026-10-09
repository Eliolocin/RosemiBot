/**
 * AI-Powered Preset Generation for the DeepSeek provider.
 *
 * Uses json_object response mode with the preset schema injected into
 * the system prompt, since DeepSeek does not support json_schema strict
 * mode. Includes a full tool-calling loop for models with web-search
 * tools enabled (has_tools=true).
 */
import { log } from "@/utils/misc/logger";
import { toDeepseekApiModelName } from "@/providers/deepseek/deepseekShared";
import { executeTool } from "@/tools/toolRegistry";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import type { GeneratePresetParams, PresetGenerationResult } from "@/types/provider/featureInterfaces";
import { getDeepseekToolAdapter } from "@/providers/deepseek/deepseekToolAdapter";
import {
  buildPresetResponseSchema,
  buildPresetPrompt,
  buildToolErrorResult,
  extractPresetGenerationFields,
  PRESET_SCHEMA_MISS_CODES,
  presetGenerationFailureErrorType,
  presetGenerationFailureMessage,
  type PresetMessage,
  type PresetToolCall,
} from "@/providers/utils/presetCommon";
import { resolvePresetGenerationMaxOutputTokens } from "@/utils/provider/maxOutputTokens";

const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";

interface DeepseekPresetGenerationOptions {
  model: string;
  temperature?: number;
  tools?: Array<Record<string, unknown>>;
  toolContext?: ToolContext;
  maxToolRounds?: number;
}

/**
 * Build a system prompt that steers the model toward the preset JSON schema.
 * DeepSeek does not support json_schema strict mode, so the schema is injected
 * into the system message and response_format: json_object is used instead.
 */
function buildDeepseekPresetSystemPrompt(): string {
  const schema = buildPresetResponseSchema();
  return [
    "You are a JSON-only character preset generator.",
    "Return a valid json object only.",
    "The word json is intentional and required.",
    "Target json schema for preset_export_data:",
    JSON.stringify(schema, null, 2),
    "Do not wrap the json in markdown fences and do not add extra prose.",
  ].join("\n\n");
}

/**
 * Generate preset data from user prompts using the DeepSeek API.
 *
 * @param _locale - User's locale (reserved for future error localisation)
 */
export async function generatePresetFromPromptDeepseek(
  apiKey: string,
  params: GeneratePresetParams,
  _locale: string,
  options: DeepseekPresetGenerationOptions,
): Promise<PresetGenerationResult> {
  if (!apiKey || apiKey.trim().length < 10) {
    return { error: "Invalid DeepSeek API key", errorType: "API_KEY" };
  }

  const deepseekAdapter = getDeepseekToolAdapter();
  const tools = options.tools ?? [];
  const toolContext = options.toolContext;
  const toolsEnabled = tools.length > 0 && toolContext;

  // Build messages: schema-steered system prompt + user character prompt
  const messages: PresetMessage[] = [
    { role: "system", content: buildDeepseekPresetSystemPrompt() },
    { role: "user", content: buildPresetPrompt(params) },
  ];

  const maxToolRounds = options.maxToolRounds ?? 3;
  let toolRounds = 0;
  const maxOutputTokens = resolvePresetGenerationMaxOutputTokens({ configured: params.maxOutputTokens });

  while (true) {
    const body: Record<string, unknown> = {
      model: toDeepseekApiModelName(options.model),
      messages,
      max_tokens: maxOutputTokens,
      response_format: { type: "json_object" },
      stream: false,
    };

    if (options.model !== "deepseek-reasoner") {
      body.temperature = options.temperature ?? 1.0;
    }

    if (toolsEnabled) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const response = await fetch(DEEPSEEK_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log.error("DeepSeek preset generation request failed", new Error(errorBody), {
        errorType: "DeepseekPresetHttpError",
        metadata: {
          model: options.model,
          status: response.status,
          errorBody,
        },
      });
      return {
        error: `DeepSeek request failed (HTTP ${response.status}).`,
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
        error: "DeepSeek returned an empty response.",
        errorType: "EMPTY_RESPONSE",
      };
    }

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length > 0) {
      if (!toolsEnabled || !toolContext) {
        return {
          error: "DeepSeek requested tool calls but tools are not available.",
          errorType: "MODEL_ERROR",
        };
      }

      toolRounds += 1;
      if (toolRounds > maxToolRounds) {
        return {
          error: "DeepSeek tool call loop exceeded limit.",
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
              log.warn(`DeepSeek tool call args parse failed for ${functionName}: ${rawArgs}`, parseError as Error);
              toolResult = buildToolErrorResult(`Invalid tool arguments for ${functionName}`);
            }
          }

          if (!toolResult) {
            log.info(`Executing DeepSeek preset tool call: ${functionName} with args: ${JSON.stringify(parsedArgs)}`);
            toolResult = await executeTool(functionName, parsedArgs, toolContext);
          }
        }

        const convertedResult = deepseekAdapter.convertResult(
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

    const responseText = typeof message.content === "string" ? message.content.trim() : "";
    if (!responseText) {
      return {
        error: "DeepSeek returned an empty response.",
        errorType: "EMPTY_RESPONSE",
      };
    }

    const decoded = extractPresetGenerationFields(responseText, JSON.parse, (parseError) =>
      log.error("DeepSeek preset generation response could not be parsed", parseError),
    );
    if (!decoded.ok) {
      log.error(`DeepSeek preset generation rejected: ${decoded.failure.code}`);
      return {
        error: PRESET_SCHEMA_MISS_CODES.includes(decoded.failure.code)
          ? presetGenerationFailureMessage(decoded.failure)
          : "Invalid JSON response from DeepSeek.",
        errorType: presetGenerationFailureErrorType(decoded.failure),
      };
    }

    const preset = {
      tomori_nickname: params.characterName,
      trigger_words: [params.characterName],
      ...decoded.preset,
    };

    log.success(`DeepSeek preset generation successful for ${params.characterName}`);
    return { preset };
  }
}
