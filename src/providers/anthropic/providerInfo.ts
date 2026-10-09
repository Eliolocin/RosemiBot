import type { ProviderInfo } from "@/types/provider/interfaces";

export const anthropicProviderInfo: ProviderInfo = {
  name: "anthropic",
  displayName: "Anthropic",
  aliases: ["claude"],
  supportedModels: [],
  requiresApiKey: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsImages: true,
  supportsVideos: false,
  apiFamily: "anthropic",
  featureSupport: {
    decisions: false,
    imageGeneration: "none",
    videoGeneration: "none",
    embeddings: false,
    structuredOutput: true,
    presetGeneration: true,
    expressionInitialization: true,
    liveTokenCounting: true,
    conversationCompaction: true,
    historyExtraction: true,
  },
  featureImplementations: {
    liveTokenCounting: "anthropic",
  },
  supportedParams: ["temperature", "topP", "topK"] as const,
};
