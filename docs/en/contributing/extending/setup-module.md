---
title: "Adding a Setup Module"
sidebar:
  order: 10
  label: "Adding a Setup Module"
aiGenerated: true
---

How to add a step to `bun run setup --full`. Modules live in `scripts/setup/registry.ts`.

Add a module only for a small, broadly useful prerequisite: enabling a local database extension,
downloading an asset core features use, installing a small helper package, or printing fallback
commands when automation cannot finish. Heavy local servers (TTS, search, browser rendering),
monitoring stacks, and external bridges stay in their own docs and launch flows.

Add an entry to `SETUP_MODULES` and its id to `FULL_INSTALL_MODULE_IDS`:

```ts
{
  id: "example-helper",
  label: "Example helper",
  async run(ctx) {
    return "done"; // or "guided" or "skipped"
  },
}
```

- Running setup again must not overwrite real user values.
- Edit `.env` with `scripts/lib/envFile.ts`, which keeps comments and key order, and prompt with
  `scripts/lib/prompt.ts`.
- Spawn existing CLI scripts instead of importing them, since they may call `process.exit()`.
- When a required local tool is missing, print the commands to run instead.
- Do not save temporary access tokens the bot does not need at runtime.
- Update `docs/en/self-hosting/setup-wizard.md` when Full Install changes.

Run `bun run check` and `bun run lint`.
