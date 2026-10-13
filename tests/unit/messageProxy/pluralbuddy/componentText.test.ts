import { describe, expect, it } from "bun:test";
import { ComponentType } from "discord.js";
import { extractTextDisplayContent } from "@/utils/discord/componentNoticeReader";

describe("PluralBuddy Components V2 text", () => {
  it("reads text displays inside sections and containers in their visible order", () => {
    const content = extractTextDisplayContent([
      {
        type: ComponentType.Container,
        components: [
          { type: ComponentType.Section, components: [{ type: ComponentType.TextDisplay, content: "Hi Tomori" }] },
          { type: ComponentType.Separator },
          { type: ComponentType.TextDisplay, content: "Please remember this." },
        ],
      },
    ]);

    expect(content).toBe("Hi Tomori\nPlease remember this.");
  });
});
