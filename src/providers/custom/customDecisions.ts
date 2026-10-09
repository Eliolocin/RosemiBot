import type { ProviderDecisionRequest, DecisionResult } from "@/types/provider/featureInterfaces";
import {
  encodeNamedDecisionQuestions,
  executeDecisionTransport,
  parseNamedDecisionAnswers,
  parseOrderedDecisionAnswers,
} from "@/providers/utils/decisions";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";
import { normalizeCustomEndpointUrlForStorage } from "@/utils/provider/customEndpointService";

export async function callCustomDecisions(
  request: ProviderDecisionRequest,
  fetchImpl: typeof fetchUserRemoteUrl = fetchUserRemoteUrl,
): Promise<DecisionResult> {
  if (!request.endpointUrl || (request.apiStyle !== "system-one" && request.apiStyle !== "openai-decisions")) {
    return { status: "unavailable", reason: "unsupported", correlationId: request.correlationId, errorLogged: false };
  }
  const url = new URL(normalizeCustomEndpointUrlForStorage(request.apiStyle, request.endpointUrl));
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${request.apiStyle === "system-one" ? "systemone" : "decisions"}`;
  url.hash = "";
  const systemOne = request.apiStyle === "system-one";
  return await executeDecisionTransport(request, {
    url: url.toString(),
    body: systemOne
      ? { model: request.model, state: request.evidence, questions: encodeNamedDecisionQuestions(request) }
      : {
          model: request.model,
          input: request.evidence,
          questions: request.questions.map((question) => ({
            type: "predicate",
            name: question.id,
            instructions: question.instructions,
          })),
        },
    fetch: fetchImpl,
    parseAnswers: (payload) =>
      systemOne ? parseNamedDecisionAnswers(payload, request) : parseOrderedDecisionAnswers(payload, request),
  });
}
