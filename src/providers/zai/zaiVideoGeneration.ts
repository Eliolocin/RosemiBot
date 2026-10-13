import type {
  ProviderNativeVideoGenerationRequest,
  ProviderNativeVideoGenerationResult,
  ProviderNativeVideoResolution,
} from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { pollForCompletion } from "@/utils/async/pollForCompletion";
import { safeDownload } from "@/utils/security/safeDownload";
import { PROVIDER_VIDEO_DOWNLOAD_MAX_MB } from "@/providers/utils/providerVideoDownload";

/** Z.ai video generation API endpoint */
const ZAI_VIDEO_GENERATIONS_URL = "https://api.z.ai/api/paas/v4/videos/generations";

/** Z.ai async video retrieval endpoint (uses task ID from generation response) */
const ZAI_ASYNC_RESULT_URL = "https://api.z.ai/api/paas/v4/async-result";

/** Polling interval for Z.ai video generation status checks (10 seconds) */
const POLL_INTERVAL_MS = 10_000;

/** Maximum poll attempts before timeout (~5 minutes at 10s intervals) */
const MAX_POLL_ATTEMPTS = 30;

function selectClosestSupportedDuration(
  requestedDuration: number | undefined,
  supportedDurations: readonly number[],
): number {
  const fallbackTarget = requestedDuration ?? supportedDurations[0];
  return supportedDurations.reduce((best, current) =>
    Math.abs(current - fallbackTarget) < Math.abs(best - fallbackTarget) ? current : best,
  );
}

function mapResolutionAndAspectToSize(
  resolution: ProviderNativeVideoResolution,
  aspectRatio: string | undefined,
): string {
  const targetAspectRatio = aspectRatio ?? "16:9";

  if (targetAspectRatio === "9:16") {
    if (resolution === "480p") return "480x854";
    if (resolution === "720p") return "720x1280";
    return "1080x1920";
  }

  if (targetAspectRatio === "1:1") {
    if (resolution === "480p") return "480x480";
    if (resolution === "720p") return "720x720";
    return "1024x1024";
  }

  if (targetAspectRatio === "21:9") {
    if (resolution === "480p") return "854x366";
    if (resolution === "720p") return "1280x548";
    return "2048x1080";
  }

  if (resolution === "480p") return "854x480";
  if (resolution === "720p") return "1280x720";
  return "1920x1080";
}

function normalizeZaiOptions(
  model: string,
  aspectRatio: string | undefined,
  requestedDuration: number | undefined,
  requestedResolution: ProviderNativeVideoResolution | undefined,
): { duration: number; resolution: ProviderNativeVideoResolution; size: string } {
  const normalizedModel = model.toLowerCase();

  if (normalizedModel.startsWith("cogvideox-3")) {
    const resolution = requestedResolution === "1080p" ? "1080p" : "720p";
    const duration = selectClosestSupportedDuration(requestedDuration, [5, 10]);
    return {
      duration,
      resolution,
      size: mapResolutionAndAspectToSize(resolution, aspectRatio),
    };
  }

  if (normalizedModel.startsWith("viduq1")) {
    return {
      duration: 5,
      resolution: "1080p",
      size: "1920x1080",
    };
  }

  if (normalizedModel.startsWith("vidu2")) {
    return {
      duration: 4,
      resolution: "720p",
      size: "1280x720",
    };
  }

  const resolution = requestedResolution === "1080p" ? "1080p" : requestedResolution === "480p" ? "480p" : "720p";
  const duration = selectClosestSupportedDuration(requestedDuration, [5, 10]);
  return {
    duration,
    resolution,
    size: mapResolutionAndAspectToSize(resolution, aspectRatio),
  };
}

/** Shape of the Z.ai video generation response */
interface ZaiVideoResponse {
  id?: string;
  request_id?: string;
  model?: string;
  task_status?: "PROCESSING" | "SUCCESS" | "FAIL";
  video_result?: Array<{
    url?: string;
    cover_image_url?: string;
  }>;
}

/**
 * Generate a video using Z.ai's CogVideoX-3 API.
 *
 * Flow:
 *   1. POST to /paas/v4/videos/generations with prompt and parameters
 *   2. Receive a task ID with PROCESSING status
 *   3. Poll /paas/v4/async-result/{taskId} until SUCCESS or FAIL
 *   4. Download the MP4 from the result URL
 *
 * @param request - Video generation request with apiKey, model, prompt, and optional parameters
 * @returns Raw MP4 video data as a Buffer, or null values on failure
 */
export async function generateZaiNativeVideo(
  request: ProviderNativeVideoGenerationRequest,
): Promise<ProviderNativeVideoGenerationResult> {
  const normalizedOptions = normalizeZaiOptions(
    request.model,
    request.aspectRatio,
    request.durationSeconds,
    request.resolution,
  );

  const body: Record<string, unknown> = {
    model: request.model,
    prompt: request.prompt,
    size: normalizedOptions.size,
    quality: "quality",
    with_audio: true,
    fps: 30,
    duration: normalizedOptions.duration,
  };

  if (request.referenceImages && request.referenceImages.length > 0) {
    const ref = request.referenceImages[0];
    body.image_url = [`data:${ref.mimeType};base64,${ref.data}`];
  }

  log.info(
    `Z.ai video generation: submitting request (model: ${request.model}, size: ${normalizedOptions.size}, durationSeconds: ${normalizedOptions.duration}, resolution: ${normalizedOptions.resolution}, hasReferenceImage: ${!!(request.referenceImages && request.referenceImages.length > 0)})`,
  );

  const response = await fetch(request.endpointUrl || ZAI_VIDEO_GENERATIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    log.error(
      `Z.ai video generation request failed (model: ${request.model}, status: ${response.status})`,
      new Error(errorBody),
    );
    throw new Error(`Z.ai video generation failed: ${response.status} ${response.statusText}`);
  }

  const submitResult = (await response.json()) as ZaiVideoResponse;
  const taskId = submitResult.id;

  if (!taskId) {
    log.error("Z.ai video generation returned no task ID", new Error("Missing task ID"));
    throw new Error("Z.ai video generation returned no task ID");
  }

  log.info(`Z.ai video generation: task submitted, polling for completion (taskId: ${taskId})`);

  const completedResult = await pollForCompletion<ZaiVideoResponse>({
    pollFn: async () => {
      const pollResponse = await fetch(`${ZAI_ASYNC_RESULT_URL}/${taskId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${request.apiKey}`,
        },
      });

      if (!pollResponse.ok) {
        await pollResponse.text(); // Drain body
        log.warn(`Z.ai video poll request failed (taskId: ${taskId}, status: ${pollResponse.status})`);
        return { done: false };
      }

      const pollResult = (await pollResponse.json()) as ZaiVideoResponse;

      if (pollResult.task_status === "SUCCESS") {
        return { done: true, result: pollResult };
      }
      if (pollResult.task_status === "FAIL") {
        return { done: true, error: "Z.ai video generation task failed" };
      }
      return { done: false };
    },
    intervalMs: POLL_INTERVAL_MS,
    maxAttempts: MAX_POLL_ATTEMPTS,
    logLabel: "ZaiVideoGeneration",
    abortSignal: request.abortSignal,
  });

  const videoUrl = completedResult.video_result?.[0]?.url;
  if (!videoUrl) {
    log.warn(`Z.ai video generation completed but returned no video URL (taskId: ${taskId})`);
    return { videoData: null, mimeType: null };
  }

  log.info(`Z.ai video generation: downloading video (taskId: ${taskId}, url: ${videoUrl.slice(0, 80)})`);
  const videoResponse = await safeDownload(videoUrl, {
    maxSizeMB: PROVIDER_VIDEO_DOWNLOAD_MAX_MB,
    timeoutMs: 30_000,
  });
  if (!videoResponse.success || !videoResponse.buffer) {
    log.error(
      `Failed to download Z.ai video (taskId: ${taskId})`,
      new Error(videoResponse.details ?? "download failed"),
    );
    return { videoData: null, mimeType: null };
  }

  return {
    videoData: videoResponse.buffer,
    mimeType: "video/mp4",
    durationSeconds: normalizedOptions.duration,
  };
}
