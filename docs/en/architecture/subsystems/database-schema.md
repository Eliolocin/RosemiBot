---
title: "Database Schema and Data Model"
---

The database schema defines persisted relational state, encryption boundaries, and entity lifecycles
in PostgreSQL. Domain repositories own most application queries; startup schema helpers and some
specialized caches also execute SQL. Write paths must pair durable changes with cache invalidation.

## Schema sources and migration lifecycle

TomoriBot organizes database schema across three SQL definitions, a numbered migration runner, and typed seed catalogs:

- **Baseline schema (`src/db/schema.sql`)**: core tables, explicit constraints, performance indexes, and stored functions.
- **RAG schema (`src/db/schema_rag.sql`)**: document and chunk vector tables (`documents`, `document_chunks`), loaded when the `pgvector` extension is available.
- **Preset schema (`src/db/schema_stpreset.sql`)**: SillyTavern character card and preset integration tables.
- **Migration runner (`src/db/migrationRunner.ts`)**: executes structural version upgrades from `src/db/migrations/`.
- **Seed catalogs (`src/db/seed/catalog/`)**: code-defined catalogs for LLMs, diffusion models, video models, embeddings, persona presets, and system prompts.

### Startup initialization sequence

Startup schema execution is coordinated by `src/utils/db/initializeDatabase.ts`:

1. **Legacy rename bridges**: detects legacy table names and runs targeted renames before static schema execution. This prevents baseline DDL from creating empty target tables ahead of the rename.
2. **Baseline DDL application**: executes `schema.sql`, `schema_rag.sql`, and `schema_stpreset.sql` using idempotent statements (`CREATE TABLE IF NOT EXISTS`, guarded helper blocks).
3. **Privileged catalog seeding**: synchronizes typed catalog data (`seedModelsFromCatalog`, `seedPersonasFromCatalog`, `seedSystemPromptsFromCatalog`, `seedNaiPresetsFromCatalog`) using idempotent upserts.
4. **Migration execution**: compares applied records in `schema_migrations` against available numbered migrations in `src/db/migrations/NNN_*.sql`. Migrations are applied in total order sorted by version integer and file stem. On clean installations, all historical migrations are recorded in `schema_migrations` without replaying obsolete backfill scripts.
5. **Storage-backed seeders**: runs post-readiness asset seeders (`seedPersonaSpritesFromCatalog`, `seedPersonaAvatarsFromCatalog`) after the Discord gateway connects, uploading shared preset art to object storage and recording reference URLs in PostgreSQL.

### Migration discipline

- Numbered migrations must follow `NNN_description.sql` (three-digit zero-padded integer) paired with a matching `NNN_description.down.sql` rollback file.
- `bun run check-migrations` verifies migration naming and rollback pairing during continuous integration.
- Deterministic apply ordering uses integer versions first, with file stem code-point comparison breaking ties. Sibling migrations sharing a number must be mutually order-independent.

## Data access boundary

Domain query owners live under `src/utils/db/repositories/`. Some modules, including working-memory
persistence and schema initialization, use the shared SQL client directly.

- **Shared contract**: domain repositories implement the shared `IRepository<TExport>` interface for data querying, exports, and imports.
- **Repository barrel**: shared singleton instances are exported from `src/utils/db/repositories/index.ts`.
- **SQL encapsulation**: all raw SQL queries remain within their owning repository class methods or module functions. Separate query sibling files are prohibited.
- **Transient retry handling**: hot-path reads retry transient connection drops and cached-plan errors through shared helpers in `src/utils/db/client.ts`. A cached-plan error resets the connection before retrying the query.
- **Cache invalidation**: write owners invalidate derived cache entries after successful writes. Some workflows own this in the caller; live working-memory updates use a separate persistence path.

## Core entities and relationships

### Multi-persona and server configuration

```
           ┌──────────────────────┐
           │       servers        │
           └──────────┬───────────┘
                      │ 1:N
                      ▼
           ┌──────────────────────┐
           │       personas       │
           └──────────┬───────────┘
                      │
     ┌────────────────┼────────────────┐
     │ 1:N            │ 1:N            │ 1:N
     ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│persona_      │ │persona_      │ │persona_      │
│attributes    │ │sprites       │ │configs       │
└──────────────┘ └──────────────┘ └──────────────┘
```

- **`servers`**: represents a registered Discord guild or DM pseudo-server. Stores the guild snowflake (`server_disc_id`) and creation timestamps.
- **`personas`**: supports multiple distinct personas per server. Partial unique index `personas_one_main_per_server` permits at most one non-alter (`is_alter = false`) persona per server; setup establishes the main persona. Persona names are constrained unique per server (case-insensitive, trimmed).
- **Pointer personas and copy-on-write**: applying an official preset creates a pointer persona (`is_pointer = true`), referencing `persona_presets` by `preset_lineage_id` and `preset_language`. The first user modification materializes the persona into an independent server copy while preserving `persona_id` and `persona_lineage_id`.
- **`persona_attributes`**: source of truth for ordered persona attributes and their `is_public` visibility flags. Denormalized text arrays in `personas.attribute_list` mirror these values for export compatibility.
- **`persona_sprites`**: stores named sprite avatars per `(persona_id, sprite_key)`. Pointer personas resolve shared artwork from `preset_sprites` (`(preset_lineage_id, preset_language, sprite_key)`). Webhook messages record displayed sprite labels in `persona_sprite_messages` (`message_disc_id` PK) so prompt context rebuilding can restore decorated labels.
- **Server configuration split**: server settings are partitioned into command-aligned tables:
  - `server_chat_configs`: message context fetch limits, model parameters, cascade limits, stop strings, logit biases, and context notes.
  - `server_model_configs`: active model foreign keys (`llm_id`, `embedding_model_id`, `diffusion_model_id`, `video_model_id`, `vision_llm_id`).
  - `server_member_permissions_configs`: member feature toggles, self-teaching, and memory permissions.
  - `server_channel_scope_configs`: channel roleplay rules, blocklists, and thought-log routing.
  - `server_trigger_behavior_configs`: cooldown modes, durations, and trigger styles.
  - `server_auto_trigger_configs` and `server_auto_trigger_persona_overrides`: auto-trigger thresholds and per-channel persona routing.
  - `server_capabilities_configs`: tool exposure switches (video generation, user blocking, time awareness, short-term memory).
  - `server_notice_embeds_configs`: notice verbosity modes (`minimal` or `verbose`) and hidden notice filters.
  - `server_welcome_configs`: welcome greeting channels, prompts, and persona assignments.
  - `server_speech_configs`: text-to-speech voice models and synthesizer parameters.
  - `server_novelai_imagegen_configs`: NovelAI diffusion parameters and default prompt tags.
  - `server_nsfw_configs`: jailbreak toggles and content filters.
  - `server_byok_configs`: bring-your-own-key permissions.
  - `server_memory_configs`: memory retrieval limits and decay parameters.
  - `server_stm_configs`: STM render mode, refresh cadence, and injection depths.

### User identity, privacy, and personalization

- **`users`**: stores account snowflakes (`user_disc_id`), language preferences, registration locales, and `privacy_level` (0 = minimal, 1 = partial, 2 = full).
- **`user_personalization_configs`**: stores personal nicknames, numeric timezone offsets, deliberate tool modes, cross-server short-term memory opt-ins, physical appearance tags, NovelAI character reference URLs, impersonation prompts, and personal fallback routing toggles.
- **`user_persona_naming_preferences`**: stores nullable nickname, prefix, and suffix overrides per `(user_id, persona_lineage_id)`. Survives persona deletion and re-import because it has no foreign key to local persona IDs.
- **`personalization_blacklist`**: server-scoped table keyed by `(server_id, user_disc_id)`. Excludes the user from personalization enrichments in that guild without deleting their account.
- **`persona_user_blocks`**: stores persona-scoped moderation records keyed by `(server_id, persona_id, user_disc_id)`. Supports `mute` (stops triggering persona) and `block` (also hides user messages from dialogue history).
- **`personal_spotlights` and `personal_spotlight_personas`**: maps `(server_id, user_id, channel_disc_id)` to allowed personas. Intersects with server whitelist rules during admission so personal spotlights cannot bypass guild boundaries.

### Memory, dialogue, and expression data

- **`server_memories`**: shared server-wide long-term memories.
- **`personal_memories`**: personal memories scoped by user ID and cross-server `persona_lineage_id`.
- **`conditioning_history`**: behavioral reinforcement records from `/reward` and `/punish`, grouped by `server_id`, `persona_lineage_id`, conditioning type, action key, and normalized reason.
- **`minimal_notice_refs`**: maps minimal memory and task notice message IDs to confirmed entity rows, allowing context rebuilders to restore full prompt bodies from live records.
- **`server_emojis` and `server_stickers`**: native Discord expression metadata synchronized on demand.
- **`custom_expressions` and `custom_expression_personas`**: server-managed custom media registry. Supports unique UUID identities, delivery kinds, validated media limits (10 MiB ceiling), and persona membership scoping.

Custom expression creation in `ServerRepository.saveCustomExpression` locks the owning server row
before checking the per-server count and inserting. This enforces
`MAX_CUSTOM_EXPRESSIONS_PER_SERVER` (default 20) across concurrent managers and all personas,
including link expressions. Existing rows remain editable when the limit is reached or lowered.

### Model catalog and custom endpoints

- **`llms`, `image_diffusion_models`, `video_generation_models`, `embedding_models`, `decision_models`**: global model catalogs seeded from typed code definitions.
- **Pricing storage**: first-party models record token prices directly in `llms.input_price_per_million` and `output_price_per_million`. OpenRouter pricing uses the live API cache first, falling back to database column values.
- **Token limits**: `context_window` and `max_output_tokens` record model ceilings. Runtime code queries them through `resolveModelLimits()`, where live provider responses take precedence.
- **`custom_endpoint_connections`**: logical connection metadata scoped to either `server_id` or `user_id`, grouped by `(owner, label, capability)`.
- **`custom_endpoints`**: model registrations under a connection, linking to synthetic catalog rows through `model_ref_id`.
- **`scoped_model_registrations`**: exclusive arc table mapping extra catalog rows under shared provider names to a specific `server_id` or `user_id`.

### Decision registration lifecycle

Decision catalogs remain independent of text assignments. Migration 098 extends the scoped
registration arc to five catalogs. Native scoped references require the exact owner and registration;
custom entries reuse encrypted provider credentials and endpoint ownership. Only System One and
OpenAI Decisions styles admit custom Decision registrations. Deleting parents removes owned
references and orphaned custom catalog rows. Registration alone activates no endpoint or review gate.

Downgrade requires clearing saved response Decision selections and removing scoped registrations
and Decision connections. Guards and DDL execute atomically: an unused dependent selection column
is removed before the catalog table, and the four-catalog registration check is restored. Unexpected
dependency failures preserve the schema. Normal startup restores the selection column and foreign key.

### Operational state, counters, and admission limits

- **`cooldowns`**: unlogged PostgreSQL table storing command category and message trigger cooldowns.
- **`reminders`**: scheduled reminders and recurring jobs. Uses `next_attempt_at` leases and `delivery_retry_count` budgets to handle transient delivery failures without shifting recurring cadences.
- **`stat_counters`**: pre-aggregated counter table storing usage telemetry across `(server_id, user_id, persona_lineage_id, metric, metric_key, bucket)`. `StatRepository` accumulates counts in memory and flushes them as multi-row additive upserts on interval or shutdown. Excluded from export.
- **`command_catalog`**: dimension table recording all registered slash commands. Synced at boot by `StatRepository.syncCommandCatalog()`, enabling telemetry joins to identify unused commands.
- **`api_key_rotation` and `api_key_rotation_runtime_state`**: provider key rotation pool and error cooldown tracking per server. Excluded from export.
- **`persona_autoch_runtime_state`**: high-frequency autochat counter per persona. Excluded from export.

## Response Drafting workspace settings

The capability toggle defaults Off. Nullable fields in `server_chat_configs` store the reviewer,
Decision selection, prompt override and checker binding. A null reviewer inherits the actual response
model; other nulls mean no Decision routing, default locale instructions and no checker. Both assembled
persona reads carry these fields from the idempotent schema into runtime snapshots.

Reviewer and Decision foreign keys use `ON DELETE SET NULL`. Owned registration/provider deletion
clears the workspace's dependent selections in its transaction, then invalidates snapshots. Checker
removal leaves a saved binding unavailable. Exports contain settings without credentials; imports
validate model/checker ownership before writing. Configuration reset restores these defaults while
preserving registrations and credentials.

## Encryption at rest

Sensitive provider credentials are encrypted using PostgreSQL `pgcrypto` (`pgp_sym_encrypt` with AES-256 and compression). Encrypted values are stored as `BYTEA` alongside an integer `key_version`:

- `server_model_configs.api_key`
- `opt_api_keys.api_key`
- `api_key_rotation.api_key`
- `saved_provider_configs.api_key`
- `user_saved_provider_configs.api_key`
- `guild_mcp_servers.auth_token`
- `discord_managed_webhooks.webhook_token`

`CryptoKeyManager` manages active encryption keys (`CRYPTO_SECRET_V1`, `CRYPTO_SECRET_V2`, etc.). New writes use the active version, while reads decrypt using the row's stored `key_version`. Re-encryption is executed via `bun run rotate-keys --bot-stopped`; see the [operator procedure](/self-hosting/maintenance/#rotating-encryption-keys).

## Reset domain classifications
<!-- anchor: reset-domain-classifications -->

The reset subsystem in `src/utils/db/repositories/ResetRepository.ts` categorizes tables into distinct reset scopes:

- **Server singletons restored to DDL defaults (18 tables)**: `server_chat_configs`, `server_model_configs`, `server_member_permissions_configs`, `server_capabilities_configs`, `server_notice_embeds_configs`, `server_nsfw_configs`, `server_speech_configs`, `server_auto_trigger_configs`, `server_channel_scope_configs`, `server_trigger_behavior_configs`, `server_novelai_imagegen_configs`, `server_byok_configs`, `server_memory_configs`, `server_stm_configs`, `server_welcome_configs`, `image_quota_configs`, `text_quota_configs`, `video_quota_configs`.
- **Preserved server configuration**: active model foreign keys, credentials, custom endpoint parameters, and the cached Other-model identity/capabilities in `server_model_configs`, plus active NovelAI diffusion model identity (`nai_diffusion_model_id`). `SERVER_SINGLETON_RESET_TABLES` owns the exact preserved columns.
- **Cleared server collections (11 tables)**: `server_auto_trigger_persona_overrides`, `stm_categories`, `random_triggers`, `channel_llm_overrides`, `channel_prompt_overrides`, `channel_context_notes`, `personalization_blacklist`, `persona_user_blocks`, `channel_whitelist`, `role_whitelist`, `channel_persona_whitelist`.
- **Preserved server domains**: personas and persona settings, server memories, short-term memories, expressions (emojis, stickers, and custom expressions), recorded quota consumption, saved provider configurations, and external integrations (Matrix and MCP).
- **Personal reset**: restores `users.language_pref` ('en-US') and `users.privacy_level` (0), restores all configuration columns in `user_personalization_configs` to schema defaults, deletes `user_persona_naming_preferences`, and removes all `personal_spotlights` (cascading to `personal_spotlight_personas`). Preserves user account identity, personal memories, saved provider credentials, custom endpoints, and scheduled reminders.

## Source pointers

- `src/db/schema.sql`: baseline tables, constraints, indexes, and stored procedures.
- `src/db/schema_rag.sql`: optional `pgvector` document storage.
- `src/db/migrationRunner.ts`: migration discovery, ordering, and execution.
- `src/utils/db/initializeDatabase.ts`: startup initialization, rename bridges, and catalog seeding.
- `src/utils/db/repositories/`: domain repositories managing data access and cache invalidation.
- `src/utils/db/repositories/ResetRepository.ts`: domain reset classifications and implementations.
- `src/utils/security/crypto.ts`: `pgcrypto` symmetric encryption and decryption.
- `src/utils/security/keyManager.ts`: encryption key version management and rotation.
