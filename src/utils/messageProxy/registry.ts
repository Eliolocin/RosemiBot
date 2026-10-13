import type { Embed } from "discord.js";
import type { ProxyReplyTarget, ProxyServiceDescriptor, ProxyServicePresentation } from "@/utils/messageProxy/types";
import { pluralKitProxyService } from "@/utils/messageProxy/services/pluralkit/descriptor";
import { pluralBuddyProxyService } from "@/utils/messageProxy/services/pluralbuddy/descriptor";
import { log } from "@/utils/misc/logger";

export const MESSAGE_PROXY_DISABLED_SERVICE_ID = "none" as const;
export const MESSAGE_PROXY_SERVICE_DESCRIPTORS = [pluralKitProxyService, pluralBuddyProxyService] as const;
export type ProxyServiceId = (typeof MESSAGE_PROXY_SERVICE_DESCRIPTORS)[number]["serviceId"];
export type MessageProxyServiceSelection = typeof MESSAGE_PROXY_DISABLED_SERVICE_ID | ProxyServiceId;

export type ProxyServiceRegistry<TServiceId extends string = string> = ReadonlyMap<
  TServiceId,
  ProxyServiceDescriptor<TServiceId>
>;

const BIO_CAPABILITIES = new Set(["inline", "separate-fetch", "none"]);

function assertValidCapabilities(descriptor: ProxyServiceDescriptor<string>): void {
  const runtimeDescriptor = descriptor as ProxyServiceDescriptor<string> & {
    attestMessage?: unknown;
    getCachedAttestation?: unknown;
    capabilities: Record<string, unknown>;
  };
  const { capabilities } = runtimeDescriptor;
  const hasAttestation = typeof runtimeDescriptor.attestMessage === "function";
  const hasCachedAttestation = typeof runtimeDescriptor.getCachedAttestation === "function";
  const hasBioCapabilities = "identityBio" in capabilities || "namespaceBio" in capabilities;

  const validNoCorrelation =
    capabilities.correlation === "none" &&
    capabilities.identity === "none" &&
    !hasAttestation &&
    !hasCachedAttestation &&
    !hasBioCapabilities;
  const validIdentityFree =
    capabilities.correlation === "attested" &&
    capabilities.identity === "none" &&
    hasAttestation &&
    !hasBioCapabilities;
  const validStableIdentity =
    (capabilities.correlation === "attested" || capabilities.correlation === "verified-repost") &&
    capabilities.identity === "stable" &&
    hasAttestation &&
    BIO_CAPABILITIES.has(capabilities.identityBio as string) &&
    BIO_CAPABILITIES.has(capabilities.namespaceBio as string);

  if (!validNoCorrelation && !validIdentityFree && !validStableIdentity) {
    throw new Error(`Invalid message-proxy capability combination for service: ${descriptor.serviceId}`);
  }
}

export function createProxyServiceRegistry<const TDescriptors extends readonly ProxyServiceDescriptor<string>[]>(
  descriptors: TDescriptors,
): ProxyServiceRegistry<TDescriptors[number]["serviceId"]> {
  const byServiceId = new Map<string, ProxyServiceDescriptor<string>>();
  const prefixes = new Set<string>();
  const identityKinds = new Set<string>();
  for (const descriptor of descriptors) {
    assertValidCapabilities(descriptor);
    if (byServiceId.has(descriptor.serviceId)) {
      throw new Error(`Duplicate message-proxy service ID: ${descriptor.serviceId}`);
    }
    if (prefixes.has(descriptor.syntheticUserPrefix)) {
      throw new Error(`Duplicate message-proxy synthetic-user prefix: ${descriptor.syntheticUserPrefix}`);
    }
    if (identityKinds.has(descriptor.externalIdentityKind)) {
      throw new Error(`Duplicate message-proxy external-identity kind: ${descriptor.externalIdentityKind}`);
    }
    byServiceId.set(descriptor.serviceId, descriptor);
    prefixes.add(descriptor.syntheticUserPrefix);
    identityKinds.add(descriptor.externalIdentityKind);
  }
  return byServiceId as ProxyServiceRegistry<TDescriptors[number]["serviceId"]>;
}

export const messageProxyServiceRegistry = createProxyServiceRegistry(MESSAGE_PROXY_SERVICE_DESCRIPTORS);
const reportedUnknownSelections = new Set<string>();

export function getProxyServiceDescriptor(serviceId: string): ProxyServiceDescriptor<ProxyServiceId> | null {
  return (
    (messageProxyServiceRegistry.get(serviceId as ProxyServiceId) as ProxyServiceDescriptor<ProxyServiceId>) ?? null
  );
}

export function resolveConfiguredProxyService(serviceId: string | null | undefined): ProxyServiceId | null {
  if (!serviceId || serviceId === MESSAGE_PROXY_DISABLED_SERVICE_ID) return null;
  const descriptor = getProxyServiceDescriptor(serviceId);
  if (descriptor) return descriptor.serviceId;
  if (!reportedUnknownSelections.has(serviceId)) {
    reportedUnknownSelections.add(serviceId);
    log.warn(`Unknown configured message-proxy service ignored: ${serviceId}`);
  }
  return null;
}

export function getMessageProxyServiceChoices(): readonly MessageProxyServiceSelection[] {
  return [MESSAGE_PROXY_DISABLED_SERVICE_ID, ...MESSAGE_PROXY_SERVICE_DESCRIPTORS.map(({ serviceId }) => serviceId)];
}

export function getProxyServicePresentation(serviceId: string): ProxyServicePresentation | null {
  return getProxyServiceDescriptor(serviceId)?.presentation ?? null;
}

export function extractMessageProxyReplyTargetFromEmbed(
  embed: Pick<Embed, "author" | "description">,
): ProxyReplyTarget | null {
  for (const descriptor of MESSAGE_PROXY_SERVICE_DESCRIPTORS) {
    const target = descriptor.extractReplyTargetFromEmbed?.(embed);
    if (target) return target;
  }
  return null;
}

export function isMessageProxyReplyEmbed(embed: Pick<Embed, "author" | "description">): boolean {
  return extractMessageProxyReplyTargetFromEmbed(embed) !== null;
}
