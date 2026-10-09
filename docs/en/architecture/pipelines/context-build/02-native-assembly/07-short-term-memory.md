---
title: "02.7: Short-Term Memory"
---

The short-term memory contributor retrieves recent conversation summaries and category blocks across server channels and emits cadence-gated tool nudges.

## Flow and ownership

The contributor `buildShortTermMemoryContext` in `src/utils/text/context/memories.ts` coordinates memory retrieval and prompt construction:

1. **Preconditions and gating**:
   - Requires a triggering user ID. Returns an empty result if absent.
   - When automatic short-term memory is disabled (`short_term_memory_enabled === false`), the bot suppresses the cadence nudge and the write tool. Existing memory content still renders so operators can curate memories manually.
2. **Channel memory retrieval**:
   - **Same-channel memory**: Retrieves the active running summary or category block for the current channel.
   - **Other-channel memories**: Retrieves up to three recent conversation summaries from other channels (`MAX_OTHER_CHANNEL_MEMORIES = 3`), sorted by update recency.
   - **Privacy filtering**: Excludes other-channel memories originating from private channels unless `stm_privacy_bypass` is active.
   - **Cross-server memory**: Folds in memories from other servers when the user has opted in via their personal settings.
3. **Render modes**:
   - `crude_summary` (default): Emits the summary or category block followed by recent raw messages.
   - `supersede`: When a summary or category block exists, raw messages for that channel are omitted.
4. **Unified cadence nudge (`nudgeItem`)**:
   - Emits a prompt hint instructing the model to invoke `{short_term_memory_tool}` after responding.
   - Gated by `turnsSinceRefresh >= refreshCadence` (default 5). The same counter and condition govern both initial creation and ongoing refresh.
   - Suppressed when the model lacks tools (`has_tools === false`), the provider is NovelAI, or an explicit long-term memory command is detected (`explicitLongTermMemoryIntent === true`).
   - Returned out-of-band alongside `nudgeInjectionDepth` (default 2, placing it before the latest user/bot turn pair).
5. **Content block injection depth (`memoryInjectionDepth`)**:
   - When configured to `-1` (default), `memoryItems` are pushed inline into `contextItems` near the top of the prompt.
   - When configured to a non-negative depth, `memoryItems` are withheld from `contextItems` and returned out-of-band as `memoryInjectionItems` for positional injection by the downstream chat pipeline.
   - **Freshness override**: When the same-channel entry is younger than 60 minutes (`STM_FRESH_WINDOW_MS`), the resolved depth is clamped to at most 2 (`STM_FRESH_INJECTION_DEPTH`). Once it ages past the window, placement reverts to the configured depth.

## Positional injection contract

Items returned out-of-band pass through native assembly and preset reassembly without being anchored to early system blocks. The chat pipeline's `appendTailDirectives` splices them relative to real dialogue turns:

1. `memoryInjectionItems` are spliced first at `memoryInjectionDepth`.
2. `nudgeItem` is spliced at `nudgeInjectionDepth`.

When both items share the same dialogue depth (the default configuration of 2 on fresh conversations), splicing the content block first guarantees that the nudge appears directly below the memory block.

## Constraints and rationale

- **Out-of-band delivery**: Preserving `nudgeItem` and deferred `memoryInjectionItems` outside `contextItems` ensures that preset reassembly does not pull recency-sensitive notes into the system prefix.
- **Explicit memory intent suppression**: When a user explicitly asks the bot to remember or store information permanently, the short-term memory nudge is suppressed so the model selects `create_long_term_memory` instead.
- **Fail-safe execution**: Any error during short-term memory assembly logs a warning and returns an empty list, preventing memory lookup failures from aborting the turn.

## Source pointers

- `src/utils/text/context/memories.ts`: `buildShortTermMemoryContext` and freshness calculations.
- `src/utils/cache/shortTermMemoryCache.ts`: in-process short-term memory cache.
- `src/utils/db/repositories/ShortTermMemoryRepository.ts`: durable database persistence.
- `src/utils/chat/contextPipeline.ts`: `appendTailDirectives` positional dialogue splicing.
- `src/utils/chat/contextAnnotations.ts`: `insertAtDialogueDepth`.
- [Short-Term Memory Pipeline](/architecture/pipelines/memory/stm/): Working memory capture, category upgrades, and cache lifecycles.
