---
title: "NovelAI Provider Limitations"
---

NovelAI models operate under text-only constraints and tight token budgets. This document describes
the capability gates, excluded context items, and suppressed tools applied when routing turns to
NovelAI.

## Capability profile

NovelAI text generation does not accept image or video input. `providerInfo.ts` advertises
prompt-based function calling; the selected model's `has_tools` capability and runtime tool gate
determine whether calls are actually offered. GLM uses the XML parser described in
[Tool Calling](/architecture/integrations/novelai/tool-calling/).

`process_gif` requires vision in the active text model. `peek_profile_picture` can instead use a
separately configured vision model, so text-only NovelAI does not universally exclude that tool.

## Token budget and tool exclusions

NovelAI enforces strict context limits. For GLM 4.6, system instructions exceeding roughly 2,800
tokens degrade response coherence. Several tools and features are excluded to preserve prompt
budget:

| Feature | Location | Rationale |
|---|---|---|
| `select_sticker_for_response` | `src/tools/functionCalls/stickerTool.ts` | Token-level instability in GLM 4.6 causes corrupted Japanese and CJK sticker names in tool arguments. |
| `update_short_term_memory` | `src/tools/functionCalls/updateShortTermMemoryTool.ts` | Schema and invocation definitions consume prompt budget. The memory summary text remains in context, but the update tool is withheld. |
| `cross_channel_message` | `src/tools/functionCalls/crossChannelMessageTool.ts` | Tool definition and execution overhead exceed token budgets. |
| `fetch_url` | `src/tools/fetchUrl/fetchUrlTool.ts` | Arbitrary web page content can flood prompt limits. |

### Short-term memory instruction suppression

`buildShortTermMemoryContext` in `src/utils/text/context/memories.ts` suppresses the accompanying
STM tool-usage directives. The system omits both the
`[System: Use the update_short_term_memory tool...]` hint and idle-conversation nudges when the
active provider is NovelAI. The conversation summary itself stays in context.

## Context block exclusions

Provider stream adapters specify which `ContextItemTag` blocks enter the system instructions.
In `src/providers/novelai/novelaiStreamAdapter.ts`, `SYSTEM_INSTRUCTION_TAGS_TOOLING` excludes two
knowledge blocks included by other providers:

- `KNOWLEDGE_SERVER_EMOJIS`: custom server emoji listings.
- `KNOWLEDGE_SERVER_STICKERS`: custom server sticker listings.

Omitting these inventories saves hundreds of tokens. While output formatting allows Unicode emojis,
the model receives no server emoji lists to reference.

## Tool parameter relaxation

GLM 4.6 frequently omits optional or defaulted tool parameters when generating XML function calls.
In `src/tools/functionCalls/reminderTool.ts`, the parameter `repetition_interval_hours` is relaxed
specifically for NovelAI:

When NovelAI omits this argument, the reminder tool defaults it to `0` (one-off reminder). For
other providers, the parameter is required to ensure explicit scheduling intent.

## Source pointers

- `src/providers/novelai/novelaiProvider.ts`: Provider capability declarations and stream
  dispatch.
- `src/providers/novelai/novelaiStreamAdapter.ts`: System instruction tag filtering and prompt-based
  tool parsing.
- `src/providers/novelai/novelaiToolAdapter.ts`: Tool conversion and MCP function filtering.
- `src/tools/functionCalls/stickerTool.ts`: Sticker selection availability check.
- `src/tools/functionCalls/updateShortTermMemoryTool.ts`: Short-term memory tool availability check.
- `src/tools/functionCalls/crossChannelMessageTool.ts`: Cross-channel message availability check.
- `src/tools/fetchUrl/fetchUrlTool.ts`: URL fetch tool availability check.
- `src/tools/functionCalls/reminderTool.ts`: Reminder argument relaxation logic.
