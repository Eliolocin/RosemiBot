---
title: "06.2: Response Sink"
---

The response sink connects provider streaming to Discord delivery. It resolves whether output routes
through an alter-persona webhook, a temporary user-impersonation webhook, or standard bot messages,
and manages delivery lifecycle callbacks.

## Flow and ownership

`createChatResponseSink()` in `src/utils/chat/responseEmitter.ts` constructs a `ChatResponseSink`
for the current `ChatTurnContext`:

```
ChatTurnContext
  │
  ▼
createChatResponseSink() ─────────────────► returns ChatResponseSink
  │
  ├─► prepare()                           ──► resolves ChatResponseTarget, arms channel lock
  ├─► emitStreamResult()                  ──► filters duplicate errors, sends generic error embeds
  ├─► emitError()                         ──► surfaces exceptions (rethrows on impersonation)
  ├─► finalize()                          ──► deletes temporary webhooks, logs turn metrics
  └─► cleanup()                           ──► webhook deletion attempt in finally block
```

### Delivery target resolution

`prepare()` executes at the start of generation and resolves `ChatResponseTarget`:

- **User impersonation**: when `isUserImpersonation` is true, it creates a temporary webhook using
  the target user's display name and avatar.
- **Alter personas**: when `currentPersona.is_alter` is true, it resolves the server-owned webhook
  via `getOrCreateWebhook()` in `src/utils/discord/webhookManager.ts`.
- **Main persona and DMs**: returns `undefined`. Direct messages and standard bot replies route
  through `channel.send()` as the bot account.

After target resolution, `prepare()` updates the channel lock entry with the active persona ID,
follow-up eligibility, and impersonation status.

### Error emission and suppression

- `emitStreamResult()`: handles completed streams ending in error status. If `result.data` is an
  identified `ProviderError`, the sink skips sending an embed because `StreamErrorUi.handleProviderError()`
  already rendered the provider-specific notice. Unhandled non-provider errors emit a generic generation
  error embed when `context.shouldSurfaceUserErrors` is true.
- `emitError()`: handles unexpected exceptions. Under user impersonation, it rethrows the exception
  so the initiating slash command handles the failure directly, preventing error embeds from appearing
  as messages from the impersonated user.

### Webhook cleanup lifecycle

Temporary impersonation webhooks must be deleted when generation finishes:

- `finalize()` deletes the temporary webhook after successful or non-fatal generation turns.
- `cleanup()` runs from a `finally` block in `runGenerationTurn()`, attempting deletion if an exception
  bypasses `finalize()`.
- Deletion is guarded by an internal boolean flag so `finalize()` and `cleanup()` never attempt duplicate
  deletion calls. Failures during deletion are logged as warnings and do not throw.

## Constraints and rationale

- **Cleanup ownership**: normal finalization and exception cleanup share one deletion attempt. Discord
  failures are logged; a failed deletion can leave a temporary webhook in the guild.
- **Error deduplication**: suppressing generic embeds for structured `ProviderError` payloads avoids
  displaying duplicate error notices for content filters and quota exhaustion.
- **Impersonation isolation**: rethrowing exceptions during impersonation prevents error embeds from
  rendering with the impersonated user's identity.

## Source pointers

- `src/utils/chat/responseEmitter.ts`: `createChatResponseSink()` and target resolution.
- `src/utils/discord/webhookManager.ts`: alter persona webhook creation and reuse.
- `src/utils/chat/types.ts`: `ChatResponseSink` and `ChatResponseTarget` interface definitions.
