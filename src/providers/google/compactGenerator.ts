import {
  GoogleGenAI,
  type Content,
  type GenerateContentConfig,
  type GoogleGenAI as GoogleGenAIType,
  type Part,
} from "@google/genai";
import type {
  CompactConversationResult,
  CompactRoleplayResult,
  ProviderCompactSummaryRequest as CompactSummaryRequest,
} from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { omitGeminiSampling } from "@/utils/provider/samplingControl";
import { fetchAndOptimizeImage } from "@/utils/image/imageProcessor";
import type { CompactRoleplaySummary } from "@/types/misc/compact";
export type {
  CompactConversationResult,
  CompactRoleplayResult,
  ProviderCompactSummaryRequest as CompactSummaryRequest,
} from "@/types/provider/featureInterfaces";

async function buildUserParts(userPrompt: string, images?: Array<{ url: string; mimeType?: string }>): Promise<Part[]> {
  const parts: Part[] = [{ text: userPrompt }];

  if (!images || images.length === 0) {
    return parts;
  }

  for (const image of images) {
    try {
      const optimized = await fetchAndOptimizeImage(image.url, image.mimeType || "image/png");
      parts.push({
        inlineData: {
          data: optimized.data,
          mimeType: optimized.mimeType,
        },
      });
    } catch (error) {
      log.warn(`Compact summary: failed to process image ${image.url}`, error as Error);
    }
  }

  return parts;
}

/**
 * @param client - Optional pre-built GoogleGenAI client (used by Vertex provider)
 */
export async function generateConversationSummaryGoogle(
  request: CompactSummaryRequest,
  client?: GoogleGenAIType,
): Promise<CompactConversationResult> {
  try {
    if (!client && (!request.apiKey || request.apiKey.trim().length < 10)) {
      return { error: "Invalid Google API key" };
    }

    const genAI = client ?? new GoogleGenAI({ apiKey: request.apiKey });
    const prompt = request.systemPrompt ? `${request.systemPrompt}\n\n${request.userPrompt}` : request.userPrompt;

    const parts = await buildUserParts(prompt, request.images);
    const contents: Content = { role: "user", parts };

    const generationConfig: GenerateContentConfig = omitGeminiSampling(request.model, {
      temperature: request.temperature ?? 0.7,
      maxOutputTokens: 4096,
    });

    const result = await genAI.models.generateContent({
      model: request.model,
      contents: [contents],
      config: generationConfig,
    });

    const responseText = result.text;
    if (!responseText || responseText.trim() === "") {
      return { error: "Empty response from Google" };
    }

    return { summary: responseText.trim() };
  } catch (error) {
    log.error("Compact summary (Google) failed", error as Error);
    return {
      error: error instanceof Error ? error.message : "Unknown Google error",
    };
  }
}

function buildRoleplaySchema() {
  return {
    type: "object" as const,
    properties: {
      overall_scene_summary: {
        type: "string" as const,
      },
      characters: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            name: { type: "string" as const },
            current_goals: { type: "string" as const },
            emotional_status: { type: "string" as const },
            physical_status: { type: "string" as const },
            appearance_clothing: { type: "string" as const },
            inventory: { type: "string" as const },
          },
          required: [
            "name",
            "current_goals",
            "emotional_status",
            "physical_status",
            "appearance_clothing",
            "inventory",
          ],
        },
      },
    },
    required: ["overall_scene_summary", "characters"],
  };
}

/**
 * Generate a roleplay summary using Google Gemini with structured output.
 *
 * @param client - Optional pre-built GoogleGenAI client (used by Vertex provider)
 */
export async function generateRoleplaySummaryGoogle(
  request: CompactSummaryRequest,
  client?: GoogleGenAIType,
): Promise<CompactRoleplayResult> {
  try {
    if (!client && (!request.apiKey || request.apiKey.trim().length < 10)) {
      return { error: "Invalid Google API key" };
    }

    const genAI = client ?? new GoogleGenAI({ apiKey: request.apiKey });
    const prompt = request.systemPrompt ? `${request.systemPrompt}\n\n${request.userPrompt}` : request.userPrompt;

    const parts = await buildUserParts(prompt, request.images);
    const contents: Content = { role: "user", parts };

    const generationConfig: GenerateContentConfig = omitGeminiSampling(request.model, {
      temperature: request.temperature ?? 0.7,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseJsonSchema: buildRoleplaySchema(),
    });

    const result = await genAI.models.generateContent({
      model: request.model,
      contents: [contents],
      config: generationConfig,
    });

    const responseText = result.text;
    if (!responseText || responseText.trim() === "") {
      return { error: "Empty response from Google" };
    }

    let parsed: CompactRoleplaySummary;
    try {
      parsed = JSON.parse(responseText) as CompactRoleplaySummary;
    } catch (parseError) {
      return {
        error: parseError instanceof Error ? parseError.message : "Invalid JSON response from Google",
      };
    }

    if (!parsed || typeof parsed.overall_scene_summary !== "string") {
      return { error: "Invalid roleplay summary format from Google" };
    }

    return { summary: parsed };
  } catch (error) {
    log.error("Roleplay compact summary (Google) failed", error as Error);
    return {
      error: error instanceof Error ? error.message : "Unknown Google error",
    };
  }
}
