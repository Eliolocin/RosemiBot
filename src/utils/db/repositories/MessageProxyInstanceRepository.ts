import { sql } from "@/utils/db/client";
import { canonicalMessageProxyOrigin, type MessageProxyInstanceContext } from "@/utils/messageProxy/instances";
import { getProxyServiceDescriptor } from "@/utils/messageProxy/registry";
import { log } from "@/utils/misc/logger";

type InstanceRow = {
  instance_id: string;
  service_id: string;
  origin: string;
  enabled: boolean;
  display_name: string;
  bot_user_id: string | null;
};

type SelectableMessageProxyInstance = MessageProxyInstanceContext & { displayName: string };

class MessageProxyInstanceRepository {
  async getEnabled(serviceId: string, instanceId?: string | null): Promise<SelectableMessageProxyInstance | null> {
    const descriptor = getProxyServiceDescriptor(serviceId);
    if (!descriptor) return null;
    const selectedId = instanceId ?? `${serviceId}:official`;
    try {
      const [row] = await sql<InstanceRow[]>`
        SELECT instance_id, service_id, origin, display_name, bot_user_id, enabled
        FROM message_proxy_instances
        WHERE instance_id = ${selectedId} AND service_id = ${serviceId} AND removed_at IS NULL
        LIMIT 1
      `;
      if (!row?.enabled || canonicalMessageProxyOrigin(row.origin) !== row.origin) return null;
      return {
        serviceId: descriptor.serviceId,
        instanceId: row.instance_id,
        origin: row.origin,
        displayName: row.display_name,
        botUserId: row.bot_user_id,
      };
    } catch (error) {
      log.error("Failed to load message-proxy instance", error);
      return null;
    }
  }

  async listEnabled(serviceId: string, search = ""): Promise<SelectableMessageProxyInstance[]> {
    const descriptor = getProxyServiceDescriptor(serviceId);
    if (!descriptor) return [];
    try {
      const rows = await sql<InstanceRow[]>`
        SELECT instance_id, service_id, origin, display_name, bot_user_id, enabled
        FROM message_proxy_instances
        WHERE service_id = ${serviceId} AND enabled = true AND removed_at IS NULL
          AND position(lower(${search.trim()}) in lower(display_name || ' ' || origin)) > 0
        ORDER BY CASE WHEN instance_id = ${`${serviceId}:official`} THEN 0 ELSE 1 END, display_name
        LIMIT 25
      `;
      return rows.flatMap((row) =>
        canonicalMessageProxyOrigin(row.origin) === row.origin
          ? [
              {
                serviceId: descriptor.serviceId,
                instanceId: row.instance_id,
                origin: row.origin,
                displayName: row.display_name,
                botUserId: row.bot_user_id,
              },
            ]
          : [],
      );
    } catch (error) {
      log.error("Failed to list message-proxy instances", error);
      return [];
    }
  }
}

export const messageProxyInstanceRepository = new MessageProxyInstanceRepository();
