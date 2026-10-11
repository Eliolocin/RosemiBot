/**
 * Brave Search Tool Implementations
 * Function call implementations that match MCP function signatures
 * Provides seamless replacement for MCP-based Brave Search functions
 */

import { log } from "../../../utils/misc/logger";
import type { ToolContext, ToolResult } from "../../../types/tool/interfaces";
import { sendStandardEmbed } from "../../../utils/discord/embedHelper";
import { sendPersonaPostViaWebhook } from "@/utils/discord/webhook/personaPost";
import { ColorCode } from "../../../utils/misc/logger";
import sharp from "sharp";
import {
  braveWebSearch,
  braveImageSearch,
  braveVideoSearch,
  braveNewsSearch,
  formatBraveSearchResults,
  isBraveApiKeyError,
  isBraveRateLimitError,
  // Enhanced MCP handler features
  extractImageUrls,
  addFetchCapabilityReminder,
} from "./braveSearchService";
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

/**
 * Extract server ID from tool context
 * @returns Server ID or undefined
 */
function getServerIdFromContext(context?: ToolContext): number | undefined {
  if (context && "serverId" in context) {
    return (context as ToolContext & { serverId?: number }).serverId;
  }

  if (context?.tomoriState?.server_id) {
    return context.tomoriState.server_id;
  }

  return undefined;
}

/**
 * Send API key missing error embed to Discord channel
 * @param context - Tool execution context with channel access
 * @param searchType - Type of search that was attempted
 */
async function sendApiKeyErrorEmbed(context?: ToolContext, searchType = "search") {
  if (!context?.channel || context.suppressProgressNotices) return;

  try {
    await sendStandardEmbed(
      context.channel,
      context.locale || "en-US",
      {
        titleKey: "general.errors.brave_api.missing_key.title",
        descriptionKey: "general.errors.brave_api.missing_key.description",
        descriptionVars: { searchType },
        color: ColorCode.ERROR,
        footerKey: "general.errors.brave_api.missing_key.footer",
      },
      {
        webhook: context.webhook,
        personaUsername: context.personaUsername,
        personaAvatarUrl: context.personaAvatarUrl,
        personaId: context.tomoriState.persona_id,
      },
    );
  } catch (embedError) {
    log.warn(`Failed to send Brave API key error embed: ${embedError}`);
  }
}

/**
 * @param success - Whether the operation was successful
 * @param message - Result message for humans
 * @param dataOrError - Either structured data for LLM processing, or error string
 * @param error - Error message (if any, when first param is data)
 */
function createToolResult(
  success: boolean,
  message: string,
  dataOrError?: Record<string, unknown> | string,
  error?: string,
) {
  if (typeof dataOrError === "string") {
    return {
      success,
      message,
      error: dataOrError,
    };
  }

  return {
    success,
    message,
    ...(dataOrError && { data: dataOrError }),
    ...(error && { error }),
  };
}

/**
 * Brave Web Search function call implementation
 */
export async function brave_web_search(
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<{
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
}> {
  const startTime = Date.now();
  try {
    if (!args.query || typeof args.query !== "string") {
      return createToolResult(false, "Invalid or missing query parameter", "Query is required and must be a string");
    }

    const serverId = getServerIdFromContext(context);

    const searchParams = {
      q: args.query as string, // Already validated above
      country: typeof args.country === "string" ? args.country : undefined,
      search_lang: typeof args.search_lang === "string" ? args.search_lang : undefined,
      ui_lang: typeof args.ui_lang === "string" ? args.ui_lang : undefined,
      count: typeof args.count === "number" ? args.count : undefined,
      offset: typeof args.offset === "number" ? args.offset : undefined,
      safesearch:
        args.safesearch === "off" || args.safesearch === "moderate" || args.safesearch === "strict"
          ? (args.safesearch as "off" | "moderate" | "strict")
          : undefined,
      freshness: typeof args.freshness === "string" ? args.freshness : undefined,
      spellcheck: typeof args.spellcheck === "boolean" ? args.spellcheck : undefined,
    };

    log.info(`Executing brave_web_search for query: "${searchParams.q}"`);

    const result = await braveWebSearch(searchParams, { serverId, signal: context?.abortSignal });

    if (!result.success || !result.data) {
      if (result.statusCode && isBraveApiKeyError(result.error || "", result.statusCode)) {
        await sendApiKeyErrorEmbed(context, "web");
        return createToolResult(false, "Brave Search API key is invalid or missing", result.error);
      }
      if (result.statusCode && isBraveRateLimitError(result.error || "", result.statusCode)) {
        return createToolResult(false, "Brave Search API rate limit exceeded", result.error);
      }

      return createToolResult(false, "Web search failed", result.error);
    }

    const formattedResults = formatBraveSearchResults(result.data, "web");

    const enhancedResults = addFetchCapabilityReminder(formattedResults);

    log.info(`Enhanced web search response with fetch capability reminder - Found ${enhancedResults.urlsFound} URLs`);

    return createToolResult(true, "Web search completed successfully", {
      source: "http",
      functionName: "brave_web_search",
      serverName: "http-brave-search",
      rawResult: {
        functionResponse: {
          name: "brave_web_search",
          response: {
            content: [
              {
                type: "text",
                text: enhancedResults.enhancedMessage,
              },
            ],
            isError: false,
          },
        },
      },
      executionTime: Date.now() - startTime,
      urlsFound: enhancedResults.urlsFound,
      fetchCapabilityReminder: true,
      agentInstructions: enhancedResults.fetchReminder,
      status: "completed",
    });
  } catch (error) {
    log.error("Error in brave_web_search:", error as Error);
    return createToolResult(false, "An unexpected error occurred during web search", (error as Error).message);
  }
}

/**
 * Brave Image Search function call implementation
 */
export async function brave_image_search(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
  try {
    if (!args.query || typeof args.query !== "string") {
      return createToolResult(false, "Invalid or missing query parameter", "Query is required and must be a string");
    }

    const serverId = getServerIdFromContext(context);

    const searchParams = {
      q: args.query as string, // Already validated above
      country: typeof args.country === "string" ? args.country : undefined,
      search_lang: typeof args.search_lang === "string" ? args.search_lang : undefined,
      count: typeof args.count === "number" ? args.count : undefined,
      safesearch:
        args.safesearch === "off" || args.safesearch === "strict" ? (args.safesearch as "off" | "strict") : undefined,
      spellcheck: typeof args.spellcheck === "boolean" ? args.spellcheck : undefined,
    };

    log.info(`Executing brave_image_search for query: "${searchParams.q}"`);

    const result = await braveImageSearch(searchParams, { serverId, signal: context?.abortSignal });

    if (!result.success || !result.data) {
      if (result.statusCode && isBraveApiKeyError(result.error || "", result.statusCode)) {
        await sendApiKeyErrorEmbed(context, "image");
        return createToolResult(false, "Brave Search API key is invalid or missing", result.error);
      }
      if (result.statusCode && isBraveRateLimitError(result.error || "", result.statusCode)) {
        return createToolResult(false, "Brave Search API rate limit exceeded", result.error);
      }

      return createToolResult(false, "Image search failed", result.error);
    }

    // Extract image URLs and process for Discord
    const allImageUrls = extractImageUrls(result.data);
    const isSupportedImageUrl = (url: string): boolean => !url.toLowerCase().includes(".avif");
    const imageUrls = allImageUrls.filter(isSupportedImageUrl);
    const skippedUrls = allImageUrls.filter((url) => !isSupportedImageUrl(url));

    log.info(
      `Total image URLs extracted: ${allImageUrls.length} (supported: ${imageUrls.length}, skipped AVIF: ${skippedUrls.length})`,
    );

    if (skippedUrls.length > 0) {
      log.warn(`Skipped ${skippedUrls.length} unsupported AVIF image(s).`);
    }

    if (imageUrls.length > 0 && context?.channel) {
      // Pre-validate URLs and create Discord attachments only for accessible images
      const attachments = [];
      const failedUrls: string[] = [];
      const validatedUrls: string[] = [];

      /**
       * Compress image if it exceeds Discord's 8MB limit
       * @param imageUrl - URL of the image to compress
       * @returns Promise resolving to compressed image buffer or null if compression failed
       */
      const compressImage = async (
        imageUrl: string,
      ): Promise<{ success: boolean; buffer?: Buffer; reason?: string }> => {
        try {
          const response = await safeDownload(imageUrl, {
            maxSizeMB: IMAGE_DOWNLOAD_MAX_MB,
            timeoutMs: 5000,
            requestInit: {
              method: "GET",
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              },
            },
          });

          if (!response.success || !response.buffer) {
            return {
              success: false,
              reason: response.error ?? "fetch_failed",
            };
          }

          const imageBuffer = response.buffer;

          // Compress with sharp - target 7MB max to leave safety margin
          const targetSize = IMAGE_COMPRESSION_TARGET_MB * 1024 * 1024;
          let quality = 80; // Start with 80% quality
          let compressedBuffer: Buffer;

          do {
            compressedBuffer = await sharp(imageBuffer)
              .jpeg({ quality, mozjpeg: true }) // Use mozjpeg for better compression
              .toBuffer();

            if (compressedBuffer.length <= targetSize) {
              break;
            }

            quality -= 10;
          } while (quality > 20 && compressedBuffer.length > targetSize);

          if (compressedBuffer.length > targetSize) {
            return { success: false, reason: "compression_insufficient" };
          }

          log.info(
            `Compressed image from ${imageBuffer.length} bytes to ${compressedBuffer.length} bytes (quality: ${quality}%)`,
          );
          return { success: true, buffer: compressedBuffer };
        } catch (error) {
          return {
            success: false,
            reason: error instanceof Error ? error.name : "compression_error",
          };
        }
      };

      /**
       * Fast URL validation function with aggressive timeout
       * @param imageUrl - URL to validate
       * @returns Promise resolving to validation result with optional compressed buffer
       */
      const validateImageUrl = async (
        imageUrl: string,
      ): Promise<{
        url: string;
        valid: boolean;
        reason?: string;
        compressedBuffer?: Buffer;
      }> => {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
          const badPatterns = [/xxx\./i, /\.onion\//i, /localhost/i, /127\.0\.0\.1/i, /192\.168\./i, /10\./i];

          if (badPatterns.some((pattern) => pattern.test(imageUrl))) {
            return { url: imageUrl, valid: false, reason: "blocked_domain" };
          }

          // Aggressive 2-second timeout for network validation
          const controller = new AbortController();
          timeoutId = setTimeout(() => controller.abort(), 2000);

          const response = await fetchUserRemoteUrl(imageUrl, {
            method: "HEAD",
            signal: controller.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          });

          if (response.ok && response.headers.get("content-type")?.startsWith("image/")) {
            const contentLength = response.headers.get("content-length");
            const discordLimit = IMAGE_DISCORD_LIMIT_MB * 1024 * 1024;

            if (contentLength && parseInt(contentLength, 10) < IMAGE_MIN_SIZE_BYTES) {
              return { url: imageUrl, valid: false, reason: "too_small" };
            }

            if (contentLength && parseInt(contentLength, 10) > discordLimit) {
              log.info(`Image ${imageUrl} is ${contentLength} bytes, attempting compression...`);

              const compressionResult = await compressImage(imageUrl);

              if (compressionResult.success && compressionResult.buffer) {
                return {
                  url: imageUrl,
                  valid: true,
                  compressedBuffer: compressionResult.buffer,
                };
              } else {
                return {
                  url: imageUrl,
                  valid: false,
                  reason: `size_too_large_${compressionResult.reason}`,
                };
              }
            }

            // Image is valid and within size limits
            return { url: imageUrl, valid: true };
          } else {
            return {
              url: imageUrl,
              valid: false,
              reason: `status_${response.status}`,
            };
          }
        } catch (error) {
          return {
            url: imageUrl,
            valid: false,
            reason: error instanceof Error ? error.name : "unknown_error",
          };
        } finally {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        }
      };

      log.info(`Starting parallel validation of ${imageUrls.length} image URLs (2s total timeout)`);

      const partialResults = new Map<
        string,
        {
          url: string;
          valid: boolean;
          reason?: string;
          compressedBuffer?: Buffer;
        }
      >();

      const wrappedPromises = imageUrls.map(async (url) => {
        try {
          const result = await validateImageUrl(url);
          partialResults.set(url, result);
          return result;
        } catch (error) {
          const failResult = {
            url,
            valid: false,
            reason: error instanceof Error ? error.name : "unknown_error",
          };
          partialResults.set(url, failResult);
          return failResult;
        }
      });

      // Overall timeout that preserves any completed validations
      const timeoutPromise = new Promise<
        {
          url: string;
          valid: boolean;
          reason?: string;
          compressedBuffer?: Buffer;
        }[]
      >((resolve) => {
        setTimeout(() => {
          log.warn(
            `Overall validation timeout reached (3s), proceeding with ${partialResults.size}/${imageUrls.length} completed results`,
          );

          const results = imageUrls.map((url) => {
            if (partialResults.has(url)) {
              return partialResults.get(url) as {
                url: string;
                valid: boolean;
                reason?: string;
                compressedBuffer?: Buffer;
              };
            } else {
              return { url, valid: false, reason: "overall_timeout" };
            }
          });

          resolve(results);
        }, 3000);
      });

      let validationResults: {
        url: string;
        valid: boolean;
        reason?: string;
        compressedBuffer?: Buffer;
      }[];
      try {
        // Use Promise.race to ensure we never wait more than 5 seconds total
        // But preserve any partial results that completed within the timeout
        validationResults = await Promise.race([
          Promise.allSettled(wrappedPromises).then((settledResults) =>
            settledResults.map((result, index) => {
              if (result.status === "fulfilled") {
                return result.value;
              } else {
                return {
                  url: imageUrls[index],
                  valid: false,
                  reason: "promise_rejected",
                };
              }
            }),
          ),
          timeoutPromise,
        ]);
      } catch (error) {
        log.error("Validation process failed completely:", error as Error);
        validationResults = imageUrls.map((url) => ({
          url,
          valid: false,
          reason: "validation_error",
        }));
      }

      const compressedImageMap = new Map<string, Buffer>();
      for (const result of validationResults) {
        if (result.valid) {
          validatedUrls.push(result.url);
          if (result.compressedBuffer) {
            compressedImageMap.set(result.url, result.compressedBuffer);
            log.info(`✓ Validated (compressed): ${result.url}`);
          } else {
            log.info(`✓ Validated: ${result.url}`);
          }
        } else {
          failedUrls.push(result.url);
          log.warn(`✗ Failed: ${result.url} (${result.reason})`);
        }
      }

      log.info(`Parallel validation complete: ${validatedUrls.length} valid, ${failedUrls.length} invalid`);

      // Create Discord attachments for validated URLs (using compressed buffers when available)
      const attachmentCompressionFlags: boolean[] = [];
      for (let i = 0; i < validatedUrls.length; i++) {
        try {
          const imageUrl = validatedUrls[i];
          const compressedBuffer = compressedImageMap.get(imageUrl);

          const attachment = new (await import("discord.js")).AttachmentBuilder(compressedBuffer || imageUrl, {
            name: `image_${i + 1}.jpg`,
          });
          attachments.push(attachment);
          attachmentCompressionFlags.push(Boolean(compressedBuffer));

          if (compressedBuffer) {
            log.info(
              `Prepared Discord attachment for compressed image: ${imageUrl} (${compressedBuffer.length} bytes)`,
            );
          } else {
            log.info(`Prepared Discord attachment for validated image: ${imageUrl}`);
          }
        } catch (attachmentError) {
          failedUrls.push(validatedUrls[i]);
          log.warn(`Failed to create attachment for validated URL: ${validatedUrls[i]}`, attachmentError as Error);
        }
      }

      // Send attachments to Discord channel (prefer webhook if available)
      if (attachments.length > 0) {
        try {
          const threadId =
            "isThread" in context.channel &&
            typeof context.channel.isThread === "function" &&
            context.channel.isThread()
              ? context.channel.id
              : undefined;
          const sentMessage =
            context.webhook && context.personaUsername
              ? await sendPersonaPostViaWebhook(
                  context.webhook,
                  {
                    files: attachments,
                    ...(threadId ? { threadId } : {}),
                  },
                  {
                    username: context.personaUsername,
                    avatarUrl: context.personaAvatarUrl,
                    personaId: context.tomoriState.persona_id,
                  },
                  context.channel,
                )
              : await context.channel.send({
                  files: attachments,
                });
          log.success(`Sent ${attachments.length} validated image attachments to Discord`);
          const sentAttachments = Array.from(sentMessage.attachments.values());

          const queryTerm = args.query || "images";
          const completionMessage = buildImageSearchDeliveryMessage({
            query: queryTerm,
            sentCount: attachments.length,
            messageId: sentMessage.id,
            providerPhrase: "",
            note:
              failedUrls.length > 0
                ? `(Note: ${failedUrls.length} image URLs were inaccessible and were filtered out.)`
                : undefined,
          });
          const imageMetadata = {
            imageUrls: sentAttachments.map((att, index) => ({
              url: att.url,
              mimeType: att.contentType || "image/jpeg",
              wasCompressed: attachmentCompressionFlags[index] ?? false,
              originalUrl: att.proxyURL ?? att.url,
            })),
            totalSent: sentAttachments.length,
            totalValidated: validatedUrls.length,
            messageIds: [sentMessage.id],
          };

          return {
            success: true,
            message: completionMessage,
            data: {
              results: completionMessage,
              imagesSent: attachments.length,
              imagesValidated: validatedUrls.length,
              imagesFiltered: failedUrls.length,
              status: "completed_and_sent",
            },
            imageMetadata,
          };
        } catch (sendError) {
          log.error("Failed to send image attachments to Discord:", sendError as Error);

          // Fall back to formatted results if Discord sending fails
          const formattedResults = formatBraveSearchResults(result.data, "image");
          return createToolResult(
            false,
            `Found ${validatedUrls.length} accessible images, but failed to send them to Discord due to a technical error. ${formattedResults}`,
          );
        }
      } else {
        const queryTerm = args.query || "images";
        return buildImageSearchTextFallback({
          message: `Found ${queryTerm} images via Brave but none were directly accessible. Showing result links instead.`,
          formattedResults: formatBraveSearchResults(result.data, "image"),
          filteredCount: failedUrls.length,
        });
      }
    }

    // Fallback: no Discord channel available or no images found - return formatted results
    if (imageUrls.length === 0) {
      const queryTerm = args.query || "images";
      return createToolResult(false, `Sorry, I couldn't find any ${queryTerm} images to show you.`, {
        results: `No ${queryTerm} images found`,
        status: "no_results",
      });
    }

    // No Discord channel available - return formatted results
    const formattedResults = formatBraveSearchResults(result.data, "image");
    return createToolResult(true, "Image search completed", {
      results: formattedResults,
      status: "completed",
    });
  } catch (error) {
    log.error("Error in brave_image_search:", error as Error);
    return createToolResult(false, "An unexpected error occurred during image search", (error as Error).message);
  }
}

/**
 * Brave Video Search function call implementation
 */
export async function brave_video_search(
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<{
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
}> {
  try {
    if (!args.query || typeof args.query !== "string") {
      return createToolResult(false, "Invalid or missing query parameter", "Query is required and must be a string");
    }

    const serverId = getServerIdFromContext(context);

    const searchParams = {
      q: args.query as string, // Already validated above
      country: typeof args.country === "string" ? args.country : undefined,
      search_lang: typeof args.search_lang === "string" ? args.search_lang : undefined,
      ui_lang: typeof args.ui_lang === "string" ? args.ui_lang : undefined,
      count: typeof args.count === "number" ? args.count : undefined,
      offset: typeof args.offset === "number" ? args.offset : undefined,
      safesearch:
        args.safesearch === "off" || args.safesearch === "moderate" || args.safesearch === "strict"
          ? (args.safesearch as "off" | "moderate" | "strict")
          : undefined,
      freshness: typeof args.freshness === "string" ? args.freshness : undefined,
      spellcheck: typeof args.spellcheck === "boolean" ? args.spellcheck : undefined,
    };

    log.info(`Executing brave_video_search for query: "${searchParams.q}"`);

    const result = await braveVideoSearch(searchParams, { serverId, signal: context?.abortSignal });

    if (!result.success || !result.data) {
      if (result.statusCode && isBraveApiKeyError(result.error || "", result.statusCode)) {
        await sendApiKeyErrorEmbed(context, "video");
        return createToolResult(false, "Brave Search API key is invalid or missing", result.error);
      }
      if (result.statusCode && isBraveRateLimitError(result.error || "", result.statusCode)) {
        return createToolResult(false, "Brave Search API rate limit exceeded", result.error);
      }

      return createToolResult(false, "Video search failed", result.error);
    }

    const formattedResults = formatBraveSearchResults(result.data, "video");

    return createToolResult(true, "Video search completed successfully", {
      results: formattedResults,
      status: "completed",
    });
  } catch (error) {
    log.error("Error in brave_video_search:", error as Error);
    return createToolResult(false, "An unexpected error occurred during video search", (error as Error).message);
  }
}

/**
 * Brave News Search function call implementation
 */
export async function brave_news_search(
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<{
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
}> {
  try {
    if (!args.query || typeof args.query !== "string") {
      return createToolResult(false, "Invalid or missing query parameter", "Query is required and must be a string");
    }

    const serverId = getServerIdFromContext(context);

    const searchParams = {
      q: args.query as string, // Already validated above
      country: typeof args.country === "string" ? args.country : undefined,
      search_lang: typeof args.search_lang === "string" ? args.search_lang : undefined,
      ui_lang: typeof args.ui_lang === "string" ? args.ui_lang : undefined,
      count: typeof args.count === "number" ? args.count : undefined,
      offset: typeof args.offset === "number" ? args.offset : undefined,
      safesearch:
        args.safesearch === "off" || args.safesearch === "moderate" || args.safesearch === "strict"
          ? (args.safesearch as "off" | "moderate" | "strict")
          : undefined,
      freshness: typeof args.freshness === "string" ? args.freshness : undefined,
      spellcheck: typeof args.spellcheck === "boolean" ? args.spellcheck : undefined,
    };

    log.info(`Executing brave_news_search for query: "${searchParams.q}"`);

    const result = await braveNewsSearch(searchParams, { serverId, signal: context?.abortSignal });

    if (!result.success || !result.data) {
      if (result.statusCode && isBraveApiKeyError(result.error || "", result.statusCode)) {
        return createToolResult(false, "Brave Search API key is invalid or missing", result.error);
      }
      if (result.statusCode && isBraveRateLimitError(result.error || "", result.statusCode)) {
        return createToolResult(false, "Brave Search API rate limit exceeded", result.error);
      }

      return createToolResult(false, "News search failed", result.error);
    }

    const formattedResults = formatBraveSearchResults(result.data, "news");

    return createToolResult(true, "News search completed successfully", {
      results: formattedResults,
      status: "completed",
    });
  } catch (error) {
    log.error("Error in brave_news_search:", error as Error);
    return createToolResult(false, "An unexpected error occurred during news search", (error as Error).message);
  }
}
