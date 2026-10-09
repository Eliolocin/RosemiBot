---
title: "Docs Site Localization"
sidebar:
  order: 20
---

How to publish a locale's documentation pages and translated README, and the link rules both follow.
The runtime strings come first; see [Adding a Locale](/contributing/localization/new-locale/).

## Locale table

`src/constants/docsLocales.ts` defines every docs locale once, and these read it:

| Consumer | Uses |
|---|---|
| `apps/docs/astro.config.mts` | Starlight locales, sitemap, sidebar label fallbacks, locale-root redirects, `llms.txt` exclusions |
| `apps/docs/src/routeData.ts` | `hreflang`, `noindex` on fallback routes, description budget |
| `apps/docs/src/components/MarkdownContent.astro` | Which review notice a page shows, and its wording |
| `apps/landing/src/pages/index.astro`, `apps/landing/src/landingCopy.ts` | Product landing pages and their language links |
| `src/utils/discord/docsLinks.ts`, `src/utils/misc/docsUrl.ts` | The locale prefix on bot docs links |

Both the bot and the Astro build import the module, so it may import nothing except
`src/constants/locales.ts`.

## Publish a locale

Each target locale already has a row with `docsTree: false`. While it is `false` the locale root
returns 404, Starlight registers no sidebar, sitemap, or `hreflang` for it, and the bot links to
English. To publish:

1. Translate pages into `docs/{locale}/` at the same relative paths as English.
2. Add the locale's `LOCALE_NOTICES` entry in `docsLocales.ts`, including `englishLinkText`, so the
   notice names English in the reader's language.
3. Add the page copy and metadata in `apps/landing/src/landingCopy.ts`.
4. Add the locale's `COMMAND_REFERENCE_COPY` entry in `scripts/lib/commandReference.ts` and run
   `bun run generate-command-reference`. The generator refuses a published locale without one.
5. Set `docsTree: true` in the same change as the page tree.
   `tests/unit/docs/docsLocaleConfig.test.ts` fails if the flag and the folder disagree.
6. Repoint the absolute docs URLs in `src/locales/{code}/**` from `/en/` to `/{code}/`.

`apps/docs/public/_redirects` already has the locale root pair (a 301 from `/xx` and a 200 rewrite of
`/xx/` to its introduction). It is a static file, so every target locale was added ahead of time; the
Astro redirect map is generated and needs no edit.

## Page scope

| Section | Translated |
|---|---|
| `introduction/`, `meet-tomori/`, `features/`, `self-hosting/` | Yes |
| `legal/` | Yes, with a notice at the top that the translation is for convenience and the English version controls |
| `architecture/`, `contributing/`, `wiki/` | Never. The audience reads English source, and translating these would nearly triple the pages per locale |

Translate legal text conservatively: never expand, soften, or add a commitment. When no safe
equivalent exists, stay close to the English and flag the sentence for review.

A page with no translation is served at its locale URL with English content. That fallback route is
`noindex`, has no `hreflang`, is left out of the sitemap, and shows the locale's draft disclaimer, so a
partial tree is safe to publish. Translating the page reverses all four.

## Review state
<!-- anchor: review-state -->

| Page | Notice |
|---|---|
| English source and translation both have `aiGenerated: false` | None |
| English source and translation both have `aiGenerated: true` or omit the field | The locale's draft disclaimer |

`aiGenerated` records human review of substantive content: the page's claims, instructions, and
meaning. Always mirror the English source's field in every translation. Copy an explicit `false` or
`true`; remove the field from the translation when English omits it. Apply source review-status
changes to its translations in the same change.

AI translation alone does not change this status. A translation of reviewed English content keeps
`aiGenerated: false`, even when no person has reviewed the translated wording. Translation accuracy
and natural phrasing still need review; this field does not certify either. If a translation adds or
changes a claim, correct it to match English rather than assigning it a separate content-review status.

For files whose flags differ from this standard, the renderer retains a translation notice linking
to reviewed English content, shown only when `DOCS_SHOW_TRANSLATION_NOTICE=true`. Synchronize their
frontmatter with English when editing them.

## Links

Starlight does not add the current locale to a root-relative `href`, so an unprefixed route in a
translated page sends the reader to English. GitHub renders READMEs and knows nothing of the docs
router, so a root-relative link there points at `github.com`.

| Where | Link to a page that exists in that locale | Link to a page that does not |
|---|---|---|
| `docs/en/**` | `/features/knowledge/memory/` | n/a |
| `docs/{locale}/**` | `/ja/features/knowledge/memory/` | `/en/self-hosting/...` |
| `.github/README_{code}.md` | Full `docs.tomoribot.app` URL with the locale prefix | Full URL with `/en/` |
| `src/locales/{code}/**` strings | Absolute URL with the locale prefix | Absolute English URL |

Component `href` values such as `LinkCard` follow the same rule, so each locale file writes its own.

- **UI labels**: code spans holding the text that locale's bot shows: copy the value of the same key
from `src/locales/<code>/`. A translated page that writes `` `Finish Setup` ``, or its own translation
of it, sends the reader looking for a button their Discord client does not show.

- **Fragments**: always the English slug. A heading that anything links to carries an anchor comment
in every locale:

```md
### 关键词标签
<!-- anchor: keyword-tags -->
```

`apps/docs/src/remarkHeadingIds.ts` turns the comment into the heading id. The bot stores one
locale-less route per destination in `DOCS_ROUTES` and prefixes the locale at runtime, so a translated
anchor would drop every non-English reader at the top of the page.

`bun run check-locales` resolves absolute `docs.tomoribot.app` URLs and `DOCS_ROUTES` fragments,
trying the linking file's own locale first and then English. It does not read root-relative Markdown
links under `docs/`, so the translator and reviewer check those.

- **Bot links**: `buildDocsUrl()` and `buildLegalDocUrl()` prefix the locale only when its tree is
published. `DOCS_PATHS` in `src/utils/discord/docsLinks.ts` holds locale-less routes; never add a
prefix there. `tests/unit/docs/docsRouteRegistry.test.ts` rejects a prefixed route and resolves every
absolute URL in locale strings against `docs/`.

## Translated READMEs

- The file is `.github/README_{code}.md`, with a switcher row pointing back at `../README.md`. Copy the
  whole switcher from the root README; `English` stays `English` in every switcher.
- The root `README.md` lists planned locales in a comment under the switcher. Move the locale into
  the switcher row only when its README exists, because a link to a missing file is broken on the
  repository's front page.
- Translate link labels and image alt text. Keep paths, images, code, commands, environment variable
  names, and product, provider, and model names unchanged. Add no claim the English README lacks.
- Third-party URLs (Discord invites, the repository, badges, donation and provider links) stay byte for
  byte, query strings included. Never guess a localized vendor URL; report an unverified candidate
  instead of using it. The link checker ignores external domains.

Two surfaces live outside the repository and need a manual update at release: the Discord App
Directory listing and the bot's profile description.

## Stale translated pages

`bun run find-stale-translations` reports pages and READMEs as well as keys:

| Reason | Meaning |
|---|---|
| `unfollowed` | This branch changed the English page (with `--base`) but not the translation |
| `drifted` | The English page changed after the translation's last commit |
| `missing` | No translation exists |
| `orphaned` | A translation with no English source, or inside an English-only section |

```bash
bun run find-stale-translations --reason=unfollowed --base=origin/main
bun run find-stale-translations --scope=docs --locale=ja
```

Only title, description, sidebar label, and body count, so reordering the sidebar or changing
`aiGenerated` creates no work. `features/command-reference.md` is excluded because it is generated for
every locale (`bun run check-command-reference` checks it). A commit that touches both trees, such as a
link sweep, resets the baseline even if the prose was not retranslated.

## Site roots

`tomoribot.app` serves an indexable English landing page at `/` and one per published locale at
`/{locale}/`, each with its own canonical URL and `hreflang` set. Visitors choose a language; there is
no `Accept-Language` redirect. `docs.tomoribot.app/` redirects to `/en/introduction/`, and that redirect
must match in `apps/docs/astro.config.mts` and `apps/docs/public/_redirects`.

The two hosts are separate Cloudflare Pages projects: `apps/landing/dist` and the docs build. Never
attach the apex hostname to the docs project, because the same pages on two hosts are duplicate URLs.

`llms.txt` and its siblings are English only: `starlight-llms-txt` reads the default locale.
`apps/docs/scripts/checkLlmsOutput.ts` runs in the docs build and fails on a non-English URL in those
files, on a fallback route that emits `hreflang`, on a translated pair missing its full set and
`x-default`, and on a missing docs root redirect.

## Verify

```bash
cd apps/docs && bun run build   # also runs checkLlmsOutput.ts
bun test tests/unit/docs/
bun run check-locales
bun run check
bun run lint
```
