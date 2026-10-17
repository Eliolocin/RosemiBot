import type { Message } from "discord.js";
import type { MessageProxyInstanceContext } from "@/utils/messageProxy/instances";
import type { ProxyMessageAttestation } from "@/utils/messageProxy/types";
import { log } from "@/utils/misc/logger";

type MessageProxyExpectationState = "pending" | "proxied";
export type MessageProxyWaitResult = "timeout" | "proxied";

type TimerHandle = ReturnType<typeof setTimeout>;

export interface MessageProxyExpectation {
  serviceId: string;
  instance: MessageProxyInstanceContext;
  channelId: string;
  originalMessageId: string;
  senderDiscId: string;
  state: MessageProxyExpectationState;
  createdAt: number;
  expiresAt: number;
  originalMessage: Message;
  originalReference: Message["reference"];
}

interface InternalMessageProxyExpectation extends MessageProxyExpectation {
  waitPromise: Promise<MessageProxyWaitResult>;
  waitResult: MessageProxyWaitResult | null;
  waitDeadline: number;
  waitTimer: TimerHandle | null;
  ttlTimer: TimerHandle | null;
  resolveWait: (result: MessageProxyWaitResult) => void;
}

export interface MessageProxyMessageRecord {
  serviceId: string;
  instanceId: string;
  instance: MessageProxyInstanceContext;
  messageDiscId: string;
  channelId: string;
  originalMessageId: string | null;
  senderDiscId: string;
  createdAt: number;
  expiresAt: number;
  originalMessage: Message | null;
  originalReference: Message["reference"] | null;
  /** Stable speaker ID from the attestation, used while the channel turn holds its lock. */
  identityUserDiscId: string | null;
  /**
   * Whether the original was still held by its speedbump when this repost was confirmed, so the
   * repost is the only admitted copy. False for a late PluralBuddy repost whose original already
   * ran, which must not be admitted as a second follow-up of the same message.
   */
  originalSuppressed: boolean;
}

interface InternalMessageProxyMessageRecord extends MessageProxyMessageRecord {
  ttlTimer: TimerHandle | null;
}

function parseIntegerEnv(value: string | undefined, defaultValue: number, minimum: number): number {
  if (typeof value !== "string") return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return Math.max(parsed, minimum);
}

// Timing envs are read lazily (per use, not at module load) so import order
// never bakes stale values in: chat modules pull this file in transitively,
// which would otherwise freeze defaults before test files can set overrides.
export function getMessageProxyWaitMs(): number {
  return parseIntegerEnv(process.env.MESSAGE_PROXY_WAIT_MS, 2000, 0);
}

export function getMessageProxyExpectationTtlMs(): number {
  return parseIntegerEnv(process.env.MESSAGE_PROXY_EXPECTATION_TTL_MS, 10000, Math.max(getMessageProxyWaitMs(), 1));
}

/**
 * Capped at half the expectation TTL: the router pairs the attestation with its
 * expectation only after the lookup returns, so a longer budget lets it expire mid-lookup.
 */
export function getMessageProxyLookupTimeoutMs(): number {
  const requested = parseIntegerEnv(process.env.MESSAGE_PROXY_LOOKUP_TIMEOUT_MS, 5000, 1);
  return Math.max(1, Math.min(requested, Math.floor(getMessageProxyExpectationTtlMs() / 2)));
}

function getConfirmedProxyMessageTtlMs(): number {
  return Math.max(
    getMessageProxyExpectationTtlMs(),
    parseIntegerEnv(process.env.CHANNEL_LOCK_TIMEOUT_MS, 180000, 10000),
  );
}

const expectationsByChannel = new Map<string, Map<string, InternalMessageProxyExpectation>>();
const proxyMessagesById = new Map<string, InternalMessageProxyMessageRecord>();
const activeLookupCountsByChannel = new Map<string, number>();

export function createMessageProxyExpectation(args: {
  instance: MessageProxyInstanceContext;
  channelId: string;
  originalMessageId: string;
  senderDiscId: string;
  originalMessage: Message;
  originalReference: Message["reference"];
}): MessageProxyExpectation {
  sweepExpiredMessageProxyState();
  deleteMessageProxyExpectation(args.channelId, args.originalMessageId);

  const createdAt = Date.now();
  const proxyWaitMs = getMessageProxyWaitMs();
  const expectationTtlMs = getMessageProxyExpectationTtlMs();
  let resolveWaitPromise: (result: MessageProxyWaitResult) => void = () => {};
  const waitPromise = new Promise<MessageProxyWaitResult>((resolve) => {
    resolveWaitPromise = resolve;
  });

  const expectation: InternalMessageProxyExpectation = {
    serviceId: args.instance.serviceId,
    instance: args.instance,
    channelId: args.channelId,
    originalMessageId: args.originalMessageId,
    senderDiscId: args.senderDiscId,
    state: "pending",
    createdAt,
    expiresAt: createdAt + expectationTtlMs,
    originalMessage: args.originalMessage,
    originalReference: args.originalReference,
    waitPromise,
    waitResult: null,
    waitDeadline: createdAt + proxyWaitMs,
    waitTimer: null,
    ttlTimer: null,
    resolveWait: (result) => {
      if (expectation.waitResult) return;
      expectation.waitResult = result;
      if (expectation.waitTimer) {
        clearTimeout(expectation.waitTimer);
        expectation.waitTimer = null;
      }
      resolveWaitPromise(result);
    },
  };

  scheduleMessageProxyWaitTimer(expectation);
  expectation.ttlTimer = setTimeout(() => {
    deleteMessageProxyExpectation(expectation.channelId, expectation.originalMessageId);
  }, expectationTtlMs);

  let channelExpectations = expectationsByChannel.get(args.channelId);
  if (!channelExpectations) {
    channelExpectations = new Map();
    expectationsByChannel.set(args.channelId, channelExpectations);
  }
  channelExpectations.set(args.originalMessageId, expectation);

  return expectation;
}

export async function waitForMessageProxyExpectation(
  expectation: MessageProxyExpectation,
): Promise<MessageProxyWaitResult> {
  const internal = getInternalMessageProxyExpectation(expectation.channelId, expectation.originalMessageId);
  if (!internal) {
    return "timeout";
  }
  return await internal.waitPromise;
}

export function cancelPendingMessageProxyExpectation(expectation: MessageProxyExpectation): boolean {
  const internal = getInternalMessageProxyExpectation(expectation.channelId, expectation.originalMessageId);
  if (!internal || internal !== expectation || internal.state !== "pending" || internal.waitResult !== null) {
    return false;
  }

  deleteMessageProxyExpectation(expectation.channelId, expectation.originalMessageId);
  return true;
}

export function markMessageProxyOriginalDeleted(channelId: string, originalMessageId: string): boolean {
  const expectation = getInternalMessageProxyExpectation(channelId, originalMessageId);
  if (!expectation) {
    return false;
  }

  expectation.state = "proxied";
  expectation.resolveWait("proxied");
  return true;
}

export function hasLiveMessageProxyExpectations(channelId: string): boolean {
  sweepExpiredMessageProxyState();
  const channelExpectations = expectationsByChannel.get(channelId);
  return Boolean(channelExpectations && channelExpectations.size > 0);
}

export function getLiveMessageProxyExpectationInstances(channelId: string): MessageProxyInstanceContext[] {
  sweepExpiredMessageProxyState();
  const instances = new Map<string, MessageProxyInstanceContext>();
  for (const expectation of expectationsByChannel.get(channelId)?.values() ?? []) {
    instances.set(expectation.instance.instanceId, expectation.instance);
  }
  return [...instances.values()];
}

export function findMatchingMessageProxyExpectation(
  channelId: string,
  attestation: ProxyMessageAttestation,
): MessageProxyExpectation | null {
  sweepExpiredMessageProxyState();
  if (!attestation.originalMessageId) return null;
  const expectation = getInternalMessageProxyExpectation(channelId, attestation.originalMessageId);
  if (
    !expectation ||
    expectation.serviceId !== attestation.serviceId ||
    expectation.instance.instanceId !== attestation.instanceId ||
    expectation.senderDiscId !== attestation.senderDiscordId
  ) {
    return null;
  }
  return expectation;
}

export function findVerifiedRepostExpectation(
  channelId: string,
  serviceId: string,
  instanceId: string,
  senderDiscId: string,
): MessageProxyExpectation | null {
  sweepExpiredMessageProxyState();
  const matching = [...(expectationsByChannel.get(channelId)?.values() ?? [])].filter(
    (expectation) =>
      expectation.serviceId === serviceId &&
      expectation.instance.instanceId === instanceId &&
      expectation.senderDiscId === senderDiscId,
  );
  // Without an original ID, concurrent messages from the same host cannot be paired safely.
  return matching.length === 1 ? matching[0] : null;
}

export function markMessageProxyExpectationProxied(expectation: MessageProxyExpectation): void {
  const internal = getInternalMessageProxyExpectation(expectation.channelId, expectation.originalMessageId);
  if (!internal) {
    return;
  }

  internal.state = "proxied";
  internal.resolveWait("proxied");
}

export function consumeVerifiedRepostExpectation(expectation: MessageProxyExpectation): void {
  deleteMessageProxyExpectation(expectation.channelId, expectation.originalMessageId);
}

export function beginMessageProxyLookup(channelId: string): () => void {
  const currentCount = activeLookupCountsByChannel.get(channelId) ?? 0;
  activeLookupCountsByChannel.set(channelId, currentCount + 1);
  pauseMessageProxyWaitTimers(channelId);

  let ended = false;
  return () => {
    if (ended) return;
    ended = true;

    const nextCount = Math.max((activeLookupCountsByChannel.get(channelId) ?? 1) - 1, 0);
    if (nextCount > 0) {
      activeLookupCountsByChannel.set(channelId, nextCount);
      return;
    }

    activeLookupCountsByChannel.delete(channelId);
    resumeMessageProxyWaitTimers(channelId);
  };
}

export function rememberMessageProxyMessage(args: {
  messageDiscId: string;
  channelId: string;
  expectation: MessageProxyExpectation;
  verifiedRepostOnly?: boolean;
  verifiedRepostReference?: Message["reference"];
  identityUserDiscId?: string | null;
}): MessageProxyMessageRecord {
  sweepExpiredMessageProxyState();
  deleteMessageProxyMessageRecord(args.messageDiscId);

  const createdAt = Date.now();
  const confirmedProxyMessageTtlMs = getConfirmedProxyMessageTtlMs();
  const record: InternalMessageProxyMessageRecord = {
    serviceId: args.expectation.serviceId,
    instanceId: args.expectation.instance.instanceId,
    instance: args.expectation.instance,
    messageDiscId: args.messageDiscId,
    channelId: args.channelId,
    originalMessageId: args.verifiedRepostOnly ? null : args.expectation.originalMessageId,
    senderDiscId: args.expectation.senderDiscId,
    createdAt,
    expiresAt: createdAt + confirmedProxyMessageTtlMs,
    originalMessage: args.verifiedRepostOnly ? null : args.expectation.originalMessage,
    originalReference: args.verifiedRepostOnly
      ? (args.verifiedRepostReference ?? null)
      : args.expectation.originalReference,
    identityUserDiscId: args.identityUserDiscId ?? null,
    originalSuppressed:
      getInternalMessageProxyExpectation(args.channelId, args.expectation.originalMessageId)?.waitResult === "proxied",
    ttlTimer: null,
  };

  record.ttlTimer = setTimeout(() => {
    deleteMessageProxyMessageRecord(record.messageDiscId);
  }, confirmedProxyMessageTtlMs);
  proxyMessagesById.set(args.messageDiscId, record);
  return record;
}

export function getMessageProxyMessageRecord(messageDiscId: string): MessageProxyMessageRecord | null {
  sweepExpiredMessageProxyState();
  return proxyMessagesById.get(messageDiscId) ?? null;
}

export function isKnownMessageProxyMessage(message: Pick<Message, "id" | "webhookId">): boolean {
  return Boolean(message.webhookId && getMessageProxyMessageRecord(message.id));
}

/**
 * IDs of originals that a confirmed proxy in this channel has superseded.
 *
 * A service may post the webhook and delete the original as separate operations, so an attestation
 * can resolve while the delete is still in flight. A history fetch in that window still returns the
 * original, which would render the same message twice under two identities. Callers building
 * dialogue context must drop these.
 *
 * Scanned rather than kept as a reverse index because a service may split long messages into
 * several proxies sharing one original, so an original-to-proxy map would drop live entries as
 * siblings expired.
 */
export function getSupersededMessageProxyOriginalMessageIds(channelId: string): Set<string> {
  sweepExpiredMessageProxyState();
  const originalMessageIds = new Set<string>();
  for (const record of proxyMessagesById.values()) {
    if (record.channelId === channelId && record.originalMessageId) {
      originalMessageIds.add(record.originalMessageId);
    }
  }
  return originalMessageIds;
}

export function applyMessageProxyReference(message: Message): boolean {
  const record = getMessageProxyMessageRecord(message.id);
  if (!record?.originalReference || message.reference?.messageId) {
    return false;
  }

  try {
    Object.defineProperty(message, "reference", {
      value: record.originalReference,
      configurable: true,
      writable: true,
    });
    return true;
  } catch (error) {
    log.warn(`Failed to apply message-proxy original reference to proxy message ${message.id}`, error);
    return false;
  }
}

export function clearMessageProxyExpectationStateForTests(): void {
  for (const channelExpectations of expectationsByChannel.values()) {
    for (const expectation of channelExpectations.values()) {
      clearMessageProxyExpectationTimers(expectation);
    }
  }
  expectationsByChannel.clear();

  for (const record of proxyMessagesById.values()) {
    if (record.ttlTimer) clearTimeout(record.ttlTimer);
  }
  proxyMessagesById.clear();
  activeLookupCountsByChannel.clear();
}

function getInternalMessageProxyExpectation(
  channelId: string,
  originalMessageId: string,
): InternalMessageProxyExpectation | null {
  const channelExpectations = expectationsByChannel.get(channelId);
  const expectation = channelExpectations?.get(originalMessageId) ?? null;
  if (!expectation) {
    return null;
  }

  if (Date.now() > expectation.expiresAt) {
    deleteMessageProxyExpectation(channelId, originalMessageId);
    return null;
  }

  return expectation;
}

function deleteMessageProxyExpectation(channelId: string, originalMessageId: string): void {
  const channelExpectations = expectationsByChannel.get(channelId);
  const existing = channelExpectations?.get(originalMessageId);
  if (!existing || !channelExpectations) {
    return;
  }

  clearMessageProxyExpectationTimers(existing);
  existing.resolveWait("timeout");
  channelExpectations.delete(originalMessageId);
  if (channelExpectations.size === 0) {
    expectationsByChannel.delete(channelId);
  }
}

function deleteMessageProxyMessageRecord(messageDiscId: string): void {
  const existing = proxyMessagesById.get(messageDiscId);
  if (!existing) {
    return;
  }

  if (existing.ttlTimer) {
    clearTimeout(existing.ttlTimer);
    existing.ttlTimer = null;
  }
  proxyMessagesById.delete(messageDiscId);
}

function clearMessageProxyExpectationTimers(expectation: InternalMessageProxyExpectation): void {
  if (expectation.waitTimer) {
    clearTimeout(expectation.waitTimer);
    expectation.waitTimer = null;
  }
  if (expectation.ttlTimer) {
    clearTimeout(expectation.ttlTimer);
    expectation.ttlTimer = null;
  }
}

function scheduleMessageProxyWaitTimer(expectation: InternalMessageProxyExpectation): void {
  if (expectation.waitResult || activeLookupCountsByChannel.has(expectation.channelId)) {
    return;
  }

  if (expectation.waitTimer) {
    clearTimeout(expectation.waitTimer);
  }

  expectation.waitTimer = setTimeout(
    () => {
      // Once the original is allowed to proceed, a later webhook must not
      // inherit its trigger decision and create a second response.
      if (expectation.serviceId === "pluralbuddy") {
        expectation.resolveWait("timeout");
      } else {
        deleteMessageProxyExpectation(expectation.channelId, expectation.originalMessageId);
      }
    },
    Math.max(expectation.waitDeadline - Date.now(), 0),
  );
}

function pauseMessageProxyWaitTimers(channelId: string): void {
  const channelExpectations = expectationsByChannel.get(channelId);
  if (!channelExpectations) {
    return;
  }

  for (const expectation of channelExpectations.values()) {
    if (expectation.waitTimer) {
      clearTimeout(expectation.waitTimer);
      expectation.waitTimer = null;
    }
  }
}

function resumeMessageProxyWaitTimers(channelId: string): void {
  const channelExpectations = expectationsByChannel.get(channelId);
  if (!channelExpectations) {
    return;
  }

  for (const expectation of channelExpectations.values()) {
    scheduleMessageProxyWaitTimer(expectation);
  }
}

function sweepExpiredMessageProxyState(): void {
  const now = Date.now();

  for (const [channelId, channelExpectations] of expectationsByChannel.entries()) {
    for (const [originalMessageId, expectation] of channelExpectations.entries()) {
      if (now > expectation.expiresAt) {
        clearMessageProxyExpectationTimers(expectation);
        expectation.resolveWait("timeout");
        channelExpectations.delete(originalMessageId);
      }
    }
    if (channelExpectations.size === 0) {
      expectationsByChannel.delete(channelId);
    }
  }

  for (const [messageDiscId, record] of proxyMessagesById.entries()) {
    if (now > record.expiresAt) {
      if (record.ttlTimer) clearTimeout(record.ttlTimer);
      proxyMessagesById.delete(messageDiscId);
    }
  }
}
