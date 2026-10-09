---
title: "Chat Pipeline"
sidebar:
  label: "Overview"
  groupLabel: "Chat"
  order: 100
---

The chat pipeline turns a single Discord `messageCreate` event into zero, one, or many persona replies.
It is the primary coordinator of TomoriBot: context construction, tool execution, provider streaming,
and memory persistence are all reached through this pipeline.

- **Entry point**: `tomoriChat()` in `src/events/messageCreate/tomoriChat.ts`
- **Triggered by**: Discord `messageCreate` events, empty-response retries, queue replays, stop-response
  generation, cross-channel boomerang follow-ups, and command invocations.

## Stage flow

```
tomoriChat(TomoriChatInput)
  │
  ▼
[01] normalizeChatInvocation                  → ChatIncoming
  │
  ▼
[02] evaluateChatAdmission                    → ChatAdmission
  │                                              (run | ignore | queued | blocked | error)
  │   disposition === "run"?
  │       no  ─────────────────────────────→ [03] handleChatDisposition → end
  │       yes
  ▼
[04] runWithChannelLock {                     ← concurrency wrapper
  │
  ▼
[05] planChatTurns                            → ChatTurnPlan { turns: ChatTurn[] }
  │
  │   turns.length === 0? ────────────────→ release lock, replay queue, end
  │   else: for each turn:
  │     │
  │     ▼
  │   [06-per-turn]
  │     ├─ [01] buildChatTurnContext         → ChatTurnContext
  │     ├─ [02] createChatResponseSink       → ChatResponseSink
  │     ├─ [03] runGenerationTurn            → GenerationTurnResult
  │     └─ [04] runPostTurnEffects
  │
} ← lock released, queued messages replayed
```

## Stage index

| # | Stage | Guide | Ownership |
|---|---|---|---|
| 01 | `normalizeChatInvocation` | [01: Input Normalization](/architecture/pipelines/chat/01-normalize-invocation/) | Sets defaults for optional input parameters. |
| 02 | `evaluateChatAdmission` | [02: Admission Check](/architecture/pipelines/chat/02-evaluate-admission/) | Filters suppressed messages, checks permissions, and gates queue entry. |
| 03 | `handleChatDisposition` | [03: Chat Disposition](/architecture/pipelines/chat/03-handle-disposition/) | Emits terminal logging and notifies caller of rejected or non-run outcomes. |
| 04 | `runWithChannelLock` | [04: Channel Lock](/architecture/pipelines/chat/04-channel-lock/) | Enforces channel mutex, keeps typing active, and replays queued turns. |
| 05 | `planChatTurns` | [05: Turn Planning](/architecture/pipelines/chat/05-plan-turns/) | Evaluates triggers and quotas, selects personas, and queues multi-persona turns. |
| 06 | Per-turn loop | [06: Per-Turn Loop](/architecture/pipelines/chat/06-per-turn/) | Runs context build, response sink setup, generation, and post-turn effects. |

## Cross-references

- [Context-Build Pipeline](/architecture/pipelines/context-build/): prompt assembly and dialogue hydration.
- [Tool-Loop Pipeline](/architecture/pipelines/tool-loop/): iterative model calls and tool execution.
- [Provider Pipeline](/architecture/pipelines/provider/): provider streaming, chunk normalization, and Discord delivery.
- [Memory Pipeline](/architecture/pipelines/memory/): passive short-term memory capture and retrieval.

## Concurrency and re-entrancy

- **Per-channel serialization**: `runWithChannelLock` permits exactly one active turn sequence per channel at a time.
- **Queueing and interruption**: messages arriving while a channel is busy are either enqueued for FIFO replay
  after lock release, converted to a follow-up interrupt if eligible, converted to a natural stop request,
  or ignored.
- **Re-entrant invocations**:
  - Empty-response retries bypass the channel lock using `skipLock=true` to reuse the existing turn lock.
  - Natural stop responses execute through `handleStopResponse` via `setImmediate` after outer lock release.
  - Cross-channel boomerang turns execute through `suppressNextSelfReply` via `setImmediate` after lock release.

## Troubleshooting files

The `/troubleshoot chat` command produces a private JSON diagnostic file for a user's recent message in the
current channel. It inspects in-memory traces recorded by `diagnosticTimeline.ts` across the past hour.

The diagnostic file records UTC timestamps, relative millisecond offsets, admission results, planned persona
turns, context message counts, attempt model labels, tool iterations, and Discord send events. It excludes
raw message content, prompts, user IDs, and raw channel IDs. The in-memory trace store retains at most 5,000
traces for one hour.

## Source pointers

- `src/events/messageCreate/tomoriChat.ts`: main chat entry point and stage coordinator.
- `src/utils/chat/channelQueue.ts`: channel locking, queue storage, and re-entry helpers.
- `src/utils/chat/diagnosticTimeline.ts`: per-turn event recording and diagnostic trace store.
- `src/commands/troubleshoot/chat.ts`: troubleshooting diagnostic command implementation.
