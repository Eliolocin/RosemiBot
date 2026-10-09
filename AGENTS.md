# AGENTS.md

The shared operating manual for coding agents working in TomoriBot. Every agent loads this file in
every session, so it holds only always-on rules and navigation. Detailed conventions live in
`docs/en/contributing/`.

## Project Snapshot

TomoriBot is a Discord AI chatbot built with TypeScript + Bun, with:
- Multi-provider LLM support (Google Gemini, OpenRouter, NovelAI, Custom)
- Persistent memory and caching
- Multi-persona behavior and webhook-based persona identity
- Localization (`en-US`, `ja`, `pt-BR`, `es-419` (aliased `es-ES`), `zh-TW`, `zh-CN`, `vi`)
- Tool calling (built-in, REST, MCP)
- Optional local servers and self-hosting (KoboldCPP, TTS servers, etc.)

## Making a Change

Read the code the change touches and trace the real flow first. Then stop at the first rung that
holds:

1. Does it need to exist? If nothing breaks without it and nobody asked, skip it.
2. Does the codebase already do it? Find the helper, registry, or pattern and extend it. A parallel
   module beside an existing pattern is a defect.
3. Does Bun, discord.js, or an installed dependency do it? Use it. New dependencies follow
   `docs/en/contributing/policies/dependency-security.md`.
4. Only then write the smallest complete change. Complete includes everything the rules below require
   to travel together: docs, migrations, cache invalidation, and English locale keys.

Reuse without speculating:
- Extract a shared helper only when a second real caller exists.
- Check every caller before fixing a bug in a shared function.
- No compatibility shims, fallback paths, or options for states the code cannot reach. Validate at
  trust boundaries (user input, provider responses, URLs, stored JSON); trust typed internal values.
- A deliberate shortcut with a known ceiling gets a comment naming the ceiling and the upgrade trigger.

Never minimized: trust-boundary validation, the SSRF gate (`validateRemoteUrl`), secret redaction,
data-loss handling, cache invalidation, interaction acknowledgement, and localization.

Before adding a CI job, environment variable, test suite, or abstraction nobody requested, state what
the smaller option loses. If the answer is nothing concrete, do not add it.

Stay in scope. Report adjacent problems instead of fixing them in the same change, and verify a
proposed follow-up's premise in source before suggesting it.

## Always-On Rules

1. Follow project formatting and type standards.
   - 2 spaces for indentation, double quotes, strict TypeScript.
   - Use path alias imports (`@/*`) for `src/*`.
   - Avoid `any`; use typed interfaces/schemas.
   - Full conventions: `docs/en/contributing/development-tasks.md` (Coding Conventions section).
2. Comment to explain rationale.
   - Explain why a constraint, quirk, or invariant exists; never restate the line below it.
   - No step numbering or `Rule N:` scaffolding in comments and JSDoc.
   - No prose em/en dashes or spaced double hyphens in comments, JSDoc, `docs/`, or locale strings.
     Use the punctuation that names the relationship: colon when the second half explains the first,
     `, so` when causal, parentheses for an aside, period or semicolon between independent clauses,
     plain hyphen for numeric ranges. In `ja`, use `：`, `。`, and `（）`. Enforced by `prose-dash`.
   - Skip `@param`/`@returns` that repeat the name or type; the signature already states it.
   - Full policy: `docs/en/contributing/policies/comments.md`. Audit with `bun run audit-comments`.
     For how prose reads, use the `lint-prose` skill.
3. Keep real identities and meta-dates out of public prose.
   - Docs, code comments, tests, and locale strings ship publicly: use invented placeholder names
     (`Mirri`, `Juno`, `Bau (@bau_h)`), never a real contributor, advisor, or user's name, handle,
     or account.
   - Attribute guidance to its reason, such as "by domain constraint". Omit author attribution
     such as "per <person>".
   - Omit dates describing when work happened, broke, or was decided. Keep dates that belong to the
     subject: API versions, deprecation deadlines, legal effective dates.
   - One deliberate exception: `docs/en/wiki/threat-models.md` opens with a visible `Updated on:`
     line, because a reader deciding how far to trust a security page needs to see how current the
     review is. Update it in the same change that revises the page.
   - Git-ignored files (`plans/`, local notes) may name people and dates freely.
4. Localize all user-facing text.
   - Use `localizer()` for replies, embeds, command metadata, and choices.
   - Author new and changed keys in `src/locales/en-US/` (split by area: `commands.ts`, `tools.ts`,
     `providers.ts`, `general.ts`, `bridges.ts`, `commands/`). Other locales fall back to English, so
     updating them is optional. To translate a branch's English changes, use the `sync-locales` skill.
   - **Command option/parameter locale key naming** (auto-localized by `commandLoader`):
     - Option descriptions: `{option_name}_description` (e.g. `channel_description`)
     - Choice labels: `{choice_value}_option` (e.g. `injection_option`, `enable_option`)
     - Do NOT use `{option_name}_option` for option descriptions; it silently fails auto-localization.
   - Never open a title key with a status circle (`🔴`, `🟡`, `🟢`). `src/utils/discord/ui/statusTitle.ts`
     renders it from the surface color, and a hardcoded one is stripped as contradictory.
   - Panel text: write natural prose and let `buildPanelContainer()` wrap it at runtime. See
     `docs/en/contributing/policies/panel-prose-and-layout.md`.
5. Respect Discord interaction timing.
   - Acknowledge interactions within 3 seconds (`reply`, `deferReply`, or modal).
   - Do not pre-defer before modal/pagination helpers.
   - Use detailed timing patterns in `docs/en/architecture/subsystems/command-system.md`.
6. Keep slash-command behavior only.
   - Do not add legacy prefix command pathways.
7. Invalidate caches after successful DB writes.
   - Never invalidate before write success.
   - Keep invalidation in the same code path as the write.
8. Admit configuration deliberately.
   - Default to a named constant in the owning module.
   - An environment variable is for a deployment boundary: host resources, network behavior,
     external service credentials or quotas, or an operator choice that reasonably varies between
     installations. Internal probabilities, parser lookbacks, UI geometry, and algorithm tuning stay
     constants unless a concrete deployment use case proves otherwise.
   - One variable per setting: no engine-specific plus shared fallback pairs.
   - Settings a server or user changes at runtime belong in the database.
   - Full test: `docs/en/contributing/extending/env-variable.md`.
9. Use safe DB and error patterns.
   - Use Bun SQL template literals for queries.
   - Use structured logging via `log` with metadata.
10. Test in proportion, and pass the quality gates before finishing.
    - Test behavior, regression risk, or an interface other code depends on (an exported API, a
      stored data shape, a Discord limit). A bug fix gets the regression test that would have caught
      it. No tests that only prove wiring or a helper exists, and no dedicated test suites or CI jobs
      for optional local servers (`servers/`), installers, or devtools.
    - Use one test to loop over locales and report every failure.
    - Assert localized copy by key (`localizedCopy` or `localizedProse` from
      `tests/helpers/localeCases.ts`), never by quoting its English text. Unlocalized prose (error
      messages, generated reports) is not asserted verbatim either; assert count, structure, or behavior.
    - Assert an exact count or a complete member list only when that exact count or list is what must
      not change.
    - Code kept alive only by a test import is dead code.
    - Build fixtures with the factories in `tests/helpers/` (see its README), and only from values
      production can produce. Patterns to avoid: `docs/en/contributing/testing/maintainable-tests.md`.
    - Run tests with `bun run test [files]`, never bare `bun test`, for anything under
      `tests/regression/db/`. Only the wrapper provisions the disposable database; a bare run skips
      those suites, and a skipped suite is not a pass.
    - Gates: `bun run check`, `bun run lint`, and `bun run check-locales` when localization or command
      metadata changes. A passing gate says nothing about files it does not scan.

## Review Findings

Every finding gets one disposition before anyone implements it:

- Accept now.
- Defer with a concrete trigger.
- Not worth its maintenance cost.
- Reject because its premise is false or already handled.

Severity describes impact if the finding is real; it does not make a fix mandatory. Implement only
accepted findings. Full rubric: `docs/en/contributing/development-tasks.md` (Proportionality section).

## Common Commands

- `bun run dev` - primary development workflow
- `bun run build` - build to `dist`
- `bun run check` - TypeScript validation
- `bun run lint` - Biome lint/format
- `bun run check-locales` - locale key checks (non-English parity is advisory)
- `bun run vl` - every gate with one verdict per gate

## Codebase Map

- `src/commands/` - slash commands
- `src/events/` - event handlers
- `src/providers/` - LLM providers/adapters
- `src/tools/` - built-in tools, REST API tools, MCP integration
- `src/utils/` - cache, Discord, DB, provider, security, text helpers
- `src/types/` - shared type definitions
- `scripts/` - local tooling and database scripts
- `.agents/skills/` - on-demand agent workflows (`sync-locales`, `lint-prose`)

## Code First, Docs for Why

Read the code for behavior. Before changing a subsystem, read its page under `docs/en/architecture/`
for the flow and the invariants that no single file shows. When code and docs disagree, the code wins
and the doc is fixed in the same change. `docs/README.md` indexes every page.

## Task Navigation

| Task | Read first |
|---|---|
| Add a slash command | `docs/en/contributing/extending/slash-command.md` |
| Choose what kind of command or panel to build | `docs/en/contributing/policies/command-archetypes.md` |
| Add a panel or panel button | `docs/en/contributing/extending/panel.md` |
| Add a DB column or table | `docs/en/contributing/extending/db-column.md` |
| Add a built-in tool | `docs/en/contributing/extending/builtin-tool.md` |
| Add a new AI provider | `docs/en/contributing/extending/new-provider.md` |
| Add a feature flag tool | `docs/en/contributing/extending/feature-flag-tool.md` |
| Add an event handler | `docs/en/contributing/extending/event-handler.md` |
| Add an environment variable | `docs/en/contributing/extending/env-variable.md` |
| Add a locale | `docs/en/contributing/localization/new-locale.md` |
| Localize the docs site or READMEs | `docs/en/contributing/localization/docs-site.md` |
| Add a persona preset | `docs/en/contributing/extending/persona-preset.md` |
| Write or edit panel text | `docs/en/contributing/policies/panel-prose-and-layout.md` |
| Inspect production | `docs/en/wiki/cloud/azure/azure-production-inspection.md` on `release` |

## Branch Layout

Cloud deployment lives on `release` only, so a `main` checkout has no `terraform/`, `deploy/`,
`.github/release/`, or `docs/en/wiki/cloud/`. When a path referenced here or in `docs/` is missing,
check `release` before concluding it was deleted:

```bash
git show release:terraform/azure/main.tf
```

Never merge `release` into `main`: that recreates a merge base containing the release-only paths,
after which the next `main` into `release` merge deletes them from `release` without a conflict.
Fixes belong on `main` and flow forward.

## Documentation Maintenance

Update docs in the same change when an existing explanation becomes inaccurate or a change
introduces a cross-component contract, constraint, or workflow readers need. Prefer revising existing
text over appending; do not narrate implementation branches.

1. Update the page that already owns the topic (behavior, flow, config, schema, constraints). Add a
   page only when no owner exists, and update `docs/README.md` when adding, removing, or renaming one.
2. Docs describe current behavior. Roadmaps and refactor proposals belong in `plans/`; changelogs,
   progress reports, and summaries restating a page belong nowhere.
3. Architecture pages explain system flows, ownership, and constraints that require reading across
   components. Keep local algorithms, exhaustive branches, and copied field definitions in source; use
   source pointers instead of duplicating them. Follow the scope and review budgets in
   `docs/en/contributing/localization/docs-authoring.md` ("Architecture scope"). Every other folder
   is written for its reader's task, plainly and concisely, keeping only
   the details a reader needs to act. User-facing pages (`features/`, `introduction/`,
   `meet-tomori/`) use everyday words. Self-hosting guides use plain words but keep every step,
   command, and setting. Contributor guides are recipes: files to touch, types and limits to satisfy,
   commands to run.
4. A page centered on a cloud provider service goes under `docs/en/wiki/cloud/<provider>/` on
   `release`. `docs/en/self-hosting/` is for provider-agnostic hosting on the user's own machines.
5. This repo is public and every page outside `docs/en/wiki/` is indexed. Guides use placeholders
   (`<gcp-project-id>`, `<resource-group>`); a literal value a reader would copy is a bug. Runbooks act
   on our production, so they go in `docs/en/wiki/` (hidden + `noindex`) and keep real names. Never
   write credentials, tenant IDs, or the production public IP into any page. Full rules:
   `docs/en/contributing/localization/docs-authoring.md` ("Audience").

## Maintaining This File

Update `AGENTS.md` in the same change when that change makes one of its rules, commands, paths, or
links inaccurate. It is not a changelog and not a copy of the contributor docs. A new always-on rule
replaces an existing one or prevents a defect that has already recurred; anything else goes in
`docs/` or a skill.
