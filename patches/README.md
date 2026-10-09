# Dependency Patches

This directory tracks TomoriBot's manual dependency patches and vendored dependency overrides.

For when to reach for a patch instead of an override or an audit exception, and for the list of
accepted advisories, see `docs/en/contributing/policies/dependency-security.md`. Patches here bump a
manifest, add a compatibility shim, or stub an unusable module; they never reimplement library
behavior, and they cannot clear `bun audit`, which grades resolved lockfile versions.

Keep these changes small, package-scoped, and temporary. On any related dependency update, try removing the patch or override first, then run:

- `bun install`
- `bun audit`
- `bun run check`
- `bun run lint`

Remove the patch or override permanently once those commands pass without it.

## Revert Procedure

Use this checklist whenever an upstream dependency update may have made a manual patch or override unnecessary:

1. Remove the relevant patch file and/or override entry.
2. Delete any vendored dependency directory tied to that override.
3. Run `bun install` to refresh `bun.lock`.
4. Run `bun audit`.
5. Run `bun run check`.
6. Run `bun run lint`.
7. Keep the removal only if all checks pass and the dependency path stays fixed.

## Active entries

### `patches/@matrix-org%2Fmatrix-sdk-crypto-nodejs@0.4.0.patch`

- Reason: the native Windows binding is not published for the Matrix crypto package, but TomoriBot's Matrix bridge only needs plaintext relay behavior. The patch replaces module-load crashes with lazy-throw stubs so accidental crypto usage still fails explicitly.
- Remove when: upstream publishes a working Windows binding for this package, or TomoriBot no longer loads this module in plaintext bridge mode, and the Matrix bridge still starts cleanly without the patch.
- How to revert: remove the `@matrix-org/matrix-sdk-crypto-nodejs@0.4.0` entry from `patchedDependencies`, delete this patch file, run `bun install`, then verify Matrix bridge startup and the quality gates above.

