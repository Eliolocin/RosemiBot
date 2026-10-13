import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  MAX_REMINDERS_PER_SERVER,
  ReminderLimitError,
  serverScheduleRepository,
} from "@/utils/db/repositories/ServerScheduleRepository";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("pending reminder limit", () => {
  let refs: FixtureRefs;
  let otherServer: number;

  const reminder = (serverId: number, purpose: string) => ({
    server_id: serverId,
    channel_disc_id: "100000000000000001",
    user_discord_id: "200000000000000001",
    user_nickname: "Juno",
    reminder_purpose: purpose,
    reminder_time: new Date(Date.now() + 60 * 60 * 1000),
    created_by_user_id: null,
  });

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    const [server] =
      await testSql`INSERT INTO servers (server_disc_id) VALUES ('_rt_reminder_other') RETURNING server_id`;
    otherServer = server.server_id;
  });

  beforeEach(async () => {
    await testSql`DELETE FROM reminders WHERE server_id IN (${refs.serverId}, ${otherServer})`;
  });

  afterAll(async () => {
    await testSql`DELETE FROM reminders WHERE server_id IN (${refs.serverId}, ${otherServer})`;
    await testSql`DELETE FROM servers WHERE server_id = ${otherServer}`;
    await cleanupFixtures(testSql);
  });

  it("admits exactly one of two concurrent creations at the last free slot", async () => {
    await testSql`
      INSERT INTO reminders (server_id, channel_disc_id, user_discord_id, user_nickname, reminder_purpose, reminder_time)
      SELECT ${refs.serverId}, '100000000000000001', '200000000000000001', 'Juno', 'filler ' || n, NOW() + INTERVAL '1 hour'
      FROM generate_series(1, ${MAX_REMINDERS_PER_SERVER - 1}) AS n
    `;
    const writes = await Promise.allSettled([
      serverScheduleRepository.addReminder(reminder(refs.serverId, "first")),
      serverScheduleRepository.addReminder(reminder(refs.serverId, "second")),
    ]);
    expect(writes.filter((result) => result.status === "fulfilled" && result.value)).toHaveLength(1);
    const rejected = writes.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ReminderLimitError);
    const [{ count }] = await testSql`SELECT COUNT(*)::int AS count FROM reminders WHERE server_id = ${refs.serverId}`;
    expect(count).toBe(MAX_REMINDERS_PER_SERVER);

    expect(await serverScheduleRepository.addReminder(reminder(otherServer, "independent"))).not.toBeNull();
  });
});
