import { describe, expect, it } from "bun:test";
import { isRelationshipEligible, pingUserTickets } from "@/modules/natural-nudges/runtime/targets";

const quiet = { localTurns: 1, stmChannels: 0, active: false, firedBySamePersona: false, firedByAnyPersona: false };

describe("Ping User nudge eligibility", () => {
  it("needs a recent memory or a live short-term memory, never activity alone", () => {
    expect(isRelationshipEligible(0, 0)).toBe(false);
    expect(isRelationshipEligible(1, 0)).toBe(true);
    expect(isRelationshipEligible(0, 1)).toBe(true);
  });
});

describe("Ping User nudge lottery tickets", () => {
  it("gives Mirri 17 tickets for 12 turns and one recent channel, and Juno 21 for one turn and two channels while playing", () => {
    expect(pingUserTickets({ ...quiet, localTurns: 12, stmChannels: 1 })).toBe(17);
    expect(pingUserTickets({ ...quiet, stmChannels: 2, active: true })).toBe(21);
  });

  it("stops counting at 30 turns and 5 channels, so a heavy user tops out at 55 tickets", () => {
    expect(pingUserTickets({ ...quiet, localTurns: 200, stmChannels: 12 })).toBe(55);
    expect(pingUserTickets({ ...quiet, localTurns: 200, stmChannels: 12, active: true })).toBe(65);
  });

  it("takes 15 tickets after this persona pinged them and 5 after another persona did, but never below 1", () => {
    const mirri = { ...quiet, localTurns: 12, stmChannels: 1 };
    expect(pingUserTickets({ ...mirri, firedBySamePersona: true, firedByAnyPersona: true })).toBe(2);
    expect(pingUserTickets({ ...mirri, firedByAnyPersona: true })).toBe(12);
    expect(pingUserTickets({ ...quiet, stmChannels: 1, firedBySamePersona: true, firedByAnyPersona: true })).toBe(1);
  });
});
