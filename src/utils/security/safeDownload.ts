/**
 * Safe Download Utility
 * Provides size-limited, timeout-protected file downloads for Discord attachments
 * Prevents DDoS attacks via oversized files or slow download attacks
 */

import { log } from "@/utils/misc/logger";
import { fetchUserRemoteUrl, RemoteUrlPolicyError } from "@/utils/security/userRemoteFetch";
import { readBoundedResponse, ResponseSizeError } from "@/utils/security/boundedResponse";

export interface SafeDownloadOptions {
  /**
   * Maximum file size in MB
   */
  maxSizeMB: number;

  /**
   * Timeout in milliseconds (default: 10000ms / 10 seconds)
   */
  timeoutMs?: number;

  /**
   * Known file size from Discord attachment metadata (in bytes)
   * If provided, size check occurs before download attempt
   */
  knownSize?: number;

  /**
   * Additional fetch options such as provider-required headers.
   * The timeout AbortSignal is always applied by safeDownload.
   */
  requestInit?: Omit<RequestInit, "signal">;

  /**
   * Optional external AbortSignal (e.g. from ToolContext.abortSignal).
   * When fired, it also aborts the internal timeout controller early.
   */
  externalSignal?: AbortSignal;
}

export interface SafeDownloadResult {
  /**
   * Whether the download succeeded
   */
  success: boolean;

  /**
   * Downloaded file buffer (only if success === true)
   */
  buffer?: Buffer;

  /**
   * Response Content-Type header, when the server provided one
   */
  contentType?: string;

  /**
   * Error type if download failed.
   *
   * `blocked_by_policy` means the SSRF gate refused the URL and no request was
   * ever sent, so it is never a transport problem and must not be retried against
   * the same URL.
   */
  error?: "size_exceeded" | "timeout" | "network_error" | "invalid_response" | "blocked_by_policy";

  /**
   * Additional error details for logging/debugging
   */
  details?: string;
}

/**
 * Safely download a file with size and timeout protections
 *
 * @param url - URL to download from
 * @param options - Download options (maxSizeMB, timeoutMs, knownSize)
 *
 * @example
 * ```typescript
 * const result = await safeDownload(attachment.url, {
 *   maxSizeMB: 8,
 *   timeoutMs: 10000,
 *   knownSize: attachment.size
 * });
 *
 * if (!result.success) {
 *   // Handle error based on result.error
 * }
 *
 * const imageBuffer = result.buffer;
 * ```
 */
export async function safeDownload(url: string, options: SafeDownloadOptions): Promise<SafeDownloadResult> {
  // Signed attachment queries authorize access, so logs retain only the download origin.
  let urlOrigin: string;
  try {
    urlOrigin = new URL(url).origin;
  } catch {
    urlOrigin = "invalid";
  }
  const { maxSizeMB, timeoutMs = 10000, knownSize, requestInit, externalSignal } = options;
  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  if (knownSize !== undefined && knownSize > maxSizeBytes) {
    log.warn(`File size ${(knownSize / (1024 * 1024)).toFixed(2)} MB exceeds limit of ${maxSizeMB} MB`, {
      metadata: {
        urlOrigin,
        knownSizeMB: knownSize / (1024 * 1024),
        maxSizeMB,
      },
    });

    return {
      success: false,
      error: "size_exceeded",
      details: `File size ${(knownSize / (1024 * 1024)).toFixed(2)} MB exceeds ${maxSizeMB} MB limit`,
    };
  }

  if (url.startsWith("data:")) {
    // Early rejection: base64 is ~1.33x the size of the raw data.
    // Using 0.75x of string length gives a safe lower-bound estimate of the byte size.
    // If the estimate itself exceeds the max, it's definitively too large.
    const estimatedSizeBytes = url.length * 0.75;
    if (estimatedSizeBytes > maxSizeBytes) {
      log.warn(
        `Data URI estimated size ${(estimatedSizeBytes / (1024 * 1024)).toFixed(2)} MB exceeds limit of ${maxSizeMB} MB`,
        {
          metadata: { estimatedSizeMB: estimatedSizeBytes / (1024 * 1024), maxSizeMB },
        },
      );

      return {
        success: false,
        error: "size_exceeded",
        details: `Data URI estimated size ${(estimatedSizeBytes / (1024 * 1024)).toFixed(2)} MB exceeds ${maxSizeMB} MB limit`,
      };
    }

    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length > maxSizeBytes) {
        log.warn(`Data URI ${(buffer.length / (1024 * 1024)).toFixed(2)} MB exceeds limit of ${maxSizeMB} MB`, {
          metadata: { actualSizeMB: buffer.length / (1024 * 1024), maxSizeMB },
        });

        return {
          success: false,
          error: "size_exceeded",
          details: `Data URI size ${(buffer.length / (1024 * 1024)).toFixed(2)} MB exceeds ${maxSizeMB} MB limit`,
        };
      }

      return {
        success: true,
        buffer,
        contentType: response.headers.get("content-type") ?? undefined,
      };
    } catch (error) {
      log.error("Failed to parse data URI in safeDownload", {
        errorType: "download_network_error",
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });

      return {
        success: false,
        error: "invalid_response",
        details: `Failed to parse data URI: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      return { success: false, error: "timeout", details: "Aborted before download started" };
    }
    externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetchUserRemoteUrl(url, { ...(requestInit ?? {}), signal: controller.signal });

    if (!response.ok) {
      log.warn(`Download failed with HTTP ${response.status}`, {
        metadata: {
          urlOrigin,
          status: response.status,
          statusText: response.statusText,
        },
      });

      return {
        success: false,
        error: "invalid_response",
        details: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const sizeBytes = Number.parseInt(contentLength, 10);
      if (sizeBytes > maxSizeBytes) {
        log.warn(`Content-Length ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB exceeds limit of ${maxSizeMB} MB`, {
          metadata: {
            urlOrigin,
            contentLengthMB: sizeBytes / (1024 * 1024),
            maxSizeMB,
          },
        });

        return {
          success: false,
          error: "size_exceeded",
          details: `Content-Length ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB exceeds ${maxSizeMB} MB limit`,
        };
      }
    }

    const buffer = await readBoundedResponse(response, maxSizeBytes);

    if (buffer.length > maxSizeBytes) {
      log.warn(`Downloaded file ${(buffer.length / (1024 * 1024)).toFixed(2)} MB exceeds limit of ${maxSizeMB} MB`, {
        metadata: {
          urlOrigin,
          actualSizeMB: buffer.length / (1024 * 1024),
          maxSizeMB,
        },
      });

      return {
        success: false,
        error: "size_exceeded",
        details: `Downloaded file ${(buffer.length / (1024 * 1024)).toFixed(2)} MB exceeds ${maxSizeMB} MB limit`,
      };
    }

    log.info(`Successfully downloaded ${(buffer.length / (1024 * 1024)).toFixed(2)} MB`);

    return {
      success: true,
      buffer,
      contentType: response.headers.get("content-type") ?? undefined,
    };
  } catch (error) {
    if (error instanceof ResponseSizeError) {
      return { success: false, error: "size_exceeded", details: error.message };
    }
    if (error instanceof Error && error.name === "AbortError") {
      log.warn(`Download timed out after ${timeoutMs}ms`, {
        metadata: { urlOrigin, timeoutMs },
      });

      return {
        success: false,
        error: "timeout",
        details: `Download timed out after ${timeoutMs}ms`,
      };
    }

    if (error instanceof RemoteUrlPolicyError) {
      // Logged at warn, not error: an unreachable-by-policy URL (a plain-HTTP
      // image host, a redirect to a private address) is an expected outcome of
      // user-supplied content, not an incident.
      log.warn("Download blocked by URL policy", {
        errorType: "download_blocked_by_policy",
        metadata: {
          urlOrigin,
          hostname: error.hostname,
          failureCode: error.failureCode ?? "UNKNOWN",
          error: error.message,
        },
      });

      return {
        success: false,
        error: "blocked_by_policy",
        details: error.message,
      };
    }

    log.error("Download failed with network error", {
      errorType: "download_network_error",
      metadata: {
        urlOrigin,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    return {
      success: false,
      error: "network_error",
      details: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
