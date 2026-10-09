---
title: "LTM 01: Memory Creation"
---

The memory creation stage handles model-initiated persistence of new facts, preferences, or instructions into the database.

## Flow and ownership

When the model identifies information worth preserving across conversations, it invokes `create_long_term_memory` managed by `MemoryTool` in `src/tools/functionCalls/memoryTool.ts`.

Execution proceeds through several validation and routing steps:

1. **Parameter validation:** checks that `memory_content` is a non-empty string, that `memory_scope` is either `server_wide` or `target_user`, and that `self_teaching_enabled` is active in `TomoriState.config`.
2. **Target user resolution:** for `target_user` scope, `resolveUserTarget()` (`src/utils/discord/targetResolver.ts`) matches the requested name against known users and guild members.
   - Ambiguous matches or missing users return an error result to the model.
   - If the target resolves to the bot itself, scope falls back to `server_wide`.
   - If the target is a Matrix bridge user, `{user}` is replaced with the bridge user's display name and scope falls back to `server_wide` because bridge accounts lack internal user records.
3. **Content sanitization and limits:** `sanitizeUnknownTemplatePlaceholders()` strips unrecognized brace tokens while retaining `{user}` and `{bot}`. `validateMemoryContent()` verifies length against `MAX_MEMORY_LENGTH` (default 1000 characters).
4. **Privacy enforcement:** for personal scope, `userRepository.getPrivacyLevel()` inspects the target user. If the user configured `PrivacyLevel.PARTIAL` or `PrivacyLevel.FULL`, creation halts with a privacy restriction notice.
5. **Lineage and capacity guards:** persona lineage ID 0 is rejected because zero is reserved for global memories. Memory capacity is verified against `MAX_SERVER_MEMORIES` (100) or `MAX_PERSONAL_MEMORIES` (100) per persona lineage via repository limit checks.
6. **Database persistence:**
   - Server memories insert into the `server_memories` table via `serverMemoryRepository.add()`.
   - Personal memories insert into the `personal_memories` table via `personalMemoryRepository.add()`.
7. **User notification and cache invalidation:**
   - For server memories: posts a Discord notification embed using `sendMemoryEmbedWithExpand()` and invalidates cached guild state via `invalidateTomoriStateCache(serverId)`.
   - For personal memories: invalidates the user cache via `invalidateUserCache(targetUserId)` before dispatching the Discord notification embed. Invalidating before message delivery keeps the cache fresh even if Discord message dispatch encounters a permissions error.

The tool then returns a successful `ToolResult` containing the generated memory ID.

## Constraints and rationale

- **Lineage isolation:** records are partitioned by `persona_lineage_id`. Personas sharing a character lineage share memories, while distinct character lineages remain isolated.
- **Cache invalidation ordering:** Personal creation invalidates before notification. Server creation currently waits for notification before invalidating, so a failed Discord send can leave cached state stale despite a durable write. Neither path invalidates before database success.
- **Capacity controls:** limits defined in `src/utils/misc/memoryLimits.ts` prevent database bloat and control token consumption during prompt construction.

## Source pointers

- `src/tools/functionCalls/memoryTool.ts`: `MemoryTool` parameter validation, scope resolution, and execution flow.
- `src/utils/discord/targetResolver.ts`: user name matching and bridge fallback handling.
- `src/utils/db/repositories/ServerMemoryRepository.ts`: queries and limit verification for server memories.
- `src/utils/db/repositories/PersonalMemoryRepository.ts`: queries and limit verification for personal memories.
- `src/utils/cache/tomoriStateCache.ts` and `src/utils/cache/userCache.ts`: cache invalidation functions.
