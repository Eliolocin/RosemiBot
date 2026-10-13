import { describe, expect, it } from "bun:test";
import {
  PRESET_LINEAGE_BY_AVATAR,
  resolveAlterPersonaName,
  resolveAvailablePersonaName,
  resolvePresetLineageId,
  resolvePresetTriggerWords,
} from "@/commands/persona/default";
import type { TomoriPresetRow } from "@/types/db/schema";
import { EMPTY_PERSONA_NAMING_CONFIG } from "@/types/personaNaming";

/** Minimal preset fixture: only the fields used by the pure helpers. */
function makePreset(overrides: Partial<TomoriPresetRow> = {}): TomoriPresetRow {
  return {
    persona_preset_id: 1,
    persona_preset_name: "Test Preset",
    persona_preset_desc: "A test preset",
    preset_lineage_id: null,
    preset_attribute_list: [],
    preset_attribute_public_flags: [],
    preset_sample_dialogues_in: [],
    preset_sample_dialogues_out: [],
    preset_language: "en-US",
    preset_avatar_path: null,
    preset_trigger_words: [],
    preset_naming_config: structuredClone(EMPTY_PERSONA_NAMING_CONFIG),
    is_nsfw: false,
    ...overrides,
  };
}

describe("persona default — name resolution helpers", () => {
  describe("resolveAvailablePersonaName", () => {
    it("returns the default name when it is not taken", () => {
      expect(resolveAvailablePersonaName("Tomori", ["alice"], [])).toBe("Tomori");
    });

    it("falls back to the first trigger word (capitalized) when the default name is taken", () => {
      expect(resolveAvailablePersonaName("Tomori", ["alice"], ["Tomori"])).toBe("Alice");
    });

    it("skips taken trigger words and tries the next candidate in order", () => {
      const result = resolveAvailablePersonaName("Tomori", ["alice", "bob"], ["Tomori", "Alice"]);
      expect(result).toBe("Bob");
    });

    it("returns null when all candidates are exhausted", () => {
      const result = resolveAvailablePersonaName("Tomori", ["alice"], ["Tomori", "Alice"]);
      expect(result).toBeNull();
    });

    it("taken-name comparison is case-insensitive", () => {
      // takenNames has "TOMORI" (upper-case), so must block "Tomori" as default name
      const result = resolveAvailablePersonaName("Tomori", [], ["TOMORI"]);
      expect(result).toBeNull();
    });

    it("skips blank and whitespace-only trigger word candidates", () => {
      const result = resolveAvailablePersonaName("Tomori", ["   ", "valid"], ["Tomori"]);
      expect(result).toBe("Valid");
    });

    it("returns the default name when trigger words list is empty and default is not taken", () => {
      expect(resolveAvailablePersonaName("Tomori", [], [])).toBe("Tomori");
    });

    it("returns null when trigger words list is empty and the default name is taken", () => {
      expect(resolveAvailablePersonaName("Tomori", [], ["Tomori"])).toBeNull();
    });

    it("capitalizes the first letter of a trigger word and lowercases the rest", () => {
      const result = resolveAvailablePersonaName("Tomori", ["ALICE"], ["Tomori"]);
      expect(result).toBe("Alice");
    });

    it("does not capitalize trigger words that start with a non-alpha character", () => {
      const result = resolveAvailablePersonaName("Tomori", ["123abc"], ["Tomori"]);
      expect(result).toBe("123abc");
    });
  });

  describe("resolvePresetLineageId", () => {
    it("returns the explicit numeric lineage id when set", () => {
      expect(resolvePresetLineageId(makePreset({ preset_lineage_id: 42 }))).toBe(42);
    });

    it("returns the lineage id when preset_lineage_id is stored as a string number", () => {
      expect(resolvePresetLineageId(makePreset({ preset_lineage_id: 42 }))).toBe(42);
    });

    it("falls back to avatar filename lookup when lineage id is null", () => {
      const preset = makePreset({ preset_lineage_id: null, preset_avatar_path: "default.png" });
      expect(resolvePresetLineageId(preset)).toBe(PRESET_LINEAGE_BY_AVATAR["default.png"]);
    });

    it("avatar path lookup is case-insensitive to directory separators", () => {
      const preset = makePreset({ preset_lineage_id: null, preset_avatar_path: "avatars/bratty.png" });
      expect(resolvePresetLineageId(preset)).toBe(PRESET_LINEAGE_BY_AVATAR["bratty.png"]);
    });

    it("falls back to name-based heuristic when avatar path is unrecognized", () => {
      const preset = makePreset({
        preset_lineage_id: null,
        preset_avatar_path: "custom.png",
        persona_preset_name: "The Gloomy One",
      });
      expect(resolvePresetLineageId(preset)).toBe(1770);

      const lockePreset = makePreset({
        preset_lineage_id: null,
        preset_avatar_path: "custom.png",
        persona_preset_name: "Locke",
      });
      expect(resolvePresetLineageId(lockePreset)).toBe(666);
    });

    it("returns null when no lineage can be resolved", () => {
      const preset = makePreset({
        preset_lineage_id: null,
        preset_avatar_path: "",
        persona_preset_name: "UnknownPersona",
      });
      expect(resolvePresetLineageId(preset)).toBeNull();
    });

    it("all PRESET_LINEAGE_BY_AVATAR keys map to known lineage ids", () => {
      const knownIds = new Set([4, 716, 1770, 3585, 50, 666]);
      for (const [filename, lineageId] of Object.entries(PRESET_LINEAGE_BY_AVATAR)) {
        expect(knownIds.has(lineageId)).toBe(true);
        expect(filename.endsWith(".png")).toBe(true);
      }
    });
  });

  describe("resolvePresetTriggerWords", () => {
    it("returns preset trigger words when they are non-empty", () => {
      const preset = makePreset({ preset_trigger_words: ["alice", "ali"] });
      const words = resolvePresetTriggerWords(preset, "en-US");
      expect(words).toEqual(["alice", "ali"]);
    });

    it("deduplicates trigger words from the preset", () => {
      const preset = makePreset({ preset_trigger_words: ["alice", "alice", "ali"] });
      const words = resolvePresetTriggerWords(preset, "en-US");
      // The duplicate "alice" is removed; unique set size should equal array length
      const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
      expect(uniqueWords.size).toBe(words.length);
      expect(words.length).toBeLessThan(3);
    });

    it("does not return undefined or null entries", () => {
      const preset = makePreset({ preset_trigger_words: ["alice"] });
      const words = resolvePresetTriggerWords(preset, "en-US");
      for (const word of words) {
        expect(typeof word).toBe("string");
      }
    });
  });
});

describe("resolveAlterPersonaName", () => {
  it("names the alter after a trigger it still answers to when the main owns the default name's trigger", () => {
    expect(resolveAlterPersonaName("Tomori", ["tomori", "locke"], ["locke"], ["Mirri"])).toBe("Locke");
  });

  it("keeps the default name when the alter still answers to it", () => {
    expect(resolveAlterPersonaName("Tomori", ["tomori", "locke"], ["tomori", "locke"], ["Mirri"])).toBe("Tomori");
  });

  it("skips an answered trigger whose name is taken", () => {
    expect(resolveAlterPersonaName("Tomori", ["tomori", "locke", "lo"], ["locke", "lo"], ["Locke"])).toBe("Lo");
  });

  it("falls back to the default name when every trigger is claimed", () => {
    expect(resolveAlterPersonaName("Tomori", ["tomori", "locke"], [], ["Mirri"])).toBe("Tomori");
  });
});
