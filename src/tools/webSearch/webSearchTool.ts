/**
 * WebSearchTool : the single LLM-visible search tool.
 *
 * Replaces the previously-LLM-visible 4-tool Brave surface (`brave_web_search`,
 * `brave_image_search`, `brave_video_search`, `brave_news_search`) with one
 * tool that takes a `category` enum. The dispatcher routes to whichever
 * engine in the chain (Brave → SearXNG → DuckDuckGo) can serve the
 * requested category.
 *
 * Saves ~400 tokens/turn from removed tool declarations and eliminates
 * wrong-tool-name fuzzy-matching errors observed in NovelAI streams.
 */

import {
  BaseTool,
  type Tool,
  type ToolAssemblyContext,
  type ToolContext,
  type ToolParameterSchema,
  type ToolResult,
} from "@/types/tool/interfaces";
import { createToolVariant } from "@/tools/assembly";
import { log } from "@/utils/misc/logger";
import { executeWebSearchWithFallback } from "./dispatcher";
import { resolveWebSearchToolCapabilities, type WebSearchToolCapabilities } from "./capabilities";
import { SEARCH_CATEGORIES, type SearchCategory } from "./types";

function formatCategoryList(categories: SearchCategory[]): string {
  return categories.map((category) => `'${category}'`).join(", ");
}

export function buildWebSearchToolVariant(tool: Tool, capabilities: WebSearchToolCapabilities): Tool {
  const categoryDescription =
    capabilities.categories.length === 1 && capabilities.categories[0] === "text"
      ? "Search category. Only 'text' is available for the active search backend this turn."
      : `Search category. Available categories for the active search backend this turn: ${formatCategoryList(
          capabilities.categories,
        )}.`;

  const parameters: ToolParameterSchema = {
    ...tool.parameters,
    properties: {
      ...tool.parameters.properties,
      category: {
        ...tool.parameters.properties.category,
        description: categoryDescription,
        enum: [...capabilities.categories],
      },
    },
  };

  return createToolVariant(tool, {
    description:
      `Search the web using ${capabilities.engineLabel}. ` +
      `The schema only exposes categories supported by the active backend: ${formatCategoryList(
        capabilities.categories,
      )}.`,
    parameters,
  });
}

export class WebSearchTool extends BaseTool {
  name = "web_search";
  description =
    "Search the web for information. The category enum is narrowed during tool assembly to the active backend's supported categories. Routes through the best available search engine automatically.";

  category = "search" as const;
  requiresFeatureFlag = "web_search";
  requiresFollowUp = true;

  parameters = {
    type: "object" as const,
    properties: {
      query: {
        type: "string" as const,
        description:
          "The search query to execute. " +
          "For image/video/news categories use plain descriptive terms only — " +
          "do NOT use operators like 'site:', 'filetype:', or quotes; they are ignored by media search engines and degrade results.",
      },
      category: {
        type: "string" as const,
        description:
          "Search category. The assembled schema only includes categories supported by the active backend for this turn.",
        enum: [...SEARCH_CATEGORIES],
      },
      count: {
        type: "number" as const,
        description:
          "Number of results to return. For image searches this controls how many images are sent " +
          "to Discord (max 10). For text/news/video searches it controls the result list length " +
          "(max 20). Omit to use the server default.",
      },
    },
    required: ["query"],
  };

  isAvailableFor(_provider: string): boolean {
    return true;
  }

  async assembleForContext(context: ToolAssemblyContext): Promise<Tool | null> {
    const serverId = Number.parseInt(context.state.server_id, 10);
    const capabilities = await resolveWebSearchToolCapabilities(Number.isInteger(serverId) ? serverId : undefined);
    return buildWebSearchToolVariant(this, capabilities);
  }

  protected isEnabled(context: ToolContext): boolean {
    return context.tomoriState.config.web_search_enabled;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    try {
      // Feature flag gate : mirrors the previous BraveSearchTool behavior.
      if (!this.isEnabled(context)) {
        return {
          success: false,
          error: "Web search is disabled for this server",
          message: "Web search functionality is not enabled for this server.",
        };
      }

      if (typeof args.query !== "string" || args.query.trim().length === 0) {
        return {
          success: false,
          error: "Query is required and must be a non-empty string",
          message: "I need a search query to look anything up.",
        };
      }

      const rawCategory = typeof args.category === "string" ? args.category : "text";
      const category: SearchCategory = SEARCH_CATEGORIES.includes(rawCategory as SearchCategory)
        ? (rawCategory as SearchCategory)
        : "text";

      // Normalize count : must be a positive integer, otherwise omit.
      const rawCount = typeof args.count === "number" && args.count > 0 ? Math.floor(args.count) : undefined;

      log.info(
        `web_search invoked: category=${category} query="${args.query}"${rawCount !== undefined ? ` count=${rawCount}` : ""}`,
      );

      // The dispatcher emits the per-engine Discord notice through the engine's underlying
      // tool wrapper: BraveEngine reuses the Internal*Tool classes that already call
      // sendToolNotice, while the SearXNG and DuckDuckGo engines send it themselves.
      return await executeWebSearchWithFallback(args.query as string, category, context, rawCount);
    } catch (error) {
      log.error("Error in web_search tool:", error as Error);
      return {
        success: false,
        error: `Failed to execute web search: ${(error as Error).message}`,
      };
    }
  }
}
