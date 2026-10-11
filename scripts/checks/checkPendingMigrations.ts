#!/usr/bin/env bun
/**
 * checkPendingMigrations.ts: pre-deploy destructive-migration gate.
 *
 * Scans the migrations directory, queries the target database's
 * `schema_migrations` table to determine which migrations are pending,
 * then inspects each pending up-migration for destructive SQL patterns
 * (DROP, RENAME, TRUNCATE, unfiltered DELETE, ALTER COLUMN ... TYPE).
 *
 * Exit codes:
 *   0: no destructive migration, or required recovery point and downtime were authorized
 *   1: a destructive migration lacks its required recovery point or downtime opt-in
 *   2: script error (DB connection failed, migrations dir missing, etc.)
 *
 * When `GITHUB_OUTPUT` is set, a migration that needs downtime also writes
 * `downtime_required=true` there, so a deploy that passes --allow-downtime can stop
 * the old bot only on the releases that need it.
 *
 * Usage:
 *   bun run scripts/checks/checkPendingMigrations.ts                       (DB-aware: pending only)
 *   bun run scripts/checks/checkPendingMigrations.ts --all                 (no DB: scan every up-migration)
 *   bun run scripts/checks/checkPendingMigrations.ts --changed-since REF --deployed-ref REF
 *
 * The CI deploy gate uses --changed-since because GitHub-hosted runners don't
 * hold production DB credentials at the pre-Terraform stage. Local pre-push
 * hooks can use --all for a no-DB sanity check.
 *
 * A recovery point opt-in is required only for statements that can lose row data. A
 * separate downtime opt-in is required when the deployed source may still depend on
 * an object a migration removes or reshapes.
 */

import { appendFile, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const MIGRATIONS_DIR = path.join(import.meta.dir, "..", "..", "src", "db", "migrations");
const MIGRATION_FILENAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

/**
 * Conservative regex matchers for destructive SQL patterns.
 * Case-insensitive; multiline. Each entry maps a label to its pattern.
 *
 * Notes on the choices:
 * - `DELETE FROM` is flagged only when no `WHERE` appears in the same statement.
 *   We approximate "same statement" as "before the next semicolon".
 * - `ALTER COLUMN ... TYPE` is flagged because changing a column type can
 *   silently truncate or fail to cast. A rename removes the old object name.
 * - `DROP CONSTRAINT IF EXISTS` is flagged because even idempotent drops change
 *   schema shape and may invalidate dependent code.
 * - `losesData` marks statements whose effect a later migration cannot rebuild from
 *   DDL alone. `DROP TYPE` and `DROP SEQUENCE` count because CASCADE removes dependent
 *   columns and a sequence holds its position. Unknown drops count conservatively.
 * - `DROP NOT NULL` and `DROP DEFAULT` only loosen a column, so they are not flagged.
 */
const DESTRUCTIVE_PATTERNS: Array<{ label: string; pattern: RegExp; losesData: boolean }> = [
  { label: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/i, losesData: true },
  { label: "DROP COLUMN", pattern: /\bDROP\s+COLUMN\b/i, losesData: true },
  { label: "DROP CONSTRAINT", pattern: /\bDROP\s+CONSTRAINT\b/i, losesData: false },
  { label: "DROP INDEX", pattern: /\bDROP\s+INDEX\b/i, losesData: false },
  { label: "DROP TYPE", pattern: /\bDROP\s+TYPE\b/i, losesData: true },
  { label: "DROP FUNCTION", pattern: /\bDROP\s+FUNCTION\b/i, losesData: false },
  { label: "TRUNCATE", pattern: /\bTRUNCATE\b/i, losesData: true },
  {
    label: "ALTER COLUMN ... TYPE",
    pattern: /\bALTER\s+COLUMN\s+\w+\s+(?:SET\s+DATA\s+)?TYPE\b/i,
    losesData: true,
  },
  { label: "RENAME", pattern: /\bRENAME\b/i, losesData: false },
  { label: "DROP VIEW", pattern: /\bDROP\s+(?:MATERIALIZED\s+)?VIEW\b/i, losesData: false },
  { label: "DROP SCHEMA", pattern: /\bDROP\s+SCHEMA\b/i, losesData: true },
  { label: "DROP SEQUENCE", pattern: /\bDROP\s+SEQUENCE\b/i, losesData: true },
  { label: "DROP TRIGGER", pattern: /\bDROP\s+TRIGGER\b/i, losesData: false },
  { label: "DROP POLICY", pattern: /\bDROP\s+POLICY\b/i, losesData: false },
  {
    label: "OTHER DROP",
    pattern:
      /\bDROP\s+(?!(?:TABLE|COLUMN|CONSTRAINT|INDEX|TYPE|FUNCTION|VIEW|MATERIALIZED|SCHEMA|SEQUENCE|TRIGGER|POLICY|NOT|DEFAULT)\b)\w+/i,
    losesData: true,
  },
];

const RECREATABLE_DROP =
  /\bDROP\s+(TRIGGER|INDEX|FUNCTION|POLICY|VIEW|MATERIALIZED\s+VIEW|CONSTRAINT)\s+(?:IF\s+EXISTS\s+)?("[^"]+"|[a-z_][\w$.]*)/gi;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Removes drops of objects the same file recreates under the same name, the idempotent
 * rerun idiom (`DROP TRIGGER IF EXISTS x ...; CREATE TRIGGER x ...`). The runner applies
 * statements without a wrapping transaction, so the object is briefly absent between
 * the two statements; a recreated unique index or constraint fails the migration rather
 * than losing data if a conflicting row lands in that window.
 */
function withoutRecreatedDrops(sql: string): string {
  return sql.replace(RECREATABLE_DROP, (drop: string, kind: string, rawName: string, offset: number) => {
    const name = `"?${escapeRegExp(rawName.replaceAll('"', ""))}"?(?![\\w$])`;
    const recreate = /^CONSTRAINT$/i.test(kind)
      ? new RegExp(`\\bADD\\s+CONSTRAINT\\s+${name}`, "i")
      : new RegExp(
          `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:UNIQUE\\s+)?${kind.replace(/\s+/g, "\\s+")}\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${name}`,
          "i",
        );
    return recreate.test(sql.slice(offset + drop.length)) ? "" : drop;
  });
}

/**
 * Strips SQL comments before pattern matching so a `-- DROP TABLE foo` line
 * in a doc comment doesn't trip the gate.
 */
function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "") // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ""); // block comments
}

/**
 * Detects unfiltered `DELETE FROM` (no WHERE clause before the next `;`).
 * Run separately from the regex map because the WHERE-presence check is
 * statement-scoped rather than a single pattern.
 */
function findUnfilteredDeletes(sql: string): string[] {
  const matches: string[] = [];
  const deleteRegex = /\bDELETE\s+FROM\s+([\w."]+)/gi;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration idiom
  while ((m = deleteRegex.exec(sql)) !== null) {
    const start = m.index;
    const nextSemicolon = sql.indexOf(";", start);
    const stmt = nextSemicolon === -1 ? sql.slice(start) : sql.slice(start, nextSemicolon);
    if (!/\bWHERE\b/i.test(stmt)) {
      matches.push(`DELETE FROM ${m[1]} (no WHERE)`);
    }
  }
  return matches;
}

interface PendingFile {
  name: string;
  filePath: string;
}

/**
 * Lists all up-migration files in the migrations dir, sorted by version.
 * Excludes `.down.sql` rollbacks and any file not matching the version-prefixed naming.
 */
async function listAllUpMigrations(): Promise<PendingFile[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files
    .filter((f) => MIGRATION_FILENAME.test(f) && !f.endsWith(".down.sql"))
    .sort()
    .map((name) => ({ name: name.replace(/\.sql$/, ""), filePath: path.join(MIGRATIONS_DIR, name) }));
}

/**
 * Queries the target DB for the set of already-applied migration names,
 * then filters the up-migration list down to pending entries only.
 * Imported lazily so `--all` mode never opens a DB connection.
 */
async function listPendingMigrationsViaDb(allUp: PendingFile[]): Promise<PendingFile[]> {
  const { sql } = await import("@/utils/db/client");
  try {
    const rows = await sql<{ name: string }[]>`SELECT name FROM schema_migrations`;
    const applied = new Set(rows.map((r) => r.name));
    return allUp.filter((m) => !applied.has(m.name));
  } catch (err) {
    // If the schema_migrations table doesn't exist yet, every up-migration is pending.
    // We surface the error so the operator knows the DB was untracked, but proceed.
    const msg = err instanceof Error ? err.message : String(err);
    if (/schema_migrations.*does not exist/i.test(msg)) {
      console.warn("schema_migrations table not found; treating ALL up-migrations as pending.");
      return allUp;
    }
    throw err;
  }
}

interface ScanResult {
  file: string;
  findings: string[];
  oldCodeReferences: string[];
  losesData: boolean;
}

async function findDeployedReference(ref: string, name: string): Promise<string | undefined> {
  const proc = Bun.spawn(
    ["git", "grep", "-l", "-i", "-w", "-F", "-e", name, ref, "--", "src", ":!src/db/migrations", ":!src/db/schema.sql"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode === 1) return undefined;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`git grep failed (exit ${exitCode}): ${stderr.trim()}`);
  }
  return stdout.trim().split("\n")[0]?.replace(`${ref}:`, "");
}

function droppedObjects(sql: string): { names: string[]; unclassified: boolean } {
  const names: string[] = [];
  let unclassified = false;
  for (const statement of sql.split(";")) {
    const columnDrops = [...statement.matchAll(/\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?("[^"]+"|[a-z_][\w$]*)/gi)];
    for (const match of columnDrops) names.push(match[1].replaceAll('"', ""));
    if (/\bDROP\s+COLUMN\b/i.test(statement) && columnDrops.length === 0) unclassified = true;

    if (/\bDROP\s+TABLE\b/i.test(statement)) {
      const table = statement
        .trim()
        .match(/^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?("[^"]+"|[a-z_][\w$]*)(?:\s+(?:CASCADE|RESTRICT))?\s*$/i);
      if (table) names.push(table[1].replaceAll('"', ""));
      else unclassified = true;
    }
  }
  return { names, unclassified };
}

async function scanForDestructive(files: PendingFile[], deployedRef?: string): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  for (const file of files) {
    const raw = await readFile(file.filePath, "utf8");
    const sql = withoutRecreatedDrops(stripComments(raw));
    const findings: string[] = [];
    let losesData = false;

    for (const { label, pattern, losesData: patternLosesData } of DESTRUCTIVE_PATTERNS) {
      if (!pattern.test(sql)) continue;
      findings.push(label);
      losesData ||= patternLosesData;
    }
    const unfilteredDeletes = findUnfilteredDeletes(sql);
    findings.push(...unfilteredDeletes);
    losesData ||= unfilteredDeletes.length > 0;

    if (findings.length > 0) {
      const { names, unclassified } = droppedObjects(sql);
      const oldCodeReferences: string[] = [];
      for (const name of names) {
        const reference = deployedRef ? await findDeployedReference(deployedRef, name) : undefined;
        if (reference) oldCodeReferences.push(`${name}: ${reference}`);
      }
      const otherFindings = findings.filter((finding) => finding !== "DROP COLUMN" && finding !== "DROP TABLE");
      if (unclassified || otherFindings.length > 0 || !deployedRef) {
        oldCodeReferences.push("A destructive operation cannot be proven safe against the deployed source.");
      }
      results.push({ file: file.name, findings, oldCodeReferences, losesData });
    }
  }
  return results;
}

/**
 * Includes edits and renames so a migration changed after a failed deploy
 * remains visible to the gate.
 */
async function listMigrationsAddedSince(ref: string, allUp: PendingFile[]): Promise<PendingFile[]> {
  const proc = Bun.spawn(
    ["git", "diff", "--diff-filter=ACMR", "--name-only", `${ref}...HEAD`, "--", "src/db/migrations/"],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`git diff failed (exit ${exitCode}): ${stderr.trim()}`);
  }
  const added = new Set(
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".sql") && !line.endsWith(".down.sql"))
      .map((line) => path.basename(line, ".sql")),
  );
  return allUp.filter((m) => added.has(m.name));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const useAll = argv.includes("--all");
  const sinceIdx = argv.indexOf("--changed-since");
  const sinceRef = sinceIdx >= 0 ? argv[sinceIdx + 1] : undefined;
  const deployedIdx = argv.indexOf("--deployed-ref");
  const deployedRef = deployedIdx >= 0 ? argv[deployedIdx + 1] : undefined;
  const recoveryPointOptIn = argv.includes("--recovery-point-opt-in");
  const allowDowntime = argv.includes("--allow-downtime");

  if ((sinceIdx >= 0 && !sinceRef) || (deployedIdx >= 0 && !deployedRef)) {
    console.error("--changed-since and --deployed-ref require git ref arguments.");
    process.exit(2);
  }

  const allUp = await listAllUpMigrations();
  const candidates = sinceRef
    ? await listMigrationsAddedSince(sinceRef, allUp)
    : useAll
      ? allUp
      : await listPendingMigrationsViaDb(allUp);

  if (candidates.length === 0) {
    console.log("No pending migrations to scan.");
    process.exit(0);
  }

  const modeLabel = sinceRef ? `added-since-${sinceRef}` : useAll ? "all" : "pending";
  console.log(`Scanning ${candidates.length} migration(s) [${modeLabel}] for destructive SQL...`);
  const destructive = await scanForDestructive(candidates, deployedRef);

  if (destructive.length === 0) {
    console.log("All migrations are non-destructive.");
    process.exit(0);
  }

  console.log("\nDestructive pending migrations detected:\n");
  for (const r of destructive) {
    console.log(`  ${r.file}`);
    for (const f of r.findings) console.log(`    - ${f}`);
    for (const reference of r.oldCodeReferences) console.log(`    - deployed source: ${reference}`);
  }
  const needsRecoveryPoint = destructive.some((result) => result.losesData);
  const needsDowntime = destructive.some((result) => result.oldCodeReferences.length > 0);
  if (needsDowntime && process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, "downtime_required=true\n");
  }
  if (needsRecoveryPoint && !recoveryPointOptIn) {
    console.error(
      "A migration that can lose data requires a recovery point request via (Checkpoint) or create_db_backup=true.",
    );
  }
  if (needsDowntime && !allowDowntime) {
    console.error("The deployed bot may use the old schema, so migration requires --allow-downtime.");
  }
  if ((needsRecoveryPoint && !recoveryPointOptIn) || (needsDowntime && !allowDowntime)) process.exit(1);
  console.log(
    needsDowntime ? "Migration downtime authorized." : "Dropped objects are unreferenced by deployed source.",
  );
}

main().catch((err) => {
  console.error("checkPendingMigrations: unexpected error:", err instanceof Error ? err.stack : err);
  process.exit(2);
});
