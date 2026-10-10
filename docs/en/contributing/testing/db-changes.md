---
title: "Testing DB Changes"
sidebar:
  order: 30
---

How to run and add database regression tests. `bun run test` creates a disposable Postgres database,
runs every test file, and drops the database on exit, so no manual database setup is needed.

## Setup

Set `POSTGRES_PASSWORD` in `.env` (or a full `DATABASE_URL`). Everything else defaults to a local
server:

| Variable | Default |
|---|---|
| `POSTGRES_HOST` | `localhost` |
| `POSTGRES_PORT` | `5432` |
| `POSTGRES_USER` | `postgres` |
| `POSTGRES_MAINTENANCE_DB` | `postgres` |

CI sets the same variables; see `.github/workflows/ci.yml`.

## Running

```bash
bun run test                                        # everything, with a disposable database
bun run test tests/regression/db/llm.regression.test.ts   # selected files, same setup
bun test tests/unit/                                # unit tests only, no database
```

Plain `bun test tests/regression/db/` skips the DB tests. `DB_TESTS_AVAILABLE` in
`tests/regression/db/setup/testDb.ts` is true only when a password is set and `TEST_DB_READY=1`, and
only `scripts/checks/runTests.ts` sets that flag after creating the database. This keeps the tests
off a development or production database. Every DB `describe` uses
`describe.skipIf(!DB_TESTS_AVAILABLE)`.

The runner refuses to run with `RUN_ENV=production` and only creates databases on local hosts
(`localhost`, `127.0.0.1`, `::1`, `postgres`, `tomoribot-db`, `host.docker.internal`). Set
`TOMORI_TESTS_ALLOW_NONLOCAL_DB=true` for a disposable remote server. If the connection probe fails
within 5 seconds, the DB tests skip and the rest still run.

## Lanes

The runner groups files into lanes that run concurrently. Within a lane, batches run in order; a batch
is one `bun test` process.

| Lane | Files | Batching |
|---|---|---|
| `unit` | `tests/unit/` without `mock.module()` | One batch |
| `unit-isolated` | `tests/unit/` with `mock.module()` | One batch per file |
| `db` | `tests/regression/` | One batch for files without `mock.module()`, one per file with it |

Bun applies `mock.module()` to the whole process and never undoes it, so two mocking files in one
process break each other with errors like `X is not a function`. The runner detects `mock.module` in
the source and isolates those files. Regression files share one database with fixed-id fixtures, so
they stay in one lane; `setupTestDb()` initializes the schema once per process. Output is printed per
lane (`unit`, `unit-isolated`, `db`) after all lanes finish.

`tests/unit/checks/testIsolationHygiene.test.ts` enforces two rules, sharing its detectors with the
runner through `scripts/checks/lib/testIsolation.ts`:

1. Tests that touch the database go under `tests/regression/`. A unit test would race the DB lane on
   the same fixture rows.
2. Restore process-wide state (`setSystemTime()`, `globalThis.x`, `process.env.X`) in `afterEach` or
   `afterAll`, or the next file in the batch fails instead of yours. For environment variables, call
   `useEnvSandbox()` from `tests/helpers/env.ts` with every name the file writes or deletes. Files that call
   `mock.module()` have their own process and are exempt.

With `BUN_TEST_JUNIT_OUTFILE` set (as `vl` does), the runner merges each batch's JUnit file and keeps
one `<testsuite>` per test file.

## Adding coverage

- Add the test to the domain file under `tests/regression/db/` (a new LLM write goes in
  `llm.regression.test.ts`), or add a new `*.regression.test.ts` for a new repository.
- Use the `_rt_` fixture IDs (`_rt_server_001`, `_rt_user_001`), inserted in `beforeAll` and removed
  by cascade in `afterAll`.
- Assert on the returned value. A test that only checks the call did not throw passes when the query
  returns the wrong rows. For a write, read it back in a second test.
- When a command turns UI choices into a repository patch, extract a typed write-plan helper and test
  it in `tests/unit/commands/configCommandMappings.test.ts` instead of mocking an interaction. Assert
  the repository method and the patch shape; cover mixed-table writes that need a transaction in a
  DB regression test.

To prove a test catches a regression, break the code it covers (for example add `WHERE 1=0` to the
query), confirm the test fails, and revert. A few files keep this as a skipped
`[REGRESSION PROBE]` test.

## Rehearsing migrations on production data

The tests run on a fresh schema. Before a release with many migrations, also run them against a copy
of production data, which catches orphaned rows and backfill edge cases:

1. Restore a production snapshot into a scratch database that has `pgvector` (see
   [Safe Migration](/self-hosting/safe-migration/#prerequisite-the-pgvector-extension)). Restore with
   `ON_ERROR_STOP=1`.
2. Run the same initialization the bot runs at boot:

   ```bash
   POSTGRES_DB=tomodb_prodrehearse POSTGRES_PASSWORD=<pw> bun run scripts/db/rehearse-migration.ts
   ```

   The script refuses to run with `RUN_ENV=production`.
3. Check the result with your own queries: orphans, row counts against the snapshot, and backfill
   assertions for the migrations under test.
