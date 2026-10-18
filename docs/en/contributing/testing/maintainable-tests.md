---
title: "Writing Maintainable Tests"
sidebar:
  order: 30
aiGenerated: true
---

Patterns that made the test suite larger, slower, or quietly wrong, and what to write instead. Each one was
counted in this repository before it was written down. Fixture rules (shared factories, derived defaults,
unknown option keys, asserting copy by key) live next to the helpers in
`tests/helpers/README.md`.

## Fixtures

- **Build only what production can produce.** A fixture with a union variant, field, or enum value the real
  type lacks skips the path under test while the suite stays green. A cast (`as Row`, a Proxy over a partial
  literal) hides the same mistake from the type checker, so remove the cast rather than widen it.
- **Budget the payload the user receives.** A limits test that measures a standalone builder the user never
  sees proves nothing about the page they do see. Build the real page, as `tests/helpers/configMcpPage.ts` does
  for MCP servers.
- **Narrow panel payloads with a guard.** discord.js types a component's `type` as the whole
  `ComponentType` enum, so `type ===` narrows nothing. Use an `in` guard or a
  `component is ContainerComponentData<...>` predicate; a hand-declared `{ components: ... }` view is the last
  resort.

## Shape

- **Restore schema and catalogs after migration tests.** DB suites share one disposable database.
  A down-and-forward test must restore the current schema and reseed dropped catalogs in `finally`.
  Assert that the restored defaults are usable before leaving the test, so failures do not depend on
  which suite runs next.
- **Table a family of route cases.** Put build and parse round trips, arity, wire contracts, and rejections
  in one `it.each` table per family.
- **Split long tests into named cases.** A test over about 100 lines usually covers several scenarios, and its
  failure message cannot say which one broke.
- **Loop locales inside one test** that reports every failing locale (`expectForEveryLocale`), not one test per
  locale.

## Redundancy

- **Do not restate an assertion another test owns.** A registration or gate test that re-proves a root,
  permission, or description should name the owning test instead. These copies accumulated as per-slice gates
  during the command modernization.
- **Skip the round trip beside decode and encode tests.** When both run over the same table,
  `parse(wire) = route` and `build(route) = wire` already imply `parse(build(route)) = route`.

## Locales

- **A non-English `localizer()` check proves only en-US.** `localizer` falls back to en-US per key, so use
  `hasLocaleKey` for a per-locale presence check.
- **Prove a narrowed sweep still asserts something.** Assertions guarded by English text stop running under
  another locale. When a sweep drops locales or cases, force a failure and show the kept assertions catch it.

## Speed

A real sleep, a subprocess spawn, or a nested all-locale sweep in a unit test needs a stated reason a cheaper
fixture cannot prove the same thing. Five such files once took half the `unit` lane, and the lanes run
concurrently, so that lane is the suite's wall clock. Prefer an injected interval over a real wait, a fixture
built once and copied over repeated `git` calls, and one representative locale for an expensive matrix.

## Dead code

- **Delete a helper with its last production caller.** When a command is dissolved or migrated, a helper whose
  only remaining importer is a test is dead code, and so are its tests. Knip counts a test import as usage, so
  no gate reports it. The same blind spot covers a method on an exported singleton, an option no caller passes,
  and a result field no caller reads.
- **An unread result field may be a dropped feature.** If a migrated operation still computes a value the old
  command showed the user and nothing renders it now, treat it as a regression until someone confirms it was
  dropped on purpose.
