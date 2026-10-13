import { describe, expect, it } from "bun:test";
import { isPersonaWebhookName } from "@/tools/functionCalls/manageMessageTool";
import { toGroupBreakName } from "@/utils/text/groupBreakName";

const personaNames = new Set(["tomori", "locke", "ともり"]);

describe("isPersonaWebhookName", () => {
  it("accepts every spelling sprite delivery gives a persona webhook", () => {
    expect(isPersonaWebhookName("Tomori", personaNames)).toBe(true);
    expect(isPersonaWebhookName(toGroupBreakName("Tomori") ?? "", personaNames)).toBe(true);
    expect(isPersonaWebhookName("ともり (mad)", personaNames)).toBe(true);
    expect(isPersonaWebhookName("The Voice (Locke)", personaNames)).toBe(true);
  });

  it("rejects webhook names that belong to no persona", () => {
    expect(isPersonaWebhookName("Someone Else", personaNames)).toBe(false);
    expect(isPersonaWebhookName("Someone (Else)", personaNames)).toBe(false);
  });
});
