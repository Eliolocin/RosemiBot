import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { log } from "@/utils/misc/logger";

type DataBackupType = "manual" | "automatic";

export interface DataBackupOptions {
  backupType?: DataBackupType;
  triggerReasons?: string[];
  botVersion?: string;
}

export interface DataBackupResult {
  bundleDir: string;
  manifest: DataBackupManifest;
}

interface DataBackupManifest {
  createdAt: string;
  botVersion: string;
  backupType: DataBackupType;
  triggerReasons: string[];
  formatVersion: 2;
  contents: "database-only";
  requiredKeyVersions: number[];
  files: string[];
}

interface ExistingBackupManifest {
  createdAt?: string;
  botVersion?: string;
  backupType?: string;
  triggerReasons?: unknown;
  files?: unknown;
}

interface DataBackupBundle {
  name: string;
  bundleDir: string;
  createdAtMs: number;
  manifest: ExistingBackupManifest;
  backupType: DataBackupType;
}

const DEFAULT_AUTO_BACKUP_INTERVAL_HOURS = 24;
const DEFAULT_AUTO_BACKUP_MAX = 5;

class ExternalCommandError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
    cause?: unknown,
  ) {
    super(exitCode === null ? `${command} failed to start` : `${command} exited with code ${exitCode}`, { cause });
    this.name = "ExternalCommandError";
  }
}

async function runExternalCommand(
  command: string,
  args: string[],
  options: { stdout?: "inherit" | "ignore"; env?: Record<string, string | undefined> } = {},
): Promise<void> {
  let subprocess: ReturnType<typeof Bun.spawn>;
  try {
    subprocess = Bun.spawn([command, ...args], {
      stdout: options.stdout ?? "inherit",
      stderr: "pipe",
      env: options.env,
    });
  } catch (error) {
    throw new ExternalCommandError(command, null, "", error);
  }

  const stderrStream = subprocess.stderr;
  const stderrPromise =
    stderrStream instanceof ReadableStream ? new Response(stderrStream).text() : Promise.resolve("");
  const [exitCode, stderr] = await Promise.all([subprocess.exited, stderrPromise]);
  if (exitCode !== 0) {
    throw new ExternalCommandError(command, exitCode, stderr.trim());
  }
}

function logPgDumpFailureGuidance(error: unknown): void {
  if (!(error instanceof ExternalCommandError)) {
    log.info("Check that PostgreSQL client tools are installed and that your database settings are valid.");
    return;
  }

  const stderr = error.stderr.trim();
  if (stderr.length > 0) {
    log.info("pg_dump output:");
    for (const line of stderr.split(/\r?\n/)) {
      log.info(`  ${line}`);
    }
  }

  const normalized = stderr.toLowerCase();
  if (error.exitCode === null) {
    log.info("pg_dump could not be started. Install PostgreSQL client tools and ensure pg_dump is in PATH.");
    log.info("  Windows: install PostgreSQL from https://www.postgresql.org/download/windows/");
    log.info("  macOS:   brew install postgresql");
    log.info("  Linux:   sudo apt-get install postgresql-client");
    return;
  }

  if (normalized.includes("password authentication failed")) {
    log.info("The database rejected the POSTGRES_USER/POSTGRES_PASSWORD from your .env.");
    log.info(
      "If setup printed manual SQL earlier, run that SQL as a PostgreSQL admin or re-run setup and enter the admin password.",
    );
    return;
  }

  if (normalized.includes("role") && normalized.includes("does not exist")) {
    log.info("The POSTGRES_USER from your .env does not exist in PostgreSQL.");
    log.info("Re-run setup with automatic database creation, or run the printed role/database SQL manually.");
    return;
  }

  if (normalized.includes("database") && normalized.includes("does not exist")) {
    log.info("The POSTGRES_DB from your .env does not exist in PostgreSQL.");
    log.info("Re-run setup with automatic database creation, or create the database manually.");
    return;
  }

  if (
    normalized.includes("connection refused") ||
    normalized.includes("could not connect") ||
    normalized.includes("no route to host")
  ) {
    log.info("PostgreSQL was not reachable at the POSTGRES_HOST/POSTGRES_PORT from your .env.");
    log.info("Start PostgreSQL, or update .env to point at the running database.");
    return;
  }

  log.info("pg_dump is installed, but PostgreSQL rejected or failed the dump request. Check the pg_dump output above.");
}

export function resolveBackupsRoot(): string {
  return process.env.TOMORI_BACKUP_DIR ? resolve(process.env.TOMORI_BACKUP_DIR) : join(process.cwd(), "backups");
}

/**
 * Resolves a PostgreSQL connection URL from environment variables.
 * Prefers DATABASE_URL/POSTGRES_URL if set, otherwise constructs it from POSTGRES_* vars.
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
    throw new Error("POSTGRES_PASSWORD, DATABASE_URL, or POSTGRES_URL is required but not set.");
  }

  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

/** Connection settings for one PostgreSQL client process, with the password kept out of argv. */
export interface PostgresClientConnection {
  connectionUrl: string;
  env: Record<string, string | undefined>;
}

/** Environment variables that hold this bot's database password and that libpq never reads. */
const BOT_DATABASE_CREDENTIAL_ENV = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PASSWORD"] as const;

function escapePassfileField(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

/**
 * Runs a PostgreSQL client with its password in a private, short-lived `PGPASSFILE`.
 *
 * Command-line arguments are readable by other local users through the process table, and
 * `PGPASSWORD` stays readable in the child's environment, so the password travels only through
 * a file in a fresh temp directory outside every backup bundle. The single wildcard entry matches
 * whatever host form the URL or its query options select. The URL keeps every other component,
 * including query options such as `sslmode`, so the target stays exactly the one the caller chose.
 */
export async function withPostgresPassfile<T>(
  databaseUrl: string,
  run: (connection: PostgresClientConnection) => Promise<T>,
): Promise<T> {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("The database connection string is not a valid URL.");
  }

  const password = decodeURIComponent(url.password);
  url.password = "";

  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of BOT_DATABASE_CREDENTIAL_ENV) delete env[name];
  if (!password) return await run({ connectionUrl: url.toString(), env });

  const passfileDir = mkdtempSync(join(tmpdir(), "tomoribot-pgpass-"));
  try {
    const passfilePath = join(passfileDir, "pgpass");
    // libpq ignores a passfile readable by group or others on POSIX systems.
    writeFileSync(passfilePath, `*:*:*:*:${escapePassfileField(password)}\n`, { mode: 0o600 });
    delete env.PGPASSWORD;
    env.PGPASSFILE = passfilePath;
    return await run({ connectionUrl: url.toString(), env });
  } finally {
    rmSync(passfileDir, { recursive: true, force: true });
  }
}

function getCurrentBotVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
  if (!isRecord(parsed) || typeof parsed.version !== "string" || parsed.version.trim().length === 0) {
    throw new Error("package.json is missing a string version field.");
  }
  return parsed.version;
}

function createTimestamp(): string {
  return new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "").replace("T", "_");
}

function createBundleDirectory(backupsRoot: string, backupType: DataBackupType): string {
  const timestamp = createTimestamp();
  const typeSuffix = backupType === "automatic" ? "_auto" : "";
  const baseName = `backup_${timestamp}${typeSuffix}`;

  for (let attempt = 0; attempt < 100; attempt++) {
    const suffix = attempt === 0 ? "" : `_${attempt + 1}`;
    const bundleDir = join(backupsRoot, `${baseName}${suffix}`);
    if (!existsSync(bundleDir)) {
      mkdirSync(bundleDir, { recursive: false, mode: 0o700 });
      return bundleDir;
    }
  }

  throw new Error(`Could not create a unique backup bundle directory for timestamp ${timestamp}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readManifest(bundleDir: string): ExistingBackupManifest | null {
  const manifestPath = join(bundleDir, "bundle_info.json");
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (!isRecord(parsed)) {
      return null;
    }

    return {
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : undefined,
      botVersion: typeof parsed.botVersion === "string" ? parsed.botVersion : undefined,
      backupType: typeof parsed.backupType === "string" ? parsed.backupType : undefined,
      triggerReasons: parsed.triggerReasons,
      files: parsed.files,
    };
  } catch (error) {
    log.warn(`Skipping unreadable backup manifest at ${manifestPath}: ${error}`);
    return null;
  }
}

function resolveBackupType(name: string, manifest: ExistingBackupManifest): DataBackupType {
  if (manifest.backupType === "automatic") {
    return "automatic";
  }
  if (manifest.backupType === "manual") {
    return "manual";
  }
  return name.includes("_auto") ? "automatic" : "manual";
}

function resolveCreatedAtMs(bundleDir: string, manifest: ExistingBackupManifest): number {
  if (manifest.createdAt) {
    const parsed = Date.parse(manifest.createdAt);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return statSync(bundleDir).mtime.getTime();
}

function listDataBackups(): DataBackupBundle[] {
  const backupsRoot = resolveBackupsRoot();
  if (!existsSync(backupsRoot)) {
    return [];
  }

  return readdirSync(backupsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("backup_"))
    .map((entry) => {
      const bundleDir = join(backupsRoot, entry.name);
      const manifest = readManifest(bundleDir) ?? {};
      return {
        name: entry.name,
        bundleDir,
        createdAtMs: resolveCreatedAtMs(bundleDir, manifest),
        manifest,
        backupType: resolveBackupType(entry.name, manifest),
      };
    })
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return defaultValue;
  }
  if (["false", "0", "no", "off"].includes(value)) {
    return false;
  }
  if (["true", "1", "yes", "on"].includes(value)) {
    return true;
  }
  return defaultValue;
}

function readNonNegativeNumberEnv(name: string, defaultValue: number): number {
  const value = process.env[name]?.trim();
  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

function readPositiveIntegerEnv(name: string, defaultValue: number): number {
  const value = process.env[name]?.trim();
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function isPathInside(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function pruneAutomaticBackups(maxAutomaticBackups: number): void {
  const backupsRoot = resolveBackupsRoot();
  const automaticBackups = listDataBackups()
    .filter((backup) => backup.backupType === "automatic")
    .sort((a, b) => a.createdAtMs - b.createdAtMs);

  const backupsToDelete = automaticBackups.slice(0, Math.max(0, automaticBackups.length - maxAutomaticBackups));
  if (backupsToDelete.length === 0) {
    return;
  }

  for (const backup of backupsToDelete) {
    const target = resolve(backup.bundleDir);
    if (!isPathInside(backupsRoot, target)) {
      throw new Error(`Refusing to delete backup outside backup root: ${target}`);
    }
    rmSync(target, { recursive: true, force: true });
    log.info(`Pruned old automatic backup: ${backup.name}`);
  }
}

/**
 * Reminds the operator that the bundle excludes `.env` and names the master keys a restore needs.
 * Bundles deliberately omit `.env` so a copied bundle never carries the keys that decrypt its own
 * credentials. Manual runs warn because the operator is present and about to move the bundle;
 * automatic runs log at info level so routine startup output is not flagged as a problem.
 */
function logMissingKeyReminder(backupType: DataBackupType, requiredKeyVersions: number[]): void {
  const reminder =
    requiredKeyVersions.length === 0
      ? "This bundle does not include .env. It holds no encrypted credentials, so restore only needs normal startup settings."
      : `This bundle does not include .env. Save ${requiredKeyVersions.map((version) => `CRYPTO_SECRET_V${version}`).join(", ")} ` +
        "(or legacy CRYPTO_SECRET for V1) in protected storage such as a password manager, separate from this bundle. " +
        "Without them, a restore cannot decrypt stored API keys.";

  if (backupType === "manual") {
    log.warn(reminder);
  } else {
    log.info(reminder);
  }
}

export async function runDataBackup(options: DataBackupOptions = {}): Promise<DataBackupResult> {
  const backupType = options.backupType ?? "manual";
  const triggerReasons = options.triggerReasons ?? [];
  const botVersion = options.botVersion ?? getCurrentBotVersion();

  log.section(backupType === "automatic" ? "Automatic Data Backup" : "Transfer Backup");

  const backupsRoot = resolveBackupsRoot();
  if (!existsSync(backupsRoot)) {
    mkdirSync(backupsRoot, { recursive: true, mode: 0o700 });
  }

  const bundleDir = createBundleDirectory(backupsRoot, backupType);
  const dbDumpPath = join(bundleDir, "database.sql");
  const manifestPath = join(bundleDir, "bundle_info.json");

  log.info(`Bundle directory: ${bundleDir}`);

  const dbUrl = resolveDatabaseUrl();
  log.info("Running pg_dump...");
  let requiredKeyVersions: number[];
  try {
    writeFileSync(dbDumpPath, "", { mode: 0o600 });
    // --no-owner/--no-privileges keep dumps restorable across role names (e.g. Cloud SQL
    // `postgres` → Azure `tomoriadmin`); objects are owned by whichever role runs the restore.
    await withPostgresPassfile(dbUrl, ({ connectionUrl, env }) =>
      runExternalCommand(
        "pg_dump",
        [connectionUrl, "--clean", "--if-exists", "--no-owner", "--no-privileges", "-f", dbDumpPath],
        { env },
      ),
    );
    const { inspectBackupKeyVersions } = await import("@/utils/backup/backupRecovery");
    requiredKeyVersions = await inspectBackupKeyVersions(dbDumpPath);
    log.success("Database dump completed and encryption versions inventoried.");
  } catch (error) {
    await log.error("Backup failed. No database changes were made.", new Error("Dump or version inventory failed."));
    logPgDumpFailureGuidance(error);
    const resolvedBundleDir = resolve(bundleDir);
    if (isPathInside(backupsRoot, resolvedBundleDir) && existsSync(resolvedBundleDir)) {
      rmSync(resolvedBundleDir, { recursive: true, force: true });
      log.info(`Removed incomplete backup bundle: ${resolvedBundleDir}`);
    }
    throw error;
  }

  const manifest: DataBackupManifest = {
    createdAt: new Date().toISOString(),
    botVersion,
    backupType,
    triggerReasons,
    formatVersion: 2,
    contents: "database-only",
    requiredKeyVersions,
    files: ["database.sql"],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });

  log.section("Bundle Created");
  log.info(`Location:    ${bundleDir}`);
  log.info("Contents:");
  log.info("  database.sql     - PostgreSQL dump (restore with: bun run restore-backup)");
  log.info(`  Required encryption versions: ${requiredKeyVersions.join(", ") || "none"} (not included)`);
  log.info("  bundle_info.json - Bundle metadata");
  log.info("");
  log.info("To restore on a new install:");
  log.info(`  bun run restore-backup --from ${bundleDir}`);
  log.info("");
  logMissingKeyReminder(backupType, requiredKeyVersions);

  return { bundleDir, manifest };
}

export async function runAutomaticDataBackupIfNeeded(): Promise<void> {
  if (!readBooleanEnv("TOMORI_AUTO_BACKUP_ENABLED", true)) {
    log.info("Automatic startup backups disabled by TOMORI_AUTO_BACKUP_ENABLED.");
    return;
  }

  const botVersion = getCurrentBotVersion();
  const intervalHours = readNonNegativeNumberEnv(
    "TOMORI_AUTO_BACKUP_INTERVAL_HOURS",
    DEFAULT_AUTO_BACKUP_INTERVAL_HOURS,
  );
  const maxAutomaticBackups = readPositiveIntegerEnv("TOMORI_AUTO_BACKUP_MAX", DEFAULT_AUTO_BACKUP_MAX);
  const backups = listDataBackups();
  const latestBackup = backups[0];
  const triggerReasons: string[] = [];

  if (!latestBackup) {
    triggerReasons.push("no_previous_data_backup");
  } else {
    if (latestBackup.manifest.botVersion !== botVersion) {
      triggerReasons.push(`version_changed:${latestBackup.manifest.botVersion ?? "unknown"}->${botVersion}`);
    }

    const ageMs = Date.now() - latestBackup.createdAtMs;
    const intervalMs = intervalHours * 60 * 60 * 1000;
    if (ageMs >= intervalMs) {
      triggerReasons.push(`older_than_${intervalHours}_hours`);
    }
  }

  if (triggerReasons.length === 0 && latestBackup) {
    log.info(
      `Automatic startup backup skipped; latest data backup ${latestBackup.name} matches version ${botVersion} ` +
        `and is newer than ${intervalHours} hour(s).`,
    );
    return;
  }

  log.info(`Automatic startup backup required: ${triggerReasons.join(", ")}`);
  await runDataBackup({
    backupType: "automatic",
    botVersion,
    triggerReasons,
  });
  pruneAutomaticBackups(maxAutomaticBackups);
}
