import { beforeAll, describe, expect, it } from "bun:test";
import { ContextItemTag } from "@/types/misc/context";
import { buildContextUsagePayload } from "@/utils/discord/ui/contextUsagePanel";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";
import { collectCaseFailures, localizedCopy, RUNTIME_LOCALES } from "../../helpers/localeCases";
import { collectTextDisplays } from "../../helpers/panelLimits";

beforeAll(async () => initializeLocalizer());

describe("buildContextUsagePayload legend", () => {
  it("renders scale line and circle description as separate blockquoted lines when circles are present", () => {
    const cases = collectCaseFailures();
    const persona = createPersona();
    const inspection = {
      selectedPersona: persona,
      answeringState: persona,
      providerName: "google",
      modelName: "gemini-2.5-pro",
      channelId: "123456789012345678",
      channelName: "general",
      presetName: null,
      capturedAt: new Date(0).toISOString(),
      // 1 item of 4 chars (1 token) in a 1,000,000 token window creates a sub-cell segment represented by a circle
      contextItems: [
        {
          role: "system" as const,
          parts: [{ type: "text" as const, text: "test" }],
          metadataTag: ContextItemTag.SYSTEM_HUMANIZER_RULES,
        },
      ],
      toolsData: null,
      budget: { contextLength: 1_000_000, outputReserve: 8192 },
      historyPairsDropped: 0,
    };

    for (const locale of RUNTIME_LOCALES) {
      cases.check(locale, () => {
        const payload = buildContextUsagePayload(locale, inspection, false);
        const textDisplays = collectTextDisplays(payload);
        const circleExpected = `> ${localizedCopy(locale, "commands.context.circle_line")}`;
        const legendText = textDisplays.find((text) => text.includes(circleExpected));
        expect(legendText).toBeDefined();

        if (legendText) {
          const lines = legendText.split("\n");
          for (const line of lines) {
            expect(line.startsWith("> ")).toBe(true);
          }
          expect(lines).toContain(circleExpected);
        }
      });
    }
  });

  it("omits circle description when every segment fills at least one cell", () => {
    const cases = collectCaseFailures();
    const persona = createPersona();
    const inspection = {
      selectedPersona: persona,
      answeringState: persona,
      providerName: "google",
      modelName: "gemini-2.5-pro",
      channelId: "123456789012345678",
      channelName: "general",
      presetName: null,
      capturedAt: new Date(0).toISOString(),
      contextItems: [
        {
          role: "system" as const,
          parts: [{ type: "text" as const, text: "x".repeat(400) }],
          metadataTag: ContextItemTag.SYSTEM_HUMANIZER_RULES,
        },
      ],
      toolsData: null,
      budget: { contextLength: 1000, outputReserve: 100 },
      historyPairsDropped: 0,
    };

    for (const locale of RUNTIME_LOCALES) {
      cases.check(locale, () => {
        const payload = buildContextUsagePayload(locale, inspection, false);
        const textDisplays = collectTextDisplays(payload);
        const circleText = localizedCopy(locale, "commands.context.circle_line");
        const hasCircleLine = textDisplays.some((text) => text.includes(circleText));
        expect(hasCircleLine).toBe(false);
      });
    }
  });
});
