import type {
  OpenAICompatibleFunctionDeclaration,
  OpenAICompatibleObjectSchema,
} from "@/providers/openaiCompatible/openaiCompatibleTypes";
import type {
  MCPCapableToolAdapter,
  Tool,
  ToolParameterPropertySchema,
  ToolParameterType,
  ToolResult,
} from "@/types/tool/interfaces";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { log } from "@/utils/misc/logger";

export class OpenAICompatibleToolAdapter implements MCPCapableToolAdapter {
  constructor(private readonly providerName: string) {}

  getProviderName(): string {
    return this.providerName;
  }

  convertTool(tool: Tool): Record<string, unknown> {
    try {
      const openaiFunction: OpenAICompatibleFunctionDeclaration = {
        name: tool.name,
        description: tool.description,
        parameters: this.cloneParameterSchema(tool.parameters),
      };

      log.info(`${this.providerName} adapter: Converted tool '${tool.name}' to OpenAI-compatible format`);

      return openaiFunction;
    } catch (error) {
      log.error(`${this.providerName} adapter: Failed to convert tool '${tool.name}'`, error as Error);
      throw error;
    }
  }

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
      log.error(`${this.providerName} adapter: Failed to convert tool result`, error as Error);

      return {
        content: "Error: Failed to process tool result",
      };
    }
  }

  async getAllToolsInProviderFormat(
    builtInTools: Tool[],
    serverId?: number,
    allowedMCPFunctions?: string[],
  ): Promise<Array<Record<string, unknown>>> {
    return await this.getAllToolsInOpenAICompatibleFormat(builtInTools, serverId, allowedMCPFunctions);
  }

  async getAllToolsInOpenAIFormat(
    builtInTools: Tool[],
    serverId?: number,
    allowedMCPFunctions?: string[],
  ): Promise<Array<Record<string, unknown>>> {
    return await this.getAllToolsInOpenAICompatibleFormat(builtInTools, serverId, allowedMCPFunctions);
  }

  async getAllToolsInOpenAICompatibleFormat(
    builtInTools: Tool[],
    serverId?: number,
    allowedMCPFunctions?: string[],
  ): Promise<Array<Record<string, unknown>>> {
    try {
      const allTools: Record<string, unknown>[] = [];
      // Brave-key dance removed: unified web_search is gated centrally.
      if (builtInTools.length > 0) {
        allTools.push(...this.convertToolsArray(builtInTools));
        log.info(`${this.providerName} adapter: Converted ${builtInTools.length} built-in tools`);
      }

      if (serverId && allowedMCPFunctions) {
        try {
          const guildMcpManager = getGuildMcpManager();
          const guildTools = await guildMcpManager.getGuildMCPTools(serverId);
          const allowedFunctionSet = new Set(allowedMCPFunctions);
          let addedGuildToolsCount = 0;

          for (const guildTool of guildTools) {
            try {
              const geminiTool = await guildTool.tool();
              if (!geminiTool.functionDeclarations) {
                continue;
              }

              const declarations = (geminiTool.functionDeclarations as Record<string, unknown>[]).filter((decl) =>
                allowedFunctionSet.has(decl.name as string),
              );

              for (const declaration of declarations) {
                const openAIDeclaration: Record<string, unknown> = {
                  ...declaration,
                };
                if ("parametersJsonSchema" in declaration) {
                  delete openAIDeclaration.parametersJsonSchema;
                  openAIDeclaration.parameters = declaration.parametersJsonSchema;
                }

                allTools.push({
                  type: "function",
                  function: openAIDeclaration,
                });
                addedGuildToolsCount++;
              }
            } catch (error) {
              log.warn(`${this.providerName} adapter: Failed to extract guild MCP tool declarations`, error as Error);
            }
          }

          if (addedGuildToolsCount > 0) {
            log.info(`${this.providerName} adapter: Added ${addedGuildToolsCount} guild MCP tool(s)`);
          }
        } catch (error) {
          log.warn(`${this.providerName} adapter: Failed to get guild MCP tools`, error as Error);
        }
      }

      log.info(`${this.providerName} adapter: Total tools: ${allTools.length}`);
      return allTools;
    } catch (error) {
      log.error(`${this.providerName} adapter: Failed to get all tools in OpenAI-compatible format`, error as Error);
      return [];
    }
  }

  validateToolCompatibility(tool: Tool): boolean {
    try {
      if (!tool.name || !tool.description || !tool.parameters) {
        log.warn(`${this.providerName} adapter: Tool validation failed: missing required fields`);
        return false;
      }

      for (const [_paramName, paramSchema] of Object.entries(tool.parameters.properties)) {
        if (!this.isSupportedParameterSchema(paramSchema)) {
          log.warn(`${this.providerName} adapter: Tool '${tool.name}' has unsupported parameter schema`);
          return false;
        }
      }

      return true;
    } catch (error) {
      log.error(`${this.providerName} adapter: Tool validation error for '${tool.name}'`, error as Error);
      return false;
    }
  }

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
      log.error(`${this.providerName} adapter: Failed to convert tools array`, error as Error);
      return [];
    }
  }

  private cloneParameterSchema(schema: Tool["parameters"]): OpenAICompatibleObjectSchema {
    return JSON.parse(JSON.stringify(schema)) as OpenAICompatibleObjectSchema;
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
      log.warn(`${this.providerName} adapter: Failed to extract relevant data`, {
        error: error as Error,
      });
      return null;
    }
  }
}
