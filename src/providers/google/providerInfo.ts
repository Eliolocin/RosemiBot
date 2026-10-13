import type { ProviderInfo } from "@/types/provider/interfaces";

export const googleProviderInfo: ProviderInfo = {
  name: "google",
  displayName: "Google Gemini",
  aliases: ["gemini"],
  supportedModels: [],
  requiresApiKey: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsImages: true,
  supportsVideos: true,
  apiFamily: "google-genai",
  featureSupport: {
    decisions: false,
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
    imageGeneration: "google",
    videoGeneration: "google",
    liveTokenCounting: "google",
  },
  supportedParams: ["temperature", "topP", "topK", "frequencyPenalty", "presencePenalty"] as const,
};
