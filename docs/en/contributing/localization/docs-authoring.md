---
title: "Docs Authoring Conventions"
sidebar:
  order: 20
---

Conventions for adding, moving, and formatting pages on the TomoriBot docs site.

## Files and routes

Write pages in `docs/` at the repository root. `apps/docs/src/content/docs` is a link to it, so edits
there change `docs/` directly. `apps/docs/src/pages` holds custom Astro routes and redirects only.

- `docs/foo/bar.md` is served at `/foo/bar/`; `docs/foo/README.md` at `/foo/`.
- A top-level folder appears in the sidebar when it has a `README.md` or `README.mdx` without
  `sidebar.hidden: true`. Folders below it are discovered recursively.
- File and folder names are URL slugs: short, lowercase, and stable. Put human names in `title`.

## Audience
<!-- anchor: audience -->

Only `docs/en/architecture/` explains how TomoriBot works inside. Every other folder is written for a
reader with a task, so keep its pages plain and short:

- Lead with what the reader can do and what they will see.
- Keep a detail only when the reader needs it to act: a command to run, a setting to choose, a limit
  they will hit.
- Keep implementation details out of task guides unless readers need them to act. Link to the owning
  architecture explanation when one exists; apply the scope test below before adding one.

`features/`, `introduction/`, and `meet-tomori/` are read by Discord users who never see the code.
Write them in everyday words, and open a feature with why someone would want it before how to set it
up. `self-hosting/` readers run their own bot and are often not developers: use plain words and a
clear order, but keep every step, command, and setting, because a missing step is a failed install.

The repository is public and every page outside `docs/en/wiki/` is indexed by search engines. Decide
which kind of page you are writing, because the rules are opposite:

- **A guide** teaches readers to run their own deployment. Use second person and placeholders for
  anything tied to one account (`<gcp-project-id>`, `<resource-group>`). A reader who copies a literal
  project ID gets an error, so a real ID in a guide is a bug.
- **A runbook** operates the project's own production. It lives in `docs/en/wiki/` with real resource
  names, linked from the related architecture page rather than the sidebar. Cloud runbooks live under
  `docs/en/wiki/cloud/<provider>/` on the `release` branch.

A page that is part of each gets split: the description stays public and the procedure moves to
`wiki/` with a one-line pointer.

Never write credentials, API keys, tokens, private keys, connection strings, tenant IDs, or the
production VM's IP on any page. GitHub push protection blocks credentials but not infrastructure
identifiers.

## Architecture scope
<!-- anchor: architecture-scope -->

Each architecture page answers one primary question for a contributor: how components cooperate,
who owns state or side effects, or which constraint makes the design necessary. Before keeping a
paragraph, ask what a contributor would misunderstand or break without it. A detail earns space when
it explains a relationship across components or a constraint that is costly to rediscover. Use a
source pointer when opening the relevant function gives the reader the answer.

Trace the relevant source and callers before rewriting. Verify retained claims as well as changed
ones: a shorter inaccurate explanation is still a defect. Correct stale behavior, paths, and symbols
in the same edit. For external contracts, use current primary documentation when the repository does
not establish the claim. If evidence is unclear, record the unresolved question in review context;
do not turn an assumption into documented behavior or change runtime code to match the prose.

Use this outline when it fits the question; omit sections that add nothing:

- **Purpose:** what the component owns and where it fits, in one or two opening sentences.
- **Flow and ownership:** how inputs, state, and effects pass between components. Use a diagram or
  table when it explains the relationship more clearly than prose.
- **Constraints and rationale:** what must survive a refactor and why, including failure behavior
  when it affects callers, data safety, or external effects.
- **Source pointers:** the few files or symbols where readers should start, plus related pages.

Do not fill a template by repeating the same contract under mission, input, output, and invariants.
Keep local algorithms, exhaustive condition lists, copied type definitions, internal tuning values,
and explanations of individual fixes in source, tests, or review context. A local constraint usually
needs a comment beside its implementation. Contributor procedures belong in an existing contributor
guide, and operational procedures belong in a runbook.

Keep one authoritative explanation of each concept. Other pages explain their relationship to it and
link to the owner. Removing a detail does not require moving it into another document. Maintain
existing explanations when behavior changes; implementation changes alone do not require new prose.
Read the whole affected section after editing and remove repetition introduced by the change.

Review pages that exceed these word budgets:

| Page purpose | Review above |
|---|---|
| Pipeline stage explanation | 800 words |
| Subsystem or integration explanation | 1,500 words |

Count the full body, including lists, tables, and code examples, excluding frontmatter. Above the
budget, review scope and duplication and explain the retained length in the review description.
Required reference material, such as schema relationships or external limits, may justify a longer
page. Keep only what readers use and link to authoritative source or upstream documentation for the
rest. Do not split pages or compress sentences merely to meet the budget. A page below the budget
still needs the scope test.

### Architecture references

These references inform the scope rules above. Project instructions take precedence; adopt the
applicable practice without importing a new folder layout or requiring every template section.

- [Diátaxis explanation](https://diataxis.fr/explanation/) and
  [reference](https://diataxis.fr/reference/): explanations connect concepts and give reasons;
  reference supplies precise facts needed to use an interface. Give each page a primary purpose.
- [Google documentation practices](https://google.github.io/styleguide/docguide/best_practices.html):
  maintain a small, accurate set of docs, update them with code, and remove obsolete or redundant
  content. Its [paragraph guidance](https://developers.google.com/style/paragraph-structure) keeps
  one idea per paragraph and puts the key information first.
- [C4 diagrams](https://c4model.com/diagrams): choose the level of detail that helps the reader
  understand system relationships. Add only useful diagrams; a page does not need every level.

## Frontmatter

```yaml
---
title: "User Guides"
sidebar:
  groupLabel: "User Guides"   # on a folder README only
  order: 90
---
```

| Field | Use |
|---|---|
| `title` | Page title and default sidebar label |
| `description` | Search and link-preview text; generated from the first paragraph when absent |
| `sidebar.label` | Sidebar-only label |
| `sidebar.groupLabel` | Folder label, set on that folder's README |
| `sidebar.order` | Order among siblings |
| `sidebar.hidden` | Hide a page or top-level folder |
| `aiGenerated` | `false` marks human-reviewed substantive content and removes the draft disclaimer |

The sidebar builder reads strings, numbers, booleans, and one nested level. The disclaimer is added
at render time by `MarkdownContent.astro`, never written into Markdown. Human review here covers
substantive content: the page's claims, instructions, and meaning. Every translated page must mirror
its English source's `aiGenerated` field, including its absence. AI translation alone does not change
this status, and the field does not certify translation quality. See
[Docs Site Localization](/contributing/localization/docs-site/#review-state).

## Search and `llms.txt`

- Open every page with one or two plain sentences before any heading, list, or component.
  `apps/docs/src/routeData.ts` turns that paragraph into the meta description.
- Add `description:` when the opening does not summarize the page. Keep it under about 160
  characters, or about 80 for scripts without spaces (per-locale budgets are in
  `src/constants/docsLocales.ts`).
- `wiki/` is `noindex`, out of the sidebar, and out of every `llms*.txt` set.
- The build writes English-only `llms.txt`, `llms-small.txt`, and `llms-full.txt`.
  `apps/docs/scripts/checkLlmsOutput.ts` fails the build if a wiki page or a non-English URL leaks
  in, or if a curated set is empty. When a page moves between audiences, update its page ID in
  `apps/docs/astro.config.mts`; the local `starlight-llms-txt` patch exists because upstream
  `exclude` only covers the abridged output.

## Links

Link between pages with root-absolute URLs that end in a slash: `[Manual Setup](/self-hosting/manual-setup/)`.
Pages deploy as directories, and relative links are not rewritten, so `./setup-wizard` on
`/self-hosting/manual-setup/` points at `/self-hosting/manual-setup/setup-wizard`. Only `README`
index pages, which sit at their directory root, may use `./child` links.

Pin any heading that is a link target with an anchor comment directly below it:

```md
## Keyword Tags
<!-- anchor: keyword-tags -->
```

`apps/docs/src/remarkHeadingIds.ts` removes the comment and uses it as the heading id, so rewording
or translating the heading keeps links working. `bun run check-locales` resolves every internal link
and fragment, including the bot's `DOCS_ROUTES`.

## Moving pages

1. `git mv` the file.
2. Update links in `docs/`, `README.md`, `.github/`, `AGENTS.md`, and `docs/README.md`.
3. To keep an old URL working, add it to the `redirects` map in `apps/docs/astro.config.mts` (a
   meta-refresh page) and add 301 rules to `apps/docs/public/_redirects` with and without the
   trailing slash (real redirects on Cloudflare).
4. Run `cd apps/docs && bun run build`.

## Components and images

Use Starlight's `Card`, `CardGrid`, `LinkCard`, and `LinkButton`. Keep screenshot cards to landing and
router pages, where the screenshots are worth maintaining. Site images must be under
`apps/docs/public`; root `assets/img` is for the repository README and is not deployed.

## Prose

Run `bun run audit-comments --docs <file>` on pages you write. It applies the calibrated slop-guard
rules and the plain-word patterns from the `lint-prose` skill (`.agents/skills/lint-prose/SKILL.md`),
which lists the full rules. It is an on-demand check and not part of CI.
