import { executeTool } from "@/tools/toolRegistry";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import type { GeneratePresetParams, PresetGenerationResult } from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { getCustomToolAdapter } from "@/providers/custom/customToolAdapter";
import {
  callCustomChatCompletions,
  extractCustomResponseText,
  parseCustomJsonResponse,
} from "@/providers/custom/customOpenAICompatibleUtils";
import { resolvePresetGenerationMaxOutputTokens } from "@/utils/provider/maxOutputTokens";
import {
  buildPresetResponseSchema,
  buildPresetPrompt,
  buildToolErrorResult,
  extractPresetGenerationFields,
  presetGenerationFailureErrorType,
  presetGenerationFailureMessage,
  type PresetContentPart as CustomContentPart,
  type PresetMessage as CustomMessage,
  type PresetToolCall as CustomToolCall,
} from "@/providers/utils/presetCommon";

interface CustomPresetGenerationOptions {
  endpointUrl: string;
  model: string;
  temperature?: number;
  tools?: Array<Record<string, unknown>>;
  toolContext?: ToolContext;
  maxToolRounds?: number;
}

export async function generatePresetFromPromptCustom(
  apiKey: string,
  params: GeneratePresetParams,
  _optionsLocale: string,
  options: CustomPresetGenerationOptions,
): Promise<PresetGenerationResult> {
  const customAdapter = getCustomToolAdapter();
  const tools = options.tools ?? [];
  const toolContext = options.toolContext;
  const toolsEnabled = tools.length > 0 && toolContext;

  const responseFormat = {
    type: "json_schema" as const,
    json_schema: {
      name: "preset_export_data",
      description: "Structured persona preset data",
      schema: buildPresetResponseSchema(),
    },
  };

  const prompt = buildPresetPrompt(params);
  const contentParts: CustomContentPart[] = [{ type: "text", text: prompt }];

  if (params.imageBase64 && params.imageMimeType) {
    contentParts.push({
      type: "image_url",
      image_url: {
        url: `data:${params.imageMimeType};base64,${params.imageBase64}`,
      },
    });
    log.info("Custom preset generation: image included in prompt");
  }

  const userContent =
    contentParts.length === 1 && contentParts[0].type === "text" ? contentParts[0].text : contentParts;

  const messages: CustomMessage[] = [
    {
      role: "user",
      content: userContent,
    },
  ];

  const maxToolRounds = options.maxToolRounds ?? 3;
  let toolRounds = 0;
  const maxOutputTokens = resolvePresetGenerationMaxOutputTokens({ configured: params.maxOutputTokens });

  while (true) {
    const body: Record<string, unknown> = {
      ...(options.model !== "other-model" ? { model: options.model } : {}),
      messages,
      temperature: options.temperature ?? 1.0,
      max_tokens: maxOutputTokens,
      response_format: responseFormat,
      stream: false,
    };

    if (toolsEnabled) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const response = await callCustomChatCompletions({
      endpointUrl: options.endpointUrl,
      apiKey,
      body,
      logLabel: "Custom preset generation",
      messagesForLog: messages as Array<Record<string, unknown>>,
    });

    if (!response.success) {
      log.error("Custom preset generation request failed", new Error(response.error.errorBody), {
        errorType: "CustomPresetGenerationHttpError",
        metadata: {
          model: options.model,
          status: response.error.status,
          errorBody: response.error.errorBody,
        },
      });
      // The reply is public. The reason phrase is endpoint-controlled, and a status-0 message can
      // quote the body through a JSON parse error, so the cause stays in the log above.
      return {
        error:
          response.error.status === 0
            ? "The custom endpoint could not be reached, or its response could not be read. The bot log has the cause."
            : `Custom endpoint request failed (HTTP ${response.error.status}).`,
        errorType: "CONNECTION",
      };
    }

    const message = response.data.choices?.[0]?.message as
      | {
          content?: unknown;
          tool_calls?: CustomToolCall[];
        }
      | undefined;

    if (!message) {
      return {
        error: "Custom endpoint returned an empty response.",
        errorType: "EMPTY_RESPONSE",
      };
    }

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length > 0) {
      if (!toolsEnabled || !toolContext) {
        return {
          error: "Custom endpoint requested tool calls but tools are not available.",
          errorType: "MODEL_ERROR",
        };
      }

      toolRounds += 1;
      if (toolRounds > maxToolRounds) {
        return {
          error: "Custom endpoint tool call loop exceeded limit.",
          errorType: "TIMEOUT",
        };
      }

      const normalizedToolCalls = toolCalls.map((toolCall, index) => ({
        ...toolCall,
        id: toolCall.id ?? `tool_call_${toolRounds}_${index}`,
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
              log.warn(`Custom tool call args parse failed for ${functionName}: ${rawArgs}`, parseError as Error);
              toolResult = buildToolErrorResult(`Invalid tool arguments for ${functionName}`);
            }
          }

          if (!toolResult) {
            log.info(
              `Executing custom preset-generation tool call: ${functionName} with args: ${JSON.stringify(parsedArgs)}`,
            );
            toolResult = await executeTool(functionName, parsedArgs, toolContext);
          }
        }

        const convertedResult = customAdapter.convertResult(
          toolResult ?? buildToolErrorResult("Tool execution failed"),
        );
        const resultContent =
          typeof convertedResult.content === "string"
            ? convertedResult.content
            : JSON.stringify(convertedResult.content);
        const toolCallId = toolCall.id ?? "tool_call_unknown";

        messages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: resultContent,
        });
      }

      continue;
    }

    const responseText = extractCustomResponseText(message.content);
    if (!responseText) {
      return {
        error: "Custom endpoint returned an empty response.",
        errorType: "EMPTY_RESPONSE",
      };
    }

    // parseCustomJsonResponse already probes the fenced, bracketed, and braced candidates
    // and repairs a truncated tail, so the shared extractor adds only the preset contract.
    const decoded = extractPresetGenerationFields(responseText, parseCustomJsonResponse, (parseError) =>
      log.error("Custom preset generation response could not be parsed", parseError),
    );
    if (!decoded.ok) {
      log.error(`Custom preset generation rejected: ${decoded.failure.code}`);
      return {
        error:
          decoded.failure.code === "PARSE_FAILED"
            ? "Invalid JSON response from custom endpoint."
            : presetGenerationFailureMessage(decoded.failure),
        errorType: presetGenerationFailureErrorType(decoded.failure),
      };
    }

    const preset = {
      tomori_nickname: params.characterName,
      trigger_words: [params.characterName],
      ...decoded.preset,
    };

    log.success(`Custom preset generation successful for ${params.characterName}`);
    return { preset };
  }
}
