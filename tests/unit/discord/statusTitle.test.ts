import { beforeAll, describe, expect, it } from "bun:test";
import { createStandardEmbed } from "@/utils/discord/embedHelper";
import { buildNoticeContainer } from "@/utils/discord/ui/interactionCore";
import {
  localizedStatusTitle,
  resolveStatusTone,
  stripStatusCircle,
  withStatusCircle,
} from "@/utils/discord/ui/statusTitle";
import { ColorCode } from "@/utils/misc/logger";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy, expectForEveryLocale } from "../../helpers/localeCases";
import { collectTextDisplays } from "../../helpers/panelLimits";

/** A key whose authored title states an outcome, used to observe the rendered marker. */
const FAILED_TITLE_KEY = "commands.persona.import.failed_title";

beforeAll(async () => {
  await initializeLocalizer();
});

describe("status circle", () => {
  const bareTitle = "Import Failed";

  it("renders the circle the surface color speaks for", () => {
    expect(withStatusCircle(bareTitle, ColorCode.ERROR)).toBe(`🔴 ${bareTitle}`);
    expect(withStatusCircle(bareTitle, ColorCode.WARN)).toBe(`🟡 ${bareTitle}`);
    expect(withStatusCircle(bareTitle, ColorCode.SUCCESS)).toBe(`🟢 ${bareTitle}`);
  });

  it("accepts the decimal color form a Components V2 accent uses", () => {
    expect(withStatusCircle(bareTitle, Number.parseInt(ColorCode.ERROR.replace("#", ""), 16))).toBe(`🔴 ${bareTitle}`);
  });

  it("leaves colors without a tone bare", () => {
    const toneless = [ColorCode.INFO, ColorCode.SECTION, ColorCode.AFFECTION, ColorCode.MEMORY_UPDATE, undefined];
    for (const color of toneless) {
      expect(withStatusCircle(bareTitle, color)).toBe(bareTitle);
      expect(resolveStatusTone(color)).toBeNull();
    }
  });

  it("replaces a circle the locale already authored instead of doubling it", () => {
    // The reported defect: a locale title carrying a red circle on a yellow surface.
    expect(withStatusCircle("🔴 Provider Overloaded", ColorCode.WARN)).toBe("🟡 Provider Overloaded");
    expect(withStatusCircle("🟡️ Response Timed Out", ColorCode.WARN)).toBe("🟡 Response Timed Out");
    expect(withStatusCircle("🟢 Export Successful", ColorCode.SUCCESS)).toBe("🟢 Export Successful");
    // An unmapped color drops the stale marker rather than keeping a contradictory one.
    expect(withStatusCircle("🔴 Export Failed", ColorCode.INFO)).toBe("Export Failed");
  });

  it("keeps a title that already leads with its own emoji", () => {
    expect(withStatusCircle("⏳ Building Summary", ColorCode.WARN)).toBe("⏳ Building Summary");
    expect(withStatusCircle("✅ Summary Saved", ColorCode.SUCCESS)).toBe("✅ Summary Saved");
    expect(withStatusCircle("⚠️ File Truncated", ColorCode.WARN)).toBe("⚠️ File Truncated");
  });

  it("strips only a leading status circle", () => {
    expect(stripStatusCircle("🔴 Import Failed")).toBe(bareTitle);
    expect(stripStatusCircle("Import 🔴 Failed")).toBe("Import 🔴 Failed");
    expect(stripStatusCircle("Import Failed")).toBe(bareTitle);
  });

  it("localizes before it decorates", () => {
    expect(localizedStatusTitle("en-US", FAILED_TITLE_KEY, ColorCode.ERROR)).toBe(
      `🔴 ${localizedCopy("en-US", FAILED_TITLE_KEY)}`,
    );
    expect(localizedStatusTitle("en-US", FAILED_TITLE_KEY, ColorCode.INFO)).toBe(
      localizedCopy("en-US", FAILED_TITLE_KEY),
    );
  });

  it("interpolates title variables before it decorates", () => {
    // The avatar-download error branches pass `{max_size}` through this argument.
    const key = "commands.persona.create.error_file_too_large";
    const variables = { max_size: "10" };
    expect(localizedStatusTitle("en-US", key, ColorCode.ERROR, variables)).toBe(
      `🔴 ${localizedCopy("en-US", key, variables)}`,
    );
  });

  it("renders the color's circle for every authored locale, whatever its own value carries", () => {
    expectForEveryLocale((locale) => {
      const authored = localizedCopy(locale, FAILED_TITLE_KEY);
      expect(localizedStatusTitle(locale, FAILED_TITLE_KEY, ColorCode.ERROR)).toBe(`🔴 ${stripStatusCircle(authored)}`);
    });
  });
});

describe("status circle at the title sinks", () => {
  it("derives a standard embed title's circle from the color, not from the locale value", () => {
    const embed = createStandardEmbed("en-US", { titleKey: FAILED_TITLE_KEY, color: ColorCode.WARN });
    expect(embed.data.title).toBe(`🟡 ${localizedCopy("en-US", FAILED_TITLE_KEY)}`);
  });

  it("renders no circle on a color with no tone", () => {
    const embed = createStandardEmbed("en-US", { titleKey: FAILED_TITLE_KEY });
    expect(embed.data.title).toBe(localizedCopy("en-US", FAILED_TITLE_KEY));
  });

  it("heads a Components V2 notice with the circle its accent color implies", () => {
    const components = buildNoticeContainer({
      locale: "en-US",
      titleKey: FAILED_TITLE_KEY,
      color: ColorCode.ERROR,
    });
    expect(collectTextDisplays(components)[0]).toBe(`### 🔴 ${localizedCopy("en-US", FAILED_TITLE_KEY)}`);
  });
});

describe("Minimal notice titles", () => {
  it("render exactly as their Verbose title, emoji or status circle included", () => {
    const cases: Array<{ titleKey: string; titleVars: Record<string, string> }> = [
      { titleKey: "tools.user_info_update.success_title", titleVars: { target_user: "Bau" } },
      { titleKey: FAILED_TITLE_KEY, titleVars: {} },
    ];
    const failures: string[] = [];
    for (const { titleKey, titleVars } of cases) {
      for (const color of [ColorCode.SUCCESS, ColorCode.ERROR]) {
        const expected = localizedStatusTitle("en-US", titleKey, color, titleVars);
        const embedTitle = (minimal: boolean) =>
          createStandardEmbed("en-US", { titleKey, titleVars, color, minimal }).data.title;
        const containerTitle = (minimal: boolean) =>
          collectTextDisplays(buildNoticeContainer({ locale: "en-US", titleKey, titleVars, color, minimal }))[0];

        if (embedTitle(true) !== expected || embedTitle(true) !== embedTitle(false)) {
          failures.push(`embed ${titleKey} ${color}: ${embedTitle(true)}`);
        }
        if (containerTitle(true) !== `### ${expected}`) {
          failures.push(`container ${titleKey} ${color}: ${containerTitle(true)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
