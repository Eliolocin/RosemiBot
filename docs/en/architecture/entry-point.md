---
title: "Entry Point and Initialization Flow"
sidebar:
  order: 4
---

`src/index.ts` coordinates application startup by executing focused initialization modules in
`src/init/` before connecting to Discord.

## Initialization files

- `src/index.ts`: Startup coordinator. Resolves environment, executes initialization steps in order, and connects to Discord.
- `src/init/backup.ts`: Non-production automatic data backup gate before database schema initialization.
- `src/init/healthServer.ts`: Lightweight HTTP health server for production liveness and readiness probes.
- `src/init/secrets.ts`: Secret resolution and initialization of `keyManager` encryption helpers.
- `src/init/heapSnapshot.ts`: Process-level diagnostic signal handler for on-demand V8 heap snapshots.
- `src/init/media.ts`: Process-global concurrency and memory limits for Sharp and libvips image processing.
- `src/init/discord.ts`: Discord client construction, intent probing, cache sweepers, and gateway error classification.
- `src/init/database.ts`: Schema application, migration execution, catalog seeding, and cooldown cleanup.
- `src/init/loaders.ts`: Modal interception, localization, tool registry, model caches, and event listener registration.
- `src/init/bridges.ts`: Optional Matrix appservice bridge initialization.
- `src/init/timers.ts`: Background periodic tasks, memory monitoring, catalog refreshers, and post-ready hooks.
- `src/types/config.ts`: Configuration interfaces and environment resolution (`resolveEnvironment()`).

The HTTP health server binds only in production mode. Container healthcheck configuration belongs
to the deployment guides; gateway login errors are reported in process logs.

## Startup sequence

1. **Environment resolution**: Loads `.env` via `config({ quiet: true })` and resolves the runtime
   environment (`development`, `test`, or `production`).
2. **Health server binding**: In production mode, binds the HTTP health server immediately to `$PORT`
   (default 8080). It serves `503 Service Unavailable` until the Discord gateway reports ready.
3. **Secret loading**: Calls `loadSecrets(environment)` to decrypt application credentials and populate
   `process.env`. Initializes `keyManager` for runtime PGP symmetric operations.
4. **Automatic backup gate**: In non-production environments, runs `initStartupBackup(environment)`.
   Creates a backup archive when the existing archive originates from another version or is older
   than `TOMORI_AUTO_BACKUP_INTERVAL_HOURS` (default 24). Automatic bundles are capped at
   `TOMORI_AUTO_BACKUP_MAX` (default 5). Manual archives created via `bun run backup` are preserved.
5. **Heap snapshot handler**: Registers `registerHeapSnapshotHandler()`, binding `SIGUSR2` on POSIX
   hosts to write diagnostic V8 heap dumps to `HEAP_SNAPSHOT_DIR`.
6. **Media processing configuration**: Calls `initMediaProcessing()` to configure Sharp and libvips.
   Sets concurrency to 1 and restricts cache memory to 16 MB by default to prevent native image buffers
   from exhausting container memory budgets.
7. **Client construction and intent probe**: Probes Discord via `resolvePresenceIntentEnabled()` to
   determine whether the privileged Guild Presences intent is enabled for the bot token. Constructs
   the `Client` instance with configured cache sweepers and registers gateway connection logging.
8. **Database initialization**:
   - Executes pre-schema legacy rename bridges (`runPreSchemaPersonaRenameBridge`). This heals empty
     legacy tables re-created during schema rollbacks.
   - Executes `src/db/schema.sql` to establish base relational tables.
   - Probes pgvector availability (`detectRagAvailability()`). If present, executes `src/db/schema_rag.sql`.
   - Executes `src/db/schema_stpreset.sql` for SillyTavern preset tables.
   - Seeds static catalog rows in order: models, personas, system prompts, and NovelAI presets.
   - Applies pending numbered migrations from `src/db/migrations/`. Fresh databases mark all migrations
     applied because base schemas already represent the latest shape.
   - Purges expired cooldown records (`cleanupExpiredCooldowns()`).
   - Attempts optional `pg_cron` schedule registration for hourly cooldown cleanup in production.
9. **Loaders and subsystems**:
   - Binds raw modal submission interception (`initializeRawModalInterception()`).
   - Loads localization trees (`initializeLocalizer()`).
   - Initializes the centralized tool registry (`initializeTools()`). Failure here is fatal.
   - Loads the LLM configuration cache (`initializeLLMCache()`).
   - Populates the OpenRouter capability cache (`initializeOpenRouterCapabilityCache()`).
   - Syncs live OpenRouter pricing into the database catalog (`syncOpenrouterCatalogPricing()`).
   - Warms OpenRouter modality caches for video, image, and embedding models in parallel.
   - Preloads preset avatars into the in-memory cache (`initializePresetAvatarCache()`).
   - Attaches all Discord gateway event listeners via `eventHandler(client)`.
10. **Bridge runtimes**: Initializes optional external bridges (`initBridges()`), such as the Matrix
    appservice bridge. Bridge errors log warnings without halting startup.
11. **Timers and monitors**: Calls `initTimers(client)`:
    - Registers post-connection `clientReady` listeners: health tracker, scheduled work coordinator,
      memory monitor, cache metrics logger, and preset art catalog storage reconciliation.
    - Activates immediate background timers: upload quota cleanup, RAG availability monitor, OpenRouter
      catalog refresher, and short-term memory janitor.
12. **Discord gateway login**: Authenticates via `client.login(process.env.DISCORD_TOKEN)`. Any login
    failure logs the error and exits with code 1.

## Failure recovery and lifecycle

Initialization errors fall into two criticality tiers:

- **Fatal (process exits with code 1)**:
  - Startup backup failure in non-production environments
  - Database connection or schema application errors
  - Centralized tool registry initialization failures
  - Discord login rejections or gateway unreachable errors
- **Non-fatal (logs warning and continues)**:
  - Cache pre-warming errors
  - Optional `pg_cron` schedule registration failures
  - Matrix bridge connection failures
  - Cooldown purge errors
  - Background monitor registration failures

### Why Discord login failure exits

When `client.login()` rejects, discord.js invokes internal teardown and marks the WebSocket manager as
destroyed (`ws.destroyed = true`). It also clears credentials and shuts down cache sweepers. A second
`login()` attempt on the same client instance cannot recover.

The bot relies on container restart policies to spawn a fresh process. This clears broken socket
descriptors, re-probes network availability, and resets client memory state.

## Gateway presence intent detection

Guild Presences is a privileged gateway intent. `resolvePresenceIntentEnabled()` probes the bot's
application configuration via `GET /applications/@me` before client construction:

- When Discord reports the presence intent is approved, the client enables `GatewayIntentBits.GuildPresences`.
- When Discord reports the intent is not approved, the client omits the flag. Context builders detect
  missing presence permissions via `client.options.intents.has()` and omit user presence details without
  crashing.
- If the probe request fails due to a network error, startup falls back to safe defaults: enabled in
  development, disabled in production.

## clientReady event execution

Once the gateway connection is confirmed, `eventHandler` runs sorted handlers under `src/events/clientReady/`:

1. `01_registercommands.ts`: Registers application slash commands with the Discord REST API.
2. `02_guildMcpLifecycle.ts`: Registers guild MCP shutdown cleanup and, outside production, pre-connects enabled guild servers. No local MCP process starts.
3. `03_initCommandRegistry.ts`: Builds fast-lookup routing maps for slash commands.
4. `04_syncCommandCatalog.ts`: Synchronizes command metadata and descriptions with database tables.
5. `status.ts`: Configures the bot's user status and activity message.

Deferred timers registered in `src/init/timers.ts` trigger on the same `clientReady` event.

## Production health endpoint

The health server bound in `src/init/healthServer.ts` serves `GET /health`:

- `200 OK`: The Discord client is ready and WebSocket ping is within the accepted range.
- `503 Service Unavailable`: Startup is in progress, the client has disconnected, or websocket latency
  exceeds acceptable bounds.

Both `/health` and `/healthz` report activity age and event-loop measurements, but those diagnostics
do not affect the verdict. Quiet channels must not make an otherwise connected bot unhealthy.
