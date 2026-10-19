import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { TextChannel, type Client, type Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { evaluateAdmissionQueueAndTriggerGate } from "@/utils/chat/admissionQueue";
import {
  acquireChannelLockForTurn,
  channelLocks,
  clearChannelProcessingQueue,
  enqueueBusyChannelMessage,
  forceKillChannelStream,
  getChannelActiveToolName,
  getOrCreateChannelLockEntry,
  releaseChannelLockAndReplayQueue,
  setActiveChannelTurnState,
  setChannelToolCallChainActive,
} from "@/utils/chat/channelQueue";
import { shouldSurfaceChatUserErrors } from "@/utils/chat/errorVisibility";
import { shouldBotReply } from "@/utils/chat/replyDecision";
import type { ChatIncoming, ChatTurnContext } from "@/utils/chat/types";
import { createExpressionDeliveryState } from "@/utils/chat/expressionDelivery";
import { runToolLoop } from "@/utils/chat/toolLoop";
import { determineMatchingPersonas, isSelfTriggerMessage } from "@/utils/chat/triggerProcessor";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import {
  clearMessageProxyExpectationStateForTests,
  createMessageProxyExpectation,
  getMessageProxyMessageRecord,
  markMessageProxyExpectationProxied,
  rememberMessageProxyMessage,
  waitForMessageProxyExpectation,
  type MessageProxyMessageRecord,
} from "@/utils/messageProxy/proxyExpectation";
import { parseTriggerWordListInput } from "@/utils/text/triggerWords";
import { ToolRegistry } from "@/tools/toolRegistry";
import type { LLMProvider, StreamResult } from "@/types/provider/interfaces";
import { createPersona } from "../../helpers/fixtures";
import { verifyMessageWebhook, clearWebhookIdentityCache } from "@/utils/chat/webhookIdentity";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";

type ProviderFixtureName = "google" | "openrouter" | "novelai";

type PersonaFixture = {
  id: number;
  nickname: string;
  isAlter: boolean;
  triggers: string[];
};

type AutochatPersonaOverrideFixture = {
  channelDiscId: string;
  personaId: number;
};

type ConversationFixture = {
  id: string;
  provider: ProviderFixtureName;
  description: string;
  message: {
    authorId: string;
    authorName: string;
    authorBot?: boolean;
    content: string;
    mentionedUserIds: string[];
    webhookId?: string | null;
  };
  state: {
    deliberateTriggerMode: boolean;
    alwaysReplyEnabled: boolean;
    autochDiscIds: string[];
    autochPersonaOverrides: AutochatPersonaOverrideFixture[];
    autochCounter: number;
    autochNextTarget: number;
  };
  personas: PersonaFixture[];
  triggerContext: {
    isReplyToBot: boolean;
    replyPersonaId: number | null;
    isBotMentioned: boolean;
    isAutoMsgHit: boolean;
    isAlwaysReply: boolean;
    autoTriggerPersonaId: number | null;
    alwaysReplyFallbackPersonaId: number | null;
    deliberateTriggerMode: boolean;
    isAutochatDtmExemptChannel: boolean;
    allowedPersonaIds: number[] | null;
  };
};

type ExpectedDecision = {
  provider: ProviderFixtureName;
  shouldReply: boolean;
  matchingPersonaNicknames: string[];
};

const botUserId = "bot_001";
const guildId = "guild_001";
const channelId = "channel_001";

const conversations = (await Bun.file(
  "tests/regression/chat/fixtures/conversations.json",
).json()) as ConversationFixture[];
const expectedDecisions = (await Bun.file("tests/regression/chat/fixtures/expected-decisions.json").json()) as Record<
  string,
  ExpectedDecision
>;

function makeClient(): Client {
  return {
    user: {
      id: botUserId,
    },
  } as unknown as Client;
}

function makeTextChannel(): TextChannel {
  const channel = Object.create(TextChannel.prototype) as {
    id: string;
    parentId: string | null;
    messages: { cache: Map<string, Message> };
    isThread: () => boolean;
  };

  channel.id = channelId;
  channel.parentId = null;
  channel.messages = { cache: new Map<string, Message>() };
  channel.isThread = () => false;

  return channel as unknown as TextChannel;
}

function makeMessage(fixture: ConversationFixture, client: Client): Message {
  const mentionedUserIds = new Set(fixture.message.mentionedUserIds);
  const channel = makeTextChannel();

  const message = {
    id: `msg_${fixture.id}`,
    channel,
    channelId,
    guildId,
    client,
    guild: {
      id: guildId,
    },
    webhookId: null,
    interaction: null,
    reference: null,
    content: fixture.message.content,
    author: {
      id: fixture.message.authorId,
      username: fixture.message.authorName,
      bot: fixture.message.authorBot ?? false,
    },
    mentions: {
      users: {
        has: (userId: string) => mentionedUserIds.has(userId),
      },
    },
  } as unknown as Message;

  message.webhookId = fixture.message.webhookId ?? null;
  return message;
}

function makeTomoriState(fixture: ConversationFixture, persona: PersonaFixture): TomoriState {
  return createPersona({
    persona_id: persona.id,
    persona_nickname: persona.nickname,
    is_alter: persona.isAlter,
    trigger_words: persona.triggers,
    autoch_counter: fixture.state.autochCounter,
    autoch_next_target: fixture.state.autochNextTarget,
    config: {
      deliberate_trigger_mode: fixture.state.deliberateTriggerMode,
      always_reply_enabled: fixture.state.alwaysReplyEnabled,
      autoch_disc_ids: fixture.state.autochDiscIds,
      autoch_persona_overrides: fixture.state.autochPersonaOverrides.map((override) => ({
        channel_disc_id: override.channelDiscId,
        persona_id: override.personaId,
      })),
      autoch_threshold: 0,
      autoch_threshold_max: 0,
      // `shouldBotReply` reads a zero cascade limit as "never reply to a self-message", so the
      // fixture's zero has to survive the shared config default of 3.
      cascade_limit: 0,
    },
  });
}

/**
 * Confirms a repost the way admission does. `originalRan` models a late PluralBuddy repost: its
 * expectation outlives the speedbump, so the original was already admitted when the repost matched.
 */
async function confirmProxyRepost(args: {
  original: Message;
  repost: Message;
  hostDiscId: string;
  originalRan?: boolean;
  memberUserDiscId?: string;
}): Promise<MessageProxyMessageRecord> {
  const originalWaitMs = process.env.MESSAGE_PROXY_WAIT_MS;
  if (args.originalRan) process.env.MESSAGE_PROXY_WAIT_MS = "0";
  const expectation = createMessageProxyExpectation({
    instance: args.originalRan
      ? { serviceId: "pluralbuddy", instanceId: "pluralbuddy:official", origin: "https://pluralbuddy.app" }
      : { serviceId: "pluralkit", instanceId: "pluralkit:official", origin: "https://api.pluralkit.me" },
    channelId,
    originalMessageId: args.original.id,
    senderDiscId: args.hostDiscId,
    originalMessage: args.original,
    originalReference: null,
  });
  if (originalWaitMs === undefined) delete process.env.MESSAGE_PROXY_WAIT_MS;
  else process.env.MESSAGE_PROXY_WAIT_MS = originalWaitMs;

  if (args.originalRan) expect(await waitForMessageProxyExpectation(expectation)).toBe("timeout");
  markMessageProxyExpectationProxied(expectation);
  return rememberMessageProxyMessage({
    messageDiscId: args.repost.id,
    channelId,
    expectation,
    identityUserDiscId: args.memberUserDiscId ?? "pk:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    verifiedRepostOnly: args.originalRan,
  });
}

describe("chat regression harness", () => {
  const initialMessageProxyWaitMs = process.env.MESSAGE_PROXY_WAIT_MS;

  let managedLookup: ReturnType<typeof spyOn<typeof serverRepository, "loadManagedWebhookByChannelAndWebhookId">>;
  beforeEach(() => {
    clearWebhookIdentityCache();
    managedLookup = spyOn(serverRepository, "loadManagedWebhookByChannelAndWebhookId").mockImplementation(
      async (channel, webhook) =>
        conversations.some((fixture) => fixture.message.webhookId === webhook)
          ? {
              managed_webhook_id: 1,
              guild_disc_id: guildId,
              channel_disc_id: channel,
              webhook_disc_id: webhook,
              kind: "shared_channel",
              avatar_fingerprint: null,
              discord_avatar_hash: null,
              webhook_token: Buffer.from("fixture"),
              key_version: 1,
            }
          : null,
    );
  });
  afterEach(() => {
    managedLookup.mockRestore();
    clearWebhookIdentityCache();
    StreamOrchestrator.clearStopRequest(channelId);
    channelLocks.clear();
    clearMessageProxyExpectationStateForTests();
    if (initialMessageProxyWaitMs === undefined) delete process.env.MESSAGE_PROXY_WAIT_MS;
    else process.env.MESSAGE_PROXY_WAIT_MS = initialMessageProxyWaitMs;
  });

  for (const fixture of conversations) {
    it(`${fixture.provider}: ${fixture.description}`, async () => {
      const client = makeClient();
      const message = makeMessage(fixture, client);
      await verifyMessageWebhook(message);
      const personas = fixture.personas.map((persona) => makeTomoriState(fixture, persona));
      const mainPersona = personas.find((persona) => !persona.is_alter);
      const replyPersona =
        fixture.triggerContext.replyPersonaId === null
          ? null
          : (personas.find((persona) => persona.persona_id === fixture.triggerContext.replyPersonaId) ?? null);
      const allowedPersonaIds =
        fixture.triggerContext.allowedPersonaIds === null ? null : new Set(fixture.triggerContext.allowedPersonaIds);

      if (!mainPersona) {
        throw new Error(`Fixture ${fixture.id} is missing a main persona`);
      }

      const actualDecision: ExpectedDecision = {
        provider: fixture.provider,
        shouldReply: shouldBotReply(message, mainPersona, personas, {
          allowedPersonaIds,
          referencedMessage: null,
        }),
        matchingPersonaNicknames: determineMatchingPersonas(
          message,
          personas,
          client,
          null,
          fixture.triggerContext.isReplyToBot,
          replyPersona,
          fixture.triggerContext.isBotMentioned,
          fixture.triggerContext.isAutoMsgHit,
          fixture.triggerContext.isAlwaysReply,
          fixture.triggerContext.autoTriggerPersonaId,
          fixture.triggerContext.alwaysReplyFallbackPersonaId,
          fixture.triggerContext.deliberateTriggerMode,
          fixture.triggerContext.isAutochatDtmExemptChannel,
          allowedPersonaIds,
        ).map((persona) => persona.persona_nickname ?? `id:${persona.persona_id}`),
      };

      expect(actualDecision).toEqual(expectedDecisions[fixture.id]);
    });
  }

  it("identifies persona webhook messages as self-trigger messages", async () => {
    const fixture = conversations.find((conversation) => conversation.id === "google-persona-webhook-self-trigger");
    if (!fixture) {
      throw new Error("Missing google-persona-webhook-self-trigger fixture");
    }

    const client = makeClient();
    const message = makeMessage(fixture, client);
    await verifyMessageWebhook(message);
    const personas = fixture.personas.map((persona) => makeTomoriState(fixture, persona));

    expect(isSelfTriggerMessage(message, personas)).toBe(true);
  });

  it("normalizes quoted trigger input before storage", () => {
    expect(parseTriggerWordListInput('"Quetz", `Tomo`, quetz')).toEqual(["quetz", "tomo"]);
  });

  it("keeps passive autochat-style turns quiet for user-facing error embeds", () => {
    const client = makeClient();
    const fixture = conversations[0];
    const message = makeMessage(
      {
        ...fixture,
        id: "passive_error_visibility",
        message: {
          ...fixture.message,
          content: "just a normal chat message",
          mentionedUserIds: [],
        },
      },
      client,
    );
    const personas = fixture.personas.map((persona) => makeTomoriState(fixture, persona));
    const incoming: ChatIncoming = {
      client,
      message,
      isFromQueue: false,
      retryCount: 0,
      skipLock: false,
      isPersonaJob: false,
      isUserImpersonation: false,
      textQuotaSource: "user",
    };

    expect(
      shouldSurfaceChatUserErrors({
        incoming,
        client,
        message,
        isDMChannel: false,
        allPersonas: personas,
        referencedMessage: null,
      }),
    ).toBe(false);
  });

  it("surfaces user-facing error embeds for deliberate chat triggers", () => {
    const client = makeClient();
    const fixture = conversations[0];
    const message = makeMessage(
      {
        ...fixture,
        id: "direct_error_visibility",
        message: {
          ...fixture.message,
          content: "Tomori, are you there?",
          mentionedUserIds: [],
        },
      },
      client,
    );
    const personas = fixture.personas.map((persona) => makeTomoriState(fixture, persona));
    const incoming: ChatIncoming = {
      client,
      message,
      isFromQueue: false,
      retryCount: 0,
      skipLock: false,
      isPersonaJob: false,
      isUserImpersonation: false,
      textQuotaSource: "user",
    };

    expect(
      shouldSurfaceChatUserErrors({
        incoming,
        client,
        message,
        isDMChannel: false,
        allPersonas: personas,
        referencedMessage: null,
      }),
    ).toBe(true);
  });

  it("lets internal triggers explicitly suppress user-facing error embeds", () => {
    const client = makeClient();
    const fixture = conversations[0];
    const message = makeMessage(
      {
        ...fixture,
        id: "explicit_suppressed_error_visibility",
        message: {
          ...fixture.message,
          content: "Tomori, are you there?",
          mentionedUserIds: [],
        },
      },
      client,
    );
    const personas = fixture.personas.map((persona) => makeTomoriState(fixture, persona));
    const incoming: ChatIncoming = {
      client,
      message,
      isFromQueue: false,
      retryCount: 0,
      skipLock: false,
      isPersonaJob: false,
      isUserImpersonation: false,
      textQuotaSource: "system",
      shouldSurfaceUserErrors: false,
    };

    expect(
      shouldSurfaceChatUserErrors({
        incoming,
        client,
        message,
        isDMChannel: false,
        allPersonas: personas,
        referencedMessage: null,
      }),
    ).toBe(false);
  });

  it("matches legacy stored trigger words with surrounding quotes", () => {
    const client = makeClient();
    const fixture: ConversationFixture = {
      id: "quoted-trigger-legacy",
      provider: "google",
      description: "legacy quoted trigger values still route to the expected persona",
      message: {
        authorId: "user_quoted_trigger",
        authorName: "Quoted Trigger User",
        content: "quetz, are you there?",
        mentionedUserIds: [],
      },
      state: {
        deliberateTriggerMode: false,
        alwaysReplyEnabled: false,
        autochDiscIds: [],
        autochPersonaOverrides: [],
        autochCounter: 0,
        autochNextTarget: 0,
      },
      personas: [
        {
          id: 1,
          nickname: "Tomori",
          isAlter: false,
          triggers: ["tomori"],
        },
        {
          id: 2,
          nickname: "Quetz",
          isAlter: true,
          triggers: ['"quetz"'],
        },
      ],
      triggerContext: {
        isReplyToBot: false,
        replyPersonaId: null,
        isBotMentioned: false,
        isAutoMsgHit: false,
        isAlwaysReply: false,
        autoTriggerPersonaId: null,
        alwaysReplyFallbackPersonaId: null,
        deliberateTriggerMode: false,
        isAutochatDtmExemptChannel: false,
        allowedPersonaIds: null,
      },
    };
    const message = makeMessage(fixture, client);
    const personas = fixture.personas.map((persona) => makeTomoriState(fixture, persona));
    const mainPersona = personas.find((persona) => !persona.is_alter);

    if (!mainPersona) {
      throw new Error("Quoted trigger fixture is missing a main persona");
    }

    expect(
      determineMatchingPersonas(
        message,
        personas,
        client,
        null,
        fixture.triggerContext.isReplyToBot,
        null,
        fixture.triggerContext.isBotMentioned,
        fixture.triggerContext.isAutoMsgHit,
        fixture.triggerContext.isAlwaysReply,
        fixture.triggerContext.autoTriggerPersonaId,
        fixture.triggerContext.alwaysReplyFallbackPersonaId,
        fixture.triggerContext.deliberateTriggerMode,
        fixture.triggerContext.isAutochatDtmExemptChannel,
        null,
      ).map((persona) => persona.persona_nickname),
    ).toEqual(["Quetz"]);
    expect(shouldBotReply(message, mainPersona, personas, { referencedMessage: null })).toBe(true);
  });

  it("does not treat a diacritic letter as a word boundary around a trigger word", () => {
    const client = makeClient();
    // Boundary semantics live in tests/unit/text/regexUtils.test.ts; this pins that persona
    // routing consumes them, so a trigger buried in an unrelated word admits no persona.
    const triggerWord = "lex";
    const wordContainingTrigger = `prä${triggerWord}`;
    const fixture: ConversationFixture = {
      id: "diacritic-word-boundary",
      provider: "google",
      description: "an accented letter must not fake a word boundary next to a trigger substring",
      message: {
        authorId: "user_diacritic_trigger",
        authorName: "Diacritic User",
        content: `this message only contains the unrelated word ${wordContainingTrigger}`,
        mentionedUserIds: [],
      },
      state: {
        deliberateTriggerMode: false,
        alwaysReplyEnabled: false,
        autochDiscIds: [],
        autochPersonaOverrides: [],
        autochCounter: 0,
        autochNextTarget: 0,
      },
      personas: [
        {
          id: 1,
          nickname: "Tomori",
          isAlter: false,
          triggers: ["tomori"],
        },
        {
          id: 2,
          nickname: "Placeholder",
          isAlter: true,
          triggers: [triggerWord],
        },
      ],
      triggerContext: {
        isReplyToBot: false,
        replyPersonaId: null,
        isBotMentioned: false,
        isAutoMsgHit: false,
        isAlwaysReply: false,
        autoTriggerPersonaId: null,
        alwaysReplyFallbackPersonaId: null,
        deliberateTriggerMode: false,
        isAutochatDtmExemptChannel: false,
        allowedPersonaIds: null,
      },
    };
    const message = makeMessage(fixture, client);
    const personas = fixture.personas.map((persona) => makeTomoriState(fixture, persona));

    expect(
      determineMatchingPersonas(
        message,
        personas,
        client,
        null,
        fixture.triggerContext.isReplyToBot,
        null,
        fixture.triggerContext.isBotMentioned,
        fixture.triggerContext.isAutoMsgHit,
        fixture.triggerContext.isAlwaysReply,
        fixture.triggerContext.autoTriggerPersonaId,
        fixture.triggerContext.alwaysReplyFallbackPersonaId,
        fixture.triggerContext.deliberateTriggerMode,
        fixture.triggerContext.isAutochatDtmExemptChannel,
        null,
      ).map((persona) => persona.persona_nickname),
    ).toEqual([]);
  });

  it("acquireChannelLockForTurn sets isLocked and releaseChannelLockAndReplayQueue clears it", () => {
    const lockEntry = getOrCreateChannelLockEntry(channelId, guildId);

    acquireChannelLockForTurn(lockEntry, {
      messageId: "lock_lifecycle_msg",
      userDiscId: "user_lifecycle",
      isPersonaJob: false,
      isCommandTriggered: false,
    });

    expect(lockEntry.isLocked).toBe(true);

    releaseChannelLockAndReplayQueue({
      channelId,
      lockEntry,
      completedMessageId: "lock_lifecycle_msg",
      handleStopResponse: async () => {},
      processQueuedMessage: async () => {},
    });

    expect(lockEntry.isLocked).toBe(false);
  });

  it("enqueueBusyChannelMessage followed by lock release replays the queued message", async () => {
    const client = makeClient();
    const fixture = conversations[0];
    const activeMessage = makeMessage(fixture, client);
    const queuedMessage = makeMessage(
      {
        ...fixture,
        id: "queued_lifecycle",
        message: {
          ...fixture.message,
          content: "Tomori, queued lifecycle check",
        },
      },
      client,
    );
    const processedMessageIds: string[] = [];
    const lockEntry = getOrCreateChannelLockEntry(channelId, guildId);
    acquireChannelLockForTurn(lockEntry, {
      messageId: activeMessage.id,
      userDiscId: activeMessage.author.id,
      isPersonaJob: false,
      isCommandTriggered: false,
    });

    enqueueBusyChannelMessage({
      lockEntry,
      channelId,
      simulatedAutochatCounterReset: false,
      queuedMessage: {
        message: queuedMessage,
        textQuotaSource: "user",
      },
    });

    releaseChannelLockAndReplayQueue({
      channelId,
      lockEntry,
      completedMessageId: activeMessage.id,
      handleStopResponse: async () => {},
      processQueuedMessage: async (queued) => {
        processedMessageIds.push(queued.message.id);
      },
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(processedMessageIds).toEqual([queuedMessage.id]);
  });

  it("queues a manual user impersonation in FIFO and replays its incoming target", async () => {
    const client = makeClient();
    const fixture = conversations[0];
    const activeMessage = makeMessage(fixture, client);
    const queuedMessage = makeMessage(
      {
        ...fixture,
        id: "queued_user_impersonation",
        message: {
          ...fixture.message,
          authorBot: true,
          content: "latest channel message",
        },
      },
      client,
    );
    const targetUserId = "target_user_001";
    const tomoriState = makeTomoriState(fixture, {
      id: 1001,
      nickname: "Tomori",
      isAlter: false,
      triggers: ["tomori"],
    });
    const incoming: ChatIncoming = {
      client,
      message: queuedMessage,
      isFromQueue: false,
      isManuallyTriggered: true,
      retryCount: 0,
      skipLock: false,
      isPersonaJob: false,
      isUserImpersonation: true,
      impersonatedUserId: targetUserId,
      textQuotaSource: "user",
      manualTriggerInvoker: {
        userDiscId: activeMessage.author.id,
        username: "Mirri",
      },
    };
    const lockEntry = getOrCreateChannelLockEntry(channelId, guildId);
    acquireChannelLockForTurn(lockEntry, {
      messageId: activeMessage.id,
      userDiscId: activeMessage.author.id,
      isPersonaJob: false,
      isCommandTriggered: false,
    });
    // The fixture always carries an id, but TomoriState types it optional.
    const personaId = tomoriState.persona_id;
    if (personaId === undefined) throw new Error("Fixture persona is missing a persona_id");

    setActiveChannelTurnState(lockEntry, {
      activePersonaId: personaId,
      triggeredPersonaIds: [personaId],
      followUpEligible: true,
      isUserImpersonation: false,
    });

    const disposition = await evaluateAdmissionQueueAndTriggerGate({
      incoming,
      channelScope: {
        guild: null,
        serverDiscId: guildId,
        isDMChannel: false,
      },
      earlyTomoriState: tomoriState,
      earlyAllPersonas: [tomoriState],
      userDiscId: activeMessage.author.id,
      cooldownUserDiscId: activeMessage.author.id,
      isActiveNaturalStopMessage: false,
      isNaturalStopMessage: false,
      referencedMessage: null,
    });

    expect(disposition?.disposition).toBe("queued");
    expect(disposition?.reason).toBe("locked_busy_queued");
    expect(lockEntry.messageQueue).toHaveLength(1);
    expect(lockEntry.messageQueue[0]).toMatchObject({
      isUserImpersonation: true,
      impersonatedUserId: targetUserId,
      isManuallyTriggered: true,
    });

    const replayedTargets: string[] = [];
    releaseChannelLockAndReplayQueue({
      channelId,
      lockEntry,
      completedMessageId: activeMessage.id,
      handleStopResponse: async () => {},
      processQueuedMessage: async (queued) => {
        if (queued.isUserImpersonation && queued.impersonatedUserId) {
          replayedTargets.push(queued.impersonatedUserId);
        }
      },
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(replayedTargets).toEqual([targetUserId]);
  });

  it("reports accepted live follow-ups as queued and keeps incoming impersonation metadata", async () => {
    const client = makeClient();
    const fixture = conversations[0];
    const activeMessage = makeMessage(fixture, client);
    const followUpMessage = makeMessage(
      {
        ...fixture,
        id: "eligible_follow_up_impersonation",
        message: {
          ...fixture.message,
          content: "Tomori, continue",
        },
      },
      client,
    );
    const targetUserId = "follow_up_target_001";
    const tomoriState = makeTomoriState(fixture, {
      id: 1001,
      nickname: "Tomori",
      isAlter: false,
      triggers: ["tomori"],
    });
    const incoming: ChatIncoming = {
      client,
      message: followUpMessage,
      isFromQueue: false,
      retryCount: 0,
      skipLock: false,
      isPersonaJob: false,
      isUserImpersonation: true,
      impersonatedUserId: targetUserId,
      textQuotaSource: "user",
    };
    const lockEntry = getOrCreateChannelLockEntry(channelId, guildId);
    acquireChannelLockForTurn(lockEntry, {
      messageId: activeMessage.id,
      userDiscId: activeMessage.author.id,
      isPersonaJob: false,
      isCommandTriggered: false,
    });
    // The fixture always carries an id, but TomoriState types it optional.
    const personaId = tomoriState.persona_id;
    if (personaId === undefined) throw new Error("Fixture persona is missing a persona_id");

    setActiveChannelTurnState(lockEntry, {
      activePersonaId: personaId,
      triggeredPersonaIds: [personaId],
      followUpEligible: true,
      isUserImpersonation: false,
    });

    const disposition = await evaluateAdmissionQueueAndTriggerGate({
      incoming,
      channelScope: {
        guild: null,
        serverDiscId: guildId,
        isDMChannel: false,
      },
      earlyTomoriState: tomoriState,
      earlyAllPersonas: [tomoriState],
      userDiscId: activeMessage.author.id,
      cooldownUserDiscId: activeMessage.author.id,
      isActiveNaturalStopMessage: false,
      isNaturalStopMessage: false,
      referencedMessage: null,
    });

    expect(disposition?.disposition).toBe("queued");
    expect(disposition?.reason).toBe("locked_follow_up_queued");
    expect(lockEntry.messageQueue[0]).toMatchObject({
      followUpUserDiscId: activeMessage.author.id,
      isUserImpersonation: true,
      impersonatedUserId: targetUserId,
    });
  });

  it("notifies queued message discard handlers when the channel queue is cleared", async () => {
    const client = makeClient();
    const fixture = conversations[0];
    const queuedMessage = makeMessage(fixture, client);
    const discardedReasons: string[] = [];
    const lockEntry = getOrCreateChannelLockEntry(channelId, guildId);

    enqueueBusyChannelMessage({
      lockEntry,
      channelId,
      simulatedAutochatCounterReset: false,
      queuedMessage: {
        message: queuedMessage,
        textQuotaSource: "system",
        onQueueDiscard: (reason) => {
          discardedReasons.push(reason);
        },
      },
    });

    expect(clearChannelProcessingQueue(channelId)).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(discardedReasons).toEqual(["channel_queue_cleared"]);
  });

  it("does not queue same-user follow-ups while a hard stop is pending", async () => {
    const client = makeClient();
    const fixture = conversations[0];
    const message = makeMessage(
      {
        ...fixture,
        id: "post_kill_follow_up",
        message: {
          ...fixture.message,
          content: "Tomori, are you still there?",
          mentionedUserIds: [],
        },
      },
      client,
    );
    const tomoriState = makeTomoriState(fixture, {
      id: 1001,
      nickname: "Tomori",
      isAlter: false,
      triggers: ["tomori"],
    });
    const incoming: ChatIncoming = {
      client,
      message,
      isFromQueue: false,
      retryCount: 0,
      skipLock: false,
      isPersonaJob: false,
      isUserImpersonation: false,
      textQuotaSource: "user",
    };
    const lockEntry = getOrCreateChannelLockEntry(channelId, guildId);
    acquireChannelLockForTurn(lockEntry, {
      messageId: "active_before_kill",
      userDiscId: message.author.id,
      isPersonaJob: false,
      isCommandTriggered: false,
    });
    // The fixture always carries an id, but TomoriState types it optional.
    const personaId = tomoriState.persona_id;
    if (personaId === undefined) throw new Error("Fixture persona is missing a persona_id");

    setActiveChannelTurnState(lockEntry, {
      activePersonaId: personaId,
      triggeredPersonaIds: [personaId],
      followUpEligible: true,
    });
    StreamOrchestrator.requestStop(channelId, message.author.id);

    const disposition = await evaluateAdmissionQueueAndTriggerGate({
      incoming,
      channelScope: {
        guild: null,
        serverDiscId: guildId,
        isDMChannel: false,
      },
      earlyTomoriState: tomoriState,
      earlyAllPersonas: [tomoriState],
      userDiscId: message.author.id,
      cooldownUserDiscId: message.author.id,
      isActiveNaturalStopMessage: false,
      isNaturalStopMessage: false,
      referencedMessage: null,
    });

    expect(disposition?.disposition).toBe("ignore");
    expect(disposition?.reason).toBe("locked_stop_requested");
    expect(lockEntry.messageQueue).toHaveLength(0);
  });

  it("treats /kill stream aborts as stopped_by_user and clears the stop request", async () => {
    const client = makeClient();
    const fixture = conversations[0];
    const message = makeMessage(fixture, client);
    const tomoriState = makeTomoriState(fixture, {
      id: 1001,
      nickname: "Tomori",
      isAlter: false,
      triggers: ["tomori"],
    });
    const lockEntry = getOrCreateChannelLockEntry(channelId, guildId);
    acquireChannelLockForTurn(lockEntry, {
      messageId: message.id,
      userDiscId: message.author.id,
      isPersonaJob: false,
      isCommandTriggered: false,
    });
    const provider = {
      streamToDiscord: () => new Promise<StreamResult>(() => {}),
    } as unknown as LLMProvider;
    const context = {
      turn: {
        lockedTurn: {
          admission: {
            incoming: {},
          },
        },
      },
      client,
      message,
      channel: message.channel,
      isFromQueue: false,
      streamingContext: {
        suppressUserErrors: true,
      },
      currentPersona: tomoriState,
      isUserImpersonation: false,
      contextItems: [],
      expressionDelivery: createExpressionDeliveryState(),
    } as unknown as ChatTurnContext;

    const resultPromise = runToolLoop({
      context,
      provider,
      providerConfig: {
        model: "test",
        apiKey: "test",
        temperature: 0,
      },
      tomoriState,
    });

    StreamOrchestrator.requestStop(channelId, message.author.id);
    expect(forceKillChannelStream(channelId)).toBe(true);

    const result = await resultPromise;

    expect(result.status).toBe("stopped_by_user");
    expect(StreamOrchestrator.hasStopRequest(channelId)).toBe(false);
  });

  it("clears a /kill that aborts the turn at a tool call so the next turn is not pre-stream aborted", async () => {
    const client = makeClient();
    const fixture = conversations[0];
    const message = makeMessage(fixture, client);
    const tomoriState = makeTomoriState(fixture, {
      id: 1001,
      nickname: "Tomori",
      isAlter: false,
      triggers: ["tomori"],
    });
    const lockEntry = getOrCreateChannelLockEntry(channelId, guildId);
    acquireChannelLockForTurn(lockEntry, {
      messageId: message.id,
      userDiscId: message.author.id,
      isPersonaJob: false,
      isCommandTriggered: false,
    });
    const provider = {
      streamToDiscord: async (): Promise<StreamResult> => {
        StreamOrchestrator.requestStop(channelId, message.author.id);
        return { status: "function_call", data: { name: "generate_image", args: {} } } as StreamResult;
      },
    } as unknown as LLMProvider;
    const context = {
      turn: {
        lockedTurn: {
          channelId,
          admission: {
            incoming: {},
          },
        },
      },
      client,
      message,
      channel: message.channel,
      isFromQueue: false,
      streamingContext: {
        suppressUserErrors: true,
      },
      currentPersona: tomoriState,
      isUserImpersonation: false,
      contextItems: [],
      expressionDelivery: createExpressionDeliveryState(),
    } as unknown as ChatTurnContext;

    const result = await runToolLoop({
      context,
      provider,
      providerConfig: {
        model: "test",
        apiKey: "test",
        temperature: 0,
      },
      tomoriState,
    });

    expect(result.status).toBe("stopped_by_user");
    expect(StreamOrchestrator.hasStopRequest(channelId)).toBe(false);
  });

  it("exposes the executing tool name to /kill and clears it once the tool call settles", async () => {
    const client = makeClient();
    const fixture = conversations[0];
    const message = makeMessage(fixture, client);
    const tomoriState = makeTomoriState(fixture, {
      id: 1001,
      nickname: "Tomori",
      isAlter: false,
      triggers: ["tomori"],
    });
    const lockEntry = getOrCreateChannelLockEntry(channelId, guildId);
    acquireChannelLockForTurn(lockEntry, {
      messageId: message.id,
      userDiscId: message.author.id,
      isPersonaJob: false,
      isCommandTriggered: false,
    });
    let toolNameDuringExecution: string | undefined;
    const executeToolSpy = spyOn(ToolRegistry, "executeTool").mockImplementation(async () => {
      toolNameDuringExecution = getChannelActiveToolName(channelId);
      StreamOrchestrator.requestStop(channelId, message.author.id);
      return { success: false, error: "killed" };
    });
    const provider = {
      streamToDiscord: async (): Promise<StreamResult> =>
        ({ status: "function_call", data: { name: "generate_image", args: {} } }) as StreamResult,
      getInfo: () => ({ name: "google" }),
    } as unknown as LLMProvider;
    const context = {
      turn: { lockedTurn: { channelId, admission: { incoming: {} } } },
      client,
      message,
      channel: message.channel,
      isFromQueue: false,
      streamingContext: { suppressUserErrors: true },
      currentPersona: tomoriState,
      isUserImpersonation: false,
      contextItems: [],
      expressionDelivery: createExpressionDeliveryState(),
    } as unknown as ChatTurnContext;

    try {
      const result = await runToolLoop({
        context,
        provider,
        providerConfig: { model: "test", apiKey: "test", temperature: 0 },
        tomoriState,
      });

      expect(result.status).toBe("stopped_by_user");
      expect(toolNameDuringExecution).toBe("generate_image");
      expect(getChannelActiveToolName(channelId)).toBeUndefined();
    } finally {
      executeToolSpy.mockRestore();
    }
  });

  it("releaseChannelLockAndReplayQueue drops a stop request that has no stop context", () => {
    const lockEntry = getOrCreateChannelLockEntry(channelId, guildId);
    acquireChannelLockForTurn(lockEntry, {
      messageId: "stale_stop_msg",
      userDiscId: "user_stale_stop",
      isPersonaJob: false,
      isCommandTriggered: false,
    });
    StreamOrchestrator.requestStop(channelId, "user_stale_stop");

    releaseChannelLockAndReplayQueue({
      channelId,
      lockEntry,
      completedMessageId: "stale_stop_msg",
      handleStopResponse: async () => {},
      processQueuedMessage: async () => {},
    });

    expect(StreamOrchestrator.hasStopRequest(channelId)).toBe(false);
  });

  it("pre-lock admission ignores non-triggering messages without locking the channel", async () => {
    const client = makeClient();
    const fixture = conversations[0];
    const message = makeMessage(
      {
        ...fixture,
        id: "pre_lock_non_trigger",
        message: {
          ...fixture.message,
          content: "just passing through with no trigger",
          mentionedUserIds: [],
        },
        state: {
          ...fixture.state,
          alwaysReplyEnabled: false,
          autochDiscIds: [],
          autochCounter: 0,
          autochNextTarget: 10,
        },
      },
      client,
    );
    const earlyTomoriState = makeTomoriState(
      {
        ...fixture,
        state: {
          ...fixture.state,
          alwaysReplyEnabled: false,
          autochDiscIds: [],
          autochCounter: 0,
          autochNextTarget: 10,
        },
      },
      {
        id: 1001,
        nickname: "Tomori",
        isAlter: false,
        triggers: ["tomori"],
      },
    );
    earlyTomoriState.config.thought_log_channel_disc_id = null;
    const incoming: ChatIncoming = {
      client,
      message,
      isFromQueue: false,
      retryCount: 0,
      skipLock: false,
      isPersonaJob: false,
      isUserImpersonation: false,
      textQuotaSource: "user",
    };

    const disposition = await evaluateAdmissionQueueAndTriggerGate({
      incoming,
      channelScope: {
        guild: null,
        serverDiscId: guildId,
        isDMChannel: false,
      },
      earlyTomoriState,
      earlyAllPersonas: [earlyTomoriState],
      userDiscId: message.author.id,
      cooldownUserDiscId: message.author.id,
      isActiveNaturalStopMessage: false,
      isNaturalStopMessage: false,
      referencedMessage: null,
    });

    expect(disposition?.disposition).toBe("ignore");
    expect(disposition?.reason).toBe("non_trigger_pre_lock");
    expect(channelLocks.get(channelId)?.isLocked).not.toBe(true);
  });

  it("admits a reply to Tomori whose target is no longer in the message cache", async () => {
    const client = makeClient();
    const fixture = conversations[0];
    const stateFixture = {
      ...fixture,
      state: {
        ...fixture.state,
        alwaysReplyEnabled: false,
        autochDiscIds: [],
        autochCounter: 0,
        autochNextTarget: 10,
      },
    };
    const message = makeMessage(
      {
        ...stateFixture,
        id: "reply_to_evicted_tomori_message",
        message: { ...fixture.message, content: "what did you mean by that?", mentionedUserIds: [] },
      },
      client,
    );
    const tomoriReply = { id: "evicted_tomori_reply", author: { id: botUserId }, webhookId: null } as Message;
    Object.assign(message, { reference: { messageId: tomoriReply.id } });
    expect(message.channel.messages.cache.get(tomoriReply.id)).toBeUndefined();

    const earlyTomoriState = makeTomoriState(stateFixture, {
      id: 1001,
      nickname: "Tomori",
      isAlter: false,
      triggers: ["tomori"],
    });
    earlyTomoriState.config.thought_log_channel_disc_id = null;

    const disposition = await evaluateAdmissionQueueAndTriggerGate({
      incoming: {
        client,
        message,
        isFromQueue: false,
        retryCount: 0,
        skipLock: false,
        isPersonaJob: false,
        isUserImpersonation: false,
        textQuotaSource: "user",
      },
      channelScope: { guild: null, serverDiscId: guildId, isDMChannel: false },
      earlyTomoriState,
      earlyAllPersonas: [earlyTomoriState],
      userDiscId: message.author.id,
      cooldownUserDiscId: message.author.id,
      isActiveNaturalStopMessage: false,
      isNaturalStopMessage: false,
      referencedMessage: tomoriReply,
    });

    expect(disposition).toBeNull();
  });

  it("uses the attested original for a proxy repost trigger decision", async () => {
    const client = makeClient();
    const fixture = conversations[0];
    const stateFixture = {
      ...fixture,
      state: {
        ...fixture.state,
        alwaysReplyEnabled: false,
        autochDiscIds: [],
        autochCounter: 0,
        autochNextTarget: 10,
      },
    };
    const original = makeMessage(
      {
        ...stateFixture,
        id: "proxy_original_mention",
        message: {
          ...stateFixture.message,
          content: "hello",
          mentionedUserIds: [botUserId],
          webhookId: null,
        },
      },
      client,
    );
    const repost = makeMessage(
      {
        ...stateFixture,
        id: "proxy_repost_without_mention",
        message: {
          ...stateFixture.message,
          content: "hello",
          mentionedUserIds: [],
          webhookId: "proxy-webhook",
        },
      },
      client,
    );
    const earlyTomoriState = makeTomoriState(stateFixture, {
      id: 1001,
      nickname: "Tomori",
      isAlter: false,
      triggers: ["tomori"],
    });
    earlyTomoriState.config.thought_log_channel_disc_id = null;

    const disposition = await evaluateAdmissionQueueAndTriggerGate({
      incoming: {
        client,
        message: repost,
        isFromQueue: false,
        retryCount: 0,
        skipLock: false,
        isPersonaJob: false,
        isUserImpersonation: false,
        textQuotaSource: "user",
      },
      channelScope: { guild: null, serverDiscId: guildId, isDMChannel: false },
      earlyTomoriState,
      earlyAllPersonas: [earlyTomoriState],
      userDiscId: original.author.id,
      cooldownUserDiscId: original.author.id,
      isActiveNaturalStopMessage: false,
      isNaturalStopMessage: false,
      referencedMessage: null,
      messageProxyRecord: await confirmProxyRepost({ original, repost, hostDiscId: original.author.id }),
    });

    expect(disposition).toBeNull();
  });

  it("does not let repost-only trigger text replace the original verdict", async () => {
    const client = makeClient();
    const fixture = conversations[0];
    const stateFixture = {
      ...fixture,
      state: {
        ...fixture.state,
        alwaysReplyEnabled: false,
        autochDiscIds: [],
        autochCounter: 0,
        autochNextTarget: 10,
      },
    };
    const original = makeMessage(
      {
        ...stateFixture,
        id: "proxy_original_without_trigger",
        message: {
          ...stateFixture.message,
          content: "hello",
          mentionedUserIds: [],
          webhookId: null,
        },
      },
      client,
    );
    const repost = makeMessage(
      {
        ...stateFixture,
        id: "proxy_repost_with_trigger",
        message: {
          ...stateFixture.message,
          content: "tomori",
          mentionedUserIds: [botUserId],
          webhookId: "proxy-webhook",
        },
      },
      client,
    );
    const earlyTomoriState = makeTomoriState(stateFixture, {
      id: 1001,
      nickname: "Tomori",
      isAlter: false,
      triggers: ["tomori"],
    });
    earlyTomoriState.config.thought_log_channel_disc_id = null;

    const disposition = await evaluateAdmissionQueueAndTriggerGate({
      incoming: {
        client,
        message: repost,
        isFromQueue: false,
        retryCount: 0,
        skipLock: false,
        isPersonaJob: false,
        isUserImpersonation: false,
        textQuotaSource: "user",
      },
      channelScope: { guild: null, serverDiscId: guildId, isDMChannel: false },
      earlyTomoriState,
      earlyAllPersonas: [earlyTomoriState],
      userDiscId: original.author.id,
      cooldownUserDiscId: original.author.id,
      isActiveNaturalStopMessage: false,
      isNaturalStopMessage: false,
      referencedMessage: null,
      messageProxyRecord: await confirmProxyRepost({ original, repost, hostDiscId: original.author.id }),
    });

    expect(disposition?.reason).toBe("non_trigger_pre_lock");
  });

  describe("verified proxy follow-ups", () => {
    const fixture = {
      ...conversations[0],
      state: {
        ...conversations[0].state,
        alwaysReplyEnabled: false,
        autochDiscIds: [],
        autochCounter: 0,
        autochNextTarget: 10,
      },
    };
    const hostDiscId = fixture.message.authorId;
    const personaId = 1001;

    function makeProxyPair(
      client: Client,
      suffix: string,
      originalMentionsBot = false,
      repostMentionsBot = false,
    ): { original: Message; repost: Message } {
      const content = "and one more thing";
      return {
        original: makeMessage(
          {
            ...fixture,
            id: `proxy_original_${suffix}`,
            message: { ...fixture.message, content, mentionedUserIds: originalMentionsBot ? [botUserId] : [] },
          },
          client,
        ),
        repost: makeMessage(
          {
            ...fixture,
            id: `proxy_repost_${suffix}`,
            message: {
              ...fixture.message,
              authorId: "pk_webhook_author",
              authorName: "Mirri",
              authorBot: true,
              content,
              mentionedUserIds: repostMentionsBot ? [botUserId] : [],
              webhookId: "pk-webhook",
            },
          },
          client,
        ),
      };
    }

    function lockHostTurn(activeMessageId = "active_host_turn") {
      const lockEntry = getOrCreateChannelLockEntry(channelId, guildId);
      acquireChannelLockForTurn(lockEntry, {
        messageId: activeMessageId,
        userDiscId: hostDiscId,
        isPersonaJob: false,
        isCommandTriggered: false,
      });
      setActiveChannelTurnState(lockEntry, {
        activePersonaId: personaId,
        triggeredPersonaIds: [personaId],
        followUpEligible: true,
      });
      return lockEntry;
    }

    async function admitProxyMessage(
      client: Client,
      message: Message,
      args: { userDiscId: string; messageProxyRecord?: MessageProxyMessageRecord },
    ) {
      const tomoriState = makeTomoriState(fixture, { id: personaId, nickname: "Tomori", isAlter: false, triggers: [] });
      tomoriState.config.thought_log_channel_disc_id = null;
      return await evaluateAdmissionQueueAndTriggerGate({
        incoming: {
          client,
          message,
          isFromQueue: false,
          retryCount: 0,
          skipLock: false,
          isPersonaJob: false,
          isUserImpersonation: false,
          textQuotaSource: "user",
        },
        channelScope: { guild: null, serverDiscId: guildId, isDMChannel: false },
        earlyTomoriState: tomoriState,
        earlyAllPersonas: [tomoriState],
        userDiscId: args.userDiscId,
        cooldownUserDiscId: args.userDiscId,
        isActiveNaturalStopMessage: false,
        isNaturalStopMessage: false,
        referencedMessage: null,
        messageProxyRecord: args.messageProxyRecord,
      });
    }

    it("interrupts a member's reply with a repost from that same member", async () => {
      const client = makeClient();
      const active = makeProxyPair(client, "active_same_member");
      const { original, repost } = makeProxyPair(client, "same_host");
      await confirmProxyRepost({ ...active, hostDiscId });
      const lockEntry = lockHostTurn(active.repost.id);

      const disposition = await admitProxyMessage(client, repost, {
        userDiscId: hostDiscId,
        messageProxyRecord: await confirmProxyRepost({ original, repost, hostDiscId }),
      });

      expect(disposition?.reason).toBe("locked_follow_up_queued");
      expect(StreamOrchestrator.isFollowUpRequest(channelId)).toBe(true);
      expect(lockEntry.messageQueue).toHaveLength(1);
      expect(lockEntry.messageQueue[0]).toMatchObject({
        message: repost,
        followUpUserDiscId: hostDiscId,
        textQuotaUserDiscId: hostDiscId,
        selectedPersonaId: personaId,
      });

      const replayed: Message[] = [];
      releaseChannelLockAndReplayQueue({
        channelId,
        lockEntry,
        completedMessageId: "active_host_turn",
        handleStopResponse: async () => {},
        processQueuedMessage: async (queued) => {
          replayed.push(queued.message);
        },
      });
      await new Promise((resolve) => setImmediate(resolve));

      // Replay re-admits the webhook message itself, so the member keeps the conversational
      // identity while the confirmed record still resolves the speaker to the host account.
      expect(replayed).toEqual([repost]);
      expect(getMessageProxyMessageRecord(repost.id)?.senderDiscId).toBe(hostDiscId);
    });

    it("keeps only the member's latest repost during a tool chain without interrupting", async () => {
      const client = makeClient();
      const active = makeProxyPair(client, "active_tool_chain");
      const first = makeProxyPair(client, "tool_chain_first");
      const second = makeProxyPair(client, "tool_chain_second");
      await confirmProxyRepost({ ...active, hostDiscId });
      const lockEntry = lockHostTurn(active.repost.id);
      setChannelToolCallChainActive(lockEntry, true);

      for (const pair of [first, second]) {
        const disposition = await admitProxyMessage(client, pair.repost, {
          userDiscId: hostDiscId,
          messageProxyRecord: await confirmProxyRepost({ ...pair, hostDiscId }),
        });
        expect(disposition?.reason).toBe("locked_follow_up_queued");
      }

      expect(StreamOrchestrator.isFollowUpRequest(channelId)).toBe(false);
      expect(lockEntry.messageQueue.map((queued) => queued.message)).toEqual([second.repost]);
    });

    it("queues a different member of the same host as a separate trigger", async () => {
      const client = makeClient();
      const active = makeProxyPair(client, "active_other_member");
      const next = makeProxyPair(client, "other_member", true);
      await confirmProxyRepost({ ...active, hostDiscId });
      const lockEntry = lockHostTurn(active.repost.id);
      const disposition = await admitProxyMessage(client, next.repost, {
        userDiscId: hostDiscId,
        messageProxyRecord: await confirmProxyRepost({
          ...next,
          hostDiscId,
          memberUserDiscId: "pk:bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        }),
      });

      expect(disposition?.reason).toBe("locked_busy_queued");
      expect(StreamOrchestrator.isFollowUpRequest(channelId)).toBe(false);
      expect(lockEntry.messageQueue.map((queued) => queued.message)).toEqual([next.repost]);
      expect(lockEntry.messageQueue[0]?.followUpUserDiscId).toBeUndefined();
    });

    it("queues a member's repost while the host's unproxied turn is active", async () => {
      const client = makeClient();
      const next = makeProxyPair(client, "after_unproxied_host", true);
      const lockEntry = lockHostTurn();
      const disposition = await admitProxyMessage(client, next.repost, {
        userDiscId: hostDiscId,
        messageProxyRecord: await confirmProxyRepost({ ...next, hostDiscId }),
      });

      expect(disposition?.reason).toBe("locked_busy_queued");
      expect(StreamOrchestrator.isFollowUpRequest(channelId)).toBe(false);
      expect(lockEntry.messageQueue.map((queued) => queued.message)).toEqual([next.repost]);
    });

    it("does not let another host's verified repost interrupt", async () => {
      const client = makeClient();
      const { original, repost } = makeProxyPair(client, "other_host");
      const otherHostDiscId = "other_host_001";
      const lockEntry = lockHostTurn();

      const disposition = await admitProxyMessage(client, repost, {
        userDiscId: otherHostDiscId,
        messageProxyRecord: await confirmProxyRepost({ original, repost, hostDiscId: otherHostDiscId }),
      });

      expect(disposition?.reason).toBe("locked_non_trigger");
      expect(StreamOrchestrator.isFollowUpRequest(channelId)).toBe(false);
      expect(lockEntry.messageQueue).toHaveLength(0);
    });

    it("does not let an unverified webhook interrupt even when keyed to the host", async () => {
      const client = makeClient();
      const { repost } = makeProxyPair(client, "unverified");
      const lockEntry = lockHostTurn();

      const disposition = await admitProxyMessage(client, repost, { userDiscId: hostDiscId });

      expect(disposition?.reason).toBe("locked_non_trigger");
      expect(StreamOrchestrator.isFollowUpRequest(channelId)).toBe(false);
      expect(lockEntry.messageQueue).toHaveLength(0);
    });

    it("ignores a triggering late repost while the original's reply holds the lock", async () => {
      const client = makeClient();
      const { original, repost } = makeProxyPair(client, "original_ran_locked", true, true);
      const lockEntry = lockHostTurn();
      const messageProxyRecord = await confirmProxyRepost({ original, repost, hostDiscId, originalRan: true });
      expect(messageProxyRecord.originalSuppressed).toBe(false);

      const disposition = await admitProxyMessage(client, repost, {
        userDiscId: hostDiscId,
        messageProxyRecord,
      });

      expect(disposition?.reason).toBe("proxy_original_already_processed");
      expect(StreamOrchestrator.isFollowUpRequest(channelId)).toBe(false);
      expect(lockEntry.messageQueue).toHaveLength(0);
    });

    it("ignores a triggering late repost after the original's reply releases the lock", async () => {
      const client = makeClient();
      const { original, repost } = makeProxyPair(client, "original_ran_idle", true, true);
      const messageProxyRecord = await confirmProxyRepost({ original, repost, hostDiscId, originalRan: true });
      expect(messageProxyRecord.originalSuppressed).toBe(false);
      const disposition = await admitProxyMessage(client, repost, {
        userDiscId: hostDiscId,
        messageProxyRecord,
      });

      expect(disposition?.reason).toBe("proxy_original_already_processed");
      expect(getOrCreateChannelLockEntry(channelId, guildId).messageQueue).toHaveLength(0);
      expect(StreamOrchestrator.isFollowUpRequest(channelId)).toBe(false);
    });
  });

  it.skip("[REGRESSION PROBE] fails when a fixture expectation is deliberately inverted", () => {
    const googleFixture = conversations.find((fixture) => fixture.id === "google-direct-mention-main");
    if (!googleFixture) {
      throw new Error("Missing google-direct-mention-main fixture");
    }

    const client = makeClient();
    const message = makeMessage(googleFixture, client);
    const personas = googleFixture.personas.map((persona) => makeTomoriState(googleFixture, persona));
    const mainPersona = personas.find((persona) => !persona.is_alter);

    if (!mainPersona) {
      throw new Error("Probe fixture is missing a main persona");
    }

    expect(shouldBotReply(message, mainPersona, personas, { referencedMessage: null })).toBe(false);
  });
});
