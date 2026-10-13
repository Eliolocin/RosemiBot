import type { MCPCapableToolAdapter, Tool, ToolResult } from "@/types/tool/interfaces";
import { GoogleToolAdapter } from "@/providers/google/googleToolAdapter";

export class VertexexpressToolAdapter implements MCPCapableToolAdapter {
  private static instance: VertexexpressToolAdapter;
  private readonly googleAdapter: GoogleToolAdapter;

  private constructor() {
    this.googleAdapter = GoogleToolAdapter.getInstance();
  }

  static getInstance(): VertexexpressToolAdapter {
    if (!VertexexpressToolAdapter.instance) {
      VertexexpressToolAdapter.instance = new VertexexpressToolAdapter();
    }
    return VertexexpressToolAdapter.instance;
  }

  getProviderName(): string {
    return "vertexexpress";
  }

  convertTool(tool: Tool): Record<string, unknown> {
    return this.googleAdapter.convertTool(tool);
  }

  convertResult(result: ToolResult): Record<string, unknown> {
    return this.googleAdapter.convertResult(result);
  }

  async getAllToolsInProviderFormat(
    builtInTools: Tool[],
    serverId?: number,
    allowedMCPFunctions?: string[],
  ): Promise<Array<Record<string, unknown>>> {
    return this.googleAdapter.getAllToolsInGoogleFormat(builtInTools, serverId, allowedMCPFunctions);
  }
}

export function getVertexexpressToolAdapter(): VertexexpressToolAdapter {
  return VertexexpressToolAdapter.getInstance();
}
