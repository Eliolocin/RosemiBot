import { describe, expect, it } from "bun:test";
import { buildDeepSeekThinkingRequest } from "@/utils/provider/thinkingControl";

describe("buildDeepSeekThinkingRequest", () => {
  // V4 models think by default, so a level that means "off" must send the switch explicitly.
  it("disables default thinking at none for every V4 model, including aliased codenames", () => {
    for (const model of ["deepseek-flash", "deepseek-v4-flash-vision", "deepseek-reasoner", "deepseek-v4-pro"]) {
      expect(buildDeepSeekThinkingRequest(model, "none")).toEqual({
        thinking: { type: "disabled" },
        omitSampling: false,
      });
    }
  });

  it("enables thinking with a matching effort and leaves auto to the provider default", () => {
    expect(buildDeepSeekThinkingRequest("deepseek-v4-pro", "low")).toEqual({
      thinking: { type: "enabled" },
      reasoning_effort: "low",
      omitSampling: true,
    });
    expect(buildDeepSeekThinkingRequest("deepseek-flash", "auto")).toEqual({ omitSampling: false });
  });
});
