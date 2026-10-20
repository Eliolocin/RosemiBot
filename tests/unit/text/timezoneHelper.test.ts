import { describe, expect, it } from "bun:test";
import {
  formatUTCOffset,
  formatUtcOffsetInput,
  isValidUtcOffset,
  parseTimeWithOffset,
  parseUtcOffsetInput,
} from "@/utils/text/timezoneHelper";

describe("parseUtcOffsetInput", () => {
  it.each([
    ["8", 8],
    [" -5 ", -5],
    ["+0", 0],
    ["5.5", 5.5],
    ["5:30", 5.5],
    ["+5:45", 5.75],
    ["-3:30", -3.5],
    ["-9:30", -9.5],
    ["UTC+12:45", 12.75],
    ["gmt -3:30", -3.5],
    ["14", 14],
    ["-12", -12],
  ])("reads %p as %p hours", (typed, expected) => {
    expect(parseUtcOffsetInput(typed)).toBe(expected);
  });

  it.each([
    "",
    "abc",
    "5.3",
    "5:20",
    "5:60",
    "15",
    "-12:30",
    "14:15",
    "5:5",
    "1e1",
    "Infinity",
  ])("rejects %p", (typed) => {
    expect(parseUtcOffsetInput(typed)).toBeNull();
  });
});

describe("isValidUtcOffset", () => {
  it("accepts quarter hours in range and rejects everything else", () => {
    expect([8, 5.5, 5.75, -9.5, -12, 14].every(isValidUtcOffset)).toBe(true);
    expect([5.3, 14.25, -12.25, Number.NaN, Number.POSITIVE_INFINITY, "8"].some(isValidUtcOffset)).toBe(false);
  });
});

describe("offset formatting", () => {
  it.each([
    [0, "UTC+0", "0"],
    [8, "UTC+8", "8"],
    [-5, "UTC-5", "-5"],
    [5.5, "UTC+5:30", "5:30"],
    [5.75, "UTC+5:45", "5:45"],
    [-3.5, "UTC-3:30", "-3:30"],
    [12.75, "UTC+12:45", "12:45"],
  ])("formats %p as %p for display and %p for input", (offset, display, input) => {
    expect(formatUTCOffset(offset)).toBe(display);
    expect(formatUtcOffsetInput(offset)).toBe(input);
  });

  it("round-trips every quarter-hour offset through both formats", () => {
    for (let quarters = -48; quarters <= 56; quarters++) {
      const offset = quarters / 4;
      expect(parseUtcOffsetInput(formatUtcOffsetInput(offset))).toBe(offset);
      expect(parseUtcOffsetInput(formatUTCOffset(offset))).toBe(offset);
    }
  });
});

describe("half-hour reminder parsing", () => {
  it("converts a UTC+5:30 wall-clock time to the correct UTC instant", () => {
    expect(parseTimeWithOffset("2026-10-20_09:00", 5.5)?.toISOString()).toBe("2026-10-20T03:30:00.000Z");
  });
});
