/**
 * Advisory IDs `bun audit` is told to skip, shared by `auditClean.ts` and `vl.ts` so a local run
 * and the `ci.yml` gate never disagree about what blocks. The same list is mirrored as a
 * `run:` flag in `.github/workflows/ci.yml`, and container-scan equivalents live in
 * `.trivyignore`.
 *
 * Every entry needs a justification and a retirement condition in
 * `docs/en/contributing/policies/dependency-security.md`. `bun audit --ignore` matches by advisory ID
 * across the WHOLE tree, not per dependency path, so an entry keeps hiding the advisory even if a
 * later dependency change puts the package on a reachable path.
 */
export const AUDIT_IGNORED_ADVISORIES: readonly string[] = ["GHSA-vfj7-8cjw-p6xm"];
