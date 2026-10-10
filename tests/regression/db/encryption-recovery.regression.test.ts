import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keyManager } from "@/utils/security/keyManager";
import {
  ENCRYPTED_COLUMNS,
  type EncryptedColumn,
  type EncryptedRow,
  rotateEncryptedRow,
  scanEncryptedRows,
  verifyCiphertext,
} from "@/utils/security/encryptedColumns";
import { verifyBackupRecovery } from "@/utils/backup/backupRecovery";
import { createUserRow } from "../../helpers/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";
import { useFullEnvSandbox } from "../../helpers/env";

const KEYS = {
  CRYPTO_SECRET_V1: "synthetic_encryption_recovery_v1",
  CRYPTO_SECRET_V2: "synthetic_encryption_recovery_v2",
  CRYPTO_SECRET_V4: "synthetic_encryption_recovery_v4",
};
const CREDENTIAL = "synthetic_provider_credential";

describe.skipIf(!DB_TESTS_AVAILABLE)("Encrypted credential recovery", () => {
  let directory: string;
  let childEnv: Record<string, string | undefined>;
  let serverId: number;
  let userId: number;
  let legacy: string;
  useFullEnvSandbox();

  async function run(script: string, args: string[] = [], override: Record<string, string | undefined> = {}) {
    const child = Bun.spawn([process.execPath, "--no-env-file", "run", `scripts/devtools/${script}.ts`, ...args], {
      env: { ...childEnv, ...override },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    for (const secret of [...Object.values(KEYS), CREDENTIAL]) {
      expect(stdout + stderr).not.toContain(secret);
    }
    return { code, stdout, stderr };
  }

  beforeAll(async () => {
    await setupTestDb();
    directory = mkdtempSync(join(tmpdir(), "tomoribot-recovery-"));
    const envPath = join(directory, "target.env");
    writeFileSync(envPath, "# Secrets are injected by the disposable rehearsal.\n");
    childEnv = { ...process.env };
    for (const name of Object.keys(childEnv)) if (name.startsWith("CRYPTO_SECRET")) delete childEnv[name];
    Object.assign(childEnv, KEYS, {
      RUN_ENV: "development",
      TEST_PRODUCTION: "false",
      DISCORD_TOKEN: "synthetic_discord_token",
      TOMORI_ENV_FILE: envPath,
      TOMORI_BACKUP_DIR: join(directory, "backups"),
      DATABASE_URL: undefined,
      POSTGRES_URL: undefined,
      CRYPTO_SECRET_CURRENT: "4",
      TOMORI_RESTORE_CONFIRM: "RESTORE",
      TOMORI_RESTORE_FORCE_NONEMPTY: "RESTORE ANYWAY",
    });
    Object.assign(process.env, KEYS, { CRYPTO_SECRET_CURRENT: "4" });
    keyManager.initialize();
    const [server] =
      await testSql`INSERT INTO servers (server_disc_id) VALUES ('_encryption_recovery_server') RETURNING server_id`;
    serverId = server.server_id;
    const user = createUserRow({ user_disc_id: "_encryption_recovery_user" });
    const [createdUser] =
      await testSql`INSERT INTO users (user_disc_id) VALUES (${user.user_disc_id}) RETURNING user_id`;
    userId = createdUser.user_id;
    const encrypted: Buffer[] = [];
    for (const key of Object.values(KEYS)) {
      const [row] = await testSql`SELECT pgp_sym_encrypt(${CREDENTIAL}, ${key}) AS ciphertext`;
      encrypted.push(row.ciphertext);
    }
    await testSql`INSERT INTO saved_provider_configs (server_id, provider, api_key, key_version) VALUES (${serverId}, 'google', ${encrypted[0]}, NULL)`;
    await testSql`INSERT INTO user_saved_provider_configs (user_id, provider, api_key, key_version) VALUES (${userId}, 'google', ${encrypted[1]}, 2)`;
    await testSql`INSERT INTO api_key_rotation (server_id, provider, api_key, key_version) VALUES (${serverId}, 'google', ${encrypted[0]}, 1)`;
    await testSql`INSERT INTO api_key_rotation (server_id, provider, api_key, key_version, is_main_key_pointer) VALUES (${serverId}, 'google', NULL, 9, true)`;
    await testSql`INSERT INTO opt_api_keys (server_id, service_name, api_key, key_version) VALUES (${serverId}, 'brave-search', ${encrypted[1]}, 2), (${serverId}, 'unused', NULL, 9)`;
    await testSql`INSERT INTO guild_mcp_servers (server_id, name, url, auth_token, key_version) VALUES (${serverId}, 'synthetic', 'https://mcp.example', ${encrypted[2]}, 4), (${serverId}, 'anonymous', 'https://anonymous.example', NULL, 9)`;
    await testSql`INSERT INTO discord_managed_webhooks (guild_disc_id, kind, channel_disc_id, webhook_disc_id, webhook_token, key_version) VALUES ('_recovery_guild', 'persona', '_recovery_channel', '_recovery_webhook', ${encrypted[0]}, NULL)`;
    await testSql`INSERT INTO server_model_configs (server_id, api_key, key_version) VALUES (${serverId}, ${encrypted[1]}, 2)`;
    expect((await run("backupData", ["--backup"])).code).toBe(0);
    const bundle = join(childEnv.TOMORI_BACKUP_DIR ?? "", readdirSync(childEnv.TOMORI_BACKUP_DIR ?? "")[0]);
    const manifest = JSON.parse(readFileSync(join(bundle, "bundle_info.json"), "utf8"));
    expect(manifest.requiredKeyVersions).toEqual([1, 2, 4]);
    legacy = join(directory, "legacy");
    mkdirSync(legacy);
    copyFileSync(join(bundle, "database.sql"), join(legacy, "database.sql"));
    writeFileSync(
      join(legacy, "bundle_info.json"),
      JSON.stringify({
        createdAt: manifest.createdAt,
        botVersion: manifest.botVersion,
        files: ["database.sql", "config.env"],
      }),
    );
    writeFileSync(
      join(legacy, "config.env"),
      `${Object.entries(KEYS)
        .map(([name, value]) => `${name}=${value}`)
        .join("\n")}\nPOSTGRES_DB=wrong_target\n`,
    );
  });

  afterAll(async () => {
    await testSql`DELETE FROM discord_managed_webhooks WHERE webhook_disc_id = '_recovery_webhook'`;
    await testSql`DELETE FROM servers WHERE server_id = ${serverId}`;
    await testSql`DELETE FROM users WHERE user_id = ${userId}`;
    keyManager.initialize();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it("audits, rehearses, fails safely, rotates every stored column, and recovers with only the current key", async () => {
    const columns = await testSql<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'bytea'
    `;
    expect(ENCRYPTED_COLUMNS.map((target) => `${target.table}.${target.column}`).sort()).toEqual(
      columns.map((column) => `${column.table_name}.${column.column_name}`).sort(),
    );
    expect((await run("auditKeyVersions")).code).toBe(0);
    expect((await run("rotateAllKeys", ["--dry-run"])).code).toBe(0);
    expect((await run("rotateAllKeys", ["--dry-run"], { CRYPTO_SECRET_CURRENT: "2" })).code).toBe(0);
    const originals: { target: EncryptedColumn; row: EncryptedRow }[] = [];
    for await (const entry of scanEncryptedRows(testSql)) originals.push(entry);
    try {
      expect((await run("rotateAllKeys", ["--dry-run"], { CRYPTO_SECRET_CURRENT: "1" })).code).toBe(0);
      expect((await run("rotateAllKeys", ["--bot-stopped"], { CRYPTO_SECRET_CURRENT: "1" })).code).toBe(0);
      for await (const { row } of scanEncryptedRows(testSql)) {
        expect(row.key_version).toBe(1);
        await verifyCiphertext(testSql, row.ciphertext, 1);
      }
    } finally {
      for (const { target, row } of originals) {
        await testSql`UPDATE ${testSql(`public.${target.table}`)} SET ${testSql(target.column)} = ${row.ciphertext}, key_version = ${row.key_version} WHERE ${testSql(target.id)} = ${row.id}`;
      }
    }
    const [failedRow] =
      await testSql`SELECT user_saved_config_id AS id FROM user_saved_provider_configs WHERE user_id = ${userId}`;
    for (const override of [{ CRYPTO_SECRET_V2: undefined }, { CRYPTO_SECRET_V2: "synthetic_wrong_key" }]) {
      const audit = await run("auditKeyVersions", [], override);
      expect(audit.code).toBe(1);
      expect(audit.stderr).toContain("user_saved_provider_configs.api_key");
      expect(audit.stderr).toMatch(new RegExp(`\\b${failedRow.id}\\b.*V2`));
      expect(audit.stdout).toMatch(/discord_managed_webhooks\.webhook_token V1: \d+/);
      expect(audit.stdout).toMatch(/server_model_configs\.api_key V2: \d+/);
      expect((await run("rotateAllKeys", ["--dry-run"], override)).code).toBe(1);
    }
    expect((await run("rotateAllKeys")).code).toBe(1);
    await testSql`ALTER TABLE opt_api_keys RENAME TO rehearsal_opt_api_keys`;
    try {
      const audit = await run("auditKeyVersions");
      expect(audit.code).toBe(1);
      expect(audit.stderr).toContain("opt_api_keys");
      expect((await run("rotateAllKeys", ["--bot-stopped"])).code).toBe(1);
    } finally {
      await testSql`ALTER TABLE rehearsal_opt_api_keys RENAME TO opt_api_keys`;
    }
    const [before] =
      await testSql`SELECT api_key FROM opt_api_keys WHERE server_id = ${serverId} AND service_name = 'brave-search'`;
    await testSql`UPDATE opt_api_keys SET api_key = ${Buffer.from("corrupt")}, key_version = 2 WHERE server_id = ${serverId} AND service_name = 'brave-search'`;
    expect((await run("rotateAllKeys", ["--bot-stopped"])).code).toBe(1);
    const [partial] = await testSql`SELECT key_version FROM server_model_configs WHERE server_id = ${serverId}`;
    expect(partial.key_version).toBe(4);
    await testSql`UPDATE opt_api_keys SET api_key = ${before.api_key} WHERE server_id = ${serverId} AND service_name = 'brave-search'`;
    expect((await run("rotateAllKeys", ["--bot-stopped"])).code).toBe(0);
    expect((await run("auditKeyVersions")).code).toBe(0);
    expect(
      (
        await run("auditKeyVersions", [], {
          CRYPTO_SECRET_V1: undefined,
          CRYPTO_SECRET_V2: undefined,
          CRYPTO_SECRET: undefined,
        })
      ).code,
    ).toBe(0);
    for await (const { row } of scanEncryptedRows(testSql)) {
      expect(row.key_version).toBe(4);
      await verifyCiphertext(testSql, row.ciphertext, 4);
    }
    await testSql`ALTER TABLE server_model_configs DROP COLUMN api_key`;
    try {
      expect((await run("auditKeyVersions")).code).toBe(0);
    } finally {
      await testSql`ALTER TABLE server_model_configs ADD COLUMN api_key BYTEA`;
      await testSql`UPDATE server_model_configs SET api_key = pgp_sym_encrypt(${CREDENTIAL}, ${KEYS.CRYPTO_SECRET_V4}) WHERE server_id = ${serverId}`;
    }
  });

  it("refuses to overwrite a credential replaced after the scan", async () => {
    const target = ENCRYPTED_COLUMNS.find((column) => column.table === "opt_api_keys");
    if (!target) throw new Error("Missing inventory target.");
    const [row] =
      await testSql`SELECT opt_api_key_id AS id, api_key AS ciphertext, key_version FROM opt_api_keys WHERE server_id = ${serverId} AND service_name = 'brave-search'`;
    const replacement = "synthetic_concurrent_replacement";
    await testSql`UPDATE opt_api_keys SET api_key = pgp_sym_encrypt(${replacement}, ${KEYS.CRYPTO_SECRET_V4}), key_version = 4 WHERE opt_api_key_id = ${row.id}`;
    await expect(rotateEncryptedRow(testSql, target, row)).rejects.toThrow();
    const [after] =
      await testSql`SELECT pgp_sym_decrypt(api_key, ${KEYS.CRYPTO_SECRET_V4}) AS plaintext, key_version FROM opt_api_keys WHERE opt_api_key_id = ${row.id}`;
    expect(after.plaintext).toBe(replacement);
    expect(after.key_version).toBe(4);
  });

  it("restores database-only and legacy bundles and rejects missing or wrong keys before destructive SQL", async () => {
    const backup = await run("backupData", ["--backup"]);
    if (backup.code !== 0) throw new Error(`Synthetic backup failed: ${backup.stderr}`);
    const latest = readdirSync(childEnv.TOMORI_BACKUP_DIR ?? "")
      .sort()
      .at(-1);
    if (!latest) throw new Error("Missing synthetic backup.");
    const bundle = join(childEnv.TOMORI_BACKUP_DIR ?? "", latest);
    expect(readdirSync(bundle).sort()).toEqual(["bundle_info.json", "database.sql"]);
    const manifest = JSON.parse(readFileSync(join(bundle, "bundle_info.json"), "utf8"));
    expect(manifest.requiredKeyVersions).toEqual([4]);
    const selectedEnv = readFileSync(childEnv.TOMORI_ENV_FILE ?? "", "utf8");
    await testSql`UPDATE servers SET server_disc_id = '_recovery_sentinel' WHERE server_id = ${serverId}`;
    for (const override of [
      { CRYPTO_SECRET_V4: undefined, CRYPTO_SECRET_CURRENT: "2" },
      { CRYPTO_SECRET_V4: "synthetic_wrong_key" },
    ]) {
      expect((await run("backupData", ["--restore", "--from", bundle], override)).code).toBe(1);
      const [sentinel] = await testSql`SELECT server_disc_id FROM servers WHERE server_id = ${serverId}`;
      expect(sentinel.server_disc_id).toBe("_recovery_sentinel");
      expect(readFileSync(childEnv.TOMORI_ENV_FILE ?? "", "utf8")).toBe(selectedEnv);
    }
    expect((await run("backupData", ["--restore", "--from", bundle])).code).toBe(0);
    const [restored] = await testSql`SELECT server_disc_id FROM servers WHERE server_id = ${serverId}`;
    expect(restored.server_disc_id).toBe("_encryption_recovery_server");
    expect((await run("backupData", ["--restore", "--from", legacy], { CRYPTO_SECRET_V1: undefined })).code).toBe(1);
    expect((await run("backupData", ["--restore", "--from", legacy])).code).toBe(0);
    expect(existsSync(join(legacy, "config.env"))).toBe(true);
    rmSync(join(legacy, "config.env"));
    expect((await run("backupData", ["--restore", "--from", legacy])).code).toBe(0);
    expect(readFileSync(childEnv.TOMORI_ENV_FILE ?? "", "utf8")).toBe(selectedEnv);
    expect((await run("rotateAllKeys", ["--bot-stopped"])).code).toBe(0);
    await testSql`UPDATE guild_mcp_servers SET auth_token = pgp_sym_encrypt(${CREDENTIAL}, ${KEYS.CRYPTO_SECRET_V1}), key_version = NULL WHERE server_id = ${serverId} AND name = 'synthetic'`;
    expect((await run("backupData", ["--backup"])).code).toBe(0);
    const bundles = readdirSync(childEnv.TOMORI_BACKUP_DIR ?? "").sort();
    const olderVersionBundle = join(childEnv.TOMORI_BACKUP_DIR ?? "", bundles[bundles.length - 1]);
    expect(
      (await run("backupData", ["--restore", "--from", olderVersionBundle], { CRYPTO_SECRET_V1: undefined })).code,
    ).toBe(1);
    expect((await run("backupData", ["--restore", "--from", olderVersionBundle])).code).toBe(0);
    expect(await verifyBackupRecovery(testSql, join(olderVersionBundle, "database.sql"))).toEqual([1, 4]);
    expect((await run("backupData", ["--backup"], { CRYPTO_SECRET_V1: undefined })).code).toBe(0);
    await testSql`DROP SCHEMA public CASCADE`;
    await testSql`CREATE SCHEMA public`;
    expect((await testSql`SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'`).length).toBe(0);
    expect(
      (await run("backupData", ["--restore", "--from", bundle], { CRYPTO_SECRET_V4: "synthetic_wrong_key" })).code,
    ).toBe(1);
    expect((await testSql`SELECT 1 FROM pg_tables WHERE schemaname = 'public'`).length).toBe(0);
    await testSql`DROP EXTENSION pgcrypto`;
    expect((await run("backupData", ["--restore", "--from", bundle])).code).toBe(0);
    expect((await testSql`SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'`).length).toBe(1);
    expect(
      (
        await run("auditKeyVersions", [], {
          CRYPTO_SECRET_V1: undefined,
          CRYPTO_SECRET_V2: undefined,
          CRYPTO_SECRET: undefined,
        })
      ).code,
    ).toBe(0);
    const retained = readdirSync(childEnv.TOMORI_BACKUP_DIR ?? "");
    expect(
      (
        await run("backupData", ["--backup"], {
          CRYPTO_SECRET_V1: undefined,
          CRYPTO_SECRET_V2: undefined,
          CRYPTO_SECRET: undefined,
        })
      ).code,
    ).toBe(0);
    expect(readdirSync(childEnv.TOMORI_BACKUP_DIR ?? "").length).toBeGreaterThan(retained.length);
    const automatic = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "--eval",
        `
      const { loadInitializedKeyManager } = await import("./scripts/lib/keyManagerBootstrap.ts");
      await loadInitializedKeyManager();
      const { runAutomaticDataBackupIfNeeded } = await import("./src/utils/backup/dataBackup.ts");
      await runAutomaticDataBackupIfNeeded();
    `,
      ],
      { env: { ...childEnv, TOMORI_AUTO_BACKUP_INTERVAL_HOURS: "0" }, stdout: "ignore", stderr: "pipe" },
    );
    expect(await automatic.exited).toBe(0);
    const autoBundle = readdirSync(childEnv.TOMORI_BACKUP_DIR ?? "").find((name) => name.includes("_auto"));
    if (!autoBundle) throw new Error("Missing automatic backup.");
    expect(readdirSync(join(childEnv.TOMORI_BACKUP_DIR ?? "", autoBundle)).sort()).toEqual([
      "bundle_info.json",
      "database.sql",
    ]);
    const targetUrl = new URL("postgresql://localhost");
    targetUrl.hostname = childEnv.POSTGRES_HOST ?? "localhost";
    targetUrl.port = childEnv.POSTGRES_PORT ?? "5432";
    targetUrl.username = childEnv.POSTGRES_USER ?? "postgres";
    targetUrl.password = childEnv.POSTGRES_PASSWORD ?? "";
    targetUrl.pathname = `/${childEnv.POSTGRES_DB}`;
    expect(
      (
        await run("backupData", ["--restore", "--from", bundle], {
          DATABASE_URL: targetUrl.toString(),
          POSTGRES_DB: "synthetic_wrong_target",
        })
      ).code,
    ).toBe(0);
  });
});
