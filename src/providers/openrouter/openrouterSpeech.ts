import { z } from "zod";
import { beginProviderRequest, type ProviderRequestHold } from "@/utils/provider/providerRequestHook";
import { findOpenRouterSpeechModel } from "@/providers/openrouter/openrouterSpeechModels";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { readOpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import {
  checkSpeechStatus,
  HOSTED_SPEECH_LIMITS,
  HostedSpeechError,
  readSpeechJson,
  speechErrorBody,
  speechUsageSchema,
  validateSpeechAudio,
  type SpeechOperation,
} from "@/utils/speech/hostedSpeech";

export async function synthesizeOpenRouterSpeech(request: OpenRouterSpeechRequest): Promise<Buffer> {
  request.signal.throwIfAborted();
  const hold = await beginProviderRequest({
    apiKey: request.apiKey,
    path: "/audio/speech",
    body: {
      model: request.model,
      input: buildSpeechBody(request).input,
    },
  });
  let completed = false;
  try {
    if (request.signal.aborted) {
      hold?.reportCost(0);
      request.signal.throwIfAborted();
    }
    const result = await synthesizeSpeech(request, hold);
    completed = true;
    const costs = request.operations.flatMap((operation) =>
      typeof operation.actualCost === "number" ? [operation.actualCost] : [],
    );
    if (costs.length > 0) hold?.reportCost(costs.reduce((sum, cost) => sum + cost, 0));
    return result;
  } finally {
    hold?.release(completed);
  }
}

/**
 * Seed interprets its single prompt instead of reading it aloud and ignores OpenRouter's
 * `instructions` field, so the voice description and delivery direction both travel inside it.
 */
export function buildSeedDesignPrompt(description: string, script: string, direction?: string): string {
  const delivery = direction?.trim();
  // An inner double quote would end the spoken line early, so Seed would read the rest as direction.
  const line = script.trim().replaceAll('"', "'");
  return `Speaker (${description.trim()}) says${delivery ? `, ${delivery}` : ""}: "${line}"`;
}

type OpenRouterSpeechRequest = {
  model: string;
  apiKey: string;
  signal: AbortSignal;
  maxBytes: number;
  operations: SpeechOperation[];
} & (
  | { shape: "clone"; script: string; direction?: string; reference: Buffer; transcript: string | null }
  | { shape: "design"; description: string; script: string; direction?: string }
);

function buildSpeechBody(request: OpenRouterSpeechRequest): Record<string, unknown> {
  if (request.shape === "design") {
    return {
      model: request.model,
      input: buildSeedDesignPrompt(request.description, request.script, request.direction),
      response_format: "mp3",
    };
  }
  return {
    model: request.model,
    input: request.script,
    instructions: request.direction,
    response_format: "mp3",
    input_references: [
      { type: "input_audio", input_audio: { data: `data:audio/wav;base64,${request.reference.toString("base64")}` } },
      ...(request.transcript ? [{ type: "text", text: request.transcript }] : []),
    ],
  };
}

async function synthesizeSpeech(request: OpenRouterSpeechRequest, hold?: ProviderRequestHold): Promise<Buffer> {
  const spec = findOpenRouterSpeechModel(request.model);
  if (!spec || spec.shape !== request.shape) throw new HostedSpeechError("invalid_request");
  if (
    spec.shape === "design" &&
    request.shape === "design" &&
    (request.script.trim().length > spec.scriptCharacters ||
      buildSeedDesignPrompt(request.description, request.script, request.direction).length > spec.promptCharacters)
  ) {
    throw new HostedSpeechError("script_too_long");
  }
  request.signal.throwIfAborted();
  const operation: SpeechOperation = { operation: "synthesize", success: false };
  request.operations.push(operation);
  const response = await fetch("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      "Content-Type": "application/json",
      ...buildOpenRouterAttributionHeaders(),
    },
    redirect: "error",
    signal: request.signal,
    body: JSON.stringify(buildSpeechBody(request)),
  });
  operation.status = response.status;
  const generationId = response.headers.get("X-Generation-Id");
  if (generationId && /^[a-zA-Z0-9_-]{1,200}$/.test(generationId)) operation.generationId = generationId;
  if (!response.ok) {
    hold?.reportCost(0);
    const rawBody = await readBoundedResponse(response, HOSTED_SPEECH_LIMITS.metadataBytes, request.signal).then(
      (buffer) => buffer.toString("utf8"),
      () => undefined,
    );
    const body = rawBody === undefined ? undefined : speechErrorBody(rawBody, request.apiKey);
    const limit = rawBody === undefined ? null : readOpenRouterLimitError(response.status, response.headers, rawBody);
    try {
      checkSpeechStatus(response, body);
    } catch (error) {
      if (limit && error instanceof HostedSpeechError)
        throw new HostedSpeechError(error.kind, error.providerStatus, error.providerBody, { cause: limit });
      throw error;
    }
  }
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "audio/mpeg") {
    await response.body?.cancel();
    throw new HostedSpeechError("malformed_response");
  }
  const audio = await readBoundedResponse(response, request.maxBytes, request.signal);
  await validateSpeechAudio(audio, "audio/mpeg", request.maxBytes);
  operation.success = true;
  if (operation.generationId && !request.signal.aborted) {
    const costSignal = AbortSignal.any([request.signal, AbortSignal.timeout(HOSTED_SPEECH_LIMITS.costTimeoutMs)]);
    const costOperation: SpeechOperation = { operation: "cost", success: false };
    request.operations.push(costOperation);
    try {
      const costResponse = await fetch(
        `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(operation.generationId)}`,
        {
          headers: { Authorization: `Bearer ${request.apiKey}`, ...buildOpenRouterAttributionHeaders() },
          redirect: "error",
          signal: costSignal,
        },
      );
      costOperation.status = costResponse.status;
      if (!costResponse.ok) {
        await costResponse.body?.cancel();
        return audio;
      }
      const result = z
        .object({ data: speechUsageSchema.extend({ total_cost: z.number().nonnegative().nullable().optional() }) })
        .parse(await readSpeechJson(costResponse, costSignal, HOSTED_SPEECH_LIMITS.metadataBytes));
      operation.usage = speechUsageSchema.parse(result.data);
      if (result.data.total_cost != null) {
        costOperation.actualCost = result.data.total_cost;
        costOperation.success = true;
      }
    } catch {
      return audio;
    }
  }
  return audio;
}
