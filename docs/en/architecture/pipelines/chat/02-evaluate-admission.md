---
title: "02: Admission Check"
---

The admission stage decides whether an incoming message proceeds into a generation turn, gets queued
behind active work, or terminates immediately. It loads early server and persona state required
for turn planning.

## Flow and ownership

`evaluateChatAdmission()` in `src/utils/chat/admission.ts` inspects each normalized `ChatIncoming`.
It returns a discriminated `ChatAdmission`: runnable (`"run"`) or non-runnable (`"ignore"`, `"blocked"`,
`"queued"`, or `"error"`).

```
ChatIncoming
  │
  ├─► Suppressed / bot / easter egg?       ──► ignore
  ├─► Privacy-FULL / blacklisted / scope?  ──► blocked
  ├─► Sendability checks failed?           ──► blocked
  │
  ▼
Load early TomoriState & allPersonas
  │
  ├─► Audio attachment present?            ──► STT transcription & inline content mutation
  │
  ▼
evaluateAdmissionQueueAndTriggerGate()
  │
  ├─► Channel locked?
  │     ├─► Natural stop phrasing?         ──► requestNaturalStopForLockedTurn() → ignore
  │     ├─► Eligible same-user follow-up?  ──► queueFollowUpForLockedTurn() → queued
  │     └─► Eligible trigger & quota?      ──► enqueueBusyChannelMessage() → queued
  │
  └─► Channel free & trigger matches?      ──► RunnableChatAdmission { disposition: "run" }
```

### Channel scope and DM resolution

Guild channels resolve server scope directly from `guild.id`. DMs have no guild, so TomoriBot maps
each DM to a synthetic server whose identifier is the human recipient's Discord ID.

`resolveAdmissionChannelScope()` derives this identifier from `DMChannel.recipientId`, which is a property
of the channel rather than the message author. For automated turns (such as reminders or cross-channel
boomerangs), `systemTriggerIdentity` from the schedule's database record takes precedence. This ensures
turns triggered by one of Tomori's own recent messages still resolve the human user's server row.

### Sendability validation

Before loading persona configuration or calling models, guild channels pass three delivery checks:

1. **Permission bits**: verifies `SendMessages` in standard text channels or `SendMessagesInThreads`
   in thread channels.
2. **Guild timeout**: checks `member.isCommunicationDisabled()` on the cached bot member. A timed-out bot
   retains its permission bits in Discord's bitfield, but Discord rejects sends with HTTP error 50013.
   Checking the cached member avoids a remote API call.
3. **Recent refusal cache**: checks `getBlockedSendReason()` from `sendFailureCache`. This backstop catches
   channels where Discord recently refused a send with 50013 or 50001, skipping generations until
   `SEND_FAILURE_RETRY_MS` expires or a subsequent send succeeds.

### Audio transcription

When a message contains audio attachments and voice transcription is enabled,
`evaluateAudioTranscriptionAdmission()` transcribes the attachment using the server's configured STT endpoint.

In chat mode on supported guild channels, it sends the transcript via a webhook mirroring the user's
name and avatar. Otherwise, it stores the text in `voiceTranscriptCache`. In both modes, it updates
`message.content` in place with the transcript text so downstream context builders see the spoken words.

### Admission queue and trigger gating

`evaluateAdmissionQueueAndTriggerGate()` in `src/utils/chat/admissionQueue.ts` evaluates whether the channel
is currently busy:

- **Channel is locked**:
  - If the message matches natural stop phrasing, it requests a natural stop via
    `requestNaturalStopForLockedTurn()` and returns `"ignore"`.
  - If the message is an eligible conversational follow-up from the same user, it enqueues the message
    via `queueFollowUpForLockedTurn()`, signals an interrupt to active streaming, and returns `"queued"`.
  - If the message matches a trigger and passes rate limits and cooldowns, it enqueues the message via
    `enqueueBusyChannelMessage()` for FIFO replay and returns `"queued"`.
- **Channel is free**: verifies access rules and reply criteria. If admitted, the message returns
  disposition `"run"` and proceeds to the channel lock.

## Constraints and rationale

- **Fail-early resource protection**: sendability checks and user blacklist gates run before STT transcription
  and model requests, avoiding quota consumption on delivery targets that cannot receive a response.
- **Author-agnostic DM keys**: relying on channel recipient metadata and `systemTriggerIdentity` rather
  than message author protects DM state resolution during automated self-replies and reminders.
- **In-place content mutation**: writing transcribed text into `message.content` lets downstream prompt
  and memory builders process audio identically to standard text messages.

## Source pointers

- `src/utils/chat/admission.ts`: `evaluateChatAdmission()` and channel scope resolution.
- `src/utils/chat/admissionQueue.ts`: `evaluateAdmissionQueueAndTriggerGate()` and busy-channel decision tree.
- `src/utils/discord/stream/sendFailureCache.ts`: refusal tracking preventing wasted generation turns.
- `src/utils/chat/triggerProcessor.ts`: trigger matching and stop phrasing checks.
