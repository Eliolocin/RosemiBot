import { isBraveSearchAvailable } from "@/tools/restAPIs/brave/braveSearchService";
import { isSearxngAvailable } from "@/tools/restAPIs/searxng/searxngService";
import { BASE_SEARCH_CATEGORIES, SEARCH_CATEGORIES, type SearchCategory, type WebSearchEngineName } from "./types";

export interface WebSearchToolCapabilities {
  categories: SearchCategory[];
  engineLabel: string;
}

function describeEngine(engineName: WebSearchEngineName): string {
  switch (engineName) {
    case "brave":
      return "Brave Search";
    case "searxng":
      return "SearXNG";
    case "duckduckgo":
      return "DuckDuckGo";
  }
}

export async function resolveWebSearchToolCapabilities(serverId?: number): Promise<WebSearchToolCapabilities> {
  const searxngAvailable = await isSearxngAvailable();
  const braveAvailable = await isBraveSearchAvailable(serverId);

  if (searxngAvailable) {
    return {
      categories: [...SEARCH_CATEGORIES],
      engineLabel: braveAvailable
        ? `${describeEngine("brave")} + ${describeEngine("searxng")}`
        : describeEngine("searxng"),
    };
  }

  if (braveAvailable) {
    return {
      categories: [...BASE_SEARCH_CATEGORIES],
      engineLabel: describeEngine("brave"),
    };
  }

  return {
    categories: ["text"],
    engineLabel: describeEngine("duckduckgo"),
  };
}
