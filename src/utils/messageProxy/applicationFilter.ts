import type { Message } from "discord.js";
import type { MessageProxyInstanceContext } from "@/utils/messageProxy/instances";

/** Filtering on a stale ID would end attribution for good if the bot's application changed: a skipped message can never teach the new one. */
const APPLICATION_ID_TTL_MS = 60 * 60 * 1000;

export interface ApplicationIdFilter {
  canAttest(message: Message, instance: MessageProxyInstanceContext): boolean;
  record(message: Message, instance: MessageProxyInstanceContext): void;
}

// Learned, not configured: each custom instance runs its own bot. Only a service-confirmed message may teach the ID.
export function createApplicationIdFilter(): ApplicationIdFilter {
  const learned = new Map<string, { applicationId: string; verifiedAt: number }>();
  const keyOf = (instance: MessageProxyInstanceContext) => `${instance.instanceId}\0${instance.origin}`;

  return {
    canAttest(message, instance) {
      const known = learned.get(keyOf(instance));
      if (!known || Date.now() - known.verifiedAt > APPLICATION_ID_TTL_MS) return true;
      return message.applicationId === known.applicationId;
    },
    record(message, instance) {
      if (!message.applicationId) return;
      learned.set(keyOf(instance), { applicationId: message.applicationId, verifiedAt: Date.now() });
    },
  };
}
