---
title: "02.3: Server Memories"
---

Server memories provide persona-scoped long-term memories stored for the active server or direct message channel.

## Flow and ownership

The contributor `buildServerMemoryContextItem` in `src/utils/text/context/memories.ts` loads and formats memories for the current persona lineage:

1. **Precondition check**: Returns `null` if `tomoriState.server_memories` is empty or undefined. In `nativeBuilder.ts`, the contributor is skipped entirely during user impersonation.
2. **Database retrieval**: Queries `serverMemoryRepository.loadServerMemoriesScoped(serverId, personaLineageId)` for all active memories scoped to the server and persona lineage. If loading fails or scoping IDs are missing, it falls back to the in-memory `tomoriState.server_memories` array.
3. **Channel tag filtering**: When `channelMemoryEnabled` is enabled, any memory carrying channel tags (tags starting with `#`) is filtered out unless one of the tags matches `#${channelName}`.
4. **Corpus tag filtering**: When `memory_tagging_enabled` is enabled and `conversationCorpus` is provided, memories with content tags are excluded unless at least one content tag appears in the lowercased history text.
5. **Formatting and emission**: Survived rows are formatted as `[id:${id}] ${content} (tags: ${tags})` using `formatMemoryWithId` and wrapped in a section header:
   - Guild channels: `## {botName}'s Memories about {serverName}`
   - Direct messages: `## {botName}'s Memories about this conversation with User`

The block is emitted as one `system`-role item tagged `KNOWLEDGE_SERVER_MEMORIES` after passing through `convertMentions`.

## Constraints and rationale

- **Stable memory IDs**: Prompt IDs map to `server_memory_id`, allowing `update_long_term_memory` to target a row for replacement or deletion. Empty replacement content requests deletion.
- **Dual tag filtering**: Channel matching and conversation-corpus matching operate independently. A matching channel tag does not bypass the content tag relevance check.
- **Preset reassembly**: Tagged as `KNOWLEDGE_SERVER_MEMORIES`, which SillyTavern preset reassembly flushes at the first knowledge anchor.

## Source pointers

- `src/utils/text/context/memories.ts`: `buildServerMemoryContextItem`.
- `src/utils/db/repositories/ServerMemoryRepository.ts`: `loadServerMemoriesScoped`.
- `src/utils/memory/memoryId.ts`: `formatMemoryWithId`.
- `src/utils/text/context/mentionNormalizer.ts`: `convertMentions`.
- [Long-Term Memory Pipeline](/architecture/pipelines/memory/ltm/): Creation, modification, and deletion lifecycles.
