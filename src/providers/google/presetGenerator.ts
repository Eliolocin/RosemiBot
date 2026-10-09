/**
 * AI-Powered Preset Generation for TomoriBot
 * Uses a dual-agent approach: the provider's configured default handles Google
 * Search Grounding when web search is requested, then the user's configured model
 * generates the structured persona JSON.
 */

import { GoogleGenAI, type Content, type GenerateContentConfig } from "@google/genai";
import type { GeneratePresetParams, PresetGenerationResult } from "@/types/provider/featureInterfaces";
import { PRESET_MAX_STRING_LENGTH, type PresetExportData } from "../../types/preset/presetExport";
import { log } from "../../utils/misc/logger";
import { hasLocaleKey, localizer } from "../../utils/text/localizer";
import { formatProviderErrorCodeForDisplay } from "@/utils/provider/providerErrorClassification";
import { resolvePresetGenerationMaxOutputTokens } from "@/utils/provider/maxOutputTokens";
import { omitGeminiSampling } from "@/utils/provider/samplingControl";
import {
  buildPresetPrompt,
  extractPresetGenerationFields,
  presetGenerationFailureErrorType,
  presetGenerationFailureMessage,
} from "@/providers/utils/presetCommon";
export type {
  GeneratePresetParams,
  PresetGenerationResult,
} from "@/types/provider/featureInterfaces";

interface CharacterSearchContext {
  description?: string; // Character description from user
  speechExamples?: string; // How the character should speak
  additionalInstructions?: string; // Extra instructions
}

interface CharacterSearchResult {
  characterInfo?: string; // Found character information
  error?: string; // Error message if search failed
  errorType?:
    | "RATE_LIMIT"
    | "BLOCKED_CONTENT"
    | "API_KEY"
    | "CONNECTION"
    | "MODEL_ERROR"
    | "TIMEOUT"
    | "EMPTY_RESPONSE"
    | "UNKNOWN";
}

/**
 * Helper function to safely extract error message from unknown error types
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

function isGoogleModelUnavailableError(errorMessage: string): boolean {
  const normalizedMessage = errorMessage.toLowerCase();
  return (
    normalizedMessage.includes("model not found") ||
    normalizedMessage.includes("model_not_found") ||
    normalizedMessage.includes("no longer available")
  );
}

/**
 * Localized `/persona generate` failure text for a Google error. The raw message only selects the
 * billing variant: the reply is public, and an endpoint can echo the request key in its error body,
 * so callers log the upstream text instead.
 * @param errorCode - The Google API error code (e.g., "400", "429")
 * @param rawMessage - Raw error message from Google API, used for classification only
 */
function createGoogleErrorMessage(
  errorType: string,
  errorCode: string | number | undefined,
  rawMessage: string,
  locale: string,
): string {
  const displayCode = formatProviderErrorCodeForDisplay(errorCode);
  let messageKey: string;

  switch (errorType) {
    case "CONTENT_BLOCKED":
      messageKey = "content_blocked_default_message";
      break;
    case "RATE_LIMIT":
      messageKey = "429_default_message";
      break;
    case "TIMEOUT":
      messageKey = "504_default_message";
      break;
    case "API_KEY":
      messageKey = "403_default_message";
      break;
    case "MODEL_ERROR":
      messageKey = "404_default_message";
      break;
    case "CONNECTION":
      messageKey = "503_default_message";
      break;
    case "EMPTY_RESPONSE":
    case "INVALID_JSON":
    case "VALIDATION_ERROR":
      messageKey = "unknown_default_message";
      break;
    default:
      if (errorCode === 400 || errorCode === "400") {
        if (rawMessage.includes("billing")) {
          messageKey = "400_billing_default_message";
        } else {
          messageKey = "400_default_message";
        }
      } else if (hasLocaleKey("en-US", `genai.google.${displayCode}_default_message`)) {
        messageKey = `${displayCode}_default_message`;
      } else {
        messageKey = "unknown_default_message";
      }
      break;
  }

  return `Error Code ${displayCode}: ${localizer(locale, `genai.google.${messageKey}`)}`;
}

/**
 * Search for character information using Google Search
 * Uses configured Gemini model with Google Search tool enabled
 *
 * @param locale - User's locale for error messages
 * @param context - Optional additional context for search
 */
async function searchCharacterInfo(
  apiKey: string,
  characterName: string,
  locale: string,
  modelName: string,
  context?: CharacterSearchContext,
  client?: GoogleGenAI,
): Promise<CharacterSearchResult> {
  if (!client && (!apiKey || apiKey.trim().length < 10)) {
    return {
      error: createGoogleErrorMessage("API_KEY", 403, "Invalid API key", locale),
      errorType: "API_KEY",
    };
  }

  try {
    const genAI = client ?? new GoogleGenAI({ apiKey });

    const MODEL_NAME = modelName;

    // Configure generation with Google Search tool
    const generationConfig: GenerateContentConfig = {
      temperature: 1.0,
      topP: 0.9,
      maxOutputTokens: 4096,
      tools: [{ googleSearch: {} }], // Enable Google Search
    };

    let prompt = `You are a character information researcher. Search for detailed information about the character "${characterName}".

Search Instructions:
- Use Google Search to find comprehensive information about this character and their franchise
- Look for personality traits, background story, appearance, relationships, and speaking style
- Include sample dialogue lines from actual scenes if available, incorporating their speech quirks and catchphrases if applicable
- If you find the character, provide a detailed biography with sample dialogue examples from actual scenes of the character
- If this character doesn't exist or you can't find reliable information, respond with exactly "None found, this is an original character from the user"

Character Name: ${characterName}`;

    if (context?.description?.trim()) {
      prompt += `\n\nUser's Description: ${context.description.trim()}`;
    }

    if (context?.speechExamples?.trim()) {
      prompt += `\n\nUser's Speech Examples: ${context.speechExamples.trim()}`;
    }

    if (context?.additionalInstructions?.trim()) {
      prompt += `\n\nAdditional Context: ${context.additionalInstructions.trim()}`;
    }

    prompt += `\n\nProvide either:
1. A detailed character biography with sample dialogue lines (if character exists)
2. "None found, this is an original character from the user" (if character doesn't exist)

Focus on gathering authentic information that would help create an accurate character representation.

IMPORTANT: In any dialogue examples, use "{user}" ONLY where you would write the conversation partner's name (not for the pronoun "you"), and "{bot}" ONLY where you would write the character's own name (not for "I"/"me"). Keep ordinary pronouns like "you", "I", and "me" exactly as-is.`;

    const userPromptContent: Content = {
      role: "user",
      parts: [{ text: prompt }],
    };

    log.info(`Searching for character: ${characterName} using model: ${MODEL_NAME}`);

    try {
      // Create timeout promise (60 seconds for search)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Character search timed out after 60 seconds")), 60000);
      });

      const result = await Promise.race([
        genAI.models.generateContent({
          model: MODEL_NAME,
          contents: [userPromptContent],
          config: omitGeminiSampling(MODEL_NAME, generationConfig),
        }),
        timeoutPromise,
      ]);

      log.info(`Character search completed with model: ${MODEL_NAME}`);

      if (result.promptFeedback?.blockReason) {
        return {
          error: createGoogleErrorMessage(
            "BLOCKED_CONTENT",
            "BLOCKED",
            `Character search was blocked: ${result.promptFeedback.blockReason}`,
            locale,
          ),
          errorType: "BLOCKED_CONTENT",
        };
      }

      const responseText = result.text;

      if (!responseText || responseText.trim() === "") {
        return {
          error: createGoogleErrorMessage(
            "EMPTY_RESPONSE",
            undefined,
            "Character search returned an empty response",
            locale,
          ),
          errorType: "EMPTY_RESPONSE",
        };
      }

      log.success(`✨ Character search successful with model: ${MODEL_NAME}`);
      return { characterInfo: responseText.trim() };
    } catch (apiError: unknown) {
      log.warn("Google character search request failed", apiError as Error);
      const errorMessage = getErrorMessage(apiError);

      let errorCode: number | undefined;
      try {
        if (errorMessage.includes('{"error":')) {
          const jsonMatch = errorMessage.match(/\{.*\}/s);
          if (jsonMatch) {
            const parsedError = JSON.parse(jsonMatch[0]);
            errorCode = parsedError.error?.code || parsedError.code;
          }
        }
      } catch {}

      if (errorMessage.includes("timed out")) {
        return {
          error: createGoogleErrorMessage("TIMEOUT", 504, errorMessage, locale),
          errorType: "TIMEOUT",
        };
      }

      if (errorMessage.includes("RESOURCE_EXHAUSTED") || errorMessage.includes("rate limit")) {
        return {
          error: createGoogleErrorMessage("RATE_LIMIT", errorCode || 429, errorMessage, locale),
          errorType: "RATE_LIMIT",
        };
      }

      if (errorMessage.includes("INVALID_ARGUMENT") || errorMessage.includes("blocked")) {
        return {
          error: createGoogleErrorMessage("BLOCKED_CONTENT", errorCode || 400, errorMessage, locale),
          errorType: "BLOCKED_CONTENT",
        };
      }

      if (errorMessage.includes("PERMISSION_DENIED") || errorMessage.includes("API key")) {
        return {
          error: createGoogleErrorMessage("API_KEY", errorCode || 403, errorMessage, locale),
          errorType: "API_KEY",
        };
      }

      if (isGoogleModelUnavailableError(errorMessage)) {
        return {
          error: createGoogleErrorMessage("MODEL_ERROR", errorCode || 404, errorMessage, locale),
          errorType: "MODEL_ERROR",
        };
      }

      throw apiError;
    }
  } catch (error) {
    log.error("Character search error:", error);
    const errorMessage = getErrorMessage(error);

    if (error instanceof TypeError && errorMessage.includes("network")) {
      return {
        error: createGoogleErrorMessage("CONNECTION", 503, errorMessage, locale),
        errorType: "CONNECTION",
      };
    }

    return {
      error: createGoogleErrorMessage("UNKNOWN", undefined, errorMessage, locale),
      errorType: "UNKNOWN",
    };
  }
}

/**
 * Generate preset data from user prompts using Gemini with structured output
 * Uses single-agent approach for Gemini 3 models (with web search tools)
 * Uses dual-agent approach for other models (separate search + generation)
 *
 * @param locale - User's locale for error messages
 * @returns Promise<PresetGenerationResult> - Generated preset or error
 */
export async function generatePresetFromPrompt(
  apiKey: string,
  params: GeneratePresetParams,
  locale: string,
  client?: GoogleGenAI,
  defaultSearchModelName?: string,
): Promise<PresetGenerationResult> {
  if (!client && (!apiKey || apiKey.trim().length < 10)) {
    return {
      error: createGoogleErrorMessage("API_KEY", 403, "Invalid API key", locale),
      errorType: "API_KEY",
    };
  }

  try {
    const genAI = client ?? new GoogleGenAI({ apiKey });

    const configuredModel = params.modelName || defaultSearchModelName;
    if (!configuredModel) {
      return {
        error: createGoogleErrorMessage("MODEL_ERROR", 404, "No preset generation model is configured", locale),
        errorType: "MODEL_ERROR",
      };
    }

    const searchAgentModel = defaultSearchModelName || configuredModel;

    let searchInfo: string | undefined;
    if (params.useWebSearch) {
      log.info(`Running search sub-agent (${searchAgentModel}) for "${params.characterName}"`);

      const searchResult = await searchCharacterInfo(
        apiKey,
        params.characterName,
        locale,
        searchAgentModel,
        {
          description: params.characterDescription,
          speechExamples: params.speechExamples,
          additionalInstructions: params.additionalInstructions,
        },
        client,
      );

      // Propagate hard errors (API key, rate limit, etc.)
      if (searchResult.error) {
        return {
          error: searchResult.error,
          errorType: searchResult.errorType,
        };
      }

      searchInfo = searchResult.characterInfo;
      log.info("Search sub-agent completed, proceeding to generation");
    }

    // Set up generation model; always uses the user's configured model so
    //    free-tier users aren't silently upgraded to a paid model.
    let MODEL_NAME = configuredModel;
    const FALLBACK_MODEL = undefined;

    const maxPresetStringLength = PRESET_MAX_STRING_LENGTH;
    const responseJsonSchema = {
      type: "object" as const,
      properties: {
        attribute_list: {
          type: "array" as const,
          description: `Array containing exactly 6 items describing different facets of the character, in this exact order: 1) {bot}'s Description (core identity and essence), 2) {bot}'s Appearance (physical traits and style), 3) {bot}'s Personality (personality traits, comma-separated), 4) {bot}'s Likes (interests and preferences), 5) {bot}'s Dislikes (aversions and pet peeves), 6) {bot}'s Behavioral Quirks (unique mannerisms and patterns). Each item maximum ${maxPresetStringLength} characters, in this specific format per array item: "{bot}'s Description: "`,
          items: {
            type: "string" as const,
            maxLength: maxPresetStringLength,
          },
          minItems: 6,
          maxItems: 6,
        },
        sample_dialogues_in: {
          type: "array" as const,
          description: `Array of exactly 5 example user messages. MUST include these 3 guided scenarios in order: 1) Self-introduction request, 2) Emotional/personal scenario, 3) Practical/functional scenario. Then add 2 free dialogue scenarios that showcase unique character traits. Do NOT prepend with speaker names. Each message maximum ${maxPresetStringLength} characters.`,
          items: {
            type: "string" as const,
            maxLength: maxPresetStringLength,
          },
          minItems: 5,
          maxItems: 5,
        },
        sample_dialogues_out: {
          type: "array" as const,
          description: `Array of exactly 5 character responses paired with sample_dialogues_in. Should reflect the character's speaking style, personality, and demonstrate their full range across the 3 guided scenarios and 2 free scenarios. Do NOT prepend with speaker names. Each response maximum ${maxPresetStringLength} characters.`,
          items: {
            type: "string" as const,
            maxLength: maxPresetStringLength,
          },
          minItems: 5,
          maxItems: 5,
        },
      },
      required: ["attribute_list", "sample_dialogues_in", "sample_dialogues_out"],
    };

    const generationConfig: GenerateContentConfig = {
      temperature: 1.5, // Creative but controlled
      topP: 0.9,
      // The caller resolved this against the server's ceiling and the model's own limit, so
      // recomputing it here would silently ignore a cap the deployment set.
      maxOutputTokens: params.maxOutputTokens ?? resolvePresetGenerationMaxOutputTokens(),
      responseMimeType: "application/json",
      responseJsonSchema: responseJsonSchema,
    };

    // Google prefetches search results instead of exposing search tools, so the shared prompt
    // is told not to instruct the model to call tools it was not given.
    let prompt = buildPresetPrompt(params, { webSearchResultsProvided: true });

    if (searchInfo) {
      if (!searchInfo.includes("None found")) {
        prompt += `\n\nWeb Search Results (use this information to create an authentic character profile):
${searchInfo}

Use the web search information to accurately represent the character's personality, background, and speaking style from their source material.`;
      } else {
        prompt += `\n\nNote: This is an original character. Create a unique profile based on the provided description and image (if any).`;
      }
    }

    const promptParts: Array<{
      text?: string;
      inlineData?: { data: string; mimeType: string };
    }> = [{ text: prompt }];

    if (params.imageBase64 && params.imageMimeType) {
      promptParts.push({
        inlineData: {
          data: params.imageBase64,
          mimeType: params.imageMimeType,
        },
      });
      log.info("Image included in generation");
    }

    const userPromptContent: Content = {
      role: "user",
      parts: promptParts,
    };

    log.info(`Generating preset for: ${params.characterName}`);

    // Retry logic with fallback model (only for Gemini 3)
    let lastError: PresetGenerationResult | null = null;
    const modelsToTry = FALLBACK_MODEL ? [MODEL_NAME, FALLBACK_MODEL] : [MODEL_NAME];

    for (const currentModel of modelsToTry) {
      MODEL_NAME = currentModel;
      log.info(`Attempting preset generation with model: ${MODEL_NAME}`);

      try {
        // Create timeout promise (90 seconds for generation)
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Request timed out after 60 seconds")), 90000);
        });

        const result = await Promise.race([
          genAI.models.generateContent({
            model: MODEL_NAME,
            contents: [userPromptContent],
            config: omitGeminiSampling(MODEL_NAME, generationConfig),
          }),
          timeoutPromise,
        ]);

        log.info(`Preset generation completed with model: ${MODEL_NAME}`);

        if (result.promptFeedback?.blockReason) {
          lastError = {
            error: createGoogleErrorMessage(
              "BLOCKED_CONTENT",
              "BLOCKED",
              `Content was blocked by Gemini API safety filters: ${result.promptFeedback.blockReason}`,
              locale,
            ),
            errorType: "BLOCKED_CONTENT",
          };
          continue; // Try fallback model if available
        }

        const responseText = result.text;

        if (!responseText || responseText.trim() === "") {
          lastError = {
            error: createGoogleErrorMessage(
              "EMPTY_RESPONSE",
              undefined,
              "Gemini API returned an empty response. Try using different inputs or a different image.",
              locale,
            ),
            errorType: "EMPTY_RESPONSE",
          };
          continue; // Try fallback model if available
        }

        const decoded = extractPresetGenerationFields(responseText, JSON.parse, (parseError) =>
          log.error("Google preset generation response could not be parsed", parseError),
        );
        if (!decoded.ok) {
          const failureType = presetGenerationFailureErrorType(decoded.failure);
          log.error(`Google preset generation rejected: ${decoded.failure.code}`);
          lastError = {
            error: createGoogleErrorMessage(
              failureType,
              undefined,
              presetGenerationFailureMessage(decoded.failure),
              locale,
            ),
            errorType: failureType,
          };
          continue; // Try fallback model if available
        }

        const preset: PresetExportData = {
          tomori_nickname: params.characterName,
          trigger_words: [params.characterName],
          ...decoded.preset,
        };

        log.success(`Preset generation successful with model: ${MODEL_NAME}`);
        return { preset };
      } catch (apiError: unknown) {
        log.warn("Google preset generation request failed", apiError as Error);
        const errorMessage = getErrorMessage(apiError);

        let errorCode: number | undefined;
        try {
          if (errorMessage.includes('{"error":')) {
            const jsonMatch = errorMessage.match(/\{.*\}/s);
            if (jsonMatch) {
              const parsedError = JSON.parse(jsonMatch[0]);
              errorCode = parsedError.error?.code || parsedError.code;
            }
          }
        } catch {}

        if (errorMessage.includes("timed out")) {
          lastError = {
            error: createGoogleErrorMessage("TIMEOUT", 504, errorMessage, locale),
            errorType: "TIMEOUT",
          };
          continue; // Try fallback model if available
        }

        if (errorMessage.includes("RESOURCE_EXHAUSTED") || errorMessage.includes("rate limit")) {
          lastError = {
            error: createGoogleErrorMessage("RATE_LIMIT", errorCode || 429, errorMessage, locale),
            errorType: "RATE_LIMIT",
          };
          // Don't retry on rate limit
          return lastError;
        }

        if (errorMessage.includes("INVALID_ARGUMENT") || errorMessage.includes("blocked")) {
          lastError = {
            error: createGoogleErrorMessage("BLOCKED_CONTENT", errorCode || 400, errorMessage, locale),
            errorType: "BLOCKED_CONTENT",
          };
          continue; // Try fallback model if available
        }

        if (errorMessage.includes("PERMISSION_DENIED") || errorMessage.includes("API key")) {
          lastError = {
            error: createGoogleErrorMessage("API_KEY", errorCode || 403, errorMessage, locale),
            errorType: "API_KEY",
          };
          // Don't retry on auth error
          return lastError;
        }

        if (isGoogleModelUnavailableError(errorMessage)) {
          lastError = {
            error: createGoogleErrorMessage("MODEL_ERROR", errorCode || 404, errorMessage, locale),
            errorType: "MODEL_ERROR",
          };
          log.warn(`Model ${MODEL_NAME} not found, trying fallback...`);
          continue; // Try fallback model if available
        }

        throw apiError;
      }
    }

    if (lastError) {
      return lastError;
    }

    // Fallback error if no lastError was set (should never happen)
    return {
      error: createGoogleErrorMessage("UNKNOWN", undefined, "Preset generation failed with no error details", locale),
      errorType: "UNKNOWN",
    };
  } catch (error) {
    log.error("Preset generation error:", error);
    const errorMessage = getErrorMessage(error);

    if (error instanceof TypeError && errorMessage.includes("network")) {
      return {
        error: createGoogleErrorMessage("CONNECTION", 503, errorMessage, locale),
        errorType: "CONNECTION",
      };
    }

    return {
      error: createGoogleErrorMessage("UNKNOWN", undefined, errorMessage, locale),
      errorType: "UNKNOWN",
    };
  }
}
