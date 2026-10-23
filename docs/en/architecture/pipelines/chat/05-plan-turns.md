---
title: "05: Turn Planning"
aiGenerated: true
---

Turn planning evaluates whether an admitted message should trigger a bot response, determines which
persona(s) reply, validates access and quotas, and produces an ordered `ChatTurnPlan`.

## Flow and ownership

`planChatTurns()` in `src/utils/chat/turnPlanner.ts` runs inside `runWithChannelLock()`. It receives
`LockedChatTurn` and returns a `ChatTurnPlan`:

```
LockedChatTurn
  │
  ├─► loadOrRegisterTriggerUser()          ──► hydrates UserRow and locale
  ├─► validateDirectChatTrigger()          ──► validates direct mention / trigger words
  ├─► evaluateChatAccess()                 ──► checks whitelist, blacklist, and role rules
  ├─► rejectOnMessageTriggerCooldown()     ──► enforces trigger cooldowns
  ├─► updateAutochatCounter()              ──► advances autochat count when qualifying
  │
  ▼
determineMatchingPersonas()
  │
  ├─► 0 matches?                           ──► returns turns: [] (silent skip, lock released)
  ├─► 1 match?                             ──► returns turns: [ChatTurn]
  └─► >1 matches?
        ├─► first persona                  ──► turns: [ChatTurn] (runs now)
        └─► extra personas                 ──► queueAdditionalPersonaTurns() (queued at front)
```

### User hydration and trigger validation

1. **User loading**: `loadOrRegisterTriggerUser()` fetches or registers the triggering user in `userRepository`.
   It attaches the user record and preferred locale to `admission.userRow`.
2. **Direct trigger checks**: `validateDirectChatTrigger()` checks whether the message explicitly mentions the
   bot, uses trigger words, or addresses a specific persona.
3. **Access gating**: `evaluateChatAccess()` checks server channel whitelists, role gates, and member blacklist
   status. If access is denied, planning aborts silently.
4. **Cooldown enforcement**: `rejectOnMessageTriggerCooldown()` verifies message trigger cooldowns. If on
   cooldown, it sends a localized notice on deliberate turns and aborts planning.

### Persona matching and multi-persona sequencing

`determineMatchingPersonas()` in `src/utils/chat/triggerProcessor.ts` selects which personas should respond:

- **Single persona match**: produces one `ChatTurn` populated with the persona's `TomoriState`, resolved
  credential policy (`textCredentialSource: "server" | "personal" | "supporter"`), funding scope, and text quota preflight state.
- **Multiple persona matches**: when multiple personas qualify on a real user message,
  `queueAdditionalPersonaTurns()` places the additional personas at the front of the channel's `messageQueue`.
  Only the first persona runs in the current turn. The remaining personas replay as priority jobs immediately
  after lock release, so each persona executes under its own lock and typing cycle.
- **Zero matches or failed gates**: returns `turns: []`. The coordinator treats an empty list as a skip,
  immediately releasing the channel lock and triggering queue replay.

### Model and credential admission

Each matched persona resolves credentials separately. Personal Text takes precedence over server
models. Server routes choose the persona override, then the channel override, then the workspace
model; an explicit invocation model override applies last. Each subscription attempt resolves funding
for that effective model and its owning scope. A persona without usable credentials is skipped while
other admitted personas can continue.

Subscription ownership comes from the selected saved provider entry. The server's
`subscription_capabilities` records that choice separately from catalog model IDs, so choosing an
OpenRouter BYOK entry keeps its own key even while the server has a sponsor. Personal provider rows
record ownership through their assigned and enabled capabilities.

Server-funded subscription routes take the same per-member text quota admission as server BYOK.
Personal subscriptions and personal BYOK stay outside server quota. Admission shares one trigger
state across persona jobs and retries; post-turn effects consume it once after a delivered reply.

An inactive or unlinked personal subscription retains its configured personal text fallback pool.
A server route is considered only after that pool fails, subject to the user's fallback setting and
`user_byok_mode`. Other capabilities can use an available configured server route when the personal
subscription is inactive or missing. Billing and storage failures remain visible failures.

### Channel lock state arming

When `turns.length > 0`, `planChatTurns()` updates the channel lock entry via `setActiveChannelTurnState()`.
It records the lead persona's ID, follow-up eligibility, and impersonation status so that subsequent user
messages can be evaluated for follow-up interrupts.

## Constraints and rationale

- **Gating before generation**: access rules, cooldowns, and quota preflights execute before prompt assembly
  or LLM requests, so rejected turns consume zero provider quota.
- **Front-of-queue multi-persona serialization**: breaking multi-persona replies into distinct serialized turns
  prevents long single-lock blocks and provides dedicated Discord typing indicators and webhook identities
  for each responding persona.
- **Selective error visibility**: `shouldSurfaceUserErrors` suppresses error notices for passive autochat
  and random triggers while delivering error feedback for direct mentions, DMs, and slash commands.

## Source pointers

- `src/utils/chat/turnPlanner.ts`: `planChatTurns()` coordinator.
- `src/utils/chat/triggerProcessor.ts`: persona matching and trigger detection.
- `src/utils/chat/personaQueue.ts`: `queueAdditionalPersonaTurns()` multi-persona queueing.
- `src/utils/chat/admissionGuards.ts`: access, cooldown, and rate limit validation helpers.
