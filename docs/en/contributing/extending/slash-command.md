---
title: "Adding a Slash Command"
sidebar:
  order: 10
aiGenerated: true
---

How to add a slash command. `commandLoader.ts` registers any `.ts` file under `src/commands/` on the
next startup.

## Steps

1. Create the file:
   - `src/commands/{command}.ts` for a root command,
   - `src/commands/{category}/{subcommand}.ts` for a subcommand,
   - `src/commands/{category}/{group}/{subcommand}.ts` for a subcommand in a group.
2. Export `configureCommand(command)` (root) or `configureSubcommand(subcommand)` (category) to
   declare the name, description, and options, and `execute(client, interaction, userData, locale)`
   to handle it.
3. Build descriptions and options with `localizer("en-US", ...)` so the loader registers every
   locale's text.
4. Add the keys to `src/locales/en-US/commands/{category}.ts`; other locales fall back to English.
   Option descriptions use `{option_name}_description` and choice labels `{choice_value}_option`.
   `{option_name}_option` for a description silently falls back to English.
5. Acknowledge within Discord's 3 seconds: `reply()` right away for fast commands, `deferReply()`
   before the first `await` for slow ones. Do not defer before opening a modal or a pagination
   helper, which acknowledge the interaction themselves. See
   [Command System](/architecture/subsystems/command-system/).

To register a command only in some environments, export a gate. The loader still imports the file, so
keep production-only side effects out of module scope:

```ts
export const isCommandEnabled = () =>
  process.env.RUN_ENV === "production" &&
  process.env.TOMORI_SUPPORTER_BILLING_ENABLED === "true";
```

Before building, pick the command's archetype (panel, wizard, direct family, immediate or destructive
action) in [Command Archetypes](/contributing/policies/command-archetypes/).

## Naming

Name commands with the words users see in Discord:

- Nouns for durable settings: `crosschannel-blocklist`, not `block-crossmsg-channels`.
- No abbreviations such as `msg` or `cfg` unless users already know them.
- A command that edits a stored set is named after the set (`crosschannel-blocklist`); do not split it
  into `add` and `remove` commands.

## Settings that are a set

For a set of channels, roles, or notice types that users review as a whole, use one command that owns
the full set. `/config` > Channels > Channel Rules is the reference.

- The modal opens with the saved items already checked, and submitting writes the whole checked set.
- Up to 50 items fit one checkbox modal. Beyond that, show a page picker first, and preload each
  page's modal with that page's saved state.
- Show the saved state in `/status` so users can see it without reopening the command.

## Verify

```bash
bun run check-locales
bun run check
bun run lint
```

Then run the command in Discord: it appears, its options work, and it renders in another locale.
