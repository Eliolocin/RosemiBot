---
title: "Docker Compose"
sidebar:
  order: 3
---

Docker Compose runs TomoriBot and PostgreSQL together in containers. It is the third install option alongside the [setup wizard](/self-hosting/setup-wizard/) and [manual setup](/self-hosting/manual-setup/): choose it when you want to run everything in Docker without installing Bun or PostgreSQL on your host system. It bypasses the interactive setup wizard and configures the database connection automatically.

:::caution[Host tools for updates]
`bun run update --docker` needs host Bun and Git to pull code changes. Its database backup runs inside the application container. You can also run manual backups and restores through Compose; see [Maintenance & Backups](/self-hosting/maintenance/).
:::

## 1. Get the code

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 2. Required `.env` values

Start from the example file:

```sh
cp .env.example .env
```

Set these required variables in `.env`:

| Variable | Value |
|---|---|
| `DISCORD_TOKEN` | Your Discord bot token (enable the `GuildMembers`, `MessageContent`, and `GuildPresences` privileged intents). |
| `CRYPTO_SECRET` | A 32-character encryption key used to encrypt stored API keys. |
| `POSTGRES_PASSWORD` | The database password. Every other `POSTGRES_*` value is auto-configured. |

Generate a random 32-character value for `CRYPTO_SECRET` using Docker, then copy it into `.env`:

```sh
docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"
```

Generate a separate password for `POSTGRES_PASSWORD`. You can copy optional tuning settings from `.env.optional.example`.

:::note[Database connection is automatic]
The Compose PostgreSQL service runs in development mode (without SSL) on an internal Docker network. The bundled image includes `pgvector` and `pg_cron`, so document memory, vector search, and scheduled cleanup work immediately. Do not set `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, or `POSTGRES_DB` in `.env`; Compose configures them automatically.
:::

On Linux, create the bind-mount directories on the host and assign ownership to UID 1001 before starting the containers. Docker creates missing mount points as root, which prevents the bot container from saving backups, logs, or uploads:

```sh
mkdir -p backups logs data
sudo chown 1001:1001 backups logs data
```

## 3. Build and run

```sh
docker compose build   # first time, or after code/dependency changes
docker compose up      # bot + database
```

For later starts, `docker compose up` alone is enough unless you change code or dependencies. Once the bot connects to Discord, run `/setup` in any server channel to add your AI provider key. See the [Quickstart](/introduction/quickstart/) for setup options in Discord.

Compose pins `RUN_ENV=development` in its service definition so `.env` secrets and local HTTP endpoints work. The container healthcheck reports whether the bot process is running; it does not test Discord gateway connectivity. For production mode (`RUN_ENV=production`) differences (secret managers, network restrictions, and metrics), see [Security Architecture](/architecture/subsystems/security/).

## 4. Optional local servers (Compose profiles)

Run optional local helper servers with Compose profiles so you only start what you need:

```sh
# SearXNG (private web search) + Crawl4AI (browser-rendered fetch)
docker compose --profile searxng --profile fetch-crawl4ai up
```

When enabling SearXNG, set `SEARXNG_BASE_URL=http://searxng:8080/` in `.env`. Leave it unset otherwise. Set `SEARXNG_SECRET` to a separate random value for SearXNG request signing.

See [SearXNG](/self-hosting/local-endpoints/setup-searxng/), [Crawl4AI](/self-hosting/local-endpoints/setup-crawl4ai/), and [Local Monitoring](/self-hosting/local-monitoring/) for server-specific setup.

## Maintenance, updating, and backups

Use `bun run update --docker` for backup-first updates on Compose deployments. To back up or restore your Compose database, see [Maintenance & Backups](/self-hosting/maintenance/). Before pulling a new version, review [Safe Migration](/self-hosting/safe-migration/).
