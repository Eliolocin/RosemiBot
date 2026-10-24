import { describe, expect, it } from "bun:test";
import enSubscribe from "@/locales/en-US/commands/subscribe";
import jaSubscribe from "@/locales/ja/commands/subscribe";

function extractKeys(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") {
    return prefix ? [prefix] : [];
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]) => extractKeys(child, prefix ? `${prefix}.${key}` : key));
}

describe("supporter subscribe locale slice", () => {
  it("keeps en-US and ja subscribe keys in parity", () => {
    expect(extractKeys(jaSubscribe).toSorted()).toEqual(extractKeys(enSubscribe).toSorted());
  });
});
