import {
  type MessageProxyIdentityRow,
  type MessageProxyNamespaceRow,
  type UserRow,
  messageProxyIdentitySchema,
  messageProxyNamespaceSchema,
} from "@/types/db/schema";
import { invalidateUserCache } from "@/utils/cache/userCache";
import type {
  MessageProxyIdentityContext,
  MessageProxyIdentityReference,
  MessageProxyIndexedMessageIdentity,
  ProxyIdentityUpsertInput,
} from "@/utils/messageProxy/types";
import { formatMessageProxyIdentityUserId, parseMessageProxyIdentityUserId } from "@/utils/messageProxy/identityUserId";
import { getProxyServiceDescriptor } from "@/utils/messageProxy/registry";
import { sql } from "@/utils/db/client";
import { userRepository } from "@/utils/db/repositories/UserRepository";
import { log } from "@/utils/misc/logger";

export type MessageProxyIdentityUpsertResult = {
  userRow: UserRow;
  namespace: MessageProxyNamespaceRow;
  identity: MessageProxyIdentityRow;
  isNewIdentity: boolean;
};

export type MessageProxyManagedIdentity = {
  identityId: number;
  userId: number;
  userDiscId: string;
  serviceId: string;
  instanceId: string;
  instanceDisplayName: string;
  displayName: string;
  avatarUrl: string | null;
};

type ManagedIdentityRow = {
  message_proxy_identity_id: number | string;
  user_id: number | string;
  user_disc_id: string;
  service_id: string;
  instance_id: string;
  instance_display_name: string;
  display_name: string | null;
  short_id: string | null;
  user_nickname: string | null;
  avatar_url: string | null;
};

type MessageProxyIdentityReferenceRow = {
  service_id: string;
  instance_id: string;
  user_disc_id: string;
  display_name: string | null;
  user_nickname: string | null;
};

type MessageProxyContextRow = {
  service_id: string;
  instance_id: string;
  user_disc_id: string;
  external_identity_id: number | string;
  external_key: string;
  identity_short_id: string | null;
  display_name: string | null;
  message_proxy_namespace_id: number | string;
  namespace_key: string;
  namespace_short_id: string | null;
  namespace_display_name: string | null;
  namespace_tag: string | null;
  namespace_description: string | null;
  host_user_disc_ids?: string[] | string | null;
};

type MessageProxyIndexedMessageIdentityRow = MessageProxyContextRow & {
  message_disc_id: string;
  sender_disc_id: string;
};

const CONTEXT_CACHE_MAX_ENTRIES = 2000;

class MessageProxyRepository {
  private readonly identityContextByUserDiscId = new Map<string, MessageProxyIdentityContext | null>();

  async listManagedIdentities(hostUserDiscId: string, search = ""): Promise<MessageProxyManagedIdentity[]> {
    try {
      const rows = await sql<ManagedIdentityRow[]>`
        SELECT mpi.message_proxy_identity_id, u.user_id, u.user_disc_id, mpn.service_id, mpn.instance_id,
          mpi_catalog.display_name AS instance_display_name,
          mpi.display_name, mpi.short_id, mpi.avatar_url, upc.user_nickname
        FROM message_proxy_namespace_accounts mpna
        JOIN message_proxy_namespaces mpn ON mpn.message_proxy_namespace_id = mpna.message_proxy_namespace_id
        JOIN message_proxy_instances mpi_catalog ON mpi_catalog.instance_id = mpn.instance_id
        JOIN message_proxy_identities mpi ON mpi.message_proxy_namespace_id = mpn.message_proxy_namespace_id
        JOIN external_identities ei ON ei.external_identity_id = mpi.external_identity_id
          AND ei.instance_id = mpn.instance_id
        JOIN users u ON u.user_id = ei.user_id
        LEFT JOIN user_personalization_configs upc ON upc.user_id = u.user_id
        WHERE mpna.host_user_disc_id = ${hostUserDiscId}
          AND position(lower(${search.trim()}) in lower(concat_ws(' ', upc.user_nickname, mpi.display_name, mpi.short_id, mpn.service_id))) > 0
        ORDER BY coalesce(upc.user_nickname, mpi.display_name, mpi.short_id, u.user_disc_id), mpn.service_id
        LIMIT 25
      `;
      return rows.flatMap((row) => this.parseManagedIdentity(row));
    } catch (error) {
      log.error("Failed to list managed message-proxy identities", error);
      return [];
    }
  }

  async getManagedIdentity(hostUserDiscId: string, identityId: number): Promise<MessageProxyManagedIdentity | null> {
    if (!Number.isSafeInteger(identityId) || identityId <= 0) return null;
    try {
      const [row] = await sql<ManagedIdentityRow[]>`
        SELECT mpi.message_proxy_identity_id, u.user_id, u.user_disc_id, mpn.service_id, mpn.instance_id,
          mpi_catalog.display_name AS instance_display_name,
          mpi.display_name, mpi.short_id, mpi.avatar_url, upc.user_nickname
        FROM message_proxy_namespace_accounts mpna
        JOIN message_proxy_namespaces mpn ON mpn.message_proxy_namespace_id = mpna.message_proxy_namespace_id
        JOIN message_proxy_instances mpi_catalog ON mpi_catalog.instance_id = mpn.instance_id
        JOIN message_proxy_identities mpi ON mpi.message_proxy_namespace_id = mpn.message_proxy_namespace_id
        JOIN external_identities ei ON ei.external_identity_id = mpi.external_identity_id
          AND ei.instance_id = mpn.instance_id
        JOIN users u ON u.user_id = ei.user_id
        LEFT JOIN user_personalization_configs upc ON upc.user_id = u.user_id
        WHERE mpna.host_user_disc_id = ${hostUserDiscId}
          AND mpi.message_proxy_identity_id = ${identityId}
        LIMIT 1
      `;
      return row ? (this.parseManagedIdentity(row)[0] ?? null) : null;
    } catch (error) {
      log.error("Failed to load managed message-proxy identity", error);
      return null;
    }
  }

  private parseManagedIdentity(row: ManagedIdentityRow): MessageProxyManagedIdentity[] {
    const identityId = Number(row.message_proxy_identity_id);
    const userId = Number(row.user_id);
    const parsed = parseMessageProxyIdentityUserId(row.user_disc_id);
    if (
      !Number.isSafeInteger(identityId) ||
      !Number.isSafeInteger(userId) ||
      parsed?.serviceId !== row.service_id ||
      parsed.instanceId !== row.instance_id
    ) {
      return [];
    }
    return [
      {
        identityId,
        userId,
        userDiscId: row.user_disc_id,
        serviceId: row.service_id,
        instanceId: row.instance_id,
        instanceDisplayName: row.instance_display_name,
        displayName:
          row.user_nickname?.trim() || row.display_name?.trim() || row.short_id?.trim() || parsed.externalKey,
        avatarUrl: row.avatar_url,
      },
    ];
  }

  async persistAttestedIdentity(args: {
    input: ProxyIdentityUpsertInput;
    messageDiscId: string;
    senderDiscId: string;
  }): Promise<MessageProxyIdentityUpsertResult | null> {
    const { input } = args;
    const descriptor = getProxyServiceDescriptor(input.serviceId);
    if (
      !descriptor ||
      descriptor.externalIdentityKind !== input.externalIdentityKind ||
      !descriptor.validateExternalKey(input.externalKey)
    ) {
      log.warn(`Rejected invalid message-proxy identity input for service ${input.serviceId}`);
      return null;
    }

    const instanceId = input.instanceId ?? `${descriptor.serviceId}:official`;
    const userDiscId = formatMessageProxyIdentityUserId(descriptor.serviceId, input.externalKey, instanceId);
    try {
      const persisted = await sql.begin(async (tx) => {
        const [user] = await tx`
          INSERT INTO users (user_disc_id, language_pref, registration_locale)
          VALUES (${userDiscId}, 'en', 'en')
          ON CONFLICT (user_disc_id) DO UPDATE SET user_disc_id = EXCLUDED.user_disc_id
          RETURNING user_id
        `;
        if (!user?.user_id) throw new Error("Synthetic user upsert returned no identifier");

        const [namespaceRow] = await tx`
          INSERT INTO message_proxy_namespaces (
            service_id, instance_id, namespace_key, short_id, display_name, tag, description
          )
          VALUES (
            ${input.serviceId}, ${instanceId}, ${input.namespace.namespaceKey}, ${input.namespace.shortId},
            ${input.namespace.displayName}, ${input.namespace.tag}, ${input.namespace.description}
          )
          ON CONFLICT (instance_id, namespace_key) DO UPDATE SET
            short_id = EXCLUDED.short_id,
            display_name = EXCLUDED.display_name,
            tag = EXCLUDED.tag,
            description = EXCLUDED.description,
            updated_at = NOW()
          RETURNING
            message_proxy_namespace_id, service_id, instance_id, namespace_key, short_id,
            display_name, tag, description, created_at, updated_at
        `;
        if (!namespaceRow?.message_proxy_namespace_id) {
          throw new Error("Message-proxy namespace upsert returned no identifier");
        }

        const [insertedExternalIdentity] = await tx`
          INSERT INTO external_identities (kind, instance_id, external_key, user_id)
          VALUES (${input.externalIdentityKind}, ${instanceId}, ${input.externalKey}, ${user.user_id})
          ON CONFLICT (kind, instance_id, external_key) DO NOTHING
          RETURNING external_identity_id, user_id
        `;
        const [externalIdentity] = insertedExternalIdentity
          ? [insertedExternalIdentity]
          : await tx`
              SELECT external_identity_id, user_id
              FROM external_identities
              WHERE kind = ${input.externalIdentityKind} AND instance_id = ${instanceId} AND external_key = ${input.externalKey}
              LIMIT 1
            `;
        if (!externalIdentity?.external_identity_id) {
          throw new Error("External identity upsert returned no identifier");
        }
        if (Number(externalIdentity.user_id) !== Number(user.user_id)) {
          throw new Error("External identity resolved to a different synthetic user");
        }

        // Naming and profile writes require a personalization row. A null nickname leaves the
        // service display name active until the user explicitly sets an override. Pronouns are
        // seeded only when the statement above was the insert that first registered the
        // identity, so a repeat attestation never revisits the column and an edit made through
        // the personalization panel or a chat tool outlives every later proxy message.
        const seededPronouns = insertedExternalIdentity ? (input.pronouns?.trim() ?? "") : "";
        await tx`
          INSERT INTO user_personalization_configs (user_id, user_nickname, pronouns)
          VALUES (${user.user_id}, NULL, ${seededPronouns || null})
          ON CONFLICT (user_id) DO NOTHING
        `;

        const [identityRow] = await tx`
          INSERT INTO message_proxy_identities (
            message_proxy_namespace_id, external_identity_id, short_id, display_name, avatar_url
          )
          VALUES (
            ${namespaceRow.message_proxy_namespace_id}, ${externalIdentity.external_identity_id},
            ${input.shortId}, ${input.displayName}, ${input.avatarUrl ?? null}
          )
          ON CONFLICT (external_identity_id) DO UPDATE SET
            message_proxy_namespace_id = EXCLUDED.message_proxy_namespace_id,
            short_id = EXCLUDED.short_id,
            display_name = EXCLUDED.display_name,
            avatar_url = EXCLUDED.avatar_url,
            updated_at = NOW()
          RETURNING
            message_proxy_identity_id, message_proxy_namespace_id, external_identity_id,
            short_id, display_name, avatar_url, created_at, updated_at
        `;
        if (!identityRow?.message_proxy_identity_id) {
          throw new Error("Message-proxy identity upsert returned no identifier");
        }

        await tx`
          INSERT INTO message_proxy_namespace_accounts (message_proxy_namespace_id, host_user_disc_id)
          VALUES (${namespaceRow.message_proxy_namespace_id}, ${args.senderDiscId})
          ON CONFLICT (message_proxy_namespace_id, host_user_disc_id) DO NOTHING
        `;
        await tx`
          INSERT INTO message_proxy_message_index (message_disc_id, external_identity_id, sender_disc_id)
          VALUES (${args.messageDiscId}, ${externalIdentity.external_identity_id}, ${args.senderDiscId})
          ON CONFLICT (message_disc_id) DO NOTHING
        `;

        return {
          namespaceRow,
          identityRow,
          isNewIdentity: Boolean(insertedExternalIdentity),
        };
      });

      const namespace = this.parseNamespaceRow(
        persisted.namespaceRow,
        `${input.serviceId}:${input.namespace.namespaceKey}`,
      );
      const identity = this.parseIdentityRow(persisted.identityRow, `${input.serviceId}:${input.externalKey}`);
      if (!namespace || !identity) return null;
      invalidateUserCache(userDiscId);
      this.identityContextByUserDiscId.clear();
      const userRow = await userRepository.loadByDiscordId(userDiscId);
      if (!userRow) return null;
      return { userRow, namespace, identity, isNewIdentity: persisted.isNewIdentity };
    } catch (error) {
      log.error(`Error persisting message-proxy identity ${input.serviceId}:${input.externalKey}:`, error);
      return null;
    }
  }

  async getMessageIdentitiesByMessageIds(
    messageDiscIds: string[],
  ): Promise<Map<string, MessageProxyIndexedMessageIdentity> | null> {
    const result = new Map<string, MessageProxyIndexedMessageIdentity>();
    if (messageDiscIds.length === 0) return result;
    try {
      const rows = await sql<MessageProxyIndexedMessageIdentityRow[]>`
        SELECT
          cpmi.message_disc_id,
          cpmi.sender_disc_id,
          cpn.service_id,
          cpn.instance_id,
          u.user_disc_id,
          ei.external_identity_id,
          ei.external_key,
          cpi.short_id AS identity_short_id,
          cpi.display_name,
          cpn.message_proxy_namespace_id,
          cpn.namespace_key,
          cpn.short_id AS namespace_short_id,
          cpn.display_name AS namespace_display_name,
          cpn.tag AS namespace_tag,
          cpn.description AS namespace_description,
          COALESCE(
            array_agg(DISTINCT cpna.host_user_disc_id) FILTER (WHERE cpna.host_user_disc_id IS NOT NULL),
            ARRAY[]::TEXT[]
          ) AS host_user_disc_ids
        FROM message_proxy_message_index cpmi
        JOIN external_identities ei ON ei.external_identity_id = cpmi.external_identity_id
        JOIN users u ON u.user_id = ei.user_id
        JOIN message_proxy_identities cpi ON cpi.external_identity_id = ei.external_identity_id
        JOIN message_proxy_namespaces cpn ON cpn.message_proxy_namespace_id = cpi.message_proxy_namespace_id
          AND cpn.instance_id = ei.instance_id
        LEFT JOIN message_proxy_namespace_accounts cpna
          ON cpna.message_proxy_namespace_id = cpn.message_proxy_namespace_id
        WHERE cpmi.message_disc_id = ANY(${sql.array(messageDiscIds, "TEXT")})
        GROUP BY
          cpmi.message_disc_id, cpmi.sender_disc_id, cpn.service_id, cpn.instance_id, u.user_disc_id,
          ei.external_identity_id, ei.external_key, cpi.short_id, cpi.display_name,
          cpn.message_proxy_namespace_id, cpn.namespace_key, cpn.short_id,
          cpn.display_name, cpn.tag, cpn.description
      `;
      for (const row of rows) {
        const context = this.parseContextRow(row, `message ${row.message_disc_id}`);
        if (!context || !row.sender_disc_id) continue;
        const identity = { ...context, messageDiscId: row.message_disc_id, senderDiscId: row.sender_disc_id };
        result.set(identity.messageDiscId, identity);
        this.rememberContext(identity.userDiscId, context);
      }
      return result;
    } catch (error) {
      log.error(`Error loading message-proxy message identities (${messageDiscIds.length} ids):`, error);
      return null;
    }
  }

  async getIdentityContextByUserDiscId(userDiscId: string): Promise<MessageProxyIdentityContext | null> {
    if (!parseMessageProxyIdentityUserId(userDiscId)) return null;
    if (this.identityContextByUserDiscId.has(userDiscId)) {
      return this.identityContextByUserDiscId.get(userDiscId) ?? null;
    }
    try {
      const [row] = await sql<MessageProxyContextRow[]>`
        SELECT
          cpn.service_id,
          cpn.instance_id,
          u.user_disc_id,
          ei.external_identity_id,
          ei.external_key,
          cpi.short_id AS identity_short_id,
          cpi.display_name,
          cpn.message_proxy_namespace_id,
          cpn.namespace_key,
          cpn.short_id AS namespace_short_id,
          cpn.display_name AS namespace_display_name,
          cpn.tag AS namespace_tag,
          cpn.description AS namespace_description,
          COALESCE(
            array_agg(DISTINCT cpna.host_user_disc_id) FILTER (WHERE cpna.host_user_disc_id IS NOT NULL),
            ARRAY[]::TEXT[]
          ) AS host_user_disc_ids
        FROM users u
        JOIN external_identities ei ON ei.user_id = u.user_id
        JOIN message_proxy_identities cpi ON cpi.external_identity_id = ei.external_identity_id
        JOIN message_proxy_namespaces cpn ON cpn.message_proxy_namespace_id = cpi.message_proxy_namespace_id
          AND cpn.instance_id = ei.instance_id
        LEFT JOIN message_proxy_namespace_accounts cpna
          ON cpna.message_proxy_namespace_id = cpn.message_proxy_namespace_id
        WHERE u.user_disc_id = ${userDiscId}
        GROUP BY
          cpn.service_id, cpn.instance_id, u.user_disc_id, ei.external_identity_id, ei.external_key,
          cpi.short_id, cpi.display_name, cpn.message_proxy_namespace_id,
          cpn.namespace_key, cpn.short_id, cpn.display_name, cpn.tag, cpn.description
        LIMIT 1
      `;
      const context = row ? this.parseContextRow(row, `user ${userDiscId}`) : null;
      this.rememberContext(userDiscId, context);
      return context;
    } catch (error) {
      log.error(`Error loading message-proxy identity context for ${userDiscId}:`, error);
      return null;
    }
  }

  async loadContextReferenceIdentities(params: {
    hostUserDiscIds: readonly string[];
    normalizedHistoryText: string;
  }): Promise<MessageProxyIdentityReference[]> {
    const hostUserDiscIds = [...new Set(params.hostUserDiscIds)];
    const normalizedHistoryText = params.normalizedHistoryText.trim().toLowerCase().replace(/\s+/g, " ");
    if (hostUserDiscIds.length === 0 || !normalizedHistoryText) return [];
    try {
      const rows = await sql<MessageProxyIdentityReferenceRow[]>`
        SELECT DISTINCT cpn.service_id, cpn.instance_id, u.user_disc_id, cpi.display_name, upc.user_nickname
        FROM message_proxy_identities cpi
        JOIN external_identities ei ON ei.external_identity_id = cpi.external_identity_id
        JOIN users u ON u.user_id = ei.user_id
        LEFT JOIN user_personalization_configs upc ON upc.user_id = u.user_id
        JOIN message_proxy_namespaces cpn ON cpn.message_proxy_namespace_id = cpi.message_proxy_namespace_id
          AND cpn.instance_id = ei.instance_id
        JOIN message_proxy_namespace_accounts cpna
          ON cpna.message_proxy_namespace_id = cpn.message_proxy_namespace_id
        WHERE cpna.host_user_disc_id = ANY(${sql.array(hostUserDiscIds, "TEXT")})
          AND (
            (btrim(cpi.display_name) <> '' AND position(
              regexp_replace(lower(trim(cpi.display_name)), '[[:space:]]+', ' ', 'g')
              IN ${normalizedHistoryText}
            ) > 0)
            OR
            (btrim(upc.user_nickname) <> '' AND position(
              regexp_replace(lower(trim(upc.user_nickname)), '[[:space:]]+', ' ', 'g')
              IN ${normalizedHistoryText}
            ) > 0)
          )
      `;
      return rows.flatMap((row) => {
        const parsed = parseMessageProxyIdentityUserId(String(row.user_disc_id));
        if (!parsed || parsed.serviceId !== row.service_id || parsed.instanceId !== row.instance_id) return [];
        return [
          {
            serviceId: parsed.serviceId,
            userDiscId: String(row.user_disc_id),
            displayName: row.display_name,
            savedNickname: row.user_nickname,
          },
        ];
      });
    } catch (error) {
      log.error("Error loading message-proxy context reference identities:", error);
      return [];
    }
  }

  async pruneMessageIndexOlderThanDays(retentionDays: number): Promise<number> {
    try {
      const rows = await sql<Array<{ message_disc_id: string }>>`
        DELETE FROM message_proxy_message_index
        WHERE created_at < NOW() - make_interval(days => ${retentionDays})
        RETURNING message_disc_id
      `;
      return rows.length;
    } catch (error) {
      log.error(`Error pruning message-proxy message index older than ${retentionDays} days:`, error);
      return 0;
    }
  }

  private rememberContext(userDiscId: string, context: MessageProxyIdentityContext | null): void {
    if (
      !this.identityContextByUserDiscId.has(userDiscId) &&
      this.identityContextByUserDiscId.size >= CONTEXT_CACHE_MAX_ENTRIES
    ) {
      const oldestKey = this.identityContextByUserDiscId.keys().next().value;
      if (oldestKey) this.identityContextByUserDiscId.delete(oldestKey);
    }
    this.identityContextByUserDiscId.set(userDiscId, context);
  }

  private parseNamespaceRow(row: unknown, context: string): MessageProxyNamespaceRow | null {
    const parsed = messageProxyNamespaceSchema.safeParse(row);
    if (!parsed.success) {
      log.warn(`Invalid message_proxy_namespaces row for ${context}: ${parsed.error.message}`);
      return null;
    }
    return parsed.data;
  }

  private parseIdentityRow(row: unknown, context: string): MessageProxyIdentityRow | null {
    const parsed = messageProxyIdentitySchema.safeParse(row);
    if (!parsed.success) {
      log.warn(`Invalid message_proxy_identities row for ${context}: ${parsed.error.message}`);
      return null;
    }
    return parsed.data;
  }

  private parseContextRow(row: MessageProxyContextRow, context: string): MessageProxyIdentityContext | null {
    const externalIdentityId = Number(row.external_identity_id);
    const namespaceId = Number(row.message_proxy_namespace_id);
    const parsedUserId = parseMessageProxyIdentityUserId(String(row.user_disc_id));
    const descriptor = getProxyServiceDescriptor(row.service_id);
    if (
      !Number.isSafeInteger(externalIdentityId) ||
      !Number.isSafeInteger(namespaceId) ||
      !parsedUserId ||
      !descriptor ||
      parsedUserId.serviceId !== descriptor.serviceId ||
      parsedUserId.instanceId !== row.instance_id ||
      parsedUserId.externalKey !== String(row.external_key)
    ) {
      log.warn(`Invalid message-proxy context row for ${context}`);
      return null;
    }
    return {
      serviceId: descriptor.serviceId,
      instanceId: row.instance_id,
      userDiscId: String(row.user_disc_id),
      externalIdentityId,
      externalKey: String(row.external_key),
      identityShortId: row.identity_short_id ?? null,
      displayName: row.display_name ?? null,
      namespaceId,
      namespaceKey: String(row.namespace_key),
      namespaceShortId: row.namespace_short_id ?? null,
      namespaceDisplayName: row.namespace_display_name ?? null,
      namespaceTag: row.namespace_tag ?? null,
      namespaceDescription: row.namespace_description ?? null,
      hostUserDiscIds: this.parseTextArray(row.host_user_disc_ids),
    };
  }

  private parseTextArray(value: string[] | string | null | undefined): string[] {
    if (Array.isArray(value)) return value.map(String).filter((entry) => entry.trim().length > 0);
    if (typeof value !== "string" || !value.trim()) return [];
    return value
      .replace(/^\{|\}$/g, "")
      .split(",")
      .map((entry) => entry.replace(/^"|"$/g, "").trim())
      .filter(Boolean);
  }
}

export const messageProxyRepository = new MessageProxyRepository();
