---
title: "Adding a Locale"
sidebar:
  order: 20
---

How to add a display language: runtime strings, seed descriptions, and the gates to run. Publishing
translated docs pages and a README is covered in [Docs Site Localization](/contributing/localization/docs-site/).
Keep `src/locales/en-US/` open while you work; its key structure is canonical, and a translated tree
that invents keys is a bug.

## Tiers

Only the runtime strings are required. Everything optional falls back to English.

| Surface | Tier | Falls back to |
|---|---|---|
| `src/locales/{code}/**` | Required | English, per key |
| Protocol keys in that tree | Required, frozen after first release | Nothing: old embeds stop matching |
| `general.language_name`, `general.defaults.bot_name`, `general.defaults.base_trigger_words` | Required | The locale code, the env default, the English trigger list |
| `tools.intent_packs` | Recommended | The union of the other locales' packs |
| Seed `i18n` descriptions | Optional | English description |
| Persona voice variants | Optional per locale | English presets |
| `docs/{locale}/**`, `.github/README_{code}.md` | Optional | English, with `noindex` |

A change to `en-US` may leave translations behind. Catching up is welcome but never blocks a merge;
`bun run find-stale-translations --reason=unfollowed --base=origin/main` lists the follow-up.

## Work split

Each locale owns `src/locales/{code}/**`, `docs/{locale}/**`, and `.github/README_{code}.md`, so
parallel locale lanes never edit the same file. The shared files are pre-staged:

| Shared file | Already staged | Left for the locale lane |
|---|---|---|
| `src/constants/docsLocales.ts` | The locale row, endonym, description budget | `LOCALE_NOTICES` entry, then `docsTree: true` when the docs tree lands |
| `apps/docs/public/_redirects` | The locale root pair | Nothing |
| `apps/landing/src/pages/index.astro` | Language links derived from the locale table | Nothing |
| `README.md` switcher | The endonym in a comment under the switcher | Move it into the switcher row once the README exists |
| `src/db/seed/catalog/**` | One `i18n` map per entry | Nothing: one dedicated worker adds every locale's descriptions |

## 1. Choose the folder name

The folder name under `src/locales/` is sent to Discord unchanged as a localization key, so it must
be a code in `DISCORD_LOCALES` (`src/constants/locales.ts`). Check
[Discord's locale list](https://docs.discord.com/developers/reference#locales) before assuming a
missing code is invalid.

A wrong name such as `pt` or `zh-Hant` makes Discord reject the whole registration request, so every
slash command in every language fails. `bun run check`, `check-locales`, and the docs build all pass
with a bad folder name. Only booting the bot catches it. `initializeLocalizer()` logs an error and
skips an unknown folder, which keeps a local experiment from breaking startup.

`general.language_name` is the language's own name (`Deutsch`, not `German`); the language picker
shows it. Command metadata localizations need no registration step: `commandLoader` emits the keys the
tree authors.

- **Aliases**: `LOCALE_ALIASES` in `src/constants/locales.ts` maps a Discord code to another locale's
tree. `es-ES` reads `es-419`, which is written in neutral Latin American Spanish so the product has one
Spanish voice. `localizer()` resolves aliases before lookup (so `es-MX` also reaches `es-419`), and
`commandLoader` emits the alias key next to its source. `getSupportedLocales()` returns authored folders
only; `getRegisterableLocales()` adds the aliases. Never create a folder for an alias. The docs site
inverts the same map into `DOCS_LOCALE_ALIASES`.

- **Picker order**: pickers follow `LOCALE_DISPLAY_ORDER`, derived from the row order of `DOCS_LOCALES`
in `src/constants/docsLocales.ts`. Insert the new row where it should appear; that one move reorders
the docs switcher, the README switcher, and the bot's picker. The picker in `/personal config` >
Profile > General (also `/personal language`) is a String Select capped at 25 options
(`MAX_SELECT_OPTIONS`), so a 26th locale needs a paginated picker first.

Do not add a `DEFAULT_BOTNAME_{CODE}` variable. `general.defaults.bot_name` and
`general.defaults.base_trigger_words` in the locale tree are the localized defaults; the environment
variable is only the fallback for a locale that sets neither.

All target locales are left to right. A right-to-left locale would need changes to the panels and
the Markdown renderer, which is engineering work rather than translation.

## 2. Write the runtime strings

The tree mirrors `src/locales/en-US/`: `general.ts`, `tools.ts`, `providers.ts`, `bridges.ts`,
`commands.ts`, and `commands/`.

- `commands.ts` imports every `./commands/<file>` module. A copied assembler that still imports
  `../en-US/commands/<file>` renders English while every parity check passes. Confirm it has no
  `../en-US/commands/` import before accepting the locale.
- Keys are static dot paths (`commands.{category}.{subcommand}.{key}`). The checker cannot see a key
  built with a template literal.
- `commandLoader` localizes option descriptions from `{option_name}_description` and choice labels from
  `{choice_value}_option`. Using `{option_name}_option` for a description silently shows English.
- `localizer()` falls back through the locale, its alias, its base language, `en-US`, and finally the
  raw key. A partial locale therefore shows English for its gaps. A key missing from every locale fails
  `bun run check-locales`.

- **What the model reads stays English**: tool schema `description:` fields in
`src/tools/functionCalls/*.ts` are English literals, because a localized schema lowers tool-calling
accuracy and no check would notice. A tool result's `error` is English for the model and its `message`
is localized for the user. System prompt bodies stay English, as do dates and durations interpolated
into model context. `src/locales/{code}/tools.ts` is different: everything in it renders to users, so
translate it.

String conventions:

- Follow the prose rules: no em dashes or spaced double hyphens; in Japanese use `：`, `。`, `（）`.
- Never put a real person's name, handle, or account in a string.
- Keep `{placeholder}` tokens exactly as English has them. A missing token fails `check-locales`; an
  extra one is a warning.
- Discord caps, counted in code points: 45 for modal titles and input labels, 100 for command, option,
  and choice text and placeholders.
- Do not open a status title with a colored circle. The renderer derives it from the surface's color
  (see [Status circles](/architecture/subsystems/localization/#status-circles)), and a circle in the
  string is stripped before the derived one is applied.
- Panel prose follows [Panel Prose and Layout](/contributing/policies/panel-prose-and-layout/).

Text processing (case folding, splitting, emphasis markers) keys on the character script rather than
the locale, because a persona may reply in another language. There is nothing to configure per locale.
A script that needs a rule the processors lack is a code change in `src/utils/text/processors/`.

## 3. Review protocol keys before the first release

Some bot embeds are classified by their rendered title. The reader does not know which locale wrote a
message, so it compares the title against every locale's rendering. `PROTOCOL_KEYS` in
`src/utils/discord/embedProtocol.ts` lists those keys.

- **Protocol key stability**: a protocol key's translation is frozen after that locale's first release. Changing it orphans
every embed already posted with the old title, including the reset and compact-refresh markers that
history slicing uses. `sliceMessagesAtResetMarker` then finds no marker and returns no error, so
`/reset` and `/refresh` stop applying with no log and no failing test.

| Rule | Reason |
|---|---|
| Review every protocol key before first release | It cannot be corrected afterwards |
| Add a new classification key to `PROTOCOL_KEYS` before shipping it | The reader cannot see an unregistered key |
| Keep placeholders and the literal text around them | Templates match with placeholders blanked, so they need a literal anchor |
| Avoid short titles another key could also render | Two keys with one rendering in a locale fail startup |
| Never end a reward or punish title with a period | A trailing period once dropped titles from classification |

Classification normalizes the status circle on both sides: the lookup stores each authored value with
its circle removed, and an incoming title loses its rendered circle before matching. A title gains
exactly one circle no matter which value classified it, so a locale that authored a circle before
this rule existed keeps classifying.

`check-locales` checks presence, placeholder parity, anchors, and collisions; startup checks
collisions again.

## 4. Author intent packs

`tools.intent_packs` in the locale's `tools.ts` holds the keywords that detect requests in user
messages: the `deliberate.*` tool targets and `explicit_memory`. Matching uses the union of every
locale's pack, so a new pack improves detection for all users.

- Write what native speakers type. Use the English entries to learn what each pack should catch, then
  write your own phrasing; translated English wording misses how people actually ask.
- Entries are literals; a trailing `*` matches a stem (`messag*`). Anything else regex-like throws at
  startup.
- Favor recall. A false positive only offers a tool the model already has, and only while the mode is
  off.
- Cover casual and formal forms, spellings with and without diacritics, and demonstratives. The first
  Portuguese pack had formal imperatives only and missed most casual requests.
- Do not use a stem that starts common words in another supported language: `cita*` also matches
  English "citation".
- Han, kana, and Hangul entries match as substrings, so use at least two characters. Spaced scripts
  match on Unicode word boundaries.
- English deliberate packs stay empty: `deliberateToolMode.ts` already has the English patterns.

To test a pack, write the requests before reading the pack (at least three casual requests per
deliberate target and for `explicit_memory`), then run
`bun run check-intent-packs --locale=<code> --requests=<file.json>`. Requests written after reading the
pack reuse its wording and prove nothing.

## 5. Add seed descriptions and persona variants

Seeded rows keep descriptions in a `descriptions` JSONB column keyed by locale, so a new locale needs
no migration. In the catalogs the field is `i18n`:

```ts
{
  name: "Some Model",
  desc: "English description.",
  i18n: { ja: "日本語の説明。", "pt-BR": "Descrição em português." },
}
```

English comes only from `desc`, and the keys are typed `LocaleCode`, so a typo such as `pt-br` fails
`bun run check`. `resolveDescription()` falls back through exact locale, base language, any key with a
matching base (`pt` finds `pt-BR`), then `en-US`. Describe what users pick from (`/model`,
`/providers`, NovelAI presets, system prompt presets) and let the rest fall back.

The descriptions live in three shared files: `models.ts`, `naiPresets.ts`, and `systemPrompts.ts` under
`src/db/seed/catalog/`. Locale lanes hand their text to the one worker who owns those files, because
parallel edits to one typed array conflict on every batch. System prompt bodies (`promptText`) are not
translated.

Persona variants live in `src/db/seed/catalog/personas/{preset}/{code}.ts`, each exporting one
`persona: PersonaInput`, registered by hand in `personas/index.ts`. An unregistered file does not seed.
Write each variant the way a native speaker would write an original character: same identity, same
relationship to the user, same register, different words. A translated persona reads like a foreigner
playing the part.

| Field | Per locale | Note |
|---|---|---|
| `name`, `desc`, `attributes` | Yes | The name may be transliterated |
| `sampleDialoguesIn` / `sampleDialoguesOut` | Yes | Paired arrays, validated |
| `triggerWords` | Yes | Native forms of address |
| `sprites[].usageInstructions` | Yes | |
| `preset_lineage_id` | No | Must be identical in every variant; it makes them one character |
| `avatarPath`, `sprites` | No | Shared art |

Presets resolve by exact locale, base language, then `en-US`, so a locale without variants shows the
English roster. Skip `prideful`: it is unregistered. See
[Adding a Persona Preset](/contributing/extending/persona-preset/) for pointer and sprite behavior.

## 6. Publish docs and README (optional)

Follow [Docs Site Localization](/contributing/localization/docs-site/): page scope, link prefixes,
`aiGenerated`, the `docsTree` flag, and the README rules. When the docs tree is published, repoint the
absolute docs URLs inside `src/locales/{code}/**` from `/en/` to `/{code}/`.

## 7. Verify

Run the localization gates first; they are fast and their findings would be buried in a full test run.

```bash
bun run check-locales                              # keys, placeholders, protocol keys, docs links
bun run check-locale-lengths                       # Discord 45/100 code-point caps
bun run find-stale-translations --locale=<code>    # review queue
bun run check-intent-packs --locale=<code> --requests=<file.json>
bun run check-seed-catalogs                        # i18n shape, persona and catalog invariants
bun run check-media-size                           # new avatar or sprite art
bun run check
bun run lint:ci
bun run test
cd apps/docs && bun run build                      # if docs changed: hreflang and llms.txt checks
```

| Gate | Fails on | Exit |
|---|---|---|
| `check-locales` | A key missing everywhere, a missing placeholder, protocol key problems, a docs route or fragment that resolves nowhere | 1; a parity gap in one locale is advisory exit 2 |
| `check-locale-lengths` | Text over the Discord caps | 1 |
| `find-stale-translations` | Values identical to English, English text in a non-Latin script, `drifted`, `unfollowed` | 0 with a report; 2 when history it needs is missing |
| `check-intent-packs` | An empty pack, fewer than three requests per target, a request that misses its tools | 1 |
| `check-seed-catalogs` | `i18n` shape, persona uniqueness, unpaired dialogues, sprite validity | 1 |

`check-locales` has no locale filter; the other review tools take `--locale=<code>`.

- **`find-stale-translations` reasons**: `drifted` means the English changed after the translation's
line was last committed, taken from `git blame` on `HEAD`, so uncommitted edits are ignored. The count
is a lower bound, and a listed key may still be correct after a wording-only English change, so review
each entry rather than retranslating the list. `unfollowed` compares the branch with its merge base.
Both need full history: a shallow clone would compare against the grafted root and report nothing, so
the tool exits 2 with the fetch command instead. `--export` writes the list to
`scripts/maintenance/stale-translations.json`.

Failures that only `bun run test` reports:

- `tests/unit/discord/panelProseRuntime.test.ts` checks that localized panel text went through the
  runtime formatter. Write natural prose and keep newlines for paragraphs and lists.
- `tests/unit/discord/personalConfigRoutes.test.ts` lists every endonym, and
  `tests/unit/db/personaNamingCatalog.test.ts` lists each persona's `namingConfig` per language. Add the
  new locale's values; do not loosen the assertions.
- `tests/unit/docs/docsLocaleConfig.test.ts` fails when `docsTree` flags and `docs/` folders disagree.

Boot the bot and confirm command registration; nothing else proves Discord accepted the folder
name, and startup is also where protocol key collisions surface.

The root `bun run check` does not type-check `apps/docs`; its build is the only check for those files.

## Done

- `src/locales/{code}/` exists with a valid Discord code and `general.language_name` in the language
  itself.
- Every `en-US` key has a translation or is deliberately left to fall back.
- Protocol keys are reviewed, and will not change after release.
- Intent packs are written as native phrasing and pass `check-intent-packs`.
- Every gate above passes, and the bot boots and registers commands.
- The docs tree and README either exist or are deferred with `docsTree: false` and the locale left
  out of the README switcher row.

A finished lane reports the gates it ran with exit codes and verbatim findings, any key whose meaning
differs from English, the protocol values reviewed, fragments changed by translated headings, and any
unverified third-party localized URL.

## Related docs

- [Localization System](/architecture/subsystems/localization/): `localizer()`, discovery, fallback
- [Docs Site Localization](/contributing/localization/docs-site/): translated pages and READMEs
- [Adding a Persona Preset](/contributing/extending/persona-preset/)
