import type { Client } from "discord.js";
import { createHash } from "node:crypto";
import { encryptApiKey } from "@/utils/security/crypto";
import { saveSpeechVoiceBinding, loadSpeechVoiceBinding } from "@/utils/db/repositories/SpeechRepository";
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
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import type { PersonaAuthoredIdleNudge } from "@/modules/natural-nudges/db/types";
import { FIXTURE_IDS, cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const CARD_NUDGES: PersonaAuthoredIdleNudge[] = [
  {
    id: "stargazing",
    category: "start_topic",
    title: "Stargazing",
    brief: "Have {persona} mention a constellation it saw.",
    agenda_hint: null,
    prerequisites: [],
    recommended_tools: [],
  },
  {
    id: "tea_break",
    category: "revive_topic",
    title: "Tea break",
    brief: "Have {persona} bring the tea conversation back up.",
    agenda_hint: "Get someone to share a tea preference",
    prerequisites: ["hanging_conversation"],
    recommended_tools: ["interact_with_recent_message"],
  },
];

const OTHER_CARD_NUDGES: PersonaAuthoredIdleNudge[] = [
  {
    id: "shelf_talk",
    category: "play_scene",
    title: "Shelf talk",
    brief: "Have {persona} describe a model kit on its shelf.",
    agenda_hint: null,
    prerequisites: [],
    recommended_tools: [],
  },
];

const CARD_PRESET_ATTRIBUTE = "_rt_card_nudge_attr";
const CARD_PRESET_DIALOGUE_IN = "_rt_card_nudge_in";
const CARD_PRESET_DIALOGUE_OUT = "_rt_card_nudge_out";
const CARD_PRESET_TRIGGER = "_rt_card_nudge_trigger";
const CARD_PRESET_PROMPT = "_rt_card_nudge_prompt";

function cardData(nickname: string, overrides: Partial<PresetExportData> = {}): PresetExportData {
  return {
    tomori_nickname: nickname,
    attribute_list: [CARD_PRESET_ATTRIBUTE],
    attribute_public_flags: [true],
    sample_dialogues_in: [CARD_PRESET_DIALOGUE_IN],
    sample_dialogues_out: [CARD_PRESET_DIALOGUE_OUT],
    trigger_words: [CARD_PRESET_TRIGGER],
    persona_prompt: CARD_PRESET_PROMPT,
    physical_appearance_tags: [],
    nai_char_ref_url: null,
    nai_attg_author: null,
    nai_attg_title: null,
    nai_attg_tags: null,
    nai_attg_genre: null,
    nai_attg_stars: null,
    ...overrides,
  };
}

async function insertCardPreset(
  presetName: string,
  presetLineageId: number,
  idleNudges: PersonaAuthoredIdleNudge[],
): Promise<void> {
  await testSql`
    INSERT INTO persona_presets (
      persona_preset_name, persona_preset_desc, preset_language, preset_lineage_id,
      preset_attribute_list, preset_attribute_public_flags, preset_sample_dialogues_in,
      preset_sample_dialogues_out, preset_trigger_words, natural_nudge_idle_nudges
    )
    VALUES (
      ${presetName}, ${CARD_PRESET_PROMPT}, 'en-US', ${presetLineageId},
      ARRAY[${CARD_PRESET_ATTRIBUTE}]::TEXT[], ARRAY[true]::BOOLEAN[],
      ARRAY[${CARD_PRESET_DIALOGUE_IN}]::TEXT[], ARRAY[${CARD_PRESET_DIALOGUE_OUT}]::TEXT[],
      ARRAY[${CARD_PRESET_TRIGGER}]::TEXT[], ${idleNudges}::jsonb
    )
    ON CONFLICT (persona_preset_name) DO UPDATE SET
      persona_preset_desc = EXCLUDED.persona_preset_desc,
      preset_lineage_id = EXCLUDED.preset_lineage_id,
      preset_attribute_list = EXCLUDED.preset_attribute_list,
      preset_attribute_public_flags = EXCLUDED.preset_attribute_public_flags,
      preset_sample_dialogues_in = EXCLUDED.preset_sample_dialogues_in,
      preset_sample_dialogues_out = EXCLUDED.preset_sample_dialogues_out,
      preset_trigger_words = EXCLUDED.preset_trigger_words,
      natural_nudge_idle_nudges = EXCLUDED.natural_nudge_idle_nudges
  `;
}

async function resetMainPersona(personaId: number): Promise<void> {
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
    WHERE persona_id = ${personaId}
  `;
  await testSql`DELETE FROM persona_attributes WHERE persona_id = ${personaId}`;
  await testSql`
    INSERT INTO persona_configs (persona_id, trigger_words, persona_prompt)
    VALUES (${personaId}, ARRAY['_rt_trigger']::TEXT[], NULL)
    ON CONFLICT (persona_id) DO UPDATE SET
      trigger_words = EXCLUDED.trigger_words,
      persona_prompt = EXCLUDED.persona_prompt
  `;
  await testSql`DELETE FROM persona_natural_nudge_configs WHERE persona_id = ${personaId}`;
}

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
    const key = await encryptApiKey("synthetic-card-credential");
    const [credential] = await testSql`
      INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version)
      VALUES (${refs.serverId}, 'google', ${key.encrypted}, ${key.version})
      RETURNING saved_config_id, credential_revision
    `;
    const identity = {
      persona_id: refs.personaId,
      saved_config_id: credential.saved_config_id,
      user_saved_config_id: null,
      credential_revision: credential.credential_revision,
      transport: "google" as const,
      project: "",
      location: "",
      prompt_hash: createHash("sha256").update("Warm narration").digest("hex"),
    };
    await saveSpeechVoiceBinding(identity, "voice_original_card_identity", null);
    const exported = await presetRepository.exportPresetData(FIXTURE_IDS.serverDiscId);
    if (!exported.success) throw new Error("Missing export");
    expect(exported.data.data.speech_voice_design_prompt).toBe("Warm narration");
    expect(exported.data.data.voice_source_priority).toBe("clone");
    for (const key of ["speech_voice_sample_id", "speech_voice_id", "speech_voice_bindings", "api_key"])
      expect(exported.data.data).not.toHaveProperty(key);
    expect(JSON.stringify(exported.data)).not.toContain("voice_original_card_identity");
    expect(JSON.stringify(exported.data)).not.toContain("synthetic-card-credential");
    const png = Buffer.from(await Bun.file("src/db/seed/catalog/personas/default/default.png").arrayBuffer());
    const payloads = [
      JSON.parse(JSON.stringify(exported.data)),
      extractMetadataFromPNG(embedMetadataInPNG(png, exported.data)),
    ];
    for (const [index, payload] of payloads.entries()) {
      const binding = await saveSpeechVoiceBinding(identity, `voice_import_${index}`, null);
      const validated = presetRepository.validatePresetFile(payload);
      if (!validated.valid || !validated.data) throw new Error("Invalid portable voice");
      const result = await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, validated.data);
      expect(result.success).toBe(true);
      expect(await loadSpeechVoiceBinding(identity)).toBeNull();
      const [retired] = await testSql`
        SELECT voice_id, pending_delete FROM speech_voice_bindings
        WHERE speech_voice_binding_id = ${binding.speech_voice_binding_id}
      `;
      expect(retired).toEqual({ voice_id: binding.voice_id, pending_delete: true });
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
      expect(await testSql`SELECT * FROM speech_voice_bindings WHERE persona_id = ${alter.personaId}`).toHaveLength(0);
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

  it("round-trips persona-authored idle nudges through JSON and PNG without availability state or server custom nudges", async () => {
    const customTitle = "_rt_server_custom_nudge";
    try {
      await resetMainPersona(refs.personaId);
      expect(await naturalNudgeRepository.replacePersonaIdleNudges(refs.personaId, CARD_NUDGES)).toBe("success");
      expect(await naturalNudgeRepository.setPersonaIdleNudgeAvailability(refs.personaId, "tea_break", false)).toBe(
        "success",
      );
      await testSql`
        INSERT INTO server_natural_nudge_custom_idle_nudges (
          server_id, category, title, brief, agenda_hint, prerequisites, recommended_tools, enabled
        ) VALUES (
          ${refs.serverId}, 'start_topic', ${customTitle}, 'Server-only nudge content.', NULL,
          ARRAY[]::TEXT[], ARRAY[]::TEXT[], true
        )
      `;

      const exported = await presetRepository.exportPresetData(FIXTURE_IDS.serverDiscId);
      if (!exported.success) throw new Error("Missing export");
      expect(exported.data.data.natural_nudge_idle_nudges).toEqual(CARD_NUDGES);
      expect(JSON.stringify(exported.data)).not.toContain(customTitle);
      expect(JSON.stringify(exported.data)).not.toContain('"enabled"');

      const png = Buffer.from(await Bun.file("src/db/seed/catalog/personas/default/default.png").arrayBuffer());
      const payloads = [
        JSON.parse(JSON.stringify(exported.data)),
        extractMetadataFromPNG(embedMetadataInPNG(png, exported.data)),
      ];
      for (const payload of payloads) {
        const validated = presetRepository.validatePresetFile(payload);
        if (!validated.valid || !validated.data) throw new Error("Invalid portable idle nudges");
        expect(validated.data.natural_nudge_idle_nudges).toEqual(CARD_NUDGES);

        const result = await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, validated.data);
        expect(result.success).toBe(true);
        const config = (await naturalNudgeRepository.loadPersonaConfigs([refs.personaId])).get(refs.personaId);
        expect(config).toMatchObject({
          idle_nudges: CARD_NUDGES,
          disabled_idle_nudge_ids: [],
          idle_nudges_override: true,
        });
        expect(await naturalNudgeRepository.setPersonaIdleNudgeAvailability(refs.personaId, "tea_break", false)).toBe(
          "success",
        );
      }
    } finally {
      await testSql`DELETE FROM server_natural_nudge_custom_idle_nudges WHERE server_id = ${refs.serverId}`;
      await resetMainPersona(refs.personaId);
    }
  });

  it("replaces the previous character's authored definitions and availability on main import", async () => {
    try {
      await resetMainPersona(refs.personaId);
      expect(await naturalNudgeRepository.replacePersonaIdleNudges(refs.personaId, OTHER_CARD_NUDGES)).toBe("success");
      expect(await naturalNudgeRepository.setPersonaIdleNudgeAvailability(refs.personaId, "shelf_talk", false)).toBe(
        "success",
      );

      const imported = cardData("_rt_card_import_main", {
        persona_lineage_id: refs.personaLineageId,
        natural_nudge_idle_nudges: CARD_NUDGES,
      });
      const result = await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, imported);
      expect(result.success).toBe(true);
      if (result.success) expect(result.mainPersonaIsPointer).toBe(false);

      expect((await naturalNudgeRepository.loadPersonaConfigs([refs.personaId])).get(refs.personaId)).toMatchObject({
        idle_nudges: CARD_NUDGES,
        disabled_idle_nudge_ids: [],
        idle_nudges_override: true,
      });

      const reexported = await presetRepository.exportPresetData(FIXTURE_IDS.serverDiscId);
      if (!reexported.success) throw new Error("Missing export");
      expect(reexported.data.data.natural_nudge_idle_nudges).toEqual(CARD_NUDGES);

      const legacy = cardData("_rt_card_import_legacy", { persona_lineage_id: refs.personaLineageId });
      const legacyResult = await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, legacy);
      expect(legacyResult.success).toBe(true);
      expect((await naturalNudgeRepository.loadPersonaConfigs([refs.personaId])).get(refs.personaId)).toMatchObject({
        idle_nudges: [],
        disabled_idle_nudge_ids: [],
      });
    } finally {
      await resetMainPersona(refs.personaId);
    }
  });

  it("matches a seeded authored list semantically and treats an explicit empty or edited list as a customization", async () => {
    const presetName = "_rt_card_nudge_preset";
    const presetLineageId = 900_004;
    try {
      await resetMainPersona(refs.personaId);
      await insertCardPreset(presetName, presetLineageId, CARD_NUDGES);
      const baseCard = cardData("_rt_card_nudge_pointer", {
        persona_lineage_id: refs.personaLineageId,
        preset_lineage_id: presetLineageId,
      });

      const absent = await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, baseCard);
      expect(absent.success).toBe(true);
      if (absent.success) expect(absent.mainPersonaIsPointer).toBe(true);

      const exported = await presetRepository.exportPresetData(FIXTURE_IDS.serverDiscId);
      if (!exported.success) throw new Error("Missing export");
      expect(exported.data.data.natural_nudge_idle_nudges).toEqual(CARD_NUDGES);
      expect(
        await testSql`SELECT 1 FROM persona_natural_nudge_configs WHERE persona_id = ${refs.personaId}`,
      ).toHaveLength(0);
      const [pointerRow] = await testSql`
        SELECT is_pointer FROM personas WHERE persona_id = ${refs.personaId}
      `;
      expect(pointerRow.is_pointer).toBe(true);

      const reorderedList = CARD_NUDGES.map((nudge) => ({
        recommended_tools: nudge.recommended_tools,
        prerequisites: nudge.prerequisites,
        agenda_hint: nudge.agenda_hint,
        brief: nudge.brief,
        title: nudge.title,
        category: nudge.category,
        id: nudge.id,
      }));
      const equivalent = await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, {
        ...baseCard,
        natural_nudge_idle_nudges: reorderedList,
      });
      expect(equivalent.success).toBe(true);
      if (equivalent.success) expect(equivalent.mainPersonaIsPointer).toBe(true);

      const editedList = [{ ...CARD_NUDGES[0], title: "Edited title" }, CARD_NUDGES[1]];
      const edited = await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, {
        ...baseCard,
        natural_nudge_idle_nudges: editedList,
      });
      expect(edited.success).toBe(true);
      if (edited.success) expect(edited.mainPersonaIsPointer).toBe(false);
      expect((await naturalNudgeRepository.loadPersonaConfigs([refs.personaId])).get(refs.personaId)).toMatchObject({
        idle_nudges: editedList,
        idle_nudges_override: true,
      });

      const empty = await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, {
        ...baseCard,
        natural_nudge_idle_nudges: [],
      });
      expect(empty.success).toBe(true);
      if (empty.success) expect(empty.mainPersonaIsPointer).toBe(false);
      expect((await naturalNudgeRepository.loadPersonaConfigs([refs.personaId])).get(refs.personaId)).toMatchObject({
        idle_nudges: [],
        idle_nudges_override: true,
      });
    } finally {
      await testSql`DELETE FROM persona_presets WHERE persona_preset_name = ${presetName}`;
      await resetMainPersona(refs.personaId);
    }
  });

  it("rejects malformed authored lists before writing on main and alter imports", async () => {
    const duplicateList = [CARD_NUDGES[0], { ...CARD_NUDGES[1], id: CARD_NUDGES[0].id }];
    try {
      await resetMainPersona(refs.personaId);
      expect(await naturalNudgeRepository.replacePersonaIdleNudges(refs.personaId, OTHER_CARD_NUDGES)).toBe("success");
      expect(await naturalNudgeRepository.setPersonaIdleNudgeAvailability(refs.personaId, "shelf_talk", false)).toBe(
        "success",
      );

      const malformedMain = cardData("_rt_malformed_main", {
        persona_lineage_id: refs.personaLineageId,
        natural_nudge_idle_nudges: duplicateList,
      });
      const rejectedMain = await presetRepository.importPresetData(FIXTURE_IDS.serverDiscId, malformedMain);
      expect(rejectedMain.success).toBe(false);
      if (!rejectedMain.success) expect(rejectedMain.error).toBe("commands.persona.import.error_invalid_format");

      const [mainRow] = await testSql`
        SELECT persona_nickname FROM personas WHERE persona_id = ${refs.personaId}
      `;
      expect(mainRow.persona_nickname).toBe("_rt_persona");
      expect((await naturalNudgeRepository.loadPersonaConfigs([refs.personaId])).get(refs.personaId)).toMatchObject({
        idle_nudges: OTHER_CARD_NUDGES,
        disabled_idle_nudge_ids: ["shelf_talk"],
      });

      const personasBefore = await testSql`SELECT persona_id FROM personas WHERE server_id = ${refs.serverId}`;
      const rejectedAlter = await importAlterPreset({
        client: {} as Client,
        guild: null,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        presetData: cardData("_rt_malformed_alter", { natural_nudge_idle_nudges: duplicateList }),
        identityMode: "fork",
        avatarImageBuffer: null,
      });
      expect(rejectedAlter.ok).toBe(false);
      const personasAfter = await testSql`SELECT persona_id FROM personas WHERE server_id = ${refs.serverId}`;
      expect(personasAfter).toHaveLength(personasBefore.length);
    } finally {
      await resetMainPersona(refs.personaId);
    }
  });

  it("restores explicit definitions on alter import and leaves an old card without owned definitions", async () => {
    const createdPersonaIds: number[] = [];
    try {
      await resetMainPersona(refs.personaId);

      const imported = await importAlterPreset({
        client: {} as Client,
        guild: null,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        presetData: cardData("_rt_alter_with_nudges", { natural_nudge_idle_nudges: CARD_NUDGES }),
        identityMode: "fork",
        avatarImageBuffer: null,
      });
      expect(imported.ok).toBe(true);
      if (!imported.ok) throw new Error("Alter import failed");
      createdPersonaIds.push(imported.personaId);
      expect(
        (await naturalNudgeRepository.loadPersonaConfigs([imported.personaId])).get(imported.personaId),
      ).toMatchObject({
        idle_nudges: CARD_NUDGES,
        disabled_idle_nudge_ids: [],
        idle_nudges_override: true,
      });
      const reexported = await presetRepository.exportPresetData(FIXTURE_IDS.serverDiscId, imported.personaId);
      if (!reexported.success) throw new Error("Missing alter export");
      expect(reexported.data.data.natural_nudge_idle_nudges).toEqual(CARD_NUDGES);

      const legacy = await importAlterPreset({
        client: {} as Client,
        guild: null,
        serverDiscId: FIXTURE_IDS.serverDiscId,
        presetData: cardData("_rt_alter_without_nudges"),
        identityMode: "fork",
        avatarImageBuffer: null,
      });
      expect(legacy.ok).toBe(true);
      if (!legacy.ok) throw new Error("Legacy alter import failed");
      createdPersonaIds.push(legacy.personaId);
      expect((await naturalNudgeRepository.loadPersonaConfigs([legacy.personaId])).get(legacy.personaId)).toMatchObject(
        {
          idle_nudges: [],
          disabled_idle_nudge_ids: [],
          idle_nudges_override: false,
        },
      );
    } finally {
      for (const personaId of createdPersonaIds) {
        await testSql`DELETE FROM personas WHERE persona_id = ${personaId}`;
      }
      await resetMainPersona(refs.personaId);
    }
  });
});
