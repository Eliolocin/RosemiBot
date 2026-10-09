import { GoogleGenAI } from "@google/genai";
import type { GenerateVideosOperation, GenerateVideosParameters } from "@google/genai";
import type {
  ProviderNativeVideoGenerationRequest,
  ProviderNativeVideoGenerationResult,
  ProviderNativeVideoResolution,
} from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { pollForCompletion } from "@/utils/async/pollForCompletion";
import { safeDownload } from "@/utils/security/safeDownload";
import { PROVIDER_VIDEO_DOWNLOAD_MAX_MB } from "@/providers/utils/providerVideoDownload";

/** Polling interval for Google Veo operations (10 seconds, per Google docs) */
const POLL_INTERVAL_MS = 10_000;

/** Maximum poll attempts before timeout (~5 minutes at 10s intervals) */
const MAX_POLL_ATTEMPTS = 30;

/** Aspect ratios supported by Google Veo: "1:1" and others are rejected by the API */
const GOOGLE_SUPPORTED_ASPECT_RATIOS = new Set(["16:9", "9:16"]);

function selectClosestSupportedDuration(
  requestedDuration: number | undefined,
  supportedDurations: readonly number[],
  preferredDuration?: number,
): number {
  if (preferredDuration !== undefined && supportedDurations.includes(preferredDuration)) {
    return preferredDuration;
  }

  const fallbackTarget = requestedDuration ?? supportedDurations[0];
  return supportedDurations.reduce((best, current) =>
    Math.abs(current - fallbackTarget) < Math.abs(best - fallbackTarget) ? current : best,
  );
}

function normalizeGoogleResolution(requestedResolution: ProviderNativeVideoResolution | undefined): "720p" | "1080p" {
  return requestedResolution === "1080p" ? "1080p" : "720p";
}

/**
 * Generate a video using Google's Veo API via the @google/genai SDK.
 *
 * Flow:
 *   1. Call ai.models.generateVideos(): returns a long-running operation
 *   2. Poll every 10s via ai.operations.getVideosOperation() until done
 *   3. Download the video from the operation response
 *
 * Supports:
 *   - Text-to-video: prompt only
 *   - Image-to-video: prompt + single reference image as starting frame
 *   - Aspect ratio: "16:9" (default) or "9:16". unsupported values (e.g. "1:1") are silently ignored and Veo defaults to "16:9"
 *
 * @param request - Video generation request with apiKey, model, prompt, and optional parameters
 * @returns Raw MP4 video data as a Buffer, or null values on failure
 */
export async function generateGoogleNativeVideo(
  request: ProviderNativeVideoGenerationRequest,
): Promise<ProviderNativeVideoGenerationResult> {
  const ai = new GoogleGenAI({ apiKey: request.apiKey });
  const normalizedResolution = normalizeGoogleResolution(request.resolution);
  const requiresEightSecondOutput = normalizedResolution === "1080p" || !!request.referenceImages?.length;
  const normalizedDurationSeconds = selectClosestSupportedDuration(
    request.durationSeconds,
    [4, 6, 8],
    requiresEightSecondOutput ? 8 : undefined,
  );

  const generateParams: GenerateVideosParameters = {
    model: request.model,
    prompt: request.prompt,
  };

  // Add config (aspect ratio: only pass values Veo supports; unsupported values like "1:1" cause a 400)
  const config: NonNullable<GenerateVideosParameters["config"]> = {};
  if (request.aspectRatio && GOOGLE_SUPPORTED_ASPECT_RATIOS.has(request.aspectRatio)) {
    config.aspectRatio = request.aspectRatio;
  }
  config.durationSeconds = normalizedDurationSeconds;
  config.resolution = normalizedResolution;
  if (Object.keys(config).length > 0) {
    generateParams.config = config;
  }

  // Add reference image for image-to-video (first image becomes starting frame)
  if (request.referenceImages && request.referenceImages.length > 0) {
    const ref = request.referenceImages[0];
    generateParams.image = {
      imageBytes: ref.data,
      mimeType: ref.mimeType,
    };
  }

  log.info(
    `Google video generation: submitting request (model: ${request.model}, aspectRatio: ${request.aspectRatio ?? "16:9"}, durationSeconds: ${normalizedDurationSeconds}, resolution: ${normalizedResolution}, hasReferenceImage: ${!!(request.referenceImages && request.referenceImages.length > 0)})`,
  );

  let operation: GenerateVideosOperation = await ai.models.generateVideos(generateParams);

  const completedOp = await pollForCompletion<typeof operation>({
    pollFn: async () => {
      if (operation.done) {
        return { done: true, result: operation };
      }
      operation = await ai.operations.getVideosOperation({ operation });
      if (operation.done) {
        return { done: true, result: operation };
      }
      return { done: false };
    },
    intervalMs: POLL_INTERVAL_MS,
    maxAttempts: MAX_POLL_ATTEMPTS,
    logLabel: "GoogleVideoGeneration",
    abortSignal: request.abortSignal,
  });

  const generatedVideos = completedOp?.response?.generatedVideos;
  if (!generatedVideos || generatedVideos.length === 0) {
    log.warn(`Google video generation completed but returned no videos (model: ${request.model})`);
    return { videoData: null, mimeType: null };
  }

  const video = generatedVideos[0].video;

  // Download the video file
  //    The SDK provides video.uri for download, or video bytes may be inline
  if (video?.videoBytes) {
    const videoData = Buffer.from(video.videoBytes);
    log.info(
      `Google video generation: got inline video bytes (model: ${request.model}, sizeBytes: ${videoData.length})`,
    );
    return { videoData, mimeType: "video/mp4", durationSeconds: normalizedDurationSeconds };
  }

  // Fallback: download from the returned URI directly.
  // The SDK's files.download API is for file downloads to disk and requires a download path.
  if (video?.uri) {
    log.info(`Google video generation: downloading from URI (model: ${request.model}, uri: ${video.uri.slice(0, 80)})`);

    try {
      const downloadResponse = await safeDownload(video.uri, {
        maxSizeMB: PROVIDER_VIDEO_DOWNLOAD_MAX_MB,
        timeoutMs: 30_000,
        requestInit: {
          headers: { "x-goog-api-key": request.apiKey },
        },
      });

      if (!downloadResponse.success || !downloadResponse.buffer) {
        throw new Error(downloadResponse.details ?? "download failed");
      }

      return { videoData: downloadResponse.buffer, mimeType: "video/mp4", durationSeconds: normalizedDurationSeconds };
    } catch (downloadError) {
      log.error("Failed to download Google video", downloadError as Error, {
        errorType: "GoogleVideoDownloadError",
        metadata: { model: request.model },
      });
      return { videoData: null, mimeType: null };
    }
  }

  log.warn(`Google video generation: no video bytes or URI in response (model: ${request.model})`);
  return { videoData: null, mimeType: null };
}
