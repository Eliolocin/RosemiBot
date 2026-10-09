import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { DiscordAPIError, RateLimitError, type Sticker, Webhook } from "discord.js";
import type { RecordStatInput } from "@/utils/db/repositories/StatRepository";
import type { ChatIncoming, ChatTurnContext } from "@/utils/chat/types";
import type { StickerSelection } from "@/types/discord/stickerSelection";
import { statRepository } from "@/utils/db/repositories";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import {
  buildExpressionToolResult,
  createExpressionDeliveryState,
  deliverExpression,
} from "@/utils/chat/expressionDelivery";
import {
  getChannelLastDelivery,
  recordChannelDeliveredWebhookIdentity,
} from "@/utils/discord/stream/channelDeliveryContinuity";
import { getSingleAttemptWebhookRest } from "@/utils/discord/webhook/webhookCore";
import { deleteExpressionMedia, storeExpressionMedia } from "@/utils/storage/expressionStorage";
import { createCustomExpression, createPersona } from "../../helpers/fixtures";

const recorded: RecordStatInput[] = [];
const recordStatSpy = spyOn(statRepository, "recordStat").mockImplementation((input: RecordStatInput) => {
  recorded.push(input);
});

const SERVER_ID = 7;
const GUILD_ID = "123456789012345678";
const originalStorageBackend = process.env.EXPRESSION_STORAGE_BACKEND;
const notCancelled = () => false;

type SendBehavior = "ok" | "rejected" | "unconfirmed";

function discordRejection(): DiscordAPIError {
  return new DiscordAPIError({ code: 50006, message: "Cannot send an empty message" }, 50006, 400, "POST", "/", {});
}

function makeSend(behavior: () => SendBehavior, webhookId: string | null = null) {
  let sequence = 0;
  return mock(async (_payload: unknown) => {
    const outcome = behavior();
    if (outcome === "rejected") throw discordRejection();
    if (outcome === "unconfirmed") throw new Error("socket hang up");
    sequence += 1;
    return { id: `9000000000000000${sequence}`, webhookId };
  });
}

function makeContext(options: { behavior?: () => SendBehavior; queued?: boolean } = {}): ChatTurnContext {
  const behavior = options.behavior ?? (() => "ok");
  const channel = {
    // Unique per context so channel continuity never carries state between cases.
    id: `channel_${Math.random().toString(36).slice(2)}`,
    send: makeSend(behavior),
    isThread: () => false,
  };
  const message = { id: "message_1", channel, reply: makeSend(behavior) };
  const incoming = { isFromQueue: options.queued === true } as unknown as ChatIncoming;
  const tomoriState = createPersona({ server_id: SERVER_ID, persona_lineage_id: 5 });
  return {
    client: { user: null },
    message,
    channel,
    guild: { id: GUILD_ID },
    turn: { lockedTurn: { admission: { incoming } } },
    currentPersona: { ...tomoriState, persona_id: 3 },
    tomoriState,
    triggererUserId: 42,
    isDMChannel: false,
    isFromQueue: options.queued === true,
    streamingContext: { disableYouTubeProcessing: false, deliveredMessageRefs: [] },
    expressionDelivery: createExpressionDeliveryState(),
  } as unknown as ChatTurnContext;
}

interface WebhookPost {
  url: string;
  body: Record<string, unknown>;
}

/**
 * Routes the single-attempt webhook client's network layer through `respond`. The REST client
 * reads `makeRequest` per request, so this exercises its real retry and error handling.
 */
function interceptWebhookPosts(respond: () => Response): { posts: WebhookPost[]; restore: () => void } {
  const options = getSingleAttemptWebhookRest().options as { makeRequest: unknown };
  const original = options.makeRequest;
  const posts: WebhookPost[] = [];
  options.makeRequest = async (url: string, init: { body?: unknown }) => {
    posts.push({ url, body: typeof init.body === "string" ? JSON.parse(init.body) : {} });
    return respond();
  };
  return { posts, restore: () => (options.makeRequest = original) };
}

/** Discord's 429, with a Retry-After short enough to keep the test fast. */
function rateLimited(retryAfter = 0.01): Response {
  return Response.json(
    { message: "You are being rate limited.", retry_after: retryAfter, global: false },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfter), "X-RateLimit-Scope": "user" },
    },
  );
}

function created(): Response {
  return Response.json({ id: "900000000000000099", webhook_id: "123456789012345679", channel_id: "1" });
}

/** A real `Webhook` instance, since discord.js only sends identity fields for one. */
function makeWebhook(edit: () => void = () => undefined): Webhook {
  return Object.assign(Object.create(Webhook.prototype), {
    id: "123456789012345679",
    token: "webhook-token",
    avatar: null,
    channelId: null,
    client: { options: {} },
    edit: async () => edit(),
  }) as Webhook;
}

function nativeSticker(id: string, name: string): StickerSelection {
  const sticker = { id, name, url: `https://cdn.example/${id}.png`, guildId: GUILD_ID, available: true };
  return { kind: "native", sticker: sticker as unknown as Sticker };
}

function customSelection(id: string): StickerSelection {
  return { kind: "custom", serverId: SERVER_ID, expressionId: id };
}

function sendCalls(context: ChatTurnContext): number {
  const channel = context.channel as unknown as { send: ReturnType<typeof mock> };
  const message = context.message as unknown as { reply: ReturnType<typeof mock> };
  return channel.send.mock.calls.length + message.reply.mock.calls.length;
}

function metricKeys(metric: string): string[] {
  return recorded.filter((entry) => entry.metric === metric).map((entry) => entry.metricKey ?? "");
}

describe("expression delivery at tool invocation", () => {
  beforeAll(() => {
    process.env.EXPRESSION_STORAGE_BACKEND = "local";
  });

  afterAll(() => {
    recordStatSpy.mockRestore();
    if (originalStorageBackend === undefined) delete process.env.EXPRESSION_STORAGE_BACKEND;
    else process.env.EXPRESSION_STORAGE_BACKEND = originalStorageBackend;
  });

  beforeEach(() => {
    recorded.length = 0;
  });

  it("sends and counts once, then answers repeats without sending or replacing", async () => {
    const context = makeContext();
    const wave = nativeSticker("111111111111111111", "Wave");

    const first = await deliverExpression(context, wave, "Wave", notCancelled);
    const repeat = await deliverExpression(context, wave, "Wave", notCancelled);
    const other = await deliverExpression(context, nativeSticker("222222222222222222", "Cry"), "Cry", notCancelled);

    expect([first.status, repeat.status, other.status]).toEqual(["delivered", "already_delivered", "limit_reached"]);
    expect(sendCalls(context)).toBe(1);
    expect(metricKeys("sticker_used")).toEqual(["Wave"]);
    expect(buildExpressionToolResult(repeat as never, "Wave").success).toBe(true);
    expect(buildExpressionToolResult(other as never, "Cry").success).toBe(false);
  });

  it("frees the allowance after a definite rejection but blocks resends after an unconfirmed one", async () => {
    const outcomes: SendBehavior[] = ["rejected", "ok"];
    const rejectedFirst = makeContext({ behavior: () => outcomes.shift() ?? "ok" });
    const wave = nativeSticker("111111111111111111", "Wave");
    expect((await deliverExpression(rejectedFirst, wave, "Wave", notCancelled)).status).toBe("rejected");
    expect((await deliverExpression(rejectedFirst, wave, "Wave", notCancelled)).status).toBe("delivered");

    const unconfirmed = makeContext({ behavior: () => "unconfirmed" });
    expect((await deliverExpression(unconfirmed, wave, "Wave", notCancelled)).status).toBe("unconfirmed");
    expect((await deliverExpression(unconfirmed, wave, "Wave", notCancelled)).status).toBe("unconfirmed");
    expect(sendCalls(unconfirmed)).toBe(1);

    expect(metricKeys("sticker_used")).toEqual(["Wave"]);
  });

  it("does not send when a stop arrives before the outbound send", async () => {
    const context = makeContext();
    const outcome = await deliverExpression(context, nativeSticker("111111111111111111", "Wave"), "Wave", () => true);

    expect(outcome.status).toBe("cancelled");
    expect(sendCalls(context)).toBe(0);
    expect(context.expressionDelivery).toEqual(createExpressionDeliveryState());
  });

  it("delivers custom links with suppressed mentions and counts stable IDs only", async () => {
    const row = createCustomExpression({ server_id: SERVER_ID });
    const load = spyOn(serverRepository, "loadCustomExpression").mockResolvedValue(row);
    try {
      const context = makeContext();
      const outcome = await deliverExpression(
        context,
        customSelection(row.custom_expression_id),
        row.name,
        notCancelled,
      );
      expect(outcome.status).toBe("delivered");
      const channel = context.channel as unknown as { send: ReturnType<typeof mock> };
      expect(channel.send.mock.calls[0]?.[0]).toMatchObject({
        content: row.original_link,
        allowedMentions: { parse: [] },
        enforceNonce: true,
      });
      expect(metricKeys("custom_expression_used")).toEqual([row.custom_expression_id]);
      expect(metricKeys("sticker_used")).toEqual([]);
      // The model never learns the transport or the stored identity.
      const visible = JSON.stringify(buildExpressionToolResult(outcome as never, row.name));
      expect(visible).not.toContain(row.custom_expression_id);
      expect(visible).not.toContain(row.original_link ?? "");
    } finally {
      load.mockRestore();
    }
  });

  it("rechecks deleted, restricted and stale customs at delivery without sending or counting", async () => {
    const row = createCustomExpression({ server_id: SERVER_ID });
    const load = spyOn(serverRepository, "loadCustomExpression");
    const failures: string[] = [];
    try {
      const cases: Array<[string, () => void]> = [
        ["deleted", () => load.mockResolvedValue(null)],
        ["restricted", () => load.mockResolvedValue({ ...row, restricted: true, persona_ids: [] })],
        ["stale", () => load.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, revision: 2 })],
      ];
      for (const [label, arrange] of cases) {
        arrange();
        const context = makeContext();
        const outcome = await deliverExpression(
          context,
          customSelection(row.custom_expression_id),
          row.name,
          notCancelled,
        );
        if (outcome.status !== "unavailable" || sendCalls(context) > 0) failures.push(`${label}: ${outcome.status}`);
      }
      expect(failures).toEqual([]);
      expect(metricKeys("custom_expression_used")).toEqual([]);
    } finally {
      load.mockRestore();
    }
  });

  it("attaches locally stored bytes and replies to a queued trigger before any text", async () => {
    const id = createCustomExpression().custom_expression_id;
    const bytes = Buffer.from([1, 2, 3]);
    const reference = await storeExpressionMedia(SERVER_ID, id, bytes, "image/png", "png");
    const row = createCustomExpression({
      custom_expression_id: id,
      server_id: SERVER_ID,
      source_kind: "upload",
      original_link: null,
      delivery_kind: "stored",
      storage_reference: reference,
      mime_type: "image/png",
      extension: "png",
      byte_size: bytes.length,
    });
    const load = spyOn(serverRepository, "loadCustomExpression").mockResolvedValue(row);
    try {
      const context = makeContext({ queued: true });
      expect((await deliverExpression(context, customSelection(id), row.name, notCancelled)).status).toBe("delivered");
      const reply = (context.message as unknown as { reply: ReturnType<typeof mock> }).reply;
      const payload = reply.mock.calls[0]?.[0] as { files: Array<{ attachment: Buffer }> };
      expect(payload.files[0].attachment).toEqual(bytes);
      expect(metricKeys("custom_expression_used")).toEqual([id]);
    } finally {
      load.mockRestore();
      await deleteExpressionMedia(reference, SERVER_ID, id);
    }
  });

  it("reuses this turn's delivered identity, and otherwise the active persona over an earlier speaker", async () => {
    const row = createCustomExpression({ server_id: SERVER_ID });
    const load = spyOn(serverRepository, "loadCustomExpression").mockResolvedValue(row);
    const webhookPosts = interceptWebhookPosts(created);
    try {
      for (const turnHasText of [true, false]) {
        const context = makeContext();
        Object.assign(context.channel, { isThread: () => true });
        context.responseTarget = { webhook: makeWebhook(), personaUsername: "Juno" };
        // The channel's last delivery: this turn's sprite line, or an earlier turn's other speaker.
        recordChannelDeliveredWebhookIdentity(context.channel.id, { username: "Mirri (joy)" });
        if (turnHasText) {
          context.streamingContext.deliveredMessageRefs?.push({
            messageId: "1",
            channelId: context.channel.id,
            isWebhook: true,
          });
        }
        webhookPosts.posts.length = 0;

        await deliverExpression(context, customSelection(row.custom_expression_id), row.name, notCancelled);

        const username = turnHasText ? "Mirri (joy)" : "Juno";
        expect(webhookPosts.posts[0]?.body).toMatchObject({ username, content: row.original_link });
        expect(webhookPosts.posts[0]?.url).toContain(`thread_id=${context.channel.id}`);
        const last = getChannelLastDelivery(context.channel.id);
        expect(last?.via === "webhook" ? last.identity.username : null).toBe(username);
      }
    } finally {
      webhookPosts.restore();
      load.mockRestore();
    }
  });

  it("does not post when a stop arrives while the webhook avatar is being updated", async () => {
    const context = makeContext();
    let stopped = false;
    context.responseTarget = {
      webhook: makeWebhook(() => {
        stopped = true;
      }),
      personaUsername: "Juno",
      personaAvatarUrl: "data:image/png;base64,AAAA",
    };
    const webhookPosts = interceptWebhookPosts(created);
    try {
      const outcome = await deliverExpression(
        context,
        nativeSticker("111111111111111111", "Wave"),
        "Wave",
        () => stopped,
      );

      expect(outcome.status).toBe("cancelled");
      expect(webhookPosts.posts).toHaveLength(0);
      expect(sendCalls(context)).toBe(0);
      expect(context.expressionDelivery).toEqual(createExpressionDeliveryState());
    } finally {
      webhookPosts.restore();
    }
  });

  it("waits out a webhook rate limit, then posts unless a stop arrived during the wait", async () => {
    const failures: string[] = [];
    for (const stopDuringWait of [false, true]) {
      const context = makeContext();
      context.responseTarget = { webhook: makeWebhook(), personaUsername: "Juno" };
      let stopped = false;
      const webhookPosts = interceptWebhookPosts(() => {
        if (webhookPosts.posts.length > 1) return created();
        stopped = stopDuringWait;
        return rateLimited();
      });
      try {
        const outcome = await deliverExpression(
          context,
          nativeSticker("111111111111111111", "Wave"),
          "Wave",
          () => stopped,
        );
        const expected = stopDuringWait ? { status: "cancelled", posts: 1 } : { status: "delivered", posts: 2 };
        const actual = { status: outcome.status, posts: webhookPosts.posts.length };
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          failures.push(`stopDuringWait=${stopDuringWait}: ${JSON.stringify(actual)}`);
        }
      } finally {
        webhookPosts.restore();
      }
    }
    expect(failures).toEqual([]);
    expect(metricKeys("sticker_used")).toEqual(["Wave"]);
  });

  it("makes one webhook attempt when Discord's answer is lost, and reports it unconfirmed", async () => {
    const context = makeContext();
    context.responseTarget = { webhook: makeWebhook(), personaUsername: "Juno" };
    const webhookPosts = interceptWebhookPosts(() => new Response("upstream reset", { status: 502 }));
    try {
      const wave = nativeSticker("111111111111111111", "Wave");
      const first = await deliverExpression(context, wave, "Wave", notCancelled);
      const retry = await deliverExpression(context, wave, "Wave", notCancelled);

      expect([first.status, retry.status]).toEqual(["unconfirmed", "unconfirmed"]);
      expect(webhookPosts.posts).toHaveLength(1);
      // An unconfirmed webhook send must not fall back to a second transport either.
      expect(sendCalls(context)).toBe(0);
      expect(metricKeys("sticker_used")).toEqual([]);
    } finally {
      webhookPosts.restore();
    }
  });

  it("rejects a rate-limit delay beyond the budget without reserving the expression slot", async () => {
    const context = makeContext();
    context.responseTarget = {
      webhook: Object.assign(makeWebhook(), { id: "123456789012345681" }),
      personaUsername: "Juno",
    };
    const webhookPosts = interceptWebhookPosts(() => rateLimited(60));
    try {
      const outcome = await deliverExpression(
        context,
        nativeSticker("111111111111111111", "Wave"),
        "Wave",
        notCancelled,
      );
      expect(outcome.status).toBe("rejected");
      expect(webhookPosts.posts).toHaveLength(1);
      expect(sendCalls(context)).toBe(0);
      expect(context.expressionDelivery).toEqual(createExpressionDeliveryState());
      expect(metricKeys("sticker_used")).toEqual([]);
    } finally {
      webhookPosts.restore();
    }
  });

  it("shares the deadline across repeated refusals instead of restarting the budget", async () => {
    const context = makeContext();
    context.responseTarget = { webhook: makeWebhook(), personaUsername: "Juno" };
    const now = Date.now;
    let elapsed = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => now() + elapsed);
    const post = spyOn(getSingleAttemptWebhookRest(), "post").mockImplementation(async () => {
      elapsed += 16_000;
      throw new RateLimitError({
        global: false,
        method: "POST",
        url: "https://discord.com/api/v10/webhooks/123456789012345679/webhook-token",
        route: "/webhooks/:id/:token",
        majorParameter: "123456789012345679/webhook-token",
        hash: "expression",
        limit: 1,
        timeToReset: 1,
        retryAfter: 1,
        sublimitTimeout: 0,
        scope: "user",
      });
    });
    try {
      const outcome = await deliverExpression(
        context,
        nativeSticker("111111111111111111", "Wave"),
        "Wave",
        notCancelled,
      );
      expect(outcome.status).toBe("rejected");
      expect(post).toHaveBeenCalledTimes(2);
      expect(sendCalls(context)).toBe(0);
      expect(context.expressionDelivery).toEqual(createExpressionDeliveryState());
      expect(metricKeys("sticker_used")).toEqual([]);
    } finally {
      post.mockRestore();
      clock.mockRestore();
    }
  });

  it("observes a stop during a rate-limit wait without waiting for the reset", async () => {
    const context = makeContext();
    context.responseTarget = {
      webhook: Object.assign(makeWebhook(), { id: "123456789012345682" }),
      personaUsername: "Juno",
    };
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const webhookPosts = interceptWebhookPosts(() => {
      timer = setTimeout(() => {
        stopped = true;
      }, 20);
      return rateLimited(1);
    });
    const startedAt = Date.now();
    try {
      const outcome = await deliverExpression(
        context,
        nativeSticker("111111111111111111", "Wave"),
        "Wave",
        () => stopped,
      );
      expect(outcome.status).toBe("cancelled");
      expect(Date.now() - startedAt).toBeLessThan(750);
      expect(webhookPosts.posts).toHaveLength(1);
      expect(sendCalls(context)).toBe(0);
      expect(context.expressionDelivery).toEqual(createExpressionDeliveryState());
      expect(metricKeys("sticker_used")).toEqual([]);
    } finally {
      clearTimeout(timer);
      webhookPosts.restore();
    }
  });
});
