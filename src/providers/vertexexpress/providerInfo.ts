import type { ProviderInfo } from "@/types/provider/interfaces";

export const vertexexpressProviderInfo: ProviderInfo = {
  name: "vertexexpress",
  displayName: "Google Vertex AI Express",
  aliases: ["vertex-express", "vertexai-express"],
  supportedModels: [],
  requiresApiKey: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsImages: true,
  supportsVideos: false,
  apiFamily: "google-genai",
  featureSupport: {
    decisions: false,
    imageGeneration: "chat-completion",
    videoGeneration: "none",
    embeddings: false,
    structuredOutput: true,
    presetGeneration: true,
    expressionInitialization: true,
    liveTokenCounting: false,
    conversationCompaction: true,
    historyExtraction: true,
  },
  supportedParams: ["temperature", "topP", "topK"] as const,
};
