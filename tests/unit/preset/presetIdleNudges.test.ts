import { describe, expect, it } from "bun:test";
import type { PersonaAuthoredIdleNudge } from "@/modules/natural-nudges/db/types";
import {
  PRESET_EXPORT_VERSION,
  presetExportDataSchema,
  presetExportSchema,
  type PresetExport,
  type PresetExportData,
} from "@/types/preset/presetExport";
import { presetRepository } from "@/utils/db/repositories";
import { embedMetadataInPNG, extractMetadataFromPNG } from "@/utils/image/pngMetadata";

const STARGAZING: PersonaAuthoredIdleNudge = {
  id: "stargazing",
  category: "start_topic",
  title: "Stargazing",
  brief: "Have {persona} mention a constellation it saw.",
  agenda_hint: null,
  prerequisites: [],
  recommended_tools: [],
};

const TEA_BREAK: PersonaAuthoredIdleNudge = {
  id: "tea_break",
  category: "revive_topic",
  title: "Tea break",
  brief: "Have {persona} bring the tea conversation back up.",
  agenda_hint: "Get someone to share a tea preference",
  prerequisites: ["hanging_conversation"],
  recommended_tools: ["interact_with_recent_message"],
};

const CARD_NUDGES = [STARGAZING, TEA_BREAK];

function cardData(overrides: Partial<PresetExportData> = {}): PresetExportData {
  return {
    tomori_nickname: "Mirri",
    attribute_list: [],
    sample_dialogues_in: [],
    sample_dialogues_out: [],
    trigger_words: [],
    ...overrides,
  };
}

function card(data: PresetExportData): PresetExport {
  return {
    version: PRESET_EXPORT_VERSION,
    type: "preset",
    exported_at: new Date().toISOString(),
    data,
  };
}

describe("preset persona idle nudge portability", () => {
  it("accepts cards without the field and preserves an explicit empty list", () => {
    const absent = presetExportDataSchema.safeParse(cardData());
    expect(absent.success).toBe(true);
    if (absent.success) expect(absent.data.natural_nudge_idle_nudges).toBeUndefined();

    const empty = presetExportDataSchema.safeParse(cardData({ natural_nudge_idle_nudges: [] }));
    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data.natural_nudge_idle_nudges).toEqual([]);
  });

  it("round-trips definitions and stable IDs through JSON and PNG payloads", async () => {
    const payload = card(cardData({ natural_nudge_idle_nudges: CARD_NUDGES }));
    const png = Buffer.from(await Bun.file("src/db/seed/catalog/personas/default/default.png").arrayBuffer());
    const payloads = [JSON.parse(JSON.stringify(payload)), extractMetadataFromPNG(embedMetadataInPNG(png, payload))];

    for (const transported of payloads) {
      const validated = presetRepository.validatePresetFile(transported);
      expect(validated.valid).toBe(true);
      expect(validated.data?.natural_nudge_idle_nudges).toEqual(CARD_NUDGES);
      expect(JSON.stringify(validated.data)).not.toContain('"enabled"');
      expect(JSON.stringify(validated.data)).not.toContain('"server_id"');
      expect(JSON.stringify(validated.data)).not.toContain('"persona_id"');
    }
  });

  it("rejects malformed definitions, duplicate identifiers, and unknown identifiers", () => {
    const cases: unknown[] = [
      Array.from({ length: 21 }, (_value, index) => ({ ...STARGAZING, id: `nudge_${index}` })),
      [STARGAZING, { ...TEA_BREAK, id: STARGAZING.id }],
      [{ ...STARGAZING, prerequisites: ["unknown_gate"] }],
      [{ ...STARGAZING, recommended_tools: ["not_a_tool"] }],
      [{ ...STARGAZING, title: "x".repeat(81) }],
      [{ ...STARGAZING, id: "not an id" }],
      [{ ...STARGAZING, enabled: false }],
      [{ ...STARGAZING, server_id: 1 }],
    ];

    for (const naturalNudgeIdleNudges of cases) {
      const malformedCard = {
        ...card(cardData()),
        data: { ...cardData(), natural_nudge_idle_nudges: naturalNudgeIdleNudges },
      };
      expect(presetExportSchema.safeParse(malformedCard).success).toBe(false);
      const validation = presetRepository.validatePresetData(malformedCard.data);
      expect(validation.valid).toBe(false);
      expect(validation.error).toBe("commands.persona.import.error_invalid_format");
    }
  });
});
