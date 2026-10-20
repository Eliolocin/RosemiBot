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
| B, plan | `planEpisode` (`runtime/planner.ts`) | One structured-output call to the planner model (`resolvePlannerModel`): channel, opener direction, agenda, or `proceed: false` |
| C, speak | `runEpisodeAttempt` (`runtime/runner.ts`) | Fresh re-checks, then a normal `tomoriChat` turn on the channel's latest message, run like reminders |

Phase A runs every 60 seconds on the coordinator's reconcile tick, because no due-time column
exists to wake on. Natural Nudges is on by default, so `listEnabledEpisodeServers` starts from guild
servers with `message_sent` inside the heat window, not from config rows: a server that never opened
the page runs on the column defaults, and a server with no recent activity is never read. A server
that turned episodes off is skipped, as is any server with an attempt in flight.

```
reconcile tick
  └─ NaturalNudgeProcessor.processDueEpisodes
       ├─ pending opener?  → resolve its verdict, stop
       ├─ failure or unanswered stop? → stop
       ├─ heat → episodes per day → due time, daily cap, waking hours
       ├─ lull: effective channels quiet for 1-3 hours (gateway lastMessageId)
       ├─ planner model: llm_id, else the chat model; no_model abort and backoff unless it resolves
       ├─ persona raffle → Reach-out target lottery → category raffle → episode raffle
       │    └─ Alter Talk: scene partner draw
       └─ detached: planEpisode → recheckBeforeSend → tomoriChat({ naturalNudge, sceneTurn? })
                                                       └─ fire row + one agenda row per speaker
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
marker. It also skips the short-term memory write: a nudge answers nobody, and storing it would give
whoever spoke last a short-term memory, which the Reach-out gate counts as a relationship. Without that, each nudge would raise its own heat and drag waking hours toward its fire
times. Token and model stats still record.

## Channels and model

- **Effective channels** (`resolveEffectiveChannelIds` in `runtime/channels.ts`): a non-empty
  `channel_disc_ids` is used exactly. An empty list means automatic: the distinct `channel_turn`
  keys of the last 14 days, minus Channel Rules `rp_channel_ids`. `channel_turn` is recorded beside
  `active_hour` with the channel ID (a thread's parent), and turns that borrow a trigger skip it, so
  only human-triggered turns make a channel eligible. 14 days is heat's horizon; with stat tracking
  off, the automatic set stays empty along with heat. Fire-time admission still enforces send
  permission, the channel whitelist, and persona access.
- **Planner model** (`resolvePlannerModel` in `runtime/model.ts`): `llm_id` when pinned, else the
  server's chat model (`tomoriState.llm`, never a persona override). Either must pass
  `resolveServerStructuredModel`; a failed pin does not fall back. Without a usable model the
  server stays idle and the plugin page says why. Telemetry records the model that planned.

Phase A also keeps a few values in memory, by the "what breaks on restart?" test: the in-flight
lock, the rolled lull, the retry-after-abort time, and a 15-minute cache of heat and waking hours.
A restart only re-rolls them.

## Constraints

- **Abort on any doubt; never queue.** An abort posts nothing and writes no fire row. A nudge
  that meets a busy channel is dropped in `admissionQueue.ts` rather than queued behind the turn.
  After an abort the episode stays due and waits a fresh lull, so it cannot retry every cycle. The
  one exception is an Alter Talk scene's later turns, which turn 0 queues itself (below).
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
  ignoring that author's language and personal override. Their name still fills `{user}`, except
  in a Reach-out (below). Nudge turns also skip the reunion note and presence write, and the
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

## Reach-out targets

`drawReachOutTarget` (`runtime/targets.ts`) runs once per attempt, after the persona raffle and before
the category raffle, because three prerequisites read the drawn target. It is skipped when no runnable
episode with a non-zero category weight needs a target. One query,
`listReachOutCandidates`, applies every hard exclusion in SQL and is read fresh rather than through
`userCache`, so the before-send re-check (`onlyUserId`) sees an opt-out made a moment earlier.

| Stage | Rule |
|---|---|
| Interaction gate | Own `message_sent` in the server within 14 days. A memory alone never qualifies, because memories can come from talk around Tomori rather than to her |
| Hard exclusions | `natural_nudge_opt_out`, `PrivacyLevel.FULL`, `personalization_blacklist`, an active `persona_user_blocks` row for this persona; bots, external bridge IDs, members who left, and members who can view none of the persona's quiet channels are dropped when drawn |
| Relationship gate | A memory with this lineage (or lineage 0) touched in the last 30 days, or a live short-term memory with it in this server (candidates' short-term memory is warmed from the database in one query first, because the cache starts empty after a restart). Memories count only when the persona has `personal_memories_enabled` |
| Lottery | Tickets from capped memory and short-term memory counts, current activity, and penalties for a ping inside the episode rest window (`reachOutTickets`); never below 1 |

Prompt exposure follows a normal turn's privacy rules: the planner sees the target's recent memories
only at `PrivacyLevel.MINIMAL` with `personal_memories_enabled`, and their activity only at minimal
privacy with the GuildPresences intent. `recent_memory` and `presence_activity` pass only when that
exposure exists, so an episode never plans around data the planner cannot see.

The planner plans only among channels the target can view, and the before-send re-check confirms that
view permission again. Member-written text (the target's name, activity, and memories) appears only inside the
`<target>` block, escaped so it cannot close the block; briefs and the opener instruction refer to the
target rather than quoting their name, so a crafted nickname or activity cannot become an instruction.

The Phase C turn carries `naturalNudge.targetUserDiscId`, which changes these things and nothing else:

- **Naming.** `resolveNamingSubject` (`turnPlanner.ts`) fills `{user}` and the triggerer name from the
  target's row, live name, and per-persona naming. Credentials, quotas, and stats stay with the
  borrowed trigger's author.
- **Short-term memory and tools.** The opener reads the target's short-term memory
  (`shortTermMemoryUserId`), and tool calls act for the target (`toolLoop.ts`), so a reminder or memory
  the opener creates defaults to them rather than to a bystander.
- **Mentions.** The target's handles join the forced mentions, and `mentionableUserIds` makes the
  stream send `allowedMentions` with only that user and no `parse`, so the opener cannot ping roles,
  `@everyone`, or another member. `interact_with_recent_message` honors the same list. After delivery,
  `ensureDiscordUserMention` posts a bare mention if the opener omitted it, through the persona's
  webhook for an alter (`sendAlterPersonaMention`).
- **Records.** `target_user_id` is written on the fire row (the lottery penalty reads it) and on the
  agenda rows, so erasing the user deletes both through the foreign key.

## Alter Talk scenes

An Alter Talk episode reuses the `/generate scene` machinery: the runner passes a `sceneTurn`, and
`turnPlanner.ts` queues the remaining turns at the front of the channel queue under turn 0's lock
(`queueScenePersonaJobsAtFront`).

- **Partners.** `drawScenePartners` (`runtime/partners.ts`) draws one partner, and a second at
  `ALTER_TALK_SECOND_PARTNER_CHANCE`, by the lead's own ticket formula (talkativeness times rested
  share) among personas whose channel whitelist shares a channel with every speaker so far. The
  planner channels narrow to that shared set, and `two_personas` passes when such a partner exists.
  Every Alter Talk episode needs one, even a custom one that omits `two_personas`.
- **Script.** The planner returns `script` (speaker numbers, 2-4 turns, lead first, no speaker twice
  in a row, everyone at least once) and one `partner_agendas` entry per partner. `sceneScriptIssues`
  checks every one of these rules, the lengths included, because Anthropic's output grammar rejects
  `minItems` above 1; a violation gets the one format retry.
- **Private goals per speaker.** `SceneTurnMetadata.turnContextItems` replaces turn 0's injected
  context for each queued turn, so a partner's first turn carries only its own agenda and never the
  lead's. The fire row and every speaker's agenda row anchor to turn 0's opener, written when turn 0
  settles.
- **Queued turns stay nudge turns.** The queued jobs carry `naturalNudge` and `borrowsTriggerMessage`,
  so they skip stats and the short-term memory write and keep the borrowed author's gates off.
- **Members interrupt.** Any real member message, before any admission gate can drop it, calls
  `clearQueuedNudgeSceneWork` (`channelQueue.ts`), which discards the queued turns that carry both
  `sceneTurn` and `naturalNudge` with the `scene_interrupted` reason. `/generate scene` turns carry no
  nudge marker and keep running. The opener and its agendas stay.
- **A failed turn ends the scene.** The channel queue only advances when a lock is released, so
  `tomoriChat` itself drops the remaining turns whenever a nudge scene turn (the opener included) is
  rejected at admission or delivers nothing. An empty reply that is being retried does not count,
  because the retry decides for itself. A scene never plays without its opener or with a speaker
  missing, and its turns never wait in the queue for an unrelated turn to release them.
- **Targets are not pinged.** Scheming draws a target like a Reach-out, so naming, short-term memory,
  tools, and the mention allow-list follow it, but the opener is not forced to ping them.
- **Re-check.** `recheckBeforeSend` also confirms each partner still exists and is allowed in the
  chosen channel.

## Episodes as data

Built-in episodes (`BUILTIN_EPISODES` in `runtime/episodes.ts`) and custom episodes share one shape:
category, planner brief, agenda hint, prerequisites, and recommended tools. Prerequisites come from a
fixed registry: `hanging_conversation`, the three target facts (`relationship_user`, `recent_memory`,
`presence_activity`), `two_personas`, and `tool:<name>`, where tool availability is what the persona's
turn would be offered. Every Reach-out needs a drawn target, even a custom one that omits
`relationship_user`, and so does any episode listing one of the three target facts; outside a scene,
such an episode pings its target too. An unknown prerequisite makes an episode ineligible rather than
silently dropping the check.

## Pointer personas

`persona_natural_nudge_configs` holds a persona's talkativeness and interests. A missing row reads
as the live preset defaults (`persona_presets.natural_nudge_*`) for an unforked pointer and as the
column defaults otherwise. `materializeIfPointer` copies the preset values into a row, and
re-pointing a persona at a preset deletes the row so it reads the preset again.

## Source pointers

- `src/modules/natural-nudges/runtime/processor.ts`: Phase A.
- `src/modules/natural-nudges/runtime/runner.ts`: Phases B and C, re-checks, fire recording.
- `src/modules/natural-nudges/runtime/meters.ts`: heat, due time, waking hours, raffles.
- `src/modules/natural-nudges/runtime/targets.ts`: Reach-out gates, lottery, and re-check.
- `src/modules/natural-nudges/runtime/partners.ts`: Alter Talk partner draw.
- `src/modules/natural-nudges/runtime/tuning.ts`: every pacing and selection constant (heat, lull,
  waking hours, rest windows, stops, retention, Reach-out windows and points, scene length and
  partner count). Schema and Discord limits stay with their owners.
- `src/modules/natural-nudges/db/repositories.ts`: every Natural Nudges query.
- Related: [Database Schema](/architecture/subsystems/database-schema/),
  [Prompt Snapshot](/architecture/subsystems/prompt-snapshot/),
  [Persona Presets](/architecture/subsystems/persona-presets/).
