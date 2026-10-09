import { SQL } from "bun";
import { log } from "@/utils/misc/logger";
import { loadInitializedKeyManager } from "../lib/keyManagerBootstrap";
import { verifyBackupRecovery } from "@/utils/backup/backupRecovery";
import { resolveBackupsRoot, runDataBackup, withPostgresPassfile } from "@/utils/backup/dataBackup";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const mode = args[0];
const restoreConfirmed = process.env.TOMORI_RESTORE_CONFIRM === "RESTORE";
const forceNonEmptyRestore = process.env.TOMORI_RESTORE_FORCE_NONEMPTY === "RESTORE ANYWAY";

if (mode !== "--backup" && mode !== "--restore") {
  log.error("Usage:");
  log.info("  bun run backup");
  log.info("  bun run restore-backup --latest");
  log.info("  bun run restore-backup --from <bundle-dir>");
  process.exit(1);
}

async function runExternalCommand(
  command: string,
  args: string[],
  options: { stdout?: "inherit" | "ignore"; env?: Record<string, string | undefined> } = {},
): Promise<void> {
  const subprocess = Bun.spawn([command, ...args], {
    stdout: options.stdout ?? "inherit",
    stderr: "inherit",
    env: options.env,
  });

  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(`${command} exited with code ${exitCode}`);
  }
}

/**
 * Resolves a PostgreSQL connection URL from environment variables.
 * Prefers DATABASE_URL if set, otherwise constructs it from POSTGRES_* vars.
 */
function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL;

  const host = process.env.POSTGRES_HOST || "localhost";
  const port = process.env.POSTGRES_PORT || "5432";
  const user = process.env.POSTGRES_USER || "postgres";
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DB || "tomodb";

  if (!password) {
    log.error("POSTGRES_PASSWORD (or DATABASE_URL) is required but not set.");
    process.exit(1);
  }

  // URL-encode the password to safely handle special characters (@, /, #, etc.)
  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

async function runBackup(): Promise<void> {
  await runDataBackup({ backupType: "manual" });
}

/** Restores a trusted SQL dump after recovery checks and destructive-action confirmation. */
async function runRestore(bundlePath: string): Promise<void> {
  log.section("♻️ TRANSFER RESTORE");

  // Recovery preflight and psql must target the same database even with an explicit URL override.
  const targetDatabaseUrl = resolveDatabaseUrl();
  process.env.DATABASE_URL = targetDatabaseUrl;

  const bundleDir = resolve(bundlePath);
  if (!existsSync(bundleDir)) {
    log.error(`Bundle directory not found: ${bundleDir}`);
    process.exit(1);
  }

  const dbDumpPath = join(bundleDir, "database.sql");
  const legacyConfigPath = join(bundleDir, "config.env");
  const manifestPath = join(bundleDir, "bundle_info.json");

  for (const [label, path] of [
    ["database.sql", dbDumpPath],
    ["bundle_info.json", manifestPath],
  ] as [string, string][]) {
    if (!existsSync(path)) {
      log.error(`Missing required bundle file: ${label}`);
      log.info("This bundle may be corrupt or was not created by `bun run backup`.");
      process.exit(1);
    }
  }

  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf-8"));
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new Error("Invalid backup manifest.");
  }
  const metadata = manifest as Record<string, unknown>;
  const legacy = metadata.formatVersion === undefined;
  if (legacy) {
    // Restore never reads config.env, and operators may delete it after archiving its keys, so its
    // absence must not block recovery; the decrypt preflight below is the real key check.
    if (existsSync(legacyConfigPath)) {
      log.warn(
        "Legacy bundle contains raw secrets in config.env. It is not loaded or copied; provision matching keys separately.",
      );
    }
  } else if (
    metadata.formatVersion !== 2 ||
    metadata.contents !== "database-only" ||
    !Array.isArray(metadata.requiredKeyVersions) ||
    metadata.requiredKeyVersions.some((version) => !Number.isSafeInteger(version) || version < 1)
  ) {
    throw new Error("Unsupported or invalid backup manifest.");
  }
  // Explicit URL targets keep the runtime's verified production TLS policy.
  const { resolveProductionPostgresTls, skipsTlsForTestProduction } = await import("@/utils/db/client");
  const production =
    process.env.RUN_ENV === "production" && !skipsTlsForTestProduction(new URL(targetDatabaseUrl).hostname);
  const sql = new SQL(targetDatabaseUrl, {
    ...(production ? { tls: resolveProductionPostgresTls(new URL(targetDatabaseUrl).hostname) } : {}),
  });
  const versions = await verifyBackupRecovery(sql, dbDumpPath);
  if (!legacy && JSON.stringify(versions) !== JSON.stringify(metadata.requiredKeyVersions)) {
    throw new Error("Backup encryption-version inventory does not match its dump.");
  }
  log.success(`Recovery preflight passed for encryption versions: ${versions.join(", ") || "none"}.`);
  log.info(`Bundle created: ${metadata.createdAt}`);
  log.info(`Bot version:    ${metadata.botVersion}`);
  log.info(`Bundle path:    ${bundleDir}`);

  const existingTables = await sql<{ tablename: string }[]>`
		SELECT tablename FROM pg_tables WHERE schemaname = 'public'
	`;
  await sql.close();

  if (existingTables.length > 0) {
    log.section("🛑 TARGET DATABASE IS NOT EMPTY");
    log.info(`Found ${existingTables.length} existing table(s) in the database.`);
    log.info("Restoring into a non-empty database will cause conflicts:");
    log.info("  - The dump can drop existing tables and replace their data.");
    log.info("  - A failed restore can leave partially replaced data.");
    log.info("  - ON_ERROR_STOP stops at the first error; it cannot undo prior statements.");
    log.info("");
    log.info("Recommended: run `bun run nuke-db` first, then re-run restore.");
    let forceResponse = "";
    if (forceNonEmptyRestore) {
      log.warn("Non-interactive non-empty restore confirmation accepted from TOMORI_RESTORE_FORCE_NONEMPTY.");
      forceResponse = "RESTORE ANYWAY";
    } else {
      log.info("Type 'RESTORE ANYWAY' to force restore into the existing database,");
      log.info("or anything else to abort:");

      forceResponse = await new Promise<string>((resolve) => {
        process.stdin.resume();
        process.stdin.once("data", (data) => {
          resolve(data.toString().trim());
          process.stdin.pause();
        });
      });
    }

    if (forceResponse !== "RESTORE ANYWAY") {
      log.info("Aborted. Run `bun run nuke-db` first for a clean restore.");
      process.exit(0);
    }

    log.info("Proceeding with forced restore into non-empty database...");
  }

  log.section("Restore confirmation");
  log.info("Restoring will replace database contents using the trusted SQL dump.");
  log.info("Stop every bot instance before continuing. Your local secret configuration stays in place.");
  let response = "";
  if (restoreConfirmed) {
    log.warn("Non-interactive restore confirmation accepted from TOMORI_RESTORE_CONFIRM.");
    response = "RESTORE";
  } else {
    log.info("Type 'RESTORE' (all caps) to proceed:");

    response = await new Promise<string>((resolve) => {
      process.stdin.resume();
      process.stdin.once("data", (data) => {
        resolve(data.toString().trim());
        process.stdin.pause();
      });
    });
  }

  if (response !== "RESTORE") {
    log.info("Aborted. Nothing was changed.");
    process.exit(0);
  }

  log.info("Restoring database from dump (running psql)...");
  try {
    const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
    await withPostgresPassfile(targetDatabaseUrl, ({ connectionUrl, env }) =>
      runExternalCommand(
        "psql",
        ["--quiet", "-o", nullDevice, connectionUrl, "-v", "ON_ERROR_STOP=1", "-f", dbDumpPath],
        { env },
      ),
    );
    log.success("Database restored successfully.");
  } catch (_error) {
    log.error("psql restore failed. Ensure psql is installed and in your PATH.");
    log.info("  Windows: install PostgreSQL from https://www.postgresql.org/download/windows/");
    log.info("  macOS:   brew install postgresql");
    log.info("  Linux:   sudo apt-get install postgresql-client");
    process.exit(1);
  }

  log.section("✅ Restore Complete!");
  log.info("Next steps:");
  log.info(
    "  1. Keep the separately provisioned keys; run audit-keys and rotate-keys --dry-run while the bot is stopped.",
  );
  log.info("  2. Run `bun install --frozen-lockfile` to restore the locked dependencies.");
  log.info(
    "  3. If migration is needed, run rotate-keys --bot-stopped and audit-keys before restarting every bot instance.",
  );
}

/**
 * Scans the backups/ directory and returns the path of the most recently
 * created bundle. Bundle folders are named backup_YYYY-MM-DD_HH-MM-SS so
 * a descending lexicographic sort reliably picks the newest one.
 *
 * @returns Absolute path to the latest bundle directory.
 */
function resolveLatestBundle(): string {
  const backupsRoot = resolveBackupsRoot();

  if (!existsSync(backupsRoot)) {
    log.error("No backups/ directory found. Run `bun run backup` first.");
    process.exit(1);
  }

  const bundles = readdirSync(backupsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("backup_"))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  if (bundles.length === 0) {
    log.error("No bundles found in backups/. Run `bun run backup` first.");
    process.exit(1);
  }

  const latest = join(backupsRoot, bundles[0]);
  log.info(`Using latest bundle: ${bundles[0]}`);
  return latest;
}

let entryPromise: Promise<void>;
const bootstrap = loadInitializedKeyManager();

if (mode === "--backup") {
  entryPromise = bootstrap.then(() => runBackup());
} else {
  const useLatest = args.includes("--latest");
  const fromIndex = args.indexOf("--from");

  if (!useLatest && (fromIndex === -1 || !args[fromIndex + 1])) {
    log.error("Provide either --latest or --from <bundle-dir>.");
    log.info("  bun run restore-backup --latest");
    log.info("  bun run restore-backup --from backups/backup_2025-01-01_12-00-00");
    process.exit(1);
  }

  const bundlePath = useLatest ? resolveLatestBundle() : args[fromIndex + 1];
  entryPromise = bootstrap.then(() => runRestore(bundlePath));
}

entryPromise
  .catch((error) => {
    log.error(
      "Backup or restore failed:",
      error instanceof Error ? new Error(error.message) : new Error("Operation failed."),
    );
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
