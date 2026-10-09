import { describe, expect, it } from "bun:test";
import { geminiIgnoresSampling, omitGeminiSampling } from "@/utils/provider/samplingControl";

describe("Gemini fixed sampling", () => {
  it("drops sampling only from Gemini 3.6 onward", () => {
    for (const model of ["gemini-3.6-flash", "gemini-3.8-flash", "gemini-4-pro", "Gemini-3.7-Flash"]) {
      expect(geminiIgnoresSampling(model)).toBe(true);
    }
    for (const model of [
      "gemini-2.5-flash",
      "gemini-3-flash",
      "gemini-3.1-pro-preview",
      "gemini-3.5-flash-lite",
      "gemma-4-31b-it",
    ]) {
      expect(geminiIgnoresSampling(model)).toBe(false);
    }
  });

  it("strips temperature, topP, and topK while keeping the rest of the config", () => {
    const config = { temperature: 1, topP: 0.95, topK: 40, maxOutputTokens: 4096, stopSequences: [] };

    expect(omitGeminiSampling("gemini-3.8-flash", config)).toEqual({ maxOutputTokens: 4096, stopSequences: [] });
    expect(omitGeminiSampling("gemini-3.5-flash", config)).toEqual(config);
  });
});
