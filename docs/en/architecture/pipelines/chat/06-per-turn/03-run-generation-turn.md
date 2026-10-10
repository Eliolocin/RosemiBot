---
title: "06.3: Generation Turn"
---

The generation stage executes the model request for a persona turn. It manages primary and fallback
models, rotates API keys upon failures, resolves server-route failovers for personal accounts, and
deletes superseded partial messages committed by failed attempts.

## Flow and ownership

`runGenerationTurn()` in `src/utils/chat/generationTurn.ts` prepares the response sink, builds a
`GenerationPlan`, and executes attempts in sequence:

```text
Prepare sink and generation plan
  -> Prepare model context and prefill
  -> Run tool loop with key rotation
       -> Failure: clean partial messages, advance model or deferred server route
       -> Success: finalize sink, report fallback when applicable
  -> Always clean up sink
```

### Generation plan and model fallbacks

`buildGenerationPlan()` orders the primary and configured fallback models. An enabled randomizer can
promote a pool member to lead; key rotation tries available credentials before advancing models.

### Deferred server route fallback

Personal BYOK turns outside impersonation resolve the deferred server route only after all personal
attempts fail. Server cooldown and quota admission must pass before server attempts are appended.
Running such an attempt switches credential attribution to the server. Tools retain their own routing.

### Context preparation and prefill

Each attempt prepares media for its capabilities, trims history to known context limits with an
output reserve, and formats prefill as a model continuation or tail directive.

### Superseded message cleanup

After a partially delivered failure, `deleteSupersededStreamMessages()` removes tracked messages
before the next attempt:

- Committed message references are tracked in `streamingContext.deliveredMessageRefs`.
- Deletion targets persona webhooks directly, falling back to channel-level message deletion if needed.
- Deleting partial messages prevents truncated fragments from lingering above the fallback model's
  complete response.
- Before cleanup after an SDK timeout, the tool loop awaits the abandoned stream for up to
  `STREAM_ABANDONED_SETTLE_TIMEOUT_MS` (5000ms) to let in-flight sends register before deletion.
  Sends that outlive this window and failed deletions can leave partial output visible.

### Error suppression and notices

- **Suppression during failover**: error embeds are suppressed while further rotation keys or fallback
  models remain available, preventing transient provider hiccups from posting false failure notices.
- **Fallback notice**: if a fallback model succeeds (`index > 0`), `sendFallbackModelUsageNotice()`
  renders a compact Discord button notice informing users that a fallback model answered the turn.
  Each failed attempt is listed by error type and display-safe code only, because context assembly
  reads the notice back for the model; the upstream message stays in the operator log.
- **Final emission**: if all attempts fail, only the terminal error is emitted to the response sink.

## Constraints and rationale

- **Failover effects**: cleanup does not roll back tool writes, external requests, or independent tool
  messages. Off starts a new tool history on replacement attempts. With Response Drafting On, shared
  history and successful-request identities survive fallback, preventing identical effects from replaying.
- **Deferred server admission**: resolving server fallback routes only on personal failure prevents
  unnecessary database writes and server quota checks on successful member turns.
- **Per-turn cleanup**: a `finally` block invokes sink cleanup after exceptions. Temporary webhook
  deletion is best-effort, as described by [Response Sink](/architecture/pipelines/chat/06-per-turn/02-create-response-sink/).

## Response-text review

Response Drafting On creates one `ResponseReviewState` across model fallback and key rotation.
Ordinary prose is held by the existing presentation parser; Off streams normally. Impersonation and
text-suppressed work retain their existing paths. Failed attempts discard pending presentation while
preserving successful tools, rejections, correction budgets and reported usage.

`responseReview.ts` builds a bounded private packet from admitted persona/task evidence, privacy-filtered
context and actual tool history, and renders it as a tagged transcript. Evidence fixed for the turn
precedes the candidate, findings and tool outcomes, so a second review reuses the provider's prompt
prefix cache. Pending prose is labeled separately from history. Incomplete required
evidence, uninspected media or unsafe redaction makes review unavailable. Inherited reviewers use the
actual author attempt's model and key; pinned reviewers revalidate their owned registration and credentials.

Review can pass, request one author revision, or become unavailable. Two response reviews
bound the turn; another revision verdict delivers the latest candidate. Unavailability ends review
for the turn and permits current prose, while prior tool rejections remain blocked. Revision preserves
successful tool outcomes. `/kill`, follow-up interruption and abort discard held prose. Actual tools
use the separate [pre-execution checkpoint](../../tool-loop/02-execute-tool-call.md#actual-request-review).

An optional owned MCP `check_slop(text)` binding supplies advisory evidence only to the reviewer.
Raw findings cannot reach author feedback, memory or logs. The checker is hidden from author tool
schemas and blocked at dispatch. Checker failure proceeds to review; a clean result cannot approve prose.

Decision routing can skip detailed review only with validated calibration for the exact model and
response or tool rubric. The registry is empty, so selections remain visibly inactive and make no
paid routing calls. Custom reviewer prompts disable skipping. Activation requires labeled hold-out
evidence for character fit, false skips, coverage, latency and cost. INFO traces describe outcomes
and budgets without private packets; operational failures have one sanitized ERROR owner.

## Source pointers

- `src/utils/chat/generationTurn.ts`: `runGenerationTurn()` and generation plan execution.
- `src/utils/chat/toolLoop.ts`: `runToolLoop()` function-calling loop.
- `src/utils/discord/stream/supersededMessageCleanup.ts`: deletion of abandoned partial message sends.
- `src/utils/security/keyRotation.ts`: API key selection and rotation tracking.
- `src/utils/chat/responseReview.ts`: shared state, admitted evidence and reviewer lifecycle.
- `src/utils/chat/responseRuleCheck.ts`: internal checker validation and bounded evidence.
- `src/utils/chat/responseDecisionRouting.ts`: independent rubrics and calibration eligibility.
