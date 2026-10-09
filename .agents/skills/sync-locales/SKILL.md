---
name: sync-locales
description: Translate the English changes on the current branch into every authored TomoriBot locale, covering locale keys under src/locales/, translated docs pages under docs/, and the translated READMEs. Use when a diff edits src/locales/en-US/, reader-facing pages under docs/en/, or README.md, and the user asks to update, sync, or translate the other locales.
---

# Sync locales

Contributors only have to write English. Other locales fall back to English for any key or docs page
they do not define, so this skill is a follow-up that brings the translated surfaces level with a
branch's English changes. Run it only when asked.

## Find the work

One command reports both locale keys and docs pages the branch changed without following:

```bash
bun run check-locales --verbose
bun run find-stale-translations --reason=unfollowed --base=origin/main
```

- New English keys show up as parity gaps in `check-locales`; edited keys show up as unfollowed.
  `check-locales` exits 2 when only parity is missing; that is advisory.
- Docs pages appear under "Docs pages this branch changed without updating the translation", one
  line per page with the locales still behind. `[English added]` means no translation exists yet;
  `[English removed]` means the translation should be deleted with it.
- A shallow clone makes the command exit 2; run `git fetch --unshallow` and retry.

Limit the work to what the branch touched. Pre-existing gaps belong to their own change;
`bun run find-stale-translations --scope=docs` lists the whole-tree backlog when asked for it.

## Translate locale keys

The authored trees are the directories under `src/locales/` other than `en-US`. Each mirrors the
English file layout, so a key lives at the same path in every tree.

## Translate docs pages

- A page at `docs/en/<path>` translates to `docs/<locale>/<path>` for every locale with a published
  docs tree (`docsTree: true` in `src/constants/docsLocales.ts`). `README.md` translates to
  `.github/README_<locale>.md`.
- `architecture/`, `contributing/`, and `wiki/` stay English. Never translate or create them; the
  command already leaves them out.
- `features/command-reference.md` is generated in every locale from the command description keys.
  Never edit it by hand: after translating command descriptions, run
  `bun run generate-command-reference`.
- Translate the whole changed passage in its context, and keep the
  translated page's existing structure and wording elsewhere.
- Frontmatter: translate `title` and `description`. Always mirror the English source's `aiGenerated`
  field, including its absence: copy `false` or `true` exactly, or remove the field when English
  omits it. This field records human review of the substantive content. AI translation alone does
  not change that status or certify translation quality. Keep every other field as the translated
  file already has it.
- Links: a route to a page that exists in the locale's tree takes the locale prefix
  (`/ja/features/knowledge/memory/`); a route to an English-only or untranslated page takes `/en/`.
  An unprefixed route in a translated page ejects the reader into English.
- Keep every `<!-- anchor: english-slug -->` (in MDX, `{/* anchor: english-slug */}`) comment under
  its heading exactly as it is: it is the English anchor that links in every locale target.
- UI labels are the exception to "code spans stay verbatim". A code span that names something the
  bot shows (`Finish Setup`, `Add MCP`) holds that locale's UI text, copied from the value of the same
  key in `src/locales/<locale>/`, never your own translation and never the English with a gloss.
  Search the English file for the label to find its key. Discord's own labels (`Manage Server`) use
  the Discord client's wording in that language.

## Shared rules

For each target locale, read `references/glossary-<code>.md` first and follow it over your own
preferences. It fixes register, forms of address, product terms, and renderings that were already
rejected. When a term is missing from the glossary, reuse the rendering the locale's existing strings
or pages already use for it.

Keep these byte-for-byte: placeholders (`{user_nickname}`), slash commands, option names, code,
URLs, environment variable names, product names, and Discord markers (`-# `, `> `, fenced blocks).

Locale prose follows the repository dash rule. In `ja`, use `：`, `。`, and `（）` instead of dashes;
the Chinese glossaries state their own punctuation.

Persona-voiced strings keep the persona's character. Preserve that voice in the translation.

## Verify

```bash
bun run check-locales
bun run find-stale-translations --reason=unfollowed --base=origin/main
```

The follow-up command reads committed `HEAD`, so uncommitted translations still appear in it. Do not
commit to clear them; the user commits. Fatal `check-locales` findings (Discord length caps, modal
limits) must be fixed by shortening the translation, never by editing English to make room. Report
any key or page you could not translate confidently instead of guessing.
