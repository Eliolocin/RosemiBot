---
title: "Getting Started with TomoriBot Development"
sidebar:
  order: 2
aiGenerated: true
---

How to run TomoriBot locally with Bun and PostgreSQL for development.

## Prerequisites

- Bun and PostgreSQL.
- A Discord application with the `bot` and `applications.commands` scopes, and the `Server Members`
  and `Message Content` privileged intents enabled in the Developer Portal. `Presence` is optional
  and only used outside production.

## Run the bot

```bash
bun install --frozen-lockfile
cp .env.example .env
```

Fill in the required values, and create the database and user they name:

```dotenv
DISCORD_TOKEN=...
CRYPTO_SECRET=...
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=...
POSTGRES_PASSWORD=...
POSTGRES_DB=tomodb
RUN_ENV=development
```

- The code branches on `RUN_ENV`, not `NODE_ENV`.
- `RUN_ENV=production` reads secrets from AWS Secrets Manager unless `TEST_PRODUCTION=true`.
- Optional settings are in `.env.optional.example`; copy only the ones you need.

```bash
bun run dev
```

Startup loads secrets, the encryption key manager, the schema and seeds, the tool registry, locales,
and caches, then sets up event handlers and logs in to Discord.

## Set up a test server

Run `/setup` in your server. It needs `Manage Server` and opens a private checklist. Nothing is
saved until `Finish Setup`: cancelling or restarting the bot discards the draft (drafts live in
memory, up to 200 at a time).

With `RUN_ENV=development` the checklist has two steps:

- **AI Provider**, one select with three modes:
  - **AI Provider (Recommended)**: pick a provider and enter an API key, which is validated and
    encrypted into the draft.
  - **Custom Endpoint**: `Configure Connection`, then `Configure Text Model`, which is
    enabled once the connection validates.
  - **User BYOK** (servers only): members bring their own providers and the server keeps no text
    provider.
- **Starting Settings**, one modal: persona, reply style, timezone, and the default system prompt.
  `Built-in Default (Recommended)` stores no prompt text, so it follows future changes to the
  shipped default; a catalog preset stores its text when you finish.

`RUN_ENV=production` adds a `Policies` step that accepts the Terms of Service and Privacy Policy.
Set `TEST_PRODUCTION=true` to see it locally. The same setting controls whether
`/legal terms-of-service` and `/legal privacy-policy` are registered; `/legal license` always is.

Afterwards, `/providers` adds and edits saved providers (`Add New Custom Endpoint` for a custom one,
then register a model from its dropdown), and `/config` > Models > Switch Models changes the active
provider or model.

Quick checks: `/ping`, `/status`, and mentioning the bot in chat. If commands do not appear, run
`/refresh`.

## Commands

| Command | Use |
|---|---|
| `bun run dev` / `build` / `start` | Run with reload, build, run the build |
| `bun run check`, `bun run lint` | TypeScript and Biome |
| `bun run vl` | Every gate, one verdict each (see [Development Tasks](/contributing/development-tasks/)) |
| `bun run check-locales`, `bun run check-limits` | Locale keys and Discord limits |
| `bun run check-runtime-imports` | Runtime dependencies load, and `bun.lock` keeps compatible transitive versions. Fatal in `vl` and CI |
| `bun run check-media-size` | Fails on tracked media over 1 MiB in `src/db/seed/catalog/personas/**` and `assets/img/**` |
| `bun run compress-media` | Fixes those files: lossless re-encode first, then a downscale to 768 px on the long edge if still too big. `--dry-run` previews; a path substring targets one file |
| `bun run nuke-db`, `bun run backup` | Reset or back up the local database |
| `bun run purge-commands` | Remove registered slash commands |

Persona PNGs are already well compressed, so meeting the budget usually needs the downscale; Discord
shows avatars at 128 px or less. On a `release` checkout, `compress-media` also converts static release
cards in `.github/release/**` to WebP (quality 90) and rewrites `release-notes.md` references. GIF cards
stay GIF and are replaced only by a smaller re-encode. For a release already published, update its body
with `gh release edit` afterwards.
