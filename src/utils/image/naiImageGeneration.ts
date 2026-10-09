import JSZip from "jszip";
import type { EffectiveNaiImageParams } from "@/utils/image/naiImageParams";
import { log } from "@/utils/misc/logger";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { getDeclaredUncompressedSize } from "@/utils/zip/zipEntryGuards";

const NAI_IMAGE_BASE_URL = "https://image.novelai.net";

export const NAI_DEFAULT_NEGATIVE_PROMPT =
  "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page";

export const NAI_CHAR_REF_STRENGTH = 0.6;
export const NAI_CHAR_REF_INFO_EXTRACTED = 1.0;
const NAI_CHAR_REF_SECONDARY_STRENGTH = 0.0;
const NAI_CHAR_REF_DESCRIPTION = "character&style";

const ORIENTATION_PRESETS: Record<string, { width: number; height: number }> = {
  portrait: { width: 832, height: 1216 },
  landscape: { width: 1216, height: 832 },
  square: { width: 1024, height: 1024 },
};
export type NaiImageErrorKind = "auth" | "quota" | "rate_limit" | "other";

interface NaiCharacterCaption {
  char_caption: string;
  centers: Array<{ x: number; y: number }>;
}

interface NaiCharacterPrompt {
  center: { x: number; y: number };
  enabled: true;
  prompt: string;
  uc: string;
}

export interface NaiGenerationCharacterPayload {
  useCoords?: boolean;
  charCaptions?: NaiCharacterCaption[];
  negativeCharCaptions?: NaiCharacterCaption[];
  characterPrompts?: NaiCharacterPrompt[];
  referenceImages?: string[];
  referenceStrengths?: number[];
  referenceInfoExtracted?: number[];
}

/** Whether a model uses NovelAI's V4+ structured prompt schema. */
export function usesNaiStructuredPromptFormat(model: string): boolean {
  // V5 retains the V4 structured prompt schema (v4_prompt/v4_negative_prompt).
  return /nai-diffusion-[45]/.test(model);
}

/** Precise Reference is available on NovelAI V4.5 models only. */
export function supportsNaiPreciseReference(model: string): boolean {
  return /^nai-diffusion-4-5-(?:full|curated)$/.test(model);
}

export function classifyNaiImageError(error: unknown): NaiImageErrorKind {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const normalizedErrorMessage = errorMessage.toLowerCase();

  if (
    /\b402\b/.test(errorMessage) ||
    normalizedErrorMessage.includes("payment required") ||
    normalizedErrorMessage.includes("anlas") ||
    normalizedErrorMessage.includes("credit") ||
    normalizedErrorMessage.includes("credits") ||
    normalizedErrorMessage.includes("generation quota")
  ) {
    return "quota";
  }

  if (
    /\b401\b/.test(errorMessage) ||
    /\b403\b/.test(errorMessage) ||
    normalizedErrorMessage.includes("unauthorized") ||
    normalizedErrorMessage.includes("forbidden") ||
    normalizedErrorMessage.includes("invalid api key")
  ) {
    return "auth";
  }

  if (
    /\b429\b/.test(errorMessage) ||
    normalizedErrorMessage.includes("rate limit") ||
    normalizedErrorMessage.includes("too many requests")
  ) {
    return "rate_limit";
  }

  return "other";
}

// One generated PNG is a few megabytes and PNG data barely deflates, so a single cap bounds both
// the archive and its expanded entry with room to spare for the largest supported resolution.
const MAX_NAI_ZIP_BYTES = 32 * 1024 * 1024;
const MAX_NAI_ZIP_ENTRIES = 8;
const MAX_NAI_ERROR_BODY_BYTES = 4096;
// Generation queues for seconds, not minutes. A body that trickles past this is abandoned rather
// than holding the tool, its sockets and its buffers until the outer tool timeout gives up on it.
const NAI_IMAGE_REQUEST_TIMEOUT_MS = 180_000;

/** The caller's cancellation joined with a deadline that also covers reading the response body. */
export function naiImageRequestSignal(abortSignal?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(NAI_IMAGE_REQUEST_TIMEOUT_MS);
  return abortSignal ? AbortSignal.any([abortSignal, deadline]) : deadline;
}

/** A bounded slice of an error body for the thrown message and its operator log. */
export async function readNaiErrorSnippet(response: Response): Promise<string> {
  const body = await readBoundedResponse(response, MAX_NAI_ERROR_BODY_BYTES).catch(() => null);
  return body ? body.toString("utf8").slice(0, 500) : "";
}

/**
 * Extracts the generated PNG from NovelAI's ZIP reply. The archive is read with a byte cap, and
 * the entry's declared size is checked before it is inflated, because a small archive can declare
 * and deliver gigabytes.
 */
export async function extractPngFromZipResponse(response: Response): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await readBoundedResponse(response, MAX_NAI_ZIP_BYTES));
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > MAX_NAI_ZIP_ENTRIES) {
    throw new Error(`NovelAI response ZIP has ${entries.length} entries`);
  }
  const png = entries.find((entry) => entry.name.toLowerCase().endsWith(".png"));
  if (!png) {
    throw new Error("NovelAI response ZIP did not contain a PNG file");
  }
  // Without a declared size the expansion cannot be bounded before paying for it, so refuse.
  const declaredSize = getDeclaredUncompressedSize(png);
  if (declaredSize === null || declaredSize > MAX_NAI_ZIP_BYTES) {
    throw new Error("NovelAI response PNG declares no size or more than the expanded size limit");
  }
  const pngData = await png.async("nodebuffer");
  if (pngData.length > MAX_NAI_ZIP_BYTES) {
    throw new Error("NovelAI response PNG exceeds the expanded size limit");
  }
  return pngData;
}

export async function generateNovelAiImage(options: {
  apiKey: string;
  model: string;
  prompt: string;
  negativePrompt: string;
  orientation: string;
  imageParams: EffectiveNaiImageParams;
  characterPayload?: NaiGenerationCharacterPayload;
  abortSignal?: AbortSignal;
}): Promise<Buffer> {
  const { apiKey, model, prompt, negativePrompt, orientation, imageParams, characterPayload, abortSignal } = options;

  const dimensions = ORIENTATION_PRESETS[orientation] || ORIENTATION_PRESETS.portrait;
  const seed = Math.floor(Math.random() * 2147483647);
  const charCaptions = characterPayload?.charCaptions ?? [];
  const negativeCharCaptions = characterPayload?.negativeCharCaptions ?? [];
  const characterPrompts = characterPayload?.characterPrompts ?? [];
  const referenceImages = characterPayload?.referenceImages ?? [];
  const referenceStrengths = characterPayload?.referenceStrengths ?? [];
  const referenceInfoExtracted = characterPayload?.referenceInfoExtracted ?? [];
  const useCoords = characterPayload?.useCoords ?? false;

  if (referenceImages.length > 0 && !supportsNaiPreciseReference(model)) {
    throw new Error(`NovelAI Precise Reference requires a V4.5 model (received ${model}).`);
  }

  let requestPayload: Record<string, unknown>;

  if (usesNaiStructuredPromptFormat(model)) {
    const buildDirectorReferenceDescriptions = (count: number) =>
      Array.from({ length: count }, () => ({
        caption: {
          base_caption: NAI_CHAR_REF_DESCRIPTION,
          char_captions: [],
        },
        legacy_uc: false,
      }));
    const buildDirectorReferenceSecondaryStrengths = (count: number) =>
      Array.from({ length: count }, () => NAI_CHAR_REF_SECONDARY_STRENGTH);
    const buildV4RequestPayload = (): Record<string, unknown> => {
      const directorRefCount = referenceImages.length;

      return {
        action: "generate",
        input: prompt,
        model,
        parameters: {
          prompt,
          negative_prompt: negativePrompt,
          seed,
          n_samples: 1,
          steps: imageParams.steps,
          height: dimensions.height,
          width: dimensions.width,
          scale: imageParams.scale,
          uncond_scale: 0.0,
          cfg_rescale: imageParams.cfgRescale,
          sampler: imageParams.sampler,
          noise_schedule: imageParams.noiseSchedule,
          legacy_v3_extend: false,
          characterPrompts: characterPrompts.length > 0 ? characterPrompts : undefined,
          use_coords: useCoords,
          legacy_uc: false,
          normalize_reference_strength_multiple: directorRefCount > 0 ? true : undefined,
          director_reference_descriptions:
            directorRefCount > 0 ? buildDirectorReferenceDescriptions(directorRefCount) : undefined,
          director_reference_information_extracted:
            referenceInfoExtracted.length > 0 ? referenceInfoExtracted : undefined,
          director_reference_strength_values: referenceStrengths.length > 0 ? referenceStrengths : undefined,
          director_reference_secondary_strength_values:
            directorRefCount > 0 ? buildDirectorReferenceSecondaryStrengths(directorRefCount) : undefined,
          director_reference_images: referenceImages.length > 0 ? referenceImages : undefined,
          v4_prompt: {
            caption: {
              base_caption: prompt,
              char_captions: charCaptions,
            },
            use_coords: useCoords,
            use_order: true,
            legacy_uc: false,
          },
          v4_negative_prompt: {
            caption: {
              base_caption: negativePrompt,
              char_captions:
                negativeCharCaptions.length > 0
                  ? negativeCharCaptions
                  : charCaptions.map((charCaption) => ({
                      char_caption: "",
                      centers: charCaption.centers,
                    })),
            },
            legacy_uc: false,
          },
          controlnet_strength: 1.0,
          controlnet_model: null,
          dynamic_thresholding: false,
          dynamic_thresholding_percentile: 0.999,
          dynamic_thresholding_mimic_scale: 10.0,
          sm: false,
          sm_dyn: false,
          skip_cfg_above_sigma: null,
          skip_cfg_below_sigma: 0.0,
          lora_unet_weights: null,
          lora_clip_weights: null,
          deliberate_euler_ancestral_bug: false,
          prefer_brownian: true,
          cfg_sched_eligibility: "enable_for_post_summer_samplers",
          explike_fine_detail: false,
          minimize_sigma_inf: false,
          uncond_per_vibe: true,
          wonky_vibe_correlation: true,
          version: 1,
          request_type: "PromptGenerateRequest",
        },
      };
    };

    requestPayload = buildV4RequestPayload();
    log.info(
      `[NAI] V4+ generate request (chars: ${charCaptions.length}, coords: ${useCoords}, refs: ${referenceImages.length})`,
    );

    const response = await fetch(`${NAI_IMAGE_BASE_URL}/ai/generate-image`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestPayload),
      signal: naiImageRequestSignal(abortSignal),
    });
    if (response.ok) return await extractPngFromZipResponse(response);

    const correlationId = response.headers.get("x-correlation-id");
    const errorText = await readNaiErrorSnippet(response);
    throw new Error(
      `NovelAI image generation failed (${response.status} ${response.statusText})${correlationId ? ` [correlation-id: ${correlationId}]` : ""}: ${errorText.slice(0, 500)}`,
    );
  }

  requestPayload = {
    action: "generate",
    input: prompt,
    model,
    parameters: {
      width: dimensions.width,
      height: dimensions.height,
      steps: imageParams.steps,
      scale: imageParams.scale,
      sampler: imageParams.sampler,
      noise_schedule: imageParams.noiseSchedule,
      n_samples: 1,
      seed,
      negative_prompt: negativePrompt,
    },
  };

  log.info(`[NAI] Generating image with model "${model}" (${dimensions.width}x${dimensions.height}, seed: ${seed})`);

  const response = await fetch(`${NAI_IMAGE_BASE_URL}/ai/generate-image`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestPayload),
    signal: naiImageRequestSignal(abortSignal),
  });

  if (!response.ok) {
    const correlationId = response.headers.get("x-correlation-id");
    const errorText = await readNaiErrorSnippet(response);
    const snippet = errorText.slice(0, 500);
    throw new Error(
      `NovelAI image generation failed (${response.status} ${response.statusText})${correlationId ? ` [correlation-id: ${correlationId}]` : ""}: ${snippet}`,
    );
  }

  return await extractPngFromZipResponse(response);
}
