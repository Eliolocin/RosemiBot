/**
 * Vision analysis tool for non-vision chat models.
 * Delegates image analysis to a configured vision model via the same provider's API.
 * Only available when: (1) a vision model is configured AND (2) the active chat model cannot see images.
 */

import { escapeMarkdown } from "discord.js";
import { BaseTool } from "@/types/tool/interfaces";
import type { ToolContext, ToolResult, ToolParameterSchema } from "@/types/tool/interfaces";
import { log, ColorCode } from "@/utils/misc/logger";
import { sendToolProgressNotice } from "@/utils/discord/toolProgressNotice";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import {
  analyzeImageWithVisionModel,
  resolveVisionApiModelName,
  type VisionImage,
} from "@/utils/provider/visionCaption";
import { downloadDiscoveredImage, resolveMessageImageUrls } from "@/utils/image/imageExtractor";

export { resolveVisionApiModelName } from "@/utils/provider/visionCaption";

/** Discord message ID pattern (17-19 digit snowflake) */
const DISCORD_ID_PATTERN = /^\d{17,19}$/;

/** Default prompt sent to the vision model when no custom prompt is provided */
const DEFAULT_VISION_PROMPT =
  "Describe what you see in this image in detail. Include any text, objects, people, colors, and notable elements.";

/** Maximum total size of all images in bytes (default: 10 MiB) to avoid API rejections. */
const MAX_TOTAL_IMAGE_BYTES = MEDIA_LIMITS.MAX_MEDIA_SIZE_MB * 1024 * 1024;

/** Maximum wall-clock time for image extraction and vision inference (default: 60 seconds). */
const parsedVisionAnalysisTimeoutMs = Number.parseInt(process.env.VISION_ANALYSIS_TIMEOUT_MS ?? "", 10);
const VISION_ANALYSIS_TIMEOUT_MS =
  Number.isFinite(parsedVisionAnalysisTimeoutMs) && parsedVisionAnalysisTimeoutMs > 0
    ? parsedVisionAnalysisTimeoutMs
    : 60_000;

/**
 * Built-in tool that analyzes images using a dedicated vision model.
 * Allows non-vision chat models (e.g., Z.ai glm-5) to understand images
 * by routing the analysis through a vision-capable model (e.g., Z.ai glm-4.6v).
 */
export class AnalyzeImageTool extends BaseTool {
  name = "analyze_image";
  description =
    "Analyze images in a Discord message using AI vision. Use this only when the user explicitly asks about the image or when unseen visual details are necessary to answer correctly. Do not call it just because an image is present.";
  category = "utility" as const;
  requiresFollowUp = true;

  // Only expose to non-vision models during context building (system prompt tool list).
  // The full vision_llm check happens in isAvailableForContext() at execution time.
  requiredModelCapabilities = { sees_images: false as const };

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      media_id: {
        type: "string",
        description:
          "The media reference ID (e.g., media_1) from the system hint for the message containing the image(s) to analyze.",
      },
      prompt: {
        type: "string",
        description:
          "Optional question or instruction for the vision model (e.g., 'What text is in this image?' or 'Describe the mood of this photo'). Ask only for the specific visual detail needed. If omitted, a general description is returned.",
      },
    },
    required: ["media_id"],
  };

  /**
   * Basic provider check: available for all providers.
   * The real gating logic is in isAvailableForContext().
   */
  isAvailableFor(_provider: string): boolean {
    return true;
  }

  /**
   * Context-aware availability check.
   * Only expose this tool when:
   * - A vision model is configured (tomoriState.vision_llm exists)
   * - The active chat model does NOT support images (sees_images = false)
   */
  isAvailableForContext(_provider: string, context: ToolContext): boolean {
    const hasVisionModel = !!context.tomoriState?.vision_llm;
    const chatModelSeesImages = context.tomoriState?.llm?.sees_images ?? false;

    // Only available when vision model is set AND chat model can't see images
    return hasVisionModel && !chatModelSeesImages;
  }

  /**
   * Execute the image analysis.
   * 1. Validate parameters and context
   * 2. Extract images from the Discord message
   * 3. Route the images to the vision model, which owns its own credential resolution
   * 4. Return the analysis result
   */
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const rawMediaId = args.media_id as string;
    const messageId = MessageIdMap.isOpaqueKey(rawMediaId) ? context.messageIdMap?.resolve(rawMediaId) : rawMediaId;
    const prompt = (args.prompt as string) || DEFAULT_VISION_PROMPT;

    if (!rawMediaId || (!DISCORD_ID_PATTERN.test(rawMediaId) && !MessageIdMap.isOpaqueKey(rawMediaId))) {
      return {
        success: false,
        error: `Invalid media_id: "${rawMediaId}". Expected a media reference ID (for example media_1) or Discord message ID.`,
      };
    }

    if (!messageId || !DISCORD_ID_PATTERN.test(messageId)) {
      return {
        success: false,
        error: `Unknown media_id: "${rawMediaId}".`,
      };
    }

    const timeoutSignal = AbortSignal.timeout(VISION_ANALYSIS_TIMEOUT_MS);
    const analysisSignal = context.abortSignal ? AbortSignal.any([context.abortSignal, timeoutSignal]) : timeoutSignal;

    try {
      await sendToolProgressNotice(
        context,
        "image_analysis",
        {
          titleKey: "tools.vision.analyzing_title",
          descriptionKey: "tools.vision.analyzing_description",
          descriptionVars: {
            // The resolved call resolves its own model, but it cannot report which one before
            // the first request, so this names the cached row the user configured.
            model: escapeMarkdown(
              resolveVisionApiModelName(
                context.tomoriState.vision_llm?.llm_provider ?? "",
                context.tomoriState.vision_llm?.llm_codename ?? "",
              ),
            ),
          },
          footerKey: "tools.vision.analyzing_footer",
          color: ColorCode.INFO,
        },
        "AnalyzeImageTool",
      );

      const images = await this.extractImagesFromMessage(messageId, context, analysisSignal);

      // The tool accepts one image per call, so a multi-image message is described one at a
      // time and joined: the caller asked for a reading of the message, not of its first file.
      const readings: string[] = [];
      for (const image of images) {
        const result = await analyzeImageWithVisionModel({
          serverId: context.tomoriState.server_id,
          image,
          prompt,
          cachedVisionLlm: context.tomoriState.vision_llm,
          userId: context.internalUserId ?? null,
          abortSignal: analysisSignal,
          // This tool owns the deadline it advertises, so the shared default must not become a
          // second, shorter one that silently overrides VISION_ANALYSIS_TIMEOUT_MS.
          timeoutMs: VISION_ANALYSIS_TIMEOUT_MS,
        });

        if (!result.ok) {
          return {
            success: false,
            error: `Image analysis failed: ${describeVisionFailure(result.failure)}`,
          };
        }

        readings.push(result.text ?? "");
      }

      const analysisResult = readings.join("\n\n");
      log.info(`Vision analysis completed: ${images.length} image(s) analyzed`);

      return {
        success: true,
        data: analysisResult,
        message: analysisResult,
      };
    } catch (error) {
      const timedOut = timeoutSignal.aborted && !context.abortSignal?.aborted;
      const errorMessage = timedOut
        ? `Image analysis timed out after ${VISION_ANALYSIS_TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : String(error);
      log.error(`Vision analysis failed for message ${messageId}:`, error as Error);
      return {
        success: false,
        error: timedOut ? errorMessage : "Image analysis failed because the vision provider returned an error.",
      };
    }
  }

  /**
   * Extract images from a Discord message and convert to base64 format.
   *
   * Discovery is delegated to the shared {@link resolveMessageImageUrls} helper,
   * which scans attachments, embeds, stickers, custom emojis, Components V2 media,
   * and the direct reply target when needed. The download loop below stays local
   * because vision payloads enforce a cumulative byte budget and skip re-optimization.
   * @param context - Tool execution context with channel access
   * @param signal - Combined turn-cancellation and vision-analysis timeout signal
   * @returns Array of objects with mimeType and base64 data
   */
  private async extractImagesFromMessage(
    messageId: string,
    context: ToolContext,
    signal: AbortSignal,
  ): Promise<VisionImage[]> {
    // Discover images on the message, or on its direct reply target when the
    //    reply itself is text-only.
    const { imageUrls, sourceMessageId } = await resolveMessageImageUrls(messageId, context);

    log.info(`Found ${imageUrls.length} image(s) in message ${sourceMessageId} for vision analysis`);

    const inlineDataArray: VisionImage[] = [];
    let totalBytes = 0;

    for (const imageInfo of imageUrls) {
      try {
        const imageResponse = await downloadDiscoveredImage(imageInfo, {
          maxSizeMB: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB,
          timeoutMs: 15_000,
          externalSignal: signal,
        });
        if (!imageResponse.success || !imageResponse.buffer) {
          log.warn(`Failed to fetch image from ${imageInfo.source}: ${imageResponse.details ?? imageResponse.error}`);
          continue;
        }

        const imageBuffer = imageResponse.buffer;

        if (totalBytes + imageBuffer.byteLength > MAX_TOTAL_IMAGE_BYTES) {
          log.warn(`Skipping image from ${imageInfo.source}: would exceed ${MAX_TOTAL_IMAGE_BYTES} byte limit`);
          continue;
        }

        totalBytes += imageBuffer.byteLength;
        const base64Data = imageBuffer.toString("base64");

        inlineDataArray.push({
          mimeType: imageInfo.mimeType,
          data: base64Data,
        });

        log.info(`Fetched image from ${imageInfo.source} (${imageBuffer.byteLength} bytes)`);
      } catch (imgErr) {
        log.warn(`Failed to process image from ${imageInfo.source}:`, imgErr as Error);
      }
    }

    if (inlineDataArray.length === 0) {
      throw new Error(`Failed to process any images from message ${sourceMessageId}`);
    }

    return inlineDataArray;
  }
}

/** Turns a vision failure into the reason text this tool reports to the calling model. */
function describeVisionFailure(failure: { reason: string; detail?: string } | undefined): string {
  if (!failure) return "unknown error";

  switch (failure.reason) {
    case "credentials_unavailable":
      return "no usable credentials for the configured vision model";
    case "no_vision_model":
      return "No vision model configured. Use /model vision to set one.";
    case "unsupported_provider":
      return failure.detail ?? "the configured vision provider has no supported transport";
    case "empty_response":
      return "the vision model returned an empty response";
    default:
      return failure.detail ?? "the vision request failed";
  }
}
