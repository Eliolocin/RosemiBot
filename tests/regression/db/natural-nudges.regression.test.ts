import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { NATURAL_NUDGE_FAILURE_STOP_THRESHOLD } from "@/modules/natural-nudges/runtime/tuning";
import { loadPersonaAgendas } from "@/modules/natural-nudges/runtime/agendas";
import { defaultServerNaturalNudgeConfig } from "@/modules/natural-nudges/db/types";
import { resolveEffectiveChannelIds } from "@/modules/natural-nudges/runtime/channels";
import { heatWindowStart } from "@/modules/natural-nudges/runtime/meters";
import { workspaceConfigExportSchema } from "@/types/db/dataExport";
import { exportRepository } from "@/utils/db/repositories/ExportRepository";
import { importRepository } from "@/utils/db/repositories/ImportRepository";
import { personaRepository } from "@/utils/db/repositories/PersonaRepository";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";
import type { PresetExportData } from "@/types/preset/presetExport";
import { resetRepository } from "@/utils/db/repositories/ResetRepository";
import { cache } from "@/utils/cache/tomoriStateCacheStore";
import { cleanupFixtures, FIXTURE_IDS, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const PRESET_LINEAGE = 77001;
const PRESET_NAME = "_rt_nudge_preset";
const OTHER_SERVER = "_rt_nudge_other";
const PRESET_INTERESTS = [{ label: "mecha anime", description: "Fiction about giant piloted robots." }];

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
        natural_nudge_interests, natural_nudge_talkativeness, preset_trigger_words
      ) VALUES (
        ${PRESET_NAME}, 'Preset prompt', 'en-US', ${PRESET_LINEAGE}, ${PRESET_INTERESTS}::jsonb, 3, ARRAY['nudgy']
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
      has_override: false,
    });

    await testSql`
      UPDATE personas SET is_pointer = true, preset_lineage_id = ${PRESET_LINEAGE}, preset_language = 'en-US'
      WHERE persona_id = ${refs.personaId}
    `;
    expect((await naturalNudgeRepository.loadPersonaConfigs([refs.personaId])).get(refs.personaId)).toMatchObject({
      talkativeness: 3,
      interests: PRESET_INTERESTS,
      has_override: false,
    });

    const own = [{ label: "gacha games", description: "Banners, pity, and rare drops." }];
    expect(await naturalNudgeRepository.savePersonaConfig(refs.personaId, { talkativeness: 1, interests: own })).toBe(
      true,
    );
    const [stored] = await testSql`
      SELECT jsonb_typeof(interests) AS kind FROM persona_natural_nudge_configs WHERE persona_id = ${refs.personaId}
    `;
    expect(stored.kind).toBe("array");
    expect((await naturalNudgeRepository.loadPersonaConfigs([refs.personaId])).get(refs.personaId)).toMatchObject({
      talkativeness: 1,
      interests: own,
      has_override: true,
    });

    await testSql.begin((tx) => naturalNudgeRepository.clearPersonaConfig(tx, refs.personaId));
    expect(await personaRepository.materializeIfPointer(refs.personaId)).toBe(true);
    const [copied] = await testSql`
      SELECT talkativeness, interests FROM persona_natural_nudge_configs WHERE persona_id = ${refs.personaId}
    `;
    expect(copied).toMatchObject({ talkativeness: 3, interests: PRESET_INTERESTS });
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
      expect(await naturalNudgeRepository.saveServerConfig(off, { episodes_enabled: false })).toBe(true);

      const listed = await naturalNudgeRepository.listEnabledEpisodeServers(heatWindowStart(now));
      const ours = listed.filter((server) => serverIds.includes(server.server_id));
      expect(ours.map((server) => server.server_id)).toEqual([heated]);
      expect(ours[0]?.config).toEqual(defaultServerNaturalNudgeConfig(heated));
      expect(ours[0]?.config.episodes_enabled).toBe(true);
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

  it("anchors the fire row and the agenda together, and only the owner reads the agenda", async () => {
    const openerId = "1300000000000000001";
    expect(
      await naturalNudgeRepository.recordEpisodeFire(
        {
          serverId: refs.serverId,
          channelDiscId: "1200000000000000001",
          personaId: refs.personaId,
          category: "new_topic",
          episodeKey: "new_topic.interest_musing",
          openerMessageDiscId: openerId,
        },
        "Find out who else likes mecha.",
      ),
    ).toBe(true);

    expect((await loadPersonaAgendas(refs.personaId, [openerId])).get(openerId)).toBe("Find out who else likes mecha.");
    expect((await loadPersonaAgendas(otherPersonaId, [openerId])).size).toBe(0);

    const history = await naturalNudgeRepository.loadFireHistory(refs.serverId, new Date(0), 5);
    expect(history.latestEpisodes[0]).toMatchObject({ opener_message_disc_id: openerId, answered: null });
    await naturalNudgeRepository.setFireAnswered(history.latestEpisodes[0].fire_id, true);
    const answered = await naturalNudgeRepository.loadFireHistory(refs.serverId, new Date(0), 5);
    expect(answered.latestEpisodes[0]?.answered).toBe(true);
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

  it("refuses a custom episode past the cap", async () => {
    const episode = {
      category: "new_topic" as const,
      title: "Riddle",
      brief: "Have {persona} pose a riddle.",
      agenda_hint: null,
      prerequisites: [],
      recommended_tools: [],
      enabled: true,
    };
    expect(await naturalNudgeRepository.insertCustomEpisode(refs.serverId, episode, 1)).not.toBeNull();
    expect(await naturalNudgeRepository.insertCustomEpisode(refs.serverId, episode, 1)).toBeNull();
  });

  it("exports settings and custom episodes without channels, imports them, and resets them", async () => {
    await naturalNudgeRepository.saveServerConfig(refs.serverId, {
      episodes_enabled: false,
      channel_disc_ids: ["1200000000000000001"],
      revive_weight: 40,
      disabled_builtin_episodes: ["new_topic.voice_note"],
    });
    const result = await exportRepository.exportWorkspaceConfig(FIXTURE_IDS.serverDiscId);
    expect(result.success).toBe(true);
    const exported = workspaceConfigExportSchema.parse(result.data);
    expect(exported.data.nudges).toMatchObject({ episodes_enabled: false, revive_weight: 40 });
    expect(exported.data.nudges?.custom_episodes).toHaveLength(1);
    expect(JSON.stringify(exported.data.nudges)).not.toContain("1200000000000000001");

    expect((await importRepository.importWorkspaceConfig(OTHER_SERVER, exported, ["nudges"])).success).toBe(true);
    const imported = await naturalNudgeRepository.loadServerConfig(otherServerId);
    expect(imported).toMatchObject({
      episodes_enabled: false,
      revive_weight: 40,
      channel_disc_ids: [],
      disabled_builtin_episodes: ["new_topic.voice_note"],
    });
    expect(await naturalNudgeRepository.listCustomEpisodes(otherServerId)).toHaveLength(1);

    await resetRepository.resetServerConfiguration(refs.serverId);
    expect(await naturalNudgeRepository.loadServerConfig(refs.serverId)).toMatchObject({
      episodes_enabled: true,
      channel_disc_ids: [],
      revive_weight: 25,
    });
    expect(await naturalNudgeRepository.listCustomEpisodes(refs.serverId)).toHaveLength(0);
  });
});
