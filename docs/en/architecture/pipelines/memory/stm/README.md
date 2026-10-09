---
title: "STM Sub-Pipeline"
sidebar:
  label: "Overview"
  groupLabel: "STM"
  order: 510
---

The short-term memory (STM) sub-pipeline maintains working memory across recent conversation turns. It stores recent dialogue in an in-process cache and records model-generated summaries and structured categories in the database.

The sub-pipeline provides two write paths:

| Stage | Trigger | Written state | Persistence |
|---|---|---|---|
| [01: Passive Capture](/architecture/pipelines/memory/stm/01-passive-capture/) | Post-turn, generation finished | Recent dialogue turns up to `MAX_MESSAGES_PER_CHANNEL` | In-process cache only; ensures scope identity row in database |
| [02: Summary Upgrade](/architecture/pipelines/memory/stm/02-summary-upgrade/) | Tool loop, `update_short_term_memory` call | Distilled summary text or structured category key-value pairs | In-process cache and durable `short_term_memories` table |

## Key design facts

- **Hybrid persistence:** crude messages exist only in the in-process cache, while summaries, categories, and cadence state are stored in the `short_term_memories` table. Following a process restart, durable entries are hydrated with an empty crude message list, and message history repopulates as turns occur.
- **Dual-key scoping:** writes index into both user-scoped (`shortterm:user:userId:channelId[:personaId]`) and server-scoped (`shortterm:server:serverId:channelId[:personaId]`) keys. Direct message sessions create only the user-scoped entry.
- **Summary priority:** same-channel context favors categories or summary text. Other-channel context can include raw messages alongside distilled content according to render mode. Passive capture preserves existing summaries.
- **Single upgrade per turn:** `streamingContext.disableShortTermMemoryUpdate` is set to `true` after the first successful upgrade, preventing the model from invoking `update_short_term_memory` multiple times in one tool loop.
- **Deletion ownership:** channel resets through `/refresh` call `clearShortTermMemoryForChannel()`, and user memory purges call `clearShortTermMemoryForUser()`. Both helpers evict the in-memory cache and delete rows from the `short_term_memories` table in the background.

## Cross-references

- **Intent detection gate:** [Memory Pipeline](/architecture/pipelines/memory/) explains how explicit memory intent suppresses the STM upgrade tool.
- **Context assembly consumer:** [Short-Term Memory Context](/architecture/pipelines/context-build/02-native-assembly/07-short-term-memory/) formats cached messages and summaries for prompt injection.
- **Tool-loop caller:** [Execute Tool Call](/architecture/pipelines/tool-loop/02-execute-tool-call/) dispatches tool invocations that trigger summary upgrades.
- **Post-turn effects caller:** [Run Generation Turn: Post-Turn Effects](/architecture/pipelines/chat/06-per-turn/04-post-turn-effects/) triggers passive turn capture.
