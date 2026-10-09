import type { ProviderInfo } from "@/types/provider/interfaces";

export const deepseekProviderInfo: ProviderInfo = {
  name: "deepseek",
  displayName: "DeepSeek",
  aliases: [],
  supportedModels: [],
  requiresApiKey: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsImages: true,
  supportsVideos: false,
  apiFamily: "openai-compatible",
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
    liveTokenCounting: "deepseek",
  },
  supportedParams: ["temperature", "topP", "topK", "frequencyPenalty", "presencePenalty", "minP"] as const,
};
