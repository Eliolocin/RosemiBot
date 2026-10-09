/**
 * Regression harness: Minimal notice references.
 *
 * A Minimal memory or task notice shows only its title in Discord, so the model would re-save what
 * it already saved. The reference must resolve against the live row on every context build and stop
 * resolving once that row is deleted, because the body is never stored a second time.
 *
 * Requires: a local Postgres connection (see docs/en/contributing/testing/db-changes.md)
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { minimalNoticeRefRepository } from "@/utils/db/repositories/MinimalNoticeRefRepository";
import { formatMinimalNoticeBody } from "@/utils/discord/minimalNoticeBodies";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const MESSAGE_IDS = {
  serverMemory: "_rt_minimal_server_memory",
  personalMemory: "_rt_minimal_personal_memory",
  task: "_rt_minimal_task",
};

describe.skipIf(!DB_TESTS_AVAILABLE)("Minimal notice refs — regression", () => {
  let refs: FixtureRefs;
  let personalMemoryId: number;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);

    const [serverMemory] = await testSql<Array<{ server_memory_id: number }>>`
      INSERT INTO server_memories (server_id, persona_id, persona_lineage_id, user_id, content, tags)
      VALUES (${refs.serverId}, ${refs.personaId}, ${refs.personaLineageId}, ${refs.userId}, 'Juno runs the art channel', ARRAY['art']::TEXT[])
      RETURNING server_memory_id
    `;
    const [personalMemory] = await testSql<Array<{ personal_memory_id: number }>>`
      INSERT INTO personal_memories (user_id, persona_lineage_id, content, tags)
      VALUES (${refs.userId}, ${refs.personaLineageId}, '{user} likes tea', ARRAY[]::TEXT[])
      RETURNING personal_memory_id
    `;
    const [reminder] = await testSql<Array<{ reminder_id: number }>>`
      INSERT INTO reminders (server_id, channel_disc_id, user_discord_id, user_nickname, reminder_purpose, reminder_time)
      VALUES (${refs.serverId}, '_rt_channel', '_rt_user', 'Mirri', 'water the plants', NOW() + INTERVAL '1 day')
      RETURNING reminder_id
    `;
    personalMemoryId = personalMemory.personal_memory_id;

    await minimalNoticeRefRepository.record(MESSAGE_IDS.serverMemory, {
      kind: "server_memory",
      id: serverMemory.server_memory_id,
    });
    await minimalNoticeRefRepository.record(MESSAGE_IDS.personalMemory, {
      kind: "personal_memory",
      id: personalMemoryId,
    });
    await minimalNoticeRefRepository.record(MESSAGE_IDS.task, { kind: "task", id: reminder.reminder_id });
  });

  afterAll(async () => {
    await testSql`DELETE FROM minimal_notice_refs WHERE message_disc_id LIKE '_rt_minimal_%'`;
    await cleanupFixtures(testSql);
  });

  it("resolves each kind against its own live row", async () => {
    const rows = await minimalNoticeRefRepository.resolveByMessageIds(Object.values(MESSAGE_IDS));

    const serverRow = rows.get(MESSAGE_IDS.serverMemory);
    expect(serverRow?.memory_content).toBe("Juno runs the art channel");
    expect(serverRow?.memory_tags).toEqual(["art"]);
    expect(rows.get(MESSAGE_IDS.personalMemory)?.memory_content).toBe("{user} likes tea");
    expect(rows.get(MESSAGE_IDS.task)?.reminder_purpose).toBe("water the plants");
    // IDs are per table, so a task must never pick up a memory that happens to share its number.
    expect(rows.get(MESSAGE_IDS.task)?.memory_content).toBeNull();
  });

  it("leaves no body once the referenced row is deleted", async () => {
    await testSql`DELETE FROM personal_memories WHERE personal_memory_id = ${personalMemoryId}`;

    const rows = await minimalNoticeRefRepository.resolveByMessageIds([MESSAGE_IDS.personalMemory]);
    const row = rows.get(MESSAGE_IDS.personalMemory);
    expect(row).toBeDefined();
    if (!row) return;
    expect(formatMinimalNoticeBody(row)).toBeNull();
  });
});
