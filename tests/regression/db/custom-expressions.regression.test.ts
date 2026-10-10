import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { serverRepository, personaRepository, statRepository } from "@/utils/db/repositories";
import { nativeExpressionRevision } from "@/utils/text/expressionRevision";
import { sql } from "@/utils/db/client";
import { StickerFormatType, type Sticker } from "discord.js";
import sharp from "sharp";
import { deleteExpressionMedia, loadExpressionMedia, storeExpressionMedia } from "@/utils/storage/expressionStorage";
import { createCustomExpression } from "../../helpers/fixtures";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";
import { MAX_CUSTOM_EXPRESSIONS_PER_SERVER } from "@/constants/expressionLimits";
import { useEnvSandbox } from "../../helpers/env";

describe.skipIf(!DB_TESTS_AVAILABLE)("custom expression persistence", () => {
  let refs: FixtureRefs;
  let otherServer: number;
  let otherPersona: number;
  useEnvSandbox(["EXPRESSION_STORAGE_BACKEND"]);
  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    const [server] =
      await testSql`INSERT INTO servers (server_disc_id) VALUES ('_rt_expressions_other') RETURNING server_id`;
    otherServer = server.server_id;
    const [persona] =
      await testSql`INSERT INTO personas (server_id, persona_nickname, is_alter) VALUES (${otherServer}, 'Juno', false) RETURNING persona_id`;
    otherPersona = persona.persona_id;
  });
  beforeEach(async () => {
    await statRepository.flush();
    await testSql`DELETE FROM custom_expressions WHERE server_id = ${refs.serverId}`;
    await testSql`DELETE FROM server_stickers WHERE server_id = ${refs.serverId}`;
    await testSql`DELETE FROM server_emojis WHERE server_id = ${refs.serverId}`;
    await testSql`DELETE FROM stat_counters WHERE server_id IN (${refs.serverId}, ${otherServer})`;
  });
  afterAll(async () => {
    await statRepository.shutdown();
    await testSql`DELETE FROM servers WHERE server_id = ${otherServer}`;
    await cleanupFixtures(testSql);
  });
  function input(name = "Wave custom") {
    return {
      name,
      description: "Use when greeting.",
      emotion_key: "joy",
      media: createCustomExpression(),
      nativeStickerNames: [],
    };
  }
  async function create(name = "Wave custom") {
    const id = randomUUID();
    await serverRepository.saveCustomExpression(refs.serverId, id, null, input(name));
    return id;
  }

  it("migrates down and up to the same stored columns as fresh bootstrap", async () => {
    const columns = () =>
      testSql`SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name IN ('custom_expressions', 'custom_expression_personas') ORDER BY table_name, ordinal_position`;
    const fresh = await columns();
    const migration = join(process.cwd(), "src/db/migrations/097_custom_expressions");
    await executeTestSqlFile(`${migration}.down.sql`);
    try {
      expect(await columns()).toHaveLength(0);
    } finally {
      await executeTestSqlFile(`${migration}.sql`);
    }
    expect(await columns()).toEqual(fresh);
  });

  it("serializes normalized name collisions and rejects native collisions", async () => {
    const writes = await Promise.allSettled([
      serverRepository.saveCustomExpression(refs.serverId, randomUUID(), null, input("Happy-wave")),
      serverRepository.saveCustomExpression(refs.serverId, randomUUID(), null, input("HAPPY_wave")),
    ]);
    expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(writes.filter((result) => result.status === "rejected")).toHaveLength(1);
    await testSql`INSERT INTO server_stickers (server_id, sticker_disc_id, sticker_name) VALUES (${refs.serverId}, '123456789012345678', 'Native-Wave')`;
    await expect(create("native_wave")).rejects.toMatchObject({ code: "collision" });
  });

  it("enforces the shared server limit under concurrent creation while allowing edits and slot reuse", async () => {
    for (let index = 0; index < MAX_CUSTOM_EXPRESSIONS_PER_SERVER - 1; index++) {
      await create(`Expression ${index}`);
    }
    const uploadId = randomUUID();
    const upload = {
      ...input("Uploaded expression"),
      media: createCustomExpression({
        source_kind: "upload",
        delivery_kind: "stored",
        original_link: null,
        storage_reference: `custom-expressions/${refs.serverId}/${uploadId}/${randomUUID()}.png`,
        mime_type: "image/png",
        extension: "png",
        byte_size: 100,
      }),
    };
    const writes = await Promise.allSettled([
      serverRepository.saveCustomExpression(refs.serverId, uploadId, null, upload),
      create("Linked expression"),
    ]);
    expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = writes.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: { code: "limit" } });
    const rows = await serverRepository.loadCustomExpressions(refs.serverId);
    expect(rows).toHaveLength(MAX_CUSTOM_EXPRESSIONS_PER_SERVER);
    await expect(create("One too many")).rejects.toMatchObject({ code: "limit" });
    await expect(
      serverRepository.saveCustomExpression(refs.serverId, randomUUID(), null, { ...upload, name: "Extra upload" }),
    ).rejects.toMatchObject({ code: "limit" });
    const existing = rows[0];
    await serverRepository.setCustomExpressionPersona(
      refs.serverId,
      existing.custom_expression_id,
      1,
      refs.personaId,
      true,
    );
    await serverRepository.saveCustomExpression(refs.serverId, existing.custom_expression_id, 2, input("Edited"));
    const otherId = randomUUID();
    try {
      await serverRepository.saveCustomExpression(otherServer, otherId, null, input("Independent server"));
      expect(await serverRepository.loadCustomExpression(otherServer, otherId)).not.toBeNull();
    } finally {
      await testSql`DELETE FROM custom_expressions WHERE server_id = ${otherServer} AND custom_expression_id = ${otherId}`;
    }
    expect(await serverRepository.deleteCustomExpression(refs.serverId, existing.custom_expression_id, 3)).toBe(true);
    await create("Reused slot");
    expect(await serverRepository.loadCustomExpressions(refs.serverId)).toHaveLength(MAX_CUSTOM_EXPRESSIONS_PER_SERVER);
  });

  it("preserves the row on stale or colliding replacement and keeps identity on rename", async () => {
    const id = await create();
    await create("Taken");
    await expect(serverRepository.saveCustomExpression(refs.serverId, id, 99, input("Renamed"))).rejects.toMatchObject({
      code: "stale",
    });
    await expect(serverRepository.saveCustomExpression(refs.serverId, id, 1, input("Taken"))).rejects.toMatchObject({
      code: "collision",
    });
    const before = await serverRepository.loadCustomExpression(refs.serverId, id);
    expect(before?.revision).toBe(1);
    await serverRepository.saveCustomExpression(refs.serverId, id, 1, input("Renamed"));
    const after = await serverRepository.loadCustomExpression(refs.serverId, id);
    expect(after?.custom_expression_id).toBe(id);
    expect(after?.revision).toBe(2);
    expect(after?.original_link).toBe(before?.original_link);
    expect(await serverRepository.loadCustomExpression(otherServer, id)).toBeNull();
    expect(await serverRepository.deleteCustomExpression(otherServer, id, 2)).toBe(false);
  });

  it("enforces same-server membership and distinguishes manual removal from persona deletion", async () => {
    const id = await create();
    await expect(
      serverRepository.setCustomExpressionPersona(refs.serverId, id, 1, otherPersona, true),
    ).rejects.toMatchObject({ code: "scope" });
    await expect(
      (async () => {
        await testSql`INSERT INTO custom_expression_personas (custom_expression_id, server_id, persona_id) VALUES (${id}, ${refs.serverId}, ${otherPersona})`;
      })(),
    ).rejects.toThrow();
    await serverRepository.setCustomExpressionPersona(refs.serverId, id, 1, refs.personaId, true);
    await serverRepository.setCustomExpressionPersona(refs.serverId, id, 2, refs.personaId, false);
    expect(await serverRepository.loadCustomExpression(refs.serverId, id)).toMatchObject({
      restricted: false,
      persona_ids: [],
      revision: 3,
    });
    const [persona] =
      await testSql`INSERT INTO personas (server_id, persona_nickname, is_alter) VALUES (${refs.serverId}, 'Mirri', true) RETURNING persona_id`;
    await serverRepository.setCustomExpressionPersona(refs.serverId, id, 3, persona.persona_id, true);
    expect(await personaRepository.removePersona(persona.persona_id)).toBe(true);
    expect(await serverRepository.loadCustomExpression(refs.serverId, id)).toMatchObject({
      restricted: true,
      persona_ids: [],
      revision: 5,
    });
  });

  it("edits and clears native rows with nullable metadata using panel revisions", async () => {
    const id = "123456789012345678";
    for (const kind of ["emojis", "stickers"] as const) {
      if (kind === "emojis")
        await testSql`INSERT INTO server_emojis (server_id, emoji_disc_id, emoji_name, emoji_desc, emotion_key) VALUES (${refs.serverId}, ${id}, 'Wave', NULL, NULL)`;
      else
        await testSql`INSERT INTO server_stickers (server_id, sticker_disc_id, sticker_name, sticker_desc, emotion_key) VALUES (${refs.serverId}, ${id}, 'Wave', NULL, NULL)`;
      const first = (await serverRepository.loadExpressionPanelMetadata(refs.serverId))[kind][0];
      expect(first.emotion_key).toBe("unset");
      await serverRepository.writeNativeExpression(refs.serverId, kind, id, nativeExpressionRevision(first), {
        description: "Greeting",
        emotion: "joy",
      });
      const edited = (await serverRepository.loadExpressionPanelMetadata(refs.serverId))[kind][0];
      expect(edited.emotion_key).toBe("joy");
      expect("emoji_desc" in edited ? edited.emoji_desc : edited.sticker_desc).toBe("Greeting");
      await serverRepository.writeNativeExpression(refs.serverId, kind, id, nativeExpressionRevision(edited), null);
      const cleared = (await serverRepository.loadExpressionPanelMetadata(refs.serverId))[kind][0];
      expect(cleared.emotion_key).toBe("unset");
      expect("emoji_desc" in cleared ? cleared.emoji_desc : cleared.sticker_desc).toBe("");
    }
  });

  it("removes registry rows, memberships and owned media in both server-wipe modes", async () => {
    process.env.EXPRESSION_STORAGE_BACKEND = "local";
    const servers: number[] = [];
    const owned: Array<{ serverId: number; id: string; reference: string }> = [];
    try {
      const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: "red" } })
        .png()
        .toBuffer();
      async function register(serverId: number, name: string) {
        const id = randomUUID();
        const reference = await storeExpressionMedia(serverId, id, png, "image/png", "png");
        owned.push({ serverId, id, reference });
        await serverRepository.saveCustomExpression(serverId, id, null, {
          ...input(name),
          media: createCustomExpression({
            source_kind: "upload",
            delivery_kind: "stored",
            original_link: null,
            storage_reference: reference,
            mime_type: "image/png",
            extension: "png",
            byte_size: png.length,
          }),
        });
        return { id, reference };
      }
      const control = await register(otherServer, "Other server wave");
      for (const preservePersonas of [true, false]) {
        const discId = `_rt_expression_wipe_${randomUUID()}`;
        const [server] = await testSql`INSERT INTO servers (server_disc_id) VALUES (${discId}) RETURNING server_id`;
        const serverId: number = server.server_id;
        servers.push(serverId);
        const [persona] =
          await testSql`INSERT INTO personas (server_id, persona_nickname, is_alter) VALUES (${serverId}, 'Mirri', false) RETURNING persona_id`;
        const expression = await register(serverId, "Wave");
        await serverRepository.setCustomExpressionPersona(serverId, expression.id, 1, persona.persona_id, true);
        expect(await serverRepository.nukeServer(serverId, discId, { preservePersonas })).toBe(true);
        expect(await serverRepository.loadCustomExpressions(serverId)).toHaveLength(0);
        expect(
          await testSql`SELECT persona_id FROM custom_expression_personas WHERE server_id = ${serverId}`,
        ).toHaveLength(0);
        await expect(loadExpressionMedia(expression.reference, serverId, expression.id)).rejects.toMatchObject({
          code: "ENOENT",
        });
        expect(await testSql`SELECT server_id FROM servers WHERE server_id = ${serverId}`).toHaveLength(
          preservePersonas ? 1 : 0,
        );
        expect(await testSql`SELECT persona_id FROM personas WHERE persona_id = ${persona.persona_id}`).toHaveLength(
          preservePersonas ? 1 : 0,
        );
        expect(await serverRepository.loadCustomExpression(otherServer, control.id)).not.toBeNull();
        expect(await loadExpressionMedia(control.reference, otherServer, control.id)).toEqual(png);
      }
    } finally {
      for (const media of owned) {
        await deleteExpressionMedia(media.reference, media.serverId, media.id);
        await testSql`DELETE FROM custom_expressions WHERE server_id = ${media.serverId} AND custom_expression_id = ${media.id}`;
      }
      for (const serverId of servers) await testSql`DELETE FROM servers WHERE server_id = ${serverId}`;
    }
  });

  it("clears native metadata without removing the asset and rejects stale metadata writes", async () => {
    const stickerId = "123456789012345678";
    await testSql`INSERT INTO server_stickers (server_id, sticker_disc_id, sticker_name, sticker_desc, emotion_key) VALUES (${refs.serverId}, ${stickerId}, 'Wave', 'Greeting', 'joy')`;
    const first = (await serverRepository.loadExpressionPanelMetadata(refs.serverId)).stickers[0];
    await serverRepository.writeNativeExpression(
      refs.serverId,
      "stickers",
      stickerId,
      nativeExpressionRevision(first),
      null,
    );
    const current = (await serverRepository.loadExpressionPanelMetadata(refs.serverId)).stickers[0];
    expect(current.sticker_disc_id).toBe(stickerId);
    expect(current.sticker_desc).toBe("");
    expect(current.emotion_key).toBe("unset");
    await sql.transaction(async (tx) =>
      serverRepository.syncStickers(tx, refs.serverId, [
        {
          id: stickerId,
          name: "Renamed",
          description: "Discord asset description",
          format: StickerFormatType.PNG,
        } as Sticker,
      ]),
    );
    expect((await serverRepository.loadExpressionPanelMetadata(refs.serverId)).stickers[0].sticker_desc).toBe("");
    await expect(
      serverRepository.writeNativeExpression(refs.serverId, "stickers", stickerId, nativeExpressionRevision(first), {
        description: "Changed",
        emotion: "joy",
      }),
    ).rejects.toMatchObject({ code: "stale" });
  });

  it("does not overwrite a manager edit committed after synchronization reads metadata", async () => {
    const id = "123456789012345678";
    await testSql`INSERT INTO server_stickers (server_id, sticker_disc_id, sticker_name, sticker_desc, emotion_key) VALUES (${refs.serverId}, ${id}, 'Wave', 'Original', 'joy')`;
    const original = (await serverRepository.loadExpressionPanelMetadata(refs.serverId)).stickers[0];
    await sql.transaction(async (tx) => {
      const intercepted = new Proxy(tx, {
        get(target, property) {
          if (property === "unsafe")
            return async (query: string) => {
              const rows = await tx.unsafe(query);
              if (query.includes("SELECT sticker_disc_id, sticker_desc, emotion_key")) {
                await serverRepository.writeNativeExpression(
                  refs.serverId,
                  "stickers",
                  id,
                  nativeExpressionRevision(original),
                  { description: "Manager edit", emotion: "sadness" },
                );
              }
              return rows;
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await serverRepository.syncStickers(intercepted, refs.serverId, [
        { id, name: "Renamed", description: "Discord description", format: StickerFormatType.PNG } as Sticker,
      ]);
    });
    expect((await serverRepository.loadExpressionPanelMetadata(refs.serverId)).stickers[0]).toMatchObject({
      sticker_name: "Renamed",
      sticker_desc: "Manager edit",
      emotion_key: "sadness",
    });
  });

  it("reads selected all-time usage across users and personas without flushing or a top-N cutoff", async () => {
    const id = await create();
    for (let index = 0; index < 18; index++) {
      statRepository.recordStat({
        serverId: refs.serverId,
        userId: refs.userId,
        lineageId: refs.personaLineageId + index,
        metric: "custom_expression_used",
        metricKey: id,
        delta: 2,
      });
    }
    statRepository.recordStat({
      serverId: otherServer,
      userId: refs.userId,
      metric: "custom_expression_used",
      metricKey: id,
      delta: 100,
    });
    expect(await statRepository.getServerExpressionCount(refs.serverId, "custom_expression_used", id)).toBe(0);
    await statRepository.flush();
    expect(await statRepository.getServerExpressionCount(refs.serverId, "custom_expression_used", id)).toBe(36);
    await serverRepository.saveCustomExpression(refs.serverId, id, 1, input("Renamed"));
    expect(await statRepository.getServerExpressionCount(refs.serverId, "custom_expression_used", id)).toBe(36);
    const emotions = await statRepository.getEmotionBreakdown({ serverId: refs.serverId });
    expect(emotions.find((entry) => entry.emotion === "joy")?.count).toBe(36);
  });
});
