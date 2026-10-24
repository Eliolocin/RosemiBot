import { computePersonaNudgeFingerprint, computePersonaNudgeListFingerprint } from "@/modules/natural-nudges/db/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { seedModelsFromCatalog } from "@/db/seed/catalog/modelSeed";
import { llmModelRepo } from "@/utils/db/repositories";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { nudgeStudioOperations } from "@/modules/natural-nudges/discord/studioOperations";
import { NATURAL_NUDGE_FAILURE_STOP_THRESHOLD } from "@/modules/natural-nudges/runtime/tuning";
import { loadPersonaAgendas } from "@/modules/natural-nudges/runtime/agendas";
import {
  defaultServerNaturalNudgeConfig,
  PERSONA_AUTHORED_IDLE_NUDGE_ID_PATTERN,
  type PersonaAuthoredIdleNudge,
} from "@/modules/natural-nudges/db/types";
import { resolveEffectiveChannelIds } from "@/modules/natural-nudges/runtime/channels";
import { idleNudgesPerDay, heatWindowStart } from "@/modules/natural-nudges/runtime/meters";
import { workspaceConfigExportSchema } from "@/types/db/dataExport";
import { exportRepository } from "@/utils/db/repositories/ExportRepository";
import { importRepository } from "@/utils/db/repositories/ImportRepository";
import { personaRepository } from "@/utils/db/repositories/PersonaRepository";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";
import type { PresetExportData } from "@/types/preset/presetExport";
import { resetRepository } from "@/utils/db/repositories/ResetRepository";
import { cache } from "@/utils/cache/tomoriStateCacheStore";
import { getShortTermMemoriesForUser } from "@/utils/cache/shortTermMemoryCache";
import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
import { cleanupFixtures, FIXTURE_IDS, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const PRESET_LINEAGE = 77001;
const PRESET_NAME = "_rt_nudge_preset";
const OTHER_SERVER = "_rt_nudge_other";
const PRESET_INTERESTS = [{ label: "mecha anime", description: "Fiction about giant piloted robots." }];
const PRESET_IDLE_NUDGES: PersonaAuthoredIdleNudge[] = [
  {
    id: "preset_mecha",
    category: "start_topic",
    title: "Mecha shelf",
    brief: "Have {persona} mention a model kit on its shelf.",
    agenda_hint: null,
    prerequisites: [],
    recommended_tools: [],
  },
];

describe.skipIf(!DB_TESTS_AVAILABLE)("Natural Nudges persistence: regression", () => {
  let refs: FixtureRefs;
  let otherPersonaId: number;
  let otherServerId: number;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    await testSql`DELETE FROM persona_natural_nudge_configs WHERE persona_id = ${refs.personaId}`;
    await testSql`DELETE FROM persona_presets WHERE persona_preset_name = ${PRESET_NAME}`;
    await testSql`
      INSERT INTO persona_presets (
        persona_preset_name, persona_preset_desc, preset_language, preset_lineage_id,
        natural_nudge_interests, natural_nudge_talkativeness, preset_trigger_words,
        natural_nudge_idle_nudges
      ) VALUES (
        ${PRESET_NAME}, 'Preset prompt', 'en-US', ${PRESET_LINEAGE}, ${PRESET_INTERESTS}::jsonb, 3,
        ARRAY['nudgy'], ${PRESET_IDLE_NUDGES}::jsonb
      )
    `;
    const [alter] = await testSql`
      INSERT INTO personas (server_id, persona_nickname, is_alter)
      VALUES (${refs.serverId}, '_rt_nudge_alter', true)
      RETURNING persona_id
    `;
    otherPersonaId = alter.persona_id;
    await testSql`DELETE FROM servers WHERE server_disc_id = ${OTHER_SERVER}`;
    const [other] = await testSql`INSERT INTO servers (server_disc_id) VALUES (${OTHER_SERVER}) RETURNING server_id`;
    otherServerId = other.server_id;
  });

  afterAll(async () => {
    cache.delete(FIXTURE_IDS.serverDiscId);
    await testSql`DELETE FROM servers WHERE server_id = ${otherServerId}`;
    await testSql`DELETE FROM persona_presets WHERE persona_preset_name = ${PRESET_NAME}`;
    await cleanupFixtures(testSql);
  });

  it("resolves persona settings from the row, then the live preset, then the defaults", async () => {
    expect((await naturalNudgeRepository.loadPersonaConfigs([refs.personaId])).get(refs.personaId)).toEqual({
      persona_id: refs.personaId,
      talkativeness: 2,
      interests: [],
      idle_nudges: [],
      disabled_idle_nudge_ids: [],
      has_override: false,
      idle_nudges_override: false,
      idle_nudges_inherited: false,
    });

    await testSql`
      UPDATE personas SET is_pointer = true, preset_lineage_id = ${PRESET_LINEAGE}, preset_language = 'en-US'
      WHERE persona_id = ${refs.personaId}
    `;
    expect((await naturalNudgeRepository.loadPersonaConfigs([refs.personaId])).get(refs.personaId)).toMatchObject({
      talkativeness: 3,
      interests: PRESET_INTERESTS,
      idle_nudges: PRESET_IDLE_NUDGES,
      has_override: false,
      idle_nudges_override: false,
      idle_nudges_inherited: true,
    });

    const own = [{ label: "gacha games", description: "Banners, pity, and rare drops." }];
    expect(await naturalNudgeRepository.savePersonaConfig(refs.personaId, { talkativeness: 1, interests: own })).toBe(
      true,
    );
    const [stored] = await testSql`
      SELECT jsonb_typeof(interests) AS kind, authored_idle_nudges
      FROM persona_natural_nudge_configs WHERE persona_id = ${refs.personaId}
    `;
    expect(stored.kind).toBe("array");
    expect(stored.authored_idle_nudges).toBeNull();
    expect((await naturalNudgeRepository.loadPersonaConfigs([refs.personaId])).get(refs.personaId)).toMatchObject({
      talkativeness: 1,
      interests: own,
      idle_nudges: PRESET_IDLE_NUDGES,
      has_override: true,
      idle_nudges_override: false,
      idle_nudges_inherited: true,
    });

    await testSql.begin((tx) => naturalNudgeRepository.clearPersonaConfig(tx, refs.personaId));
    expect(await personaRepository.materializeIfPointer(refs.personaId)).toBe(true);
    const [copied] = await testSql`
      SELECT talkativeness, interests, authored_idle_nudges
      FROM persona_natural_nudge_configs WHERE persona_id = ${refs.personaId}
    `;
    expect(copied).toMatchObject({
      talkativeness: 3,
      interests: PRESET_INTERESTS,
      authored_idle_nudges: PRESET_IDLE_NUDGES,
    });
  });

  describe("persona authored idle nudges", () => {
    const PRESET_LINEAGE_ID = 77002;
    const PRESET_LANGUAGE = "en-US";
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
    const PRESET_LIST = [STARGAZING, TEA_BREAK];
    const PRESET_INTERESTS_OWNED = [{ label: "stargazing", description: "Constellations and night skies." }];
    let personaId: number;

    const draft = (title: string) => ({
      category: "start_topic" as const,
      title,
      brief: `Have {persona} ${title.toLowerCase()}.`,
      agenda_hint: null,
      prerequisites: [] as string[],
      recommended_tools: [] as string[],
    });

    const loadConfig = async () =>
      (await naturalNudgeRepository.loadPersonaConfigs([personaId])).get(personaId) ?? null;

    beforeAll(async () => {
      await testSql`DELETE FROM persona_presets WHERE preset_lineage_id = ${PRESET_LINEAGE_ID}`;
      await testSql`
        INSERT INTO persona_presets (
          persona_preset_name, persona_preset_desc, preset_language, preset_lineage_id,
          natural_nudge_interests, natural_nudge_talkativeness, natural_nudge_idle_nudges
        ) VALUES (
          '_rt_owned_nudges_preset', 'Owned nudge preset', ${PRESET_LANGUAGE}, ${PRESET_LINEAGE_ID},
          ${PRESET_INTERESTS_OWNED}::jsonb, 3, ${PRESET_LIST}::jsonb
        )
      `;
      const [persona] = await testSql`
        INSERT INTO personas (
          server_id, persona_nickname, is_alter, is_pointer, preset_lineage_id, preset_language
        ) VALUES (
          ${refs.serverId}, '_rt_owned_nudges_persona', true, true, ${PRESET_LINEAGE_ID}, ${PRESET_LANGUAGE}
        )
        RETURNING persona_id
      `;
      personaId = persona.persona_id;
    });

    afterAll(async () => {
      await testSql`DELETE FROM personas WHERE persona_id = ${personaId}`;
      await testSql`DELETE FROM persona_presets WHERE preset_lineage_id = ${PRESET_LINEAGE_ID}`;
    });

    beforeEach(async () => {
      await testSql`DELETE FROM persona_natural_nudge_configs WHERE persona_id = ${personaId}`;
      await testSql`
        UPDATE personas SET is_pointer = true, preset_lineage_id = ${PRESET_LINEAGE_ID},
          preset_language = ${PRESET_LANGUAGE}
        WHERE persona_id = ${personaId}
      `;
      await testSql`
        UPDATE persona_presets SET natural_nudge_idle_nudges = ${PRESET_LIST}::jsonb,
          natural_nudge_interests = ${PRESET_INTERESTS_OWNED}::jsonb,
          natural_nudge_talkativeness = 3
        WHERE preset_lineage_id = ${PRESET_LINEAGE_ID}
      `;
    });

    it("inherits the live preset list, and a toggle-created row keeps inheriting it", async () => {
      expect(await loadConfig()).toMatchObject({
        talkativeness: 3,
        interests: PRESET_INTERESTS_OWNED,
        idle_nudges: PRESET_LIST,
        disabled_idle_nudge_ids: [],
        has_override: false,
        idle_nudges_override: false,
        idle_nudges_inherited: true,
      });

      expect(await naturalNudgeRepository.setPersonaIdleNudgeAvailability(personaId, "stargazing", false)).toBe(
        "success",
      );
      expect(await loadConfig()).toMatchObject({
        idle_nudges: PRESET_LIST,
        disabled_idle_nudge_ids: ["stargazing"],
        has_override: true,
        idle_nudges_override: false,
        idle_nudges_inherited: true,
      });
      const [stored] = await testSql`
        SELECT authored_idle_nudges FROM persona_natural_nudge_configs WHERE persona_id = ${personaId}
      `;
      expect(stored.authored_idle_nudges).toBeNull();

      const own = [{ label: "baking", description: "Bread, pastry, and ovens." }];
      expect(await naturalNudgeRepository.savePersonaConfig(personaId, { talkativeness: 1, interests: own })).toBe(
        true,
      );
      expect(await loadConfig()).toMatchObject({
        talkativeness: 1,
        interests: own,
        idle_nudges: PRESET_LIST,
        disabled_idle_nudge_ids: ["stargazing"],
        idle_nudges_override: false,
        idle_nudges_inherited: true,
      });

      expect(await naturalNudgeRepository.setPersonaIdleNudgeAvailability(personaId, "stargazing", true)).toBe(
        "success",
      );
      expect((await loadConfig())?.disabled_idle_nudge_ids).toEqual([]);
    });

    it("edits snapshot the effective list, and restore clears only that list", async () => {
      const own = [{ label: "baking", description: "Bread, pastry, and ovens." }];
      expect(await naturalNudgeRepository.savePersonaConfig(personaId, { talkativeness: 1, interests: own })).toBe(
        true,
      );
      expect(await naturalNudgeRepository.setPersonaIdleNudgeAvailability(personaId, "stargazing", false)).toBe(
        "success",
      );
      expect(await naturalNudgeRepository.addPersonaIdleNudge(personaId, draft("Lantern walk"))).toBe("success");

      let config = await loadConfig();
      expect(config?.idle_nudges).toHaveLength(PRESET_LIST.length + 1);
      expect(config?.idle_nudges.map((nudge) => nudge.id)).toEqual(
        expect.arrayContaining(PRESET_LIST.map((nudge) => nudge.id)),
      );
      const added = config?.idle_nudges.find((nudge) => !PRESET_LIST.some((preset) => preset.id === nudge.id));
      expect(added).toBeDefined();
      expect(added?.id).toMatch(PERSONA_AUTHORED_IDLE_NUDGE_ID_PATTERN);
      expect(config).toMatchObject({ idle_nudges_override: true, idle_nudges_inherited: false });

      expect(
        await naturalNudgeRepository.updatePersonaIdleNudge(personaId, added?.id ?? "", draft("Lantern walk at dusk")),
      ).toBe("success");
      config = await loadConfig();
      expect(config?.idle_nudges.find((nudge) => nudge.id === added?.id)?.title).toBe("Lantern walk at dusk");
      expect(await naturalNudgeRepository.updatePersonaIdleNudge(personaId, "missing", draft("Nope"))).toBe("stale");

      expect(await naturalNudgeRepository.setPersonaIdleNudgeAvailability(personaId, added?.id ?? "", false)).toBe(
        "success",
      );
      await testSql`
        UPDATE persona_presets SET natural_nudge_idle_nudges = ${[STARGAZING]}::jsonb
        WHERE preset_lineage_id = ${PRESET_LINEAGE_ID}
      `;
      expect(
        await naturalNudgeRepository.restorePersonaIdleNudgeList(
          personaId,
          computePersonaNudgeListFingerprint(personaId, config?.idle_nudges ?? []),
        ),
      ).toBe("success");
      config = await loadConfig();
      expect(config).toMatchObject({
        talkativeness: 1,
        interests: own,
        idle_nudges: [STARGAZING],
        disabled_idle_nudge_ids: ["stargazing"],
        idle_nudges_override: false,
        idle_nudges_inherited: true,
      });
      const [restored] = await testSql`
        SELECT authored_idle_nudges FROM persona_natural_nudge_configs WHERE persona_id = ${personaId}
      `;
      expect(restored.authored_idle_nudges).toBeNull();
      expect(
        await naturalNudgeRepository.restorePersonaIdleNudgeList(
          personaId,
          computePersonaNudgeListFingerprint(personaId, [STARGAZING]),
        ),
      ).toBe("unchanged");
    });

    it("rejects stale removal and restore fingerprints without discarding newer content", async () => {
      expect(await naturalNudgeRepository.replacePersonaIdleNudges(personaId, PRESET_LIST)).toBe("success");
      const entryFp = computePersonaNudgeFingerprint(personaId, STARGAZING);
      const listFp = computePersonaNudgeListFingerprint(personaId, PRESET_LIST);
      const edited = { ...STARGAZING, ...draft("New constellation") };
      expect(
        await naturalNudgeRepository.updatePersonaIdleNudge(personaId, STARGAZING.id, draft("New constellation")),
      ).toBe("success");
      expect(await naturalNudgeRepository.setPersonaIdleNudgeAvailability(personaId, STARGAZING.id, false)).toBe(
        "success",
      );

      expect(await naturalNudgeRepository.removePersonaIdleNudge(personaId, STARGAZING.id, entryFp)).toBe("stale");
      expect(await naturalNudgeRepository.restorePersonaIdleNudgeList(personaId, listFp)).toBe("stale");
      expect(await loadConfig()).toMatchObject({
        idle_nudges: [edited, TEA_BREAK],
        disabled_idle_nudge_ids: [STARGAZING.id],
        idle_nudges_override: true,
      });

      expect(
        await naturalNudgeRepository.removePersonaIdleNudge(
          personaId,
          STARGAZING.id,
          computePersonaNudgeFingerprint(personaId, edited),
        ),
      ).toBe("success");
      expect(await loadConfig()).toMatchObject({ idle_nudges: [TEA_BREAK], disabled_idle_nudge_ids: [] });
      expect(
        await naturalNudgeRepository.restorePersonaIdleNudgeList(
          personaId,
          computePersonaNudgeListFingerprint(personaId, [TEA_BREAK]),
        ),
      ).toBe("success");
      expect(await loadConfig()).toMatchObject({ idle_nudges: PRESET_LIST, idle_nudges_inherited: true });
      expect(await personaRepository.materializeIfPointer(personaId)).toBe(true);
      expect(
        await naturalNudgeRepository.restorePersonaIdleNudgeList(
          personaId,
          computePersonaNudgeListFingerprint(personaId, PRESET_LIST),
        ),
      ).toBe("stale");
      expect(await loadConfig()).toMatchObject({ idle_nudges: PRESET_LIST, idle_nudges_override: true });
    });

    it("stores an explicit empty list and rejects malformed or over-limit definitions", async () => {
      expect(await naturalNudgeRepository.replacePersonaIdleNudges(personaId, [])).toBe("success");
      expect(await loadConfig()).toMatchObject({
        idle_nudges: [],
        idle_nudges_override: true,
        idle_nudges_inherited: false,
      });

      expect(await naturalNudgeRepository.replacePersonaIdleNudges(personaId, [STARGAZING, STARGAZING])).toBe(
        "invalid",
      );
      expect(await naturalNudgeRepository.replacePersonaIdleNudges(personaId, [{ ...STARGAZING, id: "bad/id" }])).toBe(
        "invalid",
      );
      expect(
        await naturalNudgeRepository.replacePersonaIdleNudges(personaId, [
          { ...STARGAZING, prerequisites: ["not_a_prerequisite"] },
        ]),
      ).toBe("invalid");
      expect(
        await naturalNudgeRepository.replacePersonaIdleNudges(personaId, [
          { ...STARGAZING, recommended_tools: ["not_a_tool"] },
        ]),
      ).toBe("invalid");

      expect(await naturalNudgeRepository.addPersonaIdleNudge(personaId, draft("Slug entry"), "lantern-walk")).toBe(
        "success",
      );
      expect(await naturalNudgeRepository.addPersonaIdleNudge(personaId, draft("Duplicate"), "lantern-walk")).toBe(
        "invalid",
      );
      expect((await loadConfig())?.idle_nudges.map((nudge) => nudge.id)).toEqual(["lantern-walk"]);

      const full = Array.from({ length: 20 }, (_, index) => ({ ...STARGAZING, id: `entry_${index}` }));
      expect(await naturalNudgeRepository.replacePersonaIdleNudges(personaId, full)).toBe("success");
      expect(await naturalNudgeRepository.addPersonaIdleNudge(personaId, draft("Overflow"))).toBe("limit");
    });

    it("refuses to overwrite unreadable stored content", async () => {
      expect(await naturalNudgeRepository.replacePersonaIdleNudges(personaId, [STARGAZING])).toBe("success");
      await testSql`
        UPDATE persona_natural_nudge_configs
        SET authored_idle_nudges = '[{"id":"bad/id","category":"start_topic"}]'::jsonb
        WHERE persona_id = ${personaId}
      `;
      expect((await naturalNudgeRepository.loadPersonaConfigs([personaId])).has(personaId)).toBe(false);
      expect(await naturalNudgeRepository.addPersonaIdleNudge(personaId, draft("Should not write"))).toBe(
        "write-failed",
      );
      expect(await naturalNudgeRepository.setPersonaIdleNudgeAvailability(personaId, "stargazing", false)).toBe(
        "write-failed",
      );
      const [stored] = await testSql`
        SELECT authored_idle_nudges FROM persona_natural_nudge_configs WHERE persona_id = ${personaId}
      `;
      expect(stored.authored_idle_nudges).toEqual([{ id: "bad/id", category: "start_topic" }]);

      await testSql`
        UPDATE persona_natural_nudge_configs SET authored_idle_nudges = NULL, disabled_idle_nudge_ids = '[1]'::jsonb
        WHERE persona_id = ${personaId}
      `;
      expect(
        await naturalNudgeRepository.restorePersonaIdleNudgeList(
          personaId,
          computePersonaNudgeListFingerprint(personaId, PRESET_LIST),
        ),
      ).toBe("write-failed");
    });

    it("copies the inherited list when an existing customization row materializes", async () => {
      const own = [{ label: "baking", description: "Bread, pastry, and ovens." }];
      expect(await naturalNudgeRepository.savePersonaConfig(personaId, { talkativeness: 1, interests: own })).toBe(
        true,
      );
      expect(await naturalNudgeRepository.setPersonaIdleNudgeAvailability(personaId, "stargazing", false)).toBe(
        "success",
      );
      expect(await personaRepository.materializeIfPointer(personaId)).toBe(true);
      expect(await loadConfig()).toMatchObject({
        talkativeness: 1,
        interests: own,
        idle_nudges: PRESET_LIST,
        disabled_idle_nudge_ids: ["stargazing"],
        idle_nudges_override: true,
        idle_nudges_inherited: false,
      });
    });

    it("keeps a local list through materialization", async () => {
      expect(await naturalNudgeRepository.addPersonaIdleNudge(personaId, draft("Local only"), "local_only")).toBe(
        "success",
      );
      expect(await personaRepository.materializeIfPointer(personaId)).toBe(true);
      expect((await loadConfig())?.idle_nudges.map((nudge) => nudge.id)).toEqual([
        "stargazing",
        "tea_break",
        "local_only",
      ]);
    });

    it("keeps authored content through a server reset and drops it on re-point and deletion", async () => {
      expect(await naturalNudgeRepository.addPersonaIdleNudge(personaId, draft("Keep me"), "keep_me")).toBe("success");
      await resetRepository.resetServerConfiguration(refs.serverId);
      expect((await loadConfig())?.idle_nudges.map((nudge) => nudge.id)).toEqual([
        "stargazing",
        "tea_break",
        "keep_me",
      ]);

      const [preset] = await testSql`
        SELECT * FROM persona_presets WHERE preset_lineage_id = ${PRESET_LINEAGE_ID}
      `;
      expect(
        await personaRepository.applyPresetPointerToPersona({
          personaId,
          nickname: "_rt_owned_nudges_persona",
          preset,
        }),
      ).not.toBeNull();
      expect(await loadConfig()).toMatchObject({
        idle_nudges: PRESET_LIST,
        disabled_idle_nudge_ids: [],
        has_override: false,
        idle_nudges_override: false,
        idle_nudges_inherited: true,
      });

      const [throwaway] = await testSql`
        INSERT INTO personas (server_id, persona_nickname, is_alter)
        VALUES (${refs.serverId}, '_rt_owned_nudges_throwaway', true)
        RETURNING persona_id
      `;
      expect(
        await naturalNudgeRepository.savePersonaConfig(throwaway.persona_id, { talkativeness: 2, interests: [] }),
      ).toBe(true);
      expect(await personaRepository.removePersona(throwaway.persona_id)).toBe(true);
      const [gone] = await testSql`
        SELECT COUNT(*)::int AS count FROM persona_natural_nudge_configs WHERE persona_id = ${throwaway.persona_id}
      `;
      expect(gone.count).toBe(0);
    });
  });

  describe("on by default", () => {
    const now = new Date();
    const daysAgo = (days: number) =>
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days)).toISOString().slice(0, 10);
    const serverIds: number[] = [];

    async function insertServer(discId: string, isDm = false): Promise<number> {
      await testSql`DELETE FROM servers WHERE server_disc_id = ${discId}`;
      const [row] = await testSql`
        INSERT INTO servers (server_disc_id, is_dm_channel) VALUES (${discId}, ${isDm}) RETURNING server_id
      `;
      serverIds.push(row.server_id);
      return row.server_id;
    }

    async function recordStat(serverId: number, metric: string, metricKey: string, bucket: string): Promise<void> {
      await testSql`
        INSERT INTO stat_counters (server_id, user_id, persona_lineage_id, metric, metric_key, bucket, count)
        VALUES (${serverId}, ${refs.userId}, 0, ${metric}, ${metricKey}, ${bucket}::date, 1)
      `;
    }

    afterAll(async () => {
      await testSql`DELETE FROM servers WHERE server_id = ANY(${testSql.array(serverIds, "INT")})`;
    });

    it("lists a heated server with no settings row on defaults, and skips cold, DM, and turned-off ones", async () => {
      const heated = await insertServer("_rt_nudge_heated");
      const cold = await insertServer("_rt_nudge_cold");
      const dm = await insertServer("_rt_nudge_dm", true);
      const off = await insertServer("_rt_nudge_off");
      await recordStat(heated, "message_sent", "", daysAgo(0));
      await recordStat(cold, "message_sent", "", daysAgo(45));
      await recordStat(dm, "message_sent", "", daysAgo(0));
      await recordStat(off, "message_sent", "", daysAgo(0));
      expect(await naturalNudgeRepository.saveServerConfig(off, { idle_nudges_enabled: false })).toBe(true);

      const listed = await naturalNudgeRepository.listEnabledIdleNudgeServers(heatWindowStart(now));
      const ours = listed.filter((server) => serverIds.includes(server.server_id));
      expect(ours.map((server) => server.server_id)).toEqual([heated]);
      expect(ours[0]?.config).toEqual(defaultServerNaturalNudgeConfig(heated));
      expect(ours[0]?.config.idle_nudges_enabled).toBe(true);
      expect(idleNudgesPerDay(1_000, ours[0]?.config.idle_nudge_frequency ?? 0)).toBe(3);
    });

    it("picks automatic channels from 14 days of turns minus roleplay channels, unless a list overrides them", async () => {
      const serverId = await insertServer("_rt_nudge_channels");
      await recordStat(serverId, "channel_turn", "1400000000000000001", daysAgo(0));
      await recordStat(serverId, "channel_turn", "1400000000000000002", daysAgo(13));
      await recordStat(serverId, "channel_turn", "1400000000000000003", daysAgo(14));
      await recordStat(serverId, "channel_turn", "1400000000000000004", daysAgo(0));
      await testSql`
        INSERT INTO server_channel_scope_configs (server_id, rp_channel_ids)
        VALUES (${serverId}, ARRAY['1400000000000000004'])
      `;

      expect(await resolveEffectiveChannelIds(serverId, { channel_disc_ids: [] }, now)).toEqual([
        "1400000000000000001",
        "1400000000000000002",
      ]);
      expect(await resolveEffectiveChannelIds(serverId, { channel_disc_ids: ["1400000000000000009"] }, now)).toEqual([
        "1400000000000000009",
      ]);
    });
  });

  describe("Ping User nudge candidates", () => {
    const PREFIX = "_rt_reach_";
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const userIds = new Map<string, number>();

    async function insertUser(
      name: string,
      options: { privacy?: number; optOut?: boolean; spokeOn?: string; spokeToLineage?: number },
    ) {
      const discId = `${PREFIX}${name}`;
      const [row] = await testSql`
        INSERT INTO users (user_disc_id, privacy_level) VALUES (${discId}, ${options.privacy ?? 0}) RETURNING user_id
      `;
      userIds.set(name, row.user_id);
      await testSql`
        INSERT INTO user_personalization_configs (user_id, natural_nudge_opt_out)
        VALUES (${row.user_id}, ${options.optOut ?? false})
      `;
      await testSql`
        INSERT INTO stat_counters (server_id, user_id, persona_lineage_id, metric, metric_key, bucket, count)
        VALUES (
          ${refs.serverId}, ${row.user_id}, ${options.spokeToLineage ?? refs.personaLineageId},
          'message_sent', '', ${options.spokeOn ?? today}::date, 1
        )
      `;
      return { discId, userId: row.user_id as number };
    }

    beforeAll(async () => {
      await testSql`DELETE FROM users WHERE user_disc_id LIKE ${`${PREFIX}%`}`;
      const mirri = await insertUser("mirri", {});
      await testSql`
        INSERT INTO personal_memories (user_id, persona_lineage_id, content, created_at, updated_at)
        VALUES
          (${mirri.userId}, ${refs.personaLineageId}, 'Has an exam on Friday', ${daysAgo(2)}, ${daysAgo(2)}),
          (${mirri.userId}, 0, 'Plays the cello', ${daysAgo(60)}, ${daysAgo(60)}),
          (${mirri.userId}, 991, 'Another lineage only', ${daysAgo(1)}, ${daysAgo(1)})
      `;
      await insertUser("stale", { spokeOn: daysAgo(20).toISOString().slice(0, 10) });
      const elsewhere = await insertUser("elsewhere", { spokeToLineage: 991 });
      await testSql`
        INSERT INTO personal_memories (user_id, persona_lineage_id, content, created_at, updated_at)
        VALUES (${elsewhere.userId}, ${refs.personaLineageId}, 'Close to this persona in another server', ${daysAgo(1)}, ${daysAgo(1)})
      `;
      await insertUser("optout", { optOut: true });
      await insertUser("hidden", { privacy: 2 });
      const banned = await insertUser("banned", {});
      await testSql`
        INSERT INTO personalization_blacklist (server_id, user_disc_id) VALUES (${refs.serverId}, ${banned.discId})
      `;
      const blocked = await insertUser("blocked", {});
      const unblocked = await insertUser("unblocked", {});
      await testSql`
        INSERT INTO persona_user_blocks (server_id, persona_id, user_disc_id, block_type, reason, expires_at)
        VALUES
          (${refs.serverId}, ${refs.personaId}, ${blocked.discId}, 'block', 'rude', NOW() + INTERVAL '1 day'),
          (${refs.serverId}, ${refs.personaId}, ${unblocked.discId}, 'mute', 'rude', NOW() - INTERVAL '1 day')
      `;
    });

    afterAll(async () => {
      await testSql`DELETE FROM personalization_blacklist WHERE user_disc_id LIKE ${`${PREFIX}%`}`;
      await testSql`DELETE FROM persona_user_blocks WHERE user_disc_id LIKE ${`${PREFIX}%`}`;
      await testSql`DELETE FROM short_term_memories WHERE user_disc_id LIKE ${`${PREFIX}%`}`;
      await testSql`DELETE FROM users WHERE user_disc_id LIKE ${`${PREFIX}%`}`;
    });

    const list = (onlyUserId?: number) =>
      naturalNudgeRepository.listPingUserCandidates({
        serverId: refs.serverId,
        personaId: refs.personaId,
        personaLineageId: refs.personaLineageId,
        interactedSince: daysAgo(14),
        memorySince: daysAgo(30),
        onlyUserId,
      });

    it("keeps only members who talked to this persona here and pass every hard exclusion, with their local turns", async () => {
      const ours = (await list()).filter((candidate) => candidate.user_disc_id.startsWith(PREFIX));
      expect(ours.map((candidate) => candidate.user_disc_id).sort()).toEqual([`${PREFIX}mirri`, `${PREFIX}unblocked`]);
      expect(ours.find((candidate) => candidate.user_disc_id === `${PREFIX}mirri`)).toMatchObject({
        local_turns: 1,
        ltm_recent: 1,
      });
    });

    it("re-checks one drawn target, and drops them once they opt out", async () => {
      const mirriId = userIds.get("mirri") as number;
      expect((await list(mirriId)).map((candidate) => candidate.user_id)).toEqual([mirriId]);
      await testSql`UPDATE user_personalization_configs SET natural_nudge_opt_out = true WHERE user_id = ${mirriId}`;
      expect(await list(mirriId)).toEqual([]);
    });

    it("finds a stored short-term memory for a candidate after a restart left the cache empty", async () => {
      const discId = `${PREFIX}unblocked`;
      await testSql`
        INSERT INTO short_term_memories
          (server_disc_id, user_disc_id, channel_disc_id, persona_id, persona_lineage_id, scope_kind, summary)
        VALUES
          (${FIXTURE_IDS.serverDiscId}, ${discId}, '1200000000000000005', ${refs.personaId},
            ${refs.personaLineageId}, 'user', 'Talked about the cello recital')
      `;
      expect(getShortTermMemoriesForUser(discId, undefined, refs.personaLineageId)).toEqual([]);
      await shortTermMemoryRepository.preWarmUsers([discId]);
      expect(
        getShortTermMemoriesForUser(discId, undefined, refs.personaLineageId).map((entry) => entry.channelId),
      ).toEqual(["1200000000000000005"]);
    });

    it("records who a Ping User nudge pinged on the fire and its agenda", async () => {
      const mirriId = userIds.get("mirri") as number;
      const openerId = "1300000000000000077";
      expect(
        await naturalNudgeRepository.recordIdleNudgeFire(
          {
            serverId: refs.serverId,
            channelDiscId: "1200000000000000001",
            personaId: refs.personaId,
            category: "ping_user",
            idleNudgeKey: "ping_user.memory_callback",
            targetUserId: mirriId,
            openerMessageDiscId: openerId,
          },
          [{ personaId: refs.personaId, agenda: "Find out how the exam went." }],
        ),
      ).toBe(true);
      const history = await naturalNudgeRepository.loadFireHistory(refs.serverId, new Date(0), 5);
      expect(history.recent.find((fire) => fire.opener_message_disc_id === openerId)?.target_user_id).toBe(mirriId);
      const [agenda] =
        await testSql`SELECT target_user_id FROM natural_nudge_agendas WHERE message_disc_id = ${openerId}`;
      expect(agenda?.target_user_id).toBe(mirriId);
    });

    it("loads the latest fire of each idle nudge for one persona and target, and nothing else", async () => {
      const mirriId = userIds.get("mirri") as number;
      const unblockedId = userIds.get("unblocked") as number;
      await testSql`DELETE FROM natural_nudge_fires WHERE server_id = ${refs.serverId}`;
      const fires = [
        { personaId: refs.personaId, targetId: mirriId, key: "ping_user.new_look", firedAt: daysAgo(10) },
        { personaId: refs.personaId, targetId: mirriId, key: "ping_user.new_look", firedAt: daysAgo(2) },
        { personaId: refs.personaId, targetId: mirriId, key: "ping_user.favor_ask", firedAt: daysAgo(20) },
        { personaId: otherPersonaId, targetId: mirriId, key: "ping_user.check_in", firedAt: daysAgo(1) },
        { personaId: refs.personaId, targetId: unblockedId, key: "ping_user.remind_you", firedAt: daysAgo(1) },
      ];
      for (const [index, fire] of fires.entries()) {
        await testSql`
          INSERT INTO natural_nudge_fires
            (server_id, channel_disc_id, persona_id, mode, category, idle_nudge_key, target_user_id,
              opener_message_disc_id, fired_at)
          VALUES (${refs.serverId}, '1200000000000000001', ${fire.personaId}, 'idle', 'ping_user', ${fire.key},
            ${fire.targetId}, ${`13000000000000010${index}`}, ${fire.firedAt})
        `;
      }
      await naturalNudgeRepository.recordActiveNudgeFire({
        serverId: refs.serverId,
        channelDiscId: "1200000000000000001",
        personaId: refs.personaId,
        openerMessageDiscId: "1300000000000000199",
        detour: false,
      });

      const latest = await naturalNudgeRepository.loadTargetIdleNudgeFires(
        refs.serverId,
        refs.personaId,
        mirriId,
        daysAgo(14),
      );
      expect([...latest.keys()]).toEqual(["ping_user.new_look"]);
      expect(latest.get("ping_user.new_look")?.getTime()).toBe(fires[1].firedAt.getTime());
      await testSql`DELETE FROM natural_nudge_fires WHERE server_id = ${refs.serverId}`;
    });
  });

  it("re-points an imported card only when its Nudges settings match the preset", async () => {
    const [preset] = await testSql`SELECT * FROM persona_presets WHERE persona_preset_name = ${PRESET_NAME}`;
    const card = (nudges: Partial<PresetExportData>) =>
      ({
        tomori_nickname: "Nudge Preset",
        preset_lineage_id: PRESET_LINEAGE,
        attribute_list: preset.preset_attribute_list,
        sample_dialogues_in: preset.preset_sample_dialogues_in,
        sample_dialogues_out: preset.preset_sample_dialogues_out,
        trigger_words: preset.preset_trigger_words,
        persona_prompt: preset.persona_preset_desc,
        naming_config: preset.preset_naming_config,
        ...nudges,
      }) as PresetExportData;

    expect(await presetRepository.findMatchingOfficialPresetForImport(card({}))).not.toBeNull();
    expect(
      await presetRepository.findMatchingOfficialPresetForImport(
        card({ natural_nudge_talkativeness: 3, natural_nudge_interests: PRESET_INTERESTS }),
      ),
    ).not.toBeNull();
    expect(
      await presetRepository.findMatchingOfficialPresetForImport(card({ natural_nudge_talkativeness: 1 })),
    ).toBeNull();
    expect(
      await presetRepository.findMatchingOfficialPresetForImport(
        card({ natural_nudge_interests: [...PRESET_INTERESTS, { label: "trains", description: "Rail travel." }] }),
      ),
    ).toBeNull();
  });

  it("anchors every scene speaker's agenda to the opener, and each speaker reads only its own", async () => {
    const openerId = "1300000000000000001";
    expect(
      await naturalNudgeRepository.recordIdleNudgeFire(
        {
          serverId: refs.serverId,
          channelDiscId: "1200000000000000001",
          personaId: refs.personaId,
          category: "play_scene",
          idleNudgeKey: "play_scene.banter",
          targetUserId: null,
          openerMessageDiscId: openerId,
        },
        [
          { personaId: refs.personaId, agenda: "Win the mecha argument." },
          { personaId: otherPersonaId, agenda: "Get a human to take your side." },
        ],
      ),
    ).toBe(true);

    expect((await loadPersonaAgendas(refs.personaId, [openerId])).get(openerId)).toBe("Win the mecha argument.");
    expect((await loadPersonaAgendas(otherPersonaId, [openerId])).get(openerId)).toBe("Get a human to take your side.");

    const history = await naturalNudgeRepository.loadFireHistory(refs.serverId, new Date(0), 5);
    expect(history.latestIdleNudges[0]).toMatchObject({ opener_message_disc_id: openerId, answered: null });
    await naturalNudgeRepository.setFireAnswered(history.latestIdleNudges[0].fire_id, true);
    const answered = await naturalNudgeRepository.loadFireHistory(refs.serverId, new Date(0), 5);
    expect(answered.latestIdleNudges[0]?.answered).toBe(true);
  });

  it("stops a server after repeated failures and lifts the stop when cleared", async () => {
    let state = null;
    for (let attempt = 0; attempt < NATURAL_NUDGE_FAILURE_STOP_THRESHOLD; attempt++) {
      state = await naturalNudgeRepository.recordFailure(refs.serverId);
      if (attempt < NATURAL_NUDGE_FAILURE_STOP_THRESHOLD - 1) expect(state?.stopped_at).toBeNull();
    }
    expect(state?.stopped_at).toBeInstanceOf(Date);
    await naturalNudgeRepository.clearFailures(refs.serverId);
    expect(await naturalNudgeRepository.loadRuntimeState(refs.serverId)).toMatchObject({
      consecutive_failures: 0,
      stopped_at: null,
    });
  });

  it("refuses a custom idle nudge past the cap", async () => {
    const idleNudge = {
      category: "start_topic" as const,
      title: "Riddle",
      brief: "Have {persona} pose a riddle.",
      agenda_hint: null,
      prerequisites: [],
      recommended_tools: [],
      enabled: true,
    };
    expect(typeof (await naturalNudgeRepository.insertCustomIdleNudge(refs.serverId, idleNudge, 1))).toBe("number");
    expect(await naturalNudgeRepository.insertCustomIdleNudge(refs.serverId, idleNudge, 1)).toBe("limit");
  });

  it("stores a tool picked as both a prerequisite and a recommendation only as a prerequisite", async () => {
    expect(
      await nudgeStudioOperations.addCustomIdleNudge(refs.serverId, "start_topic", {
        title: "Fresh news",
        brief: "Have {persona} share some news.",
        agendaHint: "",
        prerequisites: ["tool:web_search"],
        recommendedTools: ["web_search", "fetch_url"],
      }),
    ).toBe("success");
    const [saved] = (await naturalNudgeRepository.listCustomIdleNudges(refs.serverId)).filter(
      (row) => row.title === "Fresh news",
    );
    expect(saved?.prerequisites).toEqual(["tool:web_search"]);
    expect(saved?.recommended_tools).toEqual(["fetch_url"]);
    await naturalNudgeRepository.deleteCustomIdleNudges(refs.serverId, [saved.custom_idle_nudge_id]);
  });

  it("exports settings and custom idle nudges without channels, imports them, and resets them", async () => {
    await naturalNudgeRepository.saveServerConfig(refs.serverId, {
      idle_nudges_enabled: false,
      active_nudges_enabled: false,
      channel_disc_ids: ["1200000000000000001"],
      idle_nudge_frequency: 2,
      active_nudge_frequency: 3,
      disabled_builtin_idle_nudges: ["start_topic.voice_note"],
    });
    const result = await exportRepository.exportWorkspaceConfig(FIXTURE_IDS.serverDiscId);
    expect(result.success).toBe(true);
    const exported = workspaceConfigExportSchema.parse(result.data);
    expect(exported.data.nudges).toMatchObject({
      idle_nudges_enabled: false,
      active_nudges_enabled: false,
      idle_nudge_frequency: 2,
      active_nudge_frequency: 3,
    });
    expect(exported.data.nudges?.custom_idle_nudges).toHaveLength(1);
    expect(JSON.stringify(exported.data.nudges)).not.toContain("1200000000000000001");

    expect((await importRepository.importWorkspaceConfig(OTHER_SERVER, exported, ["nudges"])).success).toBe(true);
    const imported = await naturalNudgeRepository.loadServerConfig(otherServerId);
    expect(imported).toMatchObject({
      idle_nudges_enabled: false,
      active_nudges_enabled: false,
      idle_nudge_frequency: 2,
      active_nudge_frequency: 3,
      channel_disc_ids: [],
      disabled_builtin_idle_nudges: ["start_topic.voice_note"],
    });
    expect(await naturalNudgeRepository.listCustomIdleNudges(otherServerId)).toHaveLength(1);

    await resetRepository.resetServerConfiguration(refs.serverId);
    // The code defaults stand in for a missing row, so they must equal what the columns reset to.
    expect(await naturalNudgeRepository.loadServerConfig(refs.serverId)).toEqual(
      defaultServerNaturalNudgeConfig(refs.serverId),
    );
    expect(await naturalNudgeRepository.listCustomIdleNudges(refs.serverId)).toHaveLength(0);
  });

  it("saves built-in and custom availability, and removes only the named custom idle nudges", async () => {
    const idleNudge = {
      category: "ping_user" as const,
      title: "Snack check",
      brief: "Have {persona} ask {target} about snacks.",
      agenda_hint: null,
      prerequisites: [],
      recommended_tools: [],
      enabled: true,
    };
    const first = await naturalNudgeRepository.insertCustomIdleNudge(refs.serverId, idleNudge, 25);
    const second = await naturalNudgeRepository.insertCustomIdleNudge(refs.serverId, idleNudge, 25);
    if (typeof first !== "number" || typeof second !== "number")
      throw new Error("Custom idle nudge fixtures were not inserted");

    const off = { enabled: false } as const;
    expect(await naturalNudgeRepository.saveIdleNudgeAvailability(refs.serverId, "ping_user.check_in", null, off)).toBe(
      true,
    );
    expect(await naturalNudgeRepository.saveIdleNudgeAvailability(refs.serverId, `custom:${first}`, first, off)).toBe(
      true,
    );
    expect((await naturalNudgeRepository.loadServerConfig(refs.serverId)).disabled_builtin_idle_nudges).toEqual([
      "ping_user.check_in",
    ]);
    const enabled = (await naturalNudgeRepository.listCustomIdleNudges(refs.serverId)).map((row) => [
      row.custom_idle_nudge_id,
      row.enabled,
    ]);
    expect(enabled).toEqual([
      [first, false],
      [second, true],
    ]);

    expect(await naturalNudgeRepository.deleteCustomIdleNudges(refs.serverId, [first, 999_999])).toBe(1);
    expect(
      (await naturalNudgeRepository.listCustomIdleNudges(refs.serverId)).map((row) => row.custom_idle_nudge_id),
    ).toEqual([second]);
    await naturalNudgeRepository.deleteCustomIdleNudges(refs.serverId, [second]);
    await naturalNudgeRepository.saveServerConfig(refs.serverId, { disabled_builtin_idle_nudges: [] });
  });

  it("drops a custom idle nudge's persona scope with it, on import, and on reset, but keeps built-in scopes until reset", async () => {
    const idleNudge = {
      category: "start_topic" as const,
      title: "Song swap",
      brief: "Have {persona} share a song.",
      agenda_hint: null,
      prerequisites: [],
      recommended_tools: [],
      enabled: true,
    };
    const scoped = (...scope: number[]) => ({ enabled: true, scope }) as const;
    const insertScoped = async () => {
      const id = await naturalNudgeRepository.insertCustomIdleNudge(refs.serverId, idleNudge, 25);
      if (typeof id !== "number") throw new Error("Custom idle nudge fixture was not inserted");
      expect(
        await naturalNudgeRepository.saveIdleNudgeAvailability(
          refs.serverId,
          `custom:${id}`,
          id,
          scoped(refs.personaId),
        ),
      ).toBe(true);
      return id;
    };
    const scopedKeys = async () => [...(await naturalNudgeRepository.loadPersonaScopes(refs.serverId)).keys()].sort();

    expect(
      await naturalNudgeRepository.saveIdleNudgeAvailability(
        refs.serverId,
        "start_topic.hot_take",
        null,
        scoped(refs.personaId, otherPersonaId),
      ),
    ).toBe(true);
    expect((await naturalNudgeRepository.loadPersonaScopes(refs.serverId)).get("start_topic.hot_take")).toEqual([
      refs.personaId,
      otherPersonaId,
    ]);
    const removed = await insertScoped();
    expect(await scopedKeys()).toEqual([`custom:${removed}`, "start_topic.hot_take"]);
    await naturalNudgeRepository.deleteCustomIdleNudges(refs.serverId, [removed]);
    expect(await scopedKeys()).toEqual(["start_topic.hot_take"]);

    await insertScoped();
    await testSql.transaction((tx) => naturalNudgeRepository.replaceCustomIdleNudges(refs.serverId, [idleNudge], tx));
    expect(await scopedKeys()).toEqual(["start_topic.hot_take"]);

    await resetRepository.resetServerConfiguration(refs.serverId);
    expect(await scopedKeys()).toEqual([]);
  });

  it("drops a scope when its idle nudge opens to everyone or turns off, and turning off disables it", async () => {
    const key = "ping_user.remind_you";
    const save = (availability: Parameters<typeof naturalNudgeRepository.saveIdleNudgeAvailability>[3]) =>
      naturalNudgeRepository.saveIdleNudgeAvailability(refs.serverId, key, null, availability);
    const hasScope = async () => (await naturalNudgeRepository.loadPersonaScopes(refs.serverId)).has(key);

    await save({ enabled: true, scope: [refs.personaId] });
    expect(await save({ enabled: true, scope: null })).toBe(true);
    expect(await hasScope()).toBe(false);

    await save({ enabled: true, scope: [refs.personaId] });
    expect(await save({ enabled: false })).toBe(true);
    expect(await hasScope()).toBe(false);
    expect((await naturalNudgeRepository.loadServerConfig(refs.serverId)).disabled_builtin_idle_nudges).toContain(key);
    await save({ enabled: true, scope: null });
  });

  it("clears a checker pinned to a retired model during seeding", async () => {
    const [llm] = await testSql`
      INSERT INTO llms (llm_provider, llm_codename, is_deprecated)
      VALUES ('openrouter', '_rt_nudge_retired_checker', true) RETURNING llm_id
    `;
    const decisionModelId = await llmModelRepo.upsertDecisionModel({
      provider: "openrouter",
      codename: "_rt_nudge_retired_decision",
      inputTokenLimit: 8192,
    });
    await testSql`UPDATE decision_models SET is_deprecated = true WHERE decision_model_id = ${decisionModelId}`;
    try {
      for (const pin of [
        { checker_llm_id: llm.llm_id, checker_decision_model_id: null },
        { checker_llm_id: null, checker_decision_model_id: decisionModelId },
      ]) {
        expect(await naturalNudgeRepository.saveServerConfig(refs.serverId, pin)).toBe(true);
        await seedModelsFromCatalog(testSql);
        expect(await naturalNudgeRepository.loadServerConfig(refs.serverId)).toMatchObject({
          checker_llm_id: null,
          checker_decision_model_id: null,
        });
      }
    } finally {
      await testSql`DELETE FROM llms WHERE llm_id = ${llm.llm_id}`;
      await testSql`DELETE FROM decision_models WHERE decision_model_id = ${decisionModelId}`;
    }
  });

  it("records an Active Nudge fire that counts toward caps but never as a pending idle nudge", async () => {
    await naturalNudgeRepository.recordFailure(refs.serverId);
    expect(
      await naturalNudgeRepository.recordActiveNudgeFire({
        serverId: refs.serverId,
        channelDiscId: "1200000000000000009",
        personaId: refs.personaId,
        openerMessageDiscId: "1300000000000000909",
        detour: true,
      }),
    ).toBe(true);
    const history = await naturalNudgeRepository.loadFireHistory(refs.serverId, new Date(Date.now() - 60_000), 5);
    expect(history.recent.filter((fire) => fire.mode === "active")).toHaveLength(1);
    expect(history.latestIdleNudges.some((fire) => fire.mode === "active")).toBe(false);
    const [row] = await testSql`
      SELECT detour, category, answered FROM natural_nudge_fires
      WHERE server_id = ${refs.serverId} AND mode = 'active'
    `;
    expect(row).toEqual({ detour: true, category: null, answered: null });
    expect((await naturalNudgeRepository.loadRuntimeState(refs.serverId)).consecutive_failures).toBe(0);
  });
});
