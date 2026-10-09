/**
 * Provider-agnostic vision inspection: resolve a vision model, call it with an image, and
 * return its text.
 *
 * Two callers need the same thing from different angles. `AnalyzeImageTool` answers a chat
 * model's question about an image it cannot see; `/persona generate` asks a vision model to
 * describe an uploaded avatar so a non-vision primary model can write the persona. Both must
 * pair the credentials they send with the model codename they name, because the vision model
 * can be saved under a different provider than the active text model, each with its own
 * encrypted key.
 *
 * That pairing is the reason this module exists rather than each caller resolving for itself:
 * `resolveCapabilityCredentials` can land on a provider that differs from the cached
 * `tomoriState.vision_llm` row, so the two are reconciled here against
 * `getResolvedCapabilityModelId` before any request goes out.
 */

import { GoogleGenAI, type Part } from "@google/genai";
import { llmModelRepo } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import { getResolvedCapabilityModelId, resolveCapabilityCredentials } from "@/utils/provider/credentialResolver";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";
import { normalizeProviderName } from "@/utils/provider/providerInfoRegistry";
import { toDeepseekApiModelName } from "@/providers/deepseek/deepseekShared";
import { resolveVisionCaptionMaxOutputTokens } from "@/utils/provider/maxOutputTokens";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";
import {
  toZaiApiModelName,
  ZAI_CODING_CHAT_COMPLETIONS_URL,
  ZAI_GENERAL_CHAT_COMPLETIONS_URL,
} from "@/providers/zai/zaiShared";
import { createVertexClient, parseVertexCompositeKey } from "@/providers/vertex/vertexClient";
import { createVertexexpressClient } from "@/providers/vertexexpress/vertexexpressClient";
import type { LlmRow } from "@/types/db/schema";

/** An image ready for a provider payload, as base64 plus the MIME type that decodes it. */
export interface VisionImage {
  data: string;
  mimeType: string;
}

/**
 * Chat-completions endpoints for the OpenAI-compatible providers.
 *
 * A provider missing here has no compatible transport, so it is rejected instead of falling
 * back to an OpenAI URL that would receive a foreign bearer key.
 */
const PROVIDER_CHAT_COMPLETIONS_URLS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  zai: ZAI_GENERAL_CHAT_COMPLETIONS_URL,
  zaicoding: ZAI_CODING_CHAT_COMPLETIONS_URL,
  deepseek: "https://api.deepseek.com/chat/completions",
  nvidia: "https://integrate.api.nvidia.com/v1/chat/completions",
};

/** Google-family providers share the GenAI SDK and accept images as inline parts. */
const GOOGLE_SDK_PROVIDERS = new Set(["google", "vertex", "vertexexpress"]);

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

/**
 * Wall-clock ceiling for one caption call. A Discord interaction has no useful margin left by
 * the time a persona is being generated, so a stalled vision provider must not hold the flow.
 */
const parsedVisionCaptionTimeoutMs = Number.parseInt(process.env.VISION_CAPTION_TIMEOUT_MS ?? "", 10);
const VISION_CAPTION_TIMEOUT_MS =
  Number.isFinite(parsedVisionCaptionTimeoutMs) && parsedVisionCaptionTimeoutMs > 0
    ? parsedVisionCaptionTimeoutMs
    : 60_000;

/** Why a vision call could not produce text. Callers map these to their own user-facing copy. */
type VisionCallFailureReason =
  | "credentials_unavailable"
  | "no_vision_model"
  | "unsupported_provider"
  | "request_failed"
  | "empty_response";

export interface VisionCallResult {
  ok: boolean;
  text?: string;
  /** The provider that actually served the call, which is not always the cached one. */
  provider?: string;
  model?: string;
  failure?: { reason: VisionCallFailureReason; detail?: string };
}

/**
 * Resolves the vision model whose credentials were actually returned.
 *
 * The capability resolver reports a model id alongside the key, and the cached
 * `tomoriState.vision_llm` predates any personal BYOK override. Reloading on mismatch keeps
 * the transport (chosen from the credentials) and the codename (sent to the transport) from
 * describing two different models.
 */
async function resolveVisionModelForCredentials(
  creds: Awaited<ReturnType<typeof resolveCapabilityCredentials>>,
  cachedVisionLlm: LlmRow | null | undefined,
): Promise<LlmRow | null> {
  const resolvedModelId = getResolvedCapabilityModelId(creds, "vision");
  if (resolvedModelId && resolvedModelId !== cachedVisionLlm?.llm_id) {
    return await llmModelRepo.loadById(resolvedModelId);
  }
  return cachedVisionLlm ?? null;
}

/**
 * Resolves the backend model string for a provider.
 *
 * A custom endpoint's `llm_codename` is a local catalog value while the backend model string
 * lives on the endpoint row, so sending the catalog value is rejected as an unknown model.
 * Backends that ignore the field entirely (KoboldCpp and similar) keep the codename.
 */
export function resolveVisionApiModelName(
  provider: string,
  llmCodename: string,
  customEndpointModelName?: string | null,
): string {
  const normalized = normalizeProviderName(provider);

  if (normalized === "zai" || normalized === "zaicoding") {
    return toZaiApiModelName(llmCodename);
  }

  if (normalized === "deepseek") {
    return toDeepseekApiModelName(llmCodename);
  }

  return customEndpointModelName?.trim() || llmCodename;
}

/**
 * Describes images with a configured vision model and returns its text.
 *
 * @param prompt - What to ask about the image. The caller owns this text: a chat question and
 *                 a persona appearance caption want different things from the same pixels.
 * @param timeoutMs - Wall-clock ceiling for the call. Omit to use `VISION_CAPTION_TIMEOUT_MS`.
 *                    A caller that already enforces its own deadline passes it here instead of
 *                    layering a second, shorter one that would silently win.
 */
export async function analyzeImageWithVisionModel(input: {
  serverId: number;
  image: VisionImage;
  prompt: string;
  /** Cached vision row, used only when the resolved credentials name the same model. */
  cachedVisionLlm?: LlmRow | null;
  userId?: number | null;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}): Promise<VisionCallResult> {
  const timeoutMs =
    typeof input.timeoutMs === "number" && input.timeoutMs > 0 ? input.timeoutMs : VISION_CAPTION_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = input.abortSignal ? AbortSignal.any([input.abortSignal, timeoutSignal]) : timeoutSignal;

  let creds: Awaited<ReturnType<typeof resolveCapabilityCredentials>>;
  try {
    creds = await resolveCapabilityCredentials(input.serverId, "vision", { userId: input.userId ?? null });
  } catch (error) {
    return {
      ok: false,
      failure: {
        reason: "credentials_unavailable",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const visionLlm = await resolveVisionModelForCredentials(creds, input.cachedVisionLlm);
  if (!visionLlm) {
    return { ok: false, failure: { reason: "no_vision_model" } };
  }

  // The credential and the model row are paired by resolveVisionModelForCredentials, so the
  // provider chosen here and the codename sent to it always describe the same model.
  const provider = normalizeProviderName(visionLlm.llm_provider);
  const model = resolveVisionApiModelName(provider, visionLlm.llm_codename, creds.customEndpoint?.model_name);

  try {
    const text = await dispatchVisionRequest(
      provider,
      creds.provider,
      creds.apiKey,
      model,
      input.image,
      input.prompt,
      signal,
      creds,
    );
    if (!text.trim()) {
      return { ok: false, provider, model, failure: { reason: "empty_response" } };
    }
    return { ok: true, text, provider, model };
  } catch (error) {
    if (error instanceof UnsupportedVisionProviderError) {
      return { ok: false, provider, model, failure: { reason: "unsupported_provider", detail: error.message } };
    }
    log.error(`Vision call failed for ${provider}/${model}:`, error as Error);
    return {
      ok: false,
      provider,
      model,
      failure: {
        reason: "request_failed",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/** Raised when a provider has no vision transport, so the caller can name it to the user. */
class UnsupportedVisionProviderError extends Error {
  constructor(public provider: string) {
    super(`Provider "${provider}" has no vision transport.`);
    this.name = "UnsupportedVisionProviderError";
  }
}

async function dispatchVisionRequest(
  provider: string,
  rawProvider: string,
  apiKey: string,
  model: string,
  image: VisionImage,
  prompt: string,
  signal: AbortSignal,
  creds: Awaited<ReturnType<typeof resolveCapabilityCredentials>>,
): Promise<string> {
  if (GOOGLE_SDK_PROVIDERS.has(provider)) {
    return await callGoogleSdkVision(provider, apiKey, model, image, prompt, signal);
  }

  if (provider === "anthropic") {
    return await callAnthropicVision(apiKey, model, image, prompt, signal);
  }

  // The custom check needs the stored name, not the canonical one: a custom provider is keyed
  // by connection (`custom:17`), and canonicalizing it to `custom` first would lose the
  // connection the endpoint URL is looked up from.
  const endpointUrl = resolveChatCompletionsUrl(rawProvider, creds.customEndpoint?.endpoint_url ?? null);
  if (!endpointUrl) {
    throw new UnsupportedVisionProviderError(provider);
  }

  return await callOpenAiCompatibleVision(apiKey, model, endpointUrl, image, prompt, signal);
}

/**
 * Null when the provider has no compatible transport.
 *
 * @param provider - The stored provider name. A custom endpoint is `custom:<connectionId>`, so
 *                   it must not be canonicalized before it reaches this function.
 */
export function resolveChatCompletionsUrl(provider: string, customEndpointUrl?: string | null): string | null {
  const knownUrl = PROVIDER_CHAT_COMPLETIONS_URLS[provider.trim().toLowerCase()];
  if (knownUrl) return knownUrl;

  if (isCustomProvider(provider)) {
    const url = customEndpointUrl?.trim();
    if (!url) return null;
    return url.endsWith("/chat/completions") ? url : `${url.replace(/\/$/, "")}/chat/completions`;
  }

  return null;
}

async function callGoogleSdkVision(
  provider: string,
  apiKey: string,
  model: string,
  image: VisionImage,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const client = buildGoogleClient(provider, apiKey);

  const parts: Part[] = [{ text: prompt }, { inlineData: { data: image.data, mimeType: image.mimeType } }];

  const result = await client.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: { abortSignal: signal, maxOutputTokens: resolveVisionCaptionMaxOutputTokens() },
  });

  const text = result.text;
  if (!text) {
    throw new Error("Vision model returned an empty response.");
  }
  return text;
}

/** Builds the GenAI client a Google-family provider needs; each authenticates differently. */
function buildGoogleClient(provider: string, apiKey: string): GoogleGenAI {
  if (provider === "vertex") {
    return createVertexClient(parseVertexCompositeKey(apiKey));
  }
  if (provider === "vertexexpress") {
    return createVertexexpressClient(apiKey);
  }
  return new GoogleGenAI({ apiKey });
}

async function callAnthropicVision(
  apiKey: string,
  model: string,
  image: VisionImage,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetchUserRemoteUrl(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: resolveVisionCaptionMaxOutputTokens(),
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Anthropic vision returned ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
  const text = (data.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("");

  if (!text) {
    throw new Error("Anthropic vision returned an empty response. The model may not support image inputs.");
  }
  return text;
}

async function callOpenAiCompatibleVision(
  apiKey: string,
  model: string,
  endpointUrl: string,
  image: VisionImage,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetchUserRemoteUrl(endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
          ],
        },
      ],
      max_tokens: resolveVisionCaptionMaxOutputTokens(),
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Vision API returned ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = data.choices?.[0]?.message?.content;

  if (typeof content === "string" && content) {
    return content;
  }

  // Some compatible endpoints return content parts rather than a bare string.
  if (Array.isArray(content)) {
    const joined = content
      .filter(
        (part): part is { type?: string; text?: string } =>
          typeof part === "object" && part !== null && (part as { type?: string }).type === "text",
      )
      .map((part) => part.text ?? "")
      .join("");
    if (joined) return joined;
  }

  throw new Error("Vision API returned an empty response. The model may not support image inputs.");
}
