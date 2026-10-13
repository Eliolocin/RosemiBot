import type { ProxyServiceDescriptor } from "@/utils/messageProxy/types";
import { createApplicationIdFilter } from "@/utils/messageProxy/applicationFilter";
import { fetchMessage, getCachedMessageLookup } from "@/utils/messageProxy/services/pluralkit/api";
import { toPluralKitAttestation } from "@/utils/messageProxy/services/pluralkit/identityAdapter";
import { pluralKitPresentation } from "@/utils/messageProxy/services/pluralkit/presentation";
import { extractPluralKitReplyTarget } from "@/utils/messageProxy/services/pluralkit/replyEmbed";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const applicationFilter = createApplicationIdFilter();

export const pluralKitProxyService = {
  serviceId: "pluralkit",
  settingsLocaleKey: "pluralkit_option",
  enabledSuccessDescriptionLocaleKey: "commands.personal.message-proxy.pluralkit_enabled_success_description",
  syntheticUserPrefix: "pk:",
  externalIdentityKind: "pluralkit_member",
  validateExternalKey: (externalKey: string) => UUID_PATTERN.test(externalKey),
  capabilities: {
    correlation: "attested",
    identity: "stable",
    identityBio: "inline",
    namespaceBio: "inline",
  },
  presentation: pluralKitPresentation,
  canAttestMessage: (message, instance) => applicationFilter.canAttest(message, instance),
  recordAttestedMessage: (message, instance) => applicationFilter.record(message, instance),
  attestMessage: async (proxyMessageId: string, instance) => {
    const lookup = await fetchMessage(instance, proxyMessageId);
    return lookup ? toPluralKitAttestation(proxyMessageId, lookup, instance) : null;
  },
  getCachedAttestation: (proxyMessageId: string, instance) => {
    const lookup = getCachedMessageLookup(instance, proxyMessageId);
    return lookup ? toPluralKitAttestation(proxyMessageId, lookup, instance) : null;
  },
  extractReplyTargetFromEmbed: extractPluralKitReplyTarget,
} as const satisfies ProxyServiceDescriptor<"pluralkit">;
