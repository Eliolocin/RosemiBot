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
usually awake. There are 28 built-in idle nudges across four different categories, which you can adjust (or even add your custom ones) in the `/nudge-studio` command.

| Category | What it does | Prerequisites | Notes |
|---|---|---|---|
| <span id="ping-user">Ping User</span> | Checks in on a member or shares something they might like. | Recent conversation with this persona in this server, a memory, and permission to ping. Full privacy, personalization blacklists, and persona blocks exclude members. | Frequent contacts are favored; recent pings reduce repeat chances. Opt out in `/personal config` > `Privacy` > `Pings from Personas`. |
| Revive Topic | Picks up an unfinished conversation. | A conversation left hanging. | N/A |
| Start Topic | Raises something new, often about the persona's interests. | No extra category requirements. | N/A |
| <span id="play-scene">Play Scene</span> | Starts a short exchange between two or three personas. | Another persona allowed to nudge in that channel. | Talkative personas join more often; Silent ones never do. If a member posts, the scene stops and a persona answers them. Surprise scenes do not ping their subject. |

### Choose and create idle nudges

Open `/nudge-studio` (requires `Manage Server`) to browse each category. The colored dot shows
whether a nudge is on, missing a prerequisite, or off.

`Toggle Availability` chooses which personas can use a nudge:

- **All checked:** every persona can use it, including personas you add later.
- **Some checked:** only those personas can use it. New personas stay out until you check them.
- **None checked:** the nudge is off.

Below the list you can add up to 25 of your own for the whole server. Choosing one opens it for
editing; `Remove Custom Nudges` lists your own idle nudges, and unchecking one removes it. Each one
has:

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

Official presets include these settings. `/persona generate` suggests interests for new personas;
`Generate Interests` adds new ones through your current text model. Persona exports include both settings.

## What gets stored

Settings, custom nudges, and interests are saved with your server configuration. Nudge history,
including whether anyone answered and who was pinged, is kept for 30 days. Agendas are kept for
up to 90 days.

- **Server config:** `/reset` restores nudge settings and removes custom nudges. Config exports
  and imports carry settings and custom nudges, excluding the server-specific channel list.
- **Personal config:** your `Pings from Personas` choice survives `/reset personal config`, is
  included in `/export personal config`, and is erased by `/personal nuke`.
