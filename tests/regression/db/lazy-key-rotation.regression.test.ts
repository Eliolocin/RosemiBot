import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { toolRepository } from "@/utils/db/repositories/ToolRepository";
import { getOptApiKey } from "@/utils/security/crypto";
import { keyManager } from "@/utils/security/keyManager";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";
import { useFullEnvSandbox } from "../../helpers/env";

const KEYS = {
  CRYPTO_SECRET_V1: "synthetic_lazy_rotation_v1_secret_value",
  CRYPTO_SECRET_V2: "synthetic_lazy_rotation_v2_secret_value",
};
const ORIGINAL = "synthetic_original_credential";
const REPLACEMENT = "synthetic_replacement_credential";

/** Waits until another session's UPDATE is queued behind the row lock the test transaction holds. */
async function waitForBlockedUpdate(table: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [row] = await testSql<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE ${`%UPDATE%${table}%`}
    `;
    if ((row?.waiting ?? 0) > 0) return;
    await Bun.sleep(20);
  }
  throw new Error(`No UPDATE on ${table} waited for the test lock.`);
}

describe.skipIf(!DB_TESTS_AVAILABLE)("runtime lazy key rotation", () => {
  let serverId: number;
  useFullEnvSandbox();

  async function decryptStored(table: string, column: string, id: string, idValue: number) {
    const [row] = await testSql<{ plaintext: string; key_version: number | null }[]>`
      SELECT pgp_sym_decrypt(${testSql(column)}, ${KEYS.CRYPTO_SECRET_V2}) AS plaintext, key_version
      FROM ${testSql(`public.${table}`)} WHERE ${testSql(id)} = ${idValue}
    `;
    return row;
  }

  beforeAll(async () => {
    await setupTestDb();
    for (const name of Object.keys(process.env)) if (name.startsWith("CRYPTO_SECRET")) delete process.env[name];
    Object.assign(process.env, KEYS, { CRYPTO_SECRET_CURRENT: "2" });
    keyManager.initialize();
    const [server] =
      await testSql`INSERT INTO servers (server_disc_id) VALUES ('_lazy_rotation_server') RETURNING server_id`;
    serverId = server.server_id;
  });

  afterAll(async () => {
    await testSql`DELETE FROM discord_managed_webhooks WHERE guild_disc_id = '_lazy_rotation_guild'`;
    await testSql`DELETE FROM servers WHERE server_id = ${serverId}`;
    keyManager.initialize();
  });

  it("never writes a stale credential over one replaced after the read", async () => {
    const v1 = (plaintext: string) => testSql`pgp_sym_encrypt(${plaintext}, ${KEYS.CRYPTO_SECRET_V1})`;
    const v2 = (plaintext: string) => testSql`pgp_sym_encrypt(${plaintext}, ${KEYS.CRYPTO_SECRET_V2})`;
    const [webhook] = await testSql`
      INSERT INTO discord_managed_webhooks (guild_disc_id, kind, channel_disc_id, webhook_disc_id, webhook_token, key_version)
      VALUES ('_lazy_rotation_guild', 'persona', '_lazy_rotation_channel', '_lazy_rotation_webhook', ${v1(ORIGINAL)}, NULL)
      RETURNING *
    `;
    const [mcp] = await testSql`
      INSERT INTO guild_mcp_servers (server_id, name, url, auth_token, key_version)
      VALUES (${serverId}, 'lazy-rotation', 'https://mcp.example', ${v1(ORIGINAL)}, 1)
      RETURNING *
    `;
    const [opt] = await testSql`
      INSERT INTO opt_api_keys (server_id, service_name, api_key, key_version)
      VALUES (${serverId}, 'brave-search', ${v1(ORIGINAL)}, 1)
      RETURNING opt_api_key_id
    `;

    // Repository callers load the row first and decrypt it later, so a stale row is the real race.
    await testSql`UPDATE discord_managed_webhooks SET webhook_token = ${v2(REPLACEMENT)}, key_version = 2 WHERE managed_webhook_id = ${webhook.managed_webhook_id}`;
    await testSql`UPDATE guild_mcp_servers SET auth_token = ${v2(REPLACEMENT)}, key_version = 2 WHERE guild_mcp_id = ${mcp.guild_mcp_id}`;
    await serverRepository.decryptManagedWebhookToken(webhook);
    await toolRepository.decryptMcpAuthToken(mcp);

    // getOptApiKey reads and rotates in one call, so the test holds the row lock between the two.
    let optRead: Promise<string | null> | undefined;
    await testSql.begin(async (tx) => {
      await tx`UPDATE opt_api_keys SET api_key = ${v2(REPLACEMENT)}, key_version = 2 WHERE opt_api_key_id = ${opt.opt_api_key_id}`;
      optRead = getOptApiKey(serverId, "brave-search");
      await waitForBlockedUpdate("opt_api_keys");
    });
    expect(await optRead).toBe(ORIGINAL);

    const stored = {
      webhook: await decryptStored(
        "discord_managed_webhooks",
        "webhook_token",
        "managed_webhook_id",
        webhook.managed_webhook_id,
      ),
      mcp: await decryptStored("guild_mcp_servers", "auth_token", "guild_mcp_id", mcp.guild_mcp_id),
      opt: await decryptStored("opt_api_keys", "api_key", "opt_api_key_id", opt.opt_api_key_id),
    };
    expect(stored).toEqual({
      webhook: { plaintext: REPLACEMENT, key_version: 2 },
      mcp: { plaintext: REPLACEMENT, key_version: 2 },
      opt: { plaintext: REPLACEMENT, key_version: 2 },
    });
  });

  it("still re-encrypts an unchanged row under the current key", async () => {
    await testSql`UPDATE discord_managed_webhooks SET webhook_token = pgp_sym_encrypt(${ORIGINAL}, ${KEYS.CRYPTO_SECRET_V1}), key_version = NULL WHERE guild_disc_id = '_lazy_rotation_guild'`;
    await testSql`UPDATE guild_mcp_servers SET auth_token = pgp_sym_encrypt(${ORIGINAL}, ${KEYS.CRYPTO_SECRET_V1}), key_version = 1 WHERE server_id = ${serverId}`;
    await testSql`UPDATE opt_api_keys SET api_key = pgp_sym_encrypt(${ORIGINAL}, ${KEYS.CRYPTO_SECRET_V1}), key_version = 1 WHERE server_id = ${serverId}`;
    const [webhook] =
      await testSql`SELECT * FROM discord_managed_webhooks WHERE guild_disc_id = '_lazy_rotation_guild'`;
    const [mcp] = await testSql`SELECT * FROM guild_mcp_servers WHERE server_id = ${serverId}`;
    const [opt] = await testSql`SELECT opt_api_key_id FROM opt_api_keys WHERE server_id = ${serverId}`;

    expect(await serverRepository.decryptManagedWebhookToken(webhook)).toBe(ORIGINAL);
    expect(await toolRepository.decryptMcpAuthToken(mcp)).toBe(ORIGINAL);
    expect(await getOptApiKey(serverId, "brave-search")).toBe(ORIGINAL);

    expect({
      webhook: await decryptStored(
        "discord_managed_webhooks",
        "webhook_token",
        "managed_webhook_id",
        webhook.managed_webhook_id,
      ),
      mcp: await decryptStored("guild_mcp_servers", "auth_token", "guild_mcp_id", mcp.guild_mcp_id),
      opt: await decryptStored("opt_api_keys", "api_key", "opt_api_key_id", opt.opt_api_key_id),
    }).toEqual({
      webhook: { plaintext: ORIGINAL, key_version: 2 },
      mcp: { plaintext: ORIGINAL, key_version: 2 },
      opt: { plaintext: ORIGINAL, key_version: 2 },
    });
  });
});
