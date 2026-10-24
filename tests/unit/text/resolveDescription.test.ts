import { describe, expect, it } from "bun:test";
import { resolveDescription, resolvePresetDisplayName } from "@/utils/text/localizer";

describe("resolveDescription", () => {
  const descriptions = {
    "en-US": "English",
    ja: "Japanese",
    "pt-BR": "Portuguese",
    pt: "Generic Portuguese",
  };

  it("uses exact, base, matching base, then English", () => {
    expect(resolveDescription(descriptions, "pt-BR")).toBe("Portuguese");
    expect(resolveDescription(descriptions, "pt-PT")).toBe("Generic Portuguese");
    expect(resolveDescription({ "pt-BR": "Portuguese" }, "pt-PT")).toBe("Portuguese");
    expect(resolveDescription(descriptions, "fr")).toBe("English");
    expect(resolveDescription({ ja: "Japanese" }, "fr")).toBeNull();
    expect(resolveDescription(null, "ja")).toBeNull();
  });

  it("ignores empty translations", () => {
    expect(resolveDescription({ ja: "", "en-US": "English" }, "ja")).toBe("English");
  });
});

describe("resolvePresetDisplayName", () => {
  it("falls back to the stored English name when no label resolves", () => {
    const preset = { system_prompt_preset_name: "Bredrumb's Prompt", display_names: { ja: "ブレドラム" } };
    expect(resolvePresetDisplayName(preset, "ja")).toBe("ブレドラム");
    expect(resolvePresetDisplayName(preset, "fr")).toBe("Bredrumb's Prompt");
    expect(resolvePresetDisplayName({ ...preset, display_names: null }, "ja")).toBe("Bredrumb's Prompt");
  });
});
