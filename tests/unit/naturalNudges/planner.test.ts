import { describe, expect, it } from "bun:test";
import {
  buildAcceptedResult,
  buildPlannerJsonSchema,
  sceneScriptIssues,
} from "@/modules/natural-nudges/runtime/planner";

const plan = { proceed: true, channel: 1, topic: "mecha", opener_direction: "Pick a fight.", agenda: "Win." };

function maxMinItems(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const own = "minItems" in node && typeof node.minItems === "number" ? node.minItems : 0;
  return Math.max(own, ...Object.values(node).map(maxMinItems));
}

describe("Play Scene script rules", () => {
  it("accepts a script the lead opens, that alternates, and that gives every speaker a turn", () => {
    expect(sceneScriptIssues([1, 2], 1, 1)).toEqual([]);
    expect(sceneScriptIssues([1, 2, 3, 1], 2, 2)).toEqual([]);
  });

  it("names each broken rule once, so the retry note lists exactly what to fix", () => {
    const rejected: Array<[number[], number, number]> = [
      [[2, 1], 1, 1],
      [[1, 2, 1, 2, 1], 1, 1],
      [[1, 2, 2, 1], 1, 1],
      [[1, 2, 3], 1, 1],
      [[1, 2, 1], 2, 2],
      [[1, 2], 2, 1],
    ];
    for (const [script, agendas, partners] of rejected) {
      expect(sceneScriptIssues(script, agendas, partners)).toHaveLength(1);
    }
  });

  it("turns a broken script into a schema failure, which earns the format retry", () => {
    const accept = buildAcceptedResult(1);
    expect(accept.safeParse({ ...plan, script: [1, 2], partner_agendas: ["Lose."] }).success).toBe(true);
    expect(accept.safeParse({ ...plan, script: [2, 1], partner_agendas: ["Lose."] }).success).toBe(false);
  });

  it("sends providers no minItems above 1, which Anthropic's output grammar rejects", () => {
    expect(maxMinItems(buildPlannerJsonSchema(2))).toBeLessThanOrEqual(1);
  });
});
