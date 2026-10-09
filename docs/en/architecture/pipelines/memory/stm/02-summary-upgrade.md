---
title: "STM 02: Summary Upgrade"
---

The summary upgrade stage allows the model to replace verbose dialogue history at prompt assembly time with a compact, durable summary or structured category values.

## Flow and ownership

During the tool loop, the model calls `update_short_term_memory` managed by `UpdateShortTermMemoryTool` in `src/tools/functionCalls/updateShortTermMemoryTool.ts`. The tool operates silently without posting Discord embeds or chat notices.

The tool provides two operating modes based on server configuration:

1. **Default summary mode:** active when a server uses the default single-summary configuration. The model provides a `summary` string. The tool strips unauthorized brace placeholders using `sanitizeUnknownTemplatePlaceholders()` and truncates strings exceeding `MAX_SUMMARY_LENGTH` (1500 characters).
2. **Category mode:** active when custom categories are configured in the `stm_categories` table. `assembleForContext()` builds a dynamic tool schema mapping each category slug to a parameter description. The model provides structured key-value pairs for each defined category.

`UpdateShortTermMemoryTool.execute()` dispatches writes through `src/utils/cache/shortTermMemoryCache.ts`:

1. Mutates the live in-process cache entry for both user and server keys (`updateShortTermMemorySummary` or `updateShortTermMemoryCategories`).
2. Persists the values to the `short_term_memories` database table (`upsertStmSummary` or `upsertStmCategories`).
3. Resets the cadence counter by calling `resetStmTurnCounter()`, resetting `turnsSinceRefresh = 0` and incrementing `lastRefreshedTurn`.
4. The tool loop marks `streamingContext.disableShortTermMemoryUpdate = true`, enforcing a limit of one successful upgrade per turn.

Prompt assembly inspects the cache entry during the next turn. Same-channel memory uses categories or a summary in preference to crude messages. Other-channel rendering can add recent raw messages in `crude_summary` mode; `supersede` omits them when distilled content exists. Cache expiry uses 24 hours when an entry has non-empty summary text, and 12 hours otherwise, including category-only entries. Durable rows have a separate janitor retention policy.

## Persistence and deletion lifecycle

Successfully stored summaries and categories persist across process restarts. The cache helpers log and swallow persistence errors after updating live entries, so a successful tool response alone does not prove that the database write succeeded. When a cache miss occurs after startup, hydration functions pre-warm entries from `short_term_memories` with an empty message list.

Because the live cache entry updates in place before writing to the database, no secondary cache invalidation is required.

Working memory deletion is owned by explicit cleanup commands:

- Channel resets via `/refresh` call `clearShortTermMemoryForChannel()`.
- User memory deletions call `clearShortTermMemoryForUser()`.

Both functions evict the relevant entries from process memory immediately and issue asynchronous queries deleting matching rows from `short_term_memories`. If deletion fails, a later process can hydrate the remaining durable state.

## Constraints and guards

- **Capability toggle:** `short_term_memory_enabled === false` in server configuration removes the tool from offered definitions and rejects unexpected calls.
- **Explicit intent guard:** `streamingContext.explicitLongTermMemoryIntent === true` suppresses the tool definition and blocks execution, reserving the turn for long-term memory operations.
- **Provider exclusion:** NovelAI is disabled in `isAvailableFor()` because model token limits leave insufficient space for memory management overhead.
- **Turn deduplication:** `streamingContext.disableShortTermMemoryUpdate === true` blocks subsequent attempts to execute the tool during the same turn.

## Source pointers

- `src/tools/functionCalls/updateShortTermMemoryTool.ts`: `UpdateShortTermMemoryTool` definition, availability checks, and category routing.
- `src/utils/cache/shortTermMemoryCache.ts`: in-memory updates and database persistence helpers.
- `src/utils/db/repositories/ShortTermMemoryRepository.ts`: queries for category schemas and persisted short-term memory rows.
- `src/utils/chat/toolLoop.ts`: enforces single-execution policy by setting `disableShortTermMemoryUpdate`.
