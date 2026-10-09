---
title: "03: Enhanced Context Restart"
---

`handleEnhancedContextRestart` intercepts `context_restart_*` payloads from successful tool results.
Instead of recording a standard tool-history entry, it mutates the turn's live context items and
streaming flags in place, signaling the loop to restart generation with an enriched context window.

## The restart protocol and payload transports
<!-- anchor: restart-protocol-and-payload-transports -->

When a tool completes successfully, `executeToolCall` passes `toolResult.data` to
`handleEnhancedContextRestart`. If `data.type` begins with `"context_restart_"`, the stage applies
the requested mutations and returns `true`.

Tools deliver enrichment payloads through one of two transports:

1. **Inline payload (`enhanced_context_item`):**
   Lightweight items such as YouTube video links, web page summaries, or directive notes travel
   directly inside the tool result object.

2. **Stashed payload (`pending_context_key`):**
   Bulk media items such as profile picture image buffers (`peek_profile_picture`) or GIF keyframes
   (`process_gif`) use the side-channel stash in `src/utils/chat/pendingEnhancedContext.ts`. The tool
   stashes the item via `stashEnhancedContextItem` and returns only a UUID key. During restart,
   `resolveEnhancedContextItem` drains the item using `takeEnhancedContextItem`.
   The stash bounds memory: `ToolRegistry` retains the last 1000 tool execution results for diagnostic
   inspection, so placing multi-megabyte media payloads directly in `ToolResult.data` would hold them
   in memory indefinitely. The stash enforces a 5-minute TTL and a 16-entry ceiling.

## Context mutations and disable flags
<!-- anchor: context-mutations-and-disable-flags -->

Mutations depend on the restart type suffix:

- **Message metadata reveal (`message_metadata`):**
  The stage calls `annotateRecentMessageMetadataInContext` to enrich recent dialogue messages with
  author identity, timestamps, and message reference IDs. It appends a tail directive message via
  `buildTailDirectiveMessage` instructing the model not to call `reveal_message_metadata` again during
  this turn. It then sets `streamingContext.disableMessageMetadataContext = true`.
- **Media enrichment (`youtube`, `image`, `gif`):**
  The resolved `enhanced_context_item` is appended to `params.context.contextItems`. The stage sets
  the corresponding disable flag on `streamingContext`:
  - `disableYouTubeProcessing = true`
  - `disableProfilePictureProcessing = true`
  - `disableGifProcessing = true`
  Tool availability and execution checks consume these flags to refuse repeated enrichment in the
  current turn. A new turn initializes fresh flags.

## Flow control and loop restart
<!-- anchor: flow-control-and-loop-restart -->

When `handleEnhancedContextRestart` returns `true`:

1. `executeToolCall` returns `{ kind: "restart" }`.
2. `runToolLoop` resets `consecutiveToolErrors` and `naiConsecutiveToolFailures` to 0.
3. The tool call is omitted from `functionHistory`. The model never sees the tool invocation or response
   as a conversational exchange; it sees only the enriched context injected into `contextItems`.
4. The loop issues a `continue` statement, advancing the iteration counter and calling `streamOnce`
   with the updated context.

## Constraints and invariants
<!-- anchor: constraints-and-invariants -->

- **Single drain:** Calling `takeEnhancedContextItem` deletes the stashed item upon retrieval, so
  stale media cannot be replayed on subsequent restarts.
- **Resilient resolution:** If a `pending_context_key` cannot be resolved (for example, if expired by
  TTL), a warning is logged and the turn proceeds without the media item rather than failing the turn.
- **Prompt integrity:** Because system prompts are compiled at context-build time, tool prompt macros
  cannot dynamically rewrite the compiled prompt after execution. The metadata tail directive
  discourages repeat calls; live tool availability and execution guards enforce the disable flags.

## Source pointers
<!-- anchor: source-pointers -->

- `src/utils/chat/toolLoop.ts`: `handleEnhancedContextRestart`, `resolveEnhancedContextItem`.
- `src/utils/chat/pendingEnhancedContext.ts`: `stashEnhancedContextItem`, `takeEnhancedContextItem`.
- `src/utils/chat/contextAnnotations.ts`: `annotateRecentMessageMetadataInContext`, `buildRevealedMessageMetadataTailDirective`, `buildTailDirectiveMessage`.
- `src/types/misc/context.ts`: `StructuredContextItem`.
