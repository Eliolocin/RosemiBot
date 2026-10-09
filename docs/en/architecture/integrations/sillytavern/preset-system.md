---
title: "SillyTavern Preset System"
---

SillyTavern presets are JSON configurations that control prompt node ordering, custom prompt
injections, depth-based chat insertions, and template macros. They alter how context blocks are
assembled without modifying underlying persona or server data.

## Flow and ownership

Context assembly under a SillyTavern preset uses a build-then-rearrange strategy coordinated across
three layers:

1. `src/utils/text/context/builder.ts`: checks for an active preset, builds native context, and
   passes it to preset reassembly. `contextBuilder.ts` exposes this entry point.
2. `src/utils/text/presetContextBuilder.ts`: decomposes native context blocks into tagged buckets and
   rebuilds the prompt according to the preset's declared node sequence.
3. `src/utils/text/stPresetEngine.ts`: expands variables and content macros. Reassembly then uses
   `toolPromptMacroResolver` for capability and tool conditionals, followed by mention conversion.

```
buildContext (contextBuilder.ts)
  │
  ├─► User Impersonation Active? ──► Native Context Assembly (presets bypassed)
  │
  └─► Active Preset Found in Cache (stPresetCache.ts)
        │
        ▼
buildContextNative (context/nativeBuilder.ts)
  │  Produces tagged blocks for reassembleWithPreset (presetContextBuilder.ts)
  │
  ├─► stPresetEngine.ts ───────────► Two-pass macro evaluation on custom preset nodes
  │                                  (Pass 1: variables; Pass 2: content expansion)
  │
  ├─► Node Ordering Walk ──────────► Pulls tagged blocks at marker nodes (main, charDescription...)
  │                                  Inserts custom nodes at declared sequence positions
  │
  ├─► Automatic Flushing ──────────► Injects TomoriBot-only blocks (memories, emojis, STM)
  │
  └─► Depth Injection Merging ─────► Folds depth-injected nodes into existing history turns
        │
        ▼
Final Assembled Context to Provider Adapter
```

### Build-then-rearrange strategy

The routing wrapper invokes `buildContextNative()` to produce candidate context items labeled with
`metadataTag`, then passes them to `reassembleWithPreset()`.
Items are partitioned into consumable tag buckets. The preset builder walks the active preset's
`node_order`, consuming items from matching buckets at marker nodes and inserting custom text
nodes at their declared positions.

### Marker-to-tag mapping

Preset marker nodes pull items from specific native context buckets:

| Marker identifier | ContextItemTag | Native block |
|---|---|---|
| `main` | `SYSTEM_HUMANIZER_RULES`, `SYSTEM_CHANNEL_PROMPT` | System prompt and channel prompt overrides |
| `charDescription` | `SYSTEM_PERSONA_PROMPT` | Persona prompt |
| `charPersonality` | `SYSTEM_PERSONALITY` | Personality attributes |
| `dialogueExamples` | `DIALOGUE_SAMPLE` | Sample dialogue turns |
| `chatHistory` | `DIALOGUE_HISTORY` | Live conversation history |
| `worldInfoBefore`, `worldInfoAfter` | `KNOWLEDGE_SERVER_DOCUMENTS` | RAG document chunks |

Marker blocks move according to the preset layout. Specific native blocks are suppressed only when
explicitly replaced:

- The default fallback system prompt is omitted if a preset is active and no server-level system
  prompt is configured.
- The native `charDescription` block is skipped if a custom preset node expands the `{{description}}`
  macro.
- The native `charPersonality` block is skipped if a custom preset node expands the `{{personality}}`
  macro.

### TomoriBot-only block flushing

Context items that lack SillyTavern marker equivalents (server information, server memories, custom
emojis, stickers, active participants, short-term memories, and conditioning guidance) flush
automatically at anchor markers:

- Server information, memories, emojis, and stickers flush after `charPersonality`,
  `charDescription`, or `main`.
- Active users, short-term memory, and conditioning flush before `dialogueExamples` or `chatHistory`.
- After the node walk, reassembly flushes any unconsumed knowledge and participant groups, then
  appends remaining buckets. Omitting markers does not guarantee that these groups precede history.

## Depth injection contracts

Nodes configured with `injection_position: 1` target positions counting backwards from the end of the
conversation log:

- Depth 0 targets the final message in history (closest to the model's turn).
- Depth 1 targets the second-to-last message.
- Depth N targets the (N + 1)th history message from the end, clamped to the earliest history
  message when out of range. Injections are omitted when no history item exists.

### In-place message merging

To prevent role-alternation errors on strict providers such as Google Gemini and Anthropic, depth
injections merge directly into existing conversation turns as `[System: ...]` text parts. They do not
create standalone messages.

### Same-depth batching

All injections targeting the same depth index combine into a single `[System: ...]` container
ordered by `injection_order`. This avoids redundant wrapper prefixes and conserves prompt tokens.

## Template macro engine

The template engine in `src/utils/text/stPresetEngine.ts` processes custom preset nodes in two
sequential passes:

### Pass 1: Variable collection

The engine scans all enabled non-marker nodes in `node_order`, populating a session variable map:

- `{{setvar::key::value}}`: stores or overwrites the variable key.
- `{{addvar::key::value}}`: appends value content to an existing key.

### Pass 2: Expansion and evaluation

The second pass removes declarations and comments, resolves variable lookups and content macros,
and evaluates random choices, dice rolls, and trimming. Missing variables and the scenario macro
resolve to empty text. Expanding persona description or personality suppresses the corresponding
native marker so the prompt does not repeat those instructions.

Reassembly then evaluates `{{if capability:...}}` and `{{if tool:...}}` conditionals through the
shared tool macro resolver using current capabilities and tool availability. This keeps native and
preset instructions consistent with the same turn policy.

Identity placeholders (`{{user}}`, `{{char}}`, `{{bot}}`) are preserved through template engine
passes. They are resolved downstream by `convertMentions` in context assembly.

## Caching and database persistence

Active presets are cached in memory via `src/utils/cache/stPresetCache.ts` using the numeric
`server_id` as the cache key:

- **Cache TTL:** 10 minutes (`CACHE_DURATION_MS`).
- **Invalidation:** Evicted immediately upon preset activation, deactivation, node toggling, or
  preset deletion. Preset mutation methods in `PresetRepository.ts` invalidate the preset cache after
  successful writes; domain operations also refresh assembled persona state.
- **Negative caching:** Missing presets cache as `null` to prevent repeated database queries on
  servers operating under native context assembly.

Preset records persist across two relational tables:

- `st_presets`: stores unique preset names per server, raw JSON payloads, and active status flags.
- `st_preset_nodes`: stores individual prompt nodes, structural markers, user toggles, ordering
  indices, and injection depth coordinates.

## Parity and operational boundaries

TomoriBot adapts SillyTavern presets to its architecture:

- **Single-character focus:** Contexts model one active persona per turn. Multi-character group RP
  macros (`{{group}}`) are unsupported.
- **Dynamic knowledge retrieval:** Markers `worldInfoBefore` and `worldInfoAfter` pull dynamic RAG
  document chunks. Static lorebook keyword activations are not evaluated.
- **Regex post-processing:** SillyTavern output regex scripts are unsupported; provider responses
  stream directly to Discord without regex transforms.
- **HTML tags:** Discord does not render HTML markup. Preset nodes containing HTML tags raise a
  `hasHtmlWarning` flag during diagnostics but are not stripped.
- **Assistant prefill:** Custom assistant nodes become model-role context items and remain subject to
  provider request normalization. Terminal sample dialogue blocks receive a user-side separator.
  Explicit assistant prefill follows the separate [strict completion policy](/architecture/subsystems/strict-chat-completion/); arbitrary preset nodes are not automatically valid prefills.

## Source pointers

- `src/utils/text/presetContextBuilder.ts`: Build-then-rearrange orchestration, tag bucket
  consumption, and depth injection merging.
- `src/utils/text/stPresetEngine.ts`: `resolvePresetMacros` for variables and content expansion.
- `src/utils/tools/toolPromptMacros.ts`: capability and tool conditionals.
- `src/utils/db/repositories/PresetRepository.ts`: preset persistence and post-write invalidation.
- `src/utils/stPreset/stPresetOperations.ts`: Domain operations and database mutations.
- `src/utils/stPreset/stPresetImportParser.ts`: SillyTavern JSON validation and node extraction.
- `src/utils/cache/stPresetCache.ts`: In-memory preset caching and cache invalidation.
- `src/utils/text/contextBuilder.ts`: Context pipeline entry point and native bucket generation.
