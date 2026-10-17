import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import type { ProxyIdentityUpsertInput } from "@/utils/messageProxy/types";
import { getCachedUserRow } from "@/utils/cache/userCache";
import { persistMessageProxyAttestationIdentity } from "@/utils/messageProxy/persistence";
import { messageProxyRepository } from "@/utils/db/repositories/MessageProxyRepository";
import { messageProxyInstanceRepository } from "@/utils/db/repositories/MessageProxyInstanceRepository";
import { formatMessageProxyIdentityUserId } from "@/utils/messageProxy/identityUserId";
import { exportRepository } from "@/utils/db/repositories/ExportRepository";
import { importRepository } from "@/utils/db/repositories/ImportRepository";
import { userRepository } from "@/utils/db/repositories/UserRepository";
import { splitSqlStatements } from "@/utils/db/sqlSplitter";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const PRIMARY_KEY = "11111111-2222-4333-8444-555555555555";
const SECONDARY_KEY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ROLLBACK_KEY = "99999999-8888-4777-8666-555555555555";
const CASCADE_KEY = "12345678-1234-4234-8234-123456789abc";
const CUSTOM_INSTANCE_ID = "pluralkit:11111111-2222-4333-8444-555555555555";

function identityInput(
  externalKey = PRIMARY_KEY,
  overrides: Partial<ProxyIdentityUpsertInput> = {},
): ProxyIdentityUpsertInput {
  return {
    serviceId: "pluralkit",
    externalIdentityKind: "pluralkit_member",
    externalKey,
    shortId: "Mirri",
    displayName: "Mirri",
    bio: "Keeps field notes.",
    namespace: {
      namespaceKey: "fixture-account",
      shortId: "light",
      displayName: "Lighthouse",
      tag: "[LH]",
      description: "An archival collective.",
    },
    ...overrides,
  };
}

async function cleanup(): Promise<void> {
  await testSql`
    DELETE FROM users
    WHERE user_disc_id IN (
      ${`pk:${PRIMARY_KEY}`}, ${`pk:${SECONDARY_KEY}`}, ${`pk:${ROLLBACK_KEY}`},
      ${`pk:${CASCADE_KEY}`}, '_rt_message_proxy_settings', '_rt_proxy_selected_host'
      , ${formatMessageProxyIdentityUserId("pluralkit", PRIMARY_KEY, CUSTOM_INSTANCE_ID)}
    )
  `;
  await testSql`
    DELETE FROM message_proxy_namespaces
    WHERE service_id = 'pluralkit'
      AND namespace_key IN ('fixture-account', 'rollback-account', 'cascade-account')
  `;
  await testSql`DELETE FROM message_proxy_instances WHERE instance_id = ${CUSTOM_INSTANCE_ID}`;
}

describe.skipIf(!DB_TESTS_AVAILABLE)("message-proxy persistence regression", () => {
  beforeAll(async () => {
    await setupTestDb();
    await cleanup();
  });

  afterAll(cleanup);

  it("creates canonical identity state atomically and reloads it in one batch", async () => {
    expect(await messageProxyRepository.getIdentityContextByUserDiscId(`pk:${PRIMARY_KEY}`)).toBeNull();

    const result = await messageProxyRepository.persistAttestedIdentity({
      input: identityInput(),
      messageDiscId: "_rt_proxy_message_1",
      senderDiscId: "_rt_proxy_host_1",
    });

    expect(result?.isNewIdentity).toBe(true);
    expect(result?.userRow.user_disc_id).toBe(`pk:${PRIMARY_KEY}`);
    const identities = await messageProxyRepository.getMessageIdentitiesByMessageIds([
      "_rt_proxy_message_1",
      "_rt_missing_message",
    ]);
    expect(identities?.get("_rt_proxy_message_1")).toMatchObject({
      serviceId: "pluralkit",
      externalKey: PRIMARY_KEY,
      senderDiscId: "_rt_proxy_host_1",
      namespaceKey: "fixture-account",
    });
    expect(identities?.has("_rt_missing_message")).toBe(false);
    expect(await messageProxyRepository.getIdentityContextByUserDiscId(`pk:${PRIMARY_KEY}`)).toMatchObject({
      externalKey: PRIMARY_KEY,
    });
    expect((await getCachedUserRow(`pk:${PRIMARY_KEY}`))?.user_nickname).toBeNull();
  });

  it("keeps public identity, host link, and message attribution through rollback and reapplication", async () => {
    const migrations = [
      "088_message_proxy_instances",
      "089_pluralbuddy_oauth_connections",
      "090_pluralbuddy_refresh_state",
      "091_message_proxy_instance_removal",
      "092_message_proxy_instance_bot_user_id",
    ];
    const readMigration = (name: string, down: boolean) =>
      readFile(new URL(`../../../src/db/migrations/${name}${down ? ".down" : ""}.sql`, import.meta.url), "utf8").then(
        splitSqlStatements,
      );
    const upStatements = (await Promise.all(migrations.map((name) => readMigration(name, false)))).flat();
    const downStatements = (await Promise.all(migrations.toReversed().map((name) => readMigration(name, true)))).flat();

    await testSql.begin(async (tx) => {
      const [selectedHost] = await tx`
        INSERT INTO users (user_disc_id, language_pref, registration_locale, message_proxy_service, message_proxy_instance_id)
        VALUES ('_rt_proxy_selected_host', 'en-US', 'en-US', 'pluralkit', 'pluralkit:official')
        RETURNING user_id
      `;
      const [before] = await tx`
        SELECT u.user_id, ei.external_identity_id, mpn.message_proxy_namespace_id,
          mpmi.message_disc_id, mpmi.sender_disc_id, mpna.host_user_disc_id
        FROM external_identities ei
        JOIN users u ON u.user_id = ei.user_id
        JOIN message_proxy_identities mpi ON mpi.external_identity_id = ei.external_identity_id
        JOIN message_proxy_namespaces mpn ON mpn.message_proxy_namespace_id = mpi.message_proxy_namespace_id
        JOIN message_proxy_message_index mpmi ON mpmi.external_identity_id = ei.external_identity_id
        JOIN message_proxy_namespace_accounts mpna ON mpna.message_proxy_namespace_id = mpn.message_proxy_namespace_id
        WHERE u.user_disc_id = ${`pk:${PRIMARY_KEY}`} AND mpmi.message_disc_id = '_rt_proxy_message_1'
      `;
      const [memory] = await tx`
        INSERT INTO personal_memories (user_id, persona_lineage_id, content)
        VALUES (${before.user_id}, 0, 'Fixture memory')
        RETURNING personal_memory_id
      `;
      for (const statement of downStatements) await tx.unsafe(statement);
      for (const statement of upStatements) await tx.unsafe(statement);
      const [after] = await tx`
        SELECT u.user_id, ei.external_identity_id, mpn.message_proxy_namespace_id,
          mpmi.message_disc_id, mpmi.sender_disc_id, mpna.host_user_disc_id,
          ei.instance_id, mpn.instance_id AS namespace_instance_id, u.message_proxy_instance_id
        FROM external_identities ei
        JOIN users u ON u.user_id = ei.user_id
        JOIN message_proxy_identities mpi ON mpi.external_identity_id = ei.external_identity_id
        JOIN message_proxy_namespaces mpn ON mpn.message_proxy_namespace_id = mpi.message_proxy_namespace_id
        JOIN message_proxy_message_index mpmi ON mpmi.external_identity_id = ei.external_identity_id
        JOIN message_proxy_namespace_accounts mpna ON mpna.message_proxy_namespace_id = mpn.message_proxy_namespace_id
        WHERE u.user_disc_id = ${`pk:${PRIMARY_KEY}`} AND mpmi.message_disc_id = '_rt_proxy_message_1'
      `;
      expect(after).toMatchObject({
        ...before,
        instance_id: "pluralkit:official",
        namespace_instance_id: "pluralkit:official",
      });
      const [selectedAfter] = await tx`
        SELECT user_id, message_proxy_instance_id FROM users WHERE user_disc_id = '_rt_proxy_selected_host'
      `;
      expect(selectedAfter).toMatchObject({
        user_id: selectedHost.user_id,
        message_proxy_instance_id: "pluralkit:official",
      });
      const [memoryAfter] = await tx`
        SELECT personal_memory_id, user_id FROM personal_memories WHERE personal_memory_id = ${memory.personal_memory_id}
      `;
      expect(memoryAfter).toMatchObject({ personal_memory_id: memory.personal_memory_id, user_id: before.user_id });
    });
  });

  it("separates the same member and namespace keys across instances and reloads attribution", async () => {
    expect(await messageProxyInstanceRepository.getEnabled("pluralkit")).toEqual({
      serviceId: "pluralkit",
      instanceId: "pluralkit:official",
      origin: "https://api.pluralkit.me",
      displayName: "PluralKit",
      botUserId: "466378653216014359",
    });
    await testSql`
      INSERT INTO message_proxy_instances (instance_id, service_id, origin, display_name, enabled)
      VALUES (${CUSTOM_INSTANCE_ID}, 'pluralkit', 'https://fixture.example', 'Fixture', false)
    `;
    expect(await messageProxyInstanceRepository.getEnabled("pluralkit", CUSTOM_INSTANCE_ID)).toBeNull();
    const result = await messageProxyRepository.persistAttestedIdentity({
      input: identityInput(PRIMARY_KEY, { instanceId: CUSTOM_INSTANCE_ID }),
      messageDiscId: "_rt_proxy_message_custom",
      senderDiscId: "_rt_proxy_host_custom",
    });
    const customUserId = formatMessageProxyIdentityUserId("pluralkit", PRIMARY_KEY, CUSTOM_INSTANCE_ID);
    expect(result?.userRow.user_disc_id).toBe(customUserId);
    expect(result?.identity.external_identity_id).not.toBeNull();
    expect((await messageProxyRepository.getIdentityContextByUserDiscId(customUserId))?.instanceId).toBe(
      CUSTOM_INSTANCE_ID,
    );
    expect(
      (await messageProxyRepository.getMessageIdentitiesByMessageIds(["_rt_proxy_message_custom"]))?.get(
        "_rt_proxy_message_custom",
      ),
    ).toMatchObject({
      instanceId: CUSTOM_INSTANCE_ID,
      userDiscId: customUserId,
      senderDiscId: "_rt_proxy_host_custom",
    });
    expect(
      (await messageProxyRepository.getMessageIdentitiesByMessageIds(["_rt_proxy_message_1"]))?.get(
        "_rt_proxy_message_1",
      ),
    ).toMatchObject({ instanceId: "pluralkit:official", userDiscId: `pk:${PRIMARY_KEY}` });
  });

  it("hides a removed instance while retaining its identity and message attribution", async () => {
    await testSql`UPDATE message_proxy_instances SET enabled = true WHERE instance_id = ${CUSTOM_INSTANCE_ID}`;
    expect(await messageProxyInstanceRepository.getEnabled("pluralkit", CUSTOM_INSTANCE_ID)).not.toBeNull();
    await testSql`
      UPDATE message_proxy_instances
      SET enabled = false, removed_at = CURRENT_TIMESTAMP
      WHERE instance_id = ${CUSTOM_INSTANCE_ID}
    `;
    expect(await messageProxyInstanceRepository.getEnabled("pluralkit", CUSTOM_INSTANCE_ID)).toBeNull();
    expect(
      (await messageProxyInstanceRepository.listEnabled("pluralkit")).some(
        ({ instanceId }) => instanceId === CUSTOM_INSTANCE_ID,
      ),
    ).toBe(false);
    expect(
      (await messageProxyRepository.getMessageIdentitiesByMessageIds(["_rt_proxy_message_custom"]))?.get(
        "_rt_proxy_message_custom",
      )?.instanceId,
    ).toBe(CUSTOM_INSTANCE_ID);
  });

  it("is idempotent, refreshes cosmetic names, and supports multiple hosts", async () => {
    const renamed = identityInput(PRIMARY_KEY, {
      displayName: "Mirri Updated",
      namespace: {
        namespaceKey: "fixture-account",
        shortId: "light",
        displayName: "Lighthouse Updated",
        tag: "[NEW]",
        description: "Updated public description.",
      },
    });
    const result = await messageProxyRepository.persistAttestedIdentity({
      input: renamed,
      messageDiscId: "_rt_proxy_message_2",
      senderDiscId: "_rt_proxy_host_2",
    });

    expect(result?.isNewIdentity).toBe(false);
    expect(result?.userRow.user_nickname).toBeNull();
    expect(result?.namespace).toMatchObject({
      display_name: "Lighthouse Updated",
      tag: "[NEW]",
      description: "Updated public description.",
    });
    expect((await getCachedUserRow(`pk:${PRIMARY_KEY}`))?.user_nickname).toBeNull();
    const context = await messageProxyRepository.getIdentityContextByUserDiscId(`pk:${PRIMARY_KEY}`);
    expect(context?.hostUserDiscIds.sort()).toEqual(["_rt_proxy_host_1", "_rt_proxy_host_2"]);
  });

  it("keeps an existing message attribution immutable", async () => {
    await messageProxyRepository.persistAttestedIdentity({
      input: identityInput(SECONDARY_KEY),
      messageDiscId: "_rt_proxy_message_1",
      senderDiscId: "_rt_proxy_host_other",
    });

    const identities = await messageProxyRepository.getMessageIdentitiesByMessageIds(["_rt_proxy_message_1"]);
    expect(identities?.get("_rt_proxy_message_1")).toMatchObject({
      externalKey: PRIMARY_KEY,
      senderDiscId: "_rt_proxy_host_1",
    });
  });

  it("rolls back user, namespace, and identity rows when a late write fails", async () => {
    const result = await messageProxyRepository.persistAttestedIdentity({
      input: identityInput(ROLLBACK_KEY, {
        namespace: {
          namespaceKey: "rollback-account",
          shortId: null,
          displayName: "Rollback Account",
          tag: null,
          description: null,
        },
      }),
      messageDiscId: "_rt_proxy_message_rollback",
      senderDiscId: null as unknown as string,
    });

    expect(result).toBeNull();
    const [counts] = await testSql`
      SELECT
        (SELECT COUNT(*)::INT FROM users WHERE user_disc_id = ${`pk:${ROLLBACK_KEY}`}) AS users,
        (SELECT COUNT(*)::INT FROM message_proxy_namespaces WHERE namespace_key = 'rollback-account') AS namespaces,
        (SELECT COUNT(*)::INT FROM external_identities WHERE external_key = ${ROLLBACK_KEY}) AS identities,
        (SELECT COUNT(*)::INT FROM message_proxy_message_index WHERE message_disc_id = '_rt_proxy_message_rollback') AS messages
    `;
    expect(counts).toMatchObject({ users: 0, namespaces: 0, identities: 0, messages: 0 });
  });

  it("writes no canonical identity state for an identity-free attestation", async () => {
    const [before] = await testSql`
      SELECT
        (SELECT COUNT(*)::INT FROM external_identities) AS external_identities,
        (SELECT COUNT(*)::INT FROM message_proxy_namespaces) AS namespaces,
        (SELECT COUNT(*)::INT FROM message_proxy_identities) AS identities,
        (SELECT COUNT(*)::INT FROM message_proxy_namespace_accounts) AS accounts,
        (SELECT COUNT(*)::INT FROM message_proxy_message_index) AS messages
    `;

    expect(
      await persistMessageProxyAttestationIdentity({
        messageDiscId: "_rt_proxy_identity_free",
        serverDiscId: null,
        attestation: {
          serviceId: "pluralkit",
          instanceId: "pluralkit:official",
          proxyMessageId: "_rt_proxy_identity_free",
          originalMessageId: "_rt_proxy_original_identity_free",
          senderDiscordId: "_rt_proxy_host_identity_free",
          identity: null,
        },
      }),
    ).toBe("identity_free");

    const [after] = await testSql`
      SELECT
        (SELECT COUNT(*)::INT FROM external_identities) AS external_identities,
        (SELECT COUNT(*)::INT FROM message_proxy_namespaces) AS namespaces,
        (SELECT COUNT(*)::INT FROM message_proxy_identities) AS identities,
        (SELECT COUNT(*)::INT FROM message_proxy_namespace_accounts) AS accounts,
        (SELECT COUNT(*)::INT FROM message_proxy_message_index) AS messages
    `;
    expect(after).toEqual(before);
  });

  it("enforces namespace uniqueness and required lookup indexes", async () => {
    const [namespaceConstraint] = await testSql<Array<{ definition: string }>>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'message_proxy_namespaces_instance_id_namespace_key_key'
    `;
    expect(namespaceConstraint?.definition).toBe("UNIQUE (instance_id, namespace_key)");

    const indexes = await testSql<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'idx_message_proxy_identities_namespace',
          'idx_message_proxy_namespace_accounts_host',
          'idx_message_proxy_message_index_created'
        )
      ORDER BY indexname
    `;
    expect(indexes.map((row) => row.indexname)).toEqual([
      "idx_message_proxy_identities_namespace",
      "idx_message_proxy_message_index_created",
      "idx_message_proxy_namespace_accounts_host",
    ]);
  });

  it("cascades synthetic-user deletion through identity and message attribution", async () => {
    await messageProxyRepository.persistAttestedIdentity({
      input: identityInput(CASCADE_KEY, {
        namespace: {
          namespaceKey: "cascade-account",
          shortId: null,
          displayName: "Cascade Account",
          tag: null,
          description: null,
        },
      }),
      messageDiscId: "_rt_proxy_message_cascade",
      senderDiscId: "_rt_proxy_host_cascade",
    });

    await testSql`DELETE FROM users WHERE user_disc_id = ${`pk:${CASCADE_KEY}`}`;
    const [counts] = await testSql`
      SELECT
        (SELECT COUNT(*)::INT FROM external_identities WHERE external_key = ${CASCADE_KEY}) AS external_identities,
        (SELECT COUNT(*)::INT FROM message_proxy_identities cpi
          JOIN external_identities ei ON ei.external_identity_id = cpi.external_identity_id
          WHERE ei.external_key = ${CASCADE_KEY}) AS identities,
        (SELECT COUNT(*)::INT FROM message_proxy_message_index
          WHERE message_disc_id = '_rt_proxy_message_cascade') AS messages
    `;
    expect(counts).toMatchObject({ external_identities: 0, identities: 0, messages: 0 });
  });

  it("prunes only message-index rows older than the configured age", async () => {
    await testSql`
      UPDATE message_proxy_message_index
      SET created_at = NOW() - INTERVAL '40 days'
      WHERE message_disc_id = '_rt_proxy_message_1'
    `;

    expect(await messageProxyRepository.pruneMessageIndexOlderThanDays(30)).toBeGreaterThanOrEqual(1);
    const identities = await messageProxyRepository.getMessageIdentitiesByMessageIds([
      "_rt_proxy_message_1",
      "_rt_proxy_message_2",
    ]);
    expect(identities?.has("_rt_proxy_message_1")).toBe(false);
    expect(identities?.has("_rt_proxy_message_2")).toBe(true);
  });

  it("round-trips null, disabled, supported, and unknown service selections", async () => {
    for (const serviceId of [null, "none", "pluralkit", "removed_service"] as const) {
      const imported = await importRepository.importPersonalSettings("_rt_message_proxy_settings", {
        user_nickname: "Settings Fixture",
        language_pref: "en-US",
        physical_appearance_tags: [],
        persona_naming_preferences: [],
        message_proxy_service: serviceId,
      });
      expect(imported).toEqual({ success: true, itemsImported: { configFieldsCount: 3 } });
      expect((await userRepository.loadByDiscordId("_rt_message_proxy_settings"))?.message_proxy_service).toBe(
        serviceId,
      );
      expect((await userRepository.loadByDiscordId("_rt_message_proxy_settings"))?.message_proxy_instance_id).toBe(
        serviceId === "pluralkit" ? "pluralkit:official" : null,
      );

      const exported = await exportRepository.exportPersonalSettings("_rt_message_proxy_settings");
      expect(exported.success).toBe(true);
      if (exported.data?.type === "personal_settings") expect(exported.data.data.message_proxy_service).toBe(serviceId);
    }
  });

  it("preserves a stored selection when an older import omits the field", async () => {
    const imported = await importRepository.importPersonalSettings("_rt_message_proxy_settings", {
      user_nickname: "Settings Fixture",
      language_pref: "en-US",
      physical_appearance_tags: [],
      persona_naming_preferences: [],
    });

    expect(imported.success).toBe(true);
    expect((await userRepository.loadByDiscordId("_rt_message_proxy_settings"))?.message_proxy_service).toBe(
      "removed_service",
    );
  });
});
