import { describe, expect, it } from "bun:test";
import { normalizeProviderUsage, sumTurnUsage, type TokenUsage } from "@/utils/text/tokenEstimate";

describe("normalizeProviderUsage", () => {
  it("preserves finite nonnegative costs and discards invalid costs without dropping tokens", () => {
    for (const cost of [0, 0.0012, -1, Number.NaN, Number.POSITIVE_INFINITY, "0.0012", null]) {
      const raw = { prompt_tokens: 10, completion_tokens: 5, cost };
      const usage = normalizeProviderUsage(raw);
      expect(usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
      expect(usage?.costUsd).toBe(typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : undefined);
    }
  });

  it("normalizes OpenAI-compatible snake_case usage", () => {
    // The shape openaiCompatibleStreamAdapter stores in metadata.usage.
    const usage = normalizeProviderUsage({ prompt_tokens: 1200, completion_tokens: 340, total_tokens: 1540 });
    expect(usage).toEqual({ inputTokens: 1200, outputTokens: 340 });
  });

  it("normalizes OpenRouter camelCase usage", () => {
    // OpenRouter's adapter normalizes to camelCase before storing it.
    const usage = normalizeProviderUsage({ promptTokens: 800, completionTokens: 95, totalTokens: 895 });
    expect(usage).toEqual({ inputTokens: 800, outputTokens: 95 });
  });

  it("normalizes Anthropic flat input/output token metadata", () => {
    // Anthropic's adapter emits a normalized { inputTokens, outputTokens } usage.
    const usage = normalizeProviderUsage({ inputTokens: 500, outputTokens: 60 });
    expect(usage).toEqual({ inputTokens: 500, outputTokens: 60 });
  });

  it("normalizes Gemini usageMetadata and folds thinking tokens into output", () => {
    // Gemini bills thoughtsTokenCount at the output rate, so it must be added.
    const usage = normalizeProviderUsage({
      promptTokenCount: 2000,
      candidatesTokenCount: 150,
      thoughtsTokenCount: 90,
      totalTokenCount: 2240,
    });
    expect(usage).toEqual({ inputTokens: 2000, outputTokens: 240 });
  });

  it("unwraps usage nested under a .usage key", () => {
    const usage = normalizeProviderUsage({ usage: { prompt_tokens: 10, completion_tokens: 5 } });
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("returns null when no usable token counts are present", () => {
    expect(normalizeProviderUsage({})).toBeNull();
    expect(normalizeProviderUsage(undefined)).toBeNull();
    expect(normalizeProviderUsage(null)).toBeNull();
    expect(normalizeProviderUsage({ prompt_tokens: 0, completion_tokens: 0 })).toBeNull();
  });
});

describe("sumTurnUsage", () => {
  it("sums input and output across all stream segments (tool-loop billing truth)", () => {
    // A two-request tool turn: each request is billed for its own prompt + output.
    const segments: { usage?: TokenUsage }[] = [
      { usage: { inputTokens: 1000, outputTokens: 40 } },
      { usage: { inputTokens: 1300, outputTokens: 220 } },
    ];
    expect(sumTurnUsage(segments)).toEqual({ inputTokens: 2300, outputTokens: 260 });
  });

  it("ignores segments without usage but still sums the ones that have it", () => {
    const segments: { usage?: TokenUsage }[] = [
      { usage: { inputTokens: 500, outputTokens: 30 } },
      {}, // e.g. a function_call segment that surfaced no usage
    ];
    expect(sumTurnUsage(segments)).toEqual({ inputTokens: 500, outputTokens: 30 });
  });

  it("returns null when no segment reported real usage (caller falls back to estimate)", () => {
    expect(sumTurnUsage([{}, {}])).toBeNull();
    expect(sumTurnUsage([])).toBeNull();
  });
});
