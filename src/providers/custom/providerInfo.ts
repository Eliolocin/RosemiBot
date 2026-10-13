import type { ProviderInfo } from "@/types/provider/interfaces";

export const customProviderInfo: ProviderInfo = {
  name: "custom",
  displayName: "Custom Endpoint",
  aliases: [],
  supportedModels: [],
  requiresApiKey: false,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsImages: true,
  supportsVideos: false,
  apiFamily: "openai-compatible",
  featureSupport: {
    decisions: true,
    imageGeneration: "none",
    videoGeneration: "none",
    embeddings: true,
    structuredOutput: true,
    presetGeneration: true,
    expressionInitialization: true,
    liveTokenCounting: false,
    conversationCompaction: true,
    historyExtraction: true,
  },
  usageCostMode: "none",
  supportedParams: ["temperature", "topP", "topK", "frequencyPenalty", "presencePenalty", "minP"] as const,
};
