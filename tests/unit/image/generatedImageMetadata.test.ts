import { beforeAll, describe, expect, it } from "bun:test";
import sharp from "sharp";
import { prepareGeneratedImage } from "@/utils/image/generatedImageMetadata";
import { initializeLocalizer } from "@/utils/text/localizer";

function readImageTextChunks(png: Buffer): Map<string, string> {
  const chunks = new Map<string, string>();
  let offset = 8;

  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "iTXt") {
      const keyEnd = data.indexOf(0);
      const key = data.toString("ascii", 0, keyEnd);
      chunks.set(key, data.subarray(keyEnd + 5).toString("utf8"));
    }
    offset += length + 12;
  }

  return chunks;
}

describe("prepareGeneratedImage", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  it("preserves PNG bytes while storing Unicode prompt and negative prompt", async () => {
    const original = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })
      .png()
      .toBuffer();
    const first = await prepareGeneratedImage(original, "星空 🌟", "en-US", "文字なし");
    const second = await prepareGeneratedImage(first.buffer, "second prompt", "en-US");
    const chunks = readImageTextChunks(second.buffer);

    expect(second.buffer.subarray(0, original.length - 12).equals(original.subarray(0, original.length - 12))).toBe(
      true,
    );
    expect(second.extension).toBe("png");
    expect(chunks.get("TomoriPrompt")).toBe("second prompt");
    expect(chunks.get("TomoriNegativePrompt")).toBe("文字なし");
    expect((await sharp(second.buffer).metadata()).format).toBe("png");
  });

  it("stores Unicode and XML characters in JPEG and WebP XMP without changing format", async () => {
    for (const format of ["jpeg", "webp"] as const) {
      const original = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } })
        .toFormat(format)
        .toBuffer();
      const output = await prepareGeneratedImage(original, "星空 & <night>", "en-US", "文字なし");
      const resultMetadata = await sharp(output.buffer).metadata();

      expect(resultMetadata.format).toBe(format);
      expect(output.extension).toBe(format === "jpeg" ? "jpg" : "webp");
      expect(resultMetadata.xmp?.toString("utf8")).toContain("星空 &amp; &lt;night&gt;");
      expect(resultMetadata.xmp?.toString("utf8")).toContain("文字なし");
      expect(output.promptAttachment).toBeUndefined();
    }
  });

  it("leaves JPEG and WebP decoded pixels unchanged when adding XMP", async () => {
    const pixels = Buffer.alloc(32 * 32 * 3);
    for (let index = 0; index < pixels.length; index++) pixels[index] = (index * 73 + Math.floor(index / 3) * 19) % 256;
    for (const format of ["jpeg", "webp"] as const) {
      const original = await sharp(pixels, { raw: { width: 32, height: 32, channels: 3 } })
        .toFormat(format, { quality: 92 })
        .toBuffer();
      const output = await prepareGeneratedImage(original, "full prompt", "en-US");

      expect(output.promptAttachment).toBeUndefined();
      expect(await sharp(output.buffer).raw().toBuffer()).toEqual(await sharp(original).raw().toBuffer());
    }
  });

  it("keeps existing XMP and sends the prompt separately", async () => {
    for (const format of ["jpeg", "webp"] as const) {
      const original = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } })
        .toFormat(format)
        .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">provider metadata</x:xmpmeta>')
        .toBuffer();
      const output = await prepareGeneratedImage(original, "new prompt", "en-US");

      expect(output.buffer).toEqual(original);
      expect(output.promptAttachment?.name).toBe("image_prompt.txt");
    }
  });

  it("preserves existing JPEG EXIF while adding the prompt", async () => {
    const original = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } })
      .jpeg()
      .withExif({ IFD0: { Artist: "Mirri" } })
      .toBuffer();
    const output = await prepareGeneratedImage(original, "full prompt", "en-US");

    expect((await sharp(output.buffer).metadata()).exif).toEqual((await sharp(original).metadata()).exif);
  });

  it("preserves WebP alpha and EXIF while adding XMP to an extended container", async () => {
    const original = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#33669980" } })
      .webp()
      .withExif({ IFD0: { Artist: "Mirri" } })
      .toBuffer();
    const output = await prepareGeneratedImage(original, "full prompt", "en-US");
    const originalMetadata = await sharp(original).metadata();
    const outputMetadata = await sharp(output.buffer).metadata();

    expect(output.promptAttachment).toBeUndefined();
    expect(outputMetadata.exif).toEqual(originalMetadata.exif);
    expect(outputMetadata.hasAlpha).toBe(true);
    expect(await sharp(output.buffer).raw().toBuffer()).toEqual(await sharp(original).raw().toBuffer());
  });

  it("filters only XML 1.0 forbidden characters from JPEG and WebP XMP", async () => {
    const prompt = "a\u0000b\u0008c\u001fd\u007fe\uFFFEx\uFFFFy\uD800z🌟\nsecond\tline\r\nthird";
    const negativePrompt = "bad\u000btags\uFFFF";
    for (const format of ["jpeg", "webp"] as const) {
      const original = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } })
        .toFormat(format)
        .toBuffer();
      const output = await prepareGeneratedImage(original, prompt, "en-US", negativePrompt);
      const xmp = (await sharp(output.buffer).metadata()).xmp?.toString("utf8") ?? "";

      expect(xmp).toContain("<tomori:Prompt>abcd\u007fexyz🌟\nsecond\tline\r\nthird</tomori:Prompt>");
      expect(xmp).toContain("<tomori:NegativePrompt>badtags</tomori:NegativePrompt>");
      expect(xmp).toContain("\u007f");
      const illegalCodePoints = Array.from(xmp, (character) => character.codePointAt(0) ?? 0).filter(
        (codePoint) =>
          (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
          codePoint === 0xfffe ||
          codePoint === 0xffff,
      );
      expect(illegalCodePoints).toEqual([]);
    }
  });

  it("keeps transparency when extending a simple WebP for XMP", async () => {
    const original = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#33669980" } })
      .webp({ lossless: true })
      .toBuffer();
    const output = await prepareGeneratedImage(original, "full prompt", "en-US");

    expect(output.promptAttachment).toBeUndefined();
    expect((await sharp(output.buffer).metadata()).hasAlpha).toBe(true);
    expect(await sharp(output.buffer).raw().toBuffer()).toEqual(await sharp(original).raw().toBuffer());
  });

  it("keeps the original image and attaches the prompt when metadata crosses the upload limit", async () => {
    const prompt = "prompt".repeat(100);
    for (const format of ["png", "jpeg", "webp"] as const) {
      const original = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } })
        .toFormat(format)
        .toBuffer();
      const output = await prepareGeneratedImage(original, prompt, "en-US", undefined, original.length + 1);

      expect(output.buffer.equals(original)).toBe(true);
      expect(output.extension).toBe(format === "jpeg" ? "jpg" : format);
      expect(output.promptAttachment?.name).toBe("image_prompt.txt");
      expect(output.promptAttachment?.attachment.toString()).toContain(prompt);
    }
  });
});
