import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { EmbeddingModelRow } from "@/types/db/schema";
import { ragRepository } from "@/utils/db/repositories";
import * as embeddingProvider from "@/utils/embeddings/embeddingProvider";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

const SCOPED_CHANNEL = "111111111111111111";
const THREAD_IN_SCOPED_CHANNEL = "222222222222222222";
const OTHER_CHANNEL = "333333333333333333";
const QUERY_VECTOR = [1, 0, 0];

async function pgvectorAvailable(): Promise<boolean> {
  const [row] = await testSql<Array<{ available: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS available
  `;
  return row?.available === true;
}

describe.skipIf(!DB_TESTS_AVAILABLE)("document retrieval channel scope", () => {
  let refs: FixtureRefs;
  let embeddingModel: EmbeddingModelRow;
  let ragReady = false;
  let pendingDocumentId = 0;
  const spies: Array<{ mockRestore(): void }> = [];

  async function insertDocument(name: string, channelDiscIds: string[]): Promise<number> {
    const [document] = await testSql`
      INSERT INTO documents (server_id, document_name, text_content, channel_disc_ids)
      VALUES (${refs.serverId}, ${name}, 'x', ${testSql.array(channelDiscIds, "TEXT")})
      RETURNING document_id
    `;
    await testSql`
      INSERT INTO document_chunks (document_id, server_id, embedding_model_id, embedding_family, chunk_index, content, embedding)
      VALUES (
        ${document.document_id}, ${refs.serverId}, ${embeddingModel.embedding_model_id},
        ${embeddingModel.model_family}, 0, ${`${name} chunk`}, ${`[${QUERY_VECTOR.join(",")}]`}::vector
      )
    `;
    return document.document_id;
  }

  async function retrievedNames(channelIds: string[] | null): Promise<string[]> {
    const chunks = await ragRepository.retrieveRelevantChunks({
      serverId: refs.serverId,
      personaId: null,
      query: "anything",
      embeddingModel,
      apiKey: "unused",
      maxResults: 10,
      minSimilarity: 0,
      channelIds,
    });
    return chunks.map((chunk) => chunk.document_name).sort();
  }

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    ragReady = await pgvectorAvailable();
    if (!ragReady) return;
    await executeTestSqlFile(path.join(process.cwd(), "src/db/schema_rag.sql"));
    const [model] = await testSql<EmbeddingModelRow[]>`SELECT * FROM embedding_models LIMIT 1`;
    if (!model) throw new Error("Missing seeded embedding model");
    embeddingModel = model;
    spies.push(
      spyOn(embeddingProvider, "generateEmbeddingsBatched").mockResolvedValue([QUERY_VECTOR]),
      spyOn(embeddingProvider, "providerSupportsEmbeddingTaskType").mockResolvedValue(false),
    );
    await insertDocument("_rt_unscoped", []);
    await insertDocument("_rt_scoped", [SCOPED_CHANNEL]);
    pendingDocumentId = await insertDocument("_rt_pending", []);
    await testSql`
      INSERT INTO legacy_channel_scope_tags (source_table, row_id, server_id, channel_tags)
      VALUES ('documents', ${pendingDocumentId}, ${refs.serverId}, ARRAY['#gone'])
    `;
  });

  afterAll(async () => {
    for (const spy of spies) spy.mockRestore();
    await testSql`DELETE FROM legacy_channel_scope_tags WHERE source_table = 'documents' AND row_id = ${pendingDocumentId}`;
    await cleanupFixtures(testSql);
  });

  it("matches a scoped document in its channel and that channel's threads", async () => {
    if (!ragReady) return;
    expect(await retrievedNames([SCOPED_CHANNEL])).toEqual(["_rt_pending", "_rt_scoped", "_rt_unscoped"]);
    expect(await retrievedNames([THREAD_IN_SCOPED_CHANNEL, SCOPED_CHANNEL])).toEqual([
      "_rt_pending",
      "_rt_scoped",
      "_rt_unscoped",
    ]);
  });

  it("keeps an unscoped document everywhere and a scoped one out of other channels", async () => {
    if (!ragReady) return;
    expect(await retrievedNames([OTHER_CHANNEL])).toEqual(["_rt_pending", "_rt_unscoped"]);
  });

  it("treats a document with an unresolved legacy scope as active in every channel", async () => {
    if (!ragReady) return;
    expect(await retrievedNames([SCOPED_CHANNEL])).toContain("_rt_pending");
    expect(await retrievedNames([OTHER_CHANNEL])).toContain("_rt_pending");
  });

  it("applies no scope when the caller passes no channel filter", async () => {
    if (!ragReady) return;
    expect(await retrievedNames(null)).toEqual(["_rt_pending", "_rt_scoped", "_rt_unscoped"]);
  });
});
