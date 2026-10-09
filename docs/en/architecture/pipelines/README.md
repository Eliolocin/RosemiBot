---
title: "Pipelines"
sidebar:
  label: "Overview"
  groupLabel: "Pipelines"
  order: 20
---

Pipeline documentation explains linear runtime execution paths: what starts them, what each stage
receives, what each produces, and where side effects occur.

## Pipeline structure and relationships

TomoriBot organizes conversation turn handling into five interconnected pipelines:

```text
Incoming Message
       |
       v
[Chat Pipeline]
  1. Admission & Channel Lock
  2. Persona Turn Planning
  3. Per-Turn Execution
       |
       +---> [Context-Build Pipeline]
       |       - Persona & Server Metadata
       |       - Participant Profile Hydration
       |       - Dialogue History & Tail Directives
       |
       +---> Generation Turn: Model Fallback Chain & Key Rotation
       |       [Tool-Loop Pipeline]
       |       - Tool Call Validation & Dispatch
       |       - Enhanced Context Restarts
       |       - Memory Tool Writes
       |            |
       |            v
       |     [Provider Pipeline]
       |       - Native Request Serialization
       |       - Chunk Normalization & Reasoning
       |       - Markdown Buffer Management
       |       - Discord Stream Delivery
       |
       v
  4. Post-Turn Effects
       |
       +---> [Memory Pipeline]
               - Passive Short-Term Memory Capture
```

## Pipeline index

- [Chat Pipeline](/architecture/pipelines/chat/): Orchestrates Discord event ingress, message admission,
  channel queue locking, persona turn planning, and post-turn accounting.
- [Context-Build Pipeline](/architecture/pipelines/context-build/): Assembles ordered prompt items,
  evaluates SillyTavern preset routing, hydrates participant profiles, and prepares conversation
  history for model consumption.
- [Tool-Loop Pipeline](/architecture/pipelines/tool-loop/): Coordinates repeated model generation passes,
  tool call execution, argument validation, error suppression, and enhanced context restarts.
- [Provider Pipeline](/architecture/pipelines/provider/): Manages provider-specific streaming requests,
  SSE chunk parsing, reasoning block stripping, markdown segment buffering, and Discord message delivery.
- [Memory Pipeline](/architecture/pipelines/memory/): Connects passive capture of recent dialogue
  with tool-driven durable summaries and persona-lineage-scoped long-term memories.

## Execution handoffs

1. **Ingress to planning**: An admitted Discord message in the [Chat Pipeline](/architecture/pipelines/chat/)
   acquires a channel lock and plans persona turns.
2. **Planning to context assembly**: For each turn, the chat coordinator calls the
   [Context-Build Pipeline](/architecture/pipelines/context-build/) to assemble static system instructions,
   dynamic participant profiles, and recent dialogue history.
3. **Context to generation loop**: The turn coordinator invokes the
   [Tool-Loop Pipeline](/architecture/pipelines/tool-loop/), passing the prepared context closure.
4. **Generation to provider streaming**: The tool loop initiates streaming passes through the
   [Provider Pipeline](/architecture/pipelines/provider/), which negotiates wire protocols, extracts
   reasoning, flushes markdown buffers, and delivers text to Discord.
5. **Tool calls to execution**: Tool invocations emitted during provider streaming route back to the tool
   loop for execution. Tools may return direct responses or trigger enhanced context restarts.
6. **Generation to memory**: Memory tools write summaries or long-term facts during the tool loop.
   After generation settles, result-dependent post-turn effects record recent dialogue and advance
   memory cadence counters. The [Memory Pipeline](/architecture/pipelines/memory/) owns both write paths.
