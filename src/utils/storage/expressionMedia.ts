import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";
import { randomUUID } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { APIAttachment } from "discord.js";
import type { CustomExpressionMedia } from "@/types/db/schema";
import { safeDownload } from "@/utils/security/safeDownload";
import { validateRemoteUrl } from "@/utils/security/remoteUrlSecurity";
import { storeExpressionMedia } from "@/utils/storage/expressionStorage";

export const EXPRESSION_MEDIA_MAX_BYTES = 10 * 1024 * 1024;
// Decoding all GIF frames shares this pixel ceiling; raise it only with a bounded decoder budget.
const IMAGE_PIXEL_LIMIT = 40_000_000;
const MP4_VALIDATION_TIMEOUT_MS = 15_000;

export class ExpressionMediaError extends Error {
  constructor(public readonly code: "sources" | "files" | "size" | "url" | "download" | "format" | "encoding") {
    super(`Expression media rejected: ${code}`);
  }
}

type ValidatedMedia = {
  mime_type: NonNullable<CustomExpressionMedia["mime_type"]>;
  extension: NonNullable<CustomExpressionMedia["extension"]>;
  byte_size: number;
};

async function validateMp4(buffer: Buffer): Promise<void> {
  if (!ffmpegPath) throw new ExpressionMediaError("encoding");
  // MP4 files with trailing moov metadata require seekable input.
  const inputPath = join(tmpdir(), `tomori-expression-${randomUUID()}.mp4`);
  const input = await open(inputPath, "wx");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    try {
      await input.writeFile(buffer);
    } finally {
      await input.close();
    }
    const process = Bun.spawn(
      [
        ffmpegPath,
        "-hide_banner",
        "-xerror",
        "-max_alloc",
        "67108864",
        "-threads",
        "1",
        "-f",
        "mp4",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-f",
        "null",
        "-",
      ],
      { stdin: "ignore", stdout: "ignore", stderr: "pipe" },
    );
    timer = setTimeout(() => process.kill(), MP4_VALIDATION_TIMEOUT_MS);
    const [exitCode, details] = await Promise.all([process.exited, new Response(process.stderr).text()]);
    const videoLines = details.split("\n").filter((line) => line.includes("Video:"));
    const audioLines = details.split("\n").filter((line) => line.includes("Audio:"));
    // Discord clients support AVC with 8-bit 4:2:0 pixels and optional AAC audio.
    // Other encodings require a separate conversion feature before this ceiling can change.
    const inputVideo = videoLines[0];
    if (
      exitCode !== 0 ||
      !inputVideo ||
      !/Video: h264\b/u.test(inputVideo) ||
      !/\byuv420p\b/u.test(inputVideo) ||
      audioLines.some((line) => !/Audio: aac\b/u.test(line)) ||
      !/frame=\s*[1-9]/u.test(details)
    ) {
      throw new ExpressionMediaError("encoding");
    }
  } finally {
    clearTimeout(timer);
    await unlink(inputPath);
  }
}

export async function validateExpressionBytes(
  buffer: Buffer,
  declaredMime?: string | null,
  filename?: string,
): Promise<ValidatedMedia> {
  if (!buffer.length || buffer.length > EXPRESSION_MEDIA_MAX_BYTES) throw new ExpressionMediaError("size");
  let format: ValidatedMedia["extension"];
  let mime: ValidatedMedia["mime_type"];
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    await validateMp4(buffer);
    format = "mp4";
    mime = "video/mp4";
  } else {
    try {
      const image = sharp(buffer, { animated: true, limitInputPixels: IMAGE_PIXEL_LIMIT, failOn: "warning" });
      const metadata = await image.metadata();
      if (!["png", "jpeg", "webp", "gif"].includes(metadata.format ?? "")) throw new ExpressionMediaError("format");
      await image.stats();
      format = metadata.format === "jpeg" ? "jpg" : (metadata.format as "png" | "webp" | "gif");
      mime = metadata.format === "jpeg" ? "image/jpeg" : (`image/${format}` as ValidatedMedia["mime_type"]);
    } catch {
      throw new ExpressionMediaError("format");
    }
  }
  const suppliedMime = declaredMime?.split(";")[0].trim().toLowerCase();
  if (suppliedMime && suppliedMime !== "application/octet-stream" && suppliedMime !== mime)
    throw new ExpressionMediaError("format");
  if (filename) {
    const extension = filename.split(".").at(-1)?.toLowerCase();
    if (format === "jpg" && extension === "jpeg") format = "jpeg";
    else if (extension !== format) throw new ExpressionMediaError("format");
  }
  return { mime_type: mime, extension: format, byte_size: buffer.length };
}

// Discord attachment links expire, so they are the one kind of link imported into storage.
const DISCORD_MEDIA_HOSTS = ["cdn.discordapp.com", "media.discordapp.net"];

export async function prepareExpressionMedia(
  serverId: number,
  id: string,
  link: string,
  files: APIAttachment[],
  editing: boolean,
): Promise<CustomExpressionMedia | null> {
  const source = link.trim();
  if (files.length > 1) throw new ExpressionMediaError("files");
  if ((source && files.length) || (!editing && !source && !files.length)) throw new ExpressionMediaError("sources");
  if (!source && !files.length) return null;
  let url: URL;
  try {
    url = new URL(source || files[0].url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.toString().length > 2000)
      throw new Error("URL credentials or protocol");
  } catch {
    throw new ExpressionMediaError("url");
  }
  // Links are posted verbatim for Discord to unfurl, so the bot never fetches them and web pages are valid.
  if (source && !DISCORD_MEDIA_HOSTS.includes(url.hostname)) {
    const validation = await validateRemoteUrl(source);
    if (!validation.valid) throw new ExpressionMediaError("url");
    return {
      source_kind: "link",
      delivery_kind: "link",
      original_link: url.toString(),
      storage_reference: null,
      mime_type: null,
      extension: null,
      byte_size: null,
    };
  }
  const downloaded = await safeDownload(url.toString(), {
    maxSizeMB: EXPRESSION_MEDIA_MAX_BYTES / (1024 * 1024),
    timeoutMs: 30_000,
    knownSize: files[0]?.size,
  });
  if (!downloaded.success || !downloaded.buffer) {
    throw new ExpressionMediaError(
      downloaded.error === "size_exceeded" ? "size" : downloaded.error === "blocked_by_policy" ? "url" : "download",
    );
  }
  const media = await validateExpressionBytes(
    downloaded.buffer,
    files[0]?.content_type ?? downloaded.contentType,
    files[0]?.filename,
  );
  const storageReference = await storeExpressionMedia(
    serverId,
    id,
    downloaded.buffer,
    media.mime_type,
    media.extension,
  );
  return {
    source_kind: files.length ? "upload" : "link",
    delivery_kind: "stored",
    original_link: source ? url.toString() : null,
    storage_reference: storageReference,
    ...media,
  };
}
