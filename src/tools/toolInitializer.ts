/**
 * Tool Initialization System
 * Automatically discovers and registers all available tools with the central registry
 */

import path from "node:path";
import { log } from "../utils/misc/logger";
import { ToolRegistry } from "./toolRegistry";
import getAllFiles from "../utils/misc/ioHelper";
import { BaseTool } from "../types/tool/interfaces";
import type { ErrorContext } from "../types/db/schema";

/**
 * Initialize all tools by auto-discovering and registering them with the central registry
 * This should be called once during application startup
 *
 * Auto-discovers tools from:
 * - src/tools/functionCalls/ - Built-in function call tools
 * - src/tools/webSearch/      - Unified web_search tool (Brave, SearXNG, DuckDuckGo chain)
 * - src/tools/fetchUrl/       - Unified fetch_url tool (hidden engine chain)
 *
 * Note: the previously LLM-visible `BraveXxxSearchTool` classes are now demoted
 * to `restAPIs/brave/internal/` and consumed only by `webSearch/braveEngine.ts`.
 * They are intentionally excluded from auto-discovery.
 *
 * MCP tools are still handled by Google's official mcpToTool() - no manual registration needed
 */
export async function initializeTools(): Promise<void> {
  try {
    log.info("Initializing tool registry with auto-discovery...");

    ToolRegistry.clearRegistry();

    let totalDiscovered = 0;

    const functionCallsPath = path.join(process.cwd(), "src", "tools", "functionCalls");
    const functionCallFiles = (await getAllFiles(functionCallsPath)).filter((file) => !file.endsWith("index.ts"));

    log.info(`Scanning ${functionCallFiles.length} files in functionCalls directory...`);

    for (const toolFile of functionCallFiles) {
      const discovered = await discoverAndRegisterTools(toolFile, "functionCalls");
      totalDiscovered += discovered;
    }

    // Auto-discover unified webSearch tool(s).
    //    The webSearch/ folder contains a single LLM-visible class (WebSearchTool)
    //    plus engine-internal modules. We scan only `webSearchTool.ts` to keep
    //    the engine modules (which export instances, not BaseTool subclasses)
    //    out of registration.
    const webSearchPath = path.join(process.cwd(), "src", "tools", "webSearch");
    const webSearchFiles = (await getAllFiles(webSearchPath)).filter((file) => file.endsWith("webSearchTool.ts"));

    log.info(`Scanning ${webSearchFiles.length} files in webSearch directory...`);

    for (const wsFile of webSearchFiles) {
      const discovered = await discoverAndRegisterTools(wsFile, "webSearch");
      totalDiscovered += discovered;
    }

    // Auto-discover unified fetchUrl tool(s). As with webSearch, scan only
    //    the public BaseTool file and keep engine modules internal.
    const fetchUrlPath = path.join(process.cwd(), "src", "tools", "fetchUrl");
    const fetchUrlFiles = (await getAllFiles(fetchUrlPath)).filter((file) => file.endsWith("fetchUrlTool.ts"));

    log.info(`Scanning ${fetchUrlFiles.length} files in fetchUrl directory...`);

    for (const fetchUrlFile of fetchUrlFiles) {
      const discovered = await discoverAndRegisterTools(fetchUrlFile, "fetchUrl");
      totalDiscovered += discovered;
    }

    const stats = ToolRegistry.getStats();
    log.success(
      `Auto-discovery complete: Found and registered ${totalDiscovered} tools (${stats.totalTools} total in registry)`,
    );
    log.info(
      `Tools by category: ${Object.entries(stats.toolsByCategory)
        .map(([cat, count]) => `${cat}=${count}`)
        .join(", ")}`,
    );
  } catch (error) {
    log.error("Failed to initialize tool registry", error as Error);
    throw error;
  }
}

/**
 * Discover and register tools from a specific file
 * @param filePath - Absolute path to the tool file
 * @param source - Source identifier for logging (e.g., "functionCalls", "brave")
 */
async function discoverAndRegisterTools(filePath: string, source: string): Promise<number> {
  let discoveredCount = 0;

  try {
    const toolModule = await import(filePath);

    for (const [exportName, exportedItem] of Object.entries(toolModule)) {
      try {
        if (typeof exportedItem === "function" && exportedItem.prototype instanceof BaseTool) {
          const toolInstance = new (exportedItem as new () => BaseTool)();

          ToolRegistry.registerTool(toolInstance);

          log.info(`Auto-registered [${source}]: ${toolInstance.name} (${toolInstance.category}) from ${exportName}`);

          discoveredCount++;
        }
      } catch (error) {
        const context: ErrorContext = {
          errorType: "ToolRegistrationError",
          metadata: {
            filePath,
            exportName,
            source,
          },
        };
        await log.error(`Failed to register tool export '${exportName}' from ${filePath}:`, error as Error, context);
      }
    }
  } catch (error) {
    const context: ErrorContext = {
      errorType: "ToolDiscoveryError",
      metadata: {
        filePath,
        source,
      },
    };
    await log.error(`Failed to import tool file: ${filePath}`, error as Error, context);
  }

  return discoveredCount;
}
