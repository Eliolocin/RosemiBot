---
title: "06.4: Post-Turn Effects"
---

The post-turn stage executes side effects after generation finishes. It coordinates empty-response
retries, text quota consumption, self-reply tracking, short-term memory caching, thought logging,
cross-channel boomerangs, and usage statistics.

## Flow and ownership

`runPostTurnEffects()` in `src/utils/chat/postTurnEffects.ts` runs after `runGenerationTurn()` settles:

```
ChatTurnContext & GenerationTurnResult
  │
  ├─► 1. recordReunionPresence()           ──► commits or releases triggerer presence claim
  ├─► 2. maybeScheduleEmptyResponseRetry() ──► re-enters tomoriChat(skipLock=true) on empty output
  ├─► 3. consumeTextQuota()                ──► charges server text quota on non-empty reply
  ├─► 4. updateSelfReplyBookkeeping()      ──► updates last-responded persona and chain counters
  ├─► 5. writeShortTermMemory()            ──► stores conversation turn in STM cache per persona
  ├─► 6. emitThoughtLog()                  ──► sends reasoning or BYOK attribution embeds
  ├─► 7. scheduleBoomerangFollowUp()       ──► schedules cross-channel re-entry via setImmediate
  ├─► 8. rememberLastReplyUsage()          ──► caches prompt token usage for /context inspection
  └─► 9. recordUsageStats()                ──► fire-and-forget dispatch of turn & token metrics
```

### Side effect sequence

1. **Reunion presence**: `recordReunionPresence()` commits or releases the direct-triggerer presence
   claim before any retry can rebuild context.
2. **Empty-response retry**: if `result.status === "empty_response"` and `retryCount < MAX_EMPTY_RESPONSE_RETRIES` (2):
   - Waits `EMPTY_RESPONSE_RETRY_DELAY_MS` (1000ms).
   - If caused by a speaker guard trigger or foreign speaker label leak, it prepends a speaker-guard directive
     via `buildSpeakerGuardRetryDirective()`.
   - Re-enters `tomoriChat()` with `skipLock=true`, incremented `retryCount`, pinned persona, and carried
     expression delivery receipts so already-posted stickers or reactions are not duplicated.
   - Upon retry exhaustion, deliberate turns post a warning embed while passive autochat turns stay silent.
3. **Text quota consumption**: `consumeTextQuota()` checks whether text quota was armed during admission
   and the response was non-empty. If so, it increments the server quota via `incrementTextQuota()` and
   marks the trigger key consumed in `textQuotaTriggerStates`.
4. **Self-reply bookkeeping**: on non-empty responses, `setLastRespondedPersona()` records which persona
   spoke last. For non-stop real user messages, it increments `selfReplyChainState.triggerCount`.
5. **Short-term memory write**: for non-stop responses where the user is not full-privacy,
   `writeShortTermMemory()` saves conversation turns to cache via `storeShortTermMemory()` for each responding
   persona. It then increments the cadence counter via `incrementStmTurnCounter()`, driving proactive memory
   refresh nudges in future turns.
6. **Thought log emission**: if a thought-log channel is configured in a guild text channel, `emitThoughtLog()`
   sends reasoning and duration details via `sendThoughtLogEmbed()`. If personal BYOK was used without reasoning,
   it sends an attribution embed crediting the user's provider. Like tool notices and image diagnostics, it
   copies only when `canMirrorToThoughtLog()` confirms the log is in the same guild and everyone there can
   already read the source channel (or a public thread's parent) with no `ViewChannel` deny overwrite.
   The bot cannot list who reads the log, so a private thread, a private-listed channel, or an
   undeterminable audience is never mirrored. Each refusal logs its reason, at warn level only for an
   undeterminable audience.
7. **Boomerang follow-up**: if the turn invoked the cross-channel message tool, `scheduleBoomerangFollowUp()`
   consumes the pending boomerang. It schedules a re-entry in the source channel via `setImmediate`,
   calling `suppressNextSelfReply()` so the follow-up does not trigger self-reply suppression.
8. **Last reply token cache**: `rememberLastReplyUsage()` caches the prompt token count in `lastReplyUsageCache`
   so the `/context` command can display prompt token consumption.
9. **Usage statistics**: `recordUsageStats()` dispatches fire-and-forget database writes recording model
   usage, token counts, and delivery-gated expression stats (emojis and sprites).

## Constraints and rationale

- **Non-blocking failure tolerance**: errors in secondary side effects (such as memory writes, thought logs,
  or usage stats) are caught and logged, so completed replies are never disrupted by cache or logging errors.
- **Single quota deduction**: text quota increments at most once per trigger sequence, requiring a successful,
  non-empty response.
- **Coordinated re-entrancy**: recursive calls explicitly declare lock behavior: empty-response retries reuse
  the active lock (`skipLock=true`), whereas cross-channel boomerangs defer execution until after lock release
  via `setImmediate`.

## Response review accounting

With Response Drafting On, `GenerationTurnResult.usageEntries` carries actual author, reviewer and
Decision usage across failed attempts, discarded drafts and cancellation. `recordUsageStats` drains
that ledger before requiring delivered dialogue and retains a recorder for late usage. Late verdicts
cannot authorize delivery. Missing usage stays unknown; discarded draft length supplies no estimate.
Reviewer and Decision counters are subsets of total tokens, so cost attribution does not bill them
twice. DMs retain their exclusion from persistent guild telemetry. Off keeps ordinary usage accounting.

Only Discord-accepted presentation populates `personaResponses` for memory and reply quotas.
Superseded drafts and held narration consume neither. Expression receipts and tool telemetry still
describe their actual effects independently of prose review.

## Source pointers

- `src/utils/chat/postTurnEffects.ts`: `runPostTurnEffects()` and side effect helpers.
- `src/utils/cache/shortTermMemoryCache.ts`: short-term memory caching and cadence tracking.
- `src/utils/quota/textQuotaManager.ts`: text quota deduction.
- `src/utils/discord/thoughtLog.ts`: thought-log and provider attribution embeds.
