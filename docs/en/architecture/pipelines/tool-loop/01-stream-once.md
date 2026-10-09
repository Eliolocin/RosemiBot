---
title: "01: Stream Once"
---

`streamOnce` executes a single provider generation pass, wrapping `provider.streamToDiscord` with a
rolling inactivity timeout and channel-lock watchdog protection. It returns a `StreamResult` indicating
whether generation completed, requested a tool call, timed out, or was interrupted.

## Flow and ownership
<!-- anchor: flow-and-ownership -->

The stage prepares the request payload, manages timeout timers, and races the provider stream against
cancellation:

1. **Context and prefill preparation:**
   `foldPrefillIntoToolHistory` merges any assistant output prefill into `functionHistory` so the model
   receives required formatting or continuation tokens. For queued messages, `replyToMessage` is set to
   the trigger message, except for scene turns (`incoming.sceneTurn`). In multi-persona scene turns,
   every persona turn shares the same trigger message; suppressing `replyToMessage` allows scene dialogue
   to render as free-standing back-and-forth messages.

2. **Rolling timeout initialization:**
   The stage creates an `AbortController` and exposes its signal on `streamingContext.abortSignal`.
   It arms an initial timeout using `STREAM_FIRST_TOKEN_TIMEOUT_MS` (default 300 s). This first-token
   budget allows hosted provider queues to hold requests during high load before emitting initial tokens.
   The provider adapter invokes `streamingContext.onStreamProgress` on each chunk delivery. This callback
   re-arms the timeout using the idle budget (`STREAM_SDK_CALL_TIMEOUT_MS`, default 120 s) and touches
   the channel lock via `touchChannelLock`.

3. **Watchdog and kill integration:**
   The stream runs under `runUnderWatchdog`, exempting the channel lock from stale expiration while
   actively receiving tokens. A unified `killStream` callback is registered on the channel lock entry
   via `setChannelStreamKill`. The callback aborts `abortController` and rejects the race promise, allowing
   `/kill` to terminate in-flight HTTP connections and unblock execution.

4. **Stream execution and result handling:**
   The stage races the provider's `streamToDiscord` call against the kill promise. If the provider
   completes normally, requests a tool call (`function_call`), or returns a provider-level error, the
   `StreamResult` is returned directly to `runToolLoop`.

## Timeout recovery and abandoned stream settling
<!-- anchor: timeout-recovery-and-abandoned-stream-settling -->

When the rolling inactivity timeout triggers:

1. **Stop request check:**
   If a user cancellation request (`/kill`) is active, the stage returns `{ status: "stopped_by_user" }`
   immediately.

2. **Settling in-flight sends:**
   If the timeout is genuine, `settleAbandonedStream` waits up to 5 seconds (`STREAM_ABANDONED_SETTLE_TIMEOUT_MS`)
   for the aborted provider generator to settle. `Promise.race` drops the aborted promise, but an in-flight
   Discord message send might still be on the wire. This gives in-flight sends time to register their
   IDs in `deliveredMessageRefs` before superseded-message cleanup. A send that outlives the bounded
   wait can still arrive after cleanup; the wait reduces this race without blocking fallback indefinitely.

3. **Notice dispatch and status return:**
   The stage logs the `stream_sdk_timeout` metric. If user errors are enabled, it sends the inactivity
   embed via `sendStreamTimeoutNotice`. When errors are temporarily suppressed because a fallback model is
   pending, it stashes `deferredTimeoutNotice` on `streamingContext` so `runGenerationTurn` can post the
   notice if all subsequent fallback attempts fail. The stage then returns `{ status: "timeout", data: error }`.

## Constraints and cleanup
<!-- anchor: constraints-and-cleanup -->

- **State cleanup:** The `finally` block always clears the active timeout timer, sets
  `streamingContext.onStreamProgress` to `undefined`, and clears `activeStreamKill` on the channel lock.
- **Error classification:** Only timeout errors originating from the SDK inactivity race yield
  `status: "timeout"`. Unexpected runtime exceptions re-throw directly to `runToolLoop` and propagate to
  the outer error handler in `runGenerationTurn`.
- **Lock health:** Touching the channel lock on every token progress heartbeat prevents long-running
  generations from being superseded or cleaned up as abandoned turns.

## Source pointers
<!-- anchor: source-pointers -->

- `src/utils/chat/toolLoop.ts`: `streamOnce`, `settleAbandonedStream`, `sendStreamTimeoutNotice`.
- `src/utils/chat/channelQueue.ts`: `runUnderWatchdog`, `touchChannelLock`, `setChannelStreamKill`.
- `src/utils/chat/assistantPrefill.ts`: `foldPrefillIntoToolHistory`.
- `src/types/provider/interfaces.ts`: `StreamResult` and `LLMProvider`.
