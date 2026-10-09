---
title: "06: Per-Turn Loop"
sidebar:
  label: "Overview"
  groupLabel: "06: Per-Turn"
---

The per-turn loop executes inside `runWithChannelLock()`. It iterates through each planned persona turn,
building the LLM context, configuring the Discord response sink, executing provider generation, and
dispatching post-turn effects.

## Loop sequence

```ts
for (const turn of turnPlan.turns) {
  const context = await buildChatTurnContext(turn);              // 01
  const responseSink = createChatResponseSink(context);          // 02
  const result = await runGenerationTurn(context, responseSink); // 03
  await runPostTurnEffects(context, result);                     // 04
}
```

- **Iteration scope**: each iteration handles one persona's reply attempt. Because `planChatTurns()` places
  additional matching personas at the front of the channel queue, a single invocation typically processes
  one persona turn; subsequent personas execute as distinct replayed turns.
- **Shared closure**: stages 01 through 04 operate on the `ChatTurnContext` closure. Stage 01 constructs it,
  stage 02 attaches the response sink, stage 03 records attempt metadata, and stage 04 consumes the result.
- **Turn independence**: each iteration executes independently. Subsequent turns observe the Discord-visible
  messages sent by earlier turns through channel history rather than shared memory.

## Stage index

| # | Stage | Guide | Ownership |
|---|---|---|---|
| 01 | `buildChatTurnContext` | [06.1: Build Context](/architecture/pipelines/chat/06-per-turn/01-build-context/) | Fetches message history, applies annotations, and builds prompt items. |
| 02 | `createChatResponseSink` | [06.2: Response Sink](/architecture/pipelines/chat/06-per-turn/02-create-response-sink/) | Resolves webhook or channel delivery targets and lifecycle callbacks. |
| 03 | `runGenerationTurn` | [06.3: Generation Turn](/architecture/pipelines/chat/06-per-turn/03-run-generation-turn/) | Drives model fallback attempts, key rotation, and superseded message deletion. |
| 04 | `runPostTurnEffects` | [06.4: Post-Turn Effects](/architecture/pipelines/chat/06-per-turn/04-post-turn-effects/) | Dispatches empty retries, quota deduction, STM caching, thought logs, and boomerangs. |

## Cross-references

- [Context-Build Pipeline](/architecture/pipelines/context-build/): prompt composition, RAG, and memory hydration.
- [Tool-Loop Pipeline](/architecture/pipelines/tool-loop/): function calling, iteration limits, and tool execution.
- [Provider Pipeline](/architecture/pipelines/provider/): streaming HTTP connections, token limits, and Discord delivery.
- [Memory Pipeline](/architecture/pipelines/memory/): short-term memory caching and storage.
