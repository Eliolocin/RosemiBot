import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("autonomous sticker trigger migration", () => {
  let refs: FixtureRefs;
  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
  });
  afterAll(async () => {
    await cleanupFixtures(testSql);
  });
  it("removes obsolete sticker triggers, preserves task triggers, and can run twice", async () => {
    await testSql`
      UPDATE server_trigger_behavior_configs
      SET deliberate_tool_triggers = ${{ sticker: ["^"], search: ["lookup"], image: ["draw"] }}
      WHERE server_id = ${refs.serverId}
    `;
    const migration = await readFile("src/db/migrations/099_autonomous_sticker_selection.sql", "utf8");
    for (let run = 0; run < 2; run++) {
      await testSql.unsafe(migration);
      const [row] = await testSql`
        SELECT deliberate_tool_triggers FROM server_trigger_behavior_configs WHERE server_id = ${refs.serverId}
      `;
      expect(row.deliberate_tool_triggers).toEqual({ search: ["lookup"], image: ["draw"] });
    }
  });
});
