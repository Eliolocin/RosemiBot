import type { ProviderDecisionRequest } from "@/types/provider/featureInterfaces";
import {
  encodeNamedDecisionQuestions,
  executeDecisionTransport,
  parseNamedDecisionAnswers,
} from "@/providers/utils/decisions";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";

export async function callOpenRouterDecisions(
  request: ProviderDecisionRequest,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = fetch,
) {
  return await executeDecisionTransport(request, {
    url: "https://openrouter.ai/api/alpha/decisions",
    body: { model: request.model, state: request.evidence, questions: encodeNamedDecisionQuestions(request) },
    headers: buildOpenRouterAttributionHeaders(),
    fetch: fetchImpl,
    parseAnswers: (payload) => parseNamedDecisionAnswers(payload, request),
  });
}
