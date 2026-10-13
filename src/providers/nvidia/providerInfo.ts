import type { ProviderInfo } from "@/types/provider/interfaces";

export const nvidiaProviderInfo: ProviderInfo = {
  name: "nvidia",
  displayName: "NVIDIA NIM",
  aliases: ["nim"],
  supportedModels: [],
  requiresApiKey: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsImages: true,
  supportsVideos: false,
  apiFamily: "openai-compatible",
  featureSupport: {
    decisions: false,
    imageGeneration: "chat-completion",
    videoGeneration: "none",
    embeddings: true,
    structuredOutput: true,
    presetGeneration: true,
    expressionInitialization: false,
    liveTokenCounting: false,
    conversationCompaction: true,
    historyExtraction: true,
  },
  featureImplementations: {
    imageGeneration: "nvidia",
  },
  supportedParams: ["temperature", "topP", "topK", "frequencyPenalty", "presencePenalty", "minP"] as const,
};
