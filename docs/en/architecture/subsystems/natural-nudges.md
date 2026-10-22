---
title: "Natural Nudges"
aiGenerated: true
---

Natural Nudges lets personas speak without being triggered. The code lives in
`src/modules/natural-nudges/`: SQL in `db/repositories.ts`, the runtime in `runtime/`, and the
`/config` pages in `discord/`. This page covers both modes: episodes, which start something in a
quiet channel, and [Chime-ins](#chime-ins), which join a live conversation. User-facing behavior is
on the [feature page](/features/chatting-personality/natural-nudges/). The panel calls an episode an
idle nudge and a Chime-in an active nudge, and labels the `reach_out`, `revive`, `new_topic`, and
`alter_talk` categories Ping User, Revive Topic, Start Topic, and Play Scene.

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
       ├─ heat → episodes per day → due time, level's daily cap, waking hours
       ├─ lull: effective channels quiet for 1-3 hours (gateway lastMessageId)
       ├─ planner model: llm_id, else the chat model; no_model abort and backoff unless it resolves
       ├─ persona raffle → Reach-out target lottery → category raffle → episode raffle
       │    └─ Alter Talk: scene partner draw
       └─ detached: planEpisode → recheckBeforeSend → tomoriChat({ naturalNudge, sceneTurn? })
                                                       └─ fire row + one agenda row per speaker
```

## State: events, not meters

Nothing decays on a job. Every meter is an elapsed-time read over the fire log
(`natural_nudge_fires`): persona, category, and episode rest; the level's daily cap; the pending
opener; and the unanswered streak. Heat and waking hours come from `stat_counters`:

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
lock (`runtime/inFlight.ts`, one nudge per server across both modes), the rolled lull, the
retry-after-abort time, and a 15-minute cache of heat and waking hours. A restart only re-rolls them.

## Constraints

- **Abort on any doubt; never queue.** An abort posts nothing and writes no fire row. A nudge
  that meets a busy channel is dropped in `admissionQueue.ts` rather than queued behind the turn.
  After an abort the episode stays due and waits a fresh lull, so it cannot retry every cycle. The
  one exception is an Alter Talk scene's later turns, which turn 0 queues itself (below).
- **Re-check right before sending.** `recheckBeforeSend` reads settings, caps, the persona, the
  persona channel whitelist, and the channel's last message fresh. Any message after the lull was
  measured cancels the nudge.
- **Caps follow the frequency level.** `EPISODE_DAILY_CAPS` and `CHIME_IN_DAILY_CAPS` in
  `runtime/tuning.ts` map each level to its daily ceiling, so the panel estimate, the episode
  re-check, and the Chime-in check read one source. Episode category tickets are fixed there too
  (`EPISODE_CATEGORY_WEIGHTS`), since the mix is operator tuning rather than a server setting.
- **Failure stop.** Planner failures after their one format retry, and generation errors, count
  toward `server_natural_nudge_runtime_state.consecutive_failures`; three stop the server until a
  normal turn succeeds there (`text_generated` newer than `stopped_at`). Aborts never count. Episodes
  and Chime-ins each lift the stop when they read it (`runtime/failureStop.ts`), because a server
  with episodes off is never evaluated by the episode timer.
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
  The placeholder is sent only when the history read succeeds and comes back empty, and it is deleted
  again before the turn starts, so the turn borrows a message object whose blank line is already gone
  from the channel.
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
episode needs a target. One query,
`listReachOutCandidates`, applies every hard exclusion in SQL and is read fresh rather than through
`userCache`, so the before-send re-check (`onlyUserId`) sees an opt-out made a moment earlier.

| Stage | Rule |
|---|---|
| Interaction gate | Own `message_sent` with this persona's lineage in the server within 14 days. A memory alone never qualifies: memories can come from talk around Tomori rather than to her, and they carry no server, so a pointer persona would otherwise reach people it only knows from another server |
| Hard exclusions | `natural_nudge_opt_out`, `PrivacyLevel.FULL`, `personalization_blacklist`, an active `persona_user_blocks` row for this persona; bots, external bridge IDs, members who left, and members who can view none of the persona's quiet channels are dropped when drawn |
| Relationship gate | A memory with this lineage (or lineage 0) touched in the last 30 days, or a live short-term memory with it in this server (candidates' short-term memory is warmed from the database in one query first, because the cache starts empty after a restart). Memories count only when the persona has `personal_memories_enabled` |
| Lottery | Tickets from capped counts of the member's turns with this lineage in this server and short-term memory channels, current activity, and penalties for a ping inside the episode rest window (`reachOutTickets`); never below 1. Memories only gate eligibility and feed the planner, because they carry no server |

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
  `interruptNudgeScene` (`channelQueue.ts`), which discards the queued turns that carry both
  `sceneTurn` and `naturalNudge` with the `scene_interrupted` reason. `/generate scene` turns carry no
  nudge marker and keep running. The opener and its agendas stay.
- **The next speaker catches the member.** `interruptNudgeScene` returns the first dropped turn's
  persona, or the scene persona speaking now when nothing was queued, as
  `nudgeSceneCatcherPersonaId`. A message that triggers on its own (a name, a mention, a reply) keeps
  normal persona selection; any other message is queued anyway and answered by the catcher, subject to
  the member's own whitelist, spotlight, and access gates. It is a normal member turn.
- **The scene's own lines start nothing.** While a nudge turn holds the channel lock, while nudge turns
  wait in its queue, and for five seconds after the last one releases, admission ignores persona
  messages there (`nudge_output`). Otherwise a line naming another persona would queue an ordinary
  persona reply after the scene, credited to the last member as engagement.
- **A failed turn ends the scene.** The channel queue only advances when a lock is released, so
  `tomoriChat` itself drops the remaining turns whenever a nudge scene turn (the opener included) is
  rejected at admission or delivers nothing. An empty reply that is being retried does not count,
  because the retry decides for itself. A scene never plays without its opener or with a speaker
  missing, and its turns never wait in the queue for an unrelated turn to release them.
- **Targets are not pinged.** Scheming draws a target like a Reach-out, so naming, short-term memory,
  tools, and the mention allow-list follow it, but the opener is not forced to ping them.
- **Re-check.** `recheckBeforeSend` also confirms each partner still exists and is allowed in the
  chosen channel.

## Chime-ins
<!-- anchor: chime-ins -->

A Chime-in has no planner. A message counter decides when to look, one matcher call decides whether
the conversation matches a persona's interest, and the winner gets a plain turn.

```
messageCreate (chimeIn.ts, not awaited)
  └─ observeChimeInMessage
       ├─ persona message → counter starts over; an open check's watch notes it
       ├─ human message in an effective channel (a thread counts toward its parent)
       │    └─ count reaches its roll (chimeInTripRange) → claim the server → detached check
       └─ runChimeInCheck
            ├─ Phase A, fresh reads: settings, stop, daily cap, 1 per channel per hour, matcher
            ├─ options: interests of personas with talkativeness above 0 allowed in the channel
            ├─ matchChimeIn over the last 5 messages → interest or none
            ├─ winner: an owner of that interest who did not speak in the window; 10% detour
            ├─ wait 15-45 s → recheckBeforeSend, one re-match when 5 posted
            └─ tomoriChat({ naturalNudge, borrowsTriggerMessage }) → fire row (mode chime_in)
```

- **Counter in memory.** `ChimeInCounter` keeps one count per listed channel, shared with its threads,
  so a conversation that moves into a thread keeps its count. The check reads and speaks in the
  channel or thread whose message tripped it, and the hourly cap covers a parent and its threads
  together (a fire row stores the thread; `listedChannelOf` maps it back through the channel cache). The trip range starts at 15-40 human messages at heat 15, scales by 15 over heat
  (held to ½-4), then by the frequency level, and nothing counts below heat 1. Any check that does
  not fire rests the channel for 10 minutes before a new roll. A restart only resets the counts.
- **Gate cache.** The counter reads settings, effective channels, and heat through a 5-minute
  [cache](/architecture/subsystems/caching/) instead of the database, because it runs on every guild
  message. Everything after the trip reads fresh.
- **Matcher, one boundary, two backends** (`runtime/matcher.ts`). With a Decision model in the
  server's `decision_model_id`, it asks one `choice` question; the selected model must list `choice`
  in `supported_primitives`, and a selected model that cannot answer does not fall back. Without one,
  it asks the Natural Nudges model (`resolvePlannerModel`) for a structured enum of the option IDs at
  temperature 0, with one format retry. Both use the wording the false-fire evaluation measured, up
  to 25 interests plus `none` (some Decision models reject more than 26 options; personas whose new
  labels would overflow sit the check out), and argmax. A refused, blocked, or unparseable answer
  reads as `none`, and so does a choice that is not its own most likely option. A transport failure
  is recorded but never counts toward the failure stop, so a broken matcher cannot stop episodes.
- **Member text stays data.** The evidence is `Name: text` lines read through the same privacy filter
  as planner transcripts. The Natural Nudges model sees it inside an escaped `<<< >>>` block; the
  Decision API receives it as its separate evidence field.
- **Winner rule.** Shared labels become one option with every owner, under the first owner's
  description. Owners who spoke in the window are dropped, since without probabilities there is no
  runner-up; if none remain, nothing fires.
- **Detours.** 10% of the time another persona allowed in the channel, with talkativeness above 0, a
  `message_sent` in the last 60 days, and no message in the window, takes the turn. Its tickets are talkativeness times rested
  share times an underdog boost of 1-4 from its share of the top persona's 30-day count. The fire row
  records `detour`.
- **Send permission.** Phase A and the re-check skip a channel where the bot cannot send, so a
  read-only listed channel never costs a matcher call.
- **Re-check.** After the delay, `recheckBeforeSend` repeats the Phase A reads and the speaker's
  persona checks, then aborts when a persona spoke in the channel or the channel is locked. When five
  members posted, it runs the matcher once more on the newest five messages with the same options;
  the reply speaks only if the same interest wins again and the speaker is not in that window,
  otherwise it aborts as `window_gone`.
- **Plain turn.** The turn carries `naturalNudge` with no tools and `borrowsTriggerMessage`, and no
  brief, agenda, or injected context, so it skips the same stats and memory writes as an episode.
  Chime-ins have no pending or unanswered rules; they count toward the shared failure stop.
- **Telemetry.** One `natural_nudge_chime_in` row per check: outcome, phase, reason, heat, matcher
  kind and model, option count, the Decision margin over `none`, detour, matcher tokens, and whether
  a second call ran with its own tokens.

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
- `src/modules/natural-nudges/runtime/chimeIns.ts`: Chime-in counter, check, re-check, and turn.
- `src/modules/natural-nudges/runtime/matcher.ts`: the Chime-in matcher and its two backends.
- `src/modules/natural-nudges/runtime/tuning.ts`: every pacing and selection constant (heat, lull,
  waking hours, rest windows, stops, retention, Reach-out windows and points, scene length and
  partner count, episode category weights and daily caps, Chime-in trip range, daily cap, window,
  delay, and detours). Schema and Discord limits stay with their owners.
- `src/modules/natural-nudges/db/repositories.ts`: every Natural Nudges query.
- Related: [Database Schema](/architecture/subsystems/database-schema/),
  [Prompt Snapshot](/architecture/subsystems/prompt-snapshot/),
  [Persona Presets](/architecture/subsystems/persona-presets/).
