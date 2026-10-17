import type { Message } from "discord.js";
import type { MessageProxyInstanceContext } from "@/utils/messageProxy/instances";
import { messageProxyServiceRegistry, type ProxyServiceRegistry } from "@/utils/messageProxy/registry";
import {
  beginMessageProxyLookup,
  findMatchingMessageProxyExpectation,
  findVerifiedRepostExpectation,
  type MessageProxyExpectation,
} from "@/utils/messageProxy/proxyExpectation";
import type { ProxyMessageAttestation, ProxyServiceDescriptor } from "@/utils/messageProxy/types";
import { log } from "@/utils/misc/logger";

export type MessageProxyRouteStatus =
  | "unsupported_correlation"
  | "unmatched"
  | "timeout_or_error"
  | "conflicting_attestations"
  | "matched_trigger_only"
  | "matched_stable_identity";

export type MessageProxyRouteResult =
  | { status: Exclude<MessageProxyRouteStatus, "matched_trigger_only" | "matched_stable_identity"> }
  | {
      status: "matched_trigger_only" | "matched_stable_identity";
      attestation: ProxyMessageAttestation;
      expectation: MessageProxyExpectation;
    };

const routeMetrics: Record<MessageProxyRouteStatus, number> = {
  unsupported_correlation: 0,
  unmatched: 0,
  timeout_or_error: 0,
  conflicting_attestations: 0,
  matched_trigger_only: 0,
  matched_stable_identity: 0,
};

function routeResult<TResult extends MessageProxyRouteResult>(result: TResult): TResult {
  routeMetrics[result.status] += 1;
  return result;
}

export function getMessageProxyRouteMetricsSnapshot(): Readonly<Record<MessageProxyRouteStatus, number>> {
  return { ...routeMetrics };
}

export function clearMessageProxyRouteMetricsForTests(): void {
  for (const status of Object.keys(routeMetrics) as MessageProxyRouteStatus[]) {
    routeMetrics[status] = 0;
  }
}

type MessageProxyRouterDependencies = {
  registry: ProxyServiceRegistry<string>;
  findExpectation(channelId: string, attestation: ProxyMessageAttestation): MessageProxyExpectation | null;
  findVerifiedRepostExpectation(
    channelId: string,
    serviceId: string,
    instanceId: string,
    senderDiscId: string,
  ): MessageProxyExpectation | null;
};

const DEFAULT_DEPENDENCIES: MessageProxyRouterDependencies = {
  registry: messageProxyServiceRegistry,
  findExpectation: findMatchingMessageProxyExpectation,
  findVerifiedRepostExpectation,
};

type AttestingProxyServiceDescriptor = Exclude<
  ProxyServiceDescriptor<string>,
  { capabilities: { correlation: "none" } }
>;

function isAttestingDescriptor(
  descriptor: ProxyServiceDescriptor<string> | undefined,
): descriptor is AttestingProxyServiceDescriptor {
  return (
    descriptor?.capabilities.correlation === "attested" || descriptor?.capabilities.correlation === "verified-repost"
  );
}

export const MAX_CANDIDATE_INSTANCES = 4;

export async function routeMessageProxyMessage(
  args: {
    message: Message;
    candidateInstances: readonly MessageProxyInstanceContext[];
  },
  dependencyOverrides: Partial<MessageProxyRouterDependencies> = {},
): Promise<MessageProxyRouteResult> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  const instances = [...new Map(args.candidateInstances.map((instance) => [instance.instanceId, instance])).values()];
  if (instances.length > MAX_CANDIDATE_INSTANCES) {
    return routeResult({ status: "timeout_or_error" });
  }
  const candidates = instances.flatMap((instance) => {
    const descriptor = dependencies.registry.get(instance.serviceId);
    return isAttestingDescriptor(descriptor) && (descriptor.canAttestMessage?.(args.message, instance) ?? true)
      ? [{ descriptor, instance }]
      : [];
  });
  if (candidates.length === 0) return routeResult({ status: "unsupported_correlation" });

  const endLookup = beginMessageProxyLookup(args.message.channelId);
  const settled = await Promise.allSettled(
    candidates.map(async ({ descriptor, instance }) => descriptor.attestMessage(args.message.id, instance)),
  ).finally(endLookup);
  // A rejected adapter could not answer (stall, network failure, rate limit); a
  // fulfilled null means the service answered that it has no such message. Only the
  // first is an error, so an adapter that cannot tell must reject rather than
  // resolve null.
  const errored = settled.some((result) => result.status === "rejected");
  const claims = settled.flatMap((result, index) => {
    if (result.status !== "fulfilled" || !result.value) return [];
    const { descriptor, instance } = candidates[index];
    const claim = result.value;
    const invalidIdentity =
      claim.identity !== null &&
      (descriptor.capabilities.identity !== "stable" ||
        claim.identity.serviceId !== descriptor.serviceId ||
        claim.identity.instanceId !== instance.instanceId ||
        claim.identity.externalIdentityKind !== descriptor.externalIdentityKind ||
        !descriptor.validateExternalKey(claim.identity.externalKey));
    if (
      claim.serviceId !== descriptor.serviceId ||
      claim.instanceId !== instance.instanceId ||
      claim.proxyMessageId !== args.message.id ||
      (claim.channelId && claim.channelId !== args.message.channelId) ||
      (descriptor.capabilities.correlation === "attested" && !claim.originalMessageId) ||
      (descriptor.capabilities.correlation === "verified-repost" && claim.originalMessageId !== null) ||
      invalidIdentity
    ) {
      log.warn(`Rejected malformed message-proxy attestation from ${descriptor.serviceId}`);
      return [];
    }
    if (descriptor.capabilities.correlation === "verified-repost" && claim.identity) {
      claim.identity.displayName = args.message.author.username;
    }
    return [claim];
  });

  if (claims.length > 1) {
    log.error(`Conflicting message-proxy attestations for message ${args.message.id}`);
    return routeResult({ status: "conflicting_attestations" });
  }
  const attestation = claims[0];
  if (!attestation) return routeResult({ status: errored ? "timeout_or_error" : "unmatched" });

  // Before the expectation check: the service confirmed the message even when no original pairs with it.
  const claimed = candidates.find(({ instance }) => instance.instanceId === attestation.instanceId);
  claimed?.descriptor.recordAttestedMessage?.(args.message, claimed.instance);

  const expectation = attestation.originalMessageId
    ? dependencies.findExpectation(args.message.channelId, attestation)
    : dependencies.findVerifiedRepostExpectation(
        args.message.channelId,
        attestation.serviceId,
        attestation.instanceId,
        attestation.senderDiscordId,
      );
  if (!expectation) return routeResult({ status: "unmatched" });
  return routeResult({
    status: attestation.identity ? "matched_stable_identity" : "matched_trigger_only",
    attestation,
    expectation,
  });
}
