import type { TomoriState } from "@/types/db/schema";

interface ModelPricing {
  input: number;
  output: number;
}

/**
 * Per-million input and output prices from the model's `llms` row, seeded from the typed catalog
 * (`src/db/seed/catalog/models.ts`). OpenRouter rows are refreshed from the live rates at startup.
 * A model with no catalog price resolves to null, so callers report pricing as unavailable instead
 * of guessing a rate.
 */
export function resolveModelPricing(tomoriState: TomoriState): ModelPricing | null {
  const input = tomoriState.llm.input_price_per_million;
  const output = tomoriState.llm.output_price_per_million;
  if (typeof input === "number" && typeof output === "number") {
    return { input, output };
  }
  return null;
}
