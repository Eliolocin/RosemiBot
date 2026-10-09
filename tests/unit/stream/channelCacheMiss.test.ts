import { describe, expect, it } from "bun:test";
import type { Message } from "discord.js";
import type { StreamContext } from "@/types/stream/interfaces";
import { createDefaultStreamState } from "@/types/stream/types";
import { StreamUiUpdater } from "@/utils/discord/stream/uiUpdater";

const CHANNEL_ID = "1382235263668846612";
const SOURCE_MESSAGE_ID = "1382235263668846613";

type StopCall = { channelId: string; requesterId: string | undefined };

/**
 * Builds a source `Message` in a chosen channel whose `channel` behaves like discord.js: a live
 * cache lookup that returns null once the entry is not cached. `Message#reply` throws on that null
 * before it builds a request, which is the failure this file exists to prove the send path no
 * longer depends on.
 */
function makeSourceMessageInChannel(channelId: string): { message: Message; replyCalls: number } {
  const state = { replyCalls: 0 };
  const message = {
    id: SOURCE_MESSAGE_ID,
    channelId,
    get channel() {
      return null;
    },
    async reply() {
      state.replyCalls++;
      throw Object.assign(new Error("Could not find the channel where this message came from in the cache!"), {
        code: "ChannelNotCached",
      });
    },
  } as unknown as Message;

  return {
    message,
    get replyCalls() {
      return state.replyCalls;
    },
  };
}

/** The common case: the source message lives in the same channel the turn captured. */
function makeUncachedSourceMessage(): { message: Message; replyCalls: number } {
  return makeSourceMessageInChannel(CHANNEL_ID);
}

function makeUpdater() {
  const stopCalls: StopCall[] = [];
  const updater = new StreamUiUpdater({
    hasStopRequest: () => false,
    requestStop: (channelId, requesterId) => {
      stopCalls.push({ channelId, requesterId });
      return true;
    },
    notifyStreamProgress: () => undefined,
  });
  return { updater, stopCalls };
}

describe("a reply whose source channel left the cache", () => {
  it("sends on the channel resolved by id and keeps the reply reference", async () => {
    const { updater, stopCalls } = makeUpdater();
    const replySends: unknown[] = [];
    const fetchedChannels: string[] = [];
    const source = makeUncachedSourceMessage();

    const context = {
      channel: {
        id: CHANNEL_ID,
        send: async (payload: unknown) => {
          replySends.push(payload);
          return {};
        },
      },
      client: {
        channels: {
          cache: new Map(),
          fetch: async (id: string) => {
            fetchedChannels.push(id);
            return {
              id,
              send: async (payload: unknown) => {
                replySends.push(payload);
                return {};
              },
            };
          },
        },
      },
      replyToMessage: source.message,
      locale: "en-US",
      suppressUserErrors: false,
      tomoriState: { is_alter: false, config: {} },
    } as unknown as StreamContext;

    const state = createDefaultStreamState();
    const sent = await updater.sendSinglePayload(
      { content: "hello", diagnosticReason: "length_split" },
      "hello",
      context,
      state,
    );

    // The captured channel object is still usable, so the reply lands there rather than through a
    // fetch, and the reference is what makes it a reply at all.
    expect(sent).not.toBeNull();
    expect(replySends).toHaveLength(1);
    expect(replySends[0]).toMatchObject({
      content: "hello",
      reply: { messageReference: SOURCE_MESSAGE_ID, failIfNotExists: false },
    });
    expect(replySends[0]).not.toHaveProperty("diagnosticReason");
    expect(state.hasRepliedToOriginalMessage).toBe(true);
    expect(stopCalls).toEqual([]);
    expect(fetchedChannels).toEqual([]);
    // The cache-dependent path was never taken.
    expect(source.replyCalls).toBe(0);
  });

  it("falls back to a REST lookup when the captured channel cannot send", async () => {
    const { updater } = makeUpdater();
    const replySends: unknown[] = [];
    const fetchedChannels: string[] = [];
    const source = makeUncachedSourceMessage();

    const context = {
      // A partial channel: it exposes an id but no send surface.
      channel: { id: CHANNEL_ID },
      client: {
        channels: {
          cache: new Map(),
          fetch: async (id: string) => {
            fetchedChannels.push(id);
            return {
              id,
              send: async (payload: unknown) => {
                replySends.push(payload);
                return {};
              },
            };
          },
        },
      },
      replyToMessage: source.message,
      locale: "en-US",
      suppressUserErrors: false,
      tomoriState: { is_alter: false, config: {} },
    } as unknown as StreamContext;

    const sent = await updater.sendSinglePayload({ content: "hello" }, "hello", context, createDefaultStreamState());

    expect(sent).not.toBeNull();
    expect(fetchedChannels).toEqual([CHANNEL_ID]);
    expect(replySends[0]).toMatchObject({ reply: { messageReference: SOURCE_MESSAGE_ID } });
  });

  /**
   * One stream sends many chunks, and `sendSinglePayload` only consults the reply target while
   * `hasRepliedToOriginalMessage` is false. A restored channel that is not written back onto the
   * context therefore breaks the second chunk, which sends through `context.channel` directly.
   */
  it("keeps sending after the first chunk once the channel was restored", async () => {
    const { updater, stopCalls } = makeUpdater();
    const replySends: unknown[] = [];
    const fetchedChannels: string[] = [];
    const source = makeUncachedSourceMessage();

    const context = {
      channel: { id: CHANNEL_ID },
      client: {
        channels: {
          cache: new Map(),
          fetch: async (id: string) => {
            fetchedChannels.push(id);
            return {
              id,
              send: async (payload: unknown) => {
                replySends.push(payload);
                return {};
              },
            };
          },
        },
      },
      replyToMessage: source.message,
      locale: "en-US",
      suppressUserErrors: false,
      tomoriState: { is_alter: false, config: {} },
    } as unknown as StreamContext;

    const state = createDefaultStreamState();
    const first = await updater.sendSinglePayload({ content: "first" }, "first", context, state);
    const second = await updater.sendSinglePayload({ content: "second" }, "second", context, state);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(replySends).toHaveLength(2);
    // Only the first chunk replies, and only the first needs the lookup.
    expect(replySends[0]).toMatchObject({ reply: { messageReference: SOURCE_MESSAGE_ID } });
    expect(replySends[1]).not.toHaveProperty("reply");
    expect(fetchedChannels).toEqual([CHANNEL_ID]);
    expect(stopCalls).toEqual([]);
  });
});

describe("a deleted destination channel", () => {
  it("stops the stream quietly instead of throwing", async () => {
    const { updater, stopCalls } = makeUpdater();
    const source = makeUncachedSourceMessage();

    const context = {
      channel: { id: CHANNEL_ID },
      client: {
        channels: {
          cache: new Map(),
          fetch: async () => {
            throw Object.assign(new Error("Unknown Channel"), { code: 10003 });
          },
        },
      },
      replyToMessage: source.message,
      locale: "en-US",
      suppressUserErrors: false,
      tomoriState: { is_alter: false, config: {} },
    } as unknown as StreamContext;

    const sent = await updater.sendSinglePayload({ content: "hello" }, "hello", context, createDefaultStreamState());

    // Resolving null rather than throwing is what keeps one deletion from becoming an error burst
    // across the orchestrator, the generation turn, and the queue.
    expect(sent).toBeNull();
    expect(stopCalls).toEqual([{ channelId: CHANNEL_ID, requesterId: "channel_deleted" }]);
    expect(source.replyCalls).toBe(0);
  });

  /**
   * A webhook send can be the first thing to notice the deletion, which routes the retry through
   * the bot fallback. That path must reach the same quiet teardown instead of logging a failure
   * and leaving generation running against a channel that cannot receive anything.
   */
  it("tears down quietly when the deletion surfaces on the webhook fallback", async () => {
    const { updater, stopCalls } = makeUpdater();
    const goneError = () => Object.assign(new Error("Unknown Channel"), { code: 10003 });

    const context = {
      // Webhook-capable so the initial webhook path is taken, and sendable so the bot fallback
      // attempts a real send rather than failing on resolution. Both reports are the deletion.
      channel: {
        id: CHANNEL_ID,
        fetchWebhooks: async () => new Map(),
        createWebhook: async () => ({ id: "webhook-1" }),
        send: async () => {
          throw goneError();
        },
      },
      webhook: { id: "webhook-1", send: async () => Promise.reject(goneError()) },
      personaUsername: "Tomori",
      client: { channels: { cache: new Map(), fetch: async () => null } },
      locale: "en-US",
      suppressUserErrors: false,
      tomoriState: { is_alter: false, config: {} },
    } as unknown as StreamContext;

    const sent = await updater.sendSinglePayload({ content: "hello" }, "hello", context, createDefaultStreamState());

    expect(sent).toBeNull();
    expect(stopCalls).toEqual([{ channelId: CHANNEL_ID, requesterId: "channel_deleted" }]);
  });
});

describe("a transient failure while resolving the destination", () => {
  /**
   * Only Discord's permanent answer may be read as a deletion. A rate limit or a 5xx that resolved
   * to null would stop the stream and drop the turn's remaining retry arms, which is worse than
   * the plain send failure it replaced.
   */
  it("stays an ordinary send failure when the channel fetch is rate limited", async () => {
    const { updater, stopCalls } = makeUpdater();
    const source = makeUncachedSourceMessage();

    const context = {
      channel: { id: CHANNEL_ID },
      client: {
        channels: {
          cache: new Map(),
          fetch: async () => {
            throw Object.assign(new Error("You are being rate limited."), { status: 429, code: 0 });
          },
        },
      },
      replyToMessage: source.message,
      locale: "en-US",
      suppressUserErrors: false,
      tomoriState: { is_alter: false, config: {} },
    } as unknown as StreamContext;

    // It still fails, but as a send failure rather than as a deletion, so the stop registry is
    // left alone and no log claims the channel is gone.
    await expect(
      updater.sendSinglePayload({ content: "hello" }, "hello", context, createDefaultStreamState()),
    ).rejects.toThrow(/Discord send failed/);
    expect(stopCalls).toEqual([]);
  });

  it("names the lost permission rather than reporting the channel as deleted", async () => {
    const { updater, stopCalls } = makeUpdater();
    const source = makeUncachedSourceMessage();

    const context = {
      channel: { id: CHANNEL_ID },
      client: {
        channels: {
          cache: new Map(),
          fetch: async () => {
            throw Object.assign(new Error("Missing Access"), { code: 50001 });
          },
        },
      },
      replyToMessage: source.message,
      locale: "en-US",
      suppressUserErrors: false,
      tomoriState: { is_alter: false, config: {} },
    } as unknown as StreamContext;

    const sent = await updater.sendSinglePayload({ content: "hello" }, "hello", context, createDefaultStreamState());

    // Same teardown, different cause. Reporting 50001 as a deletion sends an operator looking for a
    // channel that still exists, when the fix is to grant the permission back.
    expect(sent).toBeNull();
    expect(stopCalls).toEqual([{ channelId: CHANNEL_ID, requesterId: "missing_access" }]);
  });
});

describe("a send refused by Discord for missing access", () => {
  /**
   * A REST refusal arrives as discord.js's own error, not as this file's resolver error, so the
   * reason has to come from the code. Matching on the class would report a revoked grant as a
   * deleted channel and send an operator looking for a channel that still exists.
   */
  it("names the lost permission when the send itself is refused with 50001", async () => {
    const { updater, stopCalls } = makeUpdater();

    const context = {
      channel: {
        id: CHANNEL_ID,
        send: async () => {
          // Shaped like DiscordAPIError, which is not the resolver's own class.
          throw Object.assign(new Error("Missing Access"), { code: 50001, status: 403 });
        },
      },
      client: { channels: { cache: new Map(), fetch: async () => null } },
      locale: "en-US",
      suppressUserErrors: false,
      tomoriState: { is_alter: false, config: {} },
    } as unknown as StreamContext;

    const sent = await updater.sendSinglePayload({ content: "hello" }, "hello", context, createDefaultStreamState());

    expect(sent).toBeNull();
    expect(stopCalls).toEqual([{ channelId: CHANNEL_ID, requesterId: "missing_access" }]);
  });
});

describe("a webhook-delivered send into a channel that cannot be resolved", () => {
  /**
   * The webhook is the delivery path for this message, and the resolution only exists to keep the
   * chunks after it working. A destination that cannot be reached is the same terminal condition
   * the bot path reports, so it has to stop the stream rather than leave generation running.
   */
  it("stops the stream instead of sending under an unresolved destination", async () => {
    const { updater, stopCalls } = makeUpdater();
    const webhookSends: unknown[] = [];

    const context = {
      // Partial: no send surface, so the branch has to resolve before it can trust later chunks.
      channel: { id: CHANNEL_ID },
      webhook: {
        id: "webhook-1",
        send: async (payload: unknown) => {
          webhookSends.push(payload);
          return {};
        },
      },
      personaUsername: "Tomori",
      client: {
        channels: {
          cache: new Map(),
          fetch: async () => {
            throw Object.assign(new Error("Unknown Channel"), { code: 10003 });
          },
        },
      },
      locale: "en-US",
      suppressUserErrors: false,
      tomoriState: { is_alter: false, config: {} },
    } as unknown as StreamContext;

    const sent = await updater.sendSinglePayload({ content: "hello" }, "hello", context, createDefaultStreamState());

    expect(sent).toBeNull();
    expect(stopCalls).toEqual([{ channelId: CHANNEL_ID, requesterId: "channel_deleted" }]);
    expect(webhookSends).toEqual([]);
  });

  /**
   * A transient failure is not a terminal condition, so it must not become a stop, and it must not
   * drop the message either: the resolution is an upgrade for later chunks, while the webhook is
   * what delivers this one.
   */
  it("keeps the webhook send alive when the resolution fails transiently", async () => {
    const { updater, stopCalls } = makeUpdater();
    const webhookSends: unknown[] = [];

    const context = {
      channel: { id: CHANNEL_ID },
      webhook: {
        id: "webhook-1",
        send: async (payload: unknown) => {
          webhookSends.push(payload);
          return {};
        },
      },
      personaUsername: "Tomori",
      client: {
        channels: {
          cache: new Map(),
          fetch: async () => {
            throw Object.assign(new Error("You are being rate limited."), { status: 429, code: 0 });
          },
        },
      },
      locale: "en-US",
      suppressUserErrors: false,
      tomoriState: { is_alter: false, config: {} },
    } as unknown as StreamContext;

    const state = createDefaultStreamState();
    const sent = await updater.sendSinglePayload({ content: "hello" }, "hello", context, state);

    expect(sent).not.toBeNull();
    expect(stopCalls).toEqual([]);
    expect(webhookSends).toHaveLength(1);
    // The delivery still counts, so the send is not silently dropped on the floor.
    expect(state.messageSentCount).toBe(1);
  });
});

describe("a reply whose source channel is unreachable", () => {
  /**
   * Discord rejects a reference whose message lives in another channel, so a send that has already
   * moved to a reachable channel has to drop the reference rather than fail with 10008.
   */
  it("drops the reply reference instead of pointing it out of the target channel", async () => {
    const { updater, stopCalls } = makeUpdater();
    const sends: unknown[] = [];
    const src = makeSourceMessageInChannel("999999999999999999");

    const context = {
      // The reachable destination the turn falls back to, which is not the source's channel.
      channel: {
        id: CHANNEL_ID,
        send: async (payload: unknown) => {
          sends.push(payload);
          return {};
        },
      },
      client: {
        channels: {
          cache: new Map(),
          // The source channel is gone, so the captured channel is what remains.
          fetch: async (id: string) => {
            if (id === "999999999999999999") {
              throw Object.assign(new Error("Unknown Channel"), { code: 10003 });
            }
            return null;
          },
        },
      },
      replyToMessage: src.message,
      locale: "en-US",
      suppressUserErrors: false,
      tomoriState: { is_alter: false, config: {} },
    } as unknown as StreamContext;

    const sent = await updater.sendSinglePayload({ content: "hello" }, "hello", context, createDefaultStreamState());

    expect(sent).not.toBeNull();
    expect(sends).toHaveLength(1);
    // A reference into the deleted source channel would be rejected by Discord, so none is sent.
    expect(sends[0]).not.toHaveProperty("reply");
    expect(stopCalls).toEqual([]);
  });
});
