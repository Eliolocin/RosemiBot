import type { Embed, Message } from "discord.js";
import type { MessageProxyInstanceContext } from "@/utils/messageProxy/instances";

type ProxyServiceCapabilities =
  | { correlation: "none"; identity: "none" }
  | { correlation: "attested"; identity: "none" }
  | {
      correlation: "verified-repost";
      identity: "stable";
      identityBio: "inline" | "separate-fetch" | "none";
      namespaceBio: "inline" | "separate-fetch" | "none";
    }
  | {
      correlation: "attested";
      identity: "stable";
      identityBio: "inline" | "separate-fetch" | "none";
      namespaceBio: "inline" | "separate-fetch" | "none";
    };

type ProxyIdentityNamespaceInput = {
  namespaceKey: string;
  shortId: string | null;
  displayName: string | null;
  tag: string | null;
  description: string | null;
};

export type ProxyIdentityUpsertInput = {
  serviceId: string;
  instanceId?: string;
  externalIdentityKind: string;
  externalKey: string;
  shortId: string | null;
  displayName: string | null;
  avatarUrl?: string | null;
  bio: string | null;
  /**
   * Service-published pronouns for this identity, when the service reports them publicly.
   * They seed the synthetic user's own `pronouns` setting at first registration only,
   * so every later edit belongs to that profile and is never taken back from the service.
   */
  pronouns?: string | null;
  namespace: ProxyIdentityNamespaceInput;
};

export type ProxyMessageAttestation = {
  serviceId: string;
  instanceId: string;
  proxyMessageId: string;
  channelId?: string;
  replyTarget?: ProxyReplyTarget | null;
  originalMessageId: string | null;
  senderDiscordId: string;
  identity: ProxyIdentityUpsertInput | null;
};

export type ProxyReplyTarget = { channelId: string; messageId: string };

export type MessageProxyIdentityContext = {
  serviceId: string;
  instanceId: string;
  userDiscId: string;
  externalIdentityId: number;
  externalKey: string;
  identityShortId: string | null;
  displayName: string | null;
  namespaceId: number;
  namespaceKey: string;
  namespaceShortId: string | null;
  namespaceDisplayName: string | null;
  namespaceTag: string | null;
  namespaceDescription: string | null;
  hostUserDiscIds: string[];
};

export type MessageProxyIndexedMessageIdentity = MessageProxyIdentityContext & {
  messageDiscId: string;
  senderDiscId: string;
};

export type MessageProxyIdentityReference = {
  serviceId: string;
  userDiscId: string;
  displayName: string | null;
  savedNickname: string | null;
};

type ProxyNamespacePresentation = {
  sectionHeading: string;
  entry: string;
};

export interface ProxyServicePresentation {
  identityMembershipLine(context: MessageProxyIdentityContext): string;
  namespacePresentation(
    context: MessageProxyIdentityContext,
    accountLabels: readonly string[],
  ): ProxyNamespacePresentation;
}

type ProxyDescriptorBase<TServiceId extends string> = {
  serviceId: TServiceId;
  settingsLocaleKey: string;
  enabledSuccessDescriptionLocaleKey: string;
  syntheticUserPrefix: `${string}:`;
  externalIdentityKind: string;
  validateExternalKey(externalKey: string): boolean;
  presentation: ProxyServicePresentation;
  /** False skips the lookup for good, so it must never reject a message the service could have sent. */
  canAttestMessage?(message: Message, instance: MessageProxyInstanceContext): boolean;
  /** Called for a validated claim, before the router looks for a matching expectation. */
  recordAttestedMessage?(message: Message, instance: MessageProxyInstanceContext): void;
  extractReplyTargetFromEmbed?(embed: Pick<Embed, "author" | "description">): ProxyReplyTarget | null;
};

export type ProxyServiceDescriptor<TServiceId extends string = string> =
  | (ProxyDescriptorBase<TServiceId> & {
      capabilities: Extract<ProxyServiceCapabilities, { correlation: "none" }>;
      attestMessage?: never;
      getCachedAttestation?: never;
    })
  | (ProxyDescriptorBase<TServiceId> & {
      capabilities: Extract<ProxyServiceCapabilities, { correlation: "attested"; identity: "none" }>;
      attestMessage(
        proxyMessageId: string,
        instance: MessageProxyInstanceContext,
      ): Promise<ProxyMessageAttestation | null>;
      getCachedAttestation?(
        proxyMessageId: string,
        instance: MessageProxyInstanceContext,
      ): ProxyMessageAttestation | null;
    })
  | (ProxyDescriptorBase<TServiceId> & {
      capabilities: Extract<ProxyServiceCapabilities, { correlation: "attested"; identity: "stable" }>;
      attestMessage(
        proxyMessageId: string,
        instance: MessageProxyInstanceContext,
      ): Promise<ProxyMessageAttestation | null>;
      getCachedAttestation?(
        proxyMessageId: string,
        instance: MessageProxyInstanceContext,
      ): ProxyMessageAttestation | null;
    })
  | (ProxyDescriptorBase<TServiceId> & {
      capabilities: Extract<ProxyServiceCapabilities, { correlation: "verified-repost" }>;
      attestMessage(
        proxyMessageId: string,
        instance: MessageProxyInstanceContext,
      ): Promise<ProxyMessageAttestation | null>;
      getCachedAttestation?(
        proxyMessageId: string,
        instance: MessageProxyInstanceContext,
      ): ProxyMessageAttestation | null;
    });
