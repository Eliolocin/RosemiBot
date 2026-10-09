---
title: "Runtime Utilities and Shared Services"
---

The `src/utils/` tree provides cross-cutting infrastructure supporting runtime dispatch, network safety, destination resolution, error attribution, and UI formatting across TomoriBot.

## Ambient error context

`log.error()` and `log.warn()` accept an optional `ErrorContext`, but deeply nested helper functions rarely receive explicit server or user IDs. Threading identity parameters through every intermediate signature creates tight coupling. `src/utils/misc/errorContextStore.ts` provides ambient error attribution out of band using an `AsyncLocalStorage` scope.

### Scope lifecycle

The entry points that initiate a unit of work open a context scope:

| Entry point | Location | `source` |
|---|---|---|
| Chat message turn | `src/events/messageCreate/tomoriChat.ts` | `chat` |
| Slash command or interaction | `src/events/interactionCreate/handleCommands.ts` | `command` or `interaction` |
| Scheduled reminder or task | `src/timers/reminderProcessor.ts` | `reminder` |
| Random server trigger | `src/timers/randomTriggerProcessor.ts` | `random_trigger` |

Every asynchronous call within the scope inherits this attribution across arbitrary `await` depths without parameter threading. Background tasks started outside a scope remain unattributed, preventing stale context leakage.

### Context enrichment and precedence

- **Opening scopes:** `runWithErrorContext(identity, fn)` starts a new scope. Nested scopes inherit enclosing values and apply overrides.
- **In-flight enrichment:** `enrichErrorContext(patch)` mutates the active scope once additional IDs resolve. For example, a chat turn seeds Discord snowflakes at admission, then attaches database row IDs once user and server records are loaded.
- **Explicit precedence:** `resolveErrorContext(explicit)` merges ambient fields under explicit call-site arguments. An explicit field passed directly to `log.error()` takes precedence over the ambient scope.
- **Identifier convention:** Typed ID fields (`serverId`, `userId`, `personaId`) are numeric PostgreSQL primary keys. Discord snowflakes travel in `metadata` (`serverDiscId`, `userDiscId`, `channelDiscId`) alongside `source` and `sourceDetail`.

## Channel resolution and terminal failures

Sending messages across long asynchronous operations (such as multi-second streaming generation or delayed tasks) cannot assume the admission-time channel reference remains valid. Discord client caches evict entries over time, which causes discord.js to throw `ChannelNotCached`.

`resolveSendableChannel(client, channelId)` in `src/utils/discord/resolveSendableChannel.ts` manages destination resolution:

- **Cache-first with REST fallback:** The resolver inspects the local Discord client cache first. If absent, it queries Discord's REST API to re-fetch the destination before attempting delivery.
- **Permanent channel deletion (`10003`):** If Discord returns error code `10003` ("Unknown Channel"), the channel no longer exists. The operation stops with reason `channel_deleted`.
- **Revoked access permissions (`50001`):** If Discord returns code `50001` ("Missing Access"), the channel exists but the bot lacks permission to post. The operation throws or halts with `MissingChannelAccessError` (`missing_access`). Separating this from deletion allows operators to restore access without treating the channel as destroyed.
- **Transient network failures:** HTTP 429 rate limits, 5xx server errors, socket timeouts, and abort signals are transient. They throw ordinary exceptions rather than classifying as permanent channel loss, preserving upstream retry arms.
- **Stop classification:** `isChannelGoneError(error)` checks for both `10003` and `50001` to determine when streaming output must terminate cleanly.

## Remote URL security and SSRF protection

Custom endpoints, guild MCP transports, and `safeDownload()` use `remoteUrlSecurity.ts` for policy
and `userRemoteFetch.ts` for DNS-pinned connections and redirect validation. URL policy validation
alone does not pin the subsequent connection. The `fetch_url` tool also guards its external crawler
inputs. [Security](/architecture/subsystems/security/#ssrf-and-remote-url-security-gate) owns
environment rules, private-network exceptions, and the crawler's narrower guarantee.

## Reusable UI and tip modals
<!-- anchor: tip-modals -->

Discord UI helpers provide standardized layouts for errors and helpful guidance:

- **Tip text generation:** `createTipText(locale, tipKeys, tipVars)` in `src/utils/discord/embedHelper.ts` aggregates atomic localized bullet keys from `genai.tips.*` (see [Localization](/architecture/subsystems/localization/#tip-item-keys-genaitips)).
- **Modal display:** Tips and long diagnostics render via `src/utils/discord/textDisplayModal.ts` in read-only Discord text modals, supporting markdown and hyperlinks without cluttering the chat channel with extra messages.
- **Automatic support link:** `createTipText()` automatically appends the Official Support Server link (`genai.tips.support_server`) as the final bullet of non-empty tip modals.

## Shared service contracts

1. **Cache invalidation on write success:** Any database mutation affecting cached state must invalidate the corresponding cache in the same code path immediately following transaction commit (`AGENTS.md` rule 7). Invalidation must never precede a write.
2. **Domain ownership:** Specialized utilities belong to their respective subsystem owners rather than accumulating in shared barrels:
   - Database schema and repository methods: [Database Schema](/architecture/subsystems/database-schema/)
   - In-memory and persisted caches: [Caching System](/architecture/subsystems/caching/)
   - Persona avatars and sprite storage: [Multi-Persona System](/architecture/subsystems/multi-persona/)
   - Secret handling and cryptographic keys: [Security System](/architecture/subsystems/security/)

## Source pointers

- `src/utils/misc/errorContextStore.ts`: ambient error context and scope management.
- `src/utils/discord/resolveSendableChannel.ts`: channel reachability and terminal error classification.
- `src/utils/security/remoteUrlSecurity.ts`: remote URL validation and SSRF gate.
- `src/utils/security/userRemoteFetch.ts`: DNS-pinned redirect-safe HTTP fetcher.
- `src/utils/discord/embedHelper.ts`: embed formatting and tip modal creation.
