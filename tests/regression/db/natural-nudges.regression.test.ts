import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { NATURAL_NUDGE_FAILURE_STOP_THRESHOLD } from "@/modules/natural-nudges/runtime/tuning";
import { loadPersonaAgendas } from "@/modules/natural-nudges/runtime/agendas";
import { defaultServerNaturalNudgeConfig } from "@/modules/natural-nudges/db/types";
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
    expect(await naturalNudgeRepository.insertCustomIdleNudge(refs.serverId, idleNudge, 1)).not.toBeNull();
    expect(await naturalNudgeRepository.insertCustomIdleNudge(refs.serverId, idleNudge, 1)).toBeNull();
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
