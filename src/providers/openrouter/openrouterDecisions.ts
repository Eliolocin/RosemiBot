import type { ProviderDecisionRequest } from "@/types/provider/featureInterfaces";
import {
  encodeNamedDecisionQuestions,
  executeDecisionTransport,
  parseNamedDecisionAnswers,
} from "@/providers/utils/decisions";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";
import { fetchWithProviderRequest } from "@/utils/provider/providerRequestHook";

export async function callOpenRouterDecisions(
  request: ProviderDecisionRequest,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = fetch,
) {
  return await executeDecisionTransport(request, {
    url: "https://openrouter.ai/api/alpha/decisions",
    body: { model: request.model, state: request.evidence, questions: encodeNamedDecisionQuestions(request) },
    headers: buildOpenRouterAttributionHeaders(),
    fetch: (url, init) =>
      fetchWithProviderRequest(url, init, (input, options) => fetchImpl(String(input), options ?? {})),
    parseAnswers: (payload) => parseNamedDecisionAnswers(payload, request),
  });
}
