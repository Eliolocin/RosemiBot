import type { ProviderInfo } from "@/types/provider/interfaces";

export const novelaiProviderInfo: ProviderInfo = {
  name: "novelai",
  displayName: "NovelAI",
  aliases: ["nai"],
  supportedModels: [],
  requiresApiKey: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsImages: false,
  supportsVideos: false,
  apiFamily: "novelai",
  featureSupport: {
    decisions: false,
    imageGeneration: "nai-pipeline",
    videoGeneration: "none",
    embeddings: false,
    structuredOutput: false,
    presetGeneration: false,
    expressionInitialization: false,
    liveTokenCounting: false,
    conversationCompaction: false,
    historyExtraction: false,
  },
  featureImplementations: {
    imageGeneration: "novelai",
  },
  usageCostMode: "none",
  supportedParams: ["temperature", "topP", "topK", "minP"] as const,
};
