import type { Message } from "discord.js";
import { stripBridgePrefix } from "@/utils/bridges";
import {
  hasNegativeMessageProxyMessageIdentity,
  rememberNegativeMessageProxyMessageIdentity,
} from "@/utils/messageProxy/messageIdentityNegativeCache";
import { getMessageProxyMessageRecord, type MessageProxyMessageRecord } from "@/utils/messageProxy/proxyExpectation";
import { getProxyServiceDescriptor } from "@/utils/messageProxy/registry";
import { formatMessageProxyIdentityUserId } from "@/utils/messageProxy/identityUserId";
import type { MessageProxyIndexedMessageIdentity, ProxyServiceDescriptor } from "@/utils/messageProxy/types";
import { messageProxyRepository } from "@/utils/db/repositories/MessageProxyRepository";

export type MessageProxyHistoryIdentity = {
  serviceId: string;
  userDiscId: string;
  displayName: string;
  senderDiscId: string;
};

export type MessageProxyHistoryAttributionDependencies = {
  getMessageRecord(messageDiscId: string): MessageProxyMessageRecord | null;
  getDescriptor(serviceId: string): ProxyServiceDescriptor<string> | null;
  loadMessageIdentities(messageDiscIds: string[]): Promise<Map<string, MessageProxyIndexedMessageIdentity> | null>;
};

const DEFAULT_DEPENDENCIES: MessageProxyHistoryAttributionDependencies = {
  getMessageRecord: getMessageProxyMessageRecord,
  getDescriptor: getProxyServiceDescriptor,
  loadMessageIdentities: (messageDiscIds) => messageProxyRepository.getMessageIdentitiesByMessageIds(messageDiscIds),
};

/** Current verified identity from the adapter cache, including the webhook name fallback. */
export function resolveCachedMessageProxyIdentity(
  message: Message,
  dependencies: Pick<
    MessageProxyHistoryAttributionDependencies,
    "getMessageRecord" | "getDescriptor"
  > = DEFAULT_DEPENDENCIES,
): MessageProxyHistoryIdentity | null {
  if (!message.webhookId) return null;
  const record = dependencies.getMessageRecord(message.id);
  const descriptor = record ? dependencies.getDescriptor(record.serviceId) : null;
  const attestation = record && descriptor?.getCachedAttestation?.(message.id, record.instance);
  const identity = attestation?.identity;
  if (!descriptor || !attestation || !identity || !descriptor.validateExternalKey(identity.externalKey)) return null;

  return {
    serviceId: attestation.serviceId,
    userDiscId: formatMessageProxyIdentityUserId(descriptor.serviceId, identity.externalKey, identity.instanceId),
    displayName: identity.displayName ?? getWebhookDisplayName(message, identity.shortId ?? identity.externalKey),
    senderDiscId: attestation.senderDiscordId,
  };
}

export async function resolveMessageProxyMessageIdentitiesForHistory(
  messages: Message[],
  dependencies: MessageProxyHistoryAttributionDependencies = DEFAULT_DEPENDENCIES,
): Promise<Map<string, MessageProxyHistoryIdentity>> {
  const identities = new Map<string, MessageProxyHistoryIdentity>();
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const dbLookupIds: string[] = [];
  const seenDbLookupIds = new Set<string>();

  for (const message of messages) {
    if (!message.webhookId) continue;
    if (hasNegativeMessageProxyMessageIdentity(message.id)) continue;

    const cachedIdentity = resolveCachedMessageProxyIdentity(message, dependencies);
    if (cachedIdentity) {
      identities.set(message.id, cachedIdentity);
      continue;
    }

    if (!seenDbLookupIds.has(message.id)) {
      seenDbLookupIds.add(message.id);
      dbLookupIds.push(message.id);
    }
  }

  if (dbLookupIds.length === 0) {
    return identities;
  }

  const dbIdentities = await dependencies.loadMessageIdentities(dbLookupIds);
  if (!dbIdentities) {
    return identities;
  }

  for (const messageDiscId of dbLookupIds) {
    if (!dbIdentities.has(messageDiscId)) {
      rememberNegativeMessageProxyMessageIdentity(messageDiscId);
    }
  }

  for (const [messageDiscId, identity] of dbIdentities.entries()) {
    const message = messageById.get(messageDiscId);
    identities.set(messageDiscId, {
      serviceId: identity.serviceId,
      userDiscId: identity.userDiscId,
      displayName:
        identity.displayName ?? getWebhookDisplayName(message, identity.identityShortId ?? identity.externalKey),
      senderDiscId: identity.senderDiscId,
    });
  }

  return identities;
}

/**
 * Resolves verified proxy attribution for one message that sits outside the prepared history
 * window, such as a reply reference fetched by ID. Uses the same cache-first lookup and single
 * batched index read as history, so rebuilding context never calls a service API, and a
 * confirmed miss is remembered so repeated lookups for the same message stay free.
 *
 * A hit is merged into `identities` so every later consumer in the same turn reads the same
 * attribution the history loop would have produced for that message.
 */
export async function ensureMessageProxyMessageIdentity(
  message: Message,
  identities: Map<string, MessageProxyHistoryIdentity>,
  dependencies: MessageProxyHistoryAttributionDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  if (identities.has(message.id)) return;
  if (!message.webhookId) return;

  const resolved = (await resolveMessageProxyMessageIdentitiesForHistory([message], dependencies)).get(message.id);
  if (resolved) identities.set(message.id, resolved);
}

function getWebhookDisplayName(message: Message | undefined, fallback: string): string {
  const username = message?.author.username ?? "";
  return stripBridgePrefix(username).trim() || username.trim() || fallback;
}
