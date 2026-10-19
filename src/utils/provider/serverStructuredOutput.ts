import type { ErrorContext, TomoriState } from "@/types/db/schema";
import type { StructuredOutputResult, SupportsStructuredOutput } from "@/types/provider/featureInterfaces";
import { llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import { resolveStructuredOutputCapability } from "@/utils/provider/providerCapabilityResolver";
import { withSavedProviderConfig } from "@/utils/provider/savedProviderConfig";
import { decryptApiKey } from "@/utils/security/crypto";

export type MalformedStructuredReply = NonNullable<
  Extract<StructuredOutputResult<unknown>, { success: false }>["malformed"]
>;

/** The note a single format retry appends, naming the exact problem with the previous reply. */
export function formatStructuredRetryNote(malformed: MalformedStructuredReply): string {
  const ask = "Answer again with only the JSON object, without code fences or other text.";
  if (malformed.reason === "empty")
    return `Your previous answer was empty, most likely because reasoning used up the output limit. ${ask}`;
  if (malformed.reason === "unparsable") return `Your previous answer was not one valid JSON object. ${ask}`;
  const issues = (malformed.issues ?? []).map((issue) => `- ${issue}`).join("\n");
  return `Your previous answer did not match the schema:\n${issues}\n${ask}`;
}

export interface ResolvedServerStructuredModel {
  capability: SupportsStructuredOutput;
  state: TomoriState;
  apiKey: string;
}

/**
 * Resolves a server-pinned model for a structured call outside the persona's own model: it must be
 * live, structured-output capable, offered to the server, and backed by the server's saved key, so a
 * personal key never pays for it.
 */
export async function resolveServerStructuredModel(
  baseState: TomoriState,
  llmId: number,
  failureContext: ErrorContext,
): Promise<ResolvedServerStructuredModel | { errorLogged: true } | null> {
  const model = await llmModelRepo.loadById(llmId);
  if (!model || model.is_deprecated || !model.supports_structoutput) return null;
  const available = await llmModelRepo.loadAvailableModelsForProvider(model.llm_provider, false, {
    kind: "server",
    ownerId: baseState.server_id,
  });
  if (!available?.some((entry) => entry.llm_id === model.llm_id)) return null;
  const saved = await llmProviderRepo.loadSavedProviderConfig(baseState.server_id, model.llm_provider);
  if (!saved?.api_key) return null;
  const capability = await resolveStructuredOutputCapability(model.llm_provider);
  if (!capability) return null;
  const state = withSavedProviderConfig({ ...baseState, llm: model }, saved);
  // A pinned model must resolve its own endpoint rather than the persona's mirrored endpoint.
  state.config = { ...state.config, custom_endpoint_url: null, custom_num_ctx: null };
  try {
    return { capability, state, apiKey: await decryptApiKey(saved.api_key, saved.key_version ?? 1, failureContext) };
  } catch {
    return { errorLogged: true };
  }
}
