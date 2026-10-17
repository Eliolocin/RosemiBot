import type { ProxyIdentityUpsertInput, ProxyMessageAttestation } from "@/utils/messageProxy/types";
import type { PkMessageLookup } from "@/utils/messageProxy/services/pluralkit/api";
import type { MessageProxyInstanceContext } from "@/utils/messageProxy/instances";

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function getPluralKitIdentityDisplayName(lookup: PkMessageLookup): string | null {
  if (!lookup.member) return null;
  return normalizeOptionalText(lookup.member.display_name) ?? normalizeOptionalText(lookup.member.name) ?? null;
}

export function toPluralKitIdentityInput(
  lookup: PkMessageLookup,
  instanceId?: string,
): ProxyIdentityUpsertInput | null {
  if (!lookup.member || !lookup.system) return null;
  return {
    serviceId: "pluralkit",
    instanceId,
    externalIdentityKind: "pluralkit_member",
    externalKey: lookup.member.uuid,
    shortId: lookup.member.id,
    displayName: getPluralKitIdentityDisplayName(lookup) ?? lookup.member.id,
    bio: normalizeOptionalText(lookup.member.description),
    pronouns: normalizeOptionalText(lookup.member.pronouns),
    namespace: {
      namespaceKey: lookup.system.uuid,
      shortId: lookup.system.id,
      displayName: normalizeOptionalText(lookup.system.name),
      tag: normalizeOptionalText(lookup.system.tag),
      description: normalizeOptionalText(lookup.system.description),
    },
  };
}

export function toPluralKitAttestation(
  proxyMessageId: string,
  lookup: PkMessageLookup,
  instance: MessageProxyInstanceContext,
): ProxyMessageAttestation {
  return {
    serviceId: "pluralkit",
    instanceId: instance.instanceId,
    proxyMessageId,
    originalMessageId: lookup.original,
    senderDiscordId: lookup.sender,
    identity: toPluralKitIdentityInput(lookup, instance.instanceId),
  };
}
