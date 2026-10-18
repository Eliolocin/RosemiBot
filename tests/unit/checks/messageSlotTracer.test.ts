/**
 * Verifies that extractMessageComponentUsages discovers known localized message component slots.
 */
import { describe, expect, it } from "bun:test";
import {
  extractMessageComponentUsages,
  extractTruncatedSlotUsages,
} from "../../../scripts/checks/checkLocalizationKeys";
import { DISCORD_BUTTON_LABEL_MAX, DISCORD_SELECT_OPTION_DESCRIPTION_MAX } from "@/utils/discord/ui/componentsV2Limits";

describe("extractMessageComponentUsages", () => {
  it("traces known button-label slot from config panel source", async () => {
    const usages = await extractMessageComponentUsages();

    const retryUsage = usages.get("buttonLabel::commands.config.panel.retry");
    expect(retryUsage).toBeDefined();
    expect(retryUsage?.key).toBe("commands.config.panel.retry");
    expect(retryUsage?.kind).toBe("buttonLabel");
    const normalizedFiles = Array.from(retryUsage?.files ?? []).map((f) => f.replace(/\\/g, "/"));
    expect(normalizedFiles.some((f) => f.includes("utils/discord/ui/configPanel.ts"))).toBe(true);

    const placeholderUsage = usages.get("selectPlaceholder::commands.config.panel.page_select_placeholder");
    expect(placeholderUsage).toBeDefined();
    expect(placeholderUsage?.kind).toBe("selectPlaceholder");

    expect(usages.size).toBeGreaterThan(50);
  });

  it("keeps inline builder-clamped labels out of blocking slot checks", async () => {
    const usages = await extractMessageComponentUsages();
    for (const key of [
      "commands.moderation.category_whitelist",
      "commands.config.panel.category_persona",
      "commands.personal.config.category_profile",
      "commands.config.panel.notice_verbosity_minimal_button",
    ]) {
      expect(usages.has(`buttonLabel::${key}`), key).toBe(false);
      expect(usages.has(`optionLabel::${key}`), key).toBe(false);
    }
  });
});

describe("extractTruncatedSlotUsages", () => {
  it("grades module-local modal caps separately from the imported localizer default", async () => {
    const usages = await extractTruncatedSlotUsages();
    for (const key of [
      "commands.persona.image-tags.tags_input_placeholder",
      "commands.persona.sprites.add.sprite_name_placeholder",
      "commands.persona.sprites.add.instructions_placeholder",
      "commands.config.context-note.set.text_placeholder",
      "commands.config.context-note.set.depth_placeholder",
      "commands.config.panel.trigger_add_input_placeholder",
      "commands.config.panel.attribute_input_placeholder",
      "commands.config.panel.stm_category_input_placeholder",
      "commands.config.panel.model_modal_select_description",
    ]) {
      expect(usages.has(`100::${key}`), key).toBe(true);
      expect(usages.has(`99::${key}`), key).toBe(false);
    }
    expect(usages.has("99::commands.st-presets.file_description")).toBe(true);
    expect(usages.has("100::commands.st-presets.file_description")).toBe(false);
  });

  it("grades inline category and state button labels at the builders' button cap", async () => {
    const usages = await extractTruncatedSlotUsages();
    for (const key of [
      "commands.moderation.category_whitelist",
      "commands.config.panel.category_persona",
      "commands.personal.config.category_profile",
      "commands.config.panel.notice_verbosity_minimal_button",
    ]) {
      expect(usages.has(`${DISCORD_BUTTON_LABEL_MAX}::${key}`), key).toBe(true);
      expect(usages.has(`100::${key}`), key).toBe(false);
    }
  });

  it("traces a map-resolved key at the cap its wrapper truncates it to", async () => {
    const usages = await extractTruncatedSlotUsages();
    const usage = usages.get(
      `${DISCORD_SELECT_OPTION_DESCRIPTION_MAX}::commands.providers.api_style_descriptions.openai-decisions`,
    );
    const files = Array.from(usage?.files ?? []).map((file) => file.replace(/\\/g, "/"));
    expect(files.some((file) => file.endsWith("utils/discord/ui/providersPanel.ts"))).toBe(true);
  });
});
