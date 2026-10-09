import { describe, expect, it } from "bun:test";
import type { TomoriPresetRow } from "@/types/db/schema";
import { EMPTY_PERSONA_NAMING_CONFIG } from "@/types/personaNaming";
import { selectPresetsForLocale } from "@/utils/persona/presetLocale";

let nextId = 1;
function preset(name: string, lineageId: number | null, language: string, isNsfw = false): TomoriPresetRow {
  return {
    persona_preset_id: nextId++,
    persona_preset_name: name,
    persona_preset_desc: `${name} preset`,
    preset_lineage_id: lineageId,
    preset_attribute_list: [],
    preset_attribute_public_flags: [],
    preset_sample_dialogues_in: [],
    preset_sample_dialogues_out: [],
    preset_language: language,
    preset_trigger_words: [],
    preset_naming_config: structuredClone(EMPTY_PERSONA_NAMING_CONFIG),
    is_nsfw: isNsfw,
  };
}

const tomoriEn = preset("Tomori-kun", 4, "en-US");
const tomoriJa = preset("ともりくん", 4, "ja");
const lockeEn = preset("Locke", 666, "en-US", true);
const catalog = [tomoriEn, tomoriJa, lockeEn];

const names = (rows: TomoriPresetRow[]) => rows.map((row) => row.persona_preset_name);

describe("selectPresetsForLocale", () => {
  it("keeps an untranslated preset reachable through its English variant", () => {
    expect(names(selectPresetsForLocale(catalog, "ja", { nsfw: true }))).toEqual(["Locke"]);
  });

  it("serves the aliased Spanish catalog to an es-ES user", () => {
    const tomoriEs = preset("Tomori-kun (es)", 4, "es-419");
    expect(names(selectPresetsForLocale([tomoriEn, tomoriEs], "es-ES", { nsfw: false }))).toEqual(["Tomori-kun (es)"]);
  });

  it("keeps SFW and NSFW listings disjoint", () => {
    expect(names(selectPresetsForLocale(catalog, "ja", { nsfw: false }))).toEqual(["ともりくん"]);
    expect(names(selectPresetsForLocale(catalog, "en-US", { nsfw: false }))).toEqual(["Tomori-kun"]);
    expect(names(selectPresetsForLocale(catalog, "en-US", { nsfw: true }))).toEqual(["Locke"]);
  });

  it("groups lineages that the driver returns as BIGINT strings", () => {
    const fromDriver = catalog.map((row) => ({ ...row, preset_lineage_id: String(row.preset_lineage_id) }));
    expect(names(selectPresetsForLocale(fromDriver as unknown as TomoriPresetRow[], "ja", { nsfw: false }))).toEqual([
      "ともりくん",
    ]);
  });

  it("shows lineage-less rows only in the most preferred language that has rows", () => {
    const customEn = preset("Custom English", null, "en-US");
    const customJa = preset("Custom Japanese", null, "ja");
    expect(names(selectPresetsForLocale([customEn, customJa], "ja", { nsfw: false }))).toEqual(["Custom Japanese"]);
    expect(names(selectPresetsForLocale([customEn], "ja", { nsfw: false }))).toEqual(["Custom English"]);
  });

  it("keeps an untranslated lineage-less row reachable beside a translated linked preset", () => {
    const customEn = preset("Custom English", null, "en-US");
    expect(names(selectPresetsForLocale([tomoriEn, tomoriJa, customEn], "ja", { nsfw: false }))).toEqual([
      "Custom English",
      "ともりくん",
    ]);
  });
});
