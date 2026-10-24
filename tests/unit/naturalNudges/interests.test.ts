import { describe, expect, it } from "bun:test";
import { NATURAL_NUDGE_INTEREST_LIMIT, type NaturalNudgeInterest } from "@/modules/natural-nudges/db/types";
import { mergeGeneratedInterests } from "@/modules/natural-nudges/runtime/interests";

function interest(label: string): NaturalNudgeInterest {
  return { label, description: `About ${label}.` };
}

describe("mergeGeneratedInterests", () => {
  it("drops labels the persona already has or the batch repeats, ignoring case and spacing", () => {
    const merged = mergeGeneratedInterests(
      [interest("mecha anime")],
      [interest(" Mecha Anime "), interest("baking"), interest("BAKING"), interest("tea")],
    );
    expect(merged.map((entry) => entry.label)).toEqual(["baking", "tea"]);
  });

  it("never fills past the interest limit", () => {
    const existing = Array.from({ length: NATURAL_NUDGE_INTEREST_LIMIT - 2 }, (_, index) => interest(`topic ${index}`));
    const merged = mergeGeneratedInterests(existing, [interest("a"), interest("b"), interest("c")]);
    expect(existing.length + merged.length).toBe(NATURAL_NUDGE_INTEREST_LIMIT);
  });
});
