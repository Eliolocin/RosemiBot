import { describe, expect, test } from "bun:test";
import { refreshLiveModelLimits } from "@/utils/cache/liveModelLimitsCache";
import { resolveContextBudget } from "@/utils/provider/contextBudget";
import { resolveChatMaxOutputTokens } from "@/utils/provider/maxOutputTokens";
import { resolveModelLimits, resolveRequestMaxOutputTokens } from "@/utils/provider/modelLimits";
import { computeSafeInputBudget } from "@/utils/text/contextTruncator";
import { stubGlobalFetch } from "../../helpers/fetchStub";
import { createLlmRow, createPersona } from "../../helpers/fixtures";

const CATALOG_PROVIDERS = [
  "google",
  "vertex",
  "vertexexpress",
  "anthropic",
  "deepseek",
  "zai",
  "zaicoding",
  "nvidia",
  "openrouter",
] as const;

function catalogPersona(provider: string, configuredOutput: number | null) {
  return createPersona({
    llm: createLlmRow({
      llm_provider: provider,
      llm_codename: "catalog-model",
      context_window: 32_000,
      max_output_tokens: 2_000,
    }),
    config: { llm_max_output_tokens: configuredOutput },
  });
}

/** A custom endpoint whose fallback hop pinned the URL mirror, so no endpoint row is loaded. */
function customPersona(numCtx: number | null, configuredOutput: number | null = null) {
  return createPersona({
    llm: createLlmRow({ llm_provider: "custom:42", llm_codename: "local-model" }),
    config: {
      custom_endpoint_url: "http://127.0.0.1:5001/v1",
      custom_num_ctx: numCtx,
      llm_max_output_tokens: configuredOutput,
    },
  });
}

describe("resolveModelLimits", () => {
  test("reads the catalog columns for a first-party model", async () => {
    expect(await resolveModelLimits(catalogPersona("anthropic", null))).toEqual({
      contextWindow: 32_000,
      maxOutputTokens: 2_000,
    });
  });

  test("treats a missing or non-positive column as unknown", async () => {
    const persona = createPersona({ llm: createLlmRow({ context_window: 0, max_output_tokens: null }) });
    expect(await resolveModelLimits(persona)).toEqual({ contextWindow: null, maxOutputTokens: null });
  });

  test("takes a custom endpoint's window from the num_ctx its request sends", async () => {
    expect((await resolveModelLimits(customPersona(8_192))).contextWindow).toBe(8_192);
    expect((await resolveModelLimits(customPersona(null))).contextWindow).toBeNull();
  });
});

describe("live model limits", () => {
  test("a provider-reported limit outranks the catalog and survives a later failed lookup", async () => {
    const persona = createPersona({
      llm: createLlmRow({
        llm_provider: "anthropic",
        llm_codename: "claude-live-limits",
        context_window: 32_000,
        max_output_tokens: 2_000,
      }),
    });

    const success = stubGlobalFetch(() => Response.json({ max_input_tokens: 500_000, max_tokens: 64_000 }));
    try {
      await refreshLiveModelLimits("anthropic", "claude-live-limits", "test-key");
    } finally {
      success.mockRestore();
    }
    expect(await resolveModelLimits(persona)).toEqual({ contextWindow: 500_000, maxOutputTokens: 64_000 });

    const failure = stubGlobalFetch(() => new Response("unavailable", { status: 503 }));
    try {
      await refreshLiveModelLimits("anthropic", "claude-live-limits", "test-key");
    } finally {
      failure.mockRestore();
    }
    expect((await resolveModelLimits(persona)).contextWindow).toBe(500_000);
  });
});

describe("truncation reserve parity", () => {
  // Over-reserving drops history that would have fit, so the reserve must equal the request.
  test("every provider reserves exactly the max_tokens its request sends", async () => {
    const mismatches: string[] = [];
    for (const provider of CATALOG_PROVIDERS) {
      for (const configured of [null, 1_000, 50_000]) {
        const persona = catalogPersona(provider, configured);
        const budget = await resolveContextBudget(persona, "1");
        const requested = await resolveRequestMaxOutputTokens(persona);
        if (budget?.outputReserve !== requested) {
          mismatches.push(`${provider}/${configured}: reserve ${budget?.outputReserve}, request ${requested}`);
        }
      }
    }
    const custom = customPersona(8_192);
    const customBudget = await resolveContextBudget(custom, "1");
    if (customBudget?.outputReserve !== (await resolveRequestMaxOutputTokens(custom))) mismatches.push("custom");
    expect(mismatches).toEqual([]);
  });

  test("an OpenRouter model with no known ceiling omits max_tokens but still reserves the default", async () => {
    const persona = createPersona({
      llm: createLlmRow({ llm_provider: "openrouter", llm_codename: "uncapped-model", context_window: 32_000 }),
    });
    expect(await resolveRequestMaxOutputTokens(persona)).toBeUndefined();
    expect((await resolveContextBudget(persona, "1"))?.outputReserve).toBe(
      resolveChatMaxOutputTokens({
        provider: "openrouter",
        configured: null,
        modelMaxOutputTokens: null,
        contextWindow: 32_000,
      }),
    );
  });

  test("clamps a server override above the model's output ceiling", async () => {
    expect(await resolveRequestMaxOutputTokens(catalogPersona("deepseek", 50_000))).toBe(2_000);
  });

  // Regression: the default 4096 reply budget on the 4096 num_ctx the setup wizard suggests left a
  // safe input budget of zero, so every turn dropped the whole channel history.
  test("a default reply budget leaves room for history in a small custom window", async () => {
    const budget = await resolveContextBudget(customPersona(4_096), "1");
    if (!budget) throw new Error("expected a budget for a known num_ctx");
    expect(computeSafeInputBudget(budget.contextLength, budget.outputReserve)).toBeGreaterThan(0);
  });

  test("honors an explicit output override even when it fills a small custom window", async () => {
    expect(await resolveRequestMaxOutputTokens(customPersona(4_096, 4_096))).toBe(4_096);
  });

  test("skips truncation when the window is unknown", async () => {
    expect(await resolveContextBudget(customPersona(null), "1")).toBeNull();
  });
});
