/**
 * Shared Text Extraction Utility
 * Provides reusable text extraction from document buffers (PDF, TXT, MD)
 * Used by both /teach document and the read_file tool
 */

import type { PdfParseReply } from "@/utils/documents/pdfParseWorker";
import { log } from "@/utils/misc/logger";
import { safeDownload } from "@/utils/security/safeDownload";
import { normalizeDocumentText } from "@/utils/documents/documentService";
import { memoryGuard } from "@/utils/security/rateLimiter";

/**
 * Known-binary MIME type prefixes: any file whose content-type starts with one
 * of these is treated as non-readable binary and rejected outright.
 * `application/pdf` is intentionally absent; it is handled as a special case below.
 */
const BINARY_MIME_PREFIXES = ["image/", "video/", "audio/"] as const;

/**
 * Known-binary file extensions: files with these extensions are rejected even
 * when Discord reports an ambiguous MIME type (e.g. `application/octet-stream`).
 * Source-code and markup extensions are intentionally absent so they pass through.
 */
const BINARY_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".tiff",
  ".tif",
  ".avif",
  ".heic",
  ".mp4",
  ".avi",
  ".mov",
  ".mkv",
  ".webm",
  ".flv",
  ".wmv",
  ".m4v",
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".aac",
  ".m4a",
  ".wma",
  ".opus",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".rar",
  ".7z",
  ".xz",
  ".zst",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".apk",
  ".ipa",
  ".pyc",
  ".class",
  ".wasm",
  ".o",
  ".a",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".dat",
  ".bin",
  ".docx",
  ".xlsx",
  ".pptx",
  ".doc",
  ".xls",
  ".ppt",
  ".odt",
  ".ods",
  ".odp",
]);

/**
 * Check if a file is readable as text (and therefore extractable).
 *
 * Strategy: blocklist-based rather than allowlist-based.
 * PDF is handled as a named special case (requires `pdf-parse` for binary parsing).
 * Any other file that is not a known binary format is accepted and read as UTF-8 text:
 * this naturally covers .txt, .md, .py, .ts, .c, .cpp, .java, .rs, .go, .json, .yaml, etc.
 * without needing to enumerate every possible code or markup extension.
 *
 * @param contentType - MIME type of the file (may be null)
 * @param filename - Filename used to check the extension
 */
export function isExtractableDocument(contentType: string | null, filename: string): boolean {
  const lowerName = filename.toLowerCase();

  if (lowerName.endsWith(".pdf") || contentType === "application/pdf") return true;

  if (contentType && BINARY_MIME_PREFIXES.some((prefix) => contentType.startsWith(prefix))) {
    return false;
  }

  const dotIdx = lowerName.lastIndexOf(".");
  if (dotIdx !== -1 && BINARY_EXTENSIONS.has(lowerName.slice(dotIdx))) {
    return false;
  }

  // Accept everything else: any text-based MIME type (text/*) or unknown
  //    extension falls through here and will be decoded as UTF-8.
  return true;
}

/**
 * Extract text from a raw buffer based on file type
 * Supports PDF (via pdf-parse), TXT, and MD files
 *
 * @param buffer - Raw file buffer
 * @param filename - Filename used to determine file type
 * @param contentType - Optional MIME type for additional type detection
 */
export async function extractTextFromBuffer(
  buffer: Buffer,
  filename: string,
  contentType?: string | null,
): Promise<string> {
  const lowerName = filename.toLowerCase();
  const isPdf = contentType === "application/pdf" || lowerName.endsWith(".pdf");

  if (isPdf) return parsePdfWithDeadline(buffer, PDF_PARSE_TIMEOUT_MS);

  return buffer.toString("utf8");
}

// The size cap bounds bytes, not parse time: a crafted PDF under the cap can loop in pdf.js. An
// ordinary document parses in a few seconds, so this only stops pathological files.
const PDF_PARSE_TIMEOUT_MS = 20_000;

export class PdfParseTimeoutError extends Error {}

/**
 * Parses in a worker so a stalled parse cannot block the event loop, and terminates it at the
 * deadline because `pdf-parse` offers no way to abort.
 */
export function parsePdfWithDeadline(buffer: Buffer, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Resolved beside this source file. Tools and commands are imported from `src/` at runtime even
    // under `dist/index.js`, so this module never lands in the bundle; a static import from the
    // entry point would make this URL point into `dist/`, where no worker file is emitted.
    const worker = new Worker(new URL("./pdfParseWorker.ts", import.meta.url));
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      worker.terminate();
      settle();
    };
    const timer = setTimeout(
      () => finish(() => reject(new PdfParseTimeoutError(`PDF parse exceeded ${timeoutMs} ms`))),
      timeoutMs,
    );
    worker.onmessage = (event: MessageEvent<PdfParseReply>) => {
      const reply = event.data;
      finish(() => ("text" in reply ? resolve(reply.text) : reject(new Error(reply.error))));
    };
    worker.onerror = (event) => finish(() => reject(new Error(event.message)));
    worker.postMessage(new Uint8Array(buffer));
  });
}

/**
 * Result of a full text extraction pipeline
 */
export interface ExtractTextResult {
  /** Whether extraction succeeded */
  success: boolean;
  /** Extracted and normalized text (only if success) */
  text?: string;
  /** Whether the text was truncated to fit maxTextLength */
  truncated: boolean;
  /** Original text length before truncation (only if truncated) */
  originalLength?: number;
  /** Error category if extraction failed */
  error?: "size_exceeded" | "extraction_failed" | "memory_pressure" | "timeout" | "download_failed" | "empty_document";
}

/**
 * Full extraction pipeline: download -> extract -> normalize -> truncate
 * Handles memory guard checks, safe download, text extraction, and truncation
 *
 * @returns Extraction result with text or error details
 */
export async function extractTextFromUrl(
  url: string,
  filename: string,
  contentType: string | null,
  options: {
    maxSizeBytes: number;
    maxTextLength: number;
    knownSize?: number;
    timeoutMs?: number;
  },
): Promise<ExtractTextResult> {
  const memCheck = memoryGuard.checkMemory();
  if (memCheck.status === "warning" || memCheck.status === "critical") {
    log.warn(`textExtractor: Blocked extraction due to memory pressure (${memCheck.status})`);
    return { success: false, truncated: false, error: "memory_pressure" };
  }

  // Download the file with size and timeout protections
  const maxSizeMB = options.maxSizeBytes / (1024 * 1024);
  const downloadResult = await safeDownload(url, {
    maxSizeMB,
    timeoutMs: options.timeoutMs ?? 15000,
    knownSize: options.knownSize,
  });

  if (!downloadResult.success || !downloadResult.buffer) {
    const errorType =
      downloadResult.error === "size_exceeded"
        ? "size_exceeded"
        : downloadResult.error === "timeout"
          ? "timeout"
          : "download_failed";
    log.warn(`textExtractor: Download failed for ${filename}: ${downloadResult.error} - ${downloadResult.details}`);
    return { success: false, truncated: false, error: errorType };
  }

  let rawText: string;
  try {
    rawText = await extractTextFromBuffer(downloadResult.buffer, filename, contentType);
  } catch (error) {
    log.error(`textExtractor: Failed to extract text from ${filename}`, error as Error);
    return { success: false, truncated: false, error: "extraction_failed" };
  }

  const normalizedText = normalizeDocumentText(rawText);

  if (!normalizedText || normalizedText.trim().length === 0) {
    return { success: false, truncated: false, error: "empty_document" };
  }

  const truncated = normalizedText.length > options.maxTextLength;
  const finalText = truncated ? normalizedText.slice(0, options.maxTextLength) : normalizedText;

  return {
    success: true,
    text: finalText,
    truncated,
    originalLength: truncated ? normalizedText.length : undefined,
  };
}
