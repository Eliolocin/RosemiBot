---
name: adversarial-review
description: Review a TomoriBot code change for concrete regressions, missed requirements, unsafe assumptions, security failures, and unnecessary complexity. Use for adversarial reviews, PR reviews, pre-merge audits, or finding bugs in a diff, branch, commit, or work-in-progress change. Review only unless the user asks to implement accepted findings.
---

# Adversarial code review

Review the change/current diff as a skeptical maintainer to verify whether it fails under realistic conditions.

Construct plausible failure cases, trace them through the code, and report only defects supported by repository evidence. `No findings.` is a valid result.

Do not modify files, create commits, push branches, or post review comments unless the user asks to implement accepted findings.

## Establish the review target

Identify the exact change under review before evaluating it.

- Pull request: read its description, linked issue or specification when available, commits, and complete diff.
- Current branch: find the merge base with the target branch and review commits from that base to `HEAD`.
- Commit: review it against its parent.
- Uncommitted work: inspect staged and unstaged changes.
- Supplied patch or files: review the supplied change and read other repository files only when needed for context.

For a branch targeting `main`:

```bash
git merge-base HEAD origin/main
git diff <merge-base-sha>...HEAD
```

Use the real upstream or requested base when it differs from `main`.

Determine intended behavior from the user's request, PR description, `AGENTS.md`, contributor guides, architecture pages, existing implementation, and tests.

Code establishes current runtime behavior. When documentation and code disagree, the code describes what the program currently does. When an intentional behavior change makes existing documentation inaccurate, update the owning documentation in the same change.

## Review the real execution path

The diff identifies what changed. Read enough surrounding code to understand what the change does at runtime.

Follow callers, callees, persisted state, caches, permissions, provider selection, and external input when they affect the changed behavior. Search for existing helpers and repository patterns before reporting missing or duplicate logic.

When a shared function changes, check its callers.

Trace at least one complete use case from its entry point to its final effect. For important state changes, also trace a failure path.

Challenge assumptions using states the application can realistically reach:

- Malformed, absent, stale, duplicate, or boundary-sized input.
- Retries, repeated interactions, and concurrent operations.
- Partial failure after an earlier side effect succeeds.
- Process restart between related operations.
- Existing installations running older persisted state.
- Stale cache entries.
- Missing permissions.
- State crossing guild, channel, user, or persona scope.
- Provider errors, unsupported capabilities, or malformed responses.

Trust typed internal values unless the reviewed change introduces a path that bypasses that invariant.

## Check TomoriBot invariants

Apply these checks when the changed code touches the relevant subsystem.

### Persistence and caches

For stored state, verify the complete path from persistence to runtime use.

Check schema initialization, migrations when required, Zod schemas and types, repository reads and writes, cache invalidation, and any import, export, or reset behavior that owns the same data.

Database writes that affect cached reads must invalidate those caches only after a successful write.

A schema default can hide a missing database field. Verify that required stored values are selected in queries and reach runtime code.

### Discord interactions

Check acknowledgement timing and interaction lifecycles.

Interactions must be acknowledged within 3 seconds. Work that may take time runs after acknowledgement. Modal paths call `showModal()` without pre-deferring.

Persistent component routes re-check current authorization and state. Validate custom IDs and user-controlled values before use.

Check Discord limits when the change affects components, selects, modals, embeds, attachments, or message content.

Account for interaction lifecycles: message collectors expire on timeout, while globally routed components handle interactions across process restarts.

All user-facing text uses the locale system, including command metadata and choices. Command option keys use `{name}_description`; choice keys use `{choice}_option`.

### Security and external input

Trace untrusted values through validation to the operation that consumes them.

For a security finding, identify:

1. The untrusted input or value.
2. The missing or bypassable check.
3. The concrete security impact.

Preserve existing protections such as `validateRemoteUrl`, permission checks, secret redaction, archive limits, and input validation.

Check authorization against the target resource even when the requester is authenticated.

### Providers and credentials

When a change performs provider work, verify which provider, model, capability, and credentials are selected.

User-triggered AI work follows TomoriBot's personal-provider routing where required. Server-wide maintenance uses server credentials.

Read the affected adapter when behavior depends on provider-specific request formats, responses, capabilities, or errors.

Secrets must not appear in logs or user-visible errors.

### Tests and maintenance cost

A bug fix requires a regression test that fails against the unpatched code.

Verify that changed tests assert runtime behavior and that their mocks do not hide the tested failure.

Follow the repository's proportionality rules. Do not request tests, abstractions, environment variables, dependencies, compatibility paths, or CI work without a concrete failure they prevent.

Prefer an existing helper, registry, dependency, or project pattern over parallel implementation.

For test changes, apply `docs/en/contributing/testing/maintainable-tests.md` and the fixture rules in `tests/helpers/README.md`, reporting a pattern only when the diff introduces it. Two of them hide real defects rather than cost, so check them on every test diff:

- A fixture production cannot produce: a variant, field, or enum value the real type lacks, a cast that hides one, or a limits test on a payload the user never receives.
- A diff that removes a helper's last production caller but keeps the helper and its tests, or leaves a migrated operation's result field with no reader.

## Check repository rules

Read `AGENTS.md` and any contributor guide it points to for the changed area. Treat explicit repository
requirements as part of the review.

Report a violation when the changed code conflicts with a concrete rule that applies to it, including
coding conventions, localization, comments, dependency use, configuration placement, tests,
documentation maintenance, and required validation.

Do not duplicate formatter or type-checker output unless the violation reveals a behavioral or
maintenance problem those tools do not explain. Do not report subjective style preferences.

## Prove findings

A formal finding needs all of these:

- The reviewed change introduced the problem or made an existing dormant problem reachable.
- The scenario can occur in TomoriBot.
- The consequence affects correctness, security, data integrity, user behavior, performance, or maintainability.
- Repository evidence supports the causal path.
- The problem is specific enough to fix.

Try to disprove each candidate finding before reporting it:

- An earlier guard or validation step.
- Caller guarantees.
- Type or schema constraints.
- Transactions or cache helpers.
- Framework or library behavior.
- Tests that exercise the scenario.
- Documentation showing the behavior is intentional.

Discard findings whose premise fails.

Put a concern under `Needs verification` when important evidence is unavailable. State what evidence is missing.

Keep unrelated pre-existing problems under `Adjacent observations`.

Do not report style preferences, unreachable hypothetical states, speculative future requirements, comments that restate code, abstractions without a second real caller, configuration added only for flexibility, or refactors justified only by file size or taste.

## Severity

Severity describes impact when the finding is real.

- `P0`: Critical. Broadly exploitable security failure, destructive data corruption, or a defect that prevents the application from operating.
- `P1`: High. Serious failure on a realistic path causing security exposure, data loss, widespread breakage, or failure of a core workflow.
- `P2`: Medium. Supported behavior breaks under realistic input, state, or configuration.
- `P3`: Low. Concrete incorrect behavior with limited impact.

State the conditions required to reach the failure.

Severity measures impact. Finding dispositions determine which fixes to implement.

## Verification

Run targeted checks when they can confirm or reject a suspected finding.

Useful commands include:

```bash
bun run test <relevant-test>
bun run check
bun run lint:ci
bun run check-locales
bun run check-migrations
bun run db:lifecycle
```

Use the narrowest relevant check first.

Run tests through `bun run test`, not bare `bun test`: only the wrapper provisions the disposable database, so a bare run silently skips `tests/regression/db/` and reports no failure.

During a read-only review, use `bun run lint:ci`. `bun run lint` rewrites files.

A passing check proves nothing about code it does not execute.

Do not modify production state or call destructive external services to prove a finding.

## Output

Put confirmed findings first, ordered by severity.

Use:

```markdown
### [P1] Short title: `src/path/file.ts:123`

When <condition>, <failure occurs>. The changed code <causal path>, which causes <impact>.

Evidence: <specific code, test, or documented invariant>.
```

Each finding should make the trigger, causal path, wrong behavior, and impact clear.

Cite the narrowest useful changed location. Add a short fix direction only when it helps explain the defect.

After findings, include only sections with useful content:

```markdown
## Needs verification

Concerns that lack enough evidence for a formal finding.

## Adjacent observations

Important problems discovered during review that the change did not introduce.

## Verification

Checks and targeted tests run, including failures or environment limitations.

## Assessment

Brief summary of the change and any remaining material risk.
```

When there are no qualifying findings, begin with:

```text
No findings.
```

Do not invent low-value findings to make the review look productive.

## Before implementing findings

When the user asks for fixes, assign each finding a repository disposition first:

- **Accept now:** fix it in this change.
- **Defer:** record the concrete trigger that would make the work worthwhile.
- **Not worth it:** the issue is real, but carrying the fix costs more than the risk justifies.
- **Reject:** further investigation shows the premise is false or already handled.

Implement only accepted findings. Keep adjacent problems outside the change unless the user expands the scope.
