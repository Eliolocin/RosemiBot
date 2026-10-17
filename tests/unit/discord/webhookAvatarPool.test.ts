import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import {
  Collection,
  RateLimitError,
  Webhook,
  type BaseGuildTextChannel,
  type Message,
  type Sticker,
  type Client,
  type ChatInputCommandInteraction,
  type WebhookMessageCreateOptions,
} from "discord.js";
import {
  type ManagedDiscordWebhookRow,
  type ManagedWebhookKind,
  serverRepository,
} from "@/utils/db/repositories/ServerRepository";
import {
  clearWebhookCache,
  dispatchWebhookWithIdentity,
  GENERIC_WEBHOOK_AVATAR_URL,
  getCachedManagedWebhookForChannel,
  getOrCreateWebhook,
  getSingleAttemptWebhookRest,
  resolveManagedWebhookForChannel,
  runWithWebhookIdentity,
  sendWebhookMessageWithIdentity,
  sendWebhookMessagesWithIdentity,
} from "@/utils/discord/webhook/webhookCore";
import { shouldRejectWebhookRateLimit } from "@/utils/discord/webhook/avatarEditRateLimit";
import { log } from "@/utils/misc/logger";
import type { StreamContext } from "@/types/stream/interfaces";
import type { ToolContext } from "@/types/tool/interfaces";
import { createDefaultStreamState } from "@/types/stream/types";
import { StreamUiUpdater } from "@/utils/discord/stream/uiUpdater";
import {
  clearAllChannelDeliveryContinuity,
  getChannelLastDelivery,
  recordChannelDeliveredWebhookIdentity,
} from "@/utils/discord/stream/channelDeliveryContinuity";
import { sendPersonaPostViaWebhook } from "@/utils/discord/webhook/personaPost";
import { sendWebhookReplyWithContext } from "@/utils/discord/webhookReply";
import { deleteSupersededStreamMessages } from "@/utils/discord/stream/supersededMessageCleanup";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { attachShowMarkdownCollector } from "@/utils/discord/markdownTableButton";
import { sendFallbackModelUsageNotice } from "@/utils/discord/fallbackModelNotice";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createLlmRow, createPersona, createUserRow } from "../../helpers/fixtures";
import { personaSpriteMessageRepository } from "@/utils/db/repositories/PersonaSpriteMessageRepository";
import { deliverVoiceMessage, postVoiceTranscriptCaption } from "@/utils/discord/webhook/voiceMessageDelivery";
import { createExpressionDeliveryState, deliverExpression } from "@/utils/chat/expressionDelivery";
import type { ChatTurnContext } from "@/utils/chat/types";
import { clearWebhookIdentityCache, verifyMessageWebhook } from "@/utils/chat/webhookIdentity";
import { sendTaskEmbedWithExpand } from "@/utils/discord/expandableEmbedNotice";
import { ManageMessageTool } from "@/tools/functionCalls/manageMessageTool";
import { execute as deleteTurn } from "@/commands/tool/delete/turn";
import * as personaCache from "@/utils/cache/tomoriStateCache";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import { handleMatrixEvent } from "@/utils/bridges/matrix/events";
import * as matrixRooms from "@/utils/bridges/matrix/rooms";
import * as matrixMedia from "@/utils/bridges/matrix/media";
import * as matrixState from "@/utils/bridges/matrix/state";
import type { Request as BridgeRequest, WeakEvent } from "matrix-appservice-bridge";

const avatarA =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG5kAAAAASUVORK5CYII=";
const avatarB =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const fingerprint = (avatar: string) =>
  createHash("sha256")
    .update(Buffer.from(avatar.split(",")[1], "base64"))
    .digest("hex");

function deferredPatch() {
  const data = {
    global: false,
    method: "PATCH",
    url: "https://discord.com/api/v10/webhooks/1/synthetic_token",
    route: "/webhooks/:id/:token",
    majorParameter: "1",
    hash: "bucket",
    limit: 2,
    timeToReset: 60_000,
    retryAfter: 60_000,
    sublimitTimeout: 0,
    scope: "user" as const,
  };
  expect(shouldRejectWebhookRateLimit(data)).toBe(true);
  return new RateLimitError(data);
}

function makePool() {
  const rows: ManagedDiscordWebhookRow[] = [];
  const webhooks = new Map<string, Webhook>();
  const delivered: {
    webhookId: string;
    username?: string;
    avatar: string | null;
    threadId?: string;
    content?: string;
  }[] = [];
  const faces = new Map<string, string | null>();
  const messages = new Map<string, Message>();
  const collectors: { expire: () => Promise<void> }[] = [];
  const channelId = "_pool_parent";
  const guildId = "_pool_guild";
  let serial = 0;
  const channel = {
    id: channelId,
    guildId,
    lastMessageId: null as string | null,
    isThread: () => false,
    send: mock(async () => ({ id: "_bot_message", webhookId: null, channelId }) as Message),
    messages: {
      fetch: mock(async () => new Collection([...messages].reverse())),
      delete: mock(async () => {
        throw Object.assign(new Error(), { code: 50013 });
      }),
    },
    client: {
      user: { id: "_bot" },
      options: {},
      rest: { post: mock(async () => ({ id: "_bot_voice" })) },
      fetchWebhook: mock(async (id: string, token: string) => {
        expect(token).toBe("synthetic_token");
        const webhook = webhooks.get(id);
        if (!webhook) throw Object.assign(new Error(), { code: 10015 });
        return webhook;
      }),
    },
    fetchWebhooks: mock(async () => new Collection(webhooks)),
    createWebhook: mock(async (options: { avatar?: string }) => addWebhook(`_created_${++serial}`, options.avatar)),
  };
  const thread = (id: string) => ({ ...channel, id, parent: channel, parentId: channelId, isThread: () => true });
  function addWebhook(id: string, avatar?: string) {
    faces.set(id, avatar ?? null);
    const webhook = {
      id,
      guildId,
      channelId,
      channel,
      client: channel.client,
      token: "synthetic_token" as string | null,
      avatar: avatar ? fingerprint(avatar) : null,
      edit: mock(async ({ avatar: nextAvatar }: { avatar: string | null }) => {
        webhook.avatar = nextAvatar ? fingerprint(nextAvatar) : null;
        faces.set(id, nextAvatar);
        return webhook as unknown as Webhook;
      }),
      send: mock(async (payload: WebhookMessageCreateOptions) => {
        delivered.push({
          webhookId: id,
          username: payload.username,
          avatar: payload.avatarURL ?? faces.get(id) ?? null,
          threadId: payload.threadId,
          content: payload.content,
        });
        const message = {
          id: `_message_${delivered.length}`,
          webhookId: id,
          author: { id, username: payload.username ?? "TomoriBot", bot: true },
          content: payload.content ?? "",
          attachments: new Collection(),
          stickers: new Collection(),
          embeds: [],
          guildId,
          channelId: payload.threadId ?? channelId,
          channel: payload.threadId ? thread(payload.threadId) : channel,
          edit: mock(async () => {
            throw new Error("Webhook message requires authoring credentials");
          }),
          createMessageComponentCollector: () => {
            const handlers = new Map<string, () => Promise<void>>();
            const collector = {
              on: (event: string, handler: () => Promise<void>) => {
                handlers.set(event, handler);
                return collector;
              },
              expire: async () => {
                await handlers.get("end")?.();
              },
            };
            collectors.push(collector);
            return collector;
          },
        } as unknown as Message;
        messages.set(message.id, message);
        return message;
      }),
      editMessage: mock(async (messageId: string, payload: WebhookMessageCreateOptions) => {
        const message = messages.get(messageId);
        if (message?.webhookId !== id) throw Object.assign(new Error(), { code: 10008 });
        return { ...message, components: payload.components } as Message;
      }),
      deleteMessage: mock(async (messageId: string, _threadId?: string) => {
        if (messages.get(messageId)?.webhookId !== id) throw Object.assign(new Error(), { code: 10008 });
        messages.delete(messageId);
      }),
      delete: mock(async () => {
        webhooks.delete(id);
      }),
    };
    Object.setPrototypeOf(webhook, Webhook.prototype);
    webhooks.set(id, webhook as unknown as Webhook);
    return webhook;
  }
  const write = spyOn(serverRepository, "upsertManagedWebhook").mockImplementation(async (input) => {
    const kind = input.kind ?? "shared_channel";
    const row = rows.find((row) => row.kind === kind);
    const saved: ManagedDiscordWebhookRow = {
      managed_webhook_id: row?.managed_webhook_id ?? rows.length + 1,
      guild_disc_id: input.guildDiscId,
      channel_disc_id: input.channelDiscId,
      webhook_disc_id: input.webhookDiscId,
      kind,
      webhook_token: Buffer.from("synthetic_encrypted_token"),
      key_version: 1,
      avatar_fingerprint: input.avatarFingerprint ?? null,
      discord_avatar_hash: input.discordAvatarHash ?? null,
    };
    if (row) rows.splice(rows.indexOf(row), 1, saved);
    else rows.push(saved);
    return true;
  });
  const list = spyOn(serverRepository, "listManagedWebhooksByChannel").mockImplementation(async () => [...rows]);
  spyOn(serverRepository, "loadManagedWebhookByChannelAndWebhookId").mockImplementation(
    async (channel, id) => rows.find((row) => row.channel_disc_id === channel && row.webhook_disc_id === id) ?? null,
  );
  spyOn(serverRepository, "decryptManagedWebhookToken").mockResolvedValue("synthetic_token");
  spyOn(serverRepository, "deleteManagedWebhook").mockImplementation(async (_channel, id) => {
    const index = rows.findIndex((row) => row.webhook_disc_id === id);
    if (index >= 0) rows.splice(index, 1);
    return true;
  });
  async function store(id: string, kind: ManagedWebhookKind, avatar?: string) {
    const webhook = addWebhook(id, avatar);
    await serverRepository.upsertManagedWebhook({
      guildDiscId: guildId,
      channelDiscId: channelId,
      webhookDiscId: id,
      kind,
      rawToken: "synthetic_token",
      avatarFingerprint: avatar ? fingerprint(avatar) : null,
      discordAvatarHash: webhook.avatar,
    });
    return webhook;
  }
  async function primary(avatar?: string) {
    const webhook = await store("_primary", "shared_channel", avatar);
    expect((await getOrCreateWebhook(channel as unknown as BaseGuildTextChannel)).webhook).toBe(
      webhook as unknown as Webhook,
    );
    return webhook;
  }
  return { rows, webhooks, delivered, channel, write, list, store, primary, addWebhook, thread, messages, collectors };
}

function makeStream(pool: ReturnType<typeof makePool>, webhook: Webhook, withReply = false) {
  const channel = pool.thread("_stream_thread");
  const context = {
    channel,
    client: pool.channel.client,
    webhook,
    personaUsername: "Juno",
    personaAvatarUrl: avatarB,
    tomoriState: createPersona({ persona_id: 2, persona_nickname: "Juno", is_alter: true }),
    locale: "en-US",
    replyNoticeState: { attempted: false, sent: false },
    replyToMessage: withReply
      ? {
          id: "_source",
          channelId: channel.id,
          channel,
          webhookId: null,
          url: "https://discord.com/channels/1/2/3",
          author: { id: "_reader", username: "Bau", displayAvatarURL: () => "https://example.invalid/reader.png" },
        }
      : undefined,
    deliveredMessageRefs: [],
  } as unknown as StreamContext;
  const state = createDefaultStreamState();
  state.hasRepliedToOriginalMessage = !withReply;
  const updater = new StreamUiUpdater({
    hasStopRequest: () => false,
    requestStop: () => true,
    notifyStreamProgress: () => undefined,
  });
  return { channel, context, state, updater };
}

describe("managed local avatar dispatch", () => {
  beforeAll(initializeLocalizer);
  beforeEach(() => {
    clearWebhookCache();
    clearAllChannelDeliveryContinuity();
    clearWebhookIdentityCache();
  });
  afterEach(() => {
    clearWebhookCache();
    mock.restore();
  });

  it("reuses verified restored assignments across threads and sprite switches without PATCH or writes", async () => {
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    const sprite = await pool.store("_sprite", "avatar_pool_1", avatarB);
    pool.write.mockClear();
    for (const [username, avatar, threadId] of [
      ["Mirri", avatarA, "_thread_a"],
      ["Juno", avatarB, "_thread_b"],
      ["Mirri", avatarB, "_thread_a"],
      ["Juno", avatarA, "_thread_b"],
    ]) {
      const sent = await sendWebhookMessageWithIdentity(
        primary as unknown as Webhook,
        { content: "hi", threadId, allowedMentions: { parse: [] } },
        { username, avatarDataUri: avatar },
      );
      expect(sent.webhookId).toBe(avatar === avatarA ? primary.id : sprite.id);
      expect(pool.delivered.at(-1)).toMatchObject({ username, avatar, threadId });
    }
    expect(primary.edit).not.toHaveBeenCalled();
    expect(sprite.edit).not.toHaveBeenCalled();
    expect(pool.write).not.toHaveBeenCalled();
    expect(pool.channel.createWebhook).not.toHaveBeenCalled();
  });

  it("PATCHes the least recently used slot on a miss and retains it on exact reuse", async () => {
    const pool = makePool();
    const primary = await pool.primary();
    await sendWebhookMessageWithIdentity(
      primary as unknown as Webhook,
      { content: "hi" },
      { username: "Mirri", avatarDataUri: avatarA },
    );
    await sendWebhookMessageWithIdentity(
      primary as unknown as Webhook,
      { content: "hi" },
      { username: "Juno", avatarDataUri: avatarA },
    );
    expect(primary.edit).toHaveBeenCalledTimes(1);
    expect(pool.rows[0]).toMatchObject({
      avatar_fingerprint: fingerprint(avatarA),
      discord_avatar_hash: primary.avatar,
    });
    expect(pool.delivered.every((sent) => sent.avatar === avatarA)).toBe(true);
  });

  it("creates with the avatar after a deferral, persists before publishing, and reuses the selected ID", async () => {
    const metric = spyOn(log, "metric");
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    primary.edit.mockImplementation(async () => {
      throw deferredPatch();
    });
    const write = pool.write.getMockImplementation();
    if (!write) throw new Error("Missing persistence mock");
    pool.write.mockImplementation(async (input) => {
      if (input.kind === "avatar_pool_1") {
        expect(getCachedManagedWebhookForChannel(pool.channel.id, input.webhookDiscId)).toBeNull();
        expect(pool.delivered).toHaveLength(0);
      }
      return await write(input);
    });
    const result = await dispatchWebhookWithIdentity(
      primary as unknown as Webhook,
      { username: "Juno", avatarDataUri: avatarB },
      async (selected) => selected.webhook.send({ content: "hi", username: selected.identity.username }),
    );
    expect(result.webhookId).toBe("_created_1");
    expect(result.result.webhookId).toBe(result.webhookId);
    expect(result.identity).toMatchObject({ username: "Juno", avatarDataUri: avatarB });
    expect(pool.channel.createWebhook.mock.calls[0][0].avatar).toBe(avatarB);
    expect(pool.delivered[0].avatar).toBe(avatarB);
    expect(metric.mock.calls).toContainEqual([
      "webhook_avatar_patch_rate_limited",
      { channel_id: pool.channel.id, webhook_id: primary.id, time_to_reset_ms: 60_000, outcome: "pool_created" },
    ]);
    await sendWebhookMessageWithIdentity(
      primary as unknown as Webhook,
      { content: "again" },
      { username: "Juno", avatarDataUri: avatarB },
    );
    expect(pool.channel.createWebhook).toHaveBeenCalledTimes(1);
    expect(pool.delivered.at(-1)?.webhookId).toBe(result.webhookId);
    expect(getCachedManagedWebhookForChannel(pool.channel.id, primary.id)).toBe(primary as unknown as Webhook);
  });

  it("uses the generic avatar when the pool is saturated and PATCHes its oldest slot when allowed", async () => {
    const pool = makePool();
    const primary = await pool.primary();
    const extras = [];
    for (const kind of ["avatar_pool_1", "avatar_pool_2", "avatar_pool_3"] as const)
      extras.push(await pool.store(`_${kind}`, kind));
    primary.edit.mockImplementation(async () => {
      throw deferredPatch();
    });
    await sendWebhookMessageWithIdentity(
      primary as unknown as Webhook,
      { content: "hi" },
      { username: "Mirri", avatarDataUri: avatarA },
    );
    expect(pool.delivered.at(-1)).toMatchObject({ username: "Mirri", avatar: GENERIC_WEBHOOK_AVATAR_URL });
    expect(pool.channel.createWebhook).not.toHaveBeenCalled();
    await sendWebhookMessageWithIdentity(
      primary as unknown as Webhook,
      { content: "hi" },
      { username: "Juno", avatarDataUri: avatarB },
    );
    expect(extras[0].edit).toHaveBeenCalledTimes(1);
    expect(pool.delivered.at(-1)).toMatchObject({ webhookId: extras[0].id, avatar: avatarB });
    expect(pool.rows).toHaveLength(4);
  });

  it("reserves two Discord slots and falls back when the count cannot be fetched", async () => {
    for (const count of [12, 13, 15, "unavailable"] as const) {
      clearWebhookCache();
      const pool = makePool();
      const primary = await pool.primary(avatarA);
      primary.edit.mockImplementation(async () => {
        throw deferredPatch();
      });
      if (count === "unavailable") pool.channel.fetchWebhooks.mockRejectedValue(new Error());
      else for (let i = 1; i < count; i++) pool.addWebhook(`_foreign_${i}`);
      await sendWebhookMessageWithIdentity(
        primary as unknown as Webhook,
        { content: "hi" },
        { username: "Juno", avatarDataUri: avatarB },
      );
      expect(pool.delivered.at(-1)?.avatar).toBe(count === 12 ? avatarB : GENERIC_WEBHOOK_AVATAR_URL);
      expect(pool.channel.createWebhook).toHaveBeenCalledTimes(count === 12 ? 1 : 0);
      mock.restore();
    }
  });

  it("uses a generic per-message override for rejected PATCHes and failed or tokenless creations", async () => {
    for (const failure of ["patch", 30007, 30058, 50013, "transport", "tokenless", "persistence", "cleanup"] as const) {
      clearWebhookCache();
      const pool = makePool();
      const primary = await pool.primary(avatarA);
      primary.edit.mockImplementation(async () => {
        throw failure === "patch" ? Object.assign(new Error(), { code: 50013 }) : deferredPatch();
      });
      if (typeof failure === "number" || failure === "transport")
        pool.channel.createWebhook.mockRejectedValue(Object.assign(new Error(), { code: failure }));
      if (["tokenless", "persistence", "cleanup"].includes(String(failure))) {
        pool.channel.createWebhook.mockImplementation(async () => {
          const created = pool.addWebhook("_unused", avatarB);
          if (failure === "tokenless") created.token = null;
          else pool.write.mockResolvedValue(false);
          if (failure === "cleanup") created.delete.mockRejectedValue(new Error());
          return created;
        });
      }
      const delivery = await dispatchWebhookWithIdentity(
        primary as unknown as Webhook,
        { username: "Juno", avatarDataUri: avatarB },
        async (selected) =>
          selected.webhook.send({
            content: "hi",
            username: selected.identity.username,
            avatarURL: selected.identity.avatarUrl,
          }),
      );
      expect(delivery.webhookId).toBe(primary.id);
      expect(delivery.identity.avatarDataUri).toBeUndefined();
      expect(delivery.identity.avatarUrl).toBe(GENERIC_WEBHOOK_AVATAR_URL);
      expect(pool.delivered).toHaveLength(1);
      expect(pool.delivered[0]).toMatchObject({ username: "Juno", avatar: GENERIC_WEBHOOK_AVATAR_URL });
      expect(pool.rows).toHaveLength(1);
      expect(getCachedManagedWebhookForChannel(pool.channel.id, "_unused")).toBeNull();
      if (["tokenless", "persistence", "cleanup"].includes(String(failure))) {
        expect(pool.webhooks.has("_unused")).toBe(failure === "cleanup");
      }
      mock.restore();
    }
  });

  it("does not resend after an uncertain POST outcome and retains the new slot for historic operations", async () => {
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    primary.edit.mockImplementation(async () => {
      throw deferredPatch();
    });
    const operation = mock(async () => {
      throw Object.assign(new Error(), { code: "ECONNRESET" });
    });
    await expect(
      dispatchWebhookWithIdentity(primary as unknown as Webhook, { avatarDataUri: avatarB }, operation),
    ).rejects.toThrow();
    expect(operation).toHaveBeenCalledTimes(1);
    expect(pool.rows.find((row) => row.webhook_disc_id === "_created_1")).toBeDefined();
    expect(pool.webhooks.has("_created_1")).toBe(true);
  });

  it("keeps first-webhook failure distinct from an extra-slot failure", async () => {
    for (const code of [50013, 30058]) {
      clearWebhookCache();
      const pool = makePool();
      pool.channel.createWebhook.mockRejectedValue(Object.assign(new Error(), { code }));
      const resolved = await getOrCreateWebhook(pool.channel as unknown as BaseGuildTextChannel);
      expect(resolved.webhook).toBeNull();
      expect(resolved.errorReason).toBe(code === 50013 ? "missing_permissions" : "max_webhooks");
      expect(pool.delivered).toHaveLength(0);
      mock.restore();
    }
  });

  it("forgets an avatar assignment after an uncertain PATCH so a later exact request cannot inherit it", async () => {
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    const edit = primary.edit.getMockImplementation();
    if (!edit) throw new Error("Missing avatar edit mock");
    primary.edit.mockImplementationOnce(async (options) => {
      await edit(options);
      throw Object.assign(new Error(), { code: "ECONNRESET" });
    });
    await sendWebhookMessageWithIdentity(
      primary as unknown as Webhook,
      {},
      { username: "Juno", avatarDataUri: avatarB },
    );
    await sendWebhookMessageWithIdentity(
      primary as unknown as Webhook,
      {},
      { username: "Mirri", avatarDataUri: avatarA },
    );
    expect(pool.delivered.map((sent) => sent.avatar)).toEqual([GENERIC_WEBHOOK_AVATAR_URL, avatarA]);
    expect(primary.edit).toHaveBeenCalledTimes(2);
  });

  it("invalidates only a failed selected slot and preserves the usable primary", async () => {
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    const extra = await pool.store("_extra", "avatar_pool_1", avatarB);
    extra.send.mockRejectedValue(Object.assign(new Error(), { code: 10015 }));
    await expect(
      sendWebhookMessageWithIdentity(primary as unknown as Webhook, {}, { username: "Juno", avatarDataUri: avatarB }),
    ).rejects.toThrow();
    expect(getCachedManagedWebhookForChannel(pool.channel.id, extra.id)).toBeNull();
    expect(getCachedManagedWebhookForChannel(pool.channel.id, primary.id)).toBe(primary as unknown as Webhook);
    expect(primary.send).not.toHaveBeenCalled();
  });

  it.each([10015, 50027])("prunes a slot rejected by PATCH with %d before later selection", async (code) => {
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    const extra = await pool.store("_deleted", "avatar_pool_1");
    await sendWebhookMessageWithIdentity(
      primary as unknown as Webhook,
      {},
      { username: "Mirri", avatarDataUri: avatarA },
    );
    pool.webhooks.delete(extra.id);
    extra.edit.mockRejectedValue(Object.assign(new Error(), { code }));
    pool.channel.client.fetchWebhook.mockClear();

    await sendWebhookMessageWithIdentity(
      primary as unknown as Webhook,
      {},
      { username: "Juno", avatarDataUri: avatarB },
    );
    expect(pool.rows.some((row) => row.webhook_disc_id === extra.id)).toBe(false);
    expect(pool.rows.some((row) => row.webhook_disc_id === primary.id)).toBe(true);
    expect(getCachedManagedWebhookForChannel(pool.channel.id, extra.id)).toBeNull();
    expect(pool.delivered.at(-1)).toMatchObject({
      webhookId: primary.id,
      username: "Juno",
      avatar: GENERIC_WEBHOOK_AVATAR_URL,
    });

    await sendWebhookMessageWithIdentity(
      primary as unknown as Webhook,
      {},
      { username: "Mirri", avatarDataUri: avatarA },
    );
    expect(pool.channel.client.fetchWebhook).not.toHaveBeenCalled();
    expect(pool.delivered.at(-1)?.avatar).toBe(avatarA);
    expect(pool.channel.createWebhook).not.toHaveBeenCalled();
  });

  it("serializes two threads through the complete send even with different caller lock keys", async () => {
    const pool = makePool();
    const primary = await pool.primary();
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = dispatchWebhookWithIdentity(
      primary as unknown as Webhook,
      { username: "Mirri", avatarDataUri: avatarA },
      async (selected) => {
        entered();
        await blocked;
        return await selected.webhook.send({ username: "Mirri", threadId: "_thread_a" });
      },
    );
    await started;
    const second = sendWebhookMessageWithIdentity(
      primary as unknown as Webhook,
      { threadId: "_thread_b" },
      { username: "Juno", avatarDataUri: avatarB },
    );
    await Promise.resolve();
    expect(primary.edit).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(pool.delivered).toMatchObject([
      { username: "Mirri", avatar: avatarA, threadId: "_thread_a" },
      { username: "Juno", avatar: avatarB, threadId: "_thread_b" },
    ]);
  });

  it("serializes concurrent creation and keeps a batch stable while another thread waits", async () => {
    const pool = makePool();
    const resolved = await Promise.all([
      getOrCreateWebhook(pool.channel as unknown as BaseGuildTextChannel),
      getOrCreateWebhook(pool.channel as unknown as BaseGuildTextChannel),
    ]);
    expect(resolved[0].webhook?.id).toBe(resolved[1].webhook?.id);
    expect(pool.channel.createWebhook).toHaveBeenCalledTimes(1);
    const primary = pool.webhooks.get(resolved[0].webhook?.id ?? "");
    if (!primary) throw new Error("Missing primary webhook");
    await Promise.all([
      sendWebhookMessagesWithIdentity(
        primary,
        [
          { content: "notice", threadId: "_thread_a" },
          { content: "body", threadId: "_thread_a" },
        ],
        { username: "Mirri", avatarDataUri: avatarA },
      ),
      sendWebhookMessageWithIdentity(
        primary,
        { content: "other", threadId: "_thread_b" },
        { username: "Juno", avatarDataUri: avatarB },
      ),
    ]);
    expect(pool.delivered).toMatchObject([
      { content: "notice", avatar: avatarA },
      { content: "body", avatar: avatarA },
      { content: "other", avatar: avatarB },
    ]);
  });

  it("holds a slot for a batch and uses explicit overrides for HTTPS and neutral identities", async () => {
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    await sendWebhookMessagesWithIdentity(
      primary as unknown as Webhook,
      [
        { content: "notice", threadId: "_thread" },
        { content: "body", threadId: "_thread", allowedMentions: { parse: [] } },
      ],
      { username: "Juno", avatarUrl: "https://example.invalid/avatar.png" },
    );
    await sendWebhookMessageWithIdentity(primary as unknown as Webhook, { content: "neutral" });
    expect(pool.delivered.map((sent) => sent.avatar)).toEqual([
      "https://example.invalid/avatar.png",
      "https://example.invalid/avatar.png",
      GENERIC_WEBHOOK_AVATAR_URL,
    ]);
    expect(primary.edit).not.toHaveBeenCalled();
    expect(primary.send.mock.calls[1][0].allowedMentions).toEqual({ parse: [] });
  });

  it("reconciles an external avatar change and retries failed slot-list reads without a cooldown", async () => {
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    const extra = await pool.store("_extra", "avatar_pool_1", avatarB);
    extra.avatar = "external_hash";
    expect(await resolveManagedWebhookForChannel(pool.channel as unknown as BaseGuildTextChannel, extra.id)).toBe(
      extra as unknown as Webhook,
    );
    await runWithWebhookIdentity(extra as unknown as Webhook, { avatarDataUri: avatarB }, async () => undefined);
    expect(extra.edit).toHaveBeenCalledTimes(1);
    pool.list.mockRejectedValueOnce(new Error());
    await sendWebhookMessageWithIdentity(
      primary as unknown as Webhook,
      {},
      { username: "Juno", avatarDataUri: avatarB },
    );
    expect(pool.delivered.at(-1)?.avatar).toBe(GENERIC_WEBHOOK_AVATAR_URL);
    await sendWebhookMessageWithIdentity(
      primary as unknown as Webhook,
      {},
      { username: "Juno", avatarDataUri: avatarB },
    );
    expect(pool.delivered.at(-1)?.avatar).toBe(avatarB);
  });

  it("reports bounded pool outcomes without credentials or avatar data", async () => {
    const metric = spyOn(log, "metric");
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    await sendWebhookMessageWithIdentity(
      primary as unknown as Webhook,
      {},
      { username: "Mirri", avatarDataUri: avatarA },
    );
    primary.edit.mockImplementation(async () => {
      throw deferredPatch();
    });
    pool.channel.createWebhook.mockRejectedValue(Object.assign(new Error(), { code: 30058 }));
    await sendWebhookMessageWithIdentity(
      primary as unknown as Webhook,
      {},
      { username: "Juno", avatarDataUri: avatarB },
    );
    const entries = metric.mock.calls.filter(([name]) => name === "webhook_avatar_patch_rate_limited");
    expect(entries.map(([, fields]) => fields.outcome)).toEqual(expect.arrayContaining(["generic_fallback"]));
    expect(entries.some(([, fields]) => fields.reason === "create_failed")).toBe(true);
    expect(entries.some(([, fields]) => fields.time_to_reset_ms === 60_000)).toBe(true);
    const encoded = JSON.stringify(entries);
    expect(encoded).not.toContain("synthetic_token");
    expect(encoded).not.toContain("data:image");
  });

  it("records a managed stream's generic avatar and keeps following persona posts and notices on that appearance", async () => {
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    primary.edit.mockImplementation(async () => {
      throw deferredPatch();
    });
    pool.channel.createWebhook.mockRejectedValue(Object.assign(new Error(), { code: 50013 }));
    const stream = makeStream(pool, primary as unknown as Webhook);
    const recordSprite = spyOn(personaSpriteMessageRepository, "record").mockResolvedValue(true);
    await stream.updater.sendSinglePayload(
      {
        content: "sprite",
        identityOverride: { username: "Juno", avatarDataUri: avatarB },
        spriteRecord: { personaId: 2, spriteName: "joy", isIdentity: false },
      },
      "sprite",
      stream.context,
      stream.state,
    );
    expect(getChannelLastDelivery(stream.channel.id)).toMatchObject({
      via: "webhook",
      webhookId: primary.id,
      identity: { avatarUrl: GENERIC_WEBHOOK_AVATAR_URL },
    });
    const last = getChannelLastDelivery(stream.channel.id);
    expect(last?.via === "webhook" ? last.identity.avatarDataUri : "unexpected").toBeUndefined();
    expect(stream.state.spritesShown).toContainEqual({ name: "joy", isIdentity: false });
    expect(recordSprite.mock.calls[0][0]).toMatchObject({ spriteName: "joy" });
    await sendPersonaPostViaWebhook(
      primary as unknown as Webhook,
      { content: "artifact", threadId: stream.channel.id },
      { username: "Juno", avatarUrl: avatarB, personaId: 2 },
      stream.channel,
    );
    await sendFallbackModelUsageNotice({
      context: {
        channel: stream.channel,
        webhook: primary,
        tomoriState: stream.context.tomoriState,
        locale: "en-US",
      } as unknown as ToolContext,
      failures: [],
      successModel: createLlmRow(),
    });
    expect(pool.delivered.map((delivery) => delivery.avatar)).toEqual([
      GENERIC_WEBHOOK_AVATAR_URL,
      GENERIC_WEBHOOK_AVATAR_URL,
      GENERIC_WEBHOOK_AVATAR_URL,
    ]);
    expect(primary.edit).toHaveBeenCalledTimes(1);
  });

  it("returns or records the generic delivered identity for independent persona posts, fallback notices, and tool replies", async () => {
    for (const caller of ["persona", "notice", "reply"] as const) {
      clearWebhookCache();
      clearAllChannelDeliveryContinuity();
      const pool = makePool();
      const primary = await pool.primary(avatarA);
      primary.edit.mockImplementation(async () => {
        throw deferredPatch();
      });
      pool.channel.createWebhook.mockRejectedValue(Object.assign(new Error(), { code: 50013 }));
      const stream = makeStream(pool, primary as unknown as Webhook, true);
      if (caller === "persona") {
        await sendPersonaPostViaWebhook(
          primary as unknown as Webhook,
          { content: "artifact", threadId: stream.channel.id },
          { username: "Juno", avatarUrl: avatarB, personaId: 2 },
          stream.channel,
        );
      } else if (caller === "notice") {
        recordChannelDeliveredWebhookIdentity(
          stream.channel.id,
          { username: "Juno", avatarDataUri: avatarB },
          "_previous",
          { personaId: 2, kind: "appearance" },
          primary.id,
        );
        await sendFallbackModelUsageNotice({
          context: {
            channel: stream.channel,
            webhook: primary,
            tomoriState: stream.context.tomoriState,
            locale: "en-US",
          } as unknown as ToolContext,
          failures: [],
          successModel: createLlmRow(),
        });
      } else {
        if (!stream.context.replyToMessage) throw new Error("Missing reply fixture");
        const delivery = await sendWebhookReplyWithContext(
          primary as unknown as Webhook,
          stream.context.replyToMessage,
          "en-US",
          "body",
          { username: "Juno", avatarDataUri: avatarB },
          { threadId: stream.channel.id },
        );
        expect(delivery.identity.avatarDataUri).toBeUndefined();
        expect(delivery.identity.avatarUrl).toBe(GENERIC_WEBHOOK_AVATAR_URL);
      }
      if (caller !== "reply") {
        const last = getChannelLastDelivery(stream.channel.id);
        expect(last).toMatchObject({
          via: "webhook",
          webhookId: primary.id,
          identity: { avatarUrl: GENERIC_WEBHOOK_AVATAR_URL },
        });
        expect(last?.via === "webhook" ? last.identity.avatarDataUri : "unexpected").toBeUndefined();
      }
      expect(pool.delivered.every((delivery) => delivery.avatar === GENERIC_WEBHOOK_AVATAR_URL)).toBe(true);
      expect(pool.delivered.length).toBeGreaterThan(0);
      mock.restore();
    }
  });

  it("records the selected stream webhook and deletes its messages after reassignment and cache restoration without Manage Messages", async () => {
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    const extra = await pool.store("_extra", "avatar_pool_1", avatarB);
    const stream = makeStream(pool, primary as unknown as Webhook);
    const sent = await stream.updater.sendSinglePayload(
      { content: "partial" },
      "partial",
      stream.context,
      stream.state,
    );
    if (!sent) throw new Error("Missing delivered stream message");
    expect(sent.webhookId).toBe(extra.id);
    expect(stream.context.deliveredMessageRefs).toEqual([
      { messageId: sent.id, channelId: stream.channel.id, webhookId: extra.id },
    ]);
    expect(getChannelLastDelivery(stream.channel.id)).toMatchObject({ webhookId: extra.id });
    await runWithWebhookIdentity(extra as unknown as Webhook, { avatarDataUri: avatarA }, async () => undefined);
    clearWebhookCache();
    await deleteSupersededStreamMessages(stream.context.deliveredMessageRefs ?? [], {
      channel: stream.channel as unknown as Message["channel"],
      webhook: primary as unknown as Webhook,
    });
    expect(extra.deleteMessage).toHaveBeenCalledWith(sent?.id, stream.channel.id);
    expect(primary.deleteMessage).not.toHaveBeenCalled();
    expect(pool.channel.messages.delete).not.toHaveBeenCalled();
    expect(pool.rows.some((row) => row.webhook_disc_id === extra.id)).toBe(true);
  });

  it("records the webhook and delivered identity selected during recovery from a deleted pool slot", async () => {
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    const extra = await pool.store("_extra", "avatar_pool_1", avatarB);
    primary.edit.mockImplementation(async () => {
      throw deferredPatch();
    });
    extra.send.mockImplementationOnce(async () => {
      pool.webhooks.delete(extra.id);
      throw Object.assign(new Error(), { code: 10015 });
    });
    const stream = makeStream(pool, primary as unknown as Webhook);
    const sent = await stream.updater.sendSinglePayload(
      { content: "recovered" },
      "recovered",
      stream.context,
      stream.state,
    );
    if (!sent) throw new Error("Missing recovered stream message");
    expect(sent.webhookId).toBe("_created_1");
    expect(getChannelLastDelivery(stream.channel.id)).toMatchObject({
      via: "webhook",
      webhookId: sent.webhookId,
      identity: { username: "Juno", avatarDataUri: avatarB },
    });
    expect(stream.context.deliveredMessageRefs).toEqual([
      { messageId: sent.id, channelId: stream.channel.id, webhookId: sent.webhookId },
    ]);
    expect(pool.delivered.map((delivery) => delivery.avatar)).toEqual([avatarB]);
    expect(pool.channel.send).not.toHaveBeenCalled();
  });

  it("reserves one managed slot through a stream reply notice and its body across concurrent threads", async () => {
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    const extra = await pool.store("_extra", "avatar_pool_1", avatarB);
    const stream = makeStream(pool, primary as unknown as Webhook, true);
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const send = extra.send.getMockImplementation();
    if (!send) throw new Error("Missing send mock");
    extra.send.mockImplementationOnce(async (payload) => {
      const sent = await send(payload);
      entered();
      await pending;
      return sent;
    });
    const first = stream.updater.sendSinglePayload({ content: "body" }, "body", stream.context, stream.state);
    await started;
    const second = sendWebhookMessageWithIdentity(
      primary as unknown as Webhook,
      { content: "other", threadId: "_other_thread" },
      { username: "Mirri", avatarDataUri: avatarA },
    );
    await Promise.resolve();
    expect(pool.delivered).toHaveLength(1);
    release();
    await Promise.all([first, second]);
    expect(pool.delivered.map((delivery) => delivery.webhookId)).toEqual([extra.id, extra.id, primary.id]);
    expect(pool.delivered.map((delivery) => delivery.threadId)).toEqual([
      stream.channel.id,
      stream.channel.id,
      "_other_thread",
    ]);
    expect(stream.context.replyNoticeState?.sent).toBe(true);
  });

  it("cleans up pool-authored reply notices after both tool replies and stream bodies fail", async () => {
    for (const route of ["tool", "stream"] as const) {
      clearWebhookCache();
      clearAllChannelDeliveryContinuity();
      const pool = makePool();
      const primary = await pool.primary(avatarA);
      const extra = await pool.store("_extra", "avatar_pool_1", avatarB);
      const stream = makeStream(pool, primary as unknown as Webhook, true);
      const send = extra.send.getMockImplementation();
      if (!send || !stream.context.replyToMessage) throw new Error("Missing reply fixture");
      extra.send.mockImplementationOnce(send).mockRejectedValueOnce(Object.assign(new Error(), { code: 50013 }));
      if (route === "tool") {
        await expect(
          sendWebhookReplyWithContext(
            primary as unknown as Webhook,
            stream.context.replyToMessage,
            "en-US",
            "body",
            { username: "Juno", avatarDataUri: avatarB },
            { threadId: stream.channel.id },
          ),
        ).rejects.toThrow();
      } else {
        await stream.updater.sendSinglePayload({ content: "body" }, "body", stream.context, stream.state);
        expect(pool.channel.send).toHaveBeenCalledTimes(1);
        expect(getChannelLastDelivery(stream.channel.id)).toMatchObject({ via: "bot" });
        expect(stream.context.deliveredMessageRefs?.[0].webhookId).toBeNull();
      }
      expect(extra.deleteMessage).toHaveBeenCalledWith("_message_1", stream.channel.id);
      expect(primary.deleteMessage).not.toHaveBeenCalled();
      expect(pool.messages.has("_message_1")).toBe(false);
      mock.restore();
    }
  });

  it("disables embed, expand, table, and fallback buttons through the authoring pool webhook after cache restoration", async () => {
    for (const artifact of ["embed", "expand", "table", "fallback"] as const) {
      clearWebhookCache();
      clearAllChannelDeliveryContinuity();
      const pool = makePool();
      const primary = await pool.primary(avatarA);
      const extra = await pool.store("_extra", "avatar_pool_1", avatarB);
      const channel = pool.thread("_buttons_thread");
      if (artifact === "embed") {
        await sendStandardEmbed(
          channel as unknown as BaseGuildTextChannel,
          "en-US",
          {
            titleKey: "genai.fallback_used_title",
            restrictedDetail: {
              content: "diagnostic",
              access: { canOpen: () => true, deniedKey: "genai.fallback_used_title" },
            },
          },
          { webhook: primary as unknown as Webhook, personaUsername: "Juno", personaAvatarUrl: avatarB, personaId: 2 },
        );
      } else if (artifact === "expand") {
        await sendTaskEmbedWithExpand(
          {
            channel,
            webhook: primary,
            personaUsername: "Juno",
            personaAvatarUrl: avatarB,
            personaId: 2,
            tomoriState: createPersona({ is_alter: true, config: { tool_notice_verbosity: "verbose" } }),
            locale: "en-US",
          } as unknown as ToolContext,
          { titleKey: "genai.fallback_used_title" },
          "purpose ".repeat(40),
        );
      } else if (artifact === "table") {
        const message = await sendWebhookMessageWithIdentity(
          primary as unknown as Webhook,
          { threadId: channel.id },
          { username: "Juno", avatarDataUri: avatarB },
        );
        attachShowMarkdownCollector(message, "en-US", primary as unknown as Webhook, channel.id);
      } else {
        recordChannelDeliveredWebhookIdentity(
          channel.id,
          { username: "Juno", avatarDataUri: avatarB },
          "_previous",
          { personaId: 2, kind: "appearance" },
          primary.id,
        );
        await sendFallbackModelUsageNotice({
          context: {
            channel,
            webhook: primary,
            tomoriState: createPersona({ is_alter: true }),
            locale: "en-US",
          } as unknown as ToolContext,
          failures: [],
          successModel: createLlmRow(),
        });
      }
      expect(pool.collectors).toHaveLength(1);
      Object.defineProperty(pool.messages.get("_message_1"), "channel", { value: null });
      clearWebhookCache();
      await pool.collectors[0].expire();
      expect(extra.editMessage).toHaveBeenCalledWith(
        "_message_1",
        expect.objectContaining({ threadId: channel.id, components: expect.any(Array) }),
      );
      expect(primary.editMessage).not.toHaveBeenCalled();
      expect(pool.messages.get("_message_1")?.edit).not.toHaveBeenCalled();
      mock.restore();
    }
  });

  it.each([
    "reuse",
    "create",
    "generic",
  ] as const)("routes native voice through %s and records its delivered identity", async (route) => {
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    if (route === "reuse") await pool.store("_voice", "avatar_pool_1", avatarB);
    else {
      primary.edit.mockImplementation(async () => {
        throw deferredPatch();
      });
      if (route === "generic")
        pool.channel.createWebhook.mockRejectedValue(Object.assign(new Error(), { code: 30007 }));
    }
    const channel = pool.thread("_voice_thread");
    const target = {
      channel: channel as unknown as BaseGuildTextChannel,
      webhook: primary as unknown as Webhook,
      threadId: channel.id,
      personaUsername: "Juno",
      personaAvatarUrl: avatarB,
      personaId: 2,
    };
    const selectedId = route === "reuse" ? "_voice" : route === "create" ? "_created_1" : primary.id;
    const fetchVoice = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          const address = new URL(String(url));
          expect(address.pathname.split("/").at(-2)).toBe(selectedId);
          expect(address.searchParams.get("thread_id")).toBe(channel.id);
          expect(address.searchParams.get("wait")).toBe("true");
          const form = init?.body as FormData;
          const body = JSON.parse(String(form.get("payload_json")));
          expect(body).toMatchObject({
            username: "Juno",
            flags: 8192,
            allowed_mentions: { parse: [] },
            attachments: [{ id: 0, filename: "voice.ogg", waveform: "AA==", duration_secs: 1 }],
          });
          expect(body.avatar_url).toBe(route === "generic" ? GENERIC_WEBHOOK_AVATAR_URL : undefined);
          expect(form.get("files[0]")).toBeInstanceOf(Blob);
          return Response.json({ id: "_native_voice", webhook_id: selectedId });
        },
        { preconnect: () => undefined },
      ),
    );
    expect(
      await deliverVoiceMessage({
        target,
        audioBuffer: Buffer.from("synthetic audio"),
        mimeType: "audio/ogg",
        filename: "voice.ogg",
        voiceMeta: { waveform: "AA==", durationSecs: 1 },
      }),
    ).toBe("_native_voice");
    expect(fetchVoice).toHaveBeenCalledTimes(1);
    expect(pool.channel.client.rest.post).not.toHaveBeenCalled();
    expect(getChannelLastDelivery(channel.id)).toMatchObject({
      via: "webhook",
      webhookId: selectedId,
      identity: route === "generic" ? { avatarUrl: GENERIC_WEBHOOK_AVATAR_URL } : { avatarDataUri: avatarB },
    });
    channel.lastMessageId = "_native_voice";
    await postVoiceTranscriptCaption(target, "caption");
    expect(pool.delivered.at(-1)).toMatchObject({
      username: "Juno",
      threadId: channel.id,
      avatar: route === "generic" ? GENERIC_WEBHOOK_AVATAR_URL : avatarB,
    });
  });

  it("clears webhook continuity when native voice falls back to the bot", async () => {
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    const channel = pool.thread("_voice_thread");
    recordChannelDeliveredWebhookIdentity(
      channel.id,
      { username: "Mirri", avatarDataUri: avatarA },
      "_before",
      null,
      primary.id,
    );
    spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));
    expect(
      await deliverVoiceMessage({
        target: {
          channel: channel as unknown as BaseGuildTextChannel,
          webhook: primary as unknown as Webhook,
          personaUsername: "Mirri",
          personaAvatarUrl: avatarA,
        },
        audioBuffer: Buffer.from("synthetic audio"),
        mimeType: "audio/ogg",
        filename: "voice.ogg",
        voiceMeta: { waveform: "AA==", durationSecs: 1 },
      }),
    ).toBe("_bot_voice");
    expect(getChannelLastDelivery(channel.id)?.via).toBe("bot");
  });

  it.each([
    "reuse",
    "create",
    "generic",
    "unconfirmed",
  ] as const)("keeps expression %s routing on the single-attempt transport", async (route) => {
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    if (route === "reuse") await pool.store("_expression", "avatar_pool_1", avatarB);
    else {
      primary.edit.mockImplementation(async () => {
        throw deferredPatch();
      });
      if (route === "generic")
        pool.channel.createWebhook.mockRejectedValue(Object.assign(new Error(), { code: 50013 }));
    }
    const channel = pool.thread("_expression_thread");
    const persona = createPersona({ persona_id: 2, persona_nickname: "Juno", is_alter: true });
    const context = {
      channel,
      client: pool.channel.client,
      guild: { id: pool.channel.guildId },
      currentPersona: persona,
      tomoriState: persona,
      triggererUserId: null,
      streamingContext: { deliveredMessageRefs: [] },
      responseTarget: { webhook: primary, personaUsername: "Juno", personaAvatarUrl: avatarB },
      expressionDelivery: createExpressionDeliveryState(),
    } as unknown as ChatTurnContext;
    const selectedId = route === "reuse" ? "_expression" : route === "generic" ? primary.id : "_created_1";
    const posts = spyOn(getSingleAttemptWebhookRest(), "post").mockImplementation(async (path, options) => {
      expect(path.split("/").at(-2)).toBe(selectedId);
      expect(options?.body).toMatchObject({ username: "Juno", allowed_mentions: { parse: [] } });
      expect((options?.body as { avatar_url?: string }).avatar_url).toBe(
        route === "generic" ? GENERIC_WEBHOOK_AVATAR_URL : undefined,
      );
      expect(options?.query?.get("thread_id")).toBe(channel.id);
      if (route === "unconfirmed") throw new Error("socket reset");
      return { id: "_sent_expression", webhook_id: selectedId };
    });
    const selection = {
      kind: "native" as const,
      sticker: {
        id: "_sticker",
        name: "Wave",
        guildId: pool.channel.guildId,
        available: true,
        url: "https://example.invalid/sticker.png",
      } as Sticker,
    };
    const outcome = await deliverExpression(context, selection, "Wave", () => false);
    expect(outcome.status).toBe(route === "unconfirmed" ? "unconfirmed" : "delivered");
    expect((await deliverExpression(context, selection, "Wave", () => false)).status).toBe(
      route === "unconfirmed" ? "unconfirmed" : "already_delivered",
    );
    expect(posts).toHaveBeenCalledTimes(1);
    expect(pool.channel.send).not.toHaveBeenCalled();
    if (route === "unconfirmed") expect(getChannelLastDelivery(channel.id)).toBeNull();
    else
      expect(getChannelLastDelivery(channel.id)).toMatchObject({
        via: "webhook",
        webhookId: selectedId,
        identity: route === "generic" ? { avatarUrl: GENERIC_WEBHOOK_AVATAR_URL } : { avatarDataUri: avatarB },
      });
  });

  it("trusts every persisted pool kind after restart and reassignment only in its guild and parent", async () => {
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    for (const kind of ["avatar_pool_1", "avatar_pool_2", "avatar_pool_3"] as const) {
      const extra = await pool.store(`_${kind}`, kind, avatarB);
      const sent = await sendWebhookMessageWithIdentity(
        primary as unknown as Webhook,
        { threadId: "_historic_thread" },
        { username: "Juno", avatarDataUri: avatarB },
      );
      expect(sent.webhookId).toBe(extra.id);
      await extra.edit({ avatar: avatarA });
      clearWebhookCache();
      clearWebhookIdentityCache();
      pool.channel.client.fetchWebhook.mockClear();
      pool.channel.fetchWebhooks.mockClear();
      expect(await verifyMessageWebhook(sent)).toBe(true);
      expect(await verifyMessageWebhook({ ...sent, guildId: "_other_guild" } as Message)).toBe(false);
      expect(
        await verifyMessageWebhook({
          ...sent,
          channel: { isThread: () => true, parentId: "_other_parent" },
        } as Message),
      ).toBe(false);
      expect(await verifyMessageWebhook({ ...sent, webhookId: "_foreign" } as Message)).toBe(false);
      expect(pool.channel.client.fetchWebhook).not.toHaveBeenCalled();
      expect(pool.channel.fetchWebhooks).not.toHaveBeenCalled();
      expect(pool.channel.createWebhook).not.toHaveBeenCalled();
      expect((await getOrCreateWebhook(pool.channel as unknown as BaseGuildTextChannel)).webhook?.id).toBe(primary.id);
    }
  });

  it.each([
    "edit",
    "delete",
    "turn",
  ] as const)("routes historic %s operations to the authoring slot after restart and avatar reassignment", async (action) => {
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    const extra = await pool.store("_historic", "avatar_pool_1", avatarB);
    const channel = pool.thread("_historic_thread");
    const sent = await sendWebhookMessageWithIdentity(
      primary as unknown as Webhook,
      { content: "before", threadId: channel.id },
      { username: "Juno", avatarDataUri: avatarB },
    );
    pool.messages.delete(sent.id);
    sent.id = "123456789012345678";
    pool.messages.set(sent.id, sent);
    await extra.edit({ avatar: avatarA });
    clearWebhookCache();
    const main = createPersona();
    const alter = createPersona({ persona_id: 2, persona_nickname: "Juno", is_alter: true });
    spyOn(personaCache, "getCachedMainPersona").mockResolvedValue(main);
    spyOn(personaCache, "getCachedAllPersonas").mockResolvedValue([main, alter]);
    if (action === "turn") {
      const { interaction, calls } = makeFakeInteraction({
        guild: { id: pool.channel.guildId, members: { me: null } },
        guildId: pool.channel.guildId,
        channel,
        channelId: channel.id,
        memberPermissions: { has: () => true },
      });
      await deleteTurn(
        pool.channel.client as unknown as Client,
        interaction as unknown as ChatInputCommandInteraction,
        createUserRow(),
        "en-US",
      );
      expect(calls[0].method).toBe("deferReply");
    } else {
      const result = await new ManageMessageTool().execute(
        { action, message_id: sent.id, ...(action === "edit" ? { content: "after" } : {}) },
        {
          channel,
          client: pool.channel.client,
          guildId: pool.channel.guildId,
          tomoriState: alter,
          locale: "en-US",
        } as unknown as ToolContext,
      );
      expect(result.success).toBe(true);
    }
    if (action === "edit")
      expect(extra.editMessage).toHaveBeenCalledWith(
        sent.id,
        expect.objectContaining({ content: "after", threadId: channel.id }),
      );
    else expect(extra.deleteMessage).toHaveBeenCalledWith(sent.id, channel.id);
    expect(primary.editMessage).not.toHaveBeenCalled();
    expect(primary.deleteMessage).not.toHaveBeenCalled();
    expect(pool.channel.messages.delete).not.toHaveBeenCalled();
    expect(pool.channel.createWebhook).not.toHaveBeenCalled();
    expect((await getOrCreateWebhook(pool.channel as unknown as BaseGuildTextChannel)).webhook?.id).toBe(primary.id);
  });

  it("gives Matrix text, media, and attachment notices a neutral avatar over a stored persona face", async () => {
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    Object.assign(pool.channel, { isTextBased: () => true, isDMBased: () => false });
    spyOn(matrixRooms, "getDiscordChannelForRoom").mockResolvedValue(pool.channel.id);
    spyOn(matrixRooms, "ensureRoomRelayable").mockResolvedValue(true);
    spyOn(matrixState, "getMatrixSettings").mockReturnValue({
      port: 9993,
      bindHost: "127.0.0.1",
      maxAttachmentBytes: 1024,
      mediaTimeoutMs: 1000,
    });
    const media = spyOn(matrixMedia, "downloadMatrixMedia").mockResolvedValue({
      buffer: Buffer.from("synthetic image"),
      mimeType: "image/png",
    });
    for (const content of [
      { msgtype: "m.text", body: "relay" },
      { msgtype: "m.image", body: "image.png", url: "mxc://example.invalid/image" },
      { msgtype: "m.file", body: "large.bin", info: { size: 2048 } },
      { msgtype: "m.image", body: "missing.png", url: "mxc://example.invalid/missing" },
    ]) {
      if (content.body === "missing.png") media.mockResolvedValue(null);
      await handleMatrixEvent(
        {
          getData: () => ({
            type: "m.room.message",
            room_id: "!relay:example.invalid",
            sender: "@bau:example.invalid",
            content,
          }),
        } as unknown as BridgeRequest<WeakEvent>,
        { channels: { fetch: async () => pool.channel } } as unknown as Client,
        "@tomoribot:example.invalid",
      );
      expect(pool.delivered.at(-1)).toMatchObject({
        webhookId: primary.id,
        avatar: GENERIC_WEBHOOK_AVATAR_URL,
        username: expect.stringContaining("@bau:example.invalid"),
      });
      expect(primary.send.mock.calls.at(-1)?.[0].allowedMentions).toEqual({ parse: [] });
    }
    expect(primary.send).toHaveBeenCalledTimes(4);
    expect(primary.edit).not.toHaveBeenCalled();
    expect(pool.channel.createWebhook).not.toHaveBeenCalled();
  });

  it("lets HTTPS sends and lifecycle lookups proceed while a local-avatar operation holds the parent lock", async () => {
    const pool = makePool();
    const primary = await pool.primary(avatarA);
    const extra = await pool.store("_extra", "avatar_pool_1", avatarB);
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const local = runWithWebhookIdentity(primary as unknown as Webhook, { avatarDataUri: avatarA }, async () => {
      entered();
      await pending;
    });
    await started;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const operations = Promise.all([
      sendWebhookMessageWithIdentity(
        primary as unknown as Webhook,
        { content: "public" },
        { username: "Juno", avatarUrl: "https://example.invalid/avatar.png" },
      ),
      runWithWebhookIdentity(
        primary as unknown as Webhook,
        { avatarUrl: "https://example.invalid/avatar.png" },
        async () => "public raw REST",
      ),
      getOrCreateWebhook(pool.channel as unknown as BaseGuildTextChannel),
      resolveManagedWebhookForChannel(pool.channel as unknown as BaseGuildTextChannel, extra.id),
    ]);
    try {
      const finished = await Promise.race([
        operations.then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), 1500);
        }),
      ]);
      expect(finished).toBe(true);
      expect(pool.delivered[0].avatar).toBe("https://example.invalid/avatar.png");
    } finally {
      if (timeout) clearTimeout(timeout);
      release();
      await Promise.all([local, operations]);
    }
  });
});
