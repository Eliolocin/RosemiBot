import { describe, expect, it } from "bun:test";
import { buildSeedDesignPrompt } from "@/providers/openrouter/openrouterSpeech";
import { findOpenRouterSpeechModel } from "@/providers/openrouter/openrouterSpeechModels";

describe("Seed design prompt", () => {
  it("composes the description, optional direction, and quoted script", () => {
    expect(buildSeedDesignPrompt("A warm, low voice", "Welcome back.")).toBe(
      'Speaker (A warm, low voice) says: "Welcome back."',
    );
    expect(buildSeedDesignPrompt("A warm, low voice", "Welcome back.", "sleepy and quiet")).toBe(
      'Speaker (A warm, low voice) says, sleepy and quiet: "Welcome back."',
    );
    expect(buildSeedDesignPrompt("A warm, low voice", "Welcome back.", "  ")).toBe(
      'Speaker (A warm, low voice) says: "Welcome back."',
    );
  });

  it("trims inputs and keeps the outer quotes unambiguous", () => {
    expect(buildSeedDesignPrompt("  A bright voice (a little nervous) ", '  She said "stay".  ', " softly ")).toBe(
      "Speaker (A bright voice (a little nervous)) says, softly: \"She said 'stay'.\"",
    );
  });
});

describe("OpenRouter speech model table", () => {
  it("normalizes lookups and returns null for unadmitted models", () => {
    expect(findOpenRouterSpeechModel("  ByteDance-Seed/Seed-Audio-1-0 ")).toEqual({
      shape: "design",
      promptCharacters: 2_048,
      scriptCharacters: 1_100,
    });
    expect(findOpenRouterSpeechModel("FISH-AUDIO/S2.1-PRO")).toEqual({ shape: "clone" });
    expect(findOpenRouterSpeechModel("fish-audio/s2-pro")).toBeNull();
  });
});
