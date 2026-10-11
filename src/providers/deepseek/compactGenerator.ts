/**
 * Conversation compaction for the DeepSeek provider.
 *
 * - Plain-text conversation summaries via a direct POST to the DeepSeek
 *   chat-completions endpoint.
 * - Roleplay structured summaries delegated to callDeepseekStructuredJSON,
 *   which handles json_object mode + Zod validation.
 */
import { log } from "@/utils/misc/logger";
import { toDeepseekApiModelName } from "@/providers/deepseek/deepseekShared";
import type {
  CompactConversationResult,
  CompactRoleplayResult,
  ProviderCompactSummaryRequest,
  ProviderImageInput,
} from "@/types/provider/featureInterfaces";
import { callDeepseekStructuredJSON } from "@/providers/deepseek/deepseekStructuredOutput";
import { buildRoleplaySchema, CompactRoleplaySummarySchema } from "@/providers/utils/compactCommon";
import { fetchAndOptimizeImage } from "@/utils/image/imageProcessor";

const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";

type DeepseekContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

async function buildDeepseekUserContent(
  userPrompt: string,
  images?: ProviderImageInput[],
): Promise<string | DeepseekContentPart[]> {
  if (!images || images.length === 0) {
    return userPrompt;
  }

  const parts: DeepseekContentPart[] = [{ type: "text", text: userPrompt }];
  for (const image of images) {
    try {
      const optimized = await fetchAndOptimizeImage(image.url, image.mimeType);
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${optimized.mimeType};base64,${optimized.data}`,
        },
      });
    } catch (fetchError) {
      log.error(`Error fetching DeepSeek image ${image.name ?? image.url}`, fetchError as Error, {
        errorType: "DeepseekImageFetchError",
        metadata: {
          imageName: image.name ?? null,
          imageUrl: image.url,
        },
      });
    }
  }

  if (parts.length === 1) {
    return userPrompt;
  }

  return parts;
}

/**
 * Generate a plain-text conversation summary using the DeepSeek API.
 */
export async function generateConversationSummaryDeepseek(
  request: ProviderCompactSummaryRequest,
): Promise<CompactConversationResult> {
  try {
    if (!request.apiKey || request.apiKey.trim().length < 10) {
      return { error: "Invalid DeepSeek API key" };
    }

    const userContent = await buildDeepseekUserContent(request.userPrompt, request.images);

    const messages: Array<Record<string, unknown>> = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    messages.push({ role: "user", content: userContent });

    const body: Record<string, unknown> = {
      model: toDeepseekApiModelName(request.model),
      messages,
      max_tokens: 4096,
      stream: false,
      temperature: request.temperature ?? 0.7,
    };

    const endpointUrl = request.endpointUrl || DEEPSEEK_CHAT_COMPLETIONS_URL;

    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log.error("DeepSeek compact summary request failed", new Error(errorBody), {
        errorType: "DeepseekCompactHttpError",
        metadata: {
          model: request.model,
          status: response.status,
          errorBody,
        },
      });
      return {
        error: `DeepSeek request failed (${response.status}): ${response.statusText}`,
      };
    }

    const result = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = result.choices?.[0]?.message?.content;
    const responseText = typeof content === "string" ? content.trim() : "";

    if (!responseText) {
      return { error: "DeepSeek returned an empty response." };
    }

    return { summary: responseText };
  } catch (error) {
    log.error("DeepSeek compact summary failed", error as Error);
    return {
      error: error instanceof Error ? error.message : "Unknown DeepSeek error",
    };
  }
}

/**
 * Generate a structured roleplay summary using the DeepSeek API.
 *
 * Delegates to callDeepseekStructuredJSON, which uses json_object mode
 * with schema/example injected into the system prompt and Zod validation.
 */
export async function generateRoleplaySummaryDeepseek(
  request: ProviderCompactSummaryRequest,
): Promise<CompactRoleplayResult> {
  const result = await callDeepseekStructuredJSON(
    {
      apiKey: request.apiKey,
      model: request.model,
      systemPrompt: request.systemPrompt ?? "",
      userPrompt: request.userPrompt,
      temperature: request.temperature,
      schemaName: "roleplay_summary",
      images: request.images,
      endpointUrl: request.endpointUrl,
    },
    buildRoleplaySchema(),
    CompactRoleplaySummarySchema,
  );

  if (!result.success) {
    return { error: result.error };
  }

  return { summary: result.data };
}
