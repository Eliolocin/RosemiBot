import { z } from "zod";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import {
  checkSpeechStatus,
  HOSTED_SPEECH_LIMITS,
  HostedSpeechError,
  readSpeechJson,
  speechUsageSchema,
  validateSpeechAudio,
  type SpeechOperation,
} from "@/utils/speech/hostedSpeech";

export async function synthesizeOpenRouterSpeech(request: {
  model: string;
  apiKey: string;
  script: string;
  direction?: string;
  reference: Buffer;
  transcript: string | null;
  signal: AbortSignal;
  maxBytes: number;
  operations: SpeechOperation[];
}): Promise<Buffer> {
  if (!new Set(["fish-audio/s2.1-pro", "fish-audio/s2.1-pro-free:free"]).has(request.model)) {
    throw new HostedSpeechError("invalid_request");
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
    body: JSON.stringify({
      model: request.model,
      input: request.script,
      instructions: request.direction,
      response_format: "mp3",
      input_references: [
        { type: "input_audio", input_audio: { data: `data:audio/wav;base64,${request.reference.toString("base64")}` } },
        ...(request.transcript ? [{ type: "text", text: request.transcript }] : []),
      ],
    }),
  });
  operation.status = response.status;
  const generationId = response.headers.get("X-Generation-Id");
  if (generationId && /^[a-zA-Z0-9_-]{1,200}$/.test(generationId)) operation.generationId = generationId;
  if (!response.ok) {
    await response.body?.cancel();
    checkSpeechStatus(response);
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
