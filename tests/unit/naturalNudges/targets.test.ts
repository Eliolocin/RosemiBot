import { describe, expect, it } from "bun:test";
import { isRelationshipEligible, reachOutTickets } from "@/modules/natural-nudges/runtime/targets";

const quiet = { memories: 0, stmChannels: 0, active: false, firedBySamePersona: false, firedByAnyPersona: false };

describe("Reach-out eligibility", () => {
  it("needs a recent memory or a live short-term memory, never activity alone", () => {
    expect(isRelationshipEligible(0, 0)).toBe(false);
    expect(isRelationshipEligible(1, 0)).toBe(true);
    expect(isRelationshipEligible(0, 1)).toBe(true);
  });
});

describe("Reach-out lottery tickets", () => {
  it("gives Mirri 17 tickets for 4 memories and one recent channel, and Juno 20 for two channels while playing", () => {
    expect(reachOutTickets({ ...quiet, memories: 4, stmChannels: 1 })).toBe(17);
    expect(reachOutTickets({ ...quiet, stmChannels: 2, active: true })).toBe(20);
  });

  it("stops counting at 10 memories and 5 channels, so a heavy user tops out at 55 tickets", () => {
    expect(reachOutTickets({ ...quiet, memories: 40, stmChannels: 12 })).toBe(55);
    expect(reachOutTickets({ ...quiet, memories: 40, stmChannels: 12, active: true })).toBe(65);
  });

  it("takes 15 tickets after this persona pinged them and 5 after another persona did, but never below 1", () => {
    const mirri = { ...quiet, memories: 4, stmChannels: 1 };
    expect(reachOutTickets({ ...mirri, firedBySamePersona: true, firedByAnyPersona: true })).toBe(2);
    expect(reachOutTickets({ ...mirri, firedByAnyPersona: true })).toBe(12);
    expect(reachOutTickets({ ...quiet, stmChannels: 1, firedBySamePersona: true, firedByAnyPersona: true })).toBe(1);
  });
});
