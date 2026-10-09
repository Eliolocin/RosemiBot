---
title: "03: Chat Disposition"
---

The disposition stage handles non-runnable admission outcomes. It emits structured logs for ignored,
blocked, queued, or errored messages, triggers caller discard callbacks, and returns the final disposition.

## Flow and ownership

When `evaluateChatAdmission()` returns a disposition other than `"run"`, the coordinator in
`src/events/messageCreate/tomoriChat.ts` routes the admission to `handleChatDisposition()`:

```
NonRunnableChatAdmission
  │
  ├─► admission.error? ──► log.warn()
  └─► else             ──► log.info()
  │
  ▼
disposition !== "queued"?
  │
  ├─► yes: await incoming.onQueueDiscard?.("admission_rejected")
  └─► no:  retain queued callbacks for replay
  │
  ▼
return admission.disposition
```

### Logging and error reporting

`handleChatDisposition()` in `src/utils/chat/admission.ts` inspects `admission.error`. If an error object
is attached, it logs a warning with the error details. Otherwise, it emits an informational log containing
the disposition and admission reason.

### Caller notifications and return contract

`tomoriChat()` returns the final `ChatAdmissionDisposition` to its caller:

- **Discord event handler**: discards the returned value because `messageCreate` handlers run fire-and-forget.
- **Accepted queued turns**: a `"queued"` disposition indicates the message entered the channel queue as live
  work. The coordinator retains attached callbacks, and the replayed invocation reports the eventual outcome.
- **Rejected non-run turns**: for `"ignore"`, `"blocked"`, or `"error"`, the coordinator fires
  `incoming.onQueueDiscard?.("admission_rejected")` to release command-level promises.
- **External schedulers**: the reminder processor in `src/timers/reminderProcessor.ts` inspects the returned
  disposition. It deletes the source database row on completion, treats `"queued"` as in flight, and schedules
  retries on non-run outcomes.

## Constraints and rationale

- **Single exit point**: routing non-run admissions through one named stage keeps terminal logging and discard
  signaling consistent across all rejection reasons.
- **Zero lock contention**: rejected messages exit immediately without acquiring channel locks or starting
  Discord typing indicators.
- **Caller awareness**: returning the disposition permits external subsystems to implement distinct retry
  and cleanup policies without inspecting internal admission structures.

## Source pointers

- `src/utils/chat/admission.ts`: `handleChatDisposition()` definition.
- `src/events/messageCreate/tomoriChat.ts`: coordinator routing for non-run admissions.
- `src/timers/reminderProcessor.ts`: external caller handling returned dispositions.
