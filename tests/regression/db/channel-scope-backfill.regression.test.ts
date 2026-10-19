import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ChannelType, Collection, type Client } from "discord.js";
import backfillLegacyChannelScopes from "@/events/clientReady/05_backfillLegacyChannelScopes";
import { serverMemoryRepository } from "@/utils/db/repositories";
import { cleanupFixtures, FIXTURE_IDS, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

const GENERAL = "111111111111111111";
const GENERAL_TWIN = "222222222222222222";
const OFFLINE_GUILD_DISC_ID = "_rt_backfill_offline_guild";
const DM_SERVER_DISC_ID = "_rt_backfill_dm";

function clientWithGuild(guildDiscId: string): Client {
  const channels = new Collection([
    [GENERAL, { id: GENERAL, name: "general", type: ChannelType.GuildText }],
    [GENERAL_TWIN, { id: GENERAL_TWIN, name: "General", type: ChannelType.GuildAnnouncement }],
  ]);
  const guild = { id: guildDiscId, available: true, channels: { cache: channels } };
  return { guilds: { cache: new Collection([[guildDiscId, guild]]) } } as unknown as Client;
}

describe.skipIf(!DB_TESTS_AVAILABLE)("startup backfill of legacy channel scopes", () => {
  let refs: FixtureRefs;
  const memoryIds: Record<string, number> = {};

  async function insertTaggedMemory(serverId: number, key: string, tags: string[]): Promise<void> {
    const [row] = await testSql`
      INSERT INTO server_memories (server_id, persona_lineage_id, content, tags)
      VALUES (${serverId}, ${refs.personaLineageId}, ${key}, ${testSql.array(tags, "TEXT")})
      RETURNING server_memory_id
    `;
    memoryIds[key] = row.server_memory_id;
  }

  async function scopeOf(key: string): Promise<{ channel_disc_ids: string[]; resolved: boolean; tags: string[] }> {
    const [row] = await testSql`
      SELECT sm.channel_disc_ids, sm.tags, l.resolved_at IS NOT NULL AS resolved
      FROM server_memories sm
      JOIN legacy_channel_scope_tags l ON l.source_table = 'server_memories' AND l.row_id = sm.server_memory_id
      WHERE sm.server_memory_id = ${memoryIds[key] ?? 0}
    `;
    return row;
  }

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    const [offline] = await testSql`
      INSERT INTO servers (server_disc_id) VALUES (${OFFLINE_GUILD_DISC_ID}) RETURNING server_id
    `;
    const [dm] = await testSql`
      INSERT INTO servers (server_disc_id, is_dm_channel) VALUES (${DM_SERVER_DISC_ID}, true) RETURNING server_id
    `;
    await insertTaggedMemory(refs.serverId, "named", ['"#general"', "lore"]);
    await insertTaggedMemory(refs.serverId, "missing", ["#deleted-channel"]);
    await insertTaggedMemory(offline.server_id, "offline", ["#general"]);
    await insertTaggedMemory(dm.server_id, "dm", ["#general"]);
    await executeTestSqlFile(path.join(process.cwd(), "src/db/migrations/111_channel_scope_ids.sql"));

    await backfillLegacyChannelScopes(clientWithGuild(FIXTURE_IDS.serverDiscId));
  });

  afterAll(async () => {
    await testSql`
      DELETE FROM legacy_channel_scope_tags
      WHERE source_table = 'server_memories' AND row_id IN ${testSql(Object.values(memoryIds))}
    `;
    await testSql`DELETE FROM servers WHERE server_disc_id IN ${testSql([OFFLINE_GUILD_DISC_ID, DM_SERVER_DISC_ID])}`;
    await cleanupFixtures(testSql);
  });

  it("scopes a row to every channel carrying its name and keeps its keyword tags", async () => {
    expect(await scopeOf("named")).toEqual({
      channel_disc_ids: [GENERAL, GENERAL_TWIN],
      resolved: true,
      tags: ["lore"],
    });
  });

  it("keeps a row whose names match nothing pending, and therefore inactive in every channel", async () => {
    expect(await scopeOf("missing")).toMatchObject({ channel_disc_ids: [], resolved: false });
    const [loaded] = (
      await serverMemoryRepository.loadServerMemoriesScoped(refs.serverId, refs.personaLineageId)
    ).filter((row) => row.server_memory_id === memoryIds.missing);
    expect(loaded?.channel_scope_pending).toBe(true);
  });

  it("leaves guilds outside the client cache, including DMs, pending", async () => {
    expect(await scopeOf("offline")).toMatchObject({ channel_disc_ids: [], resolved: false });
    expect(await scopeOf("dm")).toMatchObject({ channel_disc_ids: [], resolved: false });
  });

  it("settles a pending row when an admin saves the memory form", async () => {
    expect(await serverMemoryRepository.edit(memoryIds.missing ?? 0, "missing", [], [GENERAL])).toBe(true);
    expect(await scopeOf("missing")).toMatchObject({ channel_disc_ids: [GENERAL], resolved: true });
  });
});
