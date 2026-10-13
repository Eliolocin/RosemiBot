import { describe, expect, it } from "bun:test";
import { collectTokenLimitViolations } from "@/db/seed/catalog/modelSeed";
import type { LlmInput } from "@/db/seed/catalog/types";

function row(overrides: Partial<LlmInput> & Pick<LlmInput, "provider" | "codename">): LlmInput {
  return { desc: null, ...overrides };
}

describe("collectTokenLimitViolations", () => {
  it("requires both limits on catalog-only providers and only the window on nvidia", () => {
    const violations = collectTokenLimitViolations([
      row({ provider: "deepseek", codename: "complete", contextWindow: 128_000, maxOutputTokens: 8_000 }),
      row({ provider: "anthropic", codename: "no-output", contextWindow: 200_000 }),
      row({ provider: "nvidia", codename: "window-only", contextWindow: 128_000 }),
      row({ provider: "nvidia", codename: "no-window" }),
      row({ provider: "google", codename: "retired", isDeprecated: true }),
      row({ provider: "openrouter", codename: "live" }),
    ]);
    expect(violations).toHaveLength(2);
    expect(violations.some((violation) => violation.includes("no-output"))).toBe(true);
    expect(violations.some((violation) => violation.includes("no-window"))).toBe(true);
  });
});
