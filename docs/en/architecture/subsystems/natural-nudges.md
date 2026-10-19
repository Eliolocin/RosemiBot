---
title: "Natural Nudges"
aiGenerated: true
---

Natural Nudges lets personas speak without being triggered. The code lives in
`src/modules/natural-nudges/`: SQL in `db/repositories.ts`, the runtime in `runtime/`, and the
`/config` pages in `discord/`. This page covers episodes, the silence-driven nudges; user-facing
behavior is on the [feature page](/features/chatting-personality/natural-nudges/).

## Flow and ownership

Every episode passes three phases. Only Phase A runs inside the scheduled work cycle, so model
calls never delay reminders.

| Phase | Owner | Work |
|---|---|---|
| A, decide | `NaturalNudgeProcessor` (`runtime/processor.ts`), the third processor in `ScheduledWorkCoordinator` | Plain code, no model call: due time, waking hours, lull, then the persona, category, and episode raffles |
| B, plan | `planEpisode` (`runtime/planner.ts`) | One structured-output call to the server's planner model: channel, opener direction, agenda, or `proceed: false` |
| C, speak | `runEpisodeAttempt` (`runtime/runner.ts`) | Fresh re-checks, then a normal `tomoriChat` turn on the channel's latest message, run like reminders |

Phase A runs every 60 seconds on the coordinator's reconcile tick, because no due-time column
exists to wake on. It reads servers with episodes on and at least one allowed channel, and skips
any server that has an attempt in flight.

```
reconcile tick
  └─ NaturalNudgeProcessor.processDueEpisodes
       ├─ pending opener?  → resolve its verdict, stop
       ├─ failure or unanswered stop? → stop
       ├─ heat → episodes per day → due time, daily cap, waking hours
       ├─ lull: allowed channels quiet for 1-3 hours (gateway lastMessageId)
       ├─ persona raffle → category raffle → episode raffle
       └─ detached: planEpisode → recheckBeforeSend → tomoriChat({ naturalNudge })
                                                       └─ fire row + agenda row
```

## State: events, not meters

Nothing decays on a job. Every meter is an elapsed-time read over the fire log
(`natural_nudge_fires`): persona, category, and episode rest; the daily cap; the pending opener; and
the unanswered streak. Heat and waking hours come from `stat_counters`:

- **Heat** is the server's `message_sent` per day, each day halved every three days
  (`computeHeat` in `runtime/meters.ts`).
- **Waking hours** come from 30 days of `active_hour`, with a fixed local night below 50 turns.

Nudge turns must never feed either input. `naturalNudge` on the chat input makes
`postTurnEffects` skip `message_sent` and `active_hour`, and the empty-response retry carries the
marker. Without that, each nudge would raise its own heat and drag waking hours toward its fire
times. Token and model stats still record.

Phase A also keeps a few values in memory, by the "what breaks on restart?" test: the in-flight
lock, the rolled lull, the retry-after-abort time, and a 15-minute cache of heat and waking hours.
A restart only re-rolls them.

## Constraints

- **Abort on any doubt; never queue.** An abort posts nothing and writes no fire row. A nudge
  that meets a busy channel is dropped in `admissionQueue.ts` rather than queued behind the turn.
  After an abort the episode stays due and waits a fresh lull, so it cannot retry every cycle.
- **Re-check right before sending.** `recheckBeforeSend` reads settings, caps, the persona, the
  persona channel whitelist, and the channel's last message fresh. Any message after the lull was
  measured cancels the nudge.
- **Failure stop.** Planner failures after their one format retry, and generation errors, count
  toward `server_natural_nudge_runtime_state.consecutive_failures`; three stop the server until a
  normal turn succeeds there (`text_generated` newer than `stopped_at`). Aborts never count.
- **Server keys only.** The planner resolves through `resolveServerStructuredModel`
  (`src/utils/provider/serverStructuredOutput.ts`), which never uses a personal key, and the
  turn planner routes the nudge turn's text credentials to the server too. Servers in
  `user_byok_mode` and DM workspaces never run episodes.
- **The borrowed trigger lends no identity.** Phase C passes the channel's newest message to
  `tomoriChat` as its trigger, but its author is a bystander. `borrowsTriggerMessage` (shared with
  random triggers) puts the turn on the reminder path: server text key only, and no blacklist,
  role-whitelist, spotlight, or user-block gate from that author (only the persona channel
  whitelist applies). A guild turn uses the guild locale and the server's Deliberate Tool Mode,
  ignoring that author's language and personal override. Their name still fills `{user}`. Nudge turns also skip the reunion note and presence write, and the
  "continue your last message" directive. Deliberate Tool Mode admits the episode's tools from
  `naturalNudge.toolNames`, because no human message carries their trigger words.
- **The anchor is compared by order.** A deleted newest message stays in the gateway's
  `lastMessageId`, so the runner aborts only when the fetched anchor is newer than the recorded ID.
  The placeholder is sent only when the history read succeeds and comes back empty.
- **Private channels plan alone.** A private channel is offered to the planner by itself, so its
  history never shapes a nudge in another channel.
- **Agendas belong to one persona.** `natural_nudge_agendas` rows key by `(message_disc_id,
  persona_id)`. Context rebuild and the prompt snapshot render an agenda above its opener only for
  that persona (`runtime/agendas.ts`). The agenda expires when the opener leaves the context window.
- **Opener anchoring.** The fire row and agenda anchor to `GenerationTurnResult.firstDeliveredMessageId`,
  carried from the stream state. When a tool delivered the opener, the runner looks for the first
  bot or managed-webhook message after the anchor instead.

## Episodes as data

Built-in episodes (`BUILTIN_EPISODES` in `runtime/episodes.ts`) and custom episodes share one shape:
category, planner brief, agenda hint, prerequisites, and recommended tools. Prerequisites come from a
fixed registry: `hanging_conversation` and `tool:<name>`, where tool availability is what the
persona's turn would be offered. An unknown prerequisite makes an episode ineligible rather than
silently dropping the check. Only categories with a runner (`ACTIVE_NATURAL_NUDGE_CATEGORIES`) take
part in the raffle.

## Pointer personas

`persona_natural_nudge_configs` holds a persona's talkativeness and interests. A missing row reads
as the live preset defaults (`persona_presets.natural_nudge_*`) for an unforked pointer and as the
column defaults otherwise. `materializeIfPointer` copies the preset values into a row, and
re-pointing a persona at a preset deletes the row so it reads the preset again.

## Source pointers

- `src/modules/natural-nudges/runtime/processor.ts`: Phase A.
- `src/modules/natural-nudges/runtime/runner.ts`: Phases B and C, re-checks, fire recording.
- `src/modules/natural-nudges/runtime/meters.ts`: heat, due time, waking hours, raffles.
- `src/modules/natural-nudges/db/repositories.ts`: every Natural Nudges query.
- Related: [Database Schema](/architecture/subsystems/database-schema/),
  [Prompt Snapshot](/architecture/subsystems/prompt-snapshot/),
  [Persona Presets](/architecture/subsystems/persona-presets/).
