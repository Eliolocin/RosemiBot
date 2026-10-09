---
title: "01: Preset Routing"
---

The routing stage determines whether the LLM prompt follows TomoriBot's native fixed-order layout or is rearranged through an active SillyTavern preset.

## Flow and ownership

The public `buildContext` wrapper in `src/utils/text/context/builder.ts` coordinates preset routing:

1. **Native execution**: `buildContextNative` runs first on every turn. Preset reassembly needs native structured context items to populate preset markers. When a preset is active but the server configures no custom `system_prompt`, `suppressDefaultSystemPrompt` is set so the preset's system blocks control the prompt.
2. **Preset check**: The wrapper queries `getCachedActivePreset(serverId)` using the guild's server ID. If no preset is active, or if the turn is a user impersonation, the native output is returned directly.
3. **Preset reassembly**: When a preset is active and the turn is not an impersonation, `reassembleWithPreset` in `src/utils/text/presetContextBuilder.ts` buckets native items by `metadataTag` and maps them into the preset's ordered nodes.
4. **Random macro resolution**: After either path completes, `resolveRandomChoiceMacrosInBuildOutput` rolls `{{random:a::b}}` and `{random::a::b}` choices across all context items, tail directives, and deferred short-term memory blocks.

## Constraints and rationale

- **Native build runs first**: Presets do not fetch or format database state independently. They rearrange structured items already tagged by the native pipeline (`SYSTEM_HUMANIZER_RULES`, `KNOWLEDGE_SERVER_INFO`, `DIALOGUE_HISTORY`, etc.).
- **Impersonation bypass**: User impersonation turns always bypass preset reassembly. This prevents third-party prompt templates from overriding the required imitation directive and framing.
- **Preserved out-of-band items**: Tail directives, uncensor directives, the unified short-term memory nudge (`nudgeItem`), and deferred memory blocks (`memoryInjectionItems`) pass through preset reassembly unchanged. Downstream chat pipeline stages own their dialogue-depth insertion, preventing preset anchors from misplacing recency-sensitive context.
- **Unmapped item preservation**: Preset reassembly flushes TomoriBot-specific knowledge items (server info, server memories, emojis, stickers, sprites) and dialogue-adjacent items (participants, short-term memory, conditioning, RAG documents) at configured anchor markers (`main`, `charDescription`, `charPersonality`, `dialogueExamples`, `chatHistory`). Any remaining unpulled items append at the end of the system block list so no native context is dropped.

## Source pointers

- `src/utils/text/context/builder.ts`: `buildContext` routing wrapper.
- `src/utils/text/presetContextBuilder.ts`: `reassembleWithPreset` node mapping and item bucketing.
- `src/utils/cache/stPresetCache.ts`: `getCachedActivePreset` cache lookup.
- `src/utils/text/context/templates.ts`: `resolveRandomChoiceMacrosInBuildOutput` macro expansion.
- [SillyTavern Preset System](/architecture/integrations/sillytavern/preset-system/): user-facing preset features and node types.
