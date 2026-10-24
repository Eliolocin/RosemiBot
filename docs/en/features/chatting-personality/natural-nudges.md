---
title: "Natural Nudges"
description: "Let your TomoriBot personas start conversations when a Discord channel goes quiet and join ones that match their interests, at a pace that follows how active your server is."
sidebar:
  order: 4
---

Natural Nudges lets your personas speak without being mentioned:

- **Idle nudges** start conversations when a channel goes quiet.
  - They slow down when nobody answers and stop after several unanswered nudges, until someone
    talks to TomoriBot again.
- **Active nudges** join conversations about a persona's interests.

The pace follows how often members talk to TomoriBot. Servers that rarely talk to her get neither kind, DMs never get nudges (for now).

## Idle nudges
<!-- anchor: idle-nudges -->

Idle nudges wait until a channel has been quiet for a while, during the hours your server is
usually awake. There are 28 built-in idle nudges across four categories. You can adjust them and add
your own for the whole server in `/nudge-studio`, and each persona can have idle nudges of its own
(see [Persona idle nudges](#persona-idle-nudges)).

| Category | What it does | Prerequisites | Notes |
|---|---|---|---|
| <a id="ping-user"></a>Ping User | Checks in on a member or shares something they might like. | Recent conversation with this persona in this server, a memory, and permission to ping. Full privacy, personalization blacklists, and persona blocks exclude members. | Frequent contacts are favored; recent pings reduce repeat chances. Opt out in `/personal config` > `Privacy` > `Pings from Personas`. |
| Revive Topic | Picks up an unfinished conversation. | A conversation left hanging. | N/A |
| Start Topic | Raises something new, often about the persona's interests. | No extra category requirements. | N/A |
| <a id="play-scene"></a>Play Scene | Starts a short exchange between two or three personas. | Another persona allowed to nudge in that channel. | Talkative personas join more often; Silent ones never do. If a member posts, the scene stops and a persona answers them. Surprise scenes do not ping their subject. |

### Choose and create idle nudges

Open `/nudge-studio` (requires `Manage Server`) to browse each category. The colored dot shows
whether a nudge is on, missing a prerequisite, or off. Each row ends with its source: `Built-in`,
`Server custom`, or `For <persona>` for a nudge a persona owns. Categories with more than 12 rows
continue on further pages.

`Toggle Availability` chooses which personas can use a nudge:

- **All checked:** every persona can use it, including personas you add later.
- **Some checked:** only those personas can use it. New personas stay out until you check them.
- **None checked:** the nudge is off.

A persona-owned nudge has one checkbox, `Available to <persona>`, because only its owner can use it.
Unchecking it turns it off without deleting it.

Limiting a server nudge to one persona does not move it onto that persona's page. It stays a server
nudge, and only the persona's own entries travel with its persona card.

Below the list you can add up to 25 of your own for the whole server. Choosing a server nudge or a
persona-owned nudge opens it for editing, and the same entry is editable on the persona's `Nudges`
page. New nudges made here are always server nudges. `Remove Nudges` lists the editable nudges on the
current page, and unchecking one removes it. Each one has:

- **Name**: the label shown in the studio.
- **Brief**: what the persona sets out to do. Write `{persona}` where its name goes,
  `{partner}` where the other persona in a Play Scene goes, and `{target}` where the member it is
  about goes.
- **Agenda** (optional): the kind of small goal the persona keeps after its opener.
- **Prerequisites**: what must be true before the idle nudge can run, such as a recent memory or an
  available tool. The category requirements in the table apply automatically.
- **Recommended tools**: tools the persona is encouraged to use when it has them. The idle nudge
  still runs without them. A tool picked under `Prerequisites` is already included, so it is dropped
  from this list when you save.

### Persona idle nudges

A persona can carry idle nudges that belong to its character, such as Rose checking a cosplay fit or
Aphel recommending an album. They add to the built-in and server nudges and do not replace them.

Open `/config` > `Persona` > `Nudges`. `Idle Nudges` sits below `Interests`:

- `Select or add an idle nudge...` adds one with `+ Add <category>` or edits an existing one. All four
  categories are available, with the same fields as a server nudge. A persona holds up to 20,
  separate from the server's 25.
- `Toggle availability...` switches individual entries on or off for this persona.
- `Remove Idle Nudges` deletes the entries you uncheck.
- `Restore Preset Nudges` appears for a persona that follows an official preset and has its own copy of the list.

How they run:

- Only the owning persona starts them. In a Play Scene the owner leads, and any other persona that
  can nudge may join as the partner.
- They follow the same prerequisites, quiet hours, frequency level, and daily limit as every other
  idle nudge. More entries give a persona more to choose from but do not make it speak more often.
- Interests drive Active Nudges. Persona idle nudges drive Idle Nudges only.

Official presets ship with idle nudges. A persona that still follows its preset reads that list as
the preset is updated. The first time you add, edit, or remove an entry, the persona gets its own copy
of the whole list, and later preset updates no longer change it. Switching an entry on or off does not
make a copy. `Restore Preset Nudges` replaces the persona's list with the preset's current list and
keeps its interests, talkativeness, and the on/off choices for entries that still exist.
`Resync with Preset` in `Identity & Personality` also resets the list and the on/off choices.

Persona cards (`/persona export`) include the persona's idle nudges, from either the preset or its own
copy, and importing the card restores them. On/off choices are local to a server and are not exported,
so imported entries start switched on. Server nudges never go into a card. An older card that still
matches an official preset follows that preset's current idle nudges. Other older cards import with
no persona idle nudges.

### Hidden agendas

Each idle nudge gives the persona a small private goal, such as "find out who else likes this
anime", to guide later replies. In a Play Scene, each persona gets its own goal. The goal expires
when the opener leaves the persona's conversation history.

## Active nudges
<!-- anchor: active-nudges -->

TomoriBot periodically checks recent messages for conversations about your personas' interests.
Busier servers and higher active nudge frequency settings get more frequent checks. A passing
mention of an interest does not count.

A persona with a matching interest usually joins in, with quieter personas getting preference.
Occasionally, another persona takes the turn. Personas that just spoke sit it out.

The persona waits briefly before replying to give the conversation time to develop. If enough new
messages arrive during that delay, TomoriBot checks that the conversation still matches the same
interest. If the topic has changed, another persona has spoken, or the channel is busy, the nudge is
dropped.

Active nudges have channel cooldowns and a server daily limit. Threads share their parent channel's
cooldown. A persona needs interests on its `Nudges` page to take part, and Silent personas never do.

## Settings

Natural Nudges is on by default. Open `/config` > `Plugins` > `Natural Nudges` to change it
(requires `Manage Server`):

- **Modes:** turn idle and active nudges on or off separately.
- **Channels:** choose channels, or leave the list empty to use recent TomoriBot conversation
  channels automatically, excluding roleplay channels.
- **Frequency:** choose `Rare`, `Gentle` (default), `Normal`, or `Lively` for each mode. The page
  estimates the pace for your server; daily limits keep nudges and checks within that level.
- **Models:** you can change either model.
  - `Idle Nudge Planner` decides what a persona will say to start an idle nudge and gives it a
    private goal for follow-up replies. Defaults to your chat model.
  - `Active Nudge Checker` checks whether a conversation matches a persona's interests. Selected
    automatically; a small, cheap model or a Decision model suits its frequent checks.

## Persona settings

Open `/config` > `Persona` > `Nudges` to set:

- **Talkativeness:** how often the persona speaks up. `Silent` personas do not nudge.
- **Interests:** up to 8 topics the persona likes, with descriptions and examples.
- **Idle Nudges:** up to 20 idle nudges only this persona uses, described under
  [Persona idle nudges](#persona-idle-nudges).

Official presets include these settings. `/persona generate` suggests interests for new personas;
`Generate Interests` adds new ones through your current text model. Persona exports include all three.

## What gets stored

Settings, custom nudges, interests, and persona idle nudges are saved with your server configuration. Nudge history,
including whether anyone answered and who was pinged, is kept for 30 days. Agendas are kept for
up to 90 days.

- **Server config:** `/reset` restores nudge settings and removes custom nudges. Config exports
  and imports carry settings and custom nudges, excluding the server-specific channel list. Persona
  idle nudges stay with their persona through a reset and travel in its persona card instead.
  `/persona default` and deleting a persona remove its idle nudges.
- **Personal config:** your `Pings from Personas` choice survives `/reset personal config`, is
  included in `/export personal config`, and is erased by `/personal nuke`.
