import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Collection, type BaseGuildTextChannel, type Webhook, type WebhookType } from "discord.js";
import { MANAGED_WEBHOOK_KINDS, serverRepository } from "@/utils/db/repositories/ServerRepository";
import {
  clearWebhookCache,
  getCachedManagedWebhookForChannel,
  getOrCreateWebhook,
  getWebhookCacheSizes,
  getWebhookCacheStats,
  invalidateWebhookCache,
  resolveManagedWebhookForChannel,
  runWithWebhookIdentity,
} from "@/utils/discord/webhook/webhookCore";
import { initializeDatabase } from "@/utils/db/initializeDatabase";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

const guildId = "_managed_slots_guild";
const channelId = "_managed_slots_channel";
const token = "synthetic_webhook_token";
const avatar =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG5kAAAAASUVORK5CYII=";
const fingerprint = "f90f414792f09bf5c4829e454950ff325a43ac1abf4d4ec15fc4b98e428a9e03";

function makeWebhook(id: string, hash: string | null = "avatar_hash"): Webhook<WebhookType.Incoming> {
  const webhook = {
    id,
    token,
    channelId,
    guildId,
    avatar: hash,
    edit: mock(async () => {
      webhook.avatar = "updated_hash";
      return webhook as unknown as Webhook<WebhookType.Incoming>;
    }),
  };
  return webhook as unknown as Webhook<WebhookType.Incoming>;
}

function makeChannel(webhooks: Webhook[]) {
  const fetchWebhook = mock(async (id: string, credential: string) => {
    expect(credential).toBe(token);
    const webhook = webhooks.find((candidate) => candidate.id === id);
    if (!webhook) throw Object.assign(new Error(), { code: 10015 });
    return webhook;
  });
  const channel = {
    id: channelId,
    guildId,
    client: { fetchWebhook, user: { id: "_managed_slots_bot" } },
    fetchWebhooks: mock(async () => new Collection(webhooks.map((webhook) => [webhook.id, webhook]))),
    createWebhook: mock(async () => {
      throw new Error("Unexpected creation");
    }),
  } as unknown as BaseGuildTextChannel;
  return { channel, fetchWebhook };
}

describe.skipIf(!DB_TESTS_AVAILABLE)("managed webhook slot storage and lifecycle", () => {
  beforeAll(setupTestDb);
  beforeEach(async () => {
    clearWebhookCache();
    await testSql`DELETE FROM discord_managed_webhooks WHERE guild_disc_id = ${guildId}`;
  });
  afterEach(() => mock.restore());
  afterAll(async () => {
    clearWebhookCache();
    await testSql`DELETE FROM discord_managed_webhooks WHERE guild_disc_id = ${guildId}`;
  });

  async function store(kind: (typeof MANAGED_WEBHOOK_KINDS)[number], id: string) {
    expect(
      await serverRepository.upsertManagedWebhook({
        guildDiscId: guildId,
        channelDiscId: channelId,
        webhookDiscId: id,
        kind,
        rawToken: token,
        avatarFingerprint: fingerprint,
        discordAvatarHash: "avatar_hash",
      }),
    ).toBe(true);
  }

  it("stores encrypted credentials and metadata for every slot with scoped exact-ID lookup", async () => {
    for (const kind of MANAGED_WEBHOOK_KINDS) await store(kind, `_${kind}`);
    const rows = await serverRepository.listManagedWebhooksByChannel(channelId);
    expect(rows.map((row) => row.kind)).toEqual([...MANAGED_WEBHOOK_KINDS]);
    for (const row of rows) {
      expect(row.webhook_token.toString()).not.toContain(token);
      expect(await serverRepository.decryptManagedWebhookToken(row)).toBe(token);
      expect(row.avatar_fingerprint).toBe(fingerprint);
      expect(row.discord_avatar_hash).toBe("avatar_hash");
      expect(
        (await serverRepository.loadManagedWebhookByChannelAndWebhookId(channelId, row.webhook_disc_id))?.kind,
      ).toBe(row.kind);
      expect(
        await serverRepository.loadManagedWebhookByChannelAndWebhookId("_other_channel", row.webhook_disc_id),
      ).toBeNull();
    }
    expect(
      await serverRepository.upsertManagedWebhook({
        guildDiscId: guildId,
        channelDiscId: "_other_channel",
        webhookDiscId: rows[0].webhook_disc_id,
        rawToken: token,
      }),
    ).toBe(false);
    await testSql`INSERT INTO discord_managed_webhooks (guild_disc_id, channel_disc_id, kind, webhook_disc_id, webhook_token)
      VALUES (${guildId}, ${channelId}, 'persona', '_legacy_persona', pgp_sym_encrypt(${token}, 'synthetic_key'))`;
    expect(await serverRepository.loadManagedWebhookByChannelAndWebhookId(channelId, "_legacy_persona")).toBeNull();
  });

  it("restores encrypted pool IDs without replacing the primary and clears only a failed slot", async () => {
    await store("shared_channel", "_primary");
    await store("avatar_pool_1", "_pool");
    const primary = makeWebhook("_primary");
    const pool = makeWebhook("_pool");
    const { channel, fetchWebhook } = makeChannel([primary, pool]);
    expect(await resolveManagedWebhookForChannel(channel, primary.id)).toBe(primary);
    expect(await resolveManagedWebhookForChannel(channel, pool.id)).toBe(pool);
    expect((await getOrCreateWebhook(channel)).webhook).toBe(primary);
    expect(fetchWebhook).toHaveBeenCalledTimes(2);
    expect(getWebhookCacheStats().cacheSize).toBe(2);
    invalidateWebhookCache(channelId, pool.id);
    expect(getCachedManagedWebhookForChannel(channelId, pool.id)).toBeNull();
    expect((await getOrCreateWebhook(channel)).webhook).toBe(primary);
    clearWebhookCache();
    expect(getWebhookCacheSizes().webhookManagedSlots).toBe(0);
    expect(getWebhookCacheStats().cacheSize).toBe(0);
    expect((await getOrCreateWebhook(channel)).webhook).toBe(primary);
    expect(getCachedManagedWebhookForChannel(channelId, pool.id)).toBeNull();
    expect(await resolveManagedWebhookForChannel(channel, pool.id)).toBe(pool);
    expect((await getOrCreateWebhook(channel)).webhook).toBe(primary);
  });

  it("restores only the primary on a cold lookup while pool slots remain available by ID", async () => {
    await store("shared_channel", "_primary");
    for (const kind of MANAGED_WEBHOOK_KINDS.filter((kind) => kind !== "shared_channel")) {
      await store(kind, `_${kind}`);
    }
    const primary = makeWebhook("_primary");
    const { channel, fetchWebhook } = makeChannel([primary]);
    expect((await getOrCreateWebhook(channel)).webhook).toBe(primary);
    expect(fetchWebhook.mock.calls.map(([id]) => id)).toEqual([primary.id]);
    expect(await serverRepository.listManagedWebhooksByChannel(channelId)).toHaveLength(MANAGED_WEBHOOK_KINDS.length);
  });

  it("creates a primary without adopting a same-name pool slot, including a tokenless one", async () => {
    for (const restorePool of [false, true]) {
      for (const poolToken of [token, null]) {
        clearWebhookCache();
        await testSql`DELETE FROM discord_managed_webhooks WHERE guild_disc_id = ${guildId}`;
        await store("avatar_pool_1", "_pool");
        const pool = {
          ...makeWebhook("_pool"),
          name: "TomoriBot Multi-Persona",
          owner: { id: "_managed_slots_bot" },
          delete: mock(async () => undefined),
        } as unknown as Webhook<WebhookType.Incoming>;
        const primary = makeWebhook("_primary", null);
        const { channel, fetchWebhook } = makeChannel([pool]);
        if (restorePool) await resolveManagedWebhookForChannel(channel, pool.id);
        const discoveredPool = { ...pool, token: poolToken } as Webhook<WebhookType.Incoming>;
        spyOn(channel, "fetchWebhooks")
          .mockResolvedValue(
            new Collection([
              [pool.id, discoveredPool],
              [primary.id, primary],
            ]),
          )
          .mockResolvedValueOnce(new Collection([[pool.id, discoveredPool]]));
        const create = spyOn(channel, "createWebhook").mockResolvedValue(primary);
        expect((await getOrCreateWebhook(channel)).webhook).toBe(primary);
        expect(create).toHaveBeenCalledTimes(1);
        expect(pool.delete).not.toHaveBeenCalled();
        expect(fetchWebhook.mock.calls.map(([id]) => id)).toEqual(restorePool ? [pool.id] : []);
        expect((await serverRepository.loadManagedWebhookByChannel(channelId))?.webhook_disc_id).toBe(primary.id);
        const poolRow = await serverRepository.loadManagedWebhookByChannelAndWebhookId(channelId, pool.id);
        expect(poolRow?.kind).toBe("avatar_pool_1");
        expect(poolRow?.avatar_fingerprint).toBe(fingerprint);
        expect(getCachedManagedWebhookForChannel(channelId, pool.id)).toBe(restorePool ? pool : null);
        expect((await getOrCreateWebhook(channel)).webhook).toBe(primary);
        mock.restore();
      }
    }
  });

  it("persists successful avatar edits once and clears assignments when the avatar is reset", async () => {
    await store("avatar_pool_1", "_pool");
    await testSql`UPDATE discord_managed_webhooks SET avatar_fingerprint = NULL WHERE webhook_disc_id = '_pool'`;
    const pool = makeWebhook("_pool");
    const { channel } = makeChannel([pool]);
    await resolveManagedWebhookForChannel(channel, pool.id);
    const write = spyOn(serverRepository, "upsertManagedWebhook");
    await runWithWebhookIdentity(pool, { avatarDataUri: avatar }, async () => undefined);
    await runWithWebhookIdentity(pool, { avatarDataUri: avatar }, async () => undefined);
    expect(write).toHaveBeenCalledTimes(1);
    const row = await serverRepository.loadManagedWebhookByChannelAndWebhookId(channelId, pool.id);
    expect(row?.avatar_fingerprint).toBe(fingerprint);
    expect(row?.discord_avatar_hash).toBe("updated_hash");
    await runWithWebhookIdentity(pool, {}, async () => undefined);
    expect(
      (await serverRepository.loadManagedWebhookByChannelAndWebhookId(channelId, pool.id))?.avatar_fingerprint,
    ).toBeNull();
  });

  it("retains historic rows and blocks delivery when an avatar PATCH cannot persist", async () => {
    await store("shared_channel", "_primary");
    await store("avatar_pool_1", "_pool");
    await testSql`UPDATE discord_managed_webhooks SET avatar_fingerprint = NULL WHERE webhook_disc_id = '_pool'`;
    const primary = makeWebhook("_primary");
    const pool = makeWebhook("_pool");
    const { channel } = makeChannel([primary, pool]);
    await getOrCreateWebhook(channel);
    await resolveManagedWebhookForChannel(channel, pool.id);
    const send = mock(async () => undefined);
    const write = spyOn(serverRepository, "upsertManagedWebhook").mockResolvedValue(false);
    await expect(runWithWebhookIdentity(pool, { avatarDataUri: avatar }, send)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(getCachedManagedWebhookForChannel(channelId, pool.id)).toBeNull();
    expect(getCachedManagedWebhookForChannel(channelId, primary.id)).toBe(primary);
    expect(await serverRepository.loadManagedWebhookByChannelAndWebhookId(channelId, pool.id)).not.toBeNull();
    write.mockRestore();
    expect(await resolveManagedWebhookForChannel(channel, pool.id)).toBe(pool);
    expect(
      (await serverRepository.loadManagedWebhookByChannelAndWebhookId(channelId, pool.id))?.avatar_fingerprint,
    ).toBeNull();
  });

  it("marks an externally changed avatar unknown before caching the restored slot", async () => {
    await store("avatar_pool_1", "_pool");
    const pool = makeWebhook("_pool", "external_hash");
    const { channel } = makeChannel([pool]);
    expect(await resolveManagedWebhookForChannel(channel, pool.id)).toBe(pool);
    const row = await serverRepository.loadManagedWebhookByChannelAndWebhookId(channelId, pool.id);
    expect(row?.avatar_fingerprint).toBeNull();
    expect(row?.discord_avatar_hash).toBe("external_hash");
    await runWithWebhookIdentity(pool, { avatarDataUri: avatar }, async () => undefined);
    expect(pool.edit).toHaveBeenCalledTimes(1);
  });

  it("removes invalid or undecryptable slots without losing the primary row", async () => {
    await store("shared_channel", "_primary");
    await store("avatar_pool_1", "_missing");
    await store("avatar_pool_2", "_bad_token");
    await testSql`UPDATE discord_managed_webhooks SET webhook_token = pgp_sym_encrypt(${token}, 'different_secret') WHERE webhook_disc_id = '_bad_token'`;
    const { channel } = makeChannel([]);
    expect(await resolveManagedWebhookForChannel(channel, "_missing")).toBeNull();
    expect(await resolveManagedWebhookForChannel(channel, "_bad_token")).toBeNull();
    expect((await serverRepository.listManagedWebhooksByChannel(channelId)).map((row) => row.webhook_disc_id)).toEqual([
      "_primary",
    ]);
  });

  it("rejects a restored webhook in another channel and deletes only that stored slot", async () => {
    await store("shared_channel", "_primary");
    await store("avatar_pool_1", "_pool");
    const { channel } = makeChannel([{ ...makeWebhook("_pool"), channelId: "_other_channel" } as Webhook]);
    expect(await resolveManagedWebhookForChannel(channel, "_pool")).toBeNull();
    expect(await serverRepository.loadManagedWebhookByChannelAndWebhookId(channelId, "_pool")).toBeNull();
    expect(await serverRepository.loadManagedWebhookByChannel(channelId)).not.toBeNull();
  });

  it("adds unknown assignments on fresh and existing databases and supports migration replay and rollback", async () => {
    const [columns] = await testSql`SELECT count(*)::int AS count FROM information_schema.columns
      WHERE table_name = 'discord_managed_webhooks' AND column_name IN ('avatar_fingerprint', 'discord_avatar_hash')`;
    expect(columns.count).toBe(2);
    await store("shared_channel", "_primary");
    await executeTestSqlFile("src/db/migrations/104_managed_webhook_avatar_slots.down.sql");
    await executeTestSqlFile("src/db/migrations/104_managed_webhook_avatar_slots.sql");
    await executeTestSqlFile("src/db/migrations/104_managed_webhook_avatar_slots.sql");
    let row = await serverRepository.loadManagedWebhookByChannel(channelId);
    expect(row?.avatar_fingerprint).toBeNull();
    expect(row?.discord_avatar_hash).toBeNull();
    if (!row) throw new Error("Missing restored primary row");
    expect(await serverRepository.decryptManagedWebhookToken(row)).toBe(token);
    await executeTestSqlFile("src/db/migrations/104_managed_webhook_avatar_slots.down.sql");
    await initializeDatabase({ client: testSql, includeRag: false });
    row = await serverRepository.loadManagedWebhookByChannel(channelId);
    expect(row?.avatar_fingerprint).toBeNull();
    expect(row?.discord_avatar_hash).toBeNull();
  });
});
