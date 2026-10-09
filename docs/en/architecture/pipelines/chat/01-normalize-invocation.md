---
title: "01: Input Normalization"
---

Input normalization prepares the typed invocation record for the chat pipeline. It converts
optional fields on `TomoriChatInput` into a strict `ChatIncoming` record with guaranteed defaults.

## Flow and ownership

The coordinator `tomoriChat()` receives `TomoriChatInput` from several sources:
Discord `messageCreate` events, slash commands, empty-response retries, reminder executions, and
cross-channel boomerang follow-ups.

`normalizeChatInvocation()` in `src/utils/chat/admission.ts` maps this payload to `ChatIncoming`:

| Field | Default | Purpose |
|---|---|---|
| `retryCount` | `0` | Tracks empty-response retry iterations across recursive invocations. |
| `skipLock` | `false` | Signals whether the call reuses an existing outer channel lock. |
| `isPersonaJob` | `false` | Distinguishes autonomous persona jobs from human messages. |
| `isUserImpersonation` | `false` | Marks command-driven user impersonation turns. |
| `textQuotaSource` | `"user"` | Specifies whether server text quota charges the user or a system lease. |

Other fields pass through without alteration:
- `systemTriggerIdentity`: carries authoritative server and user snowflakes from scheduled reminder rows,
  preventing ambiguous DM channel key lookups.
- `carriedExpressionDelivery`: forwards expression delivery state to empty-response retries so visible
  expressions are not re-sent.
- `onGenerationResult` and `onQueueDiscard`: callback handlers allowing command callers to observe completion
  or rejection.

## Constraints and rationale

- **Single boundary enforcement**: defaults are applied once at entry. Downstream stages rely on populated
  values without defensive null-coalescing checks.
- **Pure transformation**: normalization performs in-memory property mapping without network calls, database queries,
  or cache mutations.
- **Payload preservation**: fields intended for downstream stages (such as streaming overrides or forced mentions)
  remain intact so later stages receive the caller's intended configuration.

## Source pointers

- `src/utils/chat/admission.ts`: `normalizeChatInvocation()` implementation.
- `src/utils/chat/types.ts`: `TomoriChatInput` and `ChatIncoming` type definitions.
- `src/events/messageCreate/tomoriChat.ts`: coordinator entry invoking normalization.
