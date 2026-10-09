---
title: "LTM Sub-Pipeline"
sidebar:
  label: "Overview"
  groupLabel: "LTM"
  order: 520
---

The long-term memory (LTM) sub-pipeline manages durable facts and preferences learned by the model. It handles database persistence and cache invalidation initiated by tool calls during generation.

The sub-pipeline provides two operational stages:

| Stage | Tool name | Operation | Storage target |
|---|---|---|---|
| [01: Memory Creation](/architecture/pipelines/memory/ltm/01-ltm-create/) | `create_long_term_memory` | Inserts a new server or personal memory record | `server_memories` or `personal_memories` |
| [02: Memory Update & Delete](/architecture/pipelines/memory/ltm/02-ltm-update-delete/) | `update_long_term_memory` | Updates or deletes an existing memory by its integer ID | `server_memories` or `personal_memories` |

## Key design facts

- **Feature flag requirement:** both tools require `self_teaching_enabled = true` in `TomoriState.config`. When disabled, the tool returns a failure result and halts without altering database records.
- **Persona lineage scoping:** Server memories use server ID plus lineage; personal memories use user ID plus lineage and follow the user across servers. Persona lineage ID 0 is reserved for global memories and rejected for self-taught records.
- **Dual scope partitioning:** memories are classified as either `server_wide` (stored in `server_memories`, keyed by `server_id` and `persona_lineage_id`) or `target_user` (stored in `personal_memories`, keyed by internal `user_id` and `persona_lineage_id`).
- **Cache invalidation ownership:** Memory tools invalidate Tomori state or user caches after writes. The [creation stage](/architecture/pipelines/memory/ltm/01-ltm-create/) explains the server-notification ordering limitation.
- **Template placeholders:** content uses `{user}` and `{bot}` tokens instead of hardcoded names. `sanitizeUnknownTemplatePlaceholders()` strips unrecognized brace tokens before saving to storage.

## Cross-references

- **Intent detection gate:** [Memory Pipeline](/architecture/pipelines/memory/) describes how explicit memory intent prioritizes LTM tools.
- **Tool-loop caller:** [Execute Tool Call](/architecture/pipelines/tool-loop/02-execute-tool-call/) runs tool dispatches for memory modifications.
- **Server memory reader:** [Server Memories Context](/architecture/pipelines/context-build/02-native-assembly/03-server-memories/) formats server-wide memories for prompt injection.
- **Personal memory reader:** [Participants Context](/architecture/pipelines/context-build/02-native-assembly/06-participants/) hydrates personal memories for each participant.
- **Memory formatting:** `src/utils/memory/memoryId.ts` formats memories with their visible `ID:N` prefixes in prompt context.
