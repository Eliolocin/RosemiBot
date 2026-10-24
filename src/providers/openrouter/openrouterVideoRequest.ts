import type {
  ProviderNativeVideoGenerationRequest,
  ProviderNativeVideoResolution,
} from "@/types/provider/featureInterfaces";
import type { OpenRouterVideoModelCapabilities } from "@/utils/cache/openrouterVideoModelCache";

const OPENROUTER_ORIGIN = "https://openrouter.ai";

export type OpenRouterVideoCapabilityErrorCode = "first_frame_unsupported" | "last_frame_unsupported";

export class OpenRouterVideoCapabilityError extends Error {
  constructor(
    readonly code: OpenRouterVideoCapabilityErrorCode,
    readonly model: string,
  ) {
    super(
      code === "first_frame_unsupported"
        ? `OpenRouter video model ${model} does not support first-frame image-to-video generation`
        : `OpenRouter video model ${model} does not support last-frame control required for looping video`,
    );
    this.name = "OpenRouterVideoCapabilityError";
  }
}

export function isOpenRouterVideoCapabilityError(error: unknown): error is OpenRouterVideoCapabilityError {
  return error instanceof OpenRouterVideoCapabilityError;
}

export function resolveOpenRouterPollingUrl(rawPollingUrl: string): string {
  const pollingUrl = new URL(rawPollingUrl, OPENROUTER_ORIGIN);
  if (pollingUrl.protocol !== "https:" || pollingUrl.origin !== OPENROUTER_ORIGIN) {
    throw new Error(`OpenRouter video generation returned an unsafe polling URL: ${pollingUrl.origin}`);
  }
  return pollingUrl.href;
}

export interface NormalizedOpenRouterVideoOptions {
  duration: number;
  resolution: string;
  aspectRatio: string;
}

export function getDefaultOpenRouterVideoResolution(model: string): ProviderNativeVideoResolution {
  return model === "x-ai/grok-imagine-video-1.5-lite" ? "480p" : "720p";
}

function selectClosestSupportedDuration(requestedDuration: number | undefined, supportedDurations: readonly number[]) {
  const fallbackTarget = requestedDuration ?? 5;
  return supportedDurations.reduce((best, current) =>
    Math.abs(current - fallbackTarget) < Math.abs(best - fallbackTarget) ? current : best,
  );
}

function resolutionHeight(resolution: string): number {
  const normalized = resolution.trim().toLowerCase();
  if (normalized === "1k") return 1024;
  if (normalized === "2k") return 2048;
  if (normalized === "4k") return 4096;
  const match = normalized.match(/^(\d+)p$/);
  return match ? Number.parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
}

function selectClosestSupportedResolution(
  requestedResolution: ProviderNativeVideoResolution | undefined,
  supportedResolutions: readonly string[],
): string {
  const target = requestedResolution ?? "720p";
  if (supportedResolutions.includes(target)) {
    return target;
  }

  const targetHeight = resolutionHeight(target);
  return supportedResolutions.reduce((best, current) =>
    Math.abs(resolutionHeight(current) - targetHeight) < Math.abs(resolutionHeight(best) - targetHeight)
      ? current
      : best,
  );
}

function normalizeLegacyOpenRouterOptions(
  model: string,
  requestedDuration: number | undefined,
  requestedResolution: ProviderNativeVideoResolution | undefined,
  requestedAspectRatio: string | undefined,
): NormalizedOpenRouterVideoOptions {
  const normalizedModel = model.toLowerCase();

  if (normalizedModel.includes("google/veo")) {
    return {
      duration: selectClosestSupportedDuration(requestedDuration, [4, 6, 8]),
      resolution: requestedResolution === "1080p" ? "1080p" : "720p",
      aspectRatio: requestedAspectRatio === "9:16" ? "9:16" : "16:9",
    };
  }

  if (normalizedModel.includes("openai/sora")) {
    return {
      duration: selectClosestSupportedDuration(requestedDuration, [4, 8, 12, 16, 20]),
      resolution: requestedResolution === "1080p" ? "1080p" : "720p",
      aspectRatio: requestedAspectRatio === "9:16" ? "9:16" : "16:9",
    };
  }

  if (normalizedModel.includes("seedance")) {
    return {
      duration: Math.min(Math.max(requestedDuration ?? 5, 4), 12),
      resolution: requestedResolution ?? "720p",
      aspectRatio: requestedAspectRatio ?? "16:9",
    };
  }

  if (normalizedModel.includes("alibaba/wan")) {
    return {
      duration: selectClosestSupportedDuration(requestedDuration, [5, 10]),
      resolution: requestedResolution === "1080p" ? "1080p" : "720p",
      aspectRatio: requestedAspectRatio === "9:16" ? "9:16" : "16:9",
    };
  }

  return {
    duration: Math.min(Math.max(requestedDuration ?? 5, 1), 20),
    resolution: requestedResolution ?? "720p",
    aspectRatio: requestedAspectRatio ?? "16:9",
  };
}

export function normalizeOpenRouterVideoOptions(
  request: Pick<ProviderNativeVideoGenerationRequest, "model" | "durationSeconds" | "resolution" | "aspectRatio">,
  capabilities: OpenRouterVideoModelCapabilities | undefined,
): NormalizedOpenRouterVideoOptions {
  const requestedResolution = request.resolution ?? getDefaultOpenRouterVideoResolution(request.model);
  if (!capabilities) {
    return normalizeLegacyOpenRouterOptions(
      request.model,
      request.durationSeconds,
      requestedResolution,
      request.aspectRatio,
    );
  }

  const duration =
    capabilities.supportedDurations.length > 0
      ? selectClosestSupportedDuration(request.durationSeconds, capabilities.supportedDurations)
      : Math.min(Math.max(request.durationSeconds ?? 5, 1), 20);
  const resolution =
    capabilities.supportedResolutions.length > 0
      ? selectClosestSupportedResolution(requestedResolution, capabilities.supportedResolutions)
      : requestedResolution;
  const requestedAspectRatio = request.aspectRatio ?? "16:9";
  const aspectRatio = capabilities.supportedAspectRatios.includes(requestedAspectRatio)
    ? requestedAspectRatio
    : capabilities.supportedAspectRatios.includes("16:9")
      ? "16:9"
      : (capabilities.supportedAspectRatios[0] ?? requestedAspectRatio);

  return { duration, resolution, aspectRatio };
}

function buildImageReference(reference: NonNullable<ProviderNativeVideoGenerationRequest["referenceImages"]>[number]) {
  return {
    type: "image_url",
    image_url: {
      url: reference.url ?? `data:${reference.mimeType};base64,${reference.data}`,
    },
  };
}

export function buildOpenRouterVideoRequestBody(
  request: ProviderNativeVideoGenerationRequest,
  normalizedOptions: NormalizedOpenRouterVideoOptions,
  capabilities: OpenRouterVideoModelCapabilities | undefined,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
    generate_audio: request.generateAudio ?? false,
    duration: normalizedOptions.duration,
    resolution: normalizedOptions.resolution,
    aspect_ratio: normalizedOptions.aspectRatio,
  };

  if (!request.referenceImages?.length) {
    return body;
  }

  if (capabilities && !capabilities.supportedFrameImages.includes("first_frame")) {
    throw new OpenRouterVideoCapabilityError("first_frame_unsupported", request.model);
  }

  const firstReference = buildImageReference(request.referenceImages[0]);
  const frameImages: Array<Record<string, unknown>> = [{ ...firstReference, frame_type: "first_frame" }];

  if (request.loop) {
    if (capabilities && !capabilities.supportedFrameImages.includes("last_frame")) {
      throw new OpenRouterVideoCapabilityError("last_frame_unsupported", request.model);
    }
    frameImages.push({ ...firstReference, frame_type: "last_frame" });
  }

  body.frame_images = frameImages;
  return body;
}
