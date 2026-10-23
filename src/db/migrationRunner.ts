import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { sql as defaultSql } from "@/utils/db/client";
import { splitSqlStatements } from "@/utils/db/sqlSplitter";
import { log } from "@/utils/misc/logger";
import type { SQL } from "bun";

/** Absolute path to the migrations directory. */
const MIGRATIONS_DIR = path.join(import.meta.dir, "migrations");

/** Deployment-specific migrations start at 900 and are absent from schema.sql, so fresh installs must run them. */
const DEPLOYMENT_MIGRATION_BAND_START = 900;

/**
 * Migration file name pattern: NNN_description.sql
 * Capture group 1 is the zero-padded version number.
 */
const MIGRATION_FILENAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

interface PendingMigration {
  version: number;
  /** Stem without .sql extension, e.g. "001_baseline". Used as the tracking key. */
  name: string;
  filePath: string;
}

/**
 * Creates the schema_migrations tracking table if it does not yet exist.
 * The table records which migration files have been applied and when.
 */
async function ensureMigrationsTable(client: SQL): Promise<void> {
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         SERIAL      PRIMARY KEY,
      name       TEXT        UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Returns the set of migration names (stems) that have already been applied.
 */
async function getAppliedMigrations(client: SQL): Promise<Set<string>> {
  const rows = await client<{ name: string }[]>`SELECT name FROM schema_migrations`;
  return new Set(rows.map((r) => r.name));
}

/**
 * Scans the migrations directory and returns unapplied up-migrations,
 * sorted ascending by version number, then by full stem name as a tie-break.
 *
 * The secondary stem-name key makes ordering fully deterministic even when two
 * migrations share the same NNN prefix (a cross-PR numbering collision): the
 * pair is ordered by code-point of their stems rather than by filesystem
 * `readdir` order, so a fresh install and an upgraded install apply them
 * identically. Because stems are unique per file, (version, name) is a total
 * order, so no ties survive. Same-number siblings must still be mutually
 * order-independent; this tie-break guarantees *stability*, not that an
 * alphabetically-later migration may safely depend on an earlier one.
 *
 * Rollback files (*.down.sql) and files not matching the naming convention
 * are skipped. An unrecognised filename emits a warning so typos are visible.
 *
 * @param applied - Set of already-applied migration names
 */
async function getPendingMigrations(applied: Set<string>, migrationsDir: string): Promise<PendingMigration[]> {
  let files: string[];
  try {
    files = await readdir(migrationsDir);
  } catch {
    log.warn("Migrations directory not found — skipping migration runner");
    return [];
  }

  const pending: PendingMigration[] = [];

  for (const file of files) {
    if (file.endsWith(".down.sql")) continue;
    if (!file.endsWith(".sql")) continue;

    const match = MIGRATION_FILENAME.exec(file);
    if (!match) {
      log.warn(`Migration file skipped — name does not match NNN_description.sql: ${file}`);
      continue;
    }

    const version = Number.parseInt(match[1], 10);
    const name = file.slice(0, -".sql".length); // strip .sql extension

    if (!applied.has(name)) {
      pending.push({ version, name, filePath: path.join(migrationsDir, file) });
    }
  }

  // Primary key: ascending version number.
  // Tie-break: code-point comparison of the full stem, so same-numbered
  //    migrations apply in a stable, filesystem-independent order. We compare
  //    by code point (not localeCompare) to stay deterministic across host
  //    locales; stems are restricted to [a-z0-9_] so this is well-defined.
  return pending.sort((a, b) => {
    if (a.version !== b.version) return a.version - b.version;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

/**
 * Records every historical migration as applied without executing the migration body.
 *
 * This is used only after a fresh database has been initialized from the latest
 * static schema snapshot. In that case the historical expand/backfill/drop
 * migrations are already represented by schema.sql and replaying them would ask
 * for legacy source tables that correctly do not exist on a clean install.
 *
 * Deployment-band migrations are excluded because schema.sql does not contain
 * them, so the caller must subsequently run them.
 */
export async function markAllMigrationsApplied(
  client: SQL = defaultSql,
  migrationsDir: string = MIGRATIONS_DIR,
): Promise<void> {
  await ensureMigrationsTable(client);

  const migrations = await getPendingMigrations(new Set(), migrationsDir);
  const historicalMigrations = migrations.filter((migration) => migration.version < DEPLOYMENT_MIGRATION_BAND_START);
  for (const migration of historicalMigrations) {
    await client`
      INSERT INTO schema_migrations (name)
      VALUES (${migration.name})
      ON CONFLICT (name) DO NOTHING
    `;
  }

  log.success(
    `Database migrations: ${historicalMigrations.length} historical migration marker(s) recorded for fresh schema`,
  );
}

/**
 * Applies a single migration file and records it in schema_migrations.
 *
 * Comment-only files (e.g. the 001_baseline marker) produce zero statements
 * from splitSqlStatements and are recorded without executing any SQL, so
 * this is intentional for marker migrations.
 *
 */
async function applyMigration(client: SQL, migration: PendingMigration): Promise<void> {
  const sqlText = await readFile(migration.filePath, "utf-8");
  const statements = splitSqlStatements(sqlText);

  // Execute each statement in order; a failure here aborts the migration
  // and leaves schema_migrations unchanged so the next boot retries it.
  for (const stmt of statements) {
    await client.unsafe(stmt);
  }

  await client`INSERT INTO schema_migrations (name) VALUES (${migration.name})`;
}

/**
 * Runs all pending database migrations in ascending version order.
 *
 * Migration files live in src/db/migrations/ and follow the naming convention
 * NNN_description.sql (e.g. 002_split_tomori_configs.sql).  Each migration
 * must ship with a paired NNN_description.down.sql rollback file.
 *
 * Applied migrations are tracked in the schema_migrations table; already-applied
 * migrations are skipped so the runner is safe to call on every boot.
 *
 * A migration failure is re-thrown so the caller (initializeDatabase) can
 * decide whether to abort startup.
 */
export async function runMigrations(client: SQL = defaultSql, migrationsDir: string = MIGRATIONS_DIR): Promise<void> {
  await ensureMigrationsTable(client);

  const applied = await getAppliedMigrations(client);
  const pending = await getPendingMigrations(applied, migrationsDir);

  if (pending.length === 0) {
    log.success("Database migrations: up to date");
    return;
  }

  log.info(`Running ${pending.length} pending migration(s)...`);

  for (const migration of pending) {
    log.info(`Applying migration: ${migration.name}`);
    try {
      await applyMigration(client, migration);
      log.success(`Migration applied: ${migration.name}`);
    } catch (error) {
      log.error(`Migration failed: ${migration.name}`, error);
      throw error;
    }
  }

  log.success(`${pending.length} migration(s) applied successfully`);
}
