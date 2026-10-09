/**
 * Vertex AI Tool Adapter
 *
 * Thin wrapper around GoogleToolAdapter. Vertex uses the same Gemini API
 * wire format, so tool conversion, MCP delegation, and result handling
 * are identical: only the provider name differs.
 */

import type { Tool, MCPCapableToolAdapter, ToolResult } from "../../types/tool/interfaces";
import { GoogleToolAdapter } from "../google/googleToolAdapter";

/**
 * Vertex AI tool adapter implementation
 * Delegates everything to GoogleToolAdapter since Vertex uses the same wire format
 */
export class VertexToolAdapter implements MCPCapableToolAdapter {
  private static instance: VertexToolAdapter;
  private readonly googleAdapter: GoogleToolAdapter;

  private constructor() {
    this.googleAdapter = GoogleToolAdapter.getInstance();
  }

  static getInstance(): VertexToolAdapter {
    if (!VertexToolAdapter.instance) {
      VertexToolAdapter.instance = new VertexToolAdapter();
    }
    return VertexToolAdapter.instance;
  }

  getProviderName(): string {
    return "vertex";
  }

  /**
   * Convert a generic tool to Vertex/Gemini function declaration format
   */
  convertTool(tool: Tool): Record<string, unknown> {
    return this.googleAdapter.convertTool(tool);
  }

  /**
   * Convert tool result to Vertex/Gemini-specific format
   * @returns Gemini-specific result format
   */
  convertResult(result: ToolResult): Record<string, unknown> {
    return this.googleAdapter.convertResult(result);
  }

  /**
   * Get all available tools (built-in + MCP) in Vertex/Gemini format
   * @param serverId - Optional Discord server ID for server-specific tool selection
   * @param allowedMCPFunctions - Optional pre-filtered list of MCP function names to include
   */
  async getAllToolsInProviderFormat(
    builtInTools: Tool[],
    serverId?: number,
    allowedMCPFunctions?: string[],
  ): Promise<Array<Record<string, unknown>>> {
    return this.googleAdapter.getAllToolsInGoogleFormat(builtInTools, serverId, allowedMCPFunctions);
  }
}

/**
 * Convenience function for getting the adapter instance
 */
export function getVertexToolAdapter(): VertexToolAdapter {
  return VertexToolAdapter.getInstance();
}
