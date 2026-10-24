import { describe, expect, it } from "bun:test";
import type { FallbackModelRef } from "@/types/db/schema";
import { prunePrimaryFallbackRefs } from "@/utils/provider/fallbackModelIdentity";

describe("fallback model identity by credential source", () => {
  it("preserves a model with a different credential source when promoting the primary", () => {
    const native: FallbackModelRef = { type: "llm", id: 42 };
    const subscription: FallbackModelRef = { type: "llm", id: 42, credentialProvider: "supporter" };
    expect(prunePrimaryFallbackRefs([native, subscription], 42, [], "supporter")).toEqual([native]);
    expect(prunePrimaryFallbackRefs([native, subscription], 42, [], "openrouter")).toEqual([subscription]);
  });
});
