import { describe, expect, it } from "bun:test";
import { drawScenePartners, hasScenePartner, type PartnerCandidate } from "@/modules/natural-nudges/runtime/partners";
import { PLAY_SCENE_SECOND_PARTNER_CHANCE } from "@/modules/natural-nudges/runtime/tuning";

function candidate(name: string, tickets: number, channelIds: string[]): PartnerCandidate<string> {
  return { persona: name, tickets, channelIds: new Set(channelIds) };
}

/** Zero draws the first live entry of every raffle; the first call also decides whether a second partner joins. */
function wantsOne(): () => number {
  let calls = 0;
  return () => (calls++ === 0 ? PLAY_SCENE_SECOND_PARTNER_CHANCE : 0);
}

describe("scene partner draw", () => {
  it("draws only a persona that has tickets and shares a channel with the lead", () => {
    const candidates = [candidate("Juno", 10, ["c9"]), candidate("Mirri", 0, ["c1"]), candidate("Bau", 5, ["c2"])];
    expect(hasScenePartner(candidates, ["c1", "c2"])).toBe(true);
    expect(drawScenePartners(candidates, ["c1", "c2"], wantsOne())).toEqual({ partners: ["Bau"], channelIds: ["c2"] });
  });

  it("draws a second partner only from channels every speaker so far shares", () => {
    const candidates = [candidate("Juno", 10, ["c1"]), candidate("Mirri", 10, ["c2"]), candidate("Bau", 10, ["c1"])];
    expect(drawScenePartners(candidates, ["c1", "c2"], () => 0)).toEqual({
      partners: ["Juno", "Bau"],
      channelIds: ["c1"],
    });
  });

  it("keeps a lone partner when no second persona shares its channels", () => {
    const candidates = [candidate("Juno", 10, ["c1"]), candidate("Mirri", 10, ["c2"])];
    expect(drawScenePartners(candidates, ["c1", "c2"], () => 0)).toEqual({ partners: ["Juno"], channelIds: ["c1"] });
  });

  it("finds nobody when no persona with tickets shares a channel", () => {
    const candidates = [candidate("Juno", 10, ["c9"]), candidate("Mirri", 0, ["c1"])];
    expect(hasScenePartner(candidates, ["c1"])).toBe(false);
    expect(drawScenePartners(candidates, ["c1"], () => 0)).toBeNull();
  });
});
