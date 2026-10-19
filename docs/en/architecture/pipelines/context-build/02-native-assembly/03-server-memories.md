---
title: "02.3: Server Memories"
aiGenerated: true
---

Server memories provide persona-scoped long-term memories stored for the active server or direct message channel.

## Flow and ownership

The contributor `buildServerMemoryContextItem` in `src/utils/text/context/memories.ts` loads and formats memories for the current persona lineage:

1. **Precondition check**: Returns `null` if `tomoriState.server_memories` is empty or undefined. In `nativeBuilder.ts`, the contributor is skipped entirely during user impersonation.
2. **Database retrieval**: Queries `serverMemoryRepository.loadServerMemoriesScoped(serverId, personaLineageId)` for all active memories scoped to the server and persona lineage. If loading fails or scoping IDs are missing, it falls back to the in-memory `tomoriState.server_memories` array.
3. **Channel scope filtering**: When `channelMemoryEnabled` is enabled, a memory with a non-empty `channel_disc_ids` is filtered out unless it contains the current channel ID or, inside a thread, the parent channel ID (`channelScopeAdmits` in `src/utils/discord/channelScope.ts`). An empty scope applies in every channel. A memory whose legacy `#name` scope from migration 111 is still unresolved (`channel_scope_pending`, read from `legacy_channel_scope_tags`) has an empty scope, so it applies in every channel until the backfill or an admin narrows it.
4. **Corpus tag filtering**: When `memory_tagging_enabled` is enabled and `conversationCorpus` is provided, memories with tags are excluded unless at least one tag appears in the lowercased history text. A tag starting with `#` is an ordinary keyword.
5. **Formatting and emission**: Survived rows are formatted as `[id:${id}] ${content} (tags: ${tags})` using `formatMemoryWithId` and wrapped in a section header:
   - Guild channels: `## {botName}'s Memories about {serverName}`
   - Direct messages: `## {botName}'s Memories about this conversation with User`

The block is emitted as one `system`-role item tagged `KNOWLEDGE_SERVER_MEMORIES` after passing through `convertMentions`.

## Constraints and rationale

- **Stable memory IDs**: Prompt IDs map to `server_memory_id`, allowing `update_long_term_memory` to target a row for replacement or deletion. Empty replacement content requests deletion.
- **Independent filters**: Channel scope and conversation-corpus matching operate independently. A matching channel does not bypass the tag relevance check.
- **Scopes are IDs**: A stored scope survives channel renames. Document retrieval applies the same channel-or-parent rule in SQL (`retrieveRelevantDocumentChunks`). Data export leaves scopes out, so imported memories arrive unscoped.
- **Preset reassembly**: Tagged as `KNOWLEDGE_SERVER_MEMORIES`, which SillyTavern preset reassembly flushes at the first knowledge anchor.

## Source pointers

- `src/utils/text/context/memories.ts`: `buildServerMemoryContextItem`.
- `src/utils/db/repositories/ServerMemoryRepository.ts`: `loadServerMemoriesScoped`.
- `src/utils/memory/memoryId.ts`: `formatMemoryWithId`.
- `src/utils/text/context/mentionNormalizer.ts`: `convertMentions`.
- [Long-Term Memory Pipeline](/architecture/pipelines/memory/ltm/): Creation, modification, and deletion lifecycles.
