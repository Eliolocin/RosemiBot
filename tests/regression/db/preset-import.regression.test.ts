import type { Client } from "discord.js";
import { importAlterPreset } from "@/utils/persona/importAlterPreset";
import { embedMetadataInPNG, extractMetadataFromPNG } from "@/utils/image/pngMetadata";
/**
 * Regression harness - persona preset imports.
 *
 * Covers compatibility with Tomori preset exports created before the schema
 * normalization branch moved trigger_words out of server config tables.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { PresetExportData } from "@/types/preset/presetExport";
import { presetRepository, personaRepository } from "@/utils/db/repositories";
import { FIXTURE_IDS, cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("Preset import - regression", () => {
  let refs: FixtureRefs;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
  });

  afterAll(async () => {
    await cleanupFixtures(testSql);
  });

  it("round-trips bounded voice descriptions and priority through PNG and JSON for main and alter imports", async () => {
    await personaRepository.setVoiceConfig(refs.personaId, {
      speech_voice_design_prompt: "Warm narration",
      voice_source_priority: "clone",
      speech_voice_sample_id: null,
      speech_voice_id: "synthetic-provider-id",
      speech_voice_name: "Synthetic",
    });
    const exported = await presetRepository.exportPresetData(FIXTURE_IDS.serverDiscId);
    if (!exported.success) throw new Error("Missing export");
    expect(exported.data.data.speech_voice_design_prompt).toBe("Warm narration");
    expect(exported.data.data.voice_source_priority).toBe("clone");
    for (const key of ["speech_voice_sample_id", "speech_voice_id", "speech_voice_bindings", "api_key"])
      expect(exported.data.data).not.toHaveProperty(key);
    const png = Buffer.from(await Bun.file("src/db/seed/catalog/personas/default/default.png").arrayBuffer());
    const payloads = [
      JSON.parse(JSON.stringify(exported.data)),
      extractMetadataFromPNG(embedMetadataInPNG(png, exported.data)),
    ];
    for (const [index, payload] of payloads.entries()) {
      const validated = presetRepository.validatePresetFile(payload);
      if (!validated.valid || !validated.data) throw new Error("Invalid portable voice");
      const result = await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, validated.data);
      expect(result.success).toBe(true);
      const alter = await importAlterPreset({
        client: {} as Client,
        guild: null,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        presetData: { ...validated.data, tomori_nickname: `Juno ${index}` },
        identityMode: "fork",
        avatarImageBuffer: null,
      });
      expect(alter.ok).toBe(true);
      if (!alter.ok) throw new Error("Alter import failed");
      for (const personaId of [refs.personaId, alter.personaId]) {
        const [voice] = await testSql`SELECT * FROM persona_voice_configs WHERE persona_id = ${personaId}`;
        expect(voice).toMatchObject({
          speech_voice_design_prompt: "Warm narration",
          voice_source_priority: "clone",
          speech_voice_sample_id: null,
          speech_voice_id: null,
        });
        const reexported = await presetRepository.exportPresetData(FIXTURE_IDS.serverDiscId, personaId);
        expect(reexported.success && reexported.data.data.speech_voice_design_prompt).toBe("Warm narration");
      }
      await testSql`DELETE FROM personas WHERE persona_id = ${alter.personaId}`;
    }
    expect(
      presetRepository.validatePresetData({ ...exported.data.data, speech_voice_design_prompt: "x".repeat(1001) })
        .valid,
    ).toBe(false);
    const legacy = { ...exported.data.data };
    delete legacy.speech_voice_design_prompt;
    delete legacy.voice_source_priority;
    expect((await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, legacy)).success).toBe(true);
    const [voice] = await testSql`SELECT * FROM persona_voice_configs WHERE persona_id = ${refs.personaId}`;
    expect(voice).toMatchObject({ speech_voice_design_prompt: null, voice_source_priority: "design" });
  });

  it("imports normalized main-branch preset trigger words into persona_configs", async () => {
    const presetData: PresetExportData = {
      tomori_nickname: "_rt_imported_persona",
      attribute_list: ["_rt_import_attr"],
      attribute_public_flags: [true],
      sample_dialogues_in: ["_rt_user_line"],
      sample_dialogues_out: ["_rt_persona_line"],
      trigger_words: ['"_rt_legacy_trigger"', "`_rt_legacy_trigger`", "_rt_second_legacy_trigger"],
      persona_prompt: "_rt_persona_prompt",
      persona_lineage_id: refs.personaLineageId,
      physical_appearance_tags: [],
      nai_char_ref_url: null,
      nai_attg_author: null,
      nai_attg_title: null,
      nai_attg_tags: null,
      nai_attg_genre: null,
      nai_attg_stars: null,
    };

    const result = await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, presetData, "preserve");

    expect(result.success).toBe(true);
    if (result.success) expect(result.mainPersonaIsPointer).toBe(false);

    const [personaConfig] = await testSql<Array<{ trigger_words: string[]; persona_prompt: string | null }>>`
      SELECT trigger_words, persona_prompt
      FROM persona_configs
      WHERE persona_id = ${refs.personaId}
      LIMIT 1
    `;

    expect(personaConfig?.trigger_words).toEqual(["_rt_legacy_trigger", "_rt_second_legacy_trigger"]);
    expect(personaConfig?.persona_prompt).toBe("_rt_persona_prompt");

    const attributeRows = await testSql<Array<{ attribute_text: string; is_public: boolean }>>`
      SELECT attribute_text, is_public
      FROM persona_attributes
      WHERE persona_id = ${refs.personaId}
      ORDER BY attribute_order
    `;

    expect(attributeRows).toEqual([{ attribute_text: "_rt_import_attr", is_public: true }]);

    const exportResult = await presetRepository.exportPresetData(FIXTURE_IDS.serverDiscId);
    expect(exportResult.success).toBe(true);
    if (exportResult.success) {
      expect(exportResult.data.data.attribute_public_flags).toEqual([true]);
    }
  });

  it("re-links an exact official preset import to a pointer", async () => {
    const presetLineageId = 900_002;
    const presetName = "_rt_import_pointer_preset";

    try {
      await testSql`
        INSERT INTO persona_presets (
          persona_preset_name,
          persona_preset_desc,
          preset_lineage_id,
          preset_attribute_list,
          preset_attribute_public_flags,
          preset_sample_dialogues_in,
          preset_sample_dialogues_out,
          preset_language,
          preset_trigger_words,
          preset_avatar_path
        )
        VALUES (
          ${presetName},
          '_rt_import_pointer_prompt',
          ${presetLineageId},
          ARRAY['_rt_import_pointer_attr']::TEXT[],
          ARRAY[true]::BOOLEAN[],
          ARRAY['_rt_import_pointer_in']::TEXT[],
          ARRAY['_rt_import_pointer_out']::TEXT[],
          'en-US',
          ARRAY['_rt_import_pointer_trigger']::TEXT[],
          NULL
        )
        ON CONFLICT (persona_preset_name) DO UPDATE SET
          persona_preset_desc = EXCLUDED.persona_preset_desc,
          preset_lineage_id = EXCLUDED.preset_lineage_id,
          preset_attribute_list = EXCLUDED.preset_attribute_list,
          preset_attribute_public_flags = EXCLUDED.preset_attribute_public_flags,
          preset_sample_dialogues_in = EXCLUDED.preset_sample_dialogues_in,
          preset_sample_dialogues_out = EXCLUDED.preset_sample_dialogues_out,
          preset_language = EXCLUDED.preset_language,
          preset_trigger_words = EXCLUDED.preset_trigger_words
      `;

      const presetData: PresetExportData = {
        tomori_nickname: "_rt_import_pointer_persona",
        attribute_list: ["_rt_import_pointer_attr"],
        attribute_public_flags: [true],
        sample_dialogues_in: ["_rt_import_pointer_in"],
        sample_dialogues_out: ["_rt_import_pointer_out"],
        trigger_words: ["_rt_import_pointer_trigger"],
        persona_prompt: "_rt_import_pointer_prompt",
        persona_lineage_id: presetLineageId,
        preset_lineage_id: presetLineageId,
        physical_appearance_tags: [],
        nai_char_ref_url: null,
        nai_attg_author: null,
        nai_attg_title: null,
        nai_attg_tags: null,
        nai_attg_genre: null,
        nai_attg_stars: null,
      };

      const result = await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, presetData, "preserve");
      expect(result.success).toBe(true);
      if (result.success) expect(result.mainPersonaIsPointer).toBe(true);

      const [personaRow] = await testSql<
        Array<{
          is_pointer: boolean;
          preset_lineage_id: number | string | bigint | null;
          preset_language: string | null;
        }>
      >`
        SELECT is_pointer, preset_lineage_id, preset_language
        FROM personas
        WHERE persona_id = ${refs.personaId}
      `;

      expect(personaRow.is_pointer).toBe(true);
      expect(Number(personaRow.preset_lineage_id)).toBe(presetLineageId);
      expect(personaRow.preset_language).toBe("en-US");

      const exportResult = await presetRepository.exportPresetData(FIXTURE_IDS.serverDiscId);
      expect(exportResult.success).toBe(true);
      if (exportResult.success) {
        expect(exportResult.data.data.preset_lineage_id).toBe(presetLineageId);
        expect(exportResult.data.data.attribute_list).toEqual(["_rt_import_pointer_attr"]);
      }
      const voicedData = {
        ...presetData,
        speech_voice_design_prompt: "Warm narration",
        voice_source_priority: "clone" as const,
      };
      const voiced = await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, voicedData);
      expect(voiced.success).toBe(true);
      if (voiced.success) expect(voiced.mainPersonaIsPointer).toBe(false);
      const [voice] =
        await testSql`SELECT p.is_pointer, v.speech_voice_design_prompt, v.voice_source_priority FROM personas p JOIN persona_voice_configs v USING (persona_id) WHERE p.persona_id = ${refs.personaId}`;
      expect(voice).toMatchObject({
        is_pointer: false,
        speech_voice_design_prompt: "Warm narration",
        voice_source_priority: "clone",
      });
    } finally {
      await testSql`
        UPDATE personas
        SET
          persona_nickname = '_rt_persona',
          attribute_list = ARRAY[]::TEXT[],
          sample_dialogues_in = ARRAY[]::TEXT[],
          sample_dialogues_out = ARRAY[]::TEXT[],
          is_pointer = false,
          preset_lineage_id = NULL,
          preset_language = NULL
        WHERE persona_id = ${refs.personaId}
      `;
      await testSql`DELETE FROM persona_attributes WHERE persona_id = ${refs.personaId}`;
      await testSql`
        INSERT INTO persona_configs (persona_id, trigger_words, persona_prompt)
        VALUES (${refs.personaId}, ARRAY['_rt_trigger']::TEXT[], NULL)
        ON CONFLICT (persona_id) DO UPDATE SET
          trigger_words = EXCLUDED.trigger_words,
          persona_prompt = EXCLUDED.persona_prompt
      `;
      await testSql`DELETE FROM persona_presets WHERE persona_preset_name = ${presetName}`;
    }
  });
});
