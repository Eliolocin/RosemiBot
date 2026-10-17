import { describe, expect, it } from "bun:test";
import { analyzeLocalizationKeys } from "../../../scripts/checks/checkLocalizationKeys";

describe("unused locale-key audit", () => {
  it("keeps runtime-derived and persisted keys out of the deletion report", async () => {
    const result = await analyzeLocalizationKeys();
    const protectedKeys = [
      "commands.help.api-key.google_title",
      "commands.reward.hug.embed_title",
      "commands.config.panel.category_persona",
      "commands.generate.voice-message.backend_elevenlabs",
      "commands.generate.voice-message.upload_invalid_format_title",
      "commands.stats.infographic.total_spent",
      "tools.search.category_labels.text",
      "tools.intent_packs.deliberate.image",
      "general.duration.now",
      "general.text_preview.truncated_footer",
      "commands.legal.license-only.description",
      "genai.novelai.400_trial_message",
      "genai.google.400_billing_default_message",
    ];
    const unused = new Set(result.unusedKeys.map(({ key }) => key));
    for (const key of protectedKeys) {
      expect(result.availableKeys.has(key)).toBe(true);
      expect(unused.has(key)).toBe(false);
    }
  });

  it("reports no unused keys across authored locales", async () => {
    const result = await analyzeLocalizationKeys();
    const unused = new Set(result.unusedKeys.map(({ key }) => key));
    const failures = [...result.localeKeys].flatMap(([locale, keys]) =>
      [...keys].filter((key) => unused.has(key)).map((key) => `${locale}:${key}`),
    );
    expect(failures).toEqual([]);
    expect(result.missingKeys).toEqual([]);
  });
});
