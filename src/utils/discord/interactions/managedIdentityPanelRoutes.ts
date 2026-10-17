import type { AutocompleteInteraction } from "discord.js";
import {
  messageProxyRepository,
  type MessageProxyManagedIdentity,
} from "@/utils/db/repositories/MessageProxyRepository";
import { buildInteractionRouteId, type ParsedInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import { localizer } from "@/utils/text/localizer";

export const IDENTITY_CONFIG_VERSION = "v3";
export const IDENTITY_MEMORIES_VERSION = "v2";

export function parseManagedIdentityRoute(
  parsed: ParsedInteractionRoute,
  originalVersion: string,
): { identityId: number; original: ParsedInteractionRoute } | null {
  const [rawIdentityId, ...segments] = parsed.segments;
  const identityId = Number(rawIdentityId);
  if (!Number.isSafeInteger(identityId) || identityId <= 0 || segments.length === 0) return null;
  return {
    identityId,
    original: { namespace: parsed.namespace, version: originalVersion, segments },
  };
}

export function rewriteManagedIdentityRouteIds(
  value: unknown,
  namespace: string,
  oldVersion: string,
  newVersion: string,
  identityId: number,
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) rewriteManagedIdentityRouteIds(item, namespace, oldVersion, newVersion, identityId);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if ((key === "customId" || key === "custom_id") && typeof item === "string") {
      const prefix = `${namespace}:${oldVersion}:`;
      if (item.startsWith(prefix)) {
        const segments = item.slice(prefix.length).split(":");
        record[key] = buildInteractionRouteId(namespace, newVersion, String(identityId), ...segments);
      }
    } else {
      rewriteManagedIdentityRouteIds(item, namespace, oldVersion, newVersion, identityId);
    }
  }
}

export function parseIdentityOption(raw: string | null): number | null {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export async function autocompleteManagedIdentity(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused();
  const identities = await messageProxyRepository.listManagedIdentities(interaction.user.id, focused);
  await interaction.respond(
    identities.map((identity) => ({
      name: formatManagedIdentityLabel(identity, interaction.locale).slice(0, 100),
      value: String(identity.identityId),
    })),
  );
}

export function formatManagedIdentityLabel(identity: MessageProxyManagedIdentity, locale: string): string {
  const serviceKey =
    identity.serviceId === "pluralkit"
      ? "commands.personal.message-proxy.pluralkit_option"
      : "commands.personal.message-proxy.pluralbuddy_option";
  const serviceName = localizer(locale, serviceKey);
  const instanceLabel =
    identity.instanceId === `${identity.serviceId}:official`
      ? serviceName
      : `${serviceName}: ${identity.instanceDisplayName}`;
  return `${identity.displayName} (${instanceLabel})`;
}
