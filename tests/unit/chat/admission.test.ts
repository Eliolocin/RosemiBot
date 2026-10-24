import { afterAll, describe, expect, it, mock, spyOn } from "bun:test";
import type { Message } from "discord.js";
import { ChannelType, DMChannel } from "discord.js";
import { PrivacyLevel } from "@/types/db/schema";
import * as audioTranscription from "@/utils/audio/audioAttachmentTranscription";
import { invalidateUserCache } from "@/utils/cache/userCache";
import {
  evaluateChatAdmission,
  evaluateMessageProxyOriginalSpeedbump,
  resolveAdmissionChannelScope,
  resolveReferencedMessage,
  shouldBlockReplyToOtherBot,
} from "@/utils/chat/admission";
import {
  acquireChannelLockForTurn,
  channelLocks,
  getOrCreateChannelLockEntry,
  interruptNudgeScene,
  isNudgeOutputActive,
  releaseChannelLockAndReplayQueue,
  runWithChannelLock,
  setActiveChannelTurnState,
  type QueuedMessage,
} from "@/utils/chat/channelQueue";
import { personaRepository } from "@/utils/db/repositories";
import { messageProxyRepository } from "@/utils/db/repositories/MessageProxyRepository";
import { messageProxyInstanceRepository } from "@/utils/db/repositories/MessageProxyInstanceRepository";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { clearPluralKitApiStateForTests } from "@/utils/messageProxy/services/pluralkit/api";
import { clearMessageProxyGuildPresenceStateForTests } from "@/utils/messageProxy/guildPresence";
import { userRepository } from "@/utils/db/repositories/UserRepository";
import {
  clearMessageProxyExpectationStateForTests,
  createMessageProxyExpectation,
  findMatchingMessageProxyExpectation,
  getMessageProxyMessageRecord,
  hasLiveMessageProxyExpectations,
  markMessageProxyExpectationProxied,
  markMessageProxyOriginalDeleted,
  rememberMessageProxyMessage,
} from "@/utils/messageProxy/proxyExpectation";
import {
  clearMessageProxyRouteMetricsForTests,
  getMessageProxyRouteMetricsSnapshot,
} from "@/utils/messageProxy/router";
import type { ChatIncoming, RunnableChatAdmission } from "@/utils/chat/types";
import { stallUntilAborted, stubGlobalFetch } from "../../helpers/fetchStub";
import { createUserRow } from "../../helpers/fixtures";

const originalFetch = globalThis.fetch;
const originalLookupTimeoutMs = process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS;
const originalProxyWaitMs = process.env.MESSAGE_PROXY_WAIT_MS;

// Both mutations are process-wide, and Bun does not reset them between the files
// sharing this lane, so the restore has to live in a hook.
afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalLookupTimeoutMs === undefined) delete process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS;
  else process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS = originalLookupTimeoutMs;
  if (originalProxyWaitMs === undefined) delete process.env.MESSAGE_PROXY_WAIT_MS;
  else process.env.MESSAGE_PROXY_WAIT_MS = originalProxyWaitMs;
});

// Object.create skips the discord.js constructor (which demands a live client and a full
// API payload) while still satisfying the `instanceof DMChannel` branch under test.
function makeDmIncoming(args: { authorDiscId: string; recipientDiscId: string }): ChatIncoming {
  const channel = Object.assign(Object.create(DMChannel.prototype), {
    id: "dm-channel",
    type: 1,
    recipientId: args.recipientDiscId,
  });

  return {
    client: { user: { id: "tomori-bot" } },
    message: { channel, guild: null, author: { id: args.authorDiscId } },
    isManuallyTriggered: true,
  } as unknown as ChatIncoming;
}

function makeReplyIncoming(cachedReference: Message | undefined, fetchedReference: Message) {
  const fetch = mock(async () => fetchedReference);
  const incoming = {
    client: {
      user: { id: "tomori" },
    },
    message: {
      content: "ordinary reply",
      reference: { messageId: "referenced-message" },
      channel: {
        messages: {
          cache: {
            get: () => cachedReference,
          },
          fetch,
        },
      },
      mentions: {
        users: {
          has: () => false,
        },
      },
    },
    isManuallyTriggered: false,
  } as unknown as ChatIncoming;

  return { fetch, incoming };
}

describe("resolveReferencedMessage", () => {
  it("fetches a reply target the message cache no longer holds", async () => {
    const tomoriReply = {
      partial: false,
      author: { id: "tomori", bot: true },
      webhookId: null,
    } as Message;
    const { fetch, incoming } = makeReplyIncoming(undefined, tomoriReply);

    const referencedMessage = await resolveReferencedMessage(incoming.message);

    expect(fetch).toHaveBeenCalledWith("referenced-message");
    expect(referencedMessage).toBe(tomoriReply);
  });

  it("hydrates an authorless partial reply target", async () => {
    const partialReference = {
      partial: true,
      author: null,
    } as unknown as Message;
    const fetchedReference = {
      partial: false,
      author: { id: "another-bot", bot: true },
      webhookId: null,
    } as Message;
    const { fetch, incoming } = makeReplyIncoming(partialReference, fetchedReference);

    const referencedMessage = await resolveReferencedMessage(incoming.message);

    expect(fetch).toHaveBeenCalledWith("referenced-message");
    expect(referencedMessage).toBe(fetchedReference);
  });
});

describe("shouldBlockReplyToOtherBot", () => {
  it("blocks an ordinary reply to another bot", async () => {
    const otherBotReference = {
      partial: false,
      author: { id: "another-bot", bot: true },
      webhookId: null,
    } as Message;
    const { incoming } = makeReplyIncoming(otherBotReference, otherBotReference);

    const reason = await shouldBlockReplyToOtherBot({
      incoming,
      earlyAllPersonas: [],
      isBotAuthor: false,
      referencedMessage: otherBotReference,
    });

    expect(reason).toBe("reply_to_other_bot");
  });

  it("allows an unresolved authorless reply target without throwing", async () => {
    const authorlessReference = {
      partial: true,
      author: null,
      webhookId: null,
    } as unknown as Message;
    const { incoming } = makeReplyIncoming(authorlessReference, authorlessReference);

    const reason = await shouldBlockReplyToOtherBot({
      incoming,
      earlyAllPersonas: [],
      isBotAuthor: false,
      referencedMessage: authorlessReference,
    });

    expect(reason).toBeNull();
  });

  it("does not treat a base trigger word wrapped in a diacritic-adjacent word as direct address", async () => {
    // Boundary semantics live in tests/unit/text/regexUtils.test.ts; this pins that a
    // base trigger word buried in an unrelated word does not read as being addressed.
    const wordContainingTrigger = "prätomo";
    const otherBotReference = {
      partial: false,
      author: { id: "another-bot", bot: true },
      webhookId: null,
    } as Message;
    const { incoming } = makeReplyIncoming(otherBotReference, otherBotReference);
    incoming.message.content = `this message only contains the unrelated word ${wordContainingTrigger}`;

    const reason = await shouldBlockReplyToOtherBot({
      incoming,
      earlyAllPersonas: [],
      isBotAuthor: false,
      referencedMessage: otherBotReference,
    });

    expect(reason).toBe("reply_to_other_bot");
  });
});

describe("resolveAdmissionChannelScope DM server key", () => {
  it("keys a DM to its recipient even when the trigger message was authored by the bot", async () => {
    // Reminder and boomerang turns pass the channel's last message as their trigger, so a
    // bot-authored trigger must not resolve the DM to the bot's own (unconfigured) id.
    const incoming = makeDmIncoming({ authorDiscId: "tomori-bot", recipientDiscId: "human-user" });

    const scope = await resolveAdmissionChannelScope(incoming, "tomori-bot");

    expect(scope?.serverDiscId).toBe("human-user");
    expect(scope?.isDMChannel).toBe(true);
  });

  it("keys a DM to its recipient for ordinary user-authored messages", async () => {
    const incoming = makeDmIncoming({ authorDiscId: "human-user", recipientDiscId: "human-user" });

    const scope = await resolveAdmissionChannelScope(incoming, "human-user");

    expect(scope?.serverDiscId).toBe("human-user");
  });

  it("falls back to the resolved user when the channel has no recipient id", async () => {
    const incoming = makeDmIncoming({ authorDiscId: "human-user", recipientDiscId: "human-user" });
    (incoming.message.channel as unknown as { recipientId: string | null }).recipientId = null;

    const scope = await resolveAdmissionChannelScope(incoming, "human-user");

    expect(scope?.serverDiscId).toBe("human-user");
  });

  it("prefers an explicit system-trigger identity when cached DM metadata is wrong", async () => {
    const incoming = makeDmIncoming({ authorDiscId: "tomori-bot", recipientDiscId: "tomori-bot" });
    incoming.systemTriggerIdentity = {
      serverDiscId: "human-user",
      userDiscId: "human-user",
    };

    const scope = await resolveAdmissionChannelScope(incoming, incoming.systemTriggerIdentity.userDiscId);

    expect(scope?.serverDiscId).toBe("human-user");
  });
});

describe("evaluateChatAdmission unavailable channel", () => {
  it("ignores a retried message whose channel no longer resolves", async () => {
    const incoming = {
      client: { user: { id: "tomori-bot" } },
      message: { channel: null, guild: null, author: { id: "user-1", bot: false }, content: "hello" },
      isManuallyTriggered: true,
      retryCount: 1,
    } as unknown as ChatIncoming;

    const admission = await evaluateChatAdmission(incoming);

    expect(admission.disposition).toBe("ignore");
  });
});

describe("evaluateChatAdmission server blacklist", () => {
  it("blocks a blacklisted member before audio transcription can run", async () => {
    const memberId = "100000000000000021";
    invalidateUserCache(memberId);
    const rowSpy = spyOn(userRepository, "loadByDiscordId").mockResolvedValue(null);
    const privacySpy = spyOn(userRepository, "getPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL);
    const blacklistSpy = spyOn(userRepository, "isBlacklisted").mockResolvedValue(true);
    const transcribeSpy = spyOn(audioTranscription, "transcribeMessageAudioAttachment");

    try {
      const incoming = {
        client: { user: { id: "tomori" } },
        message: {
          id: "voice-message",
          content: "",
          webhookId: null,
          interaction: null,
          reference: null,
          author: { id: memberId, bot: false, username: "member" },
          guild: { id: "300000000000000031" },
          channel: { id: "thread-1", type: ChannelType.PublicThread },
        },
        isManuallyTriggered: false,
      } as unknown as ChatIncoming;

      const admission = await evaluateChatAdmission(incoming);

      expect(admission.disposition).toBe("blocked");
      expect(admission.disposition === "run" ? null : admission.reason).toBe("server_blacklisted_user");
      expect(blacklistSpy).toHaveBeenCalledWith("300000000000000031", memberId);
      expect(transcribeSpy).not.toHaveBeenCalled();
    } finally {
      for (const spy of [rowSpy, privacySpy, blacklistSpy, transcribeSpy]) spy.mockRestore();
      invalidateUserCache(memberId);
    }
  });

  it("does not let a blacklisted bystander block a turn that borrows their message", async () => {
    const memberId = "100000000000000022";
    invalidateUserCache(memberId);
    const rowSpy = spyOn(userRepository, "loadByDiscordId").mockResolvedValue(null);
    const privacySpy = spyOn(userRepository, "getPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL);
    const blacklistSpy = spyOn(userRepository, "isBlacklisted").mockResolvedValue(true);

    try {
      const incoming = {
        client: { user: { id: "tomori" } },
        message: {
          id: "borrowed-anchor",
          content: "night all",
          mentions: { users: new Map(), roles: new Map(), everyone: false },
          webhookId: null,
          interaction: null,
          reference: null,
          author: { id: memberId, bot: false, username: "member" },
          guild: { id: "300000000000000032" },
          channel: { id: "channel-1", type: ChannelType.GuildText },
        },
        isManuallyTriggered: true,
        borrowsTriggerMessage: true,
      } as unknown as ChatIncoming;

      const admission = await evaluateChatAdmission(incoming);

      expect(admission.disposition === "run" ? null : admission.reason).not.toBe("server_blacklisted_user");
      expect(blacklistSpy).not.toHaveBeenCalled();
    } finally {
      for (const spy of [rowSpy, privacySpy, blacklistSpy]) spy.mockRestore();
      invalidateUserCache(memberId);
    }
  });
});

describe("evaluateChatAdmission Natural Nudges scene interrupt", () => {
  it("drops only nudge scene turns, and only for a member's own message, even one the gates then block", async () => {
    const memberId = "100000000000000023";
    const channelId = "scene-channel";
    invalidateUserCache(memberId);
    const rowSpy = spyOn(userRepository, "loadByDiscordId").mockResolvedValue(null);
    const privacySpy = spyOn(userRepository, "getPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL);
    const blacklistSpy = spyOn(userRepository, "isBlacklisted").mockResolvedValue(true);
    const sceneTurn = { commandId: "scene", sequence: [], turnIndex: 1, totalTurns: 2 };
    const anchor = { id: "anchor" } as Message;
    const commandSceneJob: QueuedMessage = { message: anchor, sceneTurn };
    const admit = async (overrides: { bot?: boolean; isManuallyTriggered?: boolean; isFromQueue?: boolean }) => {
      const discarded: string[] = [];
      const nudgeJob: QueuedMessage = {
        message: anchor,
        sceneTurn,
        naturalNudge: { toolNames: [] },
        onQueueDiscard: (reason) => {
          discarded.push(reason);
        },
      };
      const lockEntry = getOrCreateChannelLockEntry(channelId, "300000000000000033");
      lockEntry.messageQueue = [nudgeJob, commandSceneJob];
      await evaluateChatAdmission({
        client: { user: { id: "tomori" } },
        message: {
          id: "member-message",
          content: "wait what",
          mentions: { users: new Map(), roles: new Map(), everyone: false },
          webhookId: null,
          interaction: null,
          reference: null,
          author: { id: memberId, bot: overrides.bot ?? false, username: "member" },
          guild: { id: "300000000000000033" },
          channel: { id: channelId, type: ChannelType.GuildText },
        },
        isManuallyTriggered: overrides.isManuallyTriggered ?? false,
        isFromQueue: overrides.isFromQueue ?? false,
      } as unknown as ChatIncoming);
      return { queue: lockEntry.messageQueue, discarded };
    };

    try {
      const member = await admit({});
      expect(member.queue).toEqual([commandSceneJob]);
      expect(member.discarded).toEqual(["scene_interrupted"]);

      for (const overrides of [{ bot: true }, { isManuallyTriggered: true }, { isFromQueue: true }]) {
        const kept = await admit(overrides);
        expect({ overrides, queued: kept.queue.length }).toEqual({ overrides, queued: 2 });
      }
    } finally {
      for (const spy of [rowSpy, privacySpy, blacklistSpy]) spy.mockRestore();
      invalidateUserCache(memberId);
      channelLocks.delete(channelId);
    }
  });

  it("hands the interrupting member to the next scripted speaker, else to the scene persona speaking now", () => {
    const channelId = "scene-catch-channel";
    const anchor = { id: "anchor" } as Message;
    const sceneTurn = { commandId: "nudge:scene", sequence: [], turnIndex: 1, totalTurns: 3 };
    const sceneJob = (selectedPersonaId: number): QueuedMessage => ({
      message: anchor,
      sceneTurn,
      naturalNudge: { toolNames: [] },
      selectedPersonaId,
    });
    const lockEntry = getOrCreateChannelLockEntry(channelId, "300000000000000034");
    const lockFor = (naturalNudge: "single" | "scene") =>
      acquireChannelLockForTurn(lockEntry, {
        messageId: "anchor",
        userDiscId: "100000000000000024",
        isPersonaJob: false,
        selectedPersonaId: 5,
        isCommandTriggered: true,
        naturalNudge,
      });

    try {
      lockFor("scene");
      lockEntry.messageQueue = [sceneJob(7), sceneJob(8)];
      expect(interruptNudgeScene(channelId)).toBe(7);
      expect(lockEntry.messageQueue).toEqual([]);
      expect(interruptNudgeScene(channelId)).toBe(5);

      lockFor("single");
      expect(interruptNudgeScene(channelId)).toBeUndefined();
    } finally {
      channelLocks.delete(channelId);
    }
  });

  it("ignores a persona's own message while nudge work holds the channel and just after, so it starts no replies", async () => {
    const channelId = "scene-output-channel";
    const admitPersonaMessage = async () =>
      evaluateChatAdmission({
        client: { user: { id: "tomori" } },
        message: {
          id: "persona-message",
          content: "ティモリ、ことね。こっち来て",
          mentions: { users: new Map(), roles: new Map(), everyone: false },
          embeds: [],
          attachments: new Map(),
          webhookId: null,
          interaction: null,
          reference: null,
          author: { id: "tomori", bot: true, username: "Tomori" },
          guild: { id: "300000000000000035" },
          channel: { id: channelId, type: ChannelType.GuildText },
        },
        isManuallyTriggered: false,
        isFromQueue: false,
      } as unknown as ChatIncoming);
    const lockEntry = getOrCreateChannelLockEntry(channelId, "300000000000000035");

    try {
      acquireChannelLockForTurn(lockEntry, {
        messageId: "anchor",
        userDiscId: "100000000000000025",
        isPersonaJob: false,
        selectedPersonaId: 5,
        isCommandTriggered: true,
        naturalNudge: "scene",
      });
      expect(await admitPersonaMessage()).toMatchObject({ disposition: "ignore", reason: "nudge_output" });

      releaseChannelLockAndReplayQueue({
        channelId,
        lockEntry,
        completedMessageId: "anchor",
        handleStopResponse: async () => undefined,
        processQueuedMessage: async () => undefined,
      });
      expect(await admitPersonaMessage()).toMatchObject({ disposition: "ignore", reason: "nudge_output" });

      const activeDuringNormalTurn = await runWithChannelLock(
        {
          incoming: { isPersonaJob: false, isManuallyTriggered: false },
          message: { id: "member-message", channel: { id: channelId } },
          serverDiscId: "300000000000000035",
          userDiscId: "100000000000000025",
        } as unknown as RunnableChatAdmission,
        async () => isNudgeOutputActive(channelId),
        { handleStopResponse: async () => undefined, processQueuedMessage: async () => undefined },
      );
      expect(activeDuringNormalTurn).toBe(false);
    } finally {
      channelLocks.delete(channelId);
    }
  });
});

describe("evaluateMessageProxyOriginalSpeedbump guild presence", () => {
  const userDiscId = "100000000000000035";
  const channelId = "proxy-original-presence";
  const botUserId = "466378653216014359";

  function setupOriginal(memberFetch: (id: string) => Promise<unknown>) {
    invalidateUserCache(userDiscId);
    clearMessageProxyExpectationStateForTests();
    clearMessageProxyGuildPresenceStateForTests();

    const rowSpy = spyOn(userRepository, "loadByDiscordId").mockResolvedValue(
      createUserRow({
        user_disc_id: userDiscId,
        message_proxy_service: "pluralkit",
        message_proxy_instance_id: "pluralkit:official",
      }),
    );
    const privacySpy = spyOn(userRepository, "getPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL);
    const instanceSpy = spyOn(messageProxyInstanceRepository, "getEnabled").mockResolvedValue({
      serviceId: "pluralkit",
      instanceId: "pluralkit:official",
      origin: "https://api.pluralkit.me",
      displayName: "PluralKit",
      botUserId,
    });
    const incoming = {
      client: { user: { id: "tomori" } },
      message: {
        id: "original-presence-1",
        channelId,
        webhookId: null,
        reference: null,
        author: { id: userDiscId, bot: false },
        guild: {
          id: "300000000000000035",
          members: {
            cache: { has: () => false },
            fetch: memberFetch,
          },
        },
      },
      isManuallyTriggered: false,
    } as unknown as ChatIncoming;
    const ignored = (reason: string) => ({
      incoming,
      disposition: "ignore" as const,
      locale: "en-US",
      reason,
    });

    return {
      incoming,
      ignored,
      restore: () => {
        rowSpy.mockRestore();
        privacySpy.mockRestore();
        instanceSpy.mockRestore();
        invalidateUserCache(userDiscId);
        clearMessageProxyExpectationStateForTests();
        clearMessageProxyGuildPresenceStateForTests();
      },
    };
  }

  it("registers the expectation before a pending member fetch so repost and delete signals are not lost", async () => {
    let signalFetchStarted: () => void = () => {};
    const fetchStarted = new Promise<void>((resolve) => {
      signalFetchStarted = resolve;
    });
    let releaseFetch: () => void = () => {};
    const fetchReleased = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const memberFetch = mock(async () => {
      signalFetchStarted();
      await fetchReleased;
      throw Object.assign(new Error("Unknown Member"), { code: 10007 });
    });
    const fixture = setupOriginal(memberFetch);

    try {
      const pending = evaluateMessageProxyOriginalSpeedbump({
        incoming: fixture.incoming,
        userDiscId,
        isRealUserMessage: true,
        ignored: fixture.ignored,
      });
      await fetchStarted;

      const attestation = {
        serviceId: "pluralkit",
        instanceId: "pluralkit:official",
        proxyMessageId: "proxy-presence-1",
        originalMessageId: "original-presence-1",
        senderDiscordId: userDiscId,
        identity: null,
      };
      expect(findMatchingMessageProxyExpectation(channelId, attestation)).not.toBeNull();
      expect(markMessageProxyOriginalDeleted(channelId, "original-presence-1")).toBe(true);

      releaseFetch();
      const result = await pending;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(result?.reason).toBe("message_proxy_proxied");
      expect(findMatchingMessageProxyExpectation(channelId, attestation)).not.toBeNull();
    } finally {
      releaseFetch();
      fixture.restore();
    }
  });

  it("releases a still-pending original early when Discord confirms the proxy bot is absent", async () => {
    const previousWaitMs = process.env.MESSAGE_PROXY_WAIT_MS;
    process.env.MESSAGE_PROXY_WAIT_MS = "1000";
    const memberFetch = mock(async () => {
      throw Object.assign(new Error("Unknown Member"), { code: 10007 });
    });
    const fixture = setupOriginal(memberFetch);

    try {
      const pending = evaluateMessageProxyOriginalSpeedbump({
        incoming: fixture.incoming,
        userDiscId,
        isRealUserMessage: true,
        ignored: fixture.ignored,
      });
      const outcome = await Promise.race([
        pending.then((result) => ({ kind: "released" as const, result })),
        new Promise<{ kind: "still_waiting"; result: null }>((resolve) =>
          setTimeout(() => resolve({ kind: "still_waiting", result: null }), 100),
        ),
      ]);

      expect(outcome.kind).toBe("released");
      expect(outcome.result).toBeNull();
      expect(memberFetch).toHaveBeenCalled();
      expect(hasLiveMessageProxyExpectations(channelId)).toBe(false);
    } finally {
      if (previousWaitMs === undefined) delete process.env.MESSAGE_PROXY_WAIT_MS;
      else process.env.MESSAGE_PROXY_WAIT_MS = previousWaitMs;
      fixture.restore();
    }
  });

  it("does not let a slow member fetch extend the configured proxy wait", async () => {
    const previousWaitMs = process.env.MESSAGE_PROXY_WAIT_MS;
    process.env.MESSAGE_PROXY_WAIT_MS = "20";
    let signalFetchStarted: () => void = () => {};
    const fetchStarted = new Promise<void>((resolve) => {
      signalFetchStarted = resolve;
    });
    let releaseFetch: () => void = () => {};
    const fetchReleased = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const memberFetch = mock(async () => {
      signalFetchStarted();
      await fetchReleased;
      return {};
    });
    const fixture = setupOriginal(memberFetch);

    try {
      const pending = evaluateMessageProxyOriginalSpeedbump({
        incoming: fixture.incoming,
        userDiscId,
        isRealUserMessage: true,
        ignored: fixture.ignored,
      });
      await fetchStarted;
      const outcome = await Promise.race([
        pending.then((result) => ({ kind: "completed" as const, result })),
        new Promise<{ kind: "too_slow"; result: null }>((resolve) =>
          setTimeout(() => resolve({ kind: "too_slow", result: null }), 150),
        ),
      ]);

      releaseFetch();
      expect(outcome.kind).toBe("completed");
      expect(outcome.result).toBeNull();
      expect(hasLiveMessageProxyExpectations(channelId)).toBe(false);
    } finally {
      releaseFetch();
      if (previousWaitMs === undefined) delete process.env.MESSAGE_PROXY_WAIT_MS;
      else process.env.MESSAGE_PROXY_WAIT_MS = previousWaitMs;
      fixture.restore();
    }
  });
});

describe("evaluateChatAdmission message-proxy lookup failure", () => {
  it("keeps an unverifiable webhook on the ordinary path without creating a proxy identity", async () => {
    const guildId = "300000000000000041";
    const channelId = "proxy-thread-1";
    const originalMessageId = "original-message-1";
    const webhookMessageId = "webhook-message-1";
    const webhookAuthorId = "999000000000000001";
    process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS = "600";

    // A live expectation for this channel is what makes admission attempt a lookup.
    createMessageProxyExpectation({
      instance: { serviceId: "pluralkit", instanceId: "pluralkit:official", origin: "https://api.pluralkit.me" },
      channelId,
      originalMessageId,
      senderDiscId: "100000000000000041",
      originalMessage: { id: originalMessageId } as Message,
      originalReference: null,
    });

    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => stallUntilAborted(init?.signal));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // A failed attestation must not grant the foreign webhook a host identity or authorization.
    const personasSpy = spyOn(personaRepository, "loadAllForServer").mockResolvedValue([]);
    const privacySpy = spyOn(userRepository, "getPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL);
    const blacklistSpy = spyOn(userRepository, "isBlacklisted").mockResolvedValue(true);
    const instanceSpy = spyOn(messageProxyInstanceRepository, "getEnabled").mockResolvedValue({
      serviceId: "pluralkit",
      instanceId: "pluralkit:official",
      origin: "https://api.pluralkit.me",
      displayName: "PluralKit",
    });
    clearMessageProxyRouteMetricsForTests();

    try {
      const incoming = {
        client: { user: { id: "tomori" } },
        message: {
          id: webhookMessageId,
          channelId,
          guildId,
          content: "hello there",
          webhookId: "webhook-1",
          interaction: null,
          reference: null,
          client: { user: { id: "tomori" } },
          author: { id: webhookAuthorId, bot: true, username: "Mirri" },
          guild: { id: guildId, members: { cache: { get: () => null } } },
          channel: {
            id: channelId,
            type: ChannelType.PublicThread,
            isThread: () => true,
            parentId: "proxy-parent",
            messages: { cache: new Map() },
          },
        },
        isManuallyTriggered: false,
      } as unknown as ChatIncoming;

      const admission = await evaluateChatAdmission(incoming);

      // The stalled lookup could not attest the repost, so this stays an ordinary
      // webhook: the transport failure is counted truthfully, no identity or proxy
      // record is written, and the message cannot claim a trigger.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getMessageProxyRouteMetricsSnapshot()).toMatchObject({ timeout_or_error: 1, unmatched: 0 });
      expect(getMessageProxyMessageRecord(webhookMessageId)).toBeNull();
      expect(blacklistSpy).not.toHaveBeenCalled();
      expect(admission.disposition === "run" ? null : admission.reason).toBe("untrusted_webhook");
    } finally {
      for (const spy of [personasSpy, privacySpy, blacklistSpy, instanceSpy]) spy.mockRestore();
      clearMessageProxyExpectationStateForTests();
      clearMessageProxyRouteMetricsForTests();
    }
  });
});

describe("evaluateChatAdmission verified proxy follow-ups", () => {
  const channelId = "proxy-follow-up-thread";

  /**
   * Stubs every read between a PluralKit repost and the queue gate. The host selected PluralKit, and
   * the identity write succeeds without a local user ID so no bio seed reaches the database.
   */
  function stubVerifiedPluralKitRepost(args: {
    hostDiscId: string;
    originalMessageId: string;
    beforeAnswer?: () => Promise<void>;
  }) {
    const fetchSpy = stubGlobalFetch(async () => {
      await args.beforeAnswer?.();
      return Response.json({
        original: args.originalMessageId,
        sender: args.hostDiscId,
        system: { id: "abcdef", uuid: "11111111-2222-4333-8444-555555555555", name: "Lighthouse" },
        member: { id: "ghijkl", uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: "Mirri" },
      });
    });
    const spies = [
      spyOn(personaRepository, "loadAllForServer").mockResolvedValue([]),
      spyOn(userRepository, "getPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL),
      spyOn(userRepository, "isBlacklisted").mockResolvedValue(false),
      spyOn(userRepository, "loadByDiscordId").mockResolvedValue(
        createUserRow({ user_disc_id: args.hostDiscId, message_proxy_service: "pluralkit" }),
      ),
      spyOn(messageProxyInstanceRepository, "getEnabled").mockResolvedValue({
        serviceId: "pluralkit",
        instanceId: "pluralkit:official",
        origin: "https://api.pluralkit.me",
        displayName: "PluralKit",
      }),
      spyOn(messageProxyRepository, "persistAttestedIdentity").mockResolvedValue({
        userRow: createUserRow({ user_id: undefined, user_disc_id: "pk:ghijkl", user_nickname: "Mirri" }),
        namespace: {
          message_proxy_namespace_id: 51,
          service_id: "pluralkit",
          instance_id: "pluralkit:official",
          namespace_key: "abcdef",
        },
        identity: { message_proxy_identity_id: 61, message_proxy_namespace_id: 51, external_identity_id: 71 },
        isNewIdentity: false,
      }),
    ];
    return {
      fetchSpy,
      restore: () => {
        for (const spy of [fetchSpy, ...spies]) spy.mockRestore();
        invalidateUserCache(args.hostDiscId);
        channelLocks.clear();
        StreamOrchestrator.clearStopRequest(channelId);
        clearMessageProxyExpectationStateForTests();
        clearPluralKitApiStateForTests();
      },
    };
  }

  /** The host's original is still held by its speedbump, as it is while PluralKit reposts it. */
  function holdOriginal(hostDiscId: string, originalMessageId: string) {
    return createMessageProxyExpectation({
      instance: { serviceId: "pluralkit", instanceId: "pluralkit:official", origin: "https://api.pluralkit.me" },
      channelId,
      originalMessageId,
      senderDiscId: hostDiscId,
      originalMessage: { id: originalMessageId, author: { id: hostDiscId, bot: false } } as Message,
      originalReference: null,
    });
  }

  function makeRepostIncoming(guildId: string, repostMessageId: string, overrides: Partial<ChatIncoming> = {}) {
    return {
      client: { user: { id: "tomori" } },
      message: {
        id: repostMessageId,
        channelId,
        guildId,
        content: "and one more thing",
        webhookId: "pk-webhook",
        interaction: null,
        reference: null,
        components: [],
        mentions: { users: { has: () => false }, roles: { size: 0 } },
        client: { user: { id: "tomori" } },
        author: { id: "999000000000000061", bot: true, username: "Mirri", avatar: null },
        guild: { id: guildId, members: { cache: { get: () => null } } },
        channel: {
          id: channelId,
          type: ChannelType.PublicThread,
          isThread: () => true,
          parentId: "proxy-parent",
          messages: { cache: new Map() },
        },
      },
      isFromQueue: false,
      isManuallyTriggered: false,
      ...overrides,
    } as unknown as ChatIncoming;
  }

  function lockHostTurn(hostDiscId: string, activeMessageId = "active-host-turn") {
    const lockEntry = getOrCreateChannelLockEntry(channelId, "unused");
    acquireChannelLockForTurn(lockEntry, {
      messageId: activeMessageId,
      userDiscId: hostDiscId,
      isPersonaJob: false,
      isCommandTriggered: false,
    });
    setActiveChannelTurnState(lockEntry, { followUpEligible: true });
    return lockEntry;
  }

  it("interrupts a verified repost from the same member and replays it as the host", async () => {
    const guildId = "300000000000000061";
    const hostDiscId = "100000000000000061";
    const stubs = stubVerifiedPluralKitRepost({ hostDiscId, originalMessageId: "200000000000000061" });
    try {
      holdOriginal(hostDiscId, "200000000000000061");
      const activeExpectation = holdOriginal(hostDiscId, "original-active-member");
      markMessageProxyExpectationProxied(activeExpectation);
      rememberMessageProxyMessage({
        messageDiscId: "active-member-turn",
        channelId,
        expectation: activeExpectation,
        identityUserDiscId: "pk:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      });
      const lockEntry = lockHostTurn(hostDiscId, "active-member-turn");

      const admission = await evaluateChatAdmission(makeRepostIncoming(guildId, "repost-follow-up-1"));

      expect(admission.disposition === "run" ? null : admission.reason).toBe("locked_follow_up_queued");
      expect(StreamOrchestrator.isFollowUpRequest(channelId)).toBe(true);

      const replayed: QueuedMessage[] = [];
      releaseChannelLockAndReplayQueue({
        channelId,
        lockEntry,
        completedMessageId: "active-host-turn",
        handleStopResponse: async () => {},
        processQueuedMessage: async (queued) => {
          replayed.push(queued);
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const [followUp] = replayed;
      if (!followUp) throw new Error("The verified repost was not replayed");

      const lookupsBeforeReplay = stubs.fetchSpy.mock.calls.length;
      const replay = await evaluateChatAdmission(
        makeRepostIncoming(guildId, followUp.message.id, {
          isFromQueue: true,
          isManuallyTriggered: followUp.isManuallyTriggered,
          textQuotaUserDiscId: followUp.textQuotaUserDiscId,
        }),
      );

      // The replayed turn answers as the host account from the confirmed record, without a
      // second PluralKit lookup that could fail and strip the member's identity.
      expect(replay.disposition === "run" ? replay.userDiscId : replay.reason).toBe(hostDiscId);
      expect(stubs.fetchSpy.mock.calls.length).toBe(lookupsBeforeReplay);
    } finally {
      stubs.restore();
    }
  });

  it("does not interrupt a turn that ended while the repost was still being verified", async () => {
    const guildId = "300000000000000062";
    const hostDiscId = "100000000000000062";
    let signalLookupStarted: () => void = () => {};
    const lookupStarted = new Promise<void>((resolve) => {
      signalLookupStarted = resolve;
    });
    let answerLookup: () => void = () => {};
    const lookupAnswered = new Promise<void>((resolve) => {
      answerLookup = resolve;
    });
    const stubs = stubVerifiedPluralKitRepost({
      hostDiscId,
      originalMessageId: "200000000000000062",
      beforeAnswer: async () => {
        signalLookupStarted();
        await lookupAnswered;
      },
    });
    try {
      holdOriginal(hostDiscId, "200000000000000062");
      const lockEntry = lockHostTurn(hostDiscId);

      const pendingAdmission = evaluateChatAdmission(makeRepostIncoming(guildId, "repost-follow-up-2"));
      await lookupStarted;
      releaseChannelLockAndReplayQueue({
        channelId,
        lockEntry,
        completedMessageId: "active-host-turn",
        handleStopResponse: async () => {},
        processQueuedMessage: async () => {},
      });
      answerLookup();
      const admission = await pendingAdmission;

      expect(admission.disposition === "run" ? admission.userDiscId : admission.reason).toBe(hostDiscId);
      expect(StreamOrchestrator.isFollowUpRequest(channelId)).toBe(false);
      expect(lockEntry.messageQueue).toHaveLength(0);
    } finally {
      stubs.restore();
    }
  });
});
