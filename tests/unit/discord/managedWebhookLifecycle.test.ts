import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Collection, type BaseGuildTextChannel, type Webhook } from "discord.js";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import {
  clearWebhookCache,
  getCachedManagedWebhookForChannel,
  getOrCreateWebhook,
  getWebhookCacheStats,
  getWebhookCacheSizes,
  resolveManagedWebhookForChannel,
} from "@/utils/discord/webhook/webhookCore";

describe("managed webhook creation persistence", () => {
  beforeEach(() => {
    clearWebhookCache();
    spyOn(serverRepository, "listManagedWebhooksByChannel").mockResolvedValue([]);
    spyOn(serverRepository, "loadManagedWebhookByChannelAndWebhookId").mockResolvedValue(null);
  });
  afterEach(() => {
    clearWebhookCache();
    mock.restore();
  });

  function makeChannel(persist: boolean, token: string | null = "synthetic_token") {
    const remove = mock(async () => undefined);
    const webhook = {
      id: "_new_webhook",
      channelId: "_channel",
      guildId: "_guild",
      token,
      avatar: null,
      delete: remove,
    } as unknown as Webhook;
    const createWebhook = mock(async () => webhook);
    const channel = {
      id: "_channel",
      name: "test",
      guildId: "_guild",
      client: { user: { id: "_bot" } },
      fetchWebhooks: mock(async () => new Collection()),
      createWebhook,
    } as unknown as BaseGuildTextChannel;
    const write = spyOn(serverRepository, "upsertManagedWebhook").mockImplementation(async () => {
      expect(getCachedManagedWebhookForChannel(channel.id, webhook.id)).toBeNull();
      return persist;
    });
    return { channel, webhook, remove, write };
  }

  it("retries after a failed slot-list read without creating a webhook or caching channel failure", async () => {
    const { channel, webhook } = makeChannel(true);
    const list = spyOn(serverRepository, "listManagedWebhooksByChannel").mockRejectedValueOnce(
      Object.assign(new Error(), { code: "CONNECTION_CLOSED" }),
    );
    expect((await getOrCreateWebhook(channel)).webhook).toBeNull();
    expect(channel.fetchWebhooks).not.toHaveBeenCalled();
    expect(channel.createWebhook).not.toHaveBeenCalled();
    expect(getWebhookCacheSizes().webhookFailure).toBe(0);
    expect((await getOrCreateWebhook(channel)).webhook).toBe(webhook);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("publishes a new primary only after credential persistence succeeds", async () => {
    const { channel, webhook, remove, write } = makeChannel(true);
    expect((await getOrCreateWebhook(channel)).webhook).toBe(webhook);
    expect(write).toHaveBeenCalledTimes(1);
    expect(getCachedManagedWebhookForChannel(channel.id, webhook.id)).toBe(webhook);
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes an unused new webhook when persistence fails and keeps it out of the cache", async () => {
    const { channel, remove } = makeChannel(false);
    expect((await getOrCreateWebhook(channel)).webhook).toBeNull();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(getWebhookCacheStats().cacheSize).toBe(0);
  });

  it("keeps an orphan untrusted when cleanup also fails", async () => {
    const { channel, webhook, remove } = makeChannel(false);
    remove.mockRejectedValue(Object.assign(new Error(), { code: 50013 }));
    expect((await getOrCreateWebhook(channel)).webhook).toBeNull();
    expect(await resolveManagedWebhookForChannel(channel, webhook.id)).toBeNull();
    expect(getWebhookCacheStats().cacheSize).toBe(0);
  });

  it("does not publish tokenless creations", async () => {
    const { channel, remove, write } = makeChannel(true, null);
    expect((await getOrCreateWebhook(channel)).webhook).toBeNull();
    expect(write).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
