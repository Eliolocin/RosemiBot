/**
 * Gemini Image Segmentation Service
 *
 * Uses Google Gemini's native image segmentation capability to generate
 * pixel-precise masks from natural language descriptions. These masks
 * are used by the NovelAI inpainting pipeline to selectively redraw
 * regions of an existing image.
 *
 * Pipeline:
 * 1. Send image + text target description to Gemini
 * 2. Gemini returns JSON with bounding boxes (normalized 0-1000) and cropped PNG masks
 * 3. Each mask is resized to its bounding box pixel dimensions
 * 4. All masks are composited onto a full-canvas black image (white = redraw area)
 * 5. Final mask is binarized at threshold 127 for clean edges
 */

import sharp from "sharp";
import { GoogleGenAI, HarmBlockThreshold, HarmCategory, type SafetySetting } from "@google/genai";
import { log } from "../misc/logger";
import { omitGeminiSampling } from "@/utils/provider/samplingControl";
import { buildGoogleThinkingConfig } from "@/utils/provider/thinkingControl";

/** Whether to enable debug mode: when true, returns the raw mask buffer for inspection */
const NAI_INPAINT_DEBUG = (process.env.NAI_INPAINT_DEBUG || "false").toLowerCase() === "true";

/** Gemini model used for image segmentation (configurable for future model upgrades) */
const NAI_SEGMENTATION_MODEL = process.env.NAI_SEGMENTATION_MODEL || "gemini-2.5-flash";

/** Timeout in ms for the Gemini segmentation API call (default: 90s) */
const NAI_SEGMENTATION_TIMEOUT_MS = Number.parseInt(process.env.NAI_SEGMENTATION_TIMEOUT_MS || "90000", 10);

/**
 * Padding added to each side of the bounding box as a fraction of the box dimension.
 * 0.15 = 15% padding on each side, so helps capture regions that extend beyond
 * Gemini's detected bounding box (e.g. wispy hair strands, flowing fabric).
 * Clamped to image bounds after expansion.
 */
const NAI_INPAINT_PADDING = 0.15;

/**
 * OFF because anime/artistic images frequently trigger false positives on default thresholds,
 * causing Gemini to silently hang or return empty responses instead of masks.
 */
const SEGMENTATION_SAFETY_SETTINGS: SafetySetting[] = [
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.OFF,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.OFF,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.OFF,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.OFF,
  },
];

/**
 * A single segmentation result from Gemini.
 * Coordinates are normalized to 0-1000 range.
 */
interface GeminiSegment {
  /** Bounding box as [y0, x0, y1, x1], normalized 0-1000 */
  box_2d: [number, number, number, number];
  /** Base64-encoded PNG mask cropped to the bounding box (white = target region) */
  mask: string;
  /** Human-readable label for the detected region */
  label: string;
}

/**
 * Result of the full segmentation + mask processing pipeline.
 */
export interface SegmentationResult {
  /** Final full-canvas B/W mask as base64 PNG: white = redraw, black = preserve */
  maskBase64: string;
  /** Number of segments detected and merged */
  segmentCount: number;
  /** Labels from all detected segments */
  labels: string[];
  /** Source image width in pixels */
  imageWidth: number;
  /** Source image height in pixels */
  imageHeight: number;
  /** Raw mask buffer (only populated when NAI_INPAINT_DEBUG is true) */
  debugMaskBuffer?: Buffer;
  /** Original image with bounding box overlays (only populated when NAI_INPAINT_DEBUG is true) */
  debugOverlayBuffer?: Buffer;
}

/**
 * Call Gemini's image segmentation API to identify and mask regions matching
 * a natural language description.
 *
 * @param imageBase64 - Base64-encoded source image (PNG or JPEG)
 * @param imageMimeType - MIME type of the source image
 * @param editTarget - Natural language description of what to segment (e.g. "the cat", "her hair")
 * @param apiKey - Decrypted Google API key
 */
async function callGeminiSegmentation(
  imageBase64: string,
  imageMimeType: string,
  editTarget: string,
  apiKey: string,
): Promise<GeminiSegment[]> {
  const genAI = new GoogleGenAI({ apiKey });

  log.info(
    `[Segmentation] Sending request to Gemini model "${NAI_SEGMENTATION_MODEL}" (timeout: ${NAI_SEGMENTATION_TIMEOUT_MS}ms, image: ${Math.round((imageBase64.length * 0.75) / 1024)}KB, type: ${imageMimeType})`,
  );

  // Wrap the API call in a timeout because Gemini can hang indefinitely without one
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Gemini segmentation timed out after ${NAI_SEGMENTATION_TIMEOUT_MS}ms`)),
      NAI_SEGMENTATION_TIMEOUT_MS,
    ),
  );

  // Build the request following Google's spatial understanding reference:
  // Simple, direct segmentation prompt: no extra reasoning instructions
  // Text prompt BEFORE image (Gemini processes instructions better when text leads)
  // Temperature 0.5 (prevents model from looping on repeated tokens)
  // Safety settings disabled (prevents silent blocks on anime/artistic content)
  // Thinking disabled (adds latency without quality benefit for structured extraction)
  const apiCallPromise = genAI.models.generateContent({
    model: NAI_SEGMENTATION_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Give the segmentation masks for "${editTarget}" in this image. Output a JSON list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d", the segmentation mask in key "mask", and the text label in the key "label". Use descriptive labels.`,
          },
          {
            inlineData: {
              mimeType: imageMimeType,
              data: imageBase64,
            },
          },
        ],
      },
    ],
    config: omitGeminiSampling(NAI_SEGMENTATION_MODEL, {
      temperature: 0.5,
      safetySettings: SEGMENTATION_SAFETY_SETTINGS,
      thinkingConfig: buildGoogleThinkingConfig(NAI_SEGMENTATION_MODEL, "none"),
    }),
  });

  log.info("[Segmentation] Request sent, awaiting Gemini response...");

  const response = await Promise.race([apiCallPromise, timeoutPromise]);

  log.info(`[Segmentation] Gemini responded (raw response length: ${response.text?.length ?? 0} chars)`);

  const rawText = response.text?.trim() || "";

  if (!rawText) {
    throw new Error("Gemini segmentation returned empty response");
  }

  // Strip potential markdown fences that Gemini sometimes wraps around JSON output
  const responseText = rawText
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();

  let segments: GeminiSegment[];
  try {
    const parsed = JSON.parse(responseText);
    segments = Array.isArray(parsed) ? parsed : [parsed];
  } catch (parseErr) {
    log.error(`Failed to parse Gemini segmentation response: ${responseText.substring(0, 200)}`);
    throw new Error(`Failed to parse segmentation response: ${(parseErr as Error).message}`);
  }

  const validSegments = segments.filter((seg) => {
    if (!seg.box_2d || !Array.isArray(seg.box_2d) || seg.box_2d.length !== 4) {
      log.warn(`Skipping segment with invalid box_2d: ${JSON.stringify(seg.box_2d)}`);
      return false;
    }
    if (!seg.mask) {
      log.warn(`Skipping segment with missing mask (label: ${seg.label})`);
      return false;
    }
    return true;
  });

  if (validSegments.length === 0) {
    throw new Error(
      `Gemini found no valid segments for "${editTarget}". The model may not have detected the target in the image.`,
    );
  }

  log.info(
    `Gemini segmentation found ${validSegments.length} segment(s) for "${editTarget}": ${validSegments.map((s) => s.label).join(", ")}`,
  );

  return validSegments;
}

/**
 * Build an inpainting mask from Gemini's bounding boxes using elliptical shapes,
 * quantized to 1/8th resolution to match NAI's latent space grid.
 *
 * Key design decisions based on open-source NAI implementations
 * (ComfyUI_NAIDGenerator, novelai-api, novelai-python):
 *
 * - **Elliptical shape**, so Organic curves blend better than rectangles in diffusion.
 * - **1/8th resolution quantization**, because NAI's diffusion model operates in latent space
 *    at 1/8th pixel resolution. Masks must be pre-quantized to this grid using
 *    nearest-neighbor interpolation (down to `ceil(w/64)*8` × `ceil(h/64)*8`, then
 *    back up to full size). Without this, full-resolution mask edges create intermediate
 *    grey values when the model internally downsamples, producing a visible halo.
 * - **RGBA format**, because NAI expects RGBA PNG where white pixels have alpha=255 (redraw)
 *    and black pixels have alpha=0 (preserve). The alpha channel is the actual mask
 *    signal, matching the `naimask_to_base64()` encoding from ComfyUI_NAIDGenerator.
 *
 * @param segments - Array of Gemini segmentation results (only box_2d is used)
 * @param originalWidth - Width of the source image in pixels
 * @param originalHeight - Height of the source image in pixels
 * @param isV4 - Whether the target model is V4+ (affects quantization grid)
 */
async function buildBoundingBoxMask(
  segments: GeminiSegment[],
  originalWidth: number,
  originalHeight: number,
  isV4: boolean,
): Promise<Buffer> {
  const svgEllipses: string[] = [];

  for (const segment of segments) {
    const [y0Norm, x0Norm, y1Norm, x1Norm] = segment.box_2d;

    let x0 = Math.round((x0Norm / 1000) * originalWidth);
    let y0 = Math.round((y0Norm / 1000) * originalHeight);
    let x1 = Math.round((x1Norm / 1000) * originalWidth);
    let y1 = Math.round((y1Norm / 1000) * originalHeight);

    // Apply padding: expand each side by a fraction of the box dimension
    // to capture content that extends beyond Gemini's detected bounding box
    const padX = Math.round((x1 - x0) * NAI_INPAINT_PADDING);
    const padY = Math.round((y1 - y0) * NAI_INPAINT_PADDING);
    x0 = Math.max(0, x0 - padX);
    y0 = Math.max(0, y0 - padY);
    x1 = Math.min(originalWidth, x1 + padX);
    y1 = Math.min(originalHeight, y1 + padY);

    const bboxWidth = Math.max(x1 - x0, 1);
    const bboxHeight = Math.max(y1 - y0, 1);

    const cx = x0 + bboxWidth / 2;
    const cy = y0 + bboxHeight / 2;
    const rx = bboxWidth / 2;
    const ry = bboxHeight / 2;

    log.info(
      `Mask region "${segment.label}": bbox [${x0},${y0}]-[${x1},${y1}] (${bboxWidth}x${bboxHeight}px, pad=${NAI_INPAINT_PADDING}) → ellipse cx=${Math.round(cx)},cy=${Math.round(cy)},rx=${Math.round(rx)},ry=${Math.round(ry)}`,
    );

    svgEllipses.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="white"/>`);
  }

  if (svgEllipses.length === 0) {
    throw new Error("No valid bounding boxes to build mask from");
  }

  const svgMask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${originalWidth}" height="${originalHeight}">` +
      `<rect width="100%" height="100%" fill="black"/>` +
      svgEllipses.join("") +
      `</svg>`,
  );

  let maskBuffer = await sharp(svgMask).resize(originalWidth, originalHeight).greyscale().toBuffer();

  // Quantize the mask to NAI's latent space grid (1/8th resolution). The mask gets
  // downsampled internally regardless, but a full-res mask with smooth edges creates
  // intermediate grey values at the boundaries during that downsampling, which the model
  // reads as partial redraw (= halo). Pre-quantizing with nearest-neighbor keeps every mask
  // pixel aligned to a latent-space cell, matching ComfyUI_NAIDGenerator's resize_to_naimask().
  const latentW = Math.ceil(originalWidth / 64) * 8;
  const latentH = Math.ceil(originalHeight / 64) * 8;

  maskBuffer = await sharp(maskBuffer).resize(latentW, latentH, { kernel: sharp.kernel.nearest }).toBuffer();

  // For V4+ models: upscale back to full resolution (still nearest-neighbor)
  // This creates the characteristic "blocky" mask that V4 models expect
  if (isV4) {
    maskBuffer = await sharp(maskBuffer)
      .resize(latentW * 8, latentH * 8, { kernel: sharp.kernel.nearest })
      .toBuffer();
  }

  // NAI expects RGBA PNG where:
  //   - White pixels (redraw):   R=255, G=255, B=255, A=255
  //   - Black pixels (preserve): R=0,   G=0,   B=0,   A=0
  // The alpha channel acts as the actual mask signal.
  // (Matches naimask_to_base64() from ComfyUI_NAIDGenerator)
  const { data, info } = await sharp(maskBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
    const isWhite = data[i] > 127 || data[i + 1] > 127 || data[i + 2] > 127;
    if (isWhite) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    } else {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }

  const finalMask = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();

  log.info(
    `Ellipse mask complete: ${info.width}x${info.height}px (latent grid: ${latentW}x${latentH}), ${svgEllipses.length} region(s), isV4=${isV4}, padding=${NAI_INPAINT_PADDING}`,
  );

  return finalMask;
}

/**
 * Color palette for bounding box overlays: matches Google's spatial understanding example.
 */
const BBOX_COLORS = [
  "#FF0000",
  "#00FF00",
  "#0000FF",
  "#FFFF00",
  "#FF8800",
  "#FF69B4",
  "#800080",
  "#00FFFF",
  "#FF00FF",
  "#00FF88",
];

/**
 * Generate a debug overlay image: the original image with colored bounding boxes,
 * padded ellipses, and labels drawn on top for each detected segment.
 *
 * Shows both the raw Gemini bounding box (dashed rectangle) and the actual
 * padded ellipse mask shape (semi-transparent fill) so the developer can
 * see exactly what region is being sent to NAI for inpainting.
 *
 * @param imageBuffer - Original source image as a Buffer
 * @param imgWidth - Source image width in pixels
 * @param imgHeight - Source image height in pixels
 * @returns PNG buffer of the original image with bounding box overlays
 */
async function generateDebugOverlay(
  imageBuffer: Buffer,
  segments: GeminiSegment[],
  imgWidth: number,
  imgHeight: number,
): Promise<Buffer> {
  const svgElements: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const color = BBOX_COLORS[i % BBOX_COLORS.length];
    const [y0Norm, x0Norm, y1Norm, x1Norm] = segment.box_2d;

    // Convert normalized 0-1000 coordinates to pixel coordinates (raw Gemini bbox)
    const x0 = Math.round((x0Norm / 1000) * imgWidth);
    const y0 = Math.round((y0Norm / 1000) * imgHeight);
    const x1 = Math.round((x1Norm / 1000) * imgWidth);
    const y1 = Math.round((y1Norm / 1000) * imgHeight);
    const bboxWidth = Math.max(x1 - x0, 1);
    const bboxHeight = Math.max(y1 - y0, 1);

    svgElements.push(
      `<rect x="${x0}" y="${y0}" width="${bboxWidth}" height="${bboxHeight}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="6,4"/>`,
    );

    const padX = Math.round(bboxWidth * NAI_INPAINT_PADDING);
    const padY = Math.round(bboxHeight * NAI_INPAINT_PADDING);
    const px0 = Math.max(0, x0 - padX);
    const py0 = Math.max(0, y0 - padY);
    const px1 = Math.min(imgWidth, x1 + padX);
    const py1 = Math.min(imgHeight, y1 + padY);
    const paddedW = px1 - px0;
    const paddedH = py1 - py0;

    const cx = px0 + paddedW / 2;
    const cy = py0 + paddedH / 2;
    const rx = paddedW / 2;
    const ry = paddedH / 2;
    svgElements.push(
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="2"/>`,
    );

    const label = segment.label || `Segment ${i + 1}`;
    const escapedLabel = label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const labelY = Math.max(py0 - 4, 14); // Keep label visible at top edge
    svgElements.push(
      `<text x="${px0 + 4}" y="${labelY}" font-size="14" font-family="sans-serif" fill="${color}" stroke="black" stroke-width="0.5">${escapedLabel}</text>`,
    );
  }

  const svgOverlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${imgWidth}" height="${imgHeight}">${svgElements.join("")}</svg>`,
  );

  const overlayBuffer = await sharp(imageBuffer)
    .composite([{ input: svgOverlay, top: 0, left: 0 }])
    .png()
    .toBuffer();

  return overlayBuffer;
}

/**
 * High-level segmentation pipeline: calls Gemini to segment the target region,
 * then processes and merges all resulting masks into a single inpainting mask.
 *
 * @param imageBase64 - Base64-encoded source image
 * @param imageMimeType - MIME type of the source image (e.g. "image/png")
 * @param apiKey - Decrypted Google API key for Gemini
 * @param isV4 - Whether the target NAI model is V4+ (affects mask quantization grid)
 * @returns SegmentationResult with the final mask and metadata
 */
export async function segmentImage(
  imageBase64: string,
  imageMimeType: string,
  editTarget: string,
  apiKey: string,
  isV4 = true,
): Promise<SegmentationResult> {
  const imageBuffer = Buffer.from(imageBase64, "base64");
  const metadata = await sharp(imageBuffer).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error("Unable to read source image dimensions for segmentation");
  }

  log.info(`Starting segmentation for "${editTarget}" on ${metadata.width}x${metadata.height} image`);

  const segments = await callGeminiSegmentation(imageBase64, imageMimeType, editTarget, apiKey);

  const maskBuffer = await buildBoundingBoxMask(segments, metadata.width, metadata.height, isV4);

  const maskBase64 = maskBuffer.toString("base64");

  // Generate debug artifacts when debug mode is enabled
  let debugMaskBuffer: Buffer | undefined;
  let debugOverlayBuffer: Buffer | undefined;

  if (NAI_INPAINT_DEBUG) {
    debugMaskBuffer = maskBuffer;
    debugOverlayBuffer = await generateDebugOverlay(imageBuffer, segments, metadata.width, metadata.height);
    log.info("[Segmentation] Debug overlay with bounding boxes generated");
  }

  return {
    maskBase64,
    segmentCount: segments.length,
    labels: segments.map((s) => s.label),
    imageWidth: metadata.width,
    imageHeight: metadata.height,
    debugMaskBuffer,
    debugOverlayBuffer,
  };
}
