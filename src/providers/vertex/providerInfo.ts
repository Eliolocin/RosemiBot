/**
 * Vertex AI provider metadata and capability flags
 *
 * Feature parity with Google AI Studio: all helpers accept an optional
 * pre-built GoogleGenAI client, so Vertex passes its ADC client through.
 *
 * liveTokenCounting is backed by the same Google tokenizer: the ADC client
 * (createVertexClient) exposes models.countTokens(), measured in
 * cost.ts::measureVertexInputTokens.
 */

import type { ProviderInfo } from "../../types/provider/interfaces";

export const vertexProviderInfo: ProviderInfo = {
  name: "vertex",
  displayName: "Google Vertex AI",
  aliases: ["vertexai"],
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
    videoGeneration: "none",
    embeddings: true,
    structuredOutput: true,
    presetGeneration: true,
    expressionInitialization: true,
    liveTokenCounting: true,
    conversationCompaction: true,
    historyExtraction: true,
  },
  featureImplementations: {
    liveTokenCounting: "vertex",
  },
  supportedParams: ["temperature", "topP", "topK"] as const,
};
