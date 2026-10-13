import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { isNsfwPersonaImport } from "@/commands/persona/import";
import type { TomoriPresetRow } from "@/types/db/schema";
import type { PresetExportData } from "@/types/preset/presetExport";
import { EMPTY_PERSONA_NAMING_CONFIG } from "@/types/personaNaming";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";

function importData(overrides: Partial<PresetExportData> = {}): PresetExportData {
  return {
    tomori_nickname: "Mirri",
    attribute_list: [],
    sample_dialogues_in: [],
    sample_dialogues_out: [],
    trigger_words: [],
    ...overrides,
  };
}

function officialPreset(isNsfw: boolean): TomoriPresetRow {
  return {
    persona_preset_id: 1,
    persona_preset_name: "Official",
    persona_preset_desc: "An official preset",
    preset_lineage_id: 666,
    preset_attribute_list: [],
    preset_attribute_public_flags: [],
    preset_sample_dialogues_in: [],
    preset_sample_dialogues_out: [],
    preset_language: "en-US",
    preset_trigger_words: [],
    preset_naming_config: structuredClone(EMPTY_PERSONA_NAMING_CONFIG),
    is_nsfw: isNsfw,
  };
}

describe("/persona import NSFW refusal", () => {
  afterEach(() => {
    mock.restore();
  });

  it("refuses a file flagged NSFW without consulting the catalog", async () => {
    const lookup = spyOn(presetRepository, "findMatchingOfficialPresetForImport").mockResolvedValue(null);
    expect(await isNsfwPersonaImport(importData({ is_nsfw: true }))).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("refuses an unflagged file that would re-point at an NSFW official preset", async () => {
    spyOn(presetRepository, "findMatchingOfficialPresetForImport").mockResolvedValue(officialPreset(true));
    expect(await isNsfwPersonaImport(importData({ preset_lineage_id: 666 }))).toBe(true);
  });

  it("allows an SFW file, including one from before the flag existed", async () => {
    spyOn(presetRepository, "findMatchingOfficialPresetForImport").mockResolvedValue(officialPreset(false));
    expect(await isNsfwPersonaImport(importData({ is_nsfw: false }))).toBe(false);
    expect(await isNsfwPersonaImport(importData())).toBe(false);
  });
});
