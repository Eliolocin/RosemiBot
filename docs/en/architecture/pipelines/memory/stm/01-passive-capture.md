---
title: "STM 01: Passive Capture"
---

Passive capture records completed dialogue turns into the in-process short-term memory cache immediately after generation finishes.

## Flow and ownership

When model generation finishes, [Run Generation Turn: Post-Turn Effects](/architecture/pipelines/chat/06-per-turn/04-post-turn-effects/) calls `writeShortTermMemory()` in `src/utils/chat/postTurnEffects.ts`. This function extracts conversation entries from `simplifiedMessages`, normalizes custom emojis, and strips turn-ephemeral context annotations using `stripInjectedContextAnnotations()`. It then appends the newly delivered model responses from `result.personaResponses`.

For each unique persona ID among the responses, `writeShortTermMemory()` calls `storeShortTermMemory()` in `src/utils/cache/shortTermMemoryCache.ts`. The cache maintains up to `MAX_MESSAGES_PER_CHANNEL` (10) recent turns per entry:

- **User-scoped key:** `shortterm:user:userId:channelId[:personaId]` enables cross-channel user awareness.
- **Server-scoped key:** `shortterm:server:serverId:channelId[:personaId]` enables shared channel history visible to all users in a guild. Direct message sessions skip this key.

After storing dialogue entries, `writeShortTermMemory()` invokes `incrementStmTurnCounter()` asynchronously. This advances `turnsSinceRefresh` on the live scope row once per bot participation cycle, tracking cadence for future summary nudges.

Passive capture preserves any existing `summary`, `categories`, and cadence metrics already attached to the cache entry.

## Persistence and data boundaries

Crude conversation messages exist exclusively in process memory. Cache reads treat entries as expired after 12 hours unless summary text extends the entry lifetime to 24 hours.

To support subsequent summary and category writes, `storeShortTermMemory()` triggers an asynchronous call to `ensureStmRow()`. This inserts a placeholder row into the `short_term_memories` database table using `ON CONFLICT DO NOTHING`, creating the scope row without overwriting existing summaries when the write succeeds. Failures are logged and do not undo the live cache update.

## Constraints and rationale

- **Skip conditions:** capture aborts immediately when the turn is a stop response, when no simplified messages exist, when no persona generated text, or when the triggering user has `PrivacyLevel.FULL`.
- **Fault isolation:** caching errors are caught and logged as warnings. Failure to record short-term memory never rejects or delays a delivered conversation response.
- **Persona separation:** separate cache entries are stored for each distinct persona ID, preserving conversational boundaries when multiple characters participate in a shared channel.

## Source pointers

- `src/utils/chat/postTurnEffects.ts`: `runPostTurnEffects` orchestrates side effects and invokes `writeShortTermMemory`.
- `src/utils/cache/shortTermMemoryCache.ts`: `storeShortTermMemory` updates the cache and queues `ensureStmRow`.
- `src/utils/text/context/memories.ts`: `buildShortTermMemoryContext` reads cached turns during prompt assembly.
