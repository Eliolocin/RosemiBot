---
title: "Cooldown System"
---

The cooldown subsystem bounds command and message-trigger invocation traffic before pipeline admission. It persists ephemeral limits in PostgreSQL unlogged storage, scales command rates by category, and coordinates channel-level whitelist overrides with manager exemptions.

## Flow and ownership

TomoriBot enforces two distinct cooldown scopes: slash command category cooldowns during interaction dispatch, and message-trigger cooldowns during chat admission planning.

### Slash command category cooldowns

Interaction dispatch in `src/events/interactionCreate/handleCommands.ts` guards command execution through `CooldownRepository`:

- **Scope**: keyed by Discord user ID and command category. The root slash command name acts as its category.
- **Type**: uses `CooldownType.COMMAND_CATEGORY` (value 5).
- **Duration**: base durations are defined in `handleCommands.ts`: 10,000 ms for `/persona` (`COOLDOWN_PERSONA_MS`), 3,000 ms for listed feature categories (`CATEGORY_COOLDOWN_MS`), and 1,600 ms fallback (`DEFAULT_COOLDOWN_MS`).
- **Scaling**: the environment multiplier `COMMAND_COOLDOWN_SCALE` scales every base duration (default `1`). Setting this to `0` disables category cooldown checks and database writes entirely.
- **Rejection**: a command rejected by cooldown replies with localized error embeds (`general.cooldown_title` and `general.cooldown`).

### Message trigger admission cooldowns

Message-triggered conversations pass through admission gating in `src/utils/chat/admissionGuards.ts` via `rejectOnMessageTriggerCooldown()`, which queries `cooldownRepository.checkMessageTriggerCooldownWithWhitelist()`:

1. **Whitelist evaluation**: queries `getCachedWhitelistStatus()` using the server ID, channel ID, member roles, and thread parent channel ID if applicable.
2. **Channel and role admission**: if a channel or role whitelist is enabled and the message fails admission, the trigger is blocked without recording a cooldown.
3. **Persona gating**: if a persona restricts participation to specific whitelisted channels, matching is rejected outside those channels. Personal spotlights add an additional user-and-channel filter on eligible personas.
4. **Effective cooldown resolution**:
   - If the channel is whitelisted with explicit overrides, the channel-specific cooldown type and duration take precedence.
   - If the channel is whitelisted without an override, or is unwhitelisted on a server with open access, settings inherit from global `server_trigger_behavior_configs.cooldown_type` and `cooldown_length`.
5. **Cooldown execution**: on admission rejection, the bot sends an optional DM notice to the user (`sendCooldownDM`) using localized keys (`general.message_cooldown_title`, `general.message_cooldown`) and the cooldown type footer key.

### Cooldown types

The `CooldownType` enum in `src/types/db/schema.ts` defines six operational modes:

- `OFF` (0): no trigger cooldown.
- `PER_USER` (1): individual cooldown per user within a server.
- `PER_CHANNEL` (2): shared cooldown per channel.
- `SERVER_WIDE` (3): server-wide cooldown across all members.
- `STRICT_SERVER_WIDE` (4): legacy server-wide cooldown without exemptions.
- `COMMAND_CATEGORY` (5): global cross-server category cooldown for slash commands.

Server managers with `ManageGuild` permission bypass trigger cooldown types 1 through 3. Type 4 (`STRICT_SERVER_WIDE`) allows no exemptions. The environment flag `DISABLE_COOLDOWN_EXEMPTIONS=true` disables exemptions during automated testing.

## Data storage and lifecycle

Cooldown records are persisted in the `cooldowns` table in `src/db/schema.sql`.

- **Unlogged storage**: `cooldowns` is an `UNLOGGED` PostgreSQL table. Ephemeral rate limits bypass write-ahead logging (WAL), reducing disk I/O on busy instances. An unclean database restart empties the table safely, resetting active cooldowns without risking application data integrity.
- **Scope columns**: records store `cooldown_type`, `server_disc_id`, `user_disc_id`, `channel_disc_id`, `command_category`, and `expiry_time` (Unix timestamp in milliseconds).
- **Idempotent upsert**: unique index `uq_cooldown_scope` uses `COALESCE` across all scope identifiers to handle null values safely. Calling `setCommandCategoryCooldown()` or `setMessageTriggerCooldownWithWhitelist()` updates `expiry_time` on conflict.
- **Fail-open behavior**: database query errors during cooldown checks log warnings and report `isOnCooldown: false`. A database brownout does not lock users out of chat, though it creates a window for repeated invocations. Text, image, and video quotas fail open the same way, so failing cooldowns closed alone would not bound spend during a brownout. Change both together if an outage is observed admitting traffic above its limits, or if unprivileged senders can saturate the database pool.
- **Cleanup**: PostgreSQL stored procedure `cleanup_expired_cooldowns()` deletes expired rows (`expiry_time <= current_ms`). It executes at startup in `src/index.ts` and runs hourly via `src/db/pgcron.sql` when `pg_cron` is enabled.

## Cache interaction

When an administrator modifies trigger cooldown or whitelist rules via `/config` or `/moderation`, the write paths invalidate cached state directly after the database transaction commits:

- `invalidateTomoriStateCache(serverDiscId)`
- `invalidateWhitelistCache(serverDiscId, channelDiscId?)`
- `invalidatePersonalSpotlightCache(serverId)`

Invalidation ensures subsequent message admission checks observe the updated rules immediately.

## Source pointers

- `src/utils/db/repositories/CooldownRepository.ts`: database queries, upserts, scope resolution, and cleanup.
- `src/utils/chat/admissionGuards.ts`: admission cooldown evaluation, scope resolution, and user notifications.
- `src/events/interactionCreate/handleCommands.ts`: slash command category cooldown evaluation and multiplier scaling.
- `src/db/schema.sql`: `cooldowns` unlogged table schema, unique scope index, and `cleanup_expired_cooldowns()`.
- `src/types/db/schema.ts`: `CooldownType` enum definition.
