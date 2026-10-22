/**
 * Shared raw-SQL boundary scanner.
 *
 * TomoriBot's code-quality standard: every raw `sql`/`tx` template literal must
 * live inside a repository layer (`src/utils/db/repositories/` for shared code,
 * or `src/modules/<module>/db/repositories*` for removable feature modules),
 * with a small, explicitly-listed set of exemptions (security primitives,
 * observability, the RAG service facade). This module is the SINGLE source of
 * truth for detecting violations: it is consumed by both:
 *   - `scripts/checks/audit_sql.ts` (the CLI report + `bun run vl` gate), and
 *   - `tests/unit/db/rawSqlBoundary.test.ts` (the unit-test enforcement).
 *
 * Keeping the scan logic here (instead of duplicated in each caller) guarantees
 * the report and the test can never disagree about what counts as a violation.
 */

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

/** Classification of a detected query, derived from its leading keyword. */
export type QueryKind = "READ" | "WRITE";

/** A raw `sql`/`tx` template literal found in a source file. */
export interface QueryHit {
  /** Repo-relative, POSIX-normalized path (e.g. `src/commands/foo.ts`). */
  file: string;
  /** 1-based line number where the template literal opened. */
  line: number;
  /** Trimmed query text (best-effort; multi-line literals are joined). */
  query: string;
  kind: QueryKind;
}

/** A {@link QueryHit} that sits on an explicitly-exempted file. */
export interface ExemptQueryHit extends QueryHit {
  /** Human-readable justification from {@link EXEMPT_PATHS}. */
  reason: string;
}

/** Result of a full-tree scan: genuine violations vs. allow-listed hits. */
export interface SqlAuditResult {
  violations: QueryHit[];
  exemptions: ExemptQueryHit[];
}

/**
 * Repository root, resolved from this file's location
 * (`scripts/checks/lib/sqlAudit.ts` → up three levels). Makes the scan
 * independent of the process's current working directory, so the unit test and
 * the CLI both audit the same tree regardless of where they're launched.
 */
export const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");

/** Source roots that are scanned for raw SQL. */
export const AUDIT_DIRS = ["src"] as const;

/**
 * Path fragments that are skipped entirely (substring match on the
 * POSIX-normalized repo-relative path). These are the legitimate homes of raw
 * SQL: the repository layer itself, the DB client/migration plumbing, and type
 * declarations (which may embed SQL only inside doc comments / string types).
 */
export const IGNORE_PATHS = [
  "src/utils/db/repositories",
  "src/utils/db/client.ts",
  "src/db/migrations",
  "src/db/client.ts",
  "src/db/migrationRunner.ts",
  "src/init/database.ts",
  "src/types/",
] as const;

/**
 * Module-local repository layers: `src/modules/<module>/db/repositories.ts` (or
 * a `repositories/` directory). Removable feature modules (supporter-billing
 * established the layout) keep their SQL in their own repository file so the
 * whole module can be deleted cleanly: that file IS a repository layer, the
 * per-module analogue of `src/utils/db/repositories/`, not a boundary breach.
 */
export const MODULE_REPOSITORY_PATH_RE = /^src\/modules\/[^/]+\/db\/repositories(\.ts$|\/)/;

/**
 * Files allowed to contain raw SQL outside the repository layer, each paired
 * with a justification. Hits here are reported as EXEMPTIONS (not violations).
 * Keep this list intentional and small; prefer moving SQL into a repository.
 */
export const EXEMPT_PATHS = new Map<string, string>([
  ["src/utils/metrics/dbStats.ts", "observability/status helper"],
  ["src/utils/metrics/status/serverConfigPages.ts", "observability/status aggregation"],
  ["src/utils/misc/logger.ts", "logging infrastructure"],
  ["src/utils/security/crypto.ts", "security primitive"],
  ["src/utils/security/keyRotation.ts", "security primitive"],
  ["src/utils/documents/documentService.ts", "RAG service layer; SQL invoked exclusively through RagRepository facade"],
  ["src/db/seed/catalog/presetAssetLock.ts", "catalog seeding concurrency lock"],
]);

/** Normalize a path to POSIX separators for stable comparison across OSes. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Express an absolute path as a POSIX, repo-relative path. */
function toRepoRelative(absolutePath: string): string {
  return normalizePath(relative(REPO_ROOT, absolutePath));
}

/**
 * Classifies a query as a READ (pure SELECT) or WRITE (anything that can mutate
 * rows). Mirrors the original audit heuristic exactly: a query counts as READ
 * only when it mentions SELECT and none of INSERT/UPDATE/DELETE.
 */
export function classifyQuery(query: string): QueryKind {
  const upper = query.toUpperCase();
  // Whole-word match so column/identifier names that merely CONTAIN a keyword
  // (e.g. `updated_at` containing "UPDATE", `selected` containing "SELECT") do
  // not flip the classification.
  const hasKeyword = (keyword: string): boolean => new RegExp(`\\b${keyword}\\b`).test(upper);
  return hasKeyword("SELECT") && !hasKeyword("INSERT") && !hasKeyword("UPDATE") && !hasKeyword("DELETE")
    ? "READ"
    : "WRITE";
}

/**
 * Scans a single file's text for raw `sql`/`tx` template literals.
 *
 * Comment-aware: line comments (`//`) and block comments (`/* *​/`) are stripped
 * before matching so SQL written inside documentation is never flagged. The
 * `tx` alternative catches transaction callbacks (`sql.begin(async tx => tx`…`)`).
 *
 * This is a pure function over the file content (it performs no I/O), which is
 * what lets the unit test exercise the detector against synthetic inputs to
 * prove it has no false positives (comments/strings) or false negatives.
 *
 */
export function scanFileForSqlQueries(content: string): Array<{ line: number; query: string }> {
  const lines = content.split("\n");
  const hits: Array<{ line: number; query: string }> = [];

  let inQuery = false;
  let inBlockComment = false;
  let currentQuery = "";
  let queryStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (inBlockComment) {
      const blockEnd = line.indexOf("*/");
      if (blockEnd === -1) {
        continue;
      }
      inBlockComment = false;
      line = line.slice(blockEnd + 2);
    }

    const trimmedLine = line.trimStart();
    if (trimmedLine.startsWith("//")) {
      continue;
    }

    const blockStart = line.indexOf("/*");
    if (blockStart !== -1) {
      const blockEnd = line.indexOf("*/", blockStart + 2);
      if (blockEnd === -1) {
        inBlockComment = true;
        line = line.slice(0, blockStart);
      } else {
        line = `${line.slice(0, blockStart)}${line.slice(blockEnd + 2)}`;
      }
    }

    if (!inQuery) {
      // Detect the start of a `sql`/`tx` tagged template (optional `<T>` and
      //    `await`). The leading `\b` requires a word boundary so identifiers that
      //    merely END in "sql"/"tx" (e.g. `mysql`, `someSql`) are not false-flagged.
      //    The generic group uses `[^`]` (not `[^>]`) so NESTED generics such as
      //    `sql<Array<{ id: number }>>` are matched up to the backtick instead of
      //    stopping at the first inner `>`.
      const matchRegex = /(?:await\s+)?\b(?:sql|tx)(?:<[^`]+>)?\s*`/;
      const match = line.match(matchRegex);
      if (match) {
        queryStartLine = i + 1;
        const splitPoint = (match.index ?? 0) + match[0].length;
        const restOfLine = line.substring(splitPoint);
        if (restOfLine.includes("`")) {
          hits.push({ line: queryStartLine, query: restOfLine.split("`")[0].trim() });
        } else {
          inQuery = true;
          currentQuery = `${restOfLine}\n`;
        }
      }
    } else if (line.includes("`")) {
      inQuery = false;
      currentQuery += line.split("`")[0];
      hits.push({ line: queryStartLine, query: currentQuery.trim() });
      currentQuery = "";
    } else {
      currentQuery += `${line}\n`;
    }
  }

  return hits;
}

/** Recursively lists every file under `dir` (absolute paths). */
async function getFiles(dir: string): Promise<string[]> {
  const dirents = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    dirents.map((dirent) => {
      const res = join(dir, dirent.name);
      return dirent.isDirectory() ? getFiles(res) : res;
    }),
  );
  return files.flat();
}

/**
 * Walks the audited source roots and partitions every detected raw-SQL literal
 * into genuine `violations` (raw SQL outside the repository layer with no
 * exemption) and `exemptions` (hits on an allow-listed file).
 *
 * @returns Sorted, deterministic {@link SqlAuditResult}
 */
export async function auditRawSqlBoundary(): Promise<SqlAuditResult> {
  const candidateFiles: string[] = [];
  for (const dir of AUDIT_DIRS) {
    const absoluteDir = resolve(REPO_ROOT, dir);
    const all = await getFiles(absoluteDir);
    for (const absolute of all) {
      if (!absolute.endsWith(".ts")) continue;
      const relativePath = toRepoRelative(absolute);
      if (IGNORE_PATHS.some((ignore) => relativePath.includes(ignore))) continue;
      if (MODULE_REPOSITORY_PATH_RE.test(relativePath)) continue;
      candidateFiles.push(absolute);
    }
  }

  const violations: QueryHit[] = [];
  const exemptions: ExemptQueryHit[] = [];

  for (const absolute of candidateFiles) {
    const relativePath = toRepoRelative(absolute);
    const content = readFileSync(absolute, "utf8");
    for (const { line, query } of scanFileForSqlQueries(content)) {
      const kind = classifyQuery(query);
      const exemptReason = EXEMPT_PATHS.get(relativePath);
      if (exemptReason) {
        exemptions.push({ file: relativePath, line, query, kind, reason: exemptReason });
      } else {
        violations.push({ file: relativePath, line, query, kind });
      }
    }
  }

  // Stable ordering so callers (and snapshots) get deterministic output.
  const byLocation = (a: QueryHit, b: QueryHit) => a.file.localeCompare(b.file) || a.line - b.line;
  violations.sort(byLocation);
  exemptions.sort(byLocation);

  return { violations, exemptions };
}
