---
title: "Command Archetypes"
sidebar:
  order: 40
aiGenerated: true
---

Which kind of interaction a command should be, before anything is built. Every TomoriBot command follows
one of eight archetypes, and each has a reference command to copy. Wiring is in
[Adding a Panel](/contributing/extending/panel/); text and layout are in
[Panel Prose and Layout](/contributing/policies/panel-prose-and-layout/).

## Choose an archetype

| Archetype | Use when | Reference |
|---|---|---|
| Categorized Control Panel | A root owns several related settings areas that users revisit and compare | `/moderation`; also `/config`, `/personal config`, `/memories`, `/personal memories` |
| Collection Panel | The pages are saved entities the user created, plus a way to add one | `/providers`, `/personal providers`; inside `/config`, the MCP servers and SillyTavern presets pages |
| Entity Pages | The user needs two axes at once: which entity, and which aspect of it | `/config` Persona category (persona selector plus ten pages) |
| Paginated Reference | Read-only information users browse repeatedly, rebuilt from definitions or stored data | `/help`, `/status`, `/stats` |
| Guided Wizard | Ordered choices, later steps depend on earlier ones, nothing is saved until the end | `/setup` |
| Direct Command Family | The user knows the operation, and slash options can name the target safely | `/impersonate`; also `/persona`, `/generate`, `/export`, `/import`, `/tool` |
| Immediate Action | Running the command is the whole intent, with no state worth showing | `/respond`, `/kill`, `/compact`, `/ping`, `/punish`, `/reward` |
| Destructive Action | The operation deletes broad state, removes something irreversibly, or replaces configuration in bulk | `/reset config`; in panels, the `remove-prompt` / `remove-confirm` / `remove-cancel` routes |

The three panel archetypes share one system (catalog, builder, routes). They differ only in how the
active page is chosen: by category, by saved entity, or by entity plus page.

### When not to make a panel

- Two or three self-explanatory operations, such as `/matrix link` and `/matrix unlink`.
- Generation with clear parameters that runs once.
- A one-off diagnostic or link.
- Lifecycle commands whose purpose is creating, importing, or removing an entity (`/persona create`).
- A destructive action whose safety comes from confirmation. Browsing adds nothing to it.

Do not add a panel only to remove one slash path.

## Panel rules

These apply to all three panel archetypes.

- **Navigation never writes.** Category buttons, page selects, and entity selects only change what is
  shown. A select's default marks the current page. Writes happen through an explicit button, a modal
  submission, or one of the [selects that write](#selects-that-write), and end with a receipt and
  refreshed state.
- **Categories:** at most five top-row buttons, the active one `Primary`. More areas than that belong
  in a page select within a category.
- **Rebuild state on every click.** Reload from the database and resolve stable IDs within the current
  scope. Trust nothing from the old message: names, list positions, select defaults. When a selected
  entity has been removed, fall back to a fixed choice (the main persona, the neighbouring entry, or
  the add page) and say so.
- **Reads can fail.** Distinguish an empty collection from a failed read. A stale read may still show
  saved values with a warning, a `Retry` button, and writes disabled; a failed read with nothing to
  show is a retryable failure and must never render as empty.
- **Receipts:** after a write, repaint the saved state with a receipt. A no-op submit gets an `info`
  receipt. A failed write keeps the previous state on screen and never shows the attempted change.

### Collection Panels

- The entity select lists saved entities with stable database IDs as option values and localized
  names as labels. The add action is its first option.
- Selecting an entity opens its page. Activating, enabling, or removing it takes a separate button.
- Past 25 entities, page the select (`resolveRangeSelection()` and `buildRangeSelectOptions()`); never
  truncate or merge labels.
- A panel that serves two ownership scopes with one builder names the scope in its title, as
  `/providers` (`Server Providers`) and `/personal providers` (`Personal Providers`) do.

### Entity Pages

- Switching page keeps the entity; switching entity keeps the page.
- The main persona is the first selection and is labelled as the main persona.

### Selects that write

A select may save on pick, without a button or modal, when the pick is the whole change: no free text,
no other field submitted with it, and another pick undoes it. Opening a modal that holds only that
select would cost a click and hide the saved value. The select is disabled on a stale read,
re-authorizes before writing, and repaints with a receipt. Two shapes qualify:

- **Single choice:** one active value that another pick replaces. The SillyTavern presets select
  activates the chosen preset and `None` disables presets; deleting a preset keeps the normal button
  and confirmation.
- **Whole list:** the select's defaults show the saved list and each pick saves the new list, as the
  Natural Nudges channels select does. The list must fit one select (25 values). The save is
  last-write-wins, so two admins editing at once keep the later pick.

Keep the modal when the select is submitted with other fields. A list that can outgrow 25 entries keeps
its add and remove buttons. Budget the row: an action row holding one select counts as 2 of a message's
40 components.

Other departures need a verified Discord limit, a different archetype, or a recorded product decision,
added here.

## Destructive actions

Confirmation scales with the damage: removing one recoverable entry needs less than resetting a server.

1. Resolve the exact target and authorize the actor.
2. Show localized impact text naming the target and what is lost.
3. Require an explicit confirm button. Resets of a whole workspace also need a high-friction check.
4. Re-resolve the target and re-authorize after confirmation.
5. Run the repository operation once; repeated or stale clicks must not run it again.
6. Invalidate caches only after success.
7. Show a receipt naming what was removed and whether an export can restore it.

Selecting a page, selecting an entity, or a pre-checked checkbox is never consent to destroy. After a
removal, drop the removed ID from the panel state, reload the collection, and select a fixed neighbour
or the add page.

`/nuke` still confirms through a required yes/no slash option; moving it to a button confirmation is
open work.

## Guided wizards

- Keep a typed draft that holds only this invocation's choices. `/setup` keeps drafts in memory
  (`setupDraftStore.ts`), where a restart discards them; use a durable draft only when resuming across
  restarts is a product requirement.
- Route every control through the global registry, with no collectors. The only expiry is the draft's
  own lifetime, checked on each click.
- Cancel never saves anything, and a repeated submission cannot create or charge twice.
- Switching between mutually exclusive modes replaces the draft and discards the old mode's
  credential.
- Secrets never appear in review text, logs, custom IDs, or errors.
- The final receipt repaints the wizard's own message and has no controls.

## Direct commands and immediate actions

- Use native slash options for users, channels, roles, attachments, booleans, numbers, and short
  choice lists. Use autocomplete for database entities, returning stable IDs, and validate the
  submitted value again: a suggestion does not authorize anything.
- Open a modal only for input too long or too structured for slash options.
- Check context and permissions quickly, then defer before any database, provider, or history work.
- Add confirmation only where the consequence calls for it.
- When a command is renamed, keep the established verb (`/kill` over `stop`) and mention the old
  wording in the description and `/help`.

## Visibility and authorization

| Mode | Level | Mechanism | Use |
|---|---|---|---|
| 1. Hide from discovery | Command | `guildOnly` or `managerOnly` exported by the command module, applied by `applyRootCommandRestrictions()` in `src/utils/discord/commandLoader.ts` | The whole root is ineligible for the same actors |
| 2. Deny on execution | Command | A check in `execute()` with a localized denial | Mixed roots, and always underneath mode 1 |
| 3. Deny on interaction | Panel | Re-resolve and re-authorize in the route handler | Every button, select, and modal submission |
| 4. Filter or disable | Panel | Leave the control out, or render it disabled | See below |

Modes 2 and 3 are always on. `setContexts(Guild)` is a platform guarantee, so a guild-only command may
assume a guild. `setDefaultMemberPermissions(ManageGuild)` is only a default that server admins can
override per role and channel, so a handler never treats being called as permission.

- **Disabled or omitted**: disable a control for a temporary state or an unmet prerequisite (Add at the
limit, writes during a stale read), or to show a member which manager-only actions exist. Omit it when
it cannot apply in this context, when its existence or state is sensitive, or when the component
cannot be disabled (a single select option). `/config` is registered without a Manage Server default
so members can reach the Persona category, and manager-only actions appear there disabled.

## Done means

- Every operation the panel absorbed has a place in it, and every current value and override can be
  found.
- Writes use the existing validation and repository path and invalidate the same caches.
- Destructive actions follow the section above, and disabled-versus-omitted is applied the same way
  throughout.
- Stale selections and changed permissions are safe.
- Behaviour past 25 entities is tested.
- Every locale covers navigation, actions, receipts, and denials.
