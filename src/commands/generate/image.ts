/**
 * Image Generation Command
 * Allows users to generate AI images using the configured provider
 * Supports manual prompting and automatic scene visualization
 * Supports text-to-image and image-to-image generation with up to 3 reference images
 * (Discord modal limit: 5 components total)
 */

import {
  MessageFlags,
  TextInputStyle,
  EmbedBuilder,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
  type APIAttachment,
} from "discord.js";
import { GoogleGenAI } from "@google/genai";
import { log, ColorCode } from "../../utils/misc/logger";
import { localizer } from "../../utils/text/localizer";
import { personaRepository, llmModelRepo, statRepository } from "@/utils/db/repositories";
import { replyInfoEmbed, promptWithRawModal } from "../../utils/discord/interactionHelper";
import type { UserRow } from "../../types/db/schema";
import { checkImageQuota, incrementImageQuota } from "../../utils/quota/imageQuotaManager";
import { getProviderDisplayName, resolveProviderFeatureImplementation } from "@/utils/provider/providerInfoRegistry";
import { resolveNativeImageGenerationCapability } from "@/utils/provider/providerCapabilityResolver";
import { ZAI_CODING_IMAGES_GENERATIONS_URL, ZAI_GENERAL_IMAGES_GENERATIONS_URL } from "@/providers/zai/zaiShared";
import { generateCustomImageViaEndpoint } from "@/providers/custom/customEndpointDispatcher";
import {
  CredentialUnavailableError,
  PersonalProviderRequiredError,
  getResolvedCapabilityModelId,
  resolveCapabilityCredentials,
} from "@/utils/provider/credentialResolver";
import { applyPersonalProviderSelectionsToTomoriState } from "@/utils/provider/personalProviderRuntime";
import { formatCustomModelDisplay } from "@/utils/provider/customProviderUtils";
import { generateOpenRouterImage } from "@/providers/openrouter/openrouterImageGeneration";
import { buildGeminiImagePromptParts } from "@/providers/utils/geminiImageParts";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";
import { executeAutoImageCommand } from "@/utils/image/autoImageCommand";
import { prepareGeneratedImage } from "@/utils/image/generatedImageMetadata";
import { buildImageGenerationInputAttachment } from "@/utils/image/imageGenerationInput";
import { localizedStatusTitle } from "@/utils/discord/ui/statusTitle";

const MODAL_CUSTOM_ID = "generate_image_modal";
const PROMPT_INPUT_ID = "prompt_input";
const ASPECT_RATIO_SELECT_ID = "aspect_ratio_select";
const REFERENCE_IMAGE_INPUT_IDS = ["image_upload_1", "image_upload_2", "image_upload_3"] as const;

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("image")
    .setDescription(localizer("en-US", "commands.generate.image.description"))
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription(localizer("en-US", "commands.generate.image.mode_description"))
        .setRequired(true)
        .addChoices(
          { name: localizer("en-US", "commands.generate.image.mode_choice_manual"), value: "manual" },
          { name: localizer("en-US", "commands.generate.image.mode_choice_auto"), value: "auto" },
        ),
    );

/**
 * @param diffusionModelId - Database ID of the diffusion model
 */
async function getDiffusionModelCodename(diffusionModelId: number): Promise<string> {
  const model = await llmModelRepo.loadDiffusionModelById(diffusionModelId);

  if (!model) {
    throw new Error(`Diffusion model not found: ${diffusionModelId}`);
  }

  return model.codename;
}

/**
 * Convert a Discord attachment to base64 format for image generation API
 * @returns Object with mimeType and base64 data
 */
async function convertAttachmentToBase64(attachment: APIAttachment): Promise<{ mimeType: string; data: string }> {
  if (!attachment.content_type?.startsWith("image/")) {
    throw new Error(`Invalid image type: ${attachment.content_type}`);
  }

  const downloadResult = await safeDownload(attachment.url, {
    maxSizeMB: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB,
    timeoutMs: 10_000,
    knownSize: attachment.size,
  });
  if (!downloadResult.success || !downloadResult.buffer) {
    throw new Error(`Failed to fetch image: ${downloadResult.details ?? downloadResult.error ?? "unknown error"}`);
  }

  const base64Data = downloadResult.buffer.toString("base64");

  log.info(`Converted attachment ${attachment.id} (${attachment.filename}) to base64`);

  return {
    mimeType: attachment.content_type,
    data: base64Data,
  };
}

type ImageCredentials = Awaited<ReturnType<typeof resolveCapabilityCredentials>>;

type StandardImageRoute =
  | { kind: "custom"; endpoint: NonNullable<ImageCredentials["customEndpoint"]> }
  | { kind: "native"; provider: NonNullable<Awaited<ReturnType<typeof resolveNativeImageGenerationCapability>>> }
  | { kind: "openrouter" | "google" | "zai" | "nvidia" };

/**
 * Picks the transport that runs a standard image request, or null when the provider has none.
 *
 * The pre-modal refusal and the modal-submit dispatcher both switch on this one value, so a
 * provider cannot pass the check and then reach a dispatcher branch that does not exist.
 */
async function resolveStandardImageRoute(creds: ImageCredentials): Promise<StandardImageRoute | null> {
  if (creds.customEndpoint) {
    return { kind: "custom", endpoint: creds.customEndpoint };
  }
  if (creds.provider === "vertex" || creds.provider === "vertexexpress") {
    const provider = await resolveNativeImageGenerationCapability(creds.provider);
    if (provider) {
      return { kind: "native", provider };
    }
  }
  const implementation = resolveProviderFeatureImplementation(creds.provider, "imageGeneration");
  switch (implementation) {
    case "openrouter":
    case "google":
    case "zai":
    case "nvidia":
      return { kind: implementation };
    default:
      return null;
  }
}

/**
 * Execute the image generation command
 */
export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const mode = interaction.options.getString("mode", true);
  if (mode === "auto") {
    await executeAutoImageCommand(client, interaction, userData, locale);
    return;
  }

  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const serverId = interaction.guild?.id ?? interaction.user.id;
  const baseTomoriState = await personaRepository.loadState(serverId);

  if (!baseTomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { tomoriState } = await applyPersonalProviderSelectionsToTomoriState(baseTomoriState, userData.user_id ?? null);

  if (!tomoriState.config.imagegen_enabled) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.generate.image.disabled_title",
      descriptionKey: "commands.generate.image.disabled_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let imageCreds: Awaited<ReturnType<typeof resolveCapabilityCredentials>>;
  try {
    imageCreds = await resolveCapabilityCredentials(tomoriState.server_id, "image-standard", {
      userId: userData.user_id ?? null,
    });
  } catch (error) {
    if (error instanceof PersonalProviderRequiredError) {
      log.warn(`[Generate Image] Personal provider required for image generation`, error, {
        userId: userData.user_id,
        serverId: tomoriState.server_id,
        personaId: tomoriState.persona_id,
        metadata: {
          command: "generate image",
        },
      });
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.personal_provider_required_title",
        descriptionKey: "general.errors.personal_provider_required_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (error instanceof CredentialUnavailableError) {
      log.warn(
        `[Generate Image] Image credentials unavailable: source=${error.source}, reason=${error.reason}`,
        error,
        {
          userId: userData.user_id,
          serverId: tomoriState.server_id,
          personaId: tomoriState.persona_id,
          metadata: {
            command: "generate image",
            source: error.source,
            reason: error.reason,
          },
        },
      );
      if (error.source === "personal") {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.personal_provider_credentials_error_title",
          descriptionKey: "general.errors.personal_provider_credentials_error_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (error.reason === "missing_model_id") {
        if (error.provider === "novelai" || tomoriState.llm.llm_provider.toLowerCase() === "novelai") {
          await replyInfoEmbed(interaction, locale, {
            titleKey: "commands.generate.image.novelai_redirect_title",
            descriptionKey: "commands.generate.image.novelai_redirect_description",
            color: ColorCode.INFO,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.generate.image.no_diffusion_model_title",
          descriptionKey: "commands.generate.image.no_diffusion_model_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.generate.image.no_api_key_title",
        descriptionKey: "commands.generate.image.no_api_key_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    throw error;
  }

  const diffusionModelId =
    getResolvedCapabilityModelId(imageCreds, "image-standard") ?? tomoriState.config.diffusion_model_id;
  if (!diffusionModelId) {
    log.warn(`[Generate Image] No diffusion model configured for server ${tomoriState.server_id}`, undefined, {
      userId: userData.user_id,
      serverId: tomoriState.server_id,
      personaId: tomoriState.persona_id,
      metadata: {
        command: "generate image",
      },
    });
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.generate.image.no_diffusion_model_title",
      descriptionKey: "commands.generate.image.no_diffusion_model_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const apiKey = imageCreds.apiKey;
  const executionProvider = imageCreds.provider;

  const imageRoute = await resolveStandardImageRoute(imageCreds);
  if (!imageRoute) {
    if (executionProvider === "novelai") {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.generate.image.novelai_redirect_title",
        descriptionKey: "commands.generate.image.novelai_redirect_description",
        color: ColorCode.INFO,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.generate.image.unsupported_provider_title",
      descriptionKey: "commands.generate.image.unsupported_provider_description",
      descriptionVars: { provider: getProviderDisplayName(executionProvider) },
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check image generation quota BEFORE showing modal (personal-provider users bypass quota)
  if (imageCreds.source === "server") {
    const quotaCheck = await checkImageQuota(tomoriState.server_id, interaction.user.id);

    if (!quotaCheck.allowed) {
      const errorTitleKey = "commands.generate.image.quota_exceeded_title";
      let errorDescriptionKey = "commands.generate.image.quota_exceeded_description";
      const descriptionVars: Record<string, string> = {};

      if (quotaCheck.resetTime) {
        const now = new Date();
        const resetTime = quotaCheck.resetTime;
        const hoursUntilReset = Math.ceil((resetTime.getTime() - now.getTime()) / (1000 * 60 * 60));

        if (hoursUntilReset < 24) {
          descriptionVars.reset_info = localizer(locale, "commands.generate.image.quota_resets_in_hours", {
            hours: hoursUntilReset.toString(),
          });
        } else {
          const daysUntilReset = Math.ceil(hoursUntilReset / 24);
          descriptionVars.reset_info = localizer(locale, "commands.generate.image.quota_resets_in_days", {
            days: daysUntilReset.toString(),
          });
        }
      }

      if (quotaCheck.reason === "user_quota_exceeded") {
        errorDescriptionKey = "commands.generate.image.user_quota_exceeded_description";
      } else if (quotaCheck.reason === "serverwide_quota_exceeded") {
        errorDescriptionKey = "commands.generate.image.serverwide_quota_exceeded_description";
      }

      await replyInfoEmbed(interaction, locale, {
        titleKey: errorTitleKey,
        descriptionKey: errorDescriptionKey,
        descriptionVars,
        footerKey: "commands.generate.image.quota_exceeded_footer",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  // Track modal submit interaction for error handling in catch block
  let modalSubmitInteraction: import("discord.js").ModalSubmitInteraction | undefined;
  let submittedInput: { prompt: string; aspectRatio: string; referenceFilenames: string[] } | undefined;
  const recoveryOptions = () =>
    submittedInput
      ? {
          footerKey: "commands.generate.image.recovery_file_footer",
          files: [buildImageGenerationInputAttachment(locale, { kind: "standard", ...submittedInput })],
        }
      : {};

  try {
    const modalComponents = [
      {
        customId: PROMPT_INPUT_ID,
        labelKey: "commands.generate.image.modal.prompt_label",
        descriptionKey: "commands.generate.image.modal.prompt_description",
        placeholder: "commands.generate.image.modal.prompt_placeholder",
        required: true,
        style: TextInputStyle.Paragraph,
        maxLength: 2000,
      },
      {
        customId: REFERENCE_IMAGE_INPUT_IDS[0],
        labelKey: "commands.generate.image.modal.image_upload_label",
        descriptionKey: "commands.generate.image.modal.image_upload_description",
        minValues: 0,
        maxValues: 1,
        required: false,
      },
      {
        customId: REFERENCE_IMAGE_INPUT_IDS[1],
        labelKey: "commands.generate.image.modal.image_upload_2_label",
        descriptionKey: "commands.generate.image.modal.image_upload_description",
        minValues: 0,
        maxValues: 1,
        required: false,
      },
      {
        customId: REFERENCE_IMAGE_INPUT_IDS[2],
        labelKey: "commands.generate.image.modal.image_upload_3_label",
        descriptionKey: "commands.generate.image.modal.image_upload_description",
        minValues: 0,
        maxValues: 1,
        required: false,
      },
      {
        kind: "radioGroup" as const,
        customId: ASPECT_RATIO_SELECT_ID,
        labelKey: "commands.generate.image.modal.aspect_ratio_label",
        descriptionKey: "commands.generate.image.modal.aspect_ratio_description",
        required: true,
        options: [
          { label: "1:1 (Square)", value: "1:1" },
          { label: "2:3 (Portrait)", value: "2:3" },
          { label: "3:2 (Landscape)", value: "3:2" },
          { label: "3:4 (Portrait)", value: "3:4" },
          { label: "4:3 (Landscape)", value: "4:3" },
          { label: "4:5 (Portrait)", value: "4:5" },
          { label: "5:4 (Landscape)", value: "5:4" },
          { label: "9:16 (Mobile Portrait)", value: "9:16" },
          { label: "16:9 (Widescreen)", value: "16:9" },
          { label: "21:9 (Ultra-wide)", value: "21:9" },
        ],
      },
    ];

    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.generate.image.modal.title",
        components: modalComponents,
      },
      true, // Auto-defer with public reply
    );

    if (modalResult.outcome !== "submit") {
      log.info(`Generate image modal ${modalResult.outcome}`);
      return;
    }

    modalSubmitInteraction = modalResult.interaction;
    const prompt = modalResult.values?.[PROMPT_INPUT_ID];
    const aspectRatio = modalResult.values?.[ASPECT_RATIO_SELECT_ID];
    const imageAttachments = REFERENCE_IMAGE_INPUT_IDS.map((customId) => modalResult.attachments?.[customId]).filter(
      (attachment): attachment is APIAttachment => Boolean(attachment),
    );

    if (!modalSubmitInteraction || !prompt || !aspectRatio) {
      log.error("Modal result unexpectedly missing required values");
      return;
    }
    submittedInput = {
      prompt,
      aspectRatio,
      referenceFilenames: imageAttachments.map((attachment) => attachment.filename),
    };

    const referenceImages: Array<{ mimeType: string; data: string }> = [];
    let referenceImageUrl: string | undefined;

    for (const imageAttachment of imageAttachments) {
      try {
        log.info(`Processing uploaded reference image: ${imageAttachment.filename}`);
        const converted = await convertAttachmentToBase64(imageAttachment);
        referenceImages.push(converted);
        if (!referenceImageUrl) {
          referenceImageUrl = imageAttachment.url; // Use first reference for thumbnail
        }
      } catch (error) {
        log.warn(`Failed to process attachment ${imageAttachment.id}:`, error as Error);

        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.generate.image.invalid_image_title",
          descriptionKey: "commands.generate.image.invalid_image_description",
          color: ColorCode.ERROR,
          ...recoveryOptions(),
        });
        return;
      }
    }

    if (referenceImages.length > 0) {
      log.info(`Successfully processed ${referenceImages.length} reference image(s)`);
    }

    const modelCodename = await getDiffusionModelCodename(diffusionModelId);
    const displayModelName = imageCreds.customEndpoint
      ? formatCustomModelDisplay(imageCreds.customEndpoint)
      : modelCodename;

    log.info(
      `Generating image with ${executionProvider} via ${displayModelName}: "${prompt.substring(0, 100)}${prompt.length > 100 ? "..." : ""}" (aspect ratio: ${aspectRatio}, references: ${referenceImages.length})`,
    );

    const startTime = performance.now();

    let generatedImageData: string | null = null;
    if (imageRoute.kind === "custom") {
      const result = await generateCustomImageViaEndpoint({
        endpoint: imageRoute.endpoint,
        apiKey,
        prompt,
        aspectRatio,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      });
      generatedImageData = result.imageData;
    } else if (imageRoute.kind === "native") {
      const result = await imageRoute.provider.generateNativeImage({
        apiKey,
        model: modelCodename,
        prompt,
        aspectRatio,
        ...(referenceImages.length > 0 ? { referenceImages } : {}),
      });
      generatedImageData = result.imageData;
    } else if (imageRoute.kind === "openrouter") {
      const result = await generateOpenRouterImage({
        apiKey,
        modelCodename,
        prompt,
        aspectRatio,
        ...(referenceImages.length > 0 ? { referenceImages } : {}),
      });
      generatedImageData = result.imageData;
    } else if (imageRoute.kind === "google") {
      const ai = new GoogleGenAI({ apiKey });
      const chat = ai.chats.create({
        model: modelCodename,
      });

      const messageParts = buildGeminiImagePromptParts(prompt, referenceImages);

      const response = await chat.sendMessage({
        message: messageParts,
        config: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: aspectRatio,
          },
        },
      });

      if (response?.candidates && response.candidates.length > 0 && response.candidates[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            generatedImageData = part.inlineData.data ?? null;
            break;
          }
        }
      }
    } else if (imageRoute.kind === "zai") {
      if (referenceImages.length > 0) {
        await interaction.followUp({
          content: localizer(locale, "commands.generate.image.zai_no_img2img_warning"),
        });
      }
      const { generateZaiNativeImage } = await import("@/providers/zai/zaiImageGeneration");
      const result = await generateZaiNativeImage({
        apiKey,
        model: modelCodename,
        prompt,
        aspectRatio,
        endpointUrl:
          executionProvider === "zaicoding" ? ZAI_CODING_IMAGES_GENERATIONS_URL : ZAI_GENERAL_IMAGES_GENERATIONS_URL,
      });
      generatedImageData = result.imageData;
    } else {
      if (referenceImages.length > 0) {
        await interaction.followUp({
          content: localizer(locale, "commands.generate.image.nvidia_no_img2img_warning"),
        });
      }
      const { generateNvidiaNativeImage } = await import("@/providers/nvidia/nvidiaImageGeneration");
      const result = await generateNvidiaNativeImage({
        apiKey,
        model: modelCodename,
        prompt,
        aspectRatio,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      });
      generatedImageData = result.imageData;
    }

    const endTime = performance.now();
    const generationTimeSeconds = ((endTime - startTime) / 1000).toFixed(1);

    if (!generatedImageData) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.generate.image.error_generation_failed_title",
        descriptionKey: "commands.generate.image.error_generation_failed_description",
        descriptionVars: { error: "No image data received from API" },
        color: ColorCode.ERROR,
        ...recoveryOptions(),
      });
      return;
    }

    const preparedImage = await prepareGeneratedImage(
      Buffer.from(generatedImageData, "base64"),
      prompt,
      locale,
      undefined,
      modalSubmitInteraction.attachmentSizeLimit,
    );
    const filename = `generated_${Date.now()}.${preparedImage.extension}`;
    const attachment = new AttachmentBuilder(preparedImage.buffer, { name: filename });

    // Increment quota after successful generation (server providers only)
    if (imageCreds.source === "server") {
      await incrementImageQuota(tomoriState.server_id, interaction.user.id);
    }
    // Record canonical generation telemetry; quota tables enforce limits only.
    if (userData.user_id) {
      statRepository.recordStat({
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        lineageId: tomoriState.persona_lineage_id ?? 0,
        metric: "image_generated",
        // Key by model codename so the read layer can break generations down by
        // model (the total stays SUM(count) over keys); this dimension can't be
        // reconstructed after the fact.
        metricKey: modelCodename,
      });
    }

    const successEmbed = new EmbedBuilder()
      .setTitle(localizedStatusTitle(locale, "commands.generate.image.success_title", ColorCode.SUCCESS))
      .setColor(ColorCode.SUCCESS)
      .setImage(`attachment://${filename}`)
      .setFooter({
        text: localizer(
          locale,
          preparedImage.promptAttachment
            ? "commands.generate.image.prompt_attached_footer"
            : "commands.generate.image.prompt_embedded_footer",
        ),
      })
      .addFields([
        {
          name: localizer(locale, "commands.generate.image.field_model"),
          value: displayModelName,
          inline: true,
        },
        {
          name: localizer(locale, "commands.generate.image.field_generation_time"),
          value: `${generationTimeSeconds}s`,
          inline: true,
        },
        {
          name: localizer(locale, "commands.generate.image.field_aspect_ratio"),
          value: aspectRatio,
          inline: true,
        },
      ]);

    if (referenceImageUrl) {
      successEmbed.setThumbnail(referenceImageUrl);
    }

    await modalSubmitInteraction.editReply({
      embeds: [successEmbed],
      files: preparedImage.promptAttachment ? [attachment, preparedImage.promptAttachment] : [attachment],
    });

    log.success(`Successfully generated and sent image (${generationTimeSeconds}s)`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    log.error("Image generation failed:", error as Error);

    // Use modalSubmitInteraction if available (error after modal), otherwise interaction (error during modal)
    const replyTarget = modalSubmitInteraction ?? interaction;

    const isPersonalImage = imageCreds?.source === "personal";

    if (
      errorMessage.includes("billing") ||
      errorMessage.includes("payment") ||
      errorMessage.includes("quota") ||
      errorMessage.includes("PERMISSION_DENIED")
    ) {
      const tipKeys = isPersonalImage
        ? ["genai.tips.top_up_provider_balance", "genai.tips.disable_personal_text_override"]
        : ["genai.tips.wait_and_retry"];
      await replyInfoEmbed(replyTarget, locale, {
        titleKey: "commands.generate.image.error_billing_title",
        descriptionKey: "commands.generate.image.error_billing_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
        tipKeys,
        ...recoveryOptions(),
      });
      return;
    }

    if (errorMessage.includes("safety") || errorMessage.includes("blocked") || errorMessage.includes("RECITATION")) {
      await replyInfoEmbed(replyTarget, locale, {
        titleKey: "commands.generate.image.error_safety_title",
        descriptionKey: "commands.generate.image.error_safety_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
        tipKeys: ["genai.tips.shorten_message"],
        ...recoveryOptions(),
      });
      return;
    }

    const tipKeys = isPersonalImage
      ? ["genai.tips.disable_personal_text_override", "genai.tips.switch_model_provider_personal"]
      : ["genai.tips.wait_and_retry"];
    await replyInfoEmbed(replyTarget, locale, {
      titleKey: "commands.generate.image.error_generation_failed_title",
      descriptionKey: "commands.generate.image.error_generation_failed_description",
      descriptionVars: { error: errorMessage },
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
      tipKeys,
      ...recoveryOptions(),
    });
  }
}
