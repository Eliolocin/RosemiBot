import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "bun:test";
import sharp from "sharp";
import ffmpeg from "ffmpeg-static";
import type { APIAttachment } from "discord.js";
import {
  EXPRESSION_MEDIA_MAX_BYTES,
  prepareExpressionMedia,
  validateExpressionBytes,
} from "@/utils/storage/expressionMedia";
import { deleteExpressionMedia, loadExpressionMedia, storeExpressionMedia } from "@/utils/storage/expressionStorage";
import { safeDownload } from "@/utils/security/safeDownload";
import { useEnvSandbox } from "../../helpers/env";

describe("expression media validation and owned storage", () => {
  let png: Buffer;
  useEnvSandbox(["EXPRESSION_STORAGE_BACKEND", "RUN_ENV"]);
  beforeAll(async () => {
    process.env.EXPRESSION_STORAGE_BACKEND = "local";
    process.env.RUN_ENV = "development";
    png = await sharp({ create: { width: 4, height: 4, channels: 4, background: "red" } })
      .png()
      .toBuffer();
  });
  it("decodes all supported image formats and both JPEG extensions", async () => {
    for (const format of ["png", "jpeg", "webp", "gif"] as const) {
      const bytes = await sharp(png).toFormat(format).toBuffer();
      const result = await validateExpressionBytes(bytes, `image/${format}`, `expression.${format}`);
      expect(result.byte_size).toBe(bytes.length);
      expect(result.extension).toBe(format);
    }
    const jpeg = await sharp(png).jpeg().toBuffer();
    expect((await validateExpressionBytes(jpeg, "image/jpeg", "expression.jpg")).extension).toBe("jpg");
  });
  it("rejects oversize, corrupt, disguised and mismatched files by content", async () => {
    await expect(validateExpressionBytes(Buffer.alloc(EXPRESSION_MEDIA_MAX_BYTES + 1))).rejects.toMatchObject({
      code: "size",
    });
    await expect(
      validateExpressionBytes(Buffer.from("<html>wrong content</html>"), "image/png", "image.png"),
    ).rejects.toMatchObject({ code: "format" });
    await expect(validateExpressionBytes(png.subarray(0, 30), "image/png", "image.png")).rejects.toMatchObject({
      code: "format",
    });
    await expect(validateExpressionBytes(png, "image/gif", "image.png")).rejects.toMatchObject({ code: "format" });
    await expect(validateExpressionBytes(png, "image/png", "image.exe")).rejects.toMatchObject({ code: "format" });
  });
  it("accepts AVC MP4 and rejects unsupported video encoding without conversion", async () => {
    if (!ffmpeg) throw new Error("Installed ffmpeg binary is missing");
    for (const codec of ["libx264", "mpeg4"]) {
      const child = Bun.spawn(
        [
          ffmpeg,
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=red:s=16x16:d=0.1",
          "-an",
          "-c:v",
          codec,
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "frag_keyframe+empty_moov",
          "-f",
          "mp4",
          "pipe:1",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const bytes = Buffer.from(await new Response(child.stdout).arrayBuffer());
      expect(await child.exited).toBe(0);
      if (codec === "libx264")
        expect((await validateExpressionBytes(bytes, "video/mp4", "image.mp4")).extension).toBe("mp4");
      else
        await expect(validateExpressionBytes(bytes, "video/mp4", "image.mp4")).rejects.toMatchObject({
          code: "encoding",
        });
    }
  });
  it("accepts seekable ordinary and fast-start MP4 files", async () => {
    if (!ffmpeg) throw new Error("Installed ffmpeg binary is missing");
    for (const fastStart of [false, true]) {
      const target = join(tmpdir(), `tomori-expression-test-${randomUUID()}.mp4`);
      try {
        const child = Bun.spawn(
          [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=320x240:d=2",
            "-an",
            "-c:v",
            "libx264",
            "-crf",
            "12",
            "-pix_fmt",
            "yuv420p",
            ...(fastStart ? ["-movflags", "+faststart"] : []),
            target,
          ],
          { stdout: "ignore", stderr: "pipe" },
        );
        expect(await child.exited).toBe(0);
        const bytes = await readFile(target);
        // Larger than FFmpeg's pipe buffer, so trailing metadata cannot mask a seek regression.
        expect(bytes.length).toBeGreaterThan(64 * 1024);
        const moov = bytes.indexOf(Buffer.from("moov"));
        const mdat = bytes.indexOf(Buffer.from("mdat"));
        expect(moov).toBeGreaterThan(0);
        expect(mdat).toBeGreaterThan(0);
        expect(moov < mdat).toBe(fastStart);
        expect((await validateExpressionBytes(bytes, "video/mp4", "expression.mp4")).extension).toBe("mp4");
      } finally {
        await unlink(target);
      }
    }
  });
  it("enforces source exclusivity and single-file inputs before fetching", async () => {
    const attachment = {
      url: "https://example.com/image.png",
      filename: "image.png",
      size: png.length,
    } as APIAttachment;
    const id = randomUUID();
    await expect(prepareExpressionMedia(1, id, "", [], false)).rejects.toMatchObject({ code: "sources" });
    await expect(prepareExpressionMedia(1, id, attachment.url, [attachment], true)).rejects.toMatchObject({
      code: "sources",
    });
    await expect(prepareExpressionMedia(1, id, "", [attachment, attachment], false)).rejects.toMatchObject({
      code: "files",
    });
    expect(await prepareExpressionMedia(1, id, "", [], true)).toBeNull();
    await expect(
      prepareExpressionMedia(1, id, "https://user:secret@example.com/page", [], false),
    ).rejects.toMatchObject({ code: "url" });
  });
  it("uses immutable keys, reads private bytes and rejects cross-owner references", async () => {
    const id = randomUUID();
    const first = await storeExpressionMedia(1, id, png, "image/png", "png");
    const second = await storeExpressionMedia(1, id, png, "image/png", "png");
    try {
      expect(first).not.toBe(second);
      expect(await loadExpressionMedia(first, 1, id)).toEqual(png);
      await expect(loadExpressionMedia(first, 2, id)).rejects.toThrow();
      await expect(loadExpressionMedia(first, 1, randomUUID())).rejects.toThrow();
      await deleteExpressionMedia(first, 2, id);
      expect(await loadExpressionMedia(first, 1, id)).toEqual(png);
    } finally {
      await deleteExpressionMedia(first, 1, id);
      await deleteExpressionMedia(second, 1, id);
    }
  });
  it("keeps links unfetched, stores uploads and blocks unsafe redirect destinations", async () => {
    let requests = 0;
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        requests++;
        if (new URL(request.url).pathname === "/redirect")
          return Response.redirect("http://169.254.169.254/latest/meta-data");
        return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
      },
    });
    const id = randomUUID();
    let reference: string | null = null;
    try {
      const url = `http://localhost:${server.port}/image.png`;
      for (const link of [url, `http://localhost:${server.port}/hospital`])
        expect(await prepareExpressionMedia(1, id, link, [], false)).toEqual({
          source_kind: "link",
          delivery_kind: "link",
          original_link: link,
          storage_reference: null,
          mime_type: null,
          extension: null,
          byte_size: null,
        });
      expect(requests).toBe(0);
      const upload = await prepareExpressionMedia(
        1,
        id,
        "",
        [{ url, filename: "image.png", size: png.length, content_type: "image/png" } as APIAttachment],
        false,
      );
      reference = upload?.storage_reference ?? null;
      expect(upload).toMatchObject({ source_kind: "upload", delivery_kind: "stored" });
      if (!reference) throw new Error("Upload did not store media");
      expect(await loadExpressionMedia(reference, 1, id)).toEqual(png);
      expect(await safeDownload(`http://localhost:${server.port}/redirect`, { maxSizeMB: 10 })).toMatchObject({
        success: false,
        error: "blocked_by_policy",
      });
    } finally {
      if (reference) await deleteExpressionMedia(reference, 1, id);
      server.stop(true);
    }
  });
});
