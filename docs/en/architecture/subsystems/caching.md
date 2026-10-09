---
title: "In-Memory Caching System"
---

The in-memory caching subsystem reduces repetitive database and network queries for frequently accessed server configurations, user preferences, whitelists, expression data, and provider capabilities. Many caches expire on read. Creation gates and size caps bound selected stores, write owners invalidate derived state after database success, and memory guards can evict recoverable entries.

## Memory model and lazy expiration

Many database-backed caches evaluate TTLs on read. Expiration causes a miss and a reload from storage.
Other stores have different lifetimes: static catalogs have no ordinary TTL, sprite-message mappings
sweep on writes, and OpenRouter catalogs refresh in the background.

For stores that only check expiry on read, unread entries remain resident until overwritten, invalidated, or explicitly swept. A shorter TTL limits staleness but does not by itself bound those stores' memory usage.

The codebase bounds memory consumption through three coordinated mechanisms:

1. **Size caps with insert-time eviction**: high-frequency caches enforce hard caps on entry counts. `personalSpotlightCache` enforces a cap of 2,000 entries, evicting expired entries first and then the oldest-inserted keys. `personaSpriteMessageCache` sweeps expired entries on its write path at most once every 10 minutes.
2. **Coarse creation gates**: hierarchical keys consult a low-cardinality gate before allocating entries in a fine-grained map. `personalSpotlightCache` checks a per-server boolean gate before creating `serverId:userId:channelDiscId` keys. Servers that configure no spotlights contribute a single gate entry instead of combinatorial entries across users and channels.
3. **Emergency cache clearer**: reactive memory recovery triggered by `src/utils/cache/emergencyCacheClearer.ts` when process memory reaches critical thresholds.

### Discord gateway cache footprint

Discord gateway collections retain messages, guild members, users, and presences independently of
application caches. Their memory footprint must be measured alongside application state.

Scheduled sweepers in `src/init/discord.ts` prune client collections periodically:

- **Messages**: hourly sweep with a 30-minute lifetime.
- **Guild members**: hourly sweep. Excludes the client's own member (required for synchronous permission checks) and any user currently in a voice channel (read synchronously by audio handlers).
- **Users**: hourly sweep restricted to bot accounts. Human users remain reachable so synchronous mention resolution in `historyFormatter` resolves member names without falling back to placeholder strings.

## Active cache layers

Application caches are partitioned by domain ownership, lifetime, and storage backing.

### Server and persona configuration

- **Tomori state cache (`tomoriStateCache.ts`)**: keyed by `serverDiscId`. Stores assembled persona configurations and the server's default persona pointer. Uses a 10-minute TTL (`TOMORI_STATE_CACHE_TTL_MS`).
- **Channel prompt override cache (`channelPromptCacheStore.ts`)**: keyed by `(server_id, channel_disc_id)`. Stores per-channel system prompt overrides. Uses a 10-minute TTL with negative caching (`null`) so unconfigured channels cost a single lookup.
- **Channel model override cache (`channelLlmCacheStore.ts`)**: keyed by `(server_id, channel_disc_id)`. Stores per-channel LLM model selections. Uses a 10-minute TTL with negative caching.
- **Persona sprite cache (`personaSpriteCacheStore.ts`)**: keyed by `persona_id`. Stores ordered sprite definitions for render modifiers. Uses a 10-minute TTL.
- **Persona sprite message cache (`personaSpriteMessageCache.ts`)**: keyed by Discord `message_disc_id`. Maps webhook message IDs to displayed sprite labels for prompt reconstruction. Uses a 120-minute TTL with lazy write-path sweeps.

### User profile and admission rules

- **User cache (`userCache.ts`)**: keyed by `userDiscId`. Stores user settings, global privacy level, and per-server blacklist status. Uses a 30-minute TTL (`USER_CACHE_DURATION_MS`).
- **Channel whitelist cache (`channelWhitelistCache.ts`)**: keyed by `serverDiscId:channelDiscId:parentChannelDiscId:roleSignature`. Stores channel and role admission decisions, persona restrictions, and channel cooldown overrides. Uses a 5-minute TTL (`CACHE_TTL_MS`). Threads incorporate their parent channel ID to inherit parent whitelist rules correctly.
- **Personal spotlight cache (`personalSpotlightCache.ts`)**: dual-map structure combining a per-server boolean gate with a high-cardinality user-channel result map. Uses a 5-minute TTL and a 2,000-entry cap.
- **Persona user block cache (`personaUserBlockCache.ts`)**: keyed by `(server_id, persona_id, user_disc_id)`. Stores active persona-scoped mutes and blocks.

### Content and conversation memory

- **Short-term memory cache (`shortTermMemoryCache.ts`)**: stores recent conversation dialogue turns and generated summaries. Keyed by user-channel or server-channel identifiers, with persona-scoped variants. Fixed lifetimes: 12 hours for raw dialogue (`CRUDE_CONVERSATION_TTL_HOURS`) and 24 hours for summaries (`SUMMARY_TTL_HOURS`). Raw dialogue is volatile. Summaries, categories, and cadence state are backed by PostgreSQL; category-only entries use the 12-hour cache lifetime.
- **Emoji and sticker cache (`emojiStickerCache.ts`)**: keyed by internal `server_id`. Stores native server expressions and registered custom expressions. Tracks category synchronization state so initial emoji fetches do not mask sticker data on later turns. Uses a 10-minute TTL.
- **Markdown table cache (`markdownTableCache.ts`)**: keyed by Discord message ID. Stores original markdown text behind rendered table images. Uses a 120-minute TTL, matching the expiration window of the interactive `Show Markdown` component button.
- **Voice transcript cache (`voiceTranscriptCache.ts`)**: keyed by Discord message ID. Stores speech-to-text and text-to-speech transcripts for historical context. Uses a 120-minute TTL.

### Provider and integration metadata

- **LLM model cache (`llmCacheStore.ts`)**: static model catalog warmed from the `llms` table at startup. Remains immutable during normal runtime.
- **OpenRouter catalogs (`openrouterCatalog.ts`)**: separates models into text, embedding, image, and video catalogs (`openrouterCapabilityCache.ts`, `openrouterEmbeddingModelCache.ts`, `openrouterImageModelCache.ts`, `openrouterVideoModelCache.ts`). Keyed by lowercase model codename. Refreshed on misses and in the background via a 6-hour TTL. Collapses concurrent lookups into single network requests and enforces a 60-second minimum refresh interval. Excluded from emergency clearing to prevent chat traffic from blocking on provider discovery.
- **Live model limits cache (`liveModelLimitsCache.ts`)**: keyed by `provider:codename` for Anthropic and Google models APIs. Successful lookups persist for 24 hours. Failed attempts cache a 10-minute retry interval while serving catalog defaults.
- **NovelAI caches (`novelaiCapabilityCache.ts`, `novelaiSubscriptionCache.ts`)**: static model token limits and subscription tier definitions.
- **Guild MCP configuration cache (`guildMcpConfigCache.ts`)**: caches active MCP server registrations and discovered tool name snapshots.

### Ephemeral workflow sessions

- **Webhook cache (`src/utils/discord/webhook/cache.ts`)**: caches active Discord webhook clients by channel and persona. Webhook tokens are persisted encrypted in PostgreSQL, enabling cache rehydration after process restarts without recreating webhooks.
- **Persona workflow avatar cache (`src/utils/discord/ui/personaWorkflow.ts`)**: transient `Map<number, AvatarCacheEntry>` scoped to an active persona picker interaction. Reuses resolved avatar buffers across pagination, validation failures, and retries. Discarded when the interaction workflow terminates.

## Write invalidation contracts

Caches derive their state from PostgreSQL. To prevent serving stale data, write operations must invalidate affected cache keys directly after a database transaction commits successfully.

Repositories or their calling workflows own database writes and paired invalidation. Check both
when changing a write path; the [memory creation stage](/architecture/pipelines/memory/ltm/01-ltm-create/)
records an existing notification-ordering limitation. Domain invalidators include:

- Server or persona updates: `invalidateTomoriStateCache(serverDiscId)`.
- User setting or memory writes: `invalidateUserCache(userDiscId)`.
- Blacklist toggles: `invalidateUserBlacklistCache(serverDiscId, userDiscId)`.
- Whitelist or cooldown override changes: `invalidateWhitelistCache(serverDiscId, channelDiscId?)`.
- Emoji or sticker updates: `invalidateEmojiStickerCache(serverId)`.
- Channel prompt overrides: `invalidateChannelPromptCache(serverId, channelDiscId)`.
- Channel LLM overrides: `invalidateChannelLlmCache(serverId, channelDiscId)`.
- Persona sprite updates: `invalidatePersonaSpriteCache(personaId)`.
- Personal spotlight updates: `invalidatePersonalSpotlightCache(serverId, userId?, channelDiscId?)` (drops the server gate alongside matching result entries).
- Webhook deletion or recreation: webhook invalidation helpers in `src/utils/discord/webhook/cache.ts`.
- MCP tool discovery updates: `invalidateGuildMcpConfigCache(serverId)`.

Invalidating before write success is forbidden: a rolled-back transaction would leave the cache empty, prompting an immediate refetch of the pre-write database state.

## Emergency memory cleanup
<!-- anchor: emergency-memory-cleanup -->

When the memory monitor observes RSS approaching container limits (`MEMORY_CRITICAL_THRESHOLD` of `CONTAINER_MEMORY_LIMIT_MB`), it triggers `clearEmergencyCaches()` in `src/utils/cache/emergencyCacheClearer.ts`.

- **Evicted data**: clears recoverable database-backed and API-derived caches: Tomori state, user profiles, whitelists, channel LLM overrides, emoji and stickers, guild MCP configs, personal spotlights, NovelAI subscriptions, preset avatars, voice transcripts, markdown tables, persona sprites, and volatile Discord.js client collections (messages, bot users, presences, and voice states).
- **Preserved data**: preserves active conversational state (non-expired short-term memories), static LLM model catalogs, provider capability maps, command registries, active channel locks, and background execution queues. Expired STM entries are swept.
- **Forced collection**: `clearEmergencyCaches()` triggers a forced garbage collection pass before recording post-clear telemetry. Dropping references alone does not ensure immediate reclamation, so post-clear measurements need collection context. RSS and native allocations can still remain high.
- **Configuration flags**:
  - `EMERGENCY_CACHE_CLEAR_ENABLED=true`: master toggle for emergency clearing.
  - `EMERGENCY_CACHE_CLEAR_INCLUDE_STM=false`: preserves active short-term memories. Enabling this drops conversational history and represents an extreme recovery posture.
  - `EMERGENCY_CACHE_CLEAR_DISCORD_VOLATILE=true`: permits sweeping discord.js message and presence caches.

## Native image memory

Image manipulation through `sharp` (backed by `libvips`) allocates decoded bitmaps outside the
JavaScript heap. Heap and JavaScript buffer metrics do not capture every native allocation, so
diagnosis must also consider process RSS. JavaScript cache eviction cannot directly clear libvips caches.

Process-global limits in `src/init/media.ts` configure `sharp` at startup:

```dotenv
SHARP_CONCURRENCY=1
SHARP_CACHE_MEMORY_MB=16
SHARP_CACHE_ITEMS=50
SHARP_CACHE_FILES=0
```

Concurrency is the dominant factor: each concurrent pipeline retains independent decoded bitmaps. Keeping concurrency at `1` bounds memory spikes on memory-constrained containers.

## Source pointers

- `src/utils/cache/emergencyCacheClearer.ts`: emergency cache eviction and telemetry.
- `src/utils/cache/tomoriStateCache.ts`: server configuration and persona caching.
- `src/utils/cache/userCache.ts`: user profile and blacklist caching.
- `src/utils/cache/channelWhitelistCache.ts`: channel and role whitelist admission cache.
- `src/utils/cache/shortTermMemoryCache.ts`: conversational short-term memory cache.
- `src/utils/cache/personalSpotlightCache.ts`: personal spotlight dual-map cache and capacity enforcement.
- `src/utils/cache/openrouterCatalog.ts`: multi-modal OpenRouter capability catalog and refresh loop.
- `src/init/discord.ts`: client collection sweepers and voice participant protection.
- `src/init/media.ts`: `sharp` native image buffer concurrency and memory caps.
