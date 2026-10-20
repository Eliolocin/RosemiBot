import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { TransactionSQL } from "bun";
import { splitSqlStatements } from "@/utils/db/sqlSplitter";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const MIGRATION_DIR = path.join(process.cwd(), "src/db/migrations");
const ROLLBACK = new Error("rollback");

async function runSqlFile(tx: TransactionSQL, fileName: string): Promise<void> {
  const statements = splitSqlStatements(await readFile(path.join(MIGRATION_DIR, fileName), "utf-8"));
  for (const statement of statements) await tx.unsafe(statement);
}

/** Runs the body in a transaction that always rolls back, so the stand-in documents table never leaks. */
async function inRolledBackTransaction(body: (tx: TransactionSQL) => Promise<void>): Promise<void> {
  try {
    await testSql.begin(async (tx) => {
      await body(tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

describe.skipIf(!DB_TESTS_AVAILABLE)("Migration 111 channel scope ids", () => {
  let refs: FixtureRefs;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
  });

  afterAll(async () => {
    await cleanupFixtures(testSql);
  });

  it("moves legacy channel names aside before dropping them, and the rollback restores them", async () => {
    await inRolledBackTransaction(async (tx) => {
      // Replaced with a legacy stand-in because the shared lane may already hold a current documents table; the rollback restores it.
      await tx`DROP TABLE IF EXISTS documents CASCADE`;
      await tx`
        CREATE TABLE documents (
          document_id SERIAL PRIMARY KEY,
          server_id INT NOT NULL,
          channel_tags TEXT[] DEFAULT ARRAY[]::TEXT[]
        )
      `;
      const [scopedDocument] = await tx`
        INSERT INTO documents (server_id, channel_tags)
        VALUES (${refs.serverId}, ${tx.array(["#general", "#bot-chat"], "TEXT")})
        RETURNING document_id
      `;
      await tx`INSERT INTO documents (server_id) VALUES (${refs.serverId})`;
      const [scopedMemory] = await tx`
        INSERT INTO server_memories (server_id, persona_lineage_id, content, tags)
        VALUES (${refs.serverId}, ${refs.personaLineageId}, 'scoped', ${tx.array(['"#general"', "lore"], "TEXT")})
        RETURNING server_memory_id
      `;
      await tx`
        INSERT INTO server_memories (server_id, persona_lineage_id, content, tags)
        VALUES (${refs.serverId}, ${refs.personaLineageId}, 'keywords only', ${tx.array(["lore"], "TEXT")})
      `;

      await runSqlFile(tx, "111_channel_scope_ids.sql");

      const held = await tx`
        SELECT source_table, row_id, channel_tags, resolved_at FROM legacy_channel_scope_tags
        WHERE (source_table = 'documents' AND row_id = ${scopedDocument.document_id})
           OR (source_table = 'server_memories' AND row_id = ${scopedMemory.server_memory_id})
        ORDER BY source_table
      `;
      expect(held).toEqual([
        {
          source_table: "documents",
          row_id: scopedDocument.document_id,
          channel_tags: ["#general", "#bot-chat"],
          resolved_at: null,
        },
        {
          source_table: "server_memories",
          row_id: scopedMemory.server_memory_id,
          channel_tags: ['"#general"'],
          resolved_at: null,
        },
      ]);
      const [documentColumn] = await tx`
        SELECT 1 FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'channel_tags'
      `;
      expect(documentColumn).toBeUndefined();
      const [strippedMemory] = await tx`
        SELECT tags FROM server_memories WHERE server_memory_id = ${scopedMemory.server_memory_id}
      `;
      expect(strippedMemory.tags).toEqual(["lore"]);

      await runSqlFile(tx, "111_channel_scope_ids.down.sql");

      const [restoredDocument] = await tx`
        SELECT channel_tags FROM documents WHERE document_id = ${scopedDocument.document_id}
      `;
      expect(restoredDocument.channel_tags).toEqual(["#general", "#bot-chat"]);
      const [restoredMemory] = await tx`
        SELECT tags FROM server_memories WHERE server_memory_id = ${scopedMemory.server_memory_id}
      `;
      expect(restoredMemory.tags).toEqual(["lore", '"#general"']);
      const [holdingTable] = await tx`SELECT to_regclass('public.legacy_channel_scope_tags')::text AS name`;
      expect(holdingTable.name).toBeNull();
    });
  });
});
