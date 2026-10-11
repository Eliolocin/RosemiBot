---
title: "Safe Migration Guide"
sidebar:
  order: 6
aiGenerated: true
---

When you `git pull` new code and restart TomoriBot, the bot automatically runs database schema migrations on boot. This is powerful: it means you don't have to manually manage SQL updates, but it also means destructive operations can silently affect your data. This guide shows you how to protect yourself before pulling.

## Why this matters

TomoriBot's migration runner (in `src/db/migrationRunner.ts`) executes all unapplied migrations in version order. Migrations are forward-only: if something goes wrong, the runner does not auto-rollback. Most migrations are safe expansions (new columns, new tables), but per the project's internal design policy (OD-R-6), destructive operations such as `DROP COLUMN` or `DROP TABLE` are permitted. If a destructive migration runs without a backup, you lose data permanently. When in doubt, back up first.

## Custom expression media backups
<!-- anchor: custom-expression-media-backups -->

Database backups retain custom expression metadata, persona memberships, and storage
references. They do not include uploaded or imported media bytes. Stop the bot before
backing up the database and media together. With local storage, copy `data/custom-expressions/`
and restore it to the same location. With GCS or S3, back up the owned `custom-expressions/`
objects and restore their keys in the configured expression bucket. Restore the matching
`EXPRESSION_STORAGE_BACKEND` and `EXPRESSION_STORAGE_BUCKET` settings. Changing the backend
or bucket alone leaves existing references unreadable. Link expressions are stored as URLs only
and remain dependent on their external hosts. Discord JSON exports carry no expression registry
or media archive.

## Pre-pull checklist


Follow these steps BEFORE running `git pull`:

1. **Stop the bot**: shut down the TomoriBot process so no active database connections interfere with the backup.
2. **Back up the database and retain its keys**: use one of the two methods below. Keep a separate protected copy of every encryption version needed by the dump and test recovery on a disposable database.
3. **Note the current commit**: run `git rev-parse HEAD` and save the output in case rollback is needed.
4. **Pull and restart**: once the backup is safely on disk, you're safe to pull and restart.

### Prerequisite: the `pgvector` extension

A full backup is a plain-SQL `pg_dump` (`backupData.ts` runs `pg_dump --clean --if-exists -f`), so it contains the `vector`-typed `document_chunks` table used for RAG. The target Postgres must have the `pgvector` extension available before you restore; otherwise, the dump's `CREATE EXTENSION IF NOT EXISTS vector` cannot run and the `document_chunks` table fails to create.

Install it once on the host (matching your Postgres major version), e.g. for Postgres 16:

```bash
sudo apt-get install -y postgresql-16-pgvector
```

Confirm it is available:

```bash
psql -c "SELECT name, default_version FROM pg_available_extensions WHERE name = 'vector';"
```

If you restore without it:

- The project's `restore-backup` (and any `psql -f` run with `ON_ERROR_STOP=1`) aborts early with `extension "vector" is not available`: no data is loaded. Install pgvector and retry.
- A manual `psql -f` run that ignores errors (`ON_ERROR_STOP=0`) is worse: the failed `COPY public.document_chunks` desynchronizes psql's input parser, which then mis-parses the following `COPY` data rows as SQL (a `syntax error at or near …` cascade). This silently drops whole tables (observed: `documents` and `llms`), leaving a partially-restored database that looks intact but has lost rows. Always restore with `ON_ERROR_STOP=1` so failures surface immediately.

### Option A: Use the project's backup script

TomoriBot includes two backup scripts, each targeting different data:

- **`bun run backup`**: Full database schema + data dump (personas, memories, configs, everything)
- **`bun run backup:personas`**: Persona presets and per-persona server memories only

For a safe migration, use the full backup:

```bash
bun run backup
```

This creates a timestamped bundle in `backups/` (or your `TOMORI_BACKUP_DIR` if overridden in `.env`) containing the entire PostgreSQL database as a plain SQL dump. The bundle contains no `.env` or master secrets. Before restoring, provision matching encryption versions separately in the target secret source and stop all bot instances. See [Database backups and recovery keys](/self-hosting/maintenance/#database-backups-and-recovery-keys) for the full procedure. Missing or wrong keys stop the restore before destructive SQL. Legacy bundles still contain raw `config.env` secrets; review them privately and provision their keys yourself. Restore never copies that file. To restore later, run:

```bash
bun run restore-backup --latest
```

Or restore from a specific bundle:

```bash
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

### Automatic local startup backups

In non-production (`RUN_ENV` not set to `production`), TomoriBot also checks for a full data backup before database initialization runs. It creates an automatic `backupData.ts`-compatible bundle when either condition is true:

- the latest full data backup was created by a different `package.json` bot version
- the latest full data backup is at least `TOMORI_AUTO_BACKUP_INTERVAL_HOURS` old (default: `24`)

Automatic backups are tagged with `backupType: "automatic"` in `bundle_info.json` and named with an `_auto` suffix. Manual `bun run backup` bundles are tagged as `manual`; they can satisfy the latest-backup check, but they never count toward automatic retention. The startup gate keeps the newest `TOMORI_AUTO_BACKUP_MAX` automatic bundles (default: `5`) and deletes older automatic bundles only.

Set `TOMORI_AUTO_BACKUP_ENABLED=false` in `.env` if you need to start a local/dev bot without this safety gate, for example on a machine without `pg_dump`.

### Option B: Direct `pg_dump`

If you prefer manual control, use PostgreSQL's built-in `pg_dump` utility with TomoriBot's own environment variables:

```bash
pg_dump \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -F c \
  -f "tomoribot-backup-$(date +%Y%m%d-%H%M%S).dump"
```

This saves a custom-format binary dump (more compact than SQL text). The environment variables match your `.env`:

- `POSTGRES_HOST`: default `localhost`
- `POSTGRES_PORT`: default `5432`
- `POSTGRES_USER`: your DB user
- `POSTGRES_DB`: default `tomodb`

To restore:

```bash
pg_restore \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  tomoribot-backup-20240115-143045.dump
```

Note: `pg_restore` will prompt for your password unless you set it in a `.pgpass` file (PostgreSQL's built-in credential file).

## For contributors deploying via CI: the `(Checkpoint)` convention

If you maintain a fork that deploys to AWS or GCP via the workflows in `.github/workflows/deploy-{aws,gcp-legacy}.yml`, those pipelines support an opt-in pre-deploy snapshot: when a commit message contains the literal token `(Checkpoint)`, the workflow runs `aws rds create-db-snapshot` (or the GCP Cloud SQL equivalent) before any code is deployed and before the migration runner touches the database on boot.

Use it when:

- You're shipping a migration that drops a column, drops a table, alters a column type, or otherwise loses data (the OD-R-6 destructive-migration policy).
- You're shipping a release-bundle commit that combines several migrations and want a single rollback point.
- You're not sure whether a queued migration is safe: when in doubt, checkpoint.

Skip it for routine non-destructive deploys (new columns, new indexes, additive seed data): the snapshot has a real cost and the routine path doesn't need it.

Example commit message:

```
Refactor | Phase 7 closeout (Checkpoint)

Drops the deprecated tomori_configs table after Phase 6 backfill.
Snapshot is required because the migration is destructive.
```

The `(Checkpoint)` token can appear anywhere in the subject or body: it's matched case-sensitively against the head commit's message. Manual workflow dispatch with the workflow's backup input enabled is the same lever for ad-hoc cases.

### Azure release migrations

The Azure `release` workflow applies schema changes in a separate migration container before it
replaces the running bot. A backup request alone does not protect the old bot from a removed column.
The workflow checks changed migration files against the last successfully deployed commit before
database work begins. A `DROP COLUMN` or `DROP TABLE` can run while the old bot serves only when its
source no longer names that object. Ship the new reader and any backfill first; leave the old object
in place for at least one deployed release, then remove it in a later release.

Destructive migrations require `(Checkpoint)` on a push or `create_db_backup=true` on manual
dispatch. If the old code still references the object, dispatch the workflow manually with both
`create_db_backup=true` and `allow_migration_downtime=true`. The latter stops the Compose
`tomoribot` service and pauses active host restart timers before migration starts. The deploy step
starts the new bot after migration and restores those timers after the health check.
The run summary records the downtime path. A failed migration can leave the bot stopped, so inspect
the Azure Run Command record before retrying. Additive migrations need neither opt-in and keep the
old bot running through migration.

Other destructive statements, including renames, type changes, truncation, and unfiltered deletes,
also require downtime because the gate cannot prove compatibility from an object-name search.
When no successful deploy commit is reachable, the gate requires downtime for any destructive
migration it detects. On the Azure Burstable database tier, the recovery point step records a point-in-time
restore target because customer on-demand backups are unavailable. Before migration, it requires
the server to be ready, backup retention to be enabled, and the earliest available restore time to
precede the target. The job summary records the UTC target and an `az postgres flexible-server
restore` command that creates a new server. Azure's automated backup and transaction log schedule
can lag the clock, so this metadata check does not prove that every transaction at the target has
already reached backup storage. Take a logical dump if the migration needs a stronger recovery point.

## What to do if a migration fails partway

If the bot crashes or hangs during migration:

1. **Stop the bot immediately**: do not let it retry migrations blindly.

2. **Check the logs**: TomoriBot logs to stdout/stderr by default (captured by your process manager or Docker logs). Look for an error message naming the migration that failed. Example output:

   ```
   Migration failed: 042_drop_old_column, error: column "old_column" does not exist
   ```

3. **Decide whether to restore**: if the error is unrecoverable (e.g., the migration tried to drop a column that doesn't exist), restore from your backup:

   ```bash
   # Option A restore
   bun run restore-backup --latest

   # Or Option B restore
   pg_restore \
     -h "$POSTGRES_HOST" \
     -p "$POSTGRES_PORT" \
     -U "$POSTGRES_USER" \
     -d "$POSTGRES_DB" \
     tomoribot-backup-20240115-143045.dump
   ```

4. **Roll back the code**: revert to the last working commit:

   ```bash
   git reset --hard <previous-commit-hash>
   ```

   Use the hash you saved in step 3 of the pre-pull checklist, or find it with:

   ```bash
   git log --oneline | head -20
   ```

5. **Report the bug**: file an issue at [github.com/Bredrumb/TomoriBot/issues](https://github.com/Bredrumb/TomoriBot/issues) with:
   - Failed migration filename (from logs)
   - Full error message
   - Last successful commit hash
   - Your OS, Bun version (`bun --version`), and PostgreSQL version

## What is NOT auto-recoverable

By project design policy (OD-R-6), the migration runner cannot roll back destructive migrations. Examples:

- `DROP COLUMN name_here`: deleted rows are lost forever; no SQL script can recover them
- `DROP TABLE old_table`: entire table is gone
- Type narrowing (e.g., `VARCHAR(255) → VARCHAR(100)`): values longer than 100 characters are truncated

Your backup is the only recovery for these operations. Always back up before pulling if you're on an older version and a new refactor has shipped.

The migration runner's forward-only design is intentional: rollback files (`.down.sql`) exist for developer safety during testing, but production recovery uses backups and their separately retained encryption keys. Re-executing a destructive migration cannot recover deleted data.

## Trying out a feature branch, then returning to `main`

A common case: someone asks you to test a branch on your existing install, and you want to know whether checking out the branch, booting it, then switching back to `main` will harm your database.

### Key facts

- Git and PostgreSQL are separate worlds. `git checkout` only swaps files on disk; it never connects to or modifies your database. PostgreSQL stores applied-migration state in the `schema_migrations` table. Switching git branches does not change that table.
- Migrations run automatically on boot (via `initializeDatabase.ts`), so the moment you start the branch, its new migrations are applied to whatever database you pointed at.
- The forward runner never auto-rolls-back. When you return to `main`, it scans the files on disk, finds nothing pending, and does nothing. Migrations the branch applied stay applied.

### Is it safe?

It depends entirely on what the branch's migrations did:

- **Additive only** (new tables / new columns) → safe. The new objects simply sit unused; `main`'s code never references them, so they cannot cause wrong results or crashes. Remove unused objects only through a reviewed migration.
- **Destructive** (`DROP`/`RENAME`/`ALTER` on a table `main` still uses) → not safe. The branch's change strands `main`'s code against a column/table that is now gone or altered.

- **Safest approach**: point the branch at a throwaway database (a separate `POSTGRES_DB`), so your real data is never touched. You already build the connection from `POSTGRES_*` vars, and `bun run nuke-db` can reset a scratch database.

### Manually rolling back a test migration

If you tested a branch against your production database and want to undo its migrations afterward, use the rollback runner. Unlike the forward runner, it never runs automatically: rollback is always a deliberate manual act because `.down.sql` files are typically lossy.

```bash
# Preview only (dry run): show what would be rolled back
bun run migrate:down 034          # this migration + every newer applied one
bun run migrate:down --last       # only the most recently applied migration
bun run migrate:down --last=2     # the two most recently applied migrations

# Execute the rollback (runs the .down.sql files, removes schema_migrations rows)
bun run migrate:down 034 --yes
```

The command runs the selected `.down.sql` files in descending version order (so a migration's dependents are undone before it), then deletes the matching `schema_migrations` rows. With those rows gone, the forward runner will re-apply the migrations the next time you boot a branch that still ships them.

> Note: Run the rollback while still on the branch. The rollback reads `NNN_description.down.sql` from disk. Once you `git checkout main`, those files are gone and the rollback can no longer execute. Roll back first, then switch branches.

> Warning: Rolling back is lossy. Rolling back `034` here runs `DROP TABLE short_term_memories`, so any data created while testing is gone. That is expected for a test cleanup, but never run `migrate:down` against data you want to keep without a backup.

## See also

- [Database schema documentation](/en/architecture/subsystems/database-schema/): learn the current schema structure
- [Bun documentation](https://bun.sh): learn Bun runtime fundamentals
