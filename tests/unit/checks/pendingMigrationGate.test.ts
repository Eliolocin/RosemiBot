import { afterEach, expect, test } from "bun:test";
import { copyFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const temporaryRepos: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRepos.splice(0).map((repo) => rm(repo, { recursive: true, force: true })));
});

async function run(repo: string, command: string[]): Promise<{ exitCode: number; output: string }> {
  const proc = Bun.spawn(command, { cwd: repo, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, output: `${stdout}\n${stderr}` };
}

async function fixture(oldSource: string, migration: string): Promise<{ repo: string; deployedRef: string }> {
  const repo = await mkdtemp(path.join(os.tmpdir(), "tomoribot-migration-gate-"));
  temporaryRepos.push(repo);
  await mkdir(path.join(repo, "src", "db", "migrations"), { recursive: true });
  await mkdir(path.join(repo, "scripts", "checks"), { recursive: true });
  await copyFile(
    path.join(import.meta.dir, "..", "..", "..", "scripts", "checks", "checkPendingMigrations.ts"),
    path.join(repo, "scripts", "checks", "checkPendingMigrations.ts"),
  );
  await writeFile(path.join(repo, "src", "oldReader.ts"), oldSource);
  expect((await run(repo, ["git", "init", "-q"])).exitCode).toBe(0);
  expect((await run(repo, ["git", "add", "."])).exitCode).toBe(0);
  expect(
    (
      await run(repo, [
        "git",
        "-c",
        "user.name=Mirri",
        "-c",
        "user.email=mirri@example.invalid",
        "commit",
        "-qm",
        "deployed",
      ])
    ).exitCode,
  ).toBe(0);
  const deployedRef = (await run(repo, ["git", "rev-parse", "HEAD"])).output.trim();
  await writeFile(path.join(repo, "src", "db", "migrations", "001_change.sql"), migration);
  expect((await run(repo, ["git", "add", "."])).exitCode).toBe(0);
  expect(
    (
      await run(repo, [
        "git",
        "-c",
        "user.name=Mirri",
        "-c",
        "user.email=mirri@example.invalid",
        "commit",
        "-qm",
        "new migration",
      ])
    ).exitCode,
  ).toBe(0);
  return { repo, deployedRef };
}

test("a dropped column still used by the deployed commit requires downtime", async () => {
  const { repo, deployedRef } = await fixture(
    'export const query = "SELECT user_nickname FROM users";\n',
    "ALTER TABLE users DROP COLUMN IF EXISTS user_nickname;\n",
  );
  const args = [
    "bun",
    "run",
    "scripts/checks/checkPendingMigrations.ts",
    "--changed-since",
    deployedRef,
    "--deployed-ref",
    deployedRef,
    "--recovery-point-opt-in",
  ];
  const blocked = await run(repo, args);
  expect(blocked.exitCode).toBe(1);
  expect(blocked.output).toContain("user_nickname: src/oldReader.ts");

  const authorized = await run(repo, [...args, "--allow-downtime"]);
  expect(authorized.exitCode).toBe(0);
  expect(authorized.output).toContain("Migration downtime authorized.");
});

test("an unreferenced dropped column needs a recovery point but not downtime", async () => {
  const { repo, deployedRef } = await fixture(
    'export const query = "SELECT id FROM users";\n',
    "ALTER TABLE users DROP COLUMN IF EXISTS old_nickname;\n",
  );
  const args = [
    "bun",
    "run",
    "scripts/checks/checkPendingMigrations.ts",
    "--changed-since",
    deployedRef,
    "--deployed-ref",
    deployedRef,
  ];
  expect((await run(repo, args)).exitCode).toBe(1);
  const allowed = await run(repo, [...args, "--recovery-point-opt-in"]);
  expect(allowed.exitCode).toBe(0);
  expect(allowed.output).toContain("Dropped objects are unreferenced by deployed source.");
});

test("an additive migration needs neither opt-in", async () => {
  const { repo, deployedRef } = await fixture(
    'export const query = "SELECT id FROM users";\n',
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS new_nickname TEXT;\n",
  );
  const result = await run(repo, [
    "bun",
    "run",
    "scripts/checks/checkPendingMigrations.ts",
    "--changed-since",
    deployedRef,
    "--deployed-ref",
    deployedRef,
  ]);
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("All migrations are non-destructive.");
});
