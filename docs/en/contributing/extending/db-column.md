---
title: "Adding a DB Column"
sidebar:
  order: 10
aiGenerated: true
---

How to add a column to an existing table.

## Steps

1. In `src/db/schema.sql`, add the column to the `CREATE TABLE` statement and add an idempotent
   `add_column_if_not_exists()` call. Existing databases never rerun `CREATE TABLE IF NOT EXISTS`, so
   without the call the column reaches only fresh installs:

   ```sql
   SELECT add_column_if_not_exists('table_name', 'column_name', 'BOOLEAN', 'false');
   ```

2. If existing rows need a backfill, or a column moves or is dropped, add a numbered migration
   `src/db/migrations/NNN_name.sql` with a matching `.down.sql`. Choose `NNN` after checking every
   branch (`git ls-tree`), because `bun run check-migrations` only sees the working tree.
3. If the table has a Zod schema in `src/types/db/schema.ts`, add the field to the schema and its types.
4. Read and write it through the owning repository in `src/utils/db/repositories/` (see
   [Raw SQL Boundary](/contributing/policies/raw-sql/)).
5. After a successful write, invalidate the affected caches in the same code path; never before the
   write and never on failure.

- **Runtime config columns**: a column on a `server_*_configs` table that the bot reads through
`tomoriState.config` must also be added to both config SELECTs in
`src/utils/db/repositories/PersonaRepository.ts` (`loadTomoriState` and `loadAllForServer`; search
for `scaps.tool_use_enabled`). `assembledServerConfigSchema` gives each field a `.default()`, so a
column missing from the SELECT is silently replaced by its default and a check like
`config.flag === false` never fires, with no type or test failure.

- **Descriptions**: model and preset descriptions use the existing `descriptions` JSONB locale map. Do
not add a column per language; add translations to the seed catalog's `i18n` field and keep English in
`desc`. System prompt presets also carry `display_names` (seed field `names`) for the picker label; the
English `name` stays the stored identity and the fallback.

## Verify

```bash
bun run check
bun run lint
bun run check-migrations   # if you added a migration
bun run db:lifecycle       # needs a local PostgreSQL user that can create databases
```

Schema reference: [Database Schema](/architecture/subsystems/database-schema/). Cache map:
[Caching](/architecture/subsystems/caching/).
