---
title: "04: Channel Lock"
---

The channel lock enforces single-turn concurrency per Discord channel. It manages the Discord typing
keepalive indicator, coordinates user interruptions and cancellations, and replays queued messages
when the lock releases.

## Flow and ownership

`runWithChannelLock()` in `src/utils/chat/channelQueue.ts` wraps turn planning and execution inside a
per-channel mutex backed by the in-memory `channelLocks` map.

```
runWithChannelLock(admission, callback)
  │
  ├─► skipLock === true? ─────────────────► invoke callback(reuseOuterLock)
  │
  ├─► releaseStaleChannelLockIfExpired()
  ├─► acquireChannelLockForTurn()         ──► sets isLocked, initializes AbortController
  │
  ▼
try {
  callback(lockedTurn, startTyping)       ──► startDiscordTypingKeepalive() (8s cadence)
} finally {
  releaseChannelLockAndReplayQueue()      ──► stops typing, aborts turn controller
    │
    ├─► stopContext present?              ──► setImmediate(handleStopResponse)
    └─► messageQueue has items?           ──► setImmediate(processQueuedMessage)
}
```

### Mutex acquisition and re-entrancy

When an admitted turn arrives:

- **Re-entrant turns**: calls passing `skipLock=true` (such as empty-response retries) reuse the existing
  lock entry and its active typing keepalive without acquiring a new lock or resetting timers.
- **Lock acquisition**: `acquireChannelLockForTurn()` sets `isLocked = true`, records `lockedAt` and
  `lastProgressAt`, and creates a fresh `AbortController` (`activeTurnAbortController`). The signal is
  available to executing tools via `ToolContext.abortSignal`.
- **Stale lock recovery**: `releaseStaleChannelLockIfExpired()` checks whether `lastProgressAt` is older
  than `CHANNEL_LOCK_TIMEOUT_MS` (180s). If expired, it aborts the active turn controller, fires the
  stream kill handle, clears queued messages, and resets the lock. Active operations using `runUnderWatchdog`
  (such as streaming chunks and tool calls) suppress stale-lock recovery because they enforce their own timeouts.

### Interruption and cancellation ownership

Channel locks coordinate three forms of turn interruption:

1. **Follow-up interrupts**: `queueFollowUpForLockedTurn()` allows an inbound message from the same user to
   interrupt an active stream via `StreamOrchestrator.requestFollowUp()`, up to `MAX_FOLLOW_UP_INTERRUPTS` (3).
   If the active turn is executing a tool (`isInToolCallChain`), the message is enqueued as the latest follow-up
   without interrupting the stream, protecting tool completion.
2. **Natural stops**: `requestNaturalStopForLockedTurn()` captures the message and registers
   `StreamOrchestrator.requestStop()`. Active streaming halts gracefully and saves the stop context.
3. **Hard cancellation via `/kill`**: `forceKillChannelStream()` in `src/commands/kill.ts` immediately aborts
   `activeTurnAbortController` and invokes `activeStreamKill()`, rejecting the streaming race with an error.
   The `/kill` command also clears pending turns using `clearChannelProcessingQueue()`. Tools that generate
   media check `abortSignal.aborted` before sending to avoid posting discarded media.

### Release and queue replay

When the turn completes or throws, `releaseChannelLockAndReplayQueue()` executes in a `finally` block:

1. Resets lock metadata, clears `activeStreamKill`, and aborts `activeTurnAbortController`.
2. Stops the Discord typing keepalive timer.
3. Checks `StreamOrchestrator.getAndClearStopContext()`. If a natural stop occurred, it schedules
   `handleStopResponse()` via `setImmediate`.
4. Pops the next message from the FIFO `messageQueue` and schedules `processQueuedMessage()` via `setImmediate`.
   The stop callback is scheduled first, but the callbacks are not awaited in sequence. Scheduling
   order alone does not guarantee that the stop confirmation finishes before queue replay.

## Constraints and rationale

- **Single active turn per channel**: serializing turns prevents race conditions across message sends,
  webhook delivery, and conversational context ordering.
- **Asynchronous queue unrolling**: invoking queued replays and stop responses through `setImmediate` prevents
  call stack growth under heavy traffic.
- **Tool progress protection**: suppressing stream interrupts while `isInToolCallChain` is true ensures external
  tool effects finish cleanly before the user's follow-up message processes.

## Source pointers

- `src/utils/chat/channelQueue.ts`: `runWithChannelLock()`, queue storage, typing keepalive, and release logic.
- `src/commands/kill.ts`: `/kill` command driving stream termination and queue flushing.
- `src/utils/discord/streamOrchestrator.ts`: stop and follow-up request state management.
