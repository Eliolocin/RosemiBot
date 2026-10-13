import type { ProxyServiceId } from "@/utils/messageProxy/registry";
import type { MessageProxyInstanceContext } from "@/utils/messageProxy/instances";

const officialInstances = {
  pluralkit: { serviceId: "pluralkit", instanceId: "pluralkit:official", origin: "https://api.pluralkit.me" },
  pluralbuddy: { serviceId: "pluralbuddy", instanceId: "pluralbuddy:official", origin: "https://pluralbuddy.app" },
} as const satisfies Record<ProxyServiceId, MessageProxyInstanceContext>;

export function officialMessageProxyInstanceFixture(serviceId: ProxyServiceId): MessageProxyInstanceContext {
  return officialInstances[serviceId];
}
