import type { ProviderInfo } from "@/types/provider/interfaces";

export const openrouterProviderInfo: ProviderInfo = {
  name: "openrouter",
  displayName: "OpenRouter",
  aliases: ["or"],
  supportedModels: [],
  requiresApiKey: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsImages: true,
  supportsVideos: true,
  apiFamily: "openrouter",
  featureSupport: {
    decisions: true,
    imageGeneration: "chat-completion",
    videoGeneration: "chat-completion",
    embeddings: true,
    structuredOutput: true,
    presetGeneration: true,
    expressionInitialization: true,
    liveTokenCounting: true,
    conversationCompaction: true,
    historyExtraction: true,
  },
  featureImplementations: {
    imageGeneration: "openrouter",
    videoGeneration: "openrouter",
    liveTokenCounting: "openrouter",
  },
  supportedParams: ["temperature", "topP", "topK", "frequencyPenalty", "presencePenalty", "minP"] as const,
};
