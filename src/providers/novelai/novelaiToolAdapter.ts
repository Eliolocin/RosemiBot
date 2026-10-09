/**
 * NovelAI Tool Adapter
 * Converts generic tools to OpenAI-compatible function format for prompt-based tool calling.
 *
 * NovelAI's /oa/v1/completions endpoint doesn't accept tools natively, so this adapter
 * provides tool definitions for prompt construction and MCP execution.
 */

import { log } from "@/utils/misc/logger";
import type {
  Tool,
  MCPCapableToolAdapter,
  ToolResult,
  ToolParameterPropertySchema,
  ToolParameterType,
} from "@/types/tool/interfaces";

/**
 * OpenAI-compatible function declaration format
 */
interface OpenAIFunctionDeclaration extends Record<string, unknown> {
  name: string;
  description: string;
  parameters: OpenAIObjectSchema;
}

interface OpenAIParameterSchema extends Record<string, unknown> {
  type: ToolParameterType;
  description?: string;
  enum?: string[];
  items?: OpenAIParameterSchema;
  properties?: Record<string, OpenAIParameterSchema>;
  required?: string[];
}

interface OpenAIObjectSchema extends OpenAIParameterSchema {
  type: "object";
  properties: Record<string, OpenAIParameterSchema>;
  required: string[];
}

/**
 * NovelAI tool adapter implementation with MCP capabilities
 */
export class NovelaiToolAdapter implements MCPCapableToolAdapter {
  private static instance: NovelaiToolAdapter;

  static getInstance(): NovelaiToolAdapter {
    if (!NovelaiToolAdapter.instance) {
      NovelaiToolAdapter.instance = new NovelaiToolAdapter();
    }
    return NovelaiToolAdapter.instance;
  }

  getProviderName(): string {
    return "novelai";
  }

  /**
   * Convert a generic tool to OpenAI function declaration format
   */
  convertTool(tool: Tool): Record<string, unknown> {
    try {
      const openaiFunction: OpenAIFunctionDeclaration = {
        name: tool.name,
        description: tool.description,
        parameters: this.cloneParameterSchema(tool.parameters),
      };

      log.info(`NovelAI adapter: Converted tool '${tool.name}' to OpenAI format`);

      return openaiFunction;
    } catch (error) {
      log.error(`NovelAI adapter: Failed to convert tool '${tool.name}'`, error as Error);
      throw error;
    }
  }

  /**
   * Convert tool result back to OpenAI-specific format
   * @returns OpenAI-specific result format
   */
  convertResult(result: ToolResult): Record<string, unknown> {
    try {
      if (result.success) {
        let resultText = result.message || "Tool executed successfully";

        if (result.data && typeof result.data === "object") {
          const data = result.data as Record<string, unknown>;

          if (data.summary && typeof data.summary === "string") {
            resultText = data.summary;
          } else if (data.message && typeof data.message === "string") {
            resultText = data.message;
          } else if (data.selectionReason && typeof data.selectionReason === "string") {
            resultText = data.selectionReason;
          } else {
            const relevantData = this.extractRelevantData(data);
            if (relevantData) {
              resultText = `${resultText}\n\nResult: ${relevantData}`;
            }
          }
        }

        return {
          content: resultText,
        };
      }

      const errorText = result.message || result.error || "Tool execution failed";

      return {
        content: `Error: ${errorText}`,
      };
    } catch (error) {
      log.error("NovelAI adapter: Failed to convert tool result", error as Error);

      return {
        content: "Error: Failed to process tool result",
      };
    }
  }

  /**
   * Convert multiple tools to OpenAI tools array format
   */
  convertToolsArray(tools: Tool[]): Array<Record<string, unknown>> {
    if (tools.length === 0) {
      return [];
    }

    try {
      return tools.map((tool) => ({
        type: "function",
        function: this.convertTool(tool),
      }));
    } catch (error) {
      log.error("NovelAI adapter: Failed to convert tools array", error as Error);
      return [];
    }
  }

  /**
   * Get all available tools (built-in + MCP) in provider-specific format
   * Implementation of MCPCapableToolAdapter interface
   * @param serverId - Optional Discord server ID for server-specific tool selection
   * @param allowedMCPFunctions - Optional pre-filtered list of MCP function names to include
   */
  async getAllToolsInProviderFormat(
    builtInTools: Tool[],
    serverId?: number,
    allowedMCPFunctions?: string[],
  ): Promise<Array<Record<string, unknown>>> {
    return this.getAllToolsInOpenAIFormat(builtInTools, serverId, allowedMCPFunctions);
  }

  /**
   * Get the built-in tools in OpenAI tools format. NovelAI declares no guild MCP tools.
   */
  async getAllToolsInOpenAIFormat(
    builtInTools: Tool[],
    _serverId?: number,
    _allowedMCPFunctions?: string[],
  ): Promise<Array<Record<string, unknown>>> {
    try {
      const allTools: Record<string, unknown>[] = [];

      // Brave-key dance removed: unified web_search is gated centrally.
      if (builtInTools.length > 0) {
        const builtInToolsFormatted = this.convertToolsArray(builtInTools);
        allTools.push(...builtInToolsFormatted);
        log.info(`NovelAI adapter: Converted ${builtInTools.length} built-in tools`);
      }

      log.info(`NovelAI adapter: Total tools: ${allTools.length}`);
      return allTools;
    } catch (error) {
      log.error("NovelAI adapter: Failed to get all tools in OpenAI format", error as Error);
      return [];
    }
  }

  /**
   * Validate that a tool is compatible with this provider
   * @returns boolean - True if compatible
   */
  validateToolCompatibility(tool: Tool): boolean {
    try {
      // Basic validation: check required fields
      if (!tool.name || !tool.description || !tool.parameters) {
        log.warn(
          `Tool validation failed: missing required fields (name: ${!!tool.name}, description: ${!!tool.description}, parameters: ${!!tool.parameters})`,
        );
        return false;
      }

      for (const [paramName, paramSchema] of Object.entries(tool.parameters.properties)) {
        if (!this.isSupportedParameterSchema(paramSchema)) {
          log.warn(`Tool '${tool.name}' has unsupported parameter schema (param: ${paramName})`);
          return false;
        }
      }

      return true;
    } catch (error) {
      log.error(`Tool validation error for '${tool.name}'`, error as Error);
      return false;
    }
  }

  /**
   * Convert generic parameter type to OpenAI type
   */
  private cloneParameterSchema(schema: Tool["parameters"]): OpenAIObjectSchema {
    return JSON.parse(JSON.stringify(schema)) as OpenAIObjectSchema;
  }

  private isSupportedParameterSchema(schema: ToolParameterPropertySchema): boolean {
    const supportedTypes: ToolParameterType[] = ["string", "number", "boolean", "array", "object"];

    if (!supportedTypes.includes(schema.type)) {
      return false;
    }

    if (schema.type === "array") {
      return this.isSupportedParameterSchema(schema.items);
    }

    if (schema.type === "object") {
      return Object.values(schema.properties).every((propertySchema) =>
        this.isSupportedParameterSchema(propertySchema),
      );
    }

    return true;
  }

  /**
   * Extract relevant data from a complex object for result text
   */
  private extractRelevantData(data: Record<string, unknown>): string | null {
    try {
      const keys = Object.keys(data);
      if (keys.length === 0) {
        return null;
      }

      const relevantKeys = keys.slice(0, 5);
      const relevantData: Record<string, unknown> = {};
      for (const key of relevantKeys) {
        relevantData[key] = data[key];
      }

      return JSON.stringify(relevantData, null, 2);
    } catch (error) {
      log.warn("NovelAI adapter: Failed to extract relevant data", {
        error: error as Error,
      });
      return null;
    }
  }
}

export function getNovelaiToolAdapter(): NovelaiToolAdapter {
  return NovelaiToolAdapter.getInstance();
}
