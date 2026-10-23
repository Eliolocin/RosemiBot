---
title: "Panel Prose and Layout"
sidebar:
  order: 40
aiGenerated: true
---

Rules for text and components inside a Components V2 panel (`src/utils/discord/ui/*Panel.ts`).
Discord renders panels differently from embeds, so habits that are harmless in an embed are defects
here.

## Wrapping and limits

Write natural prose. Use newlines only for structure: paragraphs, lists, quote rows, and the edges of
stored content. Never add line breaks to shape the panel.

Every panel passes its components through `buildPanelContainer()` in `src/utils/discord/ui/panel.ts`,
which wraps every `TextDisplay` before Discord's limits are checked. It keeps links, code, emphasis,
emoji, Discord timestamps, and grapheme clusters whole, never truncates, and leaves fenced blocks byte
for byte. It picks the width per line from the component tree: a line beside a `Thumbnail` gets the narrow profile, and a
line with kana gets the Japanese profile. Lines are judged one at a time, so a stored Japanese name
never narrows the English prose sharing its `TextDisplay`. The widths live in `panelProse.ts`, because
Discord exposes no viewport width.

Wrapping is visual; length limits are separate and use two different tools:

- **Component text slots** (button labels, select option labels, values, descriptions, placeholders,
  modal titles and labels) use `safeSelectOptionText` or `truncateDiscordText`, which fit one slot to
  that slot's own limit.
- **Body text** uses `buildTextPreview` against the page's measured budget, and then
  `validateComponentsV2MessageLimits` checks the whole message. Discord allows 4,000 code points
  across all `TextDisplay` components, so a body that fits alone can still overflow the message.
  `safeSelectOptionText` cannot bound body text.
- **Stored prompts and notes** use `renderFencedPreview`, which fences them as markdown, caps them at
  `FENCED_PREVIEW_MAX_CHARS`, and ends cut text with an `<!-- N more characters hidden -->` marker.
  Discord colors the marker like a code comment. Pass the label of the button whose modal shows the
  complete text so the marker can name it.

## Markers

`-#` and `>` apply to one line. Put the marker once on the source line; the formatter repeats it on
each wrapped line:

```ts
content: `-# ${localizer(locale, "commands.providers.stale_warning")}`,
```

Use `withLinePrefix` only for content that already has several rows needing a marker each.

## Structure

- `##` for a page title that has sections; `###` for a page without sections or for a section.
- A select can replace a heading when its closed value names the same thing. `/help` puts the section
  select where the title would be, because a `##` above it would repeat the selected name.
- **Bold** for a nested subsection label; plain text for explanations and empty states.
- Every settings subsection opens with a plain sentence saying what it changes.
- Quote rows (`>`) for current values, statuses, and entities, directly under the text or control
  they qualify with no blank line between. Blank lines separate sibling subsections.
- `-#` for directions to other commands and footer-style notes.
- A real Components V2 separator between the category controls and the page body.
- A list explains what its entries mean before the rows.
- A state control shows its heading and explanation, then the choice buttons, then the selected
  choice's effect in a quote row.
- A persona-scoped page puts its persona selector before the heading, thumbnail, and details it
  controls: category, page, persona, content; or category, persona, page, content when Persona is a
  category with pages. Local avatars use `attachment://` media, so reattach them and clear old
  attachments on every repaint. Omit the thumbnail only when no avatar is available.
- The bot speaks in the first person (`I`, `me`).

## Current values

Show the stored or effective value in the panel. When a default (built-in, inherited, provider, or
server) changes what that value means, show the default and where it comes from. The user must not
need to open an editor to learn the effective behavior. Modals prefill the stored value where Discord
allows, and their field descriptions add only editing guidance such as the valid range and what
clearing restores.

Show a current model as `model (Provider)` through `formatModelSelectionLabel`, and an unset one as
`None`. Embeds may mark the model as code (`` `model` (Provider) ``), as `modelDisplay.ts` does.

## Stored content

Show user content such as a memory or prompt body in a fenced `markdown` block. A quote row reads as
panel chrome; a fence reads as the thing the user saved.

Do not escape Markdown inside the fence, because escapes render literally there. Make the content
fence-safe with `neutralizeFenceRuns` from `@/utils/text/discordTextLimits`, which puts a zero-width
space between every pair of backticks. Never replace the literal triple backtick: a run of four
backticks still ends in a closing fence after that replacement. Guard before truncating, since the
guard turns a run of `N` backticks into `2N - 1` code points. See `renderMemoryBlock` in
`personalMemoriesPanel.ts`.

## Product terms

Link a product term (Short-Term Memory, spotlight, lineage) to its docs the first time a panel uses
it. A panel has no room to define it, and a link in a heading costs no width:

```ts
stm_title: `[Short-Term Memory](https://docs.tomoribot.app/en/features/knowledge/memory/#short-term-memory-stm)`,
```

Keep the `/en/` segment, as every docs link in `src/locales/en-US/` does.

## Selects

- Say what the select does above it. If its first option adds something, say so too (`Select or add a
  personal memory below:`), because users do not look inside a dropdown for an add action.
- Option values must be unique. A duplicate makes Discord reject the payload with
  `COMPONENT_OPTION_VALUE_DUPLICATED`, and no static gate catches it.
- A select that assigns or browses items orders its options as `None`, then `+ Add ...`, then the items.
  `None` clears the assignment and appears only while something is assigned; `+ Add ...` appears only
  where the panel can create an item. Put clearing and adding actions inside the select's options.
- A select that lists models labels its clear entry `commands.config.panel.model_no_model_option`,
  because `None` beside provider rows does not say what is cleared.
- A persona picker that chooses from a shared library offers no `+ Add ...`; its notice points to the
  library page instead.
- Past 25 options, paginate in place with `buildPaginationRow`, never a `More ...` option. Reserve the
  action options before slicing items: `resolveRangeSelection(items, range, { reservedOptions })` sizes
  each page so the select stays within 25 options. Below the select: `← Previous`, a disabled
  `Page 2 of 7`, `Next →`, with each end disabled at its boundary and the row omitted when one page is
  enough. Use `←` (U+2190) and `→` (U+2192): `<` and `>` read as operators, and `◀`/`▶` can render as
  coloured emoji. `/help` keeps its own `← Previous` and `Next →` row with no page indicator, because
  it walks a reading order that includes stops its select does not list.
- Keep the selection and the page body while paging. Do not swap the body for a range chooser.

## Modals

- Prefer native User, Channel, and Role selects for Discord-owned lists. A String Select fits only an
  application list whose maximum stays within 25 options.
- Open an add modal straight from its select option when one modal captures the whole resource. Choosing
  an add option writes nothing until the modal is submitted, so it is not a navigation write.
- Show user entries as the server display name followed by the username in parentheses when they differ:
  `Mika (mika_draws)`.
- A modal holds five top-level components. Text inputs reopen with the stored value, and selects and
  checkbox groups reopen with their stored choices marked `default`. A multi-pick String Select is read
  with `takeRawModalStringSelectValues`, because `takeRawModalSelectValue` keeps only the first value.
- When a modal's selects are submitted together, every slot keeps its clear entry, even an empty one,
  because the modal cannot be repainted per slot.

- **Removal checklists**: for a list where unchecking removes an entry, every current entry starts checked
and submitting is the write, with no second confirmation. A checkbox group holds 10 options, so one modal
holds 50 entries. Title the first group with the list (`Blacklisted Members`) plus one sentence on what
unchecking does, and the rest `Continuation (1)`, `Continuation (2)`. Bind the presented entries to a
single-use nonce; on submit, re-authorize, reload, and remove only presented entries that are unchecked
and still current, so entries added meanwhile survive.

- **Longer lists**: past one modal's capacity (50 for checkbox groups, 25 for a String Select), replace the
page body with a range chooser inside the panel, keeping the category row and separator. Choosing a range
opens that range's modal, and every path returns to the previous page. `Previous` and `Next` appear only
when the chooser has several pages; `Cancel` always appears. Keep at most 10 ranges per chooser page,
because the chooser shares the panel's 40-component budget; a standalone ephemeral range selector has
no such budget and may show `RANGES_PER_SELECTOR_PAGE` (20, `interactionCore.ts`). Reuse the `general.pagination.*` keys for its
wording. A list the panel already pages, with every page fitting one modal, needs no chooser: its Remove
acts on the visible page (`/moderation`).

## Buttons

- Removing an item is a red `Remove ...` button, disabled while nothing is selected. Beside an
  `+ Add ...` button in the same row it reads `- Remove ...`, so the pair matches; where adding is a
  select option, the label has no dash.
- A button that closes an inline list says what closing does: `Cancel` when it abandons a pending
  action (a range chooser leading to a modal), `Close <List>` when it only hides a list that a
  `Choose ...` button opened.
- A value the current select cannot show (a saved provider voice while a different endpoint is active)
  keeps a `Clear ...` button, because no `None` option can reach it.
- `Retry` and the subdued stale-read warning go at the bottom of the page.

- A label names the object acted on (`Remove Document`), not the internal category it came from and
  never its own colour (`Danger: Remove`).
- Blue (`Primary`) marks only the active category. In a state-control row the selected choice is a
  disabled `Secondary` button, other choices are enabled `Secondary`, and unavailable ones are disabled
  `Secondary`.
- A state-control row holds mutually exclusive stored states: `[Off] [On]`,
  `[Off] [Follow Server] [On]`, `[Server-wide] [Persona]`. Pagination, navigation, confirmation, and
  action rows are not state controls.
- Do not repeat the state with `(On)`, a coloured circle, or a `State:` row; the selected button and
  the behavior sentence below it already say it. Coloured circles are fine in read-only summaries
  edited elsewhere.
- Grey (`Secondary`) for actions, red (`Danger`) for destructive ones. `Success` is not used.
- In a confirmation, the destructive action is `Danger` and Cancel stays `Secondary`.

These colour rules cover every Discord surface, including the confirmation and pagination helpers and
buttons built in `src/commands/`. `tests/unit/discord/panelButtonColour.test.ts` enforces them by
reading style assignments in source. It skips type annotations, so narrow a type that names a banned
colour rather than widening the test.

## Locale strings

Locale prose follows the [comment policy](/contributing/policies/comments/) dash rule. Use literal
locale keys: `check-locales` matches literal dot-notation strings, so a key built at runtime can
be missing, pass every gate, and show users the raw key. For a fixed set of values, use a
`Record<Union, string>` of full keys. If a registry already owns the values, store the full key on
each entry. Helpers that accept keys take full keys from their callers.

Open sets such as provider error codes may construct keys when they handle unknown values. Keep
their exemptions narrow in `DYNAMIC_KEY_PATTERNS` in `scripts/checks/checkLocalizationKeys.ts` and
test every supported value with `hasLocaleKey` across authored locales. Run `bun run list-unused-locales`
after removing an exemption, confirm each unused key has no callers, and remove it from every locale.
