import { describe, expect, it } from "bun:test";
import { collectSmartestInvariantViolations } from "@/db/seed/catalog/modelSeed";

describe("collectSmartestInvariantViolations", () => {
  it("reports one violation when two active models are marked smartest", () => {
    const violations = collectSmartestInvariantViolations("llms", "google", [
      { isSmartest: true },
      { isSmartest: true },
      { isSmartest: true, isDeprecated: true },
    ]);

    expect(violations).toHaveLength(1);
  });
});
