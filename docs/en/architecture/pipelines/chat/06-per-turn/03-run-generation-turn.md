---
title: "06.3: Generation Turn"
aiGenerated: true
---

The generation stage executes the model request for a persona turn. It manages primary and fallback
models, rotates API keys upon failures, resolves server-route failovers for personal accounts, and
continues the reply a failed attempt already posted instead of regenerating it.

## Flow and ownership

`runGenerationTurn()` in `src/utils/chat/generationTurn.ts` prepares the response sink, builds a
`GenerationPlan`, and executes attempts in sequence:

```text
Prepare sink and generation plan
  -> Prepare model context and prefill
  -> Run tool loop with key rotation
       -> Failure: carry posted text, advance key, model, or deferred server route
       -> Success: finalize sink, report fallback when applicable
  -> Always clean up sink
```

### Generation plan and model fallbacks

`buildGenerationPlan()` orders the primary and configured fallback models. An enabled randomizer can
promote a pool member to lead; key rotation tries available credentials before advancing models.
Cross-provider fallbacks use saved credentials from the turn's scope. Personal turns look up only
the user's saved providers and omit entries without a key; server credentials become available only
through the deferred server route.

Custom endpoint fallbacks must belong to the route's user or server before generation loads a saved
key. Server persona loaders resolve stored endpoint IDs without enforcing ownership, so generation
checks both owner fields: personal endpoints have that user and no server; server endpoints have
that server and no user. Credential lookup uses the route owner after this check.

### Deferred server route fallback

Personal BYOK turns outside impersonation resolve the deferred server route only after all personal
attempts fail. Server cooldown and quota admission must pass before server attempts are appended.
Running such an attempt switches credential attribution to the server. Tools retain their own routing.

### Context preparation and prefill

Each attempt prepares media for its capabilities, formats prefill as a model continuation or tail
directive, and trims history to known context limits with an output reserve. The prefill's tokens
are reserved against the same budget but kept out of the truncated list, because a tail directive
is a dialogue user turn the truncator would otherwise protect in place of the real trigger.

Personal Text attempts apply the active provider's saved sampler settings before request construction
and history truncation. An explicit personal output-token limit overrides the server limit for both;
an unset personal limit inherits the server setting. Both paths clamp the limit to the model's ceiling.

### Fallback text continuation

Messages a failed attempt already posted stay in the channel. The next key-rotation or fallback
attempt continues the reply from where the failed one stopped:

- Each failed attempt's stream results carry the text it posted. `carryDeliveredOutput()` joins
  that text across attempts, together with its `<details>` metadata and the stream results post-turn
  stats count emoji and sprites from. Their usage is dropped, because post-turn stats attribute all
  usage to the model that finished the turn.
- Once any text is carried, it replaces the turn's `/respond` or server prefill. Each key attempt
  applies it as a `continuation` prefill and trims history to make room for it. The prefill is a
  native trailing assistant turn when the model can continue one, otherwise a `[System:]` tail
  directive. Either way the stream strips an echo of the
  carried text, so only the continuation is posted. Tool macros are not expanded in carried text.
- A provider error with a suppressed embed does not flush the stream buffer, so an unfinished clause
  is never posted as a fragment for the continuation to repeat. An error the user sees still flushes
  it first. Unhumanized replies aggregate into one final send, so their failed attempts post nothing
  and the next attempt starts fresh.
- An empty continuation completes the turn with the carried text, unless the emptiness is a failure
  the empty-response retry handles specifically: an output-token cap, a speaker-guard discard, or a
  held NovelAI fragment.
- `prependDeliveredOutput()` adds the carried text to the final result, including a terminal failure,
  so short-term memory records everything posted.
- After an SDK timeout, the tool loop awaits the abandoned stream for up to
  `STREAM_ABANDONED_SETTLE_TIMEOUT_MS` (5000ms) so an in-flight send is part of the carried text.
  A send that outlives this window is visible but missing from the continuation prefill.
- Response Drafting holds text until review, so a failed drafting attempt has nothing posted to
  continue and discards its pending text instead.

### Error suppression and notices

- **Suppression during failover**: error embeds are suppressed while further rotation keys or fallback
  models remain available, preventing transient provider hiccups from posting false failure notices.
- **Fallback notice**: if a fallback model succeeds (`index > 0`), `sendFallbackModelUsageNotice()`
  renders a compact Discord button notice informing users that a fallback model answered the turn.
  Each failed attempt is listed by error type and display-safe code only, because context assembly
  reads the notice back for the model; the upstream message stays in the operator log.
- **Final emission**: if all attempts fail, only the terminal error is emitted to the response sink.

## Constraints and rationale

Each generation attempt owns its credential source. Personal attempts use the user's saved key and
bypass server rotation queries and retries. Deferred server attempts use server credentials and
rotation only after server admission succeeds.

- **Failover effects**: failover does not roll back tool writes, external requests, or independent tool
  messages. Off starts a new tool history on replacement attempts, but successful calls are recorded
  by request identity in `ChatTurnContext.completedToolCalls`: a replacement attempt that repeats an
  identical call gets the recorded result instead of running it again, and is told which tools already
  ran. A call with different arguments still executes. With Response Drafting On, shared history also
  survives fallback.
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
prefix cache. Pending prose is labeled separately from history. The reviewer reads as a blind model:
admitted media and tool images become placeholders. Available tools are a compact catalog of names,
descriptions and parameter names.
The workspace's `Content to Check` selection filters persona instructions, example dialogues, recent
conversation, memories and other context, and tools before packet budgeting. The draft, triggering
message and reply target remain required. Disabled persona instructions do not cause a missing-persona
failure. With `Tool Calls` unchecked, response review omits tool definitions, completed tool outcomes,
the correction count and the `tool_use` finding category, and skips proposed-call reviews. Coverage
records the selection.
Incomplete required evidence, a candidate containing a credential-shaped string (`containsCredential`,
not the log redactor's `key: value` heuristic, which matches ordinary prose), or tool arguments requiring
credential or user-info redaction make review unavailable, and the trace category names the gap.
The packet applies the same credential-shape patterns to admitted prose, tool descriptions and rule
reports. Structured tool arguments, outcomes and rule reports also mask values under credential keys;
the proposed-call gate refuses arguments changed by either check. Log-only heuristics do not alter
reviewer evidence.
Proposed voice-message arguments retain the script and delivery instructions for review, while
diagnostic storage and completed-call evidence retain only their character counts; submitted user-info
values remain excluded from review. Inherited reviewers use the actual author attempt's model and key;
pinned reviewers revalidate their owned registration and credentials.
Either way the request follows the reviewer provider's saved `thinking_level` and asks for the chat
reply budget, because a reasoning model spends its thinking from the output allowance before the JSON
verdict. Anthropic ignores the level: its structured call forces a tool, which the API refuses
alongside extended thinking.

Review can pass, request one author revision, or become unavailable. Two response reviews
bound the turn; another revision verdict delivers the latest candidate. Unavailability ends review
for the turn and permits current prose, while prior tool rejections remain blocked. Revision preserves
successful tool outcomes. `/kill`, follow-up interruption and abort discard held prose. Actual tools
use the separate [pre-execution checkpoint](../../tool-loop/02-execute-tool-call.md#actual-request-review).

An optional rule checker is a tool on an owned `prose_linter` MCP registration whose only required
input is a `text` string. Its output (structured content, JSON text or plain text, at most 32 KB) goes
to the reviewer as `<prose_linter_report advisory="true">` and forces a detailed review. Raw output
cannot reach author feedback, memory or logs. `getGuildMCPRouting` excludes `prose_linter`
registrations, so the author never sees or dispatches their tools. Checker failure proceeds to review;
an empty report cannot approve prose. A binding whose registration is disabled or removed acts as no
checker: it logs no error and does not force review.

INFO traces describe outcomes and budgets without private packets; operational failures have one
sanitized ERROR owner.

## Source pointers

- `src/utils/chat/generationTurn.ts`: `runGenerationTurn()` and generation plan execution.
- `src/utils/chat/toolLoop.ts`: `runToolLoop()` function-calling loop.
- `src/utils/chat/assistantPrefill.ts`: `applyAssistantPrefill()` for manual, server, and continuation prefills.
- `src/utils/security/keyRotation.ts`: API key selection and rotation tracking.
- `src/utils/chat/responseReview.ts`: shared state, admitted evidence and reviewer lifecycle.
- `src/utils/chat/responseRuleCheck.ts`: internal checker validation and bounded evidence.
