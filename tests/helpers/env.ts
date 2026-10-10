import { afterAll, afterEach, beforeEach } from "bun:test";

type EnvSnapshot = ReadonlyMap<string, string | undefined>;

function snapshotEnv(names: readonly string[]): EnvSnapshot {
  return new Map(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const [name, value] of snapshot) {
    // Assigning `undefined` stores the string "undefined", so an unset variable must be deleted.
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function snapshotFullEnv(): EnvSnapshot {
  return new Map(Object.entries(process.env));
}

function restoreFullEnv(snapshot: EnvSnapshot): void {
  for (const name of Object.keys(process.env)) if (!snapshot.has(name)) delete process.env[name];
  restoreEnv(snapshot);
}

/**
 * The scope snapshot is taken at registration, during collection, so a `beforeAll` write is undone
 * too. Bun collects a file only after the previous file in the process finished, so that snapshot
 * never sees another file's values.
 */
function registerEnvRestore(take: () => EnvSnapshot, restore: (snapshot: EnvSnapshot) => void): void {
  const scopeSnapshot = take();
  let testSnapshot = scopeSnapshot;
  beforeEach(() => {
    testSnapshot = take();
  });
  afterEach(() => restore(testSnapshot));
  afterAll(() => restore(scopeSnapshot));
}

/**
 * Restores the named variables after every test, and again when the enclosing file or `describe`
 * finishes, deleting any that were unset. Tests then write `process.env` freely, in hooks or bodies.
 *
 * `scripts/checks/lib/testIsolation.ts` accepts a dot-form `process.env.X` write only when `"X"` is
 * a string literal in this call, so pass a literal array when tests use the dot form.
 */
export function useEnvSandbox(names: readonly string[]): void {
  registerEnvRestore(() => snapshotEnv(names), restoreEnv);
}

/**
 * Like `useEnvSandbox`, but snapshots the whole environment and also deletes variables added since.
 * Only for code under test that writes names a test cannot list, such as `loadSecrets()` copying
 * every key of a secrets file. Call it before the scope's own `afterEach`/`afterAll`, because Bun
 * runs hooks in registration order and a re-initialization hook must read the restored values.
 */
export function useFullEnvSandbox(): void {
  registerEnvRestore(snapshotFullEnv, restoreFullEnv);
}
