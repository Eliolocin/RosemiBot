import { seedMessageProxyIdentityBio } from "@/utils/messageProxy/bioSeeding";
import { forgetNegativeMessageProxyMessageIdentity } from "@/utils/messageProxy/messageIdentityNegativeCache";
import { getProxyServiceDescriptor } from "@/utils/messageProxy/registry";
import type { ProxyMessageAttestation, ProxyServiceDescriptor } from "@/utils/messageProxy/types";
import {
  messageProxyRepository,
  type MessageProxyIdentityUpsertResult,
} from "@/utils/db/repositories/MessageProxyRepository";
import { log } from "@/utils/misc/logger";

export type MessageProxyIdentityPersistenceStatus = "identity_free" | "persisted" | "persistence_failed";

export type MessageProxyIdentityPersistenceDependencies = {
  getDescriptor(serviceId: string): ProxyServiceDescriptor<string> | null;
  persistIdentity(args: {
    input: NonNullable<ProxyMessageAttestation["identity"]>;
    messageDiscId: string;
    senderDiscId: string;
  }): Promise<MessageProxyIdentityUpsertResult | null>;
  seedIdentityBio: typeof seedMessageProxyIdentityBio;
};

const DEFAULT_DEPENDENCIES: MessageProxyIdentityPersistenceDependencies = {
  getDescriptor: getProxyServiceDescriptor,
  persistIdentity: (args) => messageProxyRepository.persistAttestedIdentity(args),
  seedIdentityBio: seedMessageProxyIdentityBio,
};

export async function persistMessageProxyAttestationIdentity(
  args: {
    messageDiscId: string;
    attestation: ProxyMessageAttestation;
    serverDiscId: string | null;
    avatarUrl?: string | null;
  },
  dependencies: MessageProxyIdentityPersistenceDependencies = DEFAULT_DEPENDENCIES,
): Promise<MessageProxyIdentityPersistenceStatus> {
  const identityInput = args.attestation.identity
    ? args.avatarUrl === undefined
      ? args.attestation.identity
      : { ...args.attestation.identity, avatarUrl: args.avatarUrl }
    : null;
  if (!identityInput) return "identity_free";

  const descriptor = dependencies.getDescriptor(args.attestation.serviceId);
  if (
    descriptor?.capabilities.identity !== "stable" ||
    identityInput.serviceId !== descriptor.serviceId ||
    identityInput.externalIdentityKind !== descriptor.externalIdentityKind ||
    !descriptor.validateExternalKey(identityInput.externalKey)
  ) {
    log.warn(`Rejected invalid message-proxy identity persistence for message ${args.messageDiscId}`);
    return "persistence_failed";
  }

  const identity = await dependencies.persistIdentity({
    input: identityInput,
    messageDiscId: args.messageDiscId,
    senderDiscId: args.attestation.senderDiscordId,
  });
  if (!identity?.identity.external_identity_id || !identity.namespace.message_proxy_namespace_id) {
    log.warn(`Message-proxy identity upsert failed for message ${args.messageDiscId}; continuing without DB identity`);
    return "persistence_failed";
  }

  forgetNegativeMessageProxyMessageIdentity(args.messageDiscId);

  if (descriptor.capabilities.identityBio !== "none" && identity.userRow.user_id) {
    void dependencies
      .seedIdentityBio({
        isNewIdentity: identity.isNewIdentity,
        identityUserDiscId: identity.userRow.user_disc_id,
        identityUserId: identity.userRow.user_id,
        description: identityInput.bio,
        serverDiscId: args.serverDiscId,
      })
      .catch((error) => log.warn(`Message-proxy bio seed failed for ${identity.userRow.user_disc_id}`, error));
  }

  return "persisted";
}
