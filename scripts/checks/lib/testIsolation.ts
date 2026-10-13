/**
 * Shared detectors for the test-harness isolation rules.
 *
 * `scripts/checks/runTests.ts` uses these to decide which files may share a
 * `bun test` process, and `tests/unit/checks/testIsolationHygiene.test.ts` uses
 * the same functions to fail the gate when a new test would break those rules.
 * Both import from here so the runner and the guard can never disagree.
 *
 * Background: the runner batches most test files into a shared process for
 * speed. That is only safe while no file mutates process-wide state and leaves
 * it mutated, because Bun does not reset such state between files.
 */

/**
 * Marker identifying a test file that stubs shared modules.
 *
 * Assembled from fragments so the literal never appears in this file or in the
 * guard test: the scanners below run over test sources, and a bare occurrence
 * would make them misclassify their own tooling. (Same trap as the locale key
 * scanner, which also reads comments.)
 */
export const MODULE_MOCK_MARKER = `mock${"."}module`;
export const SCOPED_MODULE_MOCK_MARKER = "createScopedModuleMocker";

/** Gateways to the shared fixture database, which only the DB lane may touch. */
const DB_HARNESS_MARKERS = [`setup${"/"}testDb`, `TEST_DB${"_"}READY`];

/**
 * True when the source stubs shared modules with `mock.module()` directly or
 * through the scoped module-mock helper.
 *
 * Bun applies module mocks process-wide and never restores them between files,
 * so such a file corrupts every file loaded after it in the same process. The
 * runner gives these files a private process; because they are alone, any other
 * process-wide state they mutate is harmless too.
 */
export function usesModuleMocks(source: string): boolean {
  const executableSource = withoutComments(source);
  return executableSource.includes(MODULE_MOCK_MARKER) || executableSource.includes(SCOPED_MODULE_MOCK_MARKER);
}

/**
 * Removes line and block comments before lightweight source classification.
 *
 * The lane planner must only react to executable mock registrations. A marker
 * in explanatory prose would otherwise change process topology and conceal
 * failures that a monolithic `bun test` exposes.
 */
function withoutComments(source: string): string {
  let result = "";
  let index = 0;
  let quote: '"' | "'" | "`" | undefined;

  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];

    if (quote) {
      result += character;
      if (character === "\\") {
        result += next ?? "";
        index += 2;
        continue;
      }
      if (character === quote) quote = undefined;
      index++;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      result += character;
      index++;
      continue;
    }

    if (character === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index++;
      continue;
    }

    if (character === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index++;
      index += 2;
      continue;
    }

    result += character;
    index++;
  }

  return result;
}

/**
 * True when the source can reach the disposable fixture database.
 *
 * Only files under `tests/regression/` may do this: they run in a single serial
 * lane, whereas the unit lanes run concurrently and would race on the shared
 * fixed-id fixtures.
 */
export function reachesTestDatabase(source: string): boolean {
  return DB_HARNESS_MARKERS.some((marker) => source.includes(marker));
}

/**
 * Every process-wide mutation the source performs, as the token that a restore
 * hook must mention to undo it (e.g. `globalThis.fetch`, `process.env.FOO`,
 * `setSystemTime`). A computed `process.env[NAME]` write keeps its bracket form
 * as the token, because its name is unknown until runtime; so does
 * `Object.assign(process.env, ...)`, whose names are runtime keys.
 *
 * Deletes count too: removing a variable the developer's `.env` set leaks the
 * same way as setting one.
 *
 * These persist across files inside one `bun test` process, so a file that sets
 * them without restoring leaks into every file batched alongside it.
 */
export function findProcessWideMutations(source: string): string[] {
  const tokens = new Set<string>();

  // Bun's fake clock is process-global until reset with a bare setSystemTime().
  if (/\bsetSystemTime\s*\(/.test(source)) tokens.add("setSystemTime");

  // Assignments (not comparisons) and deletes on globalThis or process.env.
  for (const match of source.matchAll(
    /\bdelete\s+(globalThis|process\.env)\.([A-Za-z_$][\w$]*)|\b(globalThis|process\.env)\.([A-Za-z_$][\w$]*)\s*=[^=]/g,
  )) {
    tokens.add(`${match[1] ?? match[3]}.${match[2] ?? match[4]}`);
  }

  for (const match of source.matchAll(
    /\bdelete\s+process\.env\[\s*([^\]]+?)\s*\]|\bprocess\.env\[\s*([^\]]+?)\s*\]\s*=[^=]/g,
  )) {
    const key = match[1] ?? match[2];
    const literalName = /^(["'`])([A-Za-z_$][\w$]*)\1$/.exec(key)?.[2];
    tokens.add(literalName ? `process.env.${literalName}` : `process.env[${key}]`);
  }

  if (/\bObject\.assign\(\s*process\.env\b/.test(source)) tokens.add("Object.assign(process.env");

  return [...tokens];
}

/**
 * Concatenates the source of every `afterEach`/`afterAll` call in the file.
 *
 * Scans forward from each hook keeping a parenthesis depth count, so the whole
 * call (including a multi-statement arrow body) is captured. A malformed parse
 * yields a short body and can only cause a mutation to look unrestored, never
 * the reverse, so the failure mode is a loud false positive rather than a silent
 * miss.
 */
export function extractRestoreHookBodies(source: string): string {
  return extractCallSources(source, /\bafter(?:Each|All)\s*\(/g);
}

/** Concatenates every call matched by `callStart`, a global pattern ending at the opening parenthesis. */
function extractCallSources(source: string, callStart: RegExp): string {
  const bodies: string[] = [];

  for (let match = callStart.exec(source); match !== null; match = callStart.exec(source)) {
    let depth = 1;
    let index = match.index + match[0].length;

    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === "(") depth++;
      else if (char === ")") depth--;
      index++;
    }

    bodies.push(source.slice(match.index, index));
  }

  return bodies.join("\n");
}

/**
 * True when a `useEnvSandbox()` call (`tests/helpers/env.ts`) undoes the env
 * mutation `token`. That helper registers its restore hooks internally, so the
 * hook-body scan cannot see them.
 *
 * A dot-form write must name its variable as a string literal in the call. A
 * computed `process.env[name]` write or an `Object.assign(process.env, ...)`
 * cannot be resolved by a text scan, so any sandbox call in the file covers it;
 * that trusts the author to list every name the runtime keys can take.
 * `useFullEnvSandbox()` restores the whole environment, so it covers every env
 * mutation in the file.
 */
function isCoveredByEnvSandbox(token: string, executableSource: string): boolean {
  const isEnvToken = token.startsWith("process.env") || token === "Object.assign(process.env";
  if (isEnvToken && /\buseFullEnvSandbox\s*\(/.test(executableSource)) return true;
  const sandboxCalls = extractCallSources(executableSource, /\buseEnvSandbox\s*\(/g);
  if (sandboxCalls === "") return false;
  if (token.startsWith("process.env[") || token === "Object.assign(process.env") return true;
  const name = /^process\.env\.([\w$]+)$/.exec(token)?.[1];
  const listedNames = [...sandboxCalls.matchAll(/(["'`])([\w$]+)\1/g)].map((literal) => literal[2]);
  return name !== undefined && listedNames.includes(name);
}

/**
 * Process-wide mutations the source performs but never undoes in an
 * `afterEach`/`afterAll` hook.
 *
 * Files that use `mock.module()` are exempt: the runner already gives them a
 * private process, so nothing they mutate can reach another file. This is why
 * e.g. a module-scope `process.env.X = "..."` is fine in a mock-using file but
 * not in one that shares a batch.
 */
export function findUnrestoredMutations(source: string): string[] {
  if (usesModuleMocks(source)) return [];

  const hookBodies = extractRestoreHookBodies(source);
  const executableSource = withoutComments(source);
  return findProcessWideMutations(source).filter(
    (token) => !hookBodies.includes(token) && !isCoveredByEnvSandbox(token, executableSource),
  );
}
