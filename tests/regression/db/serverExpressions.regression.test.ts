/**
 * Regression harness: ServerRepository.initializeExpressions.
 *
 * Covers: overwrite-mode matching when an emoji and a sticker share a name, and the
 * batch scope that confines name matches to the rows the model was actually shown.
 *
 * Requires: a local Postgres connection (see docs/en/contributing/testing/db-changes.md)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { serverRepository } from "@/utils/db/repositories";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("ServerRepository.initializeExpressions regression", () => {
  let refs: FixtureRefs;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
  });

  afterAll(async () => {
    await testSql`DELETE FROM server_emojis WHERE server_id = ${refs.serverId}`;
    await testSql`DELETE FROM server_stickers WHERE server_id = ${refs.serverId}`;
    await cleanupFixtures(testSql);
  });

  beforeEach(async () => {
    await testSql`DELETE FROM server_emojis WHERE server_id = ${refs.serverId}`;
    await testSql`DELETE FROM server_stickers WHERE server_id = ${refs.serverId}`;
    await testSql`
      INSERT INTO server_emojis (server_id, emoji_disc_id, emoji_name, emoji_desc, emotion_key)
      VALUES (${refs.serverId}, '_rt_emoji_1', 'Smug', 'old emoji desc', 'neutral')
    `;
    await testSql`
      INSERT INTO server_stickers (server_id, sticker_disc_id, sticker_name, sticker_desc, emotion_key)
      VALUES (${refs.serverId}, '_rt_sticker_1', 'smug', 'old sticker desc', 'neutral')
    `;
  });

  async function readDescriptions() {
    const [emoji] = await testSql`SELECT emoji_desc FROM server_emojis WHERE emoji_disc_id = '_rt_emoji_1'`;
    const [sticker] = await testSql`SELECT sticker_desc FROM server_stickers WHERE sticker_disc_id = '_rt_sticker_1'`;
    return { emoji: emoji.emoji_desc, sticker: sticker.sticker_desc };
  }

  it("overwrite splits two same-named results across the emoji and the sticker", async () => {
    const written = await serverRepository.initializeExpressions(
      refs.serverId,
      [
        { name: "Smug", emotion_key: "smug", description: "new emoji desc" },
        { name: "Smug", emotion_key: "smug", description: "new sticker desc" },
      ],
      { overwrite: true, emojiDiscIds: ["_rt_emoji_1"], stickerDiscIds: ["_rt_sticker_1"] },
    );

    expect(written).toEqual({ emojiDiscIds: ["_rt_emoji_1"], stickerDiscIds: ["_rt_sticker_1"] });
    expect(await readDescriptions()).toEqual({ emoji: "new emoji desc", sticker: "new sticker desc" });
  });

  it("overwrite does not touch an already-classified emoji when only the sticker is in scope", async () => {
    const written = await serverRepository.initializeExpressions(
      refs.serverId,
      [{ name: "Smug", emotion_key: "smug", description: "new sticker desc" }],
      { overwrite: true, emojiDiscIds: [], stickerDiscIds: ["_rt_sticker_1"] },
    );

    expect(written).toEqual({ emojiDiscIds: [], stickerDiscIds: ["_rt_sticker_1"] });
    expect(await readDescriptions()).toEqual({ emoji: "old emoji desc", sticker: "new sticker desc" });
  });

  it("without overwrite, a classified row is left alone even when it is in scope", async () => {
    const written = await serverRepository.initializeExpressions(
      refs.serverId,
      [{ name: "Smug", emotion_key: "smug", description: "should not land" }],
      { overwrite: false, emojiDiscIds: ["_rt_emoji_1"], stickerDiscIds: ["_rt_sticker_1"] },
    );

    expect(written).toEqual({ emojiDiscIds: [], stickerDiscIds: [] });
    expect(await readDescriptions()).toEqual({ emoji: "old emoji desc", sticker: "old sticker desc" });
  });
});
