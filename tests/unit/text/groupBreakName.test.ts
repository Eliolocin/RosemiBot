import { describe, expect, it } from "bun:test";
import { revealGroupBreakName, toGroupBreakName } from "@/utils/text/groupBreakName";
import { normalizeParticipantAlias } from "@/utils/text/participants/aliases";

// Built from code points because the formatter rewrites escapes into glyphs that are
// indistinguishable from their Latin twins in review.
const CYRILLIC_A = String.fromCodePoint(0x0430);
const CYRILLIC_I = String.fromCodePoint(0x0456);
const CYRILLIC_O = String.fromCodePoint(0x043e);
const CYRILLIC_ER = String.fromCodePoint(0x0440);
const TOMORI_CYRILLIC = `Томо${CYRILLIC_ER}и`;

describe("toGroupBreakName", () => {
  it("swaps the last swappable letter so the leading letters stay untouched", () => {
    expect(toGroupBreakName("Tomori")).toBe(`Tomor${CYRILLIC_I}`);
    expect(toGroupBreakName("Touko Fukawa")).toBe(`Touko Fukaw${CYRILLIC_A}`);
  });

  it("falls back to an earlier word when the last word cannot carry a swap", () => {
    expect(toGroupBreakName("Tomori Ai")).toBe(`Tomor${CYRILLIC_I} Ai`);
    expect(toGroupBreakName("Tomori ともり")).toBe(`Tomor${CYRILLIC_I} ともり`);
  });

  it("swaps a Cyrillic name toward Latin", () => {
    expect(toGroupBreakName(TOMORI_CYRILLIC)).toBe("Томоpи");
  });

  it("returns null when no word can carry a detectable swap", () => {
    expect(toGroupBreakName("ともり")).toBeNull();
    expect(toGroupBreakName("友里")).toBeNull();
    expect(toGroupBreakName("Ai")).toBeNull();
    expect(toGroupBreakName("Luv")).toBeNull();
  });
});

describe("revealGroupBreakName", () => {
  it("round-trips every swap back to the clean name", () => {
    for (const name of ["Tomori", "Touko Fukawa", "Tomori Ai", TOMORI_CYRILLIC, "Rin", "OSAKA"]) {
      const swapped = toGroupBreakName(name);
      expect(swapped).not.toBeNull();
      expect(swapped).not.toBe(name);
      expect(revealGroupBreakName(swapped ?? "")).toBe(name);
    }
  });

  it("leaves single-alphabet and tied words alone", () => {
    expect(revealGroupBreakName("Саша")).toBe("Саша");
    expect(revealGroupBreakName(`I${CYRILLIC_O}`)).toBe(`I${CYRILLIC_O}`);
  });
});

describe("normalizeParticipantAlias with group-break names", () => {
  it("matches the clean persona nickname", () => {
    expect(normalizeParticipantAlias(`Tomor${CYRILLIC_I}`)).toBe(normalizeParticipantAlias("Tomori"));
  });
});
