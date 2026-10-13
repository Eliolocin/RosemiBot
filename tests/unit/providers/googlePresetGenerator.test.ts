import { describe, expect, it } from "bun:test";
import type { GoogleGenAI } from "@google/genai";
import { generatePresetFromPrompt } from "@/providers/google/presetGenerator";
import { DEFAULT_PRESET_GENERATION_MAX_OUTPUT_TOKENS } from "@/utils/provider/maxOutputTokens";

describe("Google preset generation", () => {
  it("keeps the selected model for persona generation", async () => {
    const requestedModels: string[] = [];
    const response = JSON.stringify({
      attribute_list: ["a", "b", "c", "d", "e", "f"],
      sample_dialogues_in: ["a", "b", "c", "d", "e"],
      sample_dialogues_out: ["a", "b", "c", "d", "e"],
    });
    const client = {
      models: {
        generateContent: async ({ model }: { model: string }) => {
          requestedModels.push(model);
          return {
            text: requestedModels.length === 1 ? "None found, this is an original character from the user" : response,
          };
        },
      },
    } as unknown as GoogleGenAI;

    const result = await generatePresetFromPrompt(
      "test-api-key",
      {
        characterName: "Juno",
        characterDescription: "A helpful guide.",
        speechExamples: "Calm and clear.",
        useWebSearch: true,
        modelName: "selected-persona-model",
      },
      "en-US",
      client,
      "configured-google-default",
    );

    expect(result.error).toBeUndefined();
    expect(requestedModels).toEqual(["configured-google-default", "selected-persona-model"]);
  });

  it("classifies a retired Search grounding model as a model error", async () => {
    const client = {
      models: {
        generateContent: async () => {
          throw new Error(
            '{"error":{"code":404,"message":"This model models/gemini-old is no longer available to new users."}}',
          );
        },
      },
    } as unknown as GoogleGenAI;

    const result = await generatePresetFromPrompt(
      "test-api-key",
      {
        characterName: "Juno",
        characterDescription: "A helpful guide.",
        speechExamples: "Calm and clear.",
        useWebSearch: true,
        modelName: "selected-persona-model",
      },
      "en-US",
      client,
      "configured-provider-default",
    );

    expect(result.errorType).toBe("MODEL_ERROR");
    expect(result.error).toContain("Error Code 404");
  });

  it("replies with a localized summary, never the upstream message or an unrecognized code", async () => {
    const canary = "sk-live-CANARY0001";
    const client = {
      models: {
        generateContent: async () => {
          throw new Error(
            JSON.stringify({ error: { code: canary, message: `PERMISSION_DENIED for API key ${canary} <@&42>` } }),
          );
        },
      },
    } as unknown as GoogleGenAI;

    const result = await generatePresetFromPrompt(
      "test-api-key",
      {
        characterName: "Juno",
        characterDescription: "A helpful guide.",
        speechExamples: "Calm and clear.",
        useWebSearch: false,
        modelName: "selected-persona-model",
      },
      "en-US",
      client,
    );

    expect(result.errorType).toBe("API_KEY");
    expect(result.error).toContain("Error Code unknown");
    expect(result.error).not.toContain(canary);
    expect(result.error).not.toContain("<@&42>");
  });

  it("classifies a retired persona generation model as a model error", async () => {
    const client = {
      models: {
        generateContent: async () => {
          throw new Error(
            '{"error":{"code":404,"message":"This model models/gemini-old is no longer available to new users."}}',
          );
        },
      },
    } as unknown as GoogleGenAI;

    const result = await generatePresetFromPrompt(
      "test-api-key",
      {
        characterName: "Juno",
        characterDescription: "A helpful guide.",
        speechExamples: "Calm and clear.",
        useWebSearch: false,
        modelName: "retired-persona-model",
      },
      "en-US",
      client,
    );

    expect(result.errorType).toBe("MODEL_ERROR");
    expect(result.error).toContain("Error Code 404");
  });

  it("sends the vision caption to the model instead of dropping it", async () => {
    // Google once carried its own copy of the preset prompt, which silently discarded the
    // caption and generated a persona with neither the image nor a description of it.
    const prompts: string[] = [];
    const client = {
      models: {
        generateContent: async ({ contents }: { contents: unknown }) => {
          prompts.push(JSON.stringify(contents));
          return {
            text: JSON.stringify({
              attribute_list: ["a", "b", "c", "d", "e", "f"],
              sample_dialogues_in: ["a", "b", "c", "d", "e"],
              sample_dialogues_out: ["a", "b", "c", "d", "e"],
            }),
          };
        },
      },
    } as unknown as GoogleGenAI;

    const result = await generatePresetFromPrompt(
      "test-api-key",
      {
        characterName: "Juno",
        characterDescription: "A helpful guide.",
        speechExamples: "Calm and clear.",
        useWebSearch: false,
        modelName: "selected-persona-model",
        appearanceDescription: "Silver hair and a green coat.",
      },
      "en-US",
      client,
    );

    expect(result.error).toBeUndefined();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Appearance Observed In The Uploaded Image:");
    expect(prompts[0]).toContain("Silver hair and a green coat.");
  });

  it("requests the output budget the caller resolved", async () => {
    // The caller clamps this against the server's ceiling and the model's reported limit, so a
    // generator that recomputes it locally silently overrides a deployment's cap.
    const budgets: unknown[] = [];
    const client = {
      models: {
        generateContent: async ({ config }: { config?: { maxOutputTokens?: unknown } }) => {
          budgets.push(config?.maxOutputTokens);
          return {
            text: JSON.stringify({
              attribute_list: ["a", "b", "c", "d", "e", "f"],
              sample_dialogues_in: ["a", "b", "c", "d", "e"],
              sample_dialogues_out: ["a", "b", "c", "d", "e"],
            }),
          };
        },
      },
    } as unknown as GoogleGenAI;

    const result = await generatePresetFromPrompt(
      "test-api-key",
      {
        characterName: "Juno",
        characterDescription: "A helpful guide.",
        speechExamples: "Calm and clear.",
        useWebSearch: false,
        modelName: "selected-persona-model",
        maxOutputTokens: 4096,
      },
      "en-US",
      client,
    );

    expect(result.error).toBeUndefined();
    expect(budgets).toEqual([4096]);
  });

  it("falls back to the preset budget when the caller resolved none", async () => {
    const budgets: unknown[] = [];
    const client = {
      models: {
        generateContent: async ({ config }: { config?: { maxOutputTokens?: unknown } }) => {
          budgets.push(config?.maxOutputTokens);
          return {
            text: JSON.stringify({
              attribute_list: ["a", "b", "c", "d", "e", "f"],
              sample_dialogues_in: ["a", "b", "c", "d", "e"],
              sample_dialogues_out: ["a", "b", "c", "d", "e"],
            }),
          };
        },
      },
    } as unknown as GoogleGenAI;

    const result = await generatePresetFromPrompt(
      "test-api-key",
      {
        characterName: "Juno",
        characterDescription: "A helpful guide.",
        speechExamples: "Calm and clear.",
        useWebSearch: false,
        modelName: "selected-persona-model",
      },
      "en-US",
      client,
    );

    expect(result.error).toBeUndefined();
    expect(budgets).toEqual([DEFAULT_PRESET_GENERATION_MAX_OUTPUT_TOKENS]);
  });

  it("does not ask Google to call search tools it was never given", async () => {
    // Google prefetches search results, so the shared prompt must not also instruct the model
    // to use web search tools that are absent from this request.
    const prompts: string[] = [];
    const client = {
      models: {
        generateContent: async ({ contents }: { contents: unknown }) => {
          prompts.push(JSON.stringify(contents));
          return {
            text: JSON.stringify({
              attribute_list: ["a", "b", "c", "d", "e", "f"],
              sample_dialogues_in: ["a", "b", "c", "d", "e"],
              sample_dialogues_out: ["a", "b", "c", "d", "e"],
            }),
          };
        },
      },
    } as unknown as GoogleGenAI;

    await generatePresetFromPrompt(
      "test-api-key",
      {
        characterName: "Juno",
        characterDescription: "A helpful guide.",
        speechExamples: "Calm and clear.",
        useWebSearch: true,
        modelName: "selected-persona-model",
      },
      "en-US",
      client,
    );

    const generationPrompt = prompts[prompts.length - 1];
    expect(generationPrompt).not.toContain("Web Search Instructions:");
    expect(generationPrompt).not.toContain("web search tools");
  });
});
