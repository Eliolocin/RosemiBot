import { withProviderUsageContext } from "@/utils/provider/providerUsage";
import {
  findProviderRequestDeniedError,
  createProviderUsageRecorder,
  notifyProviderToolFailure,
  type ProviderUsageContext,
} from "@/utils/provider/providerUsage";
/**
 * Peek Profile Picture Tool
 * Allows the AI to selectively process Discord user profile pictures on-demand
 * This prevents automatic processing and enables targeted avatar analysis
 */

import { GoogleGenAI } from "@google/genai";
import type { Part } from "@google/genai";
import { escapeMarkdown } from "discord.js";
import { log } from "../../utils/misc/logger";
import type { EnhancedImageContent } from "@/types/tool/enhancedContextTypes";
import { stashEnhancedContextItem } from "@/utils/chat/pendingEnhancedContext";
import { resolveAvatarByIdentity } from "@/utils/discord/avatarResolver";
import { sendToolProgressNotice } from "@/utils/discord/toolProgressNotice";
import { ZAI_CODING_CHAT_COMPLETIONS_URL, ZAI_GENERAL_CHAT_COMPLETIONS_URL } from "@/providers/zai/zaiShared";
import { BaseTool, type ToolContext, type ToolResult, type ToolParameterSchema } from "../../types/tool/interfaces";
import { ContextItemTag, type StructuredContextItem } from "../../types/misc/context";
import { ColorCode } from "@/utils/misc/logger";
import { llmModelRepo } from "@/utils/db/repositories";
import { getResolvedCapabilityModelId, resolveCapabilityCredentials } from "@/utils/provider/credentialResolver";
import { resolveVisionApiModelName } from "@/utils/provider/visionCaption";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";
import { readOpenRouterLimitError } from "@/providers/openrouter/openrouterLimit";
import { fetchWithProviderRequest } from "@/utils/provider/providerRequestHook";
import { normalizeProviderUsage, type TokenUsage } from "@/utils/text/tokenEstimate";

/**
 * Provider-to-chat-completions-URL mapping for OpenAI-compatible providers.
 * Google uses its own SDK and is handled separately.
 */
const PROVIDER_CHAT_COMPLETIONS_URLS: Record<string, string> = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  zai: ZAI_GENERAL_CHAT_COMPLETIONS_URL,
  zaicoding: ZAI_CODING_CHAT_COMPLETIONS_URL,
  deepseek: "https://api.deepseek.com/chat/completions",
};

/** Default prompt sent to the vision model when analyzing a profile picture */
const DEFAULT_AVATAR_ANALYSIS_PROMPT =
  "Describe this user's profile picture in detail. Include their appearance, style, and any notable elements visible in the avatar. If a profile banner is also provided, incorporate any useful supporting visual details from it.";

type PreparedProfileImage = {
  kind: "avatar" | "banner";
  label: string;
  base64Data: string;
};

/**
 * Tool for processing Discord user profile pictures on-demand
 * Available for providers with image processing capabilities
 */
export class PeekProfilePictureTool extends BaseTool {
  name = "peek_profile_picture";
  description =
    "Process and analyze a user's profile picture using AI vision capabilities. When available for Discord users, this also includes their profile banner as supporting visual context. ONLY use this when specifically asked to look at someone's avatar. The target may be 'self' for the current active persona, an exact persona nickname, or a natural user name from the current conversation or server. Deprecated raw IDs are still accepted at execution time for compatibility.";
  category = "utility" as const;
  requiresFollowUp = true;

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      target_identity: {
        type: "string",
        description:
          "The target identity to analyze. Accepts 'self', an exact persona nickname, or a natural user name from the current conversation or server. Deprecated raw IDs are still accepted at execution time for compatibility.",
      },
      reason: {
        type: "string",
        description:
          "Optional brief explanation of why you want to analyze this user's profile picture. This helps with debugging and understanding AI decision-making.",
      },
    },
    required: [],
  };

  /**
   * Check if profile picture tool is available for the given provider.
   * Availability is provider-agnostic; model vision support is handled by `isAvailableForContext()`.
   * @returns True (availability gated by isAvailableForContext)
   */
  isAvailableFor(_provider: string): boolean {
    return true;
  }

  /**
   * Enhanced availability check that considers context flags and model vision capabilities
   * @returns True if tool should be available
   */
  isAvailableForContext(provider: string, context?: ToolContext): boolean {
    // Base provider check
    if (!this.isAvailableFor(provider)) {
      return false;
    }

    if (!context?.tomoriState) {
      log.warn("PeekProfilePictureTool: No tomoriState in context, defaulting to unavailable");
      return false;
    }

    // A non-vision primary model with a vision_llm set will redirect analysis to
    // the vision model instead of using an enhanced context restart.
    const hasVision = context.tomoriState.llm.sees_images;
    const hasVisionModel = !!context.tomoriState.vision_llm || !!context.tomoriState.config.vision_llm_id;

    if (!hasVision && !hasVisionModel) {
      log.info(
        `PeekProfilePictureTool: Model ${context.tomoriState.llm.llm_codename} does not support vision and no vision model is configured. Tool disabled.`,
      );
      return false;
    }

    if (context?.streamContext?.disableProfilePictureProcessing) {
      log.info("PeekProfilePictureTool: Temporarily disabled during enhanced context restart");
      return false;
    }

    return true;
  }

  /**
   * Execute profile picture processing
   * @param args - Arguments containing target_identity and optional reason
   * @returns Promise resolving to tool result with processed image data
   */
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    if (context.streamContext?.disableProfilePictureProcessing) {
      log.info(
        "PeekProfilePictureTool: Execution blocked - Profile picture processing temporarily disabled during enhanced context restart",
      );
      return {
        success: false,
        error: "Profile picture processing is temporarily disabled",
        message: "Profile picture processing is temporarily disabled while analyzing another image.",
        data: {
          status: "temporarily_disabled",
          reason: "Enhanced context restart in progress",
        },
      };
    }

    const validation = this.validateParameters(args);
    if (!validation.isValid) {
      return {
        success: false,
        error: `Invalid parameters: ${validation.errors?.join(", ") || `Missing required parameters: ${validation.missingParams?.join(", ")}`}`,
        message: "The target_identity argument was missing or invalid.",
      };
    }

    const targetIdentity = (
      (args.target_identity as string | undefined) ?? (args.user_id as string | undefined)
    )?.trim();
    const reason = (args.reason as string) || "User-requested avatar analysis";

    if (!targetIdentity) {
      return {
        success: false,
        error: "Missing target identity",
        message: "Please provide target_identity with a user or persona name.",
        data: {
          status: "invalid_target_identity",
          reason: "The target_identity argument was missing or empty.",
        },
      };
    }

    const requestScope: [context?: ProviderUsageContext] = [];
    log.info(`Processing profile picture for identity: ${targetIdentity} - Reason: ${reason}`);

    try {
      const avatarData = await resolveAvatarByIdentity(targetIdentity, context, {
        forceStatic: true,
      });

      const preparedImages: PreparedProfileImage[] = [];
      if (avatarData.bannerUrl) {
        preparedImages.push({
          kind: "banner",
          label: "Profile banner",
          base64Data: await this.fetchAndConvertImageToBase64(avatarData.bannerUrl),
        });
      }

      preparedImages.push({
        kind: "avatar",
        label: "Profile picture",
        base64Data: await this.fetchAndConvertImageToBase64(avatarData.avatarUrl),
      });

      log.success(`Profile picture fetched for ${targetIdentity} (Username: ${avatarData.username})`);

      let userDisplayText = avatarData.username;
      if (avatarData.serverNickname) {
        userDisplayText += ` (Nickname: ${avatarData.serverNickname})`;
      }
      const targetTypeLabel =
        avatarData.sourceType === "persona" ? "persona" : avatarData.sourceType === "webhook" ? "webhook" : "user";

      // Non-vision redirect path: if the primary model cannot see images but a dedicated
      // vision model is configured, call the vision model directly with the avatar image
      // and return a text description. The primary model then responds to that description.
      if (!context.tomoriState.llm.sees_images && context.tomoriState.vision_llm) {
        return await this.redirectToVisionModel(
          preparedImages,
          targetTypeLabel,
          userDisplayText,
          reason,
          context,
          requestScope,
        );
      }

      // Enhanced context restart path: inject the raw image into the context so the
      // vision-capable primary model can see it directly on the next iteration.
      // Check if this is the bot's own profile picture (Discord user identity only)
      const isBotSelf =
        targetIdentity.toLowerCase() === "self" ||
        (avatarData.sourceType === "user" &&
          context.client.user &&
          avatarData.username.toLowerCase() === context.client.user.username.toLowerCase());
      const hasBanner = preparedImages.some((image) => image.kind === "banner");
      const contextText = isBotSelf
        ? hasBanner
          ? "[System: This message contains profile picture and profile banner content from a previous avatar analysis request you made for yourself]"
          : "[System: This message contains profile picture content from a previous avatar analysis request you made for yourself]"
        : hasBanner
          ? `[System: This message contains profile picture and profile banner content from a previous avatar analysis request you made for ${targetTypeLabel}: ${userDisplayText}]`
          : `[System: This message contains profile picture content from a previous avatar analysis request you made for ${targetTypeLabel}: ${userDisplayText}]`;

      // Special marker 'enhancedContext: true' indicates this should be processed by provider
      const imageContextItem: StructuredContextItem = {
        role: "user",
        metadataTag: ContextItemTag.DIALOGUE_HISTORY,
        parts: [
          {
            type: "text",
            text: contextText,
          },
          ...preparedImages.flatMap((image) => [
            {
              type: "text" as const,
              text: `${image.label}:`,
            },
            {
              type: "image" as const,
              uri: `data:image/png;base64,${image.base64Data}`,
              mimeType: "image/png",
              inlineData: {
                mimeType: "image/png",
                data: image.base64Data,
              },
              isProfilePicture: image.kind === "avatar",
              isProfileBanner: image.kind === "banner",
              enhancedContext: true, // Special marker for processing
            } as EnhancedImageContent,
          ]),
        ],
      };

      // The base64 payload rides the stash rather than `data` so it is not retained in
      // ToolRegistry's execution history; the tool loop swaps it back in on restart.
      const pendingContextKey = stashEnhancedContextItem(imageContextItem);

      return {
        success: true,
        message: `Profile picture analyzed for ${targetTypeLabel}: ${avatarData.username}. Image processing completed and ready for enhanced context restart.`,
        data: {
          type: "context_restart_with_image",
          pending_context_key: pendingContextKey,
          target_identity: targetIdentity,
          username: avatarData.username,
          avatar_url: avatarData.avatarUrl,
          banner_url: avatarData.bannerUrl ?? null,
          avatar_source: avatarData.sourceType,
          reason: reason,
          // Clean metadata only - no base64 data anywhere in response
          image_processed: true,
          banner_included: hasBanner,
          status: "completed",
          has_pending_context: true,
        },
      };
    } catch (error) {
      const denied = findProviderRequestDeniedError(error, ...requestScope);
      if (denied) return { success: false, error: await notifyProviderToolFailure(context, denied) };
      log.error(`Profile picture processing failed for identity: ${targetIdentity}`, error as Error);

      let errorMessage = "Failed to process the user's profile picture.";
      let errorStatus = "profile_processing_failed";

      if (error instanceof Error) {
        if (
          error.message.includes("No Discord user or webhook found") ||
          error.message.includes("No user found matching")
        ) {
          errorMessage = `No user or persona avatar matching "${targetIdentity}" was found. Please check the name and try again.`;
          errorStatus = "avatar_target_not_found";
        } else if (error.message.includes("Avatar image processing failed")) {
          errorMessage =
            "Failed to download and process the user's avatar image. The image may be corrupted or inaccessible.";
          errorStatus = "image_processing_failed";
        } else if (error.message.includes("Failed to fetch avatar image")) {
          errorMessage = "Could not download the avatar image from Discord's servers. Please try again later.";
          errorStatus = "image_fetch_failed";
        } else if (error.message.includes("Ambiguous avatar target")) {
          errorMessage = error.message;
          errorStatus = "ambiguous_target_identity";
        } else if (error.message.includes("bridge user")) {
          errorMessage = error.message;
          errorStatus = "unsupported_target_identity";
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred during profile picture processing",
        message: errorMessage,
        data: {
          status: errorStatus,
          target_identity: targetIdentity,
          reason: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Redirect profile picture analysis to the configured vision model.
   * Used when the primary chat model cannot see images but a vision_llm is configured.
   * Calls the vision model's API directly with the resolved profile images and returns a text description.
   * @param images - Base64-encoded profile image inputs
   * @param userDisplayText - Display name (with optional nickname)
   */
  private async redirectToVisionModel(
    images: PreparedProfileImage[],
    targetTypeLabel: string,
    userDisplayText: string,
    reason: string,
    context: ToolContext,
    requestScope: [context?: ProviderUsageContext],
  ): Promise<ToolResult> {
    const creds = await resolveCapabilityCredentials(context.tomoriState.server_id, "vision", {
      userId: context.internalUserId ?? null,
    });
    requestScope[0] = creds.usageContext;
    const visionLlmId = getResolvedCapabilityModelId(creds, "vision") ?? context.tomoriState.config.vision_llm_id;
    const visionLlm =
      visionLlmId === context.tomoriState.vision_llm?.llm_id
        ? context.tomoriState.vision_llm
        : visionLlmId
          ? await llmModelRepo.loadById(visionLlmId)
          : null;
    if (!visionLlm) {
      return {
        success: false,
        error: "No vision model configured. Use /model vision to set one.",
      };
    }

    await sendToolProgressNotice(
      context,
      "image_analysis",
      {
        titleKey: "tools.vision.analyzing_title",
        descriptionKey: "tools.vision.analyzing_description",
        descriptionVars: {
          model: escapeMarkdown(visionLlm.llm_codename),
        },
        footerKey: "tools.vision.analyzing_footer",
        color: ColorCode.INFO,
      },
      "PeekProfilePictureTool",
    );

    const apiKey = creds.apiKey;

    // Resolve API model name and provider from the vision LLM row
    const provider = visionLlm.llm_provider.toLowerCase();
    const apiModelName = resolveVisionApiModelName(provider, visionLlm.llm_codename);

    const hasBanner = images.some((image) => image.kind === "banner");
    const prompt = `${DEFAULT_AVATAR_ANALYSIS_PROMPT} This is the profile picture of ${targetTypeLabel}: ${userDisplayText}. Reason for analysis: ${reason}${hasBanner ? " A profile banner is also attached; use it as supporting context and describe any additional visual information it provides." : ""}`;

    log.info(
      `PeekProfilePictureTool: Redirecting avatar analysis to vision model ${provider}/${apiModelName} (primary model is non-vision)`,
    );

    // Route to the appropriate API based on provider family
    let analysisResult: string;

    if (provider === "google") {
      analysisResult = await this.callGoogleVisionWithBase64(apiKey, apiModelName, images, prompt);
    } else {
      const endpointUrl = this.getVisionEndpointUrl(provider, context, creds.customEndpoint?.endpoint_url ?? null);
      try {
        analysisResult = await withProviderUsageContext(creds.usageContext, async () =>
          this.callOpenAICompatibleVisionWithBase64(
            apiKey,
            apiModelName,
            endpointUrl,
            images,
            prompt,
            createProviderUsageRecorder(creds.usageContext, apiModelName),
          ),
        );
      } catch (error) {
        throw findProviderRequestDeniedError(error, creds.usageContext) ?? error;
      }
    }

    log.success(`PeekProfilePictureTool: Vision model analysis completed for ${targetTypeLabel}: ${userDisplayText}`);

    return {
      success: true,
      message: analysisResult,
      data: {
        type: "vision_model_redirect",
        target_type: targetTypeLabel,
        username: userDisplayText,
        vision_model: visionLlm.llm_codename,
        vision_provider: provider,
      },
    };
  }

  /**
   * Resolve the chat completions endpoint URL for a given provider.
   * @param context - Tool context (for custom endpoint URL)
   * @returns Chat completions URL
   */
  private getVisionEndpointUrl(provider: string, context: ToolContext, customEndpointUrl?: string | null): string {
    const knownUrl = PROVIDER_CHAT_COMPLETIONS_URLS[provider];
    if (knownUrl) return knownUrl;

    const customUrl = customEndpointUrl ?? context.tomoriState.config.custom_endpoint_url;
    if (customUrl) {
      return customUrl.endsWith("/chat/completions") ? customUrl : `${customUrl}/chat/completions`;
    }

    return "https://api.openai.com/v1/chat/completions";
  }

  /**
   * Call the Google GenAI vision API with one or more profile images.
   * @param model - Model name (e.g., "gemini-2.0-flash")
   * @param images - Base64-encoded profile image inputs
   */
  private async callGoogleVisionWithBase64(
    apiKey: string,
    model: string,
    images: PreparedProfileImage[],
    prompt: string,
  ): Promise<string> {
    const genAI = new GoogleGenAI({ apiKey });

    const parts: Part[] = [{ text: prompt }];

    for (const image of images) {
      parts.push({ text: `${image.label}:` });
      parts.push({
        inlineData: {
          data: image.base64Data,
          mimeType: "image/png",
        },
      });
    }

    const result = await genAI.models.generateContent({
      model,
      contents: [{ role: "user", parts }],
    });

    const text = result.text;
    if (!text) {
      throw new Error("Google Vision API returned an empty response.");
    }

    return text;
  }

  /**
   * Call an OpenAI-compatible vision API with one or more profile images.
   * @param endpointUrl - Chat completions endpoint URL
   * @param images - Base64-encoded profile image inputs
   */
  private async callOpenAICompatibleVisionWithBase64(
    apiKey: string,
    model: string,
    endpointUrl: string,
    images: PreparedProfileImage[],
    prompt: string,
    onUsage?: (usage: TokenUsage) => void,
  ): Promise<string> {
    const requestContent: Array<
      | { type: "text"; text: string }
      | {
          type: "image_url";
          image_url: {
            url: string;
          };
        }
    > = [{ type: "text", text: prompt }];

    for (const image of images) {
      requestContent.push({ type: "text", text: `${image.label}:` });
      requestContent.push({
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${image.base64Data}`,
        },
      });
    }

    const requestBody = {
      model,
      messages: [
        {
          role: "user",
          content: requestContent,
        },
      ],
      max_tokens: 1024,
    };

    const response = await fetchWithProviderRequest(
      endpointUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(endpointUrl === PROVIDER_CHAT_COMPLETIONS_URLS.openrouter && buildOpenRouterAttributionHeaders()),
        },
        body: JSON.stringify(requestBody),
      },
      fetchUserRemoteUrl,
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Vision API returned ${response.status}: ${errorText}`, {
        cause: readOpenRouterLimitError(response.status, response.headers, errorText) ?? undefined,
      });
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string };
      }>;
      usage?: unknown;
    };
    const usage = normalizeProviderUsage(data.usage);
    if (usage) onUsage?.(usage);

    const responseContent = data.choices?.[0]?.message?.content;
    if (!responseContent) {
      throw new Error("Vision API returned an empty response. The model may not support image inputs.");
    }

    return responseContent;
  }

  /**
   * Fetch avatar image from Discord CDN and convert to base64
   * @param avatarUrl - Discord avatar URL to fetch
   * @returns Promise resolving to base64 encoded image data
   */
  private async fetchAndConvertImageToBase64(avatarUrl: string): Promise<string> {
    try {
      // Data URIs (e.g. local preset avatars) are already base64-encoded, so decode directly.
      if (avatarUrl.startsWith("data:")) {
        const markerIndex = avatarUrl.indexOf("base64,");
        if (markerIndex === -1) {
          throw new Error("Avatar image processing failed: unsupported data URI format (no base64 payload)");
        }
        return avatarUrl.slice(markerIndex + "base64,".length).trim();
      }

      const response = await safeDownload(avatarUrl, {
        maxSizeMB: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB,
        timeoutMs: 15_000,
      });

      if (!response.success || !response.buffer) {
        throw new Error(`Failed to fetch avatar image: ${response.details ?? response.error ?? "unknown error"}`);
      }

      const base64String = response.buffer.toString("base64");

      return base64String;
    } catch (error) {
      log.error(`Failed to fetch and convert avatar image: ${avatarUrl}`, error as Error);

      if (error instanceof Error) {
        throw new Error(`Avatar image processing failed: ${error.message}`);
      }
      throw new Error("Unknown error occurred while processing avatar image");
    }
  }
}
