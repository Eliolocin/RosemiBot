/**
 * SearXNG Tool Implementations.
 *
 * Function-call wrappers consumed by `webSearch/searxngEngine.ts`. Mirrors the
 * `brave/toolImplementations.ts` shape (validate args → call service → format
 * result into a ToolResult) so the engine layer can treat both providers
 * symmetrically.
 *
 * Image search additionally downloads + validates URLs and sends them to
 * Discord as attachments (same UX as Brave image search) by piggybacking
 * on the existing helpers.
 */

import { AttachmentBuilder } from "discord.js";
import { log } from "../../../utils/misc/logger";
import type { ToolContext, ToolResult } from "../../../types/tool/interfaces";
import { sendPersonaPostViaWebhook } from "@/utils/discord/webhook/personaPost";
import { addFetchCapabilityReminder } from "../brave/braveSearchService";
import { safeDownload } from "@/utils/security/safeDownload";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";
import {
  buildImageSearchDeliveryMessage,
  buildImageSearchTextFallback,
  IMAGE_COMPRESSION_TARGET_MB,
  IMAGE_DISCORD_LIMIT_MB,
  IMAGE_DOWNLOAD_MAX_MB,
  IMAGE_MIN_SIZE_BYTES,
} from "@/tools/restAPIs/imageSearchResults";
import sharp from "sharp";
import { searxngSearch, formatSearxngResults, extractSearxngImageUrls } from "./searxngService";
import type { SearxngCategory } from "./types";

// How many valid images to actually send to Discord (default 3, max 10).
const SEARXNG_IMAGE_COUNT = Math.min(Math.max(1, Number.parseInt(process.env.SEARXNG_IMAGE_COUNT ?? "3", 10) || 3), 10);
// How many candidate URLs to pull from SearXNG and validate (default 10, max 20).
// Larger than SEARXNG_IMAGE_COUNT to absorb expected hotlink-protection failures.
const SEARXNG_IMAGE_POOL = Math.min(
  Math.max(SEARXNG_IMAGE_COUNT, Number.parseInt(process.env.SEARXNG_IMAGE_POOL ?? "10", 10) || 10),
  20,
);

function createToolResult(
  success: boolean,
  message: string,
  dataOrError?: Record<string, unknown> | string,
  error?: string,
): ToolResult {
  if (typeof dataOrError === "string") {
    return { success, message, error: dataOrError };
  }
  return {
    success,
    message,
    ...(dataOrError && { data: dataOrError }),
    ...(error && { error }),
  };
}

/**
 * Execute a generic text-like search via SearXNG and return a formatted
 * ToolResult. Image category has its own implementation below because it also
 * downloads + posts attachments to Discord.
 */
async function searxngTextLikeSearch(
  query: string,
  category: Exclude<SearxngCategory, "images">,
  context?: ToolContext,
  count?: number,
): Promise<ToolResult> {
  const startTime = Date.now();
  const result = await searxngSearch(query, category, { signal: context?.abortSignal });

  if (!result.success || !result.data) {
    return createToolResult(false, `SearXNG ${category} search failed`, result.error);
  }

  const formatted = formatSearxngResults(result.data, category, count);

  // Encourage agentic follow-up fetches when URLs are present (same hook
  //    used by Brave web/news/video results).
  const enhanced = addFetchCapabilityReminder(formatted);

  return createToolResult(true, `SearXNG ${category} search completed`, {
    source: "http",
    functionName: `searxng_${category}_search`,
    serverName: "http-searxng",
    rawResult: {
      functionResponse: {
        name: `searxng_${category}_search`,
        response: {
          content: [{ type: "text", text: enhanced.enhancedMessage }],
          isError: false,
        },
      },
    },
    executionTime: Date.now() - startTime,
    urlsFound: enhanced.urlsFound,
    fetchCapabilityReminder: true,
    agentInstructions: enhanced.fetchReminder,
    status: "completed",
  });
}

export async function searxng_category_search(
  args: Record<string, unknown>,
  category: Exclude<SearxngCategory, "images">,
  context?: ToolContext,
): Promise<ToolResult> {
  try {
    if (typeof args.query !== "string" || args.query.trim().length === 0) {
      return createToolResult(false, "Invalid or missing query parameter", "Query is required");
    }
    const count = typeof args.count === "number" && args.count > 0 ? Math.min(Math.floor(args.count), 20) : undefined;
    return await searxngTextLikeSearch(args.query, category, context, count);
  } catch (error) {
    log.error(`Error in searxng_${category}_search:`, error as Error);
    return createToolResult(false, `Unexpected error during SearXNG ${category} search`, (error as Error).message);
  }
}

/**
 * Compress an image to fit Discord's per-attachment size limit. Returns the
 * compressed buffer on success.
 */
async function compressImage(imageUrl: string): Promise<{ success: boolean; buffer?: Buffer; reason?: string }> {
  try {
    const response = await safeDownload(imageUrl, {
      maxSizeMB: IMAGE_DOWNLOAD_MAX_MB,
      timeoutMs: 5000,
      requestInit: {
        method: "GET",
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      },
    });
    if (!response.success || !response.buffer) {
      return { success: false, reason: response.error ?? "fetch_failed" };
    }
    const targetSize = IMAGE_COMPRESSION_TARGET_MB * 1024 * 1024;
    let quality = 80;
    let compressedBuffer: Buffer;
    do {
      compressedBuffer = await sharp(response.buffer).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (compressedBuffer.length <= targetSize) break;
      quality -= 10;
    } while (quality > 20 && compressedBuffer.length > targetSize);
    if (compressedBuffer.length > targetSize) {
      return { success: false, reason: "compression_insufficient" };
    }
    return { success: true, buffer: compressedBuffer };
  } catch (error) {
    return { success: false, reason: error instanceof Error ? error.name : "compression_error" };
  }
}

/**
 * HEAD-probe + optional compression for a single image URL.
 */
async function validateImageUrl(imageUrl: string): Promise<{
  url: string;
  valid: boolean;
  reason?: string;
  compressedBuffer?: Buffer;
}> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const badPatterns = [/xxx\./i, /\.onion\//i, /localhost/i, /127\.0\.0\.1/i, /192\.168\./i, /10\./i];
    if (badPatterns.some((p) => p.test(imageUrl))) {
      return { url: imageUrl, valid: false, reason: "blocked_domain" };
    }
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetchUserRemoteUrl(imageUrl, {
      method: "HEAD",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });

    if (response.ok && response.headers.get("content-type")?.startsWith("image/")) {
      const contentLength = response.headers.get("content-length");
      const discordLimit = IMAGE_DISCORD_LIMIT_MB * 1024 * 1024;
      if (contentLength && parseInt(contentLength, 10) < IMAGE_MIN_SIZE_BYTES) {
        return { url: imageUrl, valid: false, reason: "too_small" };
      }
      if (contentLength && parseInt(contentLength, 10) > discordLimit) {
        const compressionResult = await compressImage(imageUrl);
        if (compressionResult.success && compressionResult.buffer) {
          return { url: imageUrl, valid: true, compressedBuffer: compressionResult.buffer };
        }
        return { url: imageUrl, valid: false, reason: `size_too_large_${compressionResult.reason}` };
      }
      return { url: imageUrl, valid: true };
    }
    return { url: imageUrl, valid: false, reason: `status_${response.status}` };
  } catch (error) {
    return { url: imageUrl, valid: false, reason: error instanceof Error ? error.name : "unknown_error" };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function searxng_image_search(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
  try {
    if (typeof args.query !== "string" || args.query.trim().length === 0) {
      return createToolResult(false, "Invalid or missing query parameter", "Query is required");
    }
    const query = args.query;
    // LLM-requested count caps at 10. When the LLM specifies a count, use 3×
    // as the validation pool (capped at 30) so hotlink failures don't exhaust
    // candidates before reaching sendCount. When no count is given, fall back
    // to the SEARXNG_IMAGE_POOL env-var default.
    const sendCount =
      typeof args.count === "number" && args.count > 0 ? Math.min(Math.floor(args.count), 10) : SEARXNG_IMAGE_COUNT;
    const pool = typeof args.count === "number" ? Math.min(sendCount * 3, 30) : SEARXNG_IMAGE_POOL;

    const result = await searxngSearch(query, "images", { signal: context?.abortSignal });
    if (!result.success || !result.data) {
      return createToolResult(false, "SearXNG image search failed", result.error);
    }

    // Filter out AVIF (Discord display issues) then cap to the resolved pool
    //    before validation. Pool is larger than the send count to absorb
    //    expected hotlink-protection failures from aggregated engines.
    const allUrls = extractSearxngImageUrls(result.data);
    const imageUrls = allUrls.filter((u) => !u.toLowerCase().includes(".avif")).slice(0, pool);

    if (imageUrls.length === 0) {
      return createToolResult(false, `No accessible ${query} images found via SearXNG.`, {
        results: `No ${query} images found`,
        status: "no_results",
      });
    }

    if (!context?.channel) {
      // No Discord channel, so fall back to text-format listing.
      return createToolResult(true, "SearXNG image search completed (text fallback)", {
        results: formatSearxngResults(result.data, "images"),
        status: "completed",
      });
    }

    type ValidationResult = { url: string; valid: boolean; reason?: string; compressedBuffer?: Buffer };
    const partial = new Map<string, ValidationResult>();
    const wrapped: Promise<ValidationResult>[] = imageUrls.map(async (url) => {
      try {
        const r = await validateImageUrl(url);
        partial.set(url, r);
        return r;
      } catch (error) {
        const failed: ValidationResult = {
          url,
          valid: false,
          reason: error instanceof Error ? error.name : "unknown_error",
        };
        partial.set(url, failed);
        return failed;
      }
    });
    const timeoutPromise = new Promise<ValidationResult[]>((resolve) => {
      setTimeout(() => {
        const merged: ValidationResult[] = imageUrls.map(
          (u) => partial.get(u) ?? { url: u, valid: false, reason: "overall_timeout" },
        );
        resolve(merged);
      }, 3000);
    });
    const validationResults: ValidationResult[] = await Promise.race([
      Promise.allSettled(wrapped).then((settled) =>
        settled.map<ValidationResult>((s, i) =>
          s.status === "fulfilled" ? s.value : { url: imageUrls[i], valid: false, reason: "promise_rejected" },
        ),
      ),
      timeoutPromise,
    ]);

    const validated: string[] = [];
    const failed: string[] = [];
    const compressedMap = new Map<string, Buffer>();
    for (const r of validationResults) {
      if (r.valid) {
        validated.push(r.url);
        if (r.compressedBuffer) compressedMap.set(r.url, r.compressedBuffer);
      } else {
        failed.push(r.url);
      }
    }

    if (validated.length === 0) {
      return buildImageSearchTextFallback({
        message: `Found ${query} images via SearXNG but none were directly accessible. Showing result links instead.`,
        formattedResults: formatSearxngResults(result.data, "images"),
        filteredCount: failed.length,
      });
    }

    // Build Discord attachments, so cap to sendCount after validation
    //    so pool failures don't cause us to send more than intended.
    const toSend = validated.slice(0, sendCount);
    const attachments: AttachmentBuilder[] = [];
    const compressionFlags: boolean[] = [];
    for (let i = 0; i < toSend.length; i++) {
      const url = toSend[i];
      const buf = compressedMap.get(url);
      attachments.push(new AttachmentBuilder(buf ?? url, { name: `image_${i + 1}.jpg` }));
      compressionFlags.push(Boolean(buf));
    }

    const threadId =
      "isThread" in context.channel && typeof context.channel.isThread === "function" && context.channel.isThread()
        ? context.channel.id
        : undefined;
    const sentMessage =
      context.webhook && context.personaUsername
        ? await sendPersonaPostViaWebhook(
            context.webhook,
            { files: attachments, ...(threadId ? { threadId } : {}) },
            {
              username: context.personaUsername,
              avatarUrl: context.personaAvatarUrl,
              personaId: context.tomoriState.persona_id,
            },
            context.channel,
          )
        : await context.channel.send({ files: attachments });

    const sentAttachments = Array.from(sentMessage.attachments.values());
    const completionMessage = buildImageSearchDeliveryMessage({
      query,
      sentCount: attachments.length,
      messageId: sentMessage.id,
      providerPhrase: " via SearXNG",
      note: failed.length > 0 ? `(Note: ${failed.length} URLs were inaccessible.)` : undefined,
    });

    return {
      success: true,
      message: completionMessage,
      data: {
        results: completionMessage,
        imagesSent: attachments.length,
        imagesValidated: validated.length,
        imagesFiltered: failed.length,
        status: "completed_and_sent",
      },
      imageMetadata: {
        imageUrls: sentAttachments.map((att, idx) => ({
          url: att.url,
          mimeType: att.contentType || "image/jpeg",
          wasCompressed: compressionFlags[idx] ?? false,
          originalUrl: att.proxyURL ?? att.url,
        })),
        totalSent: sentAttachments.length,
        totalValidated: validated.length,
        messageIds: [sentMessage.id],
      },
    };
  } catch (error) {
    log.error("Error in searxng_image_search:", error as Error);
    return createToolResult(false, "Unexpected error during SearXNG image search", (error as Error).message);
  }
}
