import { expect, spyOn, test } from "bun:test";
import JSZip from "jszip";
import sharp from "sharp";
import {
  extractPngFromZipResponse,
  generateNovelAiImage,
  naiImageRequestSignal,
  supportsNaiPreciseReference,
  usesNaiStructuredPromptFormat,
} from "@/utils/image/naiImageGeneration";
import { resolveNaiImageParams } from "@/utils/image/naiImageParams";
import { createPersona } from "../../helpers/fixtures";

test("uses the structured prompt schema for NovelAI Diffusion V4 and V5", () => {
  expect(usesNaiStructuredPromptFormat("nai-diffusion-4-5-full")).toBe(true);
  expect(usesNaiStructuredPromptFormat("nai-diffusion-5-curated")).toBe(true);
  expect(usesNaiStructuredPromptFormat("nai-diffusion-3-furry")).toBe(false);
});

test("allows Precise Reference only on NovelAI Diffusion V4.5", () => {
  expect(supportsNaiPreciseReference("nai-diffusion-4-5-full")).toBe(true);
  expect(supportsNaiPreciseReference("nai-diffusion-4-5-curated")).toBe(true);
  expect(supportsNaiPreciseReference("nai-diffusion-5-full")).toBe(false);
  expect(supportsNaiPreciseReference("nai-diffusion-4-full")).toBe(false);
});

test("rejects V5 references before sending a generation request", async () => {
  const fetchSpy = spyOn(globalThis, "fetch");
  const reference = (
    await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } })
      .png()
      .toBuffer()
  ).toString("base64");
  try {
    await expect(
      generateNovelAiImage({
        apiKey: "test-key",
        model: "nai-diffusion-5-full",
        prompt: "portrait",
        negativePrompt: "",
        orientation: "portrait",
        imageParams: resolveNaiImageParams(createPersona().config),
        characterPayload: { referenceImages: [reference] },
      }),
    ).rejects.toThrow("requires a V4.5 model");
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
});

test("keeps a failed V4.5 reference request visible instead of retrying without it", async () => {
  const reference = (
    await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } })
      .png()
      .toBuffer()
  ).toString("base64");
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("Invalid reference", { status: 400, statusText: "Bad Request" }),
  );
  try {
    await expect(
      generateNovelAiImage({
        apiKey: "test-key",
        model: "nai-diffusion-4-5-full",
        prompt: "portrait",
        negativePrompt: "",
        orientation: "portrait",
        imageParams: resolveNaiImageParams(createPersona().config),
        characterPayload: { referenceImages: [reference], referenceStrengths: [0.6] },
      }),
    ).rejects.toThrow("400 Bad Request");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const request = fetchSpy.mock.calls[0]?.[1];
    const payload = JSON.parse(String(request?.body));
    expect(payload.parameters.director_reference_images).toEqual([reference]);
  } finally {
    fetchSpy.mockRestore();
  }
});

async function zipResponse(files: Record<string, Buffer>): Promise<Response> {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return new Response(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }));
}

test("extracts the generated PNG from a NovelAI ZIP", async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } })
    .png()
    .toBuffer();
  expect(await extractPngFromZipResponse(await zipResponse({ "image_0.png": png }))).toEqual(png);
});

test("refuses an entry that would inflate past the limit before inflating it", async () => {
  // 40 MiB of zeros deflates to a few dozen kilobytes, so only the declared size reveals it.
  const bomb = await zipResponse({ "image_0.png": Buffer.alloc(40 * 1024 * 1024) });
  await expect(extractPngFromZipResponse(bomb)).rejects.toThrow("declares no size or more");
});

test("refuses archives with too many entries and stops reading an oversized archive", async () => {
  const many = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`part_${index}.png`, Buffer.from("x")]));
  await expect(extractPngFromZipResponse(await zipResponse(many))).rejects.toThrow("entries");

  let produced = 0;
  const chunk = new Uint8Array(1024 * 1024);
  const endless = new Response(
    new ReadableStream({
      pull(controller) {
        produced += chunk.byteLength;
        controller.enqueue(chunk);
      },
    }),
  );
  await expect(extractPngFromZipResponse(endless)).rejects.toThrow("exceeds");
  expect(produced).toBeLessThanOrEqual(34 * 1024 * 1024);
});

test("bounds a NovelAI error body and joins cancellation with the request deadline", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("E".repeat(2 * 1024 * 1024), { status: 500, statusText: "Server Error" }),
  );
  try {
    const failure = await generateNovelAiImage({
      apiKey: "test-key",
      model: "nai-diffusion-3",
      prompt: "portrait",
      negativePrompt: "",
      orientation: "portrait",
      imageParams: resolveNaiImageParams(createPersona().config),
    }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message.length).toBeLessThan(1000);
    expect((fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.signal).toBeInstanceOf(AbortSignal);
  } finally {
    fetchSpy.mockRestore();
  }

  const controller = new AbortController();
  const signal = naiImageRequestSignal(controller.signal);
  expect(signal.aborted).toBe(false);
  controller.abort();
  expect(signal.aborted).toBe(true);
});
