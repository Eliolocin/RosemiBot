---
title: "05: Turn Planning"
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
  credential policy (`textCredentialSource: "server" | "personal"`), and text quota preflight state.
- **Multiple persona matches**: when multiple personas qualify on a real user message,
  `queueAdditionalPersonaTurns()` places the additional personas at the front of the channel's `messageQueue`.
  Only the first persona runs in the current turn. The remaining personas replay as priority jobs immediately
  after lock release, so each persona executes under its own lock and typing cycle.
- **Zero matches or failed gates**: returns `turns: []`. The coordinator treats an empty list as a skip,
  immediately releasing the channel lock and triggering queue replay.

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
