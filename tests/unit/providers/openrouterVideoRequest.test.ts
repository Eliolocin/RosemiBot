import { describe, expect, it } from "bun:test";
import {
  buildOpenRouterVideoRequestBody,
  normalizeOpenRouterVideoOptions,
  OpenRouterVideoCapabilityError,
  resolveOpenRouterPollingUrl,
} from "@/providers/openrouter/openrouterVideoRequest";
import type { ProviderNativeVideoGenerationRequest } from "@/types/provider/featureInterfaces";
import type { OpenRouterVideoModelCapabilities } from "@/utils/cache/openrouterVideoModelCache";

function createCapabilities(
  overrides: Partial<OpenRouterVideoModelCapabilities> = {},
): OpenRouterVideoModelCapabilities {
  return {
    id: "test/video-model",
    supportedResolutions: ["720p", "1080p"],
    supportedAspectRatios: ["16:9", "9:16"],
    supportedDurations: [5, 10],
    supportedFrameImages: ["first_frame", "last_frame"],
    generateAudio: true,
    allowedPassthroughParameters: [],
    ...overrides,
  };
}

function createRequest(
  overrides: Partial<ProviderNativeVideoGenerationRequest> = {},
): ProviderNativeVideoGenerationRequest {
  return {
    apiKey: "test-key",
    model: "test/video-model",
    prompt: "A slow camera move",
    aspectRatio: "1:1",
    durationSeconds: 7,
    resolution: "480p",
    ...overrides,
  };
}

describe("OpenRouter stable video request", () => {
  it("defaults Grok Lite to 480p while preserving explicit resolution choices", () => {
    const model = "x-ai/grok-imagine-video-1.5-lite";
    const capabilities = createCapabilities({ id: model, supportedResolutions: ["480p", "720p", "1080p"] });
    for (const resolution of [undefined, "720p", "1080p"] as const) {
      const request = createRequest({ model, resolution });
      for (const catalog of [capabilities, undefined])
        expect(normalizeOpenRouterVideoOptions(request, catalog).resolution).toBe(resolution ?? "480p");
    }
  });
  it("normalizes options from the dedicated video model metadata", () => {
    const normalized = normalizeOpenRouterVideoOptions(createRequest(), createCapabilities());

    expect(normalized).toEqual({
      duration: 5,
      resolution: "720p",
      aspectRatio: "16:9",
    });
  });

  it("resolves relative polling URLs and rejects credential redirects", () => {
    expect(resolveOpenRouterPollingUrl("/api/v1/videos/job-123")).toBe("https://openrouter.ai/api/v1/videos/job-123");
    expect(() => resolveOpenRouterPollingUrl("https://attacker.example/job-123")).toThrow("unsafe polling URL");
  });

  it("uses frame_images for exact first-frame image-to-video", () => {
    const request = createRequest({
      referenceImages: [{ mimeType: "image/png", data: "aGVsbG8=" }],
    });
    const normalized = normalizeOpenRouterVideoOptions(request, createCapabilities());
    const body = buildOpenRouterVideoRequestBody(request, normalized, createCapabilities());

    expect(body).not.toHaveProperty("input_references");
    expect(body.frame_images).toEqual([
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,aGVsbG8=" },
        frame_type: "first_frame",
      },
    ]);
  });

  it("adds a last frame when the tool requests a loop", () => {
    const request = createRequest({
      loop: true,
      referenceImages: [{ mimeType: "image/jpeg", data: "", url: "https://cdn.example/frame.jpg" }],
    });
    const normalized = normalizeOpenRouterVideoOptions(request, createCapabilities());
    const body = buildOpenRouterVideoRequestBody(request, normalized, createCapabilities());

    expect(body.frame_images).toEqual([
      {
        type: "image_url",
        image_url: { url: "https://cdn.example/frame.jpg" },
        frame_type: "first_frame",
      },
      {
        type: "image_url",
        image_url: { url: "https://cdn.example/frame.jpg" },
        frame_type: "last_frame",
      },
    ]);
  });

  it("rejects a reference before submission when first-frame control is unsupported", () => {
    const request = createRequest({
      referenceImages: [{ mimeType: "image/png", data: "aGVsbG8=" }],
    });
    const capabilities = createCapabilities({ supportedFrameImages: [] });
    const normalized = normalizeOpenRouterVideoOptions(request, capabilities);

    expect(() => buildOpenRouterVideoRequestBody(request, normalized, capabilities)).toThrow(
      OpenRouterVideoCapabilityError,
    );
  });

  it("rejects looping when last-frame control is unsupported", () => {
    const request = createRequest({
      loop: true,
      referenceImages: [{ mimeType: "image/png", data: "aGVsbG8=" }],
    });
    const capabilities = createCapabilities({ supportedFrameImages: ["first_frame"] });
    const normalized = normalizeOpenRouterVideoOptions(request, capabilities);

    expect(() => buildOpenRouterVideoRequestBody(request, normalized, capabilities)).toThrow(
      "does not support last-frame control",
    );
  });

  it("keeps metadata-informed legacy fallbacks when the catalog is temporarily unavailable", () => {
    const request = createRequest({
      model: "alibaba/wan-2.6",
      durationSeconds: 8,
      resolution: "480p",
      aspectRatio: "1:1",
    });

    expect(normalizeOpenRouterVideoOptions(request, undefined)).toEqual({
      duration: 10,
      resolution: "720p",
      aspectRatio: "16:9",
    });
  });
});
