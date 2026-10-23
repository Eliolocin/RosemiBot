import { isOpenRouterGeminiModelCodename } from "@/utils/provider/openrouterModelCapabilities";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";
import { log, redactLogString } from "@/utils/misc/logger";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";
import { z } from "zod";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { readOpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import { fetchWithProviderRequest } from "@/utils/provider/providerRequestHook";

const OPENROUTER_ORIGIN = "https://openrouter.ai";
const OPENROUTER_CHAT_URL = `${OPENROUTER_ORIGIN}/api/v1/chat/completions`;
const OPENROUTER_IMAGES_URL = `${OPENROUTER_ORIGIN}/api/v1/images`;
export const OPENROUTER_IMAGE_RESPONSE_MAX_BYTES = 64 * 1024 * 1024;
const IMAGE_ERROR_RESPONSE_MAX_BYTES = 1024 * 1024;

interface OpenRouterImageReference {
  mimeType: string;
  data: string;
}

export interface OpenRouterImageGenerationRequest {
  apiKey: string;
  modelCodename: string;
  prompt: string;
  aspectRatio: string;
  referenceImages?: OpenRouterImageReference[];
  abortSignal?: AbortSignal;
}

export interface OpenRouterImageGenerationResult {
  imageData: string | null;
  mimeType: string | null;
  costUsd?: number;
}

const usageCostSchema = z.object({ cost: z.number().finite().nonnegative().nullish() }).nullish().catch(undefined);

export function usesChatCompletionsImageGeneration(modelCodename: string): boolean {
  return isOpenRouterGeminiModelCodename(modelCodename);
}

function buildRequestFailure(
  modelCodename: string,
  status: number,
  statusText: string,
  headers: Headers,
  body: string,
  apiKey: string,
): Error {
  const safeBody = redactLogString(apiKey ? body.replaceAll(apiKey, "[REDACTED]") : body);

  let parsedMessage = "";
  try {
    const parsed = z
      .object({
        error: z.union([z.string(), z.object({ message: z.string().optional() })]).optional(),
        message: z.string().optional(),
      })
      .safeParse(JSON.parse(safeBody));
    if (parsed.success) {
      const providerError = parsed.data.error;
      parsedMessage =
        (typeof providerError === "string" ? providerError : providerError?.message) || parsed.data.message || "";
    }
  } catch {}

  const statusLabel = `${status} ${statusText}`.trim();
  const friendlyMessage = parsedMessage || statusLabel;
  const message = `OpenRouter API request failed (${statusLabel}) for model "${modelCodename}": ${friendlyMessage}`;
  return new Error(redactLogString(apiKey ? message.replaceAll(apiKey, "[REDACTED]") : message), {
    cause: readOpenRouterLimitError(status, headers, body) ?? undefined,
  });
}

async function resolveImageUrl(imageUrl: string, abortSignal?: AbortSignal): Promise<OpenRouterImageGenerationResult> {
  const dataUrlMatches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUrlMatches) {
    return { imageData: dataUrlMatches[2], mimeType: dataUrlMatches[1] };
  }

  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    const imageResponse = await safeDownload(imageUrl, {
      maxSizeMB: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB,
      timeoutMs: 15_000,
      ...(abortSignal ? { externalSignal: abortSignal } : {}),
    });
    if (imageResponse.success && imageResponse.buffer) {
      return {
        imageData: imageResponse.buffer.toString("base64"),
        mimeType: imageResponse.contentType?.split(";")[0] || null,
      };
    }
  }

  return { imageData: null, mimeType: null };
}

async function generateViaChatCompletions(
  request: OpenRouterImageGenerationRequest,
): Promise<OpenRouterImageGenerationResult> {
  const { apiKey, modelCodename, prompt, aspectRatio, referenceImages, abortSignal } = request;

  const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: "text", text: prompt },
  ];
  for (const image of referenceImages ?? []) {
    contentParts.push({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } });
  }

  const response = await fetchWithProviderRequest(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelCodename,
      messages: [{ role: "user", content: contentParts }],
      modalities: ["image", "text"],
      image_config: {
        aspect_ratio: aspectRatio,
        ...(modelCodename === "google/gemini-nano-banana-2.1" ? { image_size: "1K" } : {}),
      },
    }),
    ...(abortSignal ? { signal: abortSignal } : {}),
  });

  if (!response.ok) {
    const errorText = (await readBoundedResponse(response, IMAGE_ERROR_RESPONSE_MAX_BYTES)).toString("utf8");
    const failure = buildRequestFailure(
      modelCodename,
      response.status,
      response.statusText,
      response.headers,
      errorText,
      apiKey,
    );
    log.warn("OpenRouter chat image request failed", failure, {
      metadata: { model: modelCodename, status: response.status },
    });
    throw failure;
  }

  const result = z
    .object({
      choices: z
        .array(
          z.object({
            message: z
              .object({
                images: z
                  .array(
                    z.object({
                      image_url: z.object({ url: z.string() }).optional(),
                      imageUrl: z.object({ url: z.string() }).optional(),
                    }),
                  )
                  .optional(),
                content: z.union([z.string(), z.array(z.unknown())]).nullish(),
              })
              .optional(),
          }),
        )
        .optional(),
      usage: usageCostSchema,
    })
    .parse(JSON.parse((await readBoundedResponse(response, OPENROUTER_IMAGE_RESPONSE_MAX_BYTES)).toString("utf8")));
  const message = result.choices?.[0]?.message;
  const costUsd = result.usage?.cost ?? undefined;

  let imageUrl: string | null = null;
  if (message?.images?.[0]) {
    const firstImage = message.images[0];
    // OpenRouter returns either snake_case (image_url) or camelCase (imageUrl) here.
    imageUrl = firstImage?.image_url?.url || firstImage?.imageUrl?.url || null;
  } else if (Array.isArray(message?.content)) {
    const firstImagePart = message.content.find(
      (part: unknown) =>
        typeof part === "object" && part !== null && "type" in part && (part as { type?: string }).type === "image_url",
    ) as { image_url?: { url?: string } } | undefined;
    imageUrl = firstImagePart?.image_url?.url || null;
  }

  return imageUrl
    ? { ...(await resolveImageUrl(imageUrl, abortSignal)), costUsd }
    : { imageData: null, mimeType: null, costUsd };
}

async function generateViaImagesEndpoint(
  request: OpenRouterImageGenerationRequest,
): Promise<OpenRouterImageGenerationResult> {
  const { apiKey, modelCodename, prompt, aspectRatio, referenceImages, abortSignal } = request;

  const body: Record<string, unknown> = {
    model: modelCodename,
    prompt,
    aspect_ratio: aspectRatio,
  };
  if (referenceImages && referenceImages.length > 0) {
    body.input_references = referenceImages.map((image) => ({
      type: "image_url",
      image_url: { url: `data:${image.mimeType};base64,${image.data}` },
    }));
  }

  const response = await fetchWithProviderRequest(OPENROUTER_IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...buildOpenRouterAttributionHeaders(),
    },
    body: JSON.stringify(body),
    ...(abortSignal ? { signal: abortSignal } : {}),
  });

  if (!response.ok) {
    const errorText = (await readBoundedResponse(response, IMAGE_ERROR_RESPONSE_MAX_BYTES)).toString("utf8");
    const failure = buildRequestFailure(
      modelCodename,
      response.status,
      response.statusText,
      response.headers,
      errorText,
      apiKey,
    );
    log.warn("OpenRouter image request failed", failure, {
      metadata: { model: modelCodename, status: response.status },
    });
    throw failure;
  }

  const result = z
    .object({
      data: z.array(z.object({ b64_json: z.string().optional(), media_type: z.string().nullish() })).optional(),
      usage: usageCostSchema,
    })
    .parse(JSON.parse((await readBoundedResponse(response, OPENROUTER_IMAGE_RESPONSE_MAX_BYTES)).toString("utf8")));
  const first = result?.data?.[0];
  const base64 = typeof first?.b64_json === "string" ? first.b64_json : null;
  const costUsd = result.usage?.cost ?? undefined;
  if (!base64) {
    return { imageData: null, mimeType: null, costUsd };
  }

  // media_type is omitted only when the format cannot be determined; callers default to PNG.
  return { imageData: base64, mimeType: typeof first?.media_type === "string" ? first.media_type : null, costUsd };
}

export async function generateOpenRouterImage(
  request: OpenRouterImageGenerationRequest,
): Promise<OpenRouterImageGenerationResult> {
  const viaChat = usesChatCompletionsImageGeneration(request.modelCodename);
  log.info(
    `[OpenRouter] Sending image request to model "${request.modelCodename}" via ${viaChat ? "chat/completions" : "images"} (aspect ratio: ${request.aspectRatio}, refs: ${request.referenceImages?.length ?? 0})`,
  );

  return viaChat ? await generateViaChatCompletions(request) : await generateViaImagesEndpoint(request);
}
