import { describe, expect, it } from "bun:test";
import type { TomoriPresetRow } from "@/types/db/schema";
import { EMPTY_PERSONA_NAMING_CONFIG } from "@/types/personaNaming";
import { buildStatsPresetAvatarLookup, resolveStatsPersonaAvatarReference } from "@/utils/stats/personaAvatar";

type StatsAvatarPersona = Parameters<typeof resolveStatsPersonaAvatarReference>[0];

function preset(overrides: Partial<TomoriPresetRow> = {}): TomoriPresetRow {
  return {
    persona_preset_id: 1,
    persona_preset_name: "Tomori",
    persona_preset_desc: "Default preset",
    preset_lineage_id: 4,
    preset_attribute_list: [],
    preset_attribute_public_flags: [],
    preset_sample_dialogues_in: [],
    preset_sample_dialogues_out: [],
    preset_language: "en-US",
    preset_avatar_path: null,
    preset_avatar_shared_url: "https://storage.googleapis.com/bucket/avatars/presets/4/en-US/avatar-hash.png",
    preset_avatar_hash: "hash",
    preset_trigger_words: [],
    preset_naming_config: structuredClone(EMPTY_PERSONA_NAMING_CONFIG),
    is_nsfw: false,
    ...overrides,
  };
}

function persona(overrides: Partial<StatsAvatarPersona> = {}): StatsAvatarPersona {
  return {
    webhook_avatar_url: null,
    is_pointer: true,
    preset_lineage_id: 4,
    preset_language: "en-US",
    persona_lineage_id: 4,
    ...overrides,
  };
}

describe("resolveStatsPersonaAvatarReference", () => {
  it("keeps a persona-owned avatar ahead of preset fallback", () => {
    const lookup = buildStatsPresetAvatarLookup([preset()]);

    expect(
      resolveStatsPersonaAvatarReference(
        persona({ webhook_avatar_url: "https://example.com/custom-avatar.png" }),
        lookup,
      ),
    ).toBe("https://example.com/custom-avatar.png");
  });

  it("uses the shared preset avatar for pointer personas with no stored avatar", () => {
    const sharedAvatar = "https://storage.googleapis.com/bucket/avatars/presets/4/ja/avatar-hash.png";
    const lookup = buildStatsPresetAvatarLookup([
      preset({ preset_language: "ja", preset_avatar_shared_url: sharedAvatar }),
    ]);

    expect(resolveStatsPersonaAvatarReference(persona({ preset_language: "ja" }), lookup)).toBe(sharedAvatar);
  });

  it("normalizes raw string lineage ids from repository rows", () => {
    const sharedAvatar = "https://storage.googleapis.com/bucket/avatars/presets/4/en-US/avatar-hash.png";
    const rawPreset = {
      ...preset({ preset_avatar_shared_url: sharedAvatar }),
      preset_lineage_id: "4",
    } as unknown as TomoriPresetRow;
    const lookup = buildStatsPresetAvatarLookup([rawPreset]);

    expect(resolveStatsPersonaAvatarReference(persona(), lookup)).toBe(sharedAvatar);
  });

  it("falls back by lineage when the pointer language has no exact preset row", () => {
    const sharedAvatar = "https://storage.googleapis.com/bucket/avatars/presets/4/en-US/avatar-hash.png";
    const lookup = buildStatsPresetAvatarLookup([preset({ preset_avatar_shared_url: sharedAvatar })]);

    expect(resolveStatsPersonaAvatarReference(persona({ preset_language: "ko" }), lookup)).toBe(sharedAvatar);
  });

  it("does not invent an avatar for non-pointer personas", () => {
    const lookup = buildStatsPresetAvatarLookup([preset()]);

    expect(resolveStatsPersonaAvatarReference(persona({ is_pointer: false }), lookup)).toBeNull();
  });
});
