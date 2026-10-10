---
title: "Development Tasks"
sidebar:
  order: 3
---

Conventions and checks that apply to every change. The guide for each task is listed in the
[Contributing overview](/contributing/).

## Checks

```bash
bun run check           # TypeScript strict, including tests/
bun run lint            # Biome; applies fixes in place
bun run check-locales   # when locale keys or command metadata changed
bun run find-stale-translations --reason=unfollowed --base=origin/main   # advisory translation follow-up
bun run db:lifecycle    # when schema.sql changed
```

- `bun run lint` rewrites files, so commit what it changes. CI runs `bun run lint:ci`, which fails on
  formatting instead of fixing it.
- `bun run db:lifecycle` needs a local PostgreSQL user that can create and drop databases. It tests
  fresh initialization, backup and restore, and the maintenance scripts in a temporary database.
- `bun run test <path>` runs selected files through the same disposable-database setup.

`bun run vl` runs every gate and prints one verdict per gate. Its last line is for scripts:
`vl-status: PASS exit=0 pass=<n> warn=<n> fail=<n> skip=<n>`. Passing gates are silent and failing
gates print everything; `--verbose` prints all output. To keep the output, redirect it to a file
instead of piping through `grep` or `tail`, which replaces the gate's exit code with the filter's:

```bash
bun run vl > /tmp/vl.log 2>&1; echo "VL_EXIT=$?" >> /tmp/vl.log
```

## Conventions

- Two-space indentation and double quotes (Biome enforces both).
- Strict TypeScript without `any`. Shared types go in `src/types/`. Validate untrusted input with Zod.
- `camelCase` file names, `@/*` imports for `src/*`, and `node:` imports for Node built-ins.
- Comments follow the [comment policy](/contributing/policies/comments/). JSDoc on exported functions
  only where behavior is not obvious from the name and types.
- Log with `log` from `src/utils/misc/logger.ts`, with context such as `errorType` and IDs. Handle
  startup-critical failures differently from recoverable ones. Pick the level by reader:
  - `log.error`: a failure the hoster must act on. It reaches production and `error_logs`, so keep
    it deliberate. Pass `{ persist: false }` when the failure is the database path itself.
  - `log.warn`: developer trace (causes, free text, stack details). Hidden in production unless the
    hoster sets `LOG_LEVEL=warn`.
  - `log.metric`: a sample to count or graph. Numbers and string fields from a fixed set (codes,
    reason keys) only; free text cannot be grouped, so it goes to `log.warn`. An expected refusal is
    a metric plus a warn, never an error.
- Slash commands only. Every user-facing string goes through `localizer()`. Follow the interaction
  timing rules in [Command System](/architecture/subsystems/command-system/).
- Query with Bun SQL template literals, and write idempotent migrations (`IF NOT EXISTS`, guarded
  blocks). Schema reference: [Database Schema](/architecture/subsystems/database-schema/).
- After a write that affects cached reads, invalidate the cache keys, and only after the write
  succeeds. Never edit a cached object in place. See [Caching](/architecture/subsystems/caching/).

- **Constants and environment variables**: name every magic number as a constant in the module that
owns it, with a comment when the value was measured or comes from an external limit. Make a value an
environment variable only when it is a deployment choice: host resources, network behavior, external
credentials or quotas, or an operator decision that differs between installations. Probabilities,
lookbacks, UI geometry, and algorithm tuning stay constants. Use one variable per setting, never an
engine-specific name plus a shared fallback. Settings that servers or users change at runtime go in
the database. Placement and naming: [Adding an Environment Variable](/contributing/extending/env-variable/).

## Proportionality

Every test, variable, CI job, abstraction, and comment costs maintenance. Add one only when you can
name the failure it prevents.

### Reuse and abstraction

- Search for an existing helper, registry, or pattern before writing a new one, and extend it.
- Extract a shared helper once a second real caller exists. An expected future caller does not count.
- Fix a bug in the shared function after checking every caller.
- Do not add compatibility shims, fallback paths, or options for states the code cannot reach.
  Validate at trust boundaries and trust typed internal values.
- File size alone does not justify a split. Name the maintenance or correctness problem.

### Tests
<!-- anchor: tests -->

- Test behavior, regression risk, or an interface other code depends on (an exported API, a stored
  data shape, a Discord limit). A bug fix gets the regression test that would have caught it.
- Do not test that wiring or a helper merely exists.
- Loop locales or panels inside one test that collects every failure, instead of generating one test
  per locale. `expectForEveryLocale` and `collectCaseFailures` in `tests/helpers/localeCases.ts` do
  the collecting.
- Assert localized copy by key, never by quoting its English. Use `localizedCopy(locale, key)`, or
  `localizedProse` when panel formatting may wrap the line. Both fail on an unknown key, so a copy
  edit passes while a wrong or deleted key does not. Quote a literal only for an identifier, such
  as a command name, or for text the test itself supplied.
- Assert an exact count or a complete member list only when that exact count or list is what must
  not change. Otherwise assert stable IDs, uniqueness, or that the required members are present.
- Optional local servers (`servers/`), installers, and devtools do not get dedicated test suites or
  CI jobs by default.
- A function whose only remaining caller is a test is dead code; delete both.
- Add CI coverage only when unattended enforcement is valuable and the environment is supportable.
- Before a broad audit, write the candidate filter and the decision rubric.

### Review findings

Give every finding, from an agent or a human, one disposition before implementation:

| Disposition | Meaning |
|---|---|
| Accept now | Fix it in this change. |
| Defer | Record the concrete trigger that will make it worth doing. |
| Not worth it | Real, but the fix costs more to carry than the risk it removes. |
| Reject | The premise is false or already handled. |

Severity describes impact if the finding is real. It does not make a fix mandatory. A
recommendation states its expected value, its implementation and maintenance cost, and the source
evidence for its premise. Implement only accepted findings.
