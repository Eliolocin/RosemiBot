---
title: "Manual Setup"
aiGenerated: false
sidebar:
  order: 2
---

:::note
Users who want to use Docker Compose should skip this wizard, see
[Docker Compose](/self-hosting/docker-compose/) for the containerized install path.
:::

This is the manual install procedure for technical users who'd rather not use the guided
wizard. If you want the hand-held path, use the [setup wizard](/self-hosting/setup-wizard/) instead as it
creates `.env`, generates a safe `CRYPTO_SECRET`, configures PostgreSQL, and runs the install
for you.

## Prerequisites

- [Bun](https://bun.sh/)
- PostgreSQL installed natively, or run in a Docker container (see step 2)

PostgreSQL schema, `pgcrypto`, seeds, and migrations initialize automatically on bot startup.

## 1. Install

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
bun install --frozen-lockfile
```

## 2. Configure

Create your environment file from the example and fill in the required values:

```sh
cp .env.example .env
```

Required:

- `DISCORD_TOKEN`: your Discord bot token (enable the `GuildMembers`, `MessageContent`, and
  `GuildPresences` privileged intents).
- `CRYPTO_SECRET`: a 32-character encryption key (used to encrypt stored API keys).
- PostgreSQL connection: `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`,
  `POSTGRES_PASSWORD`, `POSTGRES_DB`.

Keep a protected copy of your encryption secret separately from database backups. New backups contain no `.env`. For rotation, use `CRYPTO_SECRET_V1`, `CRYPTO_SECRET_V2`, or any later positive integer version, with optional `CRYPTO_SECRET_CURRENT` selection. `CRYPTO_SECRET` remains V1. Startup and maintenance commands load the same source: local environment values in development, or mounted JSON / AWS Secrets Manager in production. See [Rotating encryption keys](/self-hosting/maintenance/#rotating-encryption-keys) before replacing a secret.

In JSON secret sources, master keys must be strings. `CRYPTO_SECRET_CURRENT` accepts a string such as `"2"` or a numeric positive safe integer such as `2` that names an available version.

:::note[No native PostgreSQL?]
Run just the database in a container, then point the `POSTGRES_*` values at it:

```sh
docker run -d --name tomori-db \
  -e POSTGRES_USER=tomori -e POSTGRES_PASSWORD=yourpassword -e POSTGRES_DB=tomori \
  -p 5432:5432 pgvector/pgvector:pg16
```

Then set `POSTGRES_HOST=localhost`, `POSTGRES_PORT=5432`, and the user/password/db above.
The `pgvector/pgvector` image ships the RAG extension pre-installed; swap it for `postgres:16`
if you don't need document/RAG memory. This runs only the database in Docker and the bot
still runs on host Bun. For a fully containerized bot and database, use
[Docker Compose](/self-hosting/docker-compose/) instead.
:::

Optional tuning lives in `.env.optional.example`. Copy over any values you want to
customize (limits, timeouts, feature toggles, local server URLs, etc.).

Custom expression uploads default to local files under `data/custom-expressions/`.
Keep that directory on persistent storage. `EXPRESSION_STORAGE_BACKEND` accepts `local`,
`gcs`, or `s3`. Cloud backends require `EXPRESSION_STORAGE_BUCKET` and the corresponding
SDK credentials. S3 also uses `AWS_REGION` (default `us-east-1`) and optional `S3_ENDPOINT`.
GCS uses application default credentials. Expressions use their own bucket setting;
avatar storage settings do not select an expression bucket. Objects remain readable through
the SDK and are attached as bytes, so a publicly served media URL is unnecessary.
Preserve backend, bucket, and object keys when restoring existing references.

`MAX_CUSTOM_EXPRESSIONS_PER_SERVER` caps custom expressions per server (default `20`, minimum `1`).
Links and uploaded files share the limit across all personas; native emojis and stickers are excluded.
Restart the bot after changing it. Lowering the limit preserves existing expressions and allows edits
and deletions, but blocks additions until the count falls below the limit.

## 3. Run

```sh
bun run dev
```

When you see `TomoriBot up and running!`, go to Discord and run `/setup` in your
server to connect an AI provider and initialize the bot. The command opens a guided
checklist panel, and nothing is written until you press `Finish Setup`; see
[The `/setup` command](/self-hosting/setup-wizard/#the-setup-command) for the steps and the
[Quickstart](/introduction/quickstart/) for the in-Discord side.

Use `bun run launch` instead of `bun run dev` if you want optional local servers (SearXNG, Crawl4AI, local TTS/STT) launched alongside the bot:

```sh
bun run launch --searxng --crawl4ai
bun run launch --help        # see all flags
```

## Optional extras (the manual "Full Install")
<!-- anchor: optional-extras-the-manual-full-install -->

The [setup wizard](/self-hosting/setup-wizard/)'s `Full Install` path layers four lightweight extras on
top of the base install. None are required to run the bot, but each unlocks a feature. If
you're installing by hand, add whichever you want:

### `pgvector` : document/RAG memory

RAG (document uploads and cross-channel recall) stores embeddings in a `vector` column, which
needs the [pgvector](https://github.com/pgvector/pgvector) extension. Install it for your
PostgreSQL major version:

```sh
# Debian/Ubuntu, e.g. for PostgreSQL 16
sudo apt-get install -y postgresql-16-pgvector
```

Then enable it once on your database. Connect with `psql` using the `POSTGRES_*` values from
your `.env`: it prompts for `POSTGRES_PASSWORD`:

:::note[Windows]
There is no prebuilt pgvector package for native Windows PostgreSQL. Installing it means
building from source against your exact PostgreSQL version with Visual Studio C++ and `nmake`
(see pgvector's [Windows instructions](https://github.com/pgvector/pgvector#windows)). The
simpler path on Windows is to run the database in the `pgvector/pgvector` container shown under
[Configure](#2-configure) above, which ships the extension pre-installed.
:::

```sh
# Native / host psql (substitute your own POSTGRES_USER and POSTGRES_DB):
psql -h localhost -p 5432 -U tomori -d tomodb

# Or, if the database runs in the Docker container from step 2:
docker exec -it tomori-db psql -U tomori -d tomori
```

Once connected, run:

```sql
CREATE EXTENSION vector;
```

Without pgvector the bot still runs but RAG features become completely unavailable. This extension is
also required on the target database before restoring a backup; see
[Safe Migration](/self-hosting/safe-migration/) for details.

### `pg_cron` : scheduled cleanup jobs

`pg_cron` powers optional periodic database maintenance (cooldown/reminder-row cleanup).
Docker Compose from this repo already configures it.

:::caution[Not required for reminders or triggers]
`pg_cron` performs purely housekeeping as it only cleans up stale rows. Reminder delivery and
random triggers run in the app itself, so those features work with or without `pg_cron`.
:::

For a self-managed PostgreSQL, find your active config file:

```sql
SHOW config_file;
```

Enable the extension in `postgresql.conf`: append to `shared_preload_libraries` if it
already lists other libraries:

```ini
shared_preload_libraries = 'pg_cron'   # e.g. 'pg_stat_statements,pg_cron'
cron.database_name = 'your_dbname'
```

Restart PostgreSQL, then:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

### Tokenizer assets : model-aware logit bias

Logit bias (emoji/word repetition penalties) needs local tokenizer assets:

```sh
bun run setup:tokenizers
```

Some families (e.g. Gemma) are gated and require a
[HuggingFace token](https://huggingface.co/settings/tokens) after you accept their license:

```sh
# Windows (PowerShell)
$env:HF_TOKEN="hf_xxx"; bun run setup:tokenizers

# macOS/Linux
HF_TOKEN=hf_xxx bun run setup:tokenizers
```

Without this step logit bias is silently disabled and everything else works normally.

The secure `fetch_url` fallback and the DuckDuckGo `web_search` fallback both run in process, so
neither needs an extra installation.

## Maintenance, updating & backups

Once you're installed, the host-side scripts (`bun run update`, `bun run backup`,
`bun run restore-backup`, `bun run nuke-db`, `bun run rotate-keys`, …) and the update and
backup procedures all live on the [Maintenance & Backups](/self-hosting/maintenance/) page. If you're about
to pull a new version, start with [Safe Migration](/self-hosting/safe-migration/).
