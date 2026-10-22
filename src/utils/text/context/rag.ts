import { isRagAvailable } from "@/utils/db/ragAvailability";
import { llmModelRepo, ragRepository, serverMemoryRepository } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import { resolveCapabilityCredentials, getResolvedCapabilityModelId } from "@/utils/provider/credentialResolver";
import { memoryGuard } from "@/utils/security/rateLimiter";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { TomoriState } from "@/types/db/schema";
import type { SimplifiedMessageForContext } from "./types";
import { createSupporterUsageRecorder } from "@/modules/supporter-billing/runtime/usageStatistics";
import { channelScopeCandidates } from "@/utils/discord/channelScope";

const DOCUMENT_QUERY_MAX_LENGTH = 1000;
const DOCUMENT_QUERY_MIN_LENGTH = 3;
const DOCUMENT_MAX_RESULTS = 6;
const DOCUMENT_MIN_SIMILARITY = 0.5;

function getLatestUserQuery(messages: SimplifiedMessageForContext[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.authorType !== "user") continue;
    if (!msg.content) continue;
    if (msg.authorId === "0") continue;
    const trimmed = msg.content.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("[System:")) continue;
    return trimmed.slice(0, DOCUMENT_QUERY_MAX_LENGTH);
  }

  return null;
}

export async function buildServerDocumentContextItem(params: {
  tomoriState: TomoriState | null | undefined;
  simplifiedMessageHistory: SimplifiedMessageForContext[];
  triggererUserId?: number;
  channelId: string;
  parentChannelId?: string | null;
}): Promise<StructuredContextItem | null> {
  try {
    const { tomoriState, simplifiedMessageHistory, triggererUserId, channelId, parentChannelId } = params;
    if (!isRagAvailable() || memoryGuard.getStatus() === "critical" || !tomoriState?.server_id) {
      return null;
    }

    const queryText = getLatestUserQuery(simplifiedMessageHistory);
    if (!queryText || queryText.length < DOCUMENT_QUERY_MIN_LENGTH) {
      return null;
    }

    const hasDocument = await serverMemoryRepository.hasDocumentInScope(
      tomoriState.server_id,
      tomoriState.persona_id ?? null,
    );
    if (!hasDocument) {
      return null;
    }

    const creds = await resolveCapabilityCredentials(tomoriState.server_id, "embedding", {
      userId: triggererUserId ?? null,
    });
    const resolvedEmbeddingModelId =
      getResolvedCapabilityModelId(creds, "embedding") ?? tomoriState.config.embedding_model_id;
    const embeddingModel = resolvedEmbeddingModelId
      ? await llmModelRepo.loadEmbeddingModelById(resolvedEmbeddingModelId)
      : null;
    if (!embeddingModel) {
      return null;
    }

    const channelFilter = tomoriState.config.channel_memory_enabled
      ? channelScopeCandidates(channelId, parentChannelId)
      : null;

    const chunks = await ragRepository.retrieveRelevantChunks({
      serverId: tomoriState.server_id,
      personaId: tomoriState.persona_id ?? null,
      query: queryText,
      embeddingModel,
      apiKey: creds.apiKey,
      onUsage: createSupporterUsageRecorder(creds.supporterFunding, embeddingModel.codename),
      maxResults: DOCUMENT_MAX_RESULTS,
      minSimilarity: DOCUMENT_MIN_SIMILARITY,
      channelIds: channelFilter,
    });

    const documentContext = ragRepository.formatChunksForPrompt(chunks);
    if (!documentContext) {
      return null;
    }

    return {
      role: "user",
      parts: [{ type: "text", text: documentContext }],
      metadataTag: ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS,
    };
  } catch (error) {
    log.warn("Failed to add server document context", error);
    return null;
  }
}
