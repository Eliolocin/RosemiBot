import type {
  ProviderCapabilityMap,
  ProviderCapabilityName,
  SupportsConversationCompaction,
  SupportsEmbeddings,
  SupportsLiveTokenCounting,
  SupportsNativeImageGeneration,
  SupportsNativeVideoGeneration,
  SupportsPresetGeneration,
  SupportsStructuredOutput,
  SupportsDecisions,
} from "@/types/provider/featureInterfaces";
import type { LLMProvider } from "@/types/provider/interfaces";
import { ProviderFactory } from "@/utils/provider/providerFactory";
import { normalizeProviderName } from "@/utils/provider/providerInfoRegistry";

function hasEmbeddingsCapability(provider: LLMProvider): provider is LLMProvider & SupportsEmbeddings {
  return (
    typeof (provider as Partial<SupportsEmbeddings>).generateEmbeddings === "function" &&
    typeof (provider as Partial<SupportsEmbeddings>).supportsEmbeddingTaskType === "function"
  );
}

function hasStructuredOutputCapability(provider: LLMProvider): provider is LLMProvider & SupportsStructuredOutput {
  return typeof (provider as Partial<SupportsStructuredOutput>).callStructuredJSON === "function";
}

function hasPresetGenerationCapability(provider: LLMProvider): provider is LLMProvider & SupportsPresetGeneration {
  return typeof (provider as Partial<SupportsPresetGeneration>).generatePreset === "function";
}

function hasConversationCompactionCapability(
  provider: LLMProvider,
): provider is LLMProvider & SupportsConversationCompaction {
  return (
    typeof (provider as Partial<SupportsConversationCompaction>).generateConversationSummary === "function" &&
    typeof (provider as Partial<SupportsConversationCompaction>).generateRoleplaySummary === "function"
  );
}

function hasLiveTokenCountingCapability(provider: LLMProvider): provider is LLMProvider & SupportsLiveTokenCounting {
  return typeof (provider as Partial<SupportsLiveTokenCounting>).measureInputTokens === "function";
}

function hasNativeImageGenerationCapability(
  provider: LLMProvider,
): provider is LLMProvider & SupportsNativeImageGeneration {
  return typeof (provider as Partial<SupportsNativeImageGeneration>).generateNativeImage === "function";
}

function hasNativeVideoGenerationCapability(
  provider: LLMProvider,
): provider is LLMProvider & SupportsNativeVideoGeneration {
  return typeof (provider as Partial<SupportsNativeVideoGeneration>).generateNativeVideo === "function";
}

const capabilityGuards = {
  decisions: (provider: LLMProvider): provider is LLMProvider & SupportsDecisions =>
    typeof (provider as Partial<SupportsDecisions>).callDecisions === "function",
  embeddings: hasEmbeddingsCapability,
  structuredOutput: hasStructuredOutputCapability,
  presetGeneration: hasPresetGenerationCapability,
  conversationCompaction: hasConversationCompactionCapability,
  liveTokenCounting: hasLiveTokenCountingCapability,
  imageGeneration: hasNativeImageGenerationCapability,
  videoGeneration: hasNativeVideoGenerationCapability,
} satisfies {
  [K in ProviderCapabilityName]: (provider: LLMProvider) => provider is LLMProvider & ProviderCapabilityMap[K];
};

async function resolveProviderCapability<TCapabilityName extends ProviderCapabilityName>(
  providerName: string,
  capabilityName: TCapabilityName,
): Promise<(LLMProvider & ProviderCapabilityMap[TCapabilityName]) | null> {
  const provider = await ProviderFactory.getProviderByName(normalizeProviderName(providerName));
  const capabilityGuard = capabilityGuards[capabilityName] as unknown as (
    provider: LLMProvider,
  ) => provider is LLMProvider & ProviderCapabilityMap[TCapabilityName];

  return capabilityGuard(provider) ? (provider as LLMProvider & ProviderCapabilityMap[TCapabilityName]) : null;
}

export async function resolveEmbeddingsCapability(providerName: string) {
  return resolveProviderCapability(providerName, "embeddings");
}

export async function resolveDecisionsCapability(providerName: string) {
  return resolveProviderCapability(providerName, "decisions");
}

export async function resolveStructuredOutputCapability(providerName: string) {
  return resolveProviderCapability(providerName, "structuredOutput");
}

export async function resolvePresetGenerationCapability(providerName: string) {
  return resolveProviderCapability(providerName, "presetGeneration");
}

export async function resolveConversationCompactionCapability(providerName: string) {
  return resolveProviderCapability(providerName, "conversationCompaction");
}

export async function resolveNativeImageGenerationCapability(providerName: string) {
  return resolveProviderCapability(providerName, "imageGeneration");
}
