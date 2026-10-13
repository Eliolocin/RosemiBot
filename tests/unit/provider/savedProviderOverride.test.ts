import { describe, expect, it } from "bun:test";
import { savedProviderConfigSchema } from "@/types/db/schema";
import { withSavedProviderConfig } from "@/utils/provider/savedProviderConfig";
import { createLlmRow, createPersona } from "../../helpers/fixtures";

const BASE_KEY = Buffer.from("deepseek-encrypted-key");

function createCrossProviderState() {
  return createPersona({
    llm: createLlmRow({ llm_provider: "anthropic" }),
    config: { api_key: BASE_KEY, key_version: 3, llm_temperature: 0.7, llm_top_p: 0.9 },
  });
}

describe("withSavedProviderConfig", () => {
  it("swaps in the override provider's key and saved samplers, keeping unsaved ones", () => {
    const overrideKey = Buffer.from("anthropic-encrypted-key");
    const savedConfig = savedProviderConfigSchema.parse({
      server_id: 1,
      provider: "anthropic",
      api_key: overrideKey,
      key_version: 2,
      llm_id: null,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
      llm_temperature: 1.1,
      llm_disabled_params: [],
      llm_logit_biases: [],
      fallback_model_refs: [],
    });

    const { config } = withSavedProviderConfig(createCrossProviderState(), savedConfig);

    expect(config.api_key).toBe(overrideKey);
    expect(config.key_version).toBe(2);
    expect(config.llm_temperature).toBe(1.1);
    expect(config.llm_top_p).toBe(0.9);
  });

  // Regression: the prompt snapshot kept the base provider's key here, and the model-limits lookup
  // sent it to the override provider's models API.
  it("never carries the base provider's key when the override provider has no saved config", () => {
    const { config } = withSavedProviderConfig(createCrossProviderState(), null);

    expect(config.api_key).toBeNull();
  });
});
