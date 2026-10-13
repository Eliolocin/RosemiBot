import {
  messageProxyServiceRegistry,
  type ProxyServiceRegistry,
  type ProxyServiceId,
} from "@/utils/messageProxy/registry";

export type ParsedMessageProxyIdentityUserId = {
  serviceId: ProxyServiceId;
  instanceId: string;
  externalKey: string;
};

const CUSTOM_INSTANCE_SUFFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isCustomInstanceId(serviceId: string, instanceId: string): boolean {
  return instanceId.startsWith(`${serviceId}:`) && CUSTOM_INSTANCE_SUFFIX.test(instanceId.slice(serviceId.length + 1));
}

export function formatMessageProxyIdentityUserId(serviceId: string, externalKey: string, instanceId?: string): string {
  return formatMessageProxyIdentityUserIdFromRegistry(
    serviceId,
    externalKey,
    messageProxyServiceRegistry as ProxyServiceRegistry<string>,
    instanceId,
  );
}

export function formatMessageProxyIdentityUserIdFromRegistry<TServiceId extends string>(
  serviceId: TServiceId,
  externalKey: string,
  registry: ProxyServiceRegistry<TServiceId>,
  instanceId = `${serviceId}:official`,
): string {
  const descriptor = registry.get(serviceId);
  if (!descriptor?.validateExternalKey(externalKey)) {
    throw new Error(`Invalid external key for message-proxy service ${serviceId}`);
  }
  if (instanceId === `${serviceId}:official`) return `${descriptor.syntheticUserPrefix}${externalKey}`;
  if (!isCustomInstanceId(serviceId, instanceId)) {
    throw new Error(`Invalid message-proxy instance ID for service ${serviceId}`);
  }
  return `${descriptor.syntheticUserPrefix}i:${instanceId.length}:${instanceId}:${externalKey}`;
}

export function parseMessageProxyIdentityUserId(userDiscId: string): ParsedMessageProxyIdentityUserId | null {
  return parseMessageProxyIdentityUserIdFromRegistry(userDiscId, messageProxyServiceRegistry);
}

export function parseMessageProxyIdentityUserIdFromRegistry<TServiceId extends string>(
  userDiscId: string,
  registry: ProxyServiceRegistry<TServiceId>,
): { serviceId: TServiceId; instanceId: string; externalKey: string } | null {
  for (const descriptor of registry.values()) {
    if (!userDiscId.startsWith(descriptor.syntheticUserPrefix)) continue;
    let externalKey = userDiscId.slice(descriptor.syntheticUserPrefix.length);
    let instanceId = `${descriptor.serviceId}:official`;
    if (externalKey.startsWith("i:")) {
      const match = /^i:(\d+):/.exec(externalKey);
      if (!match) return null;
      const length = Number(match[1]);
      const offset = match[0].length;
      instanceId = externalKey.slice(offset, offset + length);
      if (externalKey[offset + length] !== ":") return null;
      externalKey = externalKey.slice(offset + length + 1);
      if (!isCustomInstanceId(descriptor.serviceId, instanceId)) return null;
    }
    if (!descriptor.validateExternalKey(externalKey)) return null;
    return { serviceId: descriptor.serviceId, instanceId, externalKey };
  }
  return null;
}

export function isMessageProxyIdentityUserId(userDiscId: string): boolean {
  return parseMessageProxyIdentityUserId(userDiscId) !== null;
}
