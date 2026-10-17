/**
 * Regression harness: server scoping of context-reference eligibility evidence.
 *
 * The alias resolver drops a name outright once two participants answer to it, so
 * every extra eligible owner of a common name costs that name for everyone. This
 * suite pins the scope of the evidence the eligibility policy reads: memories and
 * reminders earned in another server must not make a silent lurker here eligible,
 * while the lineage-0 global branch must keep counting because it renders in every
 * server.
 *
 * Mocked SQL cannot catch a scoping regression, so this runs the real repository
 * against a disposable Postgres fixture.
 *
 * Requires: a local Postgres connection (see docs/guides/testing-db-changes.md).
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { userRepository } from "@/utils/db/repositories";
import type { ContextReferenceEligibilityEvidence } from "@/utils/db/repositories/UserRepository";
import { FIXTURE_IDS, cleanupFixtures, insertFixtures } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const FOREIGN_SERVER_DISC = "_rt_server_ctxref_foreign";
const LOCAL_MEMORY_USER = "_rt_ctxref_local_mem";
const FOREIGN_MEMORY_USER = "_rt_ctxref_foreign_mem";
const GLOBAL_MEMORY_USER = "_rt_ctxref_global_mem";
const LOCAL_TASK_USER = "_rt_ctxref_local_task";
const FOREIGN_TASK_USER = "_rt_ctxref_foreign_task";

const ALL_TEST_USERS = [
  LOCAL_MEMORY_USER,
  FOREIGN_MEMORY_USER,
  GLOBAL_MEMORY_USER,
  LOCAL_TASK_USER,
  FOREIGN_TASK_USER,
] as const;

describe.skipIf(!DB_TESTS_AVAILABLE)("Context reference eligibility — server scoping regression", () => {
  const userIds = new Map<string, number>();
  let localLineageId: number;
  let foreignLineageId: number;
  let foreignServerId: number;

  /** Evidence the repository reports for a candidate, keyed by Discord ID. */
  async function evidenceFor(userDiscId: string): Promise<ContextReferenceEligibilityEvidence> {
    const candidates = await userRepository.loadContextReferenceCandidates({
      serverDiscId: FIXTURE_IDS.serverDiscId,
      candidateDiscordIds: [...ALL_TEST_USERS],
      // Empty text disables the nickname-match branch, so admission comes only
      // from the candidate ID list and the evidence under test stays isolated.
      normalizedHistoryText: "",
    });
    const candidate = candidates.find((entry) => entry.userRow.user_disc_id === userDiscId);
    if (!candidate) throw new Error(`Candidate ${userDiscId} was not returned`);
    return candidate.evidence;
  }

  beforeAll(async () => {
    await setupTestDb();
    const refs = await insertFixtures(testSql);
    localLineageId = refs.personaLineageId;

    const [foreignServer] = await testSql<Array<{ server_id: number }>>`
      INSERT INTO servers (server_disc_id)
      VALUES (${FOREIGN_SERVER_DISC})
      ON CONFLICT (server_disc_id) DO UPDATE SET server_disc_id = EXCLUDED.server_disc_id
      RETURNING server_id
    `;
    foreignServerId = foreignServer.server_id;

    const [foreignPersona] = await testSql<Array<{ persona_lineage_id: number | string }>>`
      INSERT INTO personas (server_id, persona_nickname, is_alter)
      VALUES (${foreignServerId}, '_rt_ctxref_foreign_persona', false)
      RETURNING persona_lineage_id
    `;
    foreignLineageId = Number(foreignPersona.persona_lineage_id);

    for (const discId of ALL_TEST_USERS) {
      const row = await userRepository.register(discId, discId, "en-US");
      if (!row?.user_id) throw new Error(`Failed to register ${discId}`);
      userIds.set(discId, row.user_id);
    }

    for (const [discId, lineageId] of [
      [LOCAL_MEMORY_USER, localLineageId],
      [FOREIGN_MEMORY_USER, foreignLineageId],
      [GLOBAL_MEMORY_USER, 0],
    ] as const) {
      const userId = userIds.get(discId);
      if (userId === undefined) throw new Error(`Missing registered user ${discId}`);
      await testSql`
        INSERT INTO personal_memories (user_id, persona_lineage_id, content, tags)
        VALUES (${userId}, ${lineageId}, '_rt_ctxref_memory', ARRAY[]::TEXT[])
      `;
    }

    for (const [discId, serverId] of [
      [LOCAL_TASK_USER, refs.serverId],
      [FOREIGN_TASK_USER, foreignServerId],
    ] as const) {
      await testSql`
        INSERT INTO reminders (
          server_id, channel_disc_id, user_discord_id, user_nickname, reminder_purpose, reminder_time
        )
        VALUES (
          ${serverId}, '_rt_ctxref_channel', ${discId}, ${discId}, '_rt_ctxref_purpose',
          CURRENT_TIMESTAMP + INTERVAL '1 day'
        )
      `;
    }
  });

  afterAll(async () => {
    for (const discId of ALL_TEST_USERS) {
      await testSql`DELETE FROM users WHERE user_disc_id = ${discId}`;
    }
    await testSql`DELETE FROM servers WHERE server_disc_id = ${FOREIGN_SERVER_DISC}`;
    await cleanupFixtures(testSql);
  });

  it("counts personal memories under a lineage this server owns", async () => {
    expect((await evidenceFor(LOCAL_MEMORY_USER)).hasPersonalMemories).toBe(true);
  });

  it("ignores personal memories that belong only to another server's lineage", async () => {
    expect(foreignLineageId).not.toBe(localLineageId);
    expect((await evidenceFor(FOREIGN_MEMORY_USER)).hasPersonalMemories).toBe(false);
  });

  it("counts lineage-0 global memories, which render against every persona", async () => {
    expect((await evidenceFor(GLOBAL_MEMORY_USER)).hasPersonalMemories).toBe(true);
  });

  it("counts a pending reminder in this server", async () => {
    expect((await evidenceFor(LOCAL_TASK_USER)).hasPendingTasks).toBe(true);
  });

  it("ignores a pending reminder that belongs to another server", async () => {
    expect((await evidenceFor(FOREIGN_TASK_USER)).hasPendingTasks).toBe(false);
  });

  it("reports no server activity for users that only hold out-of-server state", async () => {
    for (const discId of [FOREIGN_MEMORY_USER, FOREIGN_TASK_USER]) {
      expect((await evidenceFor(discId)).hasServerActivity).toBe(false);
    }
  });
});
