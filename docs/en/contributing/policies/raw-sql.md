---
title: "Raw SQL Boundary"
sidebar:
  order: 40
---

Raw SQL lives only in the repository layer, `src/utils/db/repositories/`. Commands, events, tools,
context builders, and caches call a repository method instead, so each query, its validation, and its
cache invalidation stay in one place.

```ts
// Not allowed outside the repository layer
const [row] = await sql`SELECT * FROM users WHERE user_disc_id = ${id}`;

// Allowed anywhere
const user = await userRepository.loadByDiscordId(id);
```

## What the scanner flags

`scripts/checks/lib/sqlAudit.ts` flags `sql` and `tx` tagged templates outside the allowed paths,
including typed forms such as `sql<Array<{ id: number }>>` and `tx` inside `sql.transaction(...)`.
It ignores comments, plain strings, identifiers that only end in `sql` (`mysql`), and the
`sql.transaction(...)` and `sql.begin(...)` calls themselves. A utility can therefore open a
transaction and pass `tx` to a repository method.

## Moving a query into a repository

1. Check whether a method already exists. Duplicated lookup and count queries are a common source of
   violations.
2. Add the method to the repository that owns the table (`users` → `UserRepository`,
   `server_model_configs` → `ConfigRepository`, `personas` → `PersonaRepository`). The singletons are
   exported from `src/utils/db/repositories/index.ts`.
3. A write method invalidates its cache after the write succeeds, in the same code path; never before
   the write and never on failure.
4. Call the method and remove the inline SQL and its `import { sql } from "@/utils/db/client"`.

## Exemptions

`sqlAudit.ts` has two allow-lists:

- `IGNORE_PATHS`: skipped entirely. The repository layer, the DB client, migrations and their runner,
  DB initialization, and `src/types/`.
- `EXEMPT_PATHS`: single files allowed to keep raw SQL, each with a reason, reported as `EXEMPTIONS`.
  Today these are status and observability helpers, security primitives, the logger, and the RAG
  service facade.

Add an `EXEMPT_PATHS` entry only when a repository does not fit, such as a security primitive that
must own its table access, and always give the reason:

```ts
["src/utils/security/myPrimitive.ts", "security primitive; owns its own key table access"],
```

## Checks

- `bun run audit-sql` prints `WRITES`, `READS`, and `EXEMPTIONS`, and exits non-zero on any
  violation. It runs in `bun run vl` and in `ci.yml`.
- `tests/unit/db/rawSqlBoundary.test.ts` asserts zero violations on the real tree and tests the
  scanner against comments, strings, and real literals. It uses the same scanner as `audit-sql`.

Related: [Adding a DB column](/contributing/extending/db-column/),
[Caching](/architecture/subsystems/caching/).
