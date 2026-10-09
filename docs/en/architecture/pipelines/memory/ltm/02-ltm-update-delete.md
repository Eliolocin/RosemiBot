---
title: "LTM 02: Memory Update & Delete"
---

The memory update and delete stage handles model-initiated modifications or removals of existing persistent memories using the integer identifier shown in prompt context.

## Flow and ownership

When the model detects an outdated, inaccurate, or redundant memory, it invokes `update_long_term_memory` managed by `UpdateLongTermMemoryTool` in `src/tools/functionCalls/updateLongTermMemoryTool.ts`.

The tool distinguishes between updates and deletions based on the provided content:

- **Update:** `memory_content` provides replacement text. The tool sanitizes braces using `sanitizeUnknownTemplatePlaceholders()` and validates length via `validateMemoryContent()`.
- **Deletion:** `memory_content` is empty or whitespace-only after sanitization.

### Scope determination and resolution

Target scope depends on the presence of the `target_user` argument:

- **Server scope:** when `target_user` is absent, the tool updates or deletes records in the `server_memories` table scoped to `(server_id, persona_lineage_id)`.
- **Personal scope:** when `target_user` is provided, `resolveUserTarget()` (`src/utils/discord/targetResolver.ts`) matches the display name.
  - Bridge users reject personal updates with an error because bridge users only support server-wide memories.
  - Personal updates targeting the bot itself return an error.
  - The resolved user must belong to the current guild or direct message channel.
  - For updates, if the target user has `PrivacyLevel.PARTIAL` or `PrivacyLevel.FULL`, the update halts with a privacy error. Deletions remain permitted.

### Database operations and notifications

Following parameter and scope checks, execution routes to the matching repository:

1. **Database execution:**
   - Server update: `serverMemoryRepository.updateByIdWithLineage()` updates content in `server_memories`.
   - Server deletion: `serverMemoryRepository.removeByIdWithLineage()` removes the row and returns its prior content.
   - Personal update: `personalMemoryRepository.updateByIdForUserAndLineage()` updates content in `personal_memories`.
   - Personal deletion: `personalMemoryRepository.removeByIdForUserAndLineage()` removes the row and returns its prior content.
2. **Cache invalidation:**
   - Server operations call `invalidateTomoriStateCache(serverDiscId)` immediately after successful database execution.
   - Personal operations call `invalidateUserCache(targetUserId)` immediately after successful database execution.
3. **Discord embed confirmation:**
   - Updates dispatch an amber notice embed using `sendMemoryEmbedWithExpand()`.
   - Deletions dispatch a red notice embed displaying the deleted memory content for user confirmation.

The tool returns a successful `ToolResult` detailing the outcome.

## Constraints and rationale

- **Lineage protection:** all repository updates and deletes enforce `persona_lineage_id` matching, preventing one character persona from mutating or deleting memories belonging to another.
- **Accidental deletion transparency:** deletion operations fetch the memory text prior to row removal, allowing the confirmation notice to display the exact content that was removed.
- **Cache freshness guarantee:** cache invalidation occurs immediately after database success, so subsequent context builds reload fresh records directly from the database.

## Source pointers

- `src/tools/functionCalls/updateLongTermMemoryTool.ts`: `UpdateLongTermMemoryTool` parameter handling, scope routing, and execution flow.
- `src/utils/db/repositories/ServerMemoryRepository.ts`: queries for updating and removing server memories with lineage checks.
- `src/utils/db/repositories/PersonalMemoryRepository.ts`: queries for updating and removing personal memories with lineage checks.
- `src/utils/cache/tomoriStateCache.ts` and `src/utils/cache/userCache.ts`: cache invalidation functions.
