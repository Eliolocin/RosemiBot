import type { ProxyMessageAttestation, ProxyServiceDescriptor } from "@/utils/messageProxy/types";
import type { MessageProxyInstanceContext } from "@/utils/messageProxy/instances";
import { createApplicationIdFilter } from "@/utils/messageProxy/applicationFilter";
import {
  fetchPluralBuddyMessage,
  getCachedPluralBuddyMessage,
  type PluralBuddyMessage,
} from "@/utils/messageProxy/services/pluralbuddy/api";

function toAttestation(message: PluralBuddyMessage, instance: MessageProxyInstanceContext): ProxyMessageAttestation {
  return {
    serviceId: "pluralbuddy",
    instanceId: instance.instanceId,
    proxyMessageId: message.messageId,
    channelId: message.channelId,
    replyTarget: message.referencedMessage
      ? { channelId: message.channelId, messageId: message.referencedMessage }
      : null,
    originalMessageId: null,
    senderDiscordId: message.systemId,
    identity: {
      serviceId: "pluralbuddy",
      instanceId: instance.instanceId,
      externalIdentityKind: "pluralbuddy_alter",
      externalKey: message.alterIdKey,
      shortId: message.alterIdKey,
      displayName: null,
      bio: null,
      namespace: {
        namespaceKey: message.systemId,
        shortId: null,
        displayName: null,
        tag: null,
        description: null,
      },
    },
  };
}

const applicationFilter = createApplicationIdFilter();

export const pluralBuddyProxyService = {
  serviceId: "pluralbuddy",
  settingsLocaleKey: "pluralbuddy_option",
  enabledSuccessDescriptionLocaleKey: "commands.personal.message-proxy.pluralbuddy_enabled_success_description",
  syntheticUserPrefix: "pb:",
  externalIdentityKind: "pluralbuddy_alter",
  validateExternalKey: (key: string) => /^\d{1,20}$/.test(key),
  capabilities: {
    correlation: "verified-repost",
    identity: "stable",
    identityBio: "none",
    namespaceBio: "none",
  },
  presentation: {
    identityMembershipLine: () => "- Member of a plural system; its members share one presence here",
    namespacePresentation: (_context, accountLabels) => ({
      sectionHeading: "Some of the people above are members of plural systems:",
      entry: `- A plural system${accountLabels.length ? ` (shared account: ${accountLabels.join("; ")})` : ""}`,
    }),
  },
  canAttestMessage: (message, instance) => applicationFilter.canAttest(message, instance),
  recordAttestedMessage: (message, instance) => applicationFilter.record(message, instance),
  attestMessage: async (messageId: string, instance) => {
    const message = await fetchPluralBuddyMessage(instance, messageId);
    return message ? toAttestation(message, instance) : null;
  },
  getCachedAttestation: (messageId: string, instance) => {
    const message = getCachedPluralBuddyMessage(instance, messageId);
    return message ? toAttestation(message, instance) : null;
  },
  extractReplyTargetFromEmbed: () => null,
} as const satisfies ProxyServiceDescriptor<"pluralbuddy">;
