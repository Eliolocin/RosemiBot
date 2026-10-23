import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TransactionSQL } from "bun";
import { markAllMigrationsApplied, runMigrations } from "@/db/migrationRunner";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const ROLLBACK = new Error("rollback");

const BAND_MIGRATIONS = [
  "001_historical_marker",
  "899_historical_backfill",
  "900_deployment_first",
  "901_deployment_second",
] as const;

async function inRolledBackTransaction(body: (tx: TransactionSQL) => Promise<void>): Promise<void> {
  try {
    await testSql.begin(async (tx) => {
      await body(tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

async function recordedMigrations(tx: TransactionSQL): Promise<string[]> {
  const rows = await tx<{ name: string }[]>`
    SELECT name FROM schema_migrations
    WHERE name IN (${BAND_MIGRATIONS[0]}, ${BAND_MIGRATIONS[1]}, ${BAND_MIGRATIONS[2]}, ${BAND_MIGRATIONS[3]})
    ORDER BY name
  `;
  return rows.map(({ name }) => name);
}

async function recordedSteps(tx: TransactionSQL): Promise<string[]> {
  const rows = await tx<{ step: string }[]>`SELECT step FROM deployment_band_log ORDER BY seq`;
  return rows.map(({ step }) => step);
}

describe.skipIf(!DB_TESTS_AVAILABLE)("deployment migration band", () => {
  let migrationsDir: string;

  beforeAll(async () => {
    await setupTestDb();
    migrationsDir = await mkdtemp(path.join(os.tmpdir(), "tomoribot-migration-band-"));
    await writeFile(
      path.join(migrationsDir, "001_historical_marker.sql"),
      "CREATE TABLE deployment_band_historical (id INT);\n",
    );
    await writeFile(
      path.join(migrationsDir, "899_historical_backfill.sql"),
      "INSERT INTO deployment_band_log (step) VALUES ('899');\n",
    );
    await writeFile(
      path.join(migrationsDir, "900_deployment_first.sql"),
      [
        "CREATE TABLE deployment_band_probe (server_id INT REFERENCES servers(server_id));",
        "INSERT INTO deployment_band_log (step) VALUES ('900');",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(migrationsDir, "901_deployment_second.sql"),
      "INSERT INTO deployment_band_log (step) VALUES ('901');\n",
    );
  });

  afterAll(async () => {
    if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
  });

  it("marks historical migrations only, then applies the deployment band once", async () => {
    await inRolledBackTransaction(async (tx) => {
      await tx`CREATE TABLE deployment_band_log (seq SERIAL PRIMARY KEY, step TEXT NOT NULL)`;

      await markAllMigrationsApplied(tx, migrationsDir);

      expect(await recordedMigrations(tx)).toEqual(["001_historical_marker", "899_historical_backfill"]);
      const [historicalTable] = await tx<{ name: string | null }[]>`
        SELECT to_regclass('public.deployment_band_historical')::text AS name
      `;
      expect(historicalTable.name).toBeNull();
      expect(await recordedSteps(tx)).toEqual([]);

      await runMigrations(tx, migrationsDir);

      expect(await recordedMigrations(tx)).toEqual([...BAND_MIGRATIONS]);
      expect(await recordedSteps(tx)).toEqual(["900", "901"]);
      const [bandTable] = await tx<{ name: string | null }[]>`
        SELECT to_regclass('public.deployment_band_probe')::text AS name
      `;
      expect(bandTable.name).not.toBeNull();

      await runMigrations(tx, migrationsDir);

      const [bandMarkers] = await tx<{ count: number }[]>`
        SELECT COUNT(*)::INT AS count FROM schema_migrations
        WHERE name IN ('900_deployment_first', '901_deployment_second')
      `;
      expect(bandMarkers.count).toBe(2);
    });
  });

  it("applies pending deployment migrations after every pending historical migration", async () => {
    await inRolledBackTransaction(async (tx) => {
      await tx`CREATE TABLE deployment_band_log (seq SERIAL PRIMARY KEY, step TEXT NOT NULL)`;

      await runMigrations(tx, migrationsDir);

      expect(await recordedSteps(tx)).toEqual(["899", "900", "901"]);
      expect(await recordedMigrations(tx)).toEqual([...BAND_MIGRATIONS]);
    });
  });
});
