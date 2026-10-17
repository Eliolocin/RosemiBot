import { z } from "zod";
import { createVertexClient, parseVertexCompositeKey } from "@/providers/vertex/vertexClient";
import {
  checkSpeechStatus,
  decodeSpeechAudio,
  HostedSpeechError,
  readSpeechJson,
  speechUsageSchema,
  validateSpeechAudio,
  type SpeechOperation,
} from "@/utils/speech/hostedSpeech";

export interface GoogleSpeechTransport {
  transport: "google" | "vertex";
  project: string;
  location: string;
  create(
    prompt: string,
    model: string,
    signal: AbortSignal,
    operations: SpeechOperation[],
  ): Promise<{ voiceId: string; expiresAt: Date | null }>;
  synthesize(
    voiceId: string,
    script: string,
    direction: string | undefined,
    model: string,
    signal: AbortSignal,
    maxBytes: number,
    operations: SpeechOperation[],
  ): Promise<Buffer>;
  delete(voiceId: string, signal: AbortSignal, operations: SpeechOperation[]): Promise<void>;
}

const voiceIdSchema = z.string().regex(/^voice_[A-Za-z0-9_-]+$/);
const googleSpeechModels = new Set(["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]);

export class GoogleVoiceCreationError extends HostedSpeechError {
  constructor(readonly voiceId: string) {
    super("malformed_response");
  }
}

export function createGoogleSpeechTransport(provider: "google" | "vertex", apiKey: string): GoogleSpeechTransport {
  const config = provider === "vertex" ? parseVertexCompositeKey(apiKey) : null;
  if (config && (!/^[a-zA-Z0-9-]+$/.test(config.projectId) || config.location !== "global"))
    throw new HostedSpeechError("invalid_request");
  const vertexClient = config ? createVertexClient(config) : null;
  const base = config
    ? `https://aiplatform.googleapis.com/v1beta1/projects/${config.projectId}/locations/${config.location}`
    : "https://generativelanguage.googleapis.com/v1beta";

  async function call(
    path: string,
    method: "POST" | "DELETE" | "GET",
    body: unknown,
    signal: AbortSignal,
    operations: SpeechOperation[],
    operation: SpeechOperation["operation"],
    maxBytes?: number,
  ): Promise<unknown> {
    signal.throwIfAborted();
    const headers = vertexClient
      ? await new Promise<Headers>((resolve, reject) => {
          const abort = () => {
            signal.removeEventListener("abort", abort);
            reject(signal.reason);
          };
          signal.addEventListener("abort", abort, { once: true });
          void vertexClient
            .getAuthHeaders()
            .then(resolve, reject)
            .finally(() => signal.removeEventListener("abort", abort));
        })
      : new Headers({ "x-goog-api-key": apiKey });
    signal.throwIfAborted();
    headers.set("Content-Type", "application/json");
    const record: SpeechOperation = { operation, success: false };
    operations.push(record);
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      redirect: "error",
      signal,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    record.status = response.status;
    if (operation === "lookup" && response.status === 404) {
      await response.body?.cancel();
      record.success = true;
      return null;
    }
    if (method === "DELETE" && (response.ok || response.status === 404)) {
      await response.body?.cancel();
      record.success = true;
      return null;
    }
    if (operation === "synthesize" && (response.status === 404 || response.status === 410)) {
      await response.body?.cancel();
      throw new HostedSpeechError("missing_voice");
    }
    let json: unknown;
    try {
      json = await readSpeechJson(response, signal, maxBytes);
    } catch (error) {
      checkSpeechStatus(response);
      throw error;
    }
    const usage = z
      .object({ usage: speechUsageSchema.optional(), usageMetadata: speechUsageSchema.optional() })
      .safeParse(json);
    if (usage.success) record.usage = usage.data.usage ?? usage.data.usageMetadata;
    checkSpeechStatus(response);
    if (operation === "lookup") record.success = true;
    return json;
  }

  return {
    transport: provider,
    project: config?.projectId ?? "",
    location: config?.location ?? "",
    async create(prompt, model, signal, operations) {
      if (!googleSpeechModels.has(model)) throw new HostedSpeechError("invalid_request");
      const json = await call(
        "/voices",
        "POST",
        {
          store: true,
          voice: {
            ...(config ? {} : { model }),
            type: config ? "VOICE_TYPE_PROMPTED" : "prompted",
            prompted: { input: prompt },
          },
        },
        signal,
        operations,
        "create",
      );
      const response = z.object({ id: voiceIdSchema, expire_time: z.unknown().optional() }).parse(json);
      const expiry = z.iso.datetime({ offset: true }).optional().safeParse(response.expire_time);
      if (!expiry.success) throw new GoogleVoiceCreationError(response.id);
      const operation = operations.at(-1);
      if (operation) operation.success = true;
      return { voiceId: response.id, expiresAt: expiry.data ? new Date(expiry.data) : null };
    },
    async synthesize(voiceId, script, direction, model, signal, maxBytes, operations) {
      voiceIdSchema.parse(voiceId);
      if (!googleSpeechModels.has(model)) throw new HostedSpeechError("invalid_request");
      const path = config ? `/publishers/google/models/${model}:generateContent` : "/interactions";
      const body = config
        ? {
            contents: [
              {
                role: "user",
                parts: [{ text: script, ...(direction ? { speechMetadata: { style: direction } } : {}) }],
              },
            ],
            generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { voice: voiceId } } },
          }
        : {
            model,
            input: [
              {
                type: "user_input",
                content: [
                  {
                    type: "text",
                    text: script,
                    ...(direction ? { annotations: [{ type: "speech_metadata", style: direction }] } : {}),
                  },
                ],
              },
            ],
            response_format: { type: "audio" },
            generation_config: { speech_config: [{ voice: voiceId }] },
            store: false,
          };
      let json: unknown;
      try {
        json = await call(path, "POST", body, signal, operations, "synthesize", maxBytes);
      } catch (error) {
        if (!(error instanceof HostedSpeechError) || error.kind !== "missing_voice") throw error;
        const voice = await call(`/voices/${encodeURIComponent(voiceId)}`, "GET", null, signal, operations, "lookup");
        throw new HostedSpeechError(voice === null ? "missing_voice" : "provider_error");
      }
      let data: string;
      let mime: string;
      if (config) {
        const response = z
          .object({
            candidates: z
              .array(
                z.object({
                  finishReason: z.literal("STOP"),
                  content: z.object({
                    parts: z
                      .array(z.object({ inlineData: z.object({ mimeType: z.literal("audio/wav"), data: z.string() }) }))
                      .length(1),
                  }),
                }),
              )
              .length(1),
          })
          .parse(json);
        const audio = response.candidates[0].content.parts[0].inlineData;
        data = audio.data;
        mime = audio.mimeType;
      } else {
        const response = z
          .object({
            status: z.literal("completed"),
            steps: z
              .array(
                z.object({
                  type: z.literal("model_output"),
                  content: z
                    .array(z.object({ type: z.literal("audio"), mime_type: z.literal("audio/wav"), data: z.string() }))
                    .length(1),
                }),
              )
              .length(1),
          })
          .parse(json);
        const audio = response.steps[0].content[0];
        data = audio.data;
        mime = audio.mime_type;
      }
      const audio = decodeSpeechAudio(data, maxBytes);
      await validateSpeechAudio(audio, mime, maxBytes);
      const operation = operations.at(-1);
      if (operation) operation.success = true;
      return audio;
    },
    async delete(voiceId, signal, operations) {
      voiceIdSchema.parse(voiceId);
      await call(`/voices/${encodeURIComponent(voiceId)}`, "DELETE", null, signal, operations, "delete");
    },
  };
}
