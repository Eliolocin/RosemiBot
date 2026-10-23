---
title: "Natural Nudges"
description: "Let your TomoriBot personas start conversations when a Discord channel goes quiet and join ones that match their interests, at a pace that follows how active your server is."
sidebar:
  order: 4
aiGenerated: true
---

Natural Nudges lets TomoriBot speak without being mentioned, in two ways:

- **Idle Nudges.** When a channel has gone quiet, one of your personas picks something to do, such as
  checking in on someone, picking a conversation back up, raising a new topic, or starting a short
  scene with another persona, and posts it in its own voice.
- **Active Nudges.** When members are talking about something a persona likes, that persona joins in.

Nudges are meant to feel like a friend checking in:

- **The pace follows your server.** Servers that talk to TomoriBot every day get about one idle nudge
  a day; servers that rarely talk to her get none, and no active nudges either.
- **She waits for a natural gap.** An idle nudge only starts in a channel that has been quiet for one
  to three hours, during the hours your server is usually awake.
- **She goes quiet when nobody answers.** Each unanswered idle nudge makes the next one wait longer,
  and after three in a row she stops until someone talks to her again.
- **When in doubt, she says nothing.** If someone posts first, the channel gets busy, or nothing
  fits, the nudge is dropped.

Natural Nudges works in servers only, never in DMs.

## Active Nudges
<!-- anchor: active-nudges -->

An active nudge is a persona joining a conversation that is already going, because it is about
something that persona likes. Here is how one happens:

1. While members talk in an eligible channel, TomoriBot counts their messages. Threads count as part
   of their channel, and the count starts over whenever a persona speaks.
2. Every so often (sooner in busier servers and at a higher frequency for active nudges), she reads the
   last five messages and asks whether the conversation is really about one of your personas'
   interests. A passing mention does not count.
3. The persona with that interest replies. If several personas share it, the one who has been quieter
   lately usually goes, and a persona that just spoke sits it out. Now and then another persona takes
   the turn instead, more often one the server rarely talks to.
4. The reply comes 15-45 seconds later, as the persona's normal self. If a persona speaks first,
   members move on, or the channel gets busy, she says nothing.

There is at most one active nudge per channel (threads included) per hour, plus a daily limit for the
whole server. A persona needs interests on its Nudges page to take part, and Silent personas never do.

## Idle Nudges
<!-- anchor: idle-nudges -->

Each idle nudge belongs to a category:

| Category | What happens |
|---|---|
| **Ping User** | A persona pings one member it knows: a check-in, a follow-up on something they mentioned, a link they might like, a tease about the game they are playing, or an offer to remind them of something. |
| **Revive Topic** | A persona picks up a conversation that was left hanging: an unanswered question, a second opinion, or something it looked up. |
| **Start Topic** | A persona raises something new, usually from its own interests: a thought, a hot take, a "would you rather", a news item, a picture, or a voice note. |
| **Play Scene** | Two or three personas talk to each other in a short scene: a playful argument, a loud "secret" plan for a member, asking each other for advice, or showing off a picture. |

`/nudge-studio` (you need Manage Server) has a tab for each category. Each tab lists that category's idle
nudges with a colored dot:

- 🟢 **On**: it can be picked.
- 🟡 **On, but it can't run here yet**: no persona has a tool it needs, a Play Scene has no second
  persona, or none of the personas it is limited to can nudge. The row says what is missing.
- 🔴 **Off**.

**Toggle Availability** opens one idle nudge with a box for each persona:

- **Every box checked**: every persona can use it, including personas you add later.
- **Some checked**: only those personas, and its row names them, like "Remind you? (Mirri and Juno
  only)". A persona you add later stays out until you check it.
- **Nothing checked**: the idle nudge is off.

Below the list you can add up to 25 of your own for the whole server. Choosing one opens it for
editing; **Remove Custom Nudges** lists your own idle nudges, and unchecking one removes it. Each one
has:

- **Name**.
- **Brief**: what the persona sets out to do. Write `{persona}` where its name goes,
  `{partner}` where the other persona in a Play Scene goes, and `{target}` where the member it is
  about goes.
- **Agenda** (optional): the kind of small goal the persona keeps after its opener.
- **Prerequisites**: what must be true before the idle nudge can run, such as a recent memory or an
  available tool. Each category already brings its own: a member to ping, a hanging conversation, or
  a second persona.
- **Recommended tools**: tools the persona is encouraged to use when it has them. The idle nudge
  still runs without them. A tool picked under Prerequisites is already included, so it is dropped
  from this list when you save.

### Ping User
<!-- anchor: ping-user -->

This kind of idle nudge pings one member by name, so it only picks people the persona actually knows:

- **They talked to this persona recently.** Only members who started a conversation with that persona
  in this server in the last 14 days can be picked. Being mentioned or talked about does not count,
  and neither does being close to the same persona in another server.
- **The persona knows them.** The member has a memory with this persona from the last 30 days, or a
  recent short-term memory with it.
- **They have not opted out.** Anyone can turn Pings from Personas off for themselves in
  `/personal config` > Privacy. Members with Full privacy, members on the server's personalization
  blacklist, and members the persona has blocked are never picked.

Among those members, closer ones are picked more often: each message to that persona in this server
in the last 14 days, and each channel it recently talked with them in, adds to their chance. Someone
a persona pinged in the last three days is less likely to be picked again. The ping goes to that one
member only; a Ping User nudge never pings roles, `@everyone`, or anyone else. Any reply in the
channel counts as an answer.

### Play Scene
<!-- anchor: play-scene -->

A Play Scene is a short scene between personas, two to four messages long. The persona that speaks up
opens it and picks one partner, sometimes two, from the other personas allowed in that channel.
Talkative personas join more often, and Silent ones never do.

- **Members come first.** When anyone posts in the channel during the scene, the remaining scene
  messages are dropped and the persona who was about to speak answers them, as in a conversation
  someone joins. If they named or mentioned a persona, that persona answers instead.
- **Scheming stays private.** The personas plan a harmless surprise for someone they know, but the
  scene does not ping that member.

### Hidden agendas

Along with its opener, each idle nudge gives the persona a small private goal, such as "find out who
else likes this anime". The goal stays attached above the opener and only that persona sees it, so it
keeps pursuing the goal in later replies. In a Play Scene each persona gets its own goal, which the
others never see. Once the opener scrolls out of the conversation the persona keeps, the goal is
gone. Agendas never ask for personal details, money, or anything outside the chat. Members allowed to
use the prompt snapshot can see them.

## Settings

Natural Nudges is on by default, and nothing needs setting up. Once people in a server talk to
TomoriBot regularly, idle nudges and active nudges start in the channels where they talk to her.

To change how it works, open `/config` > Plugins > Natural Nudges (you need Manage Server):

- **Idle Nudges** and **Active Nudges** turn each one on or off.
- **Channels** is automatic: the channels where people talked to TomoriBot in the last 14 days,
  except roleplay channels. Pick channels to choose them yourself, or clear the list to go back to
  automatic. A channel where other bots post often never goes quiet, so it is left alone.
- **Model Selection** picks the two AI models Natural Nudges uses. Free Google models fall under
  Google's terms for free use, which let Google use the conversations sent to them.
  - **Idle Nudge Planner** plans idle nudges. By default it is the server's chat model. Not every
    model can do this job; if yours can't, the page says so and lets you pick another.
  - **Active Nudge Checker** looks at a conversation now and then to see whether it matches an
    interest. It runs much more often than the planner, so a small, cheap model suits it best. By
    default TomoriBot picks one for you: a Decision model (a small model made for quick pick-one
    questions) if the server has an OpenRouter key, otherwise Gemma 4 31B if it has a Google key,
    otherwise the Idle Nudge Planner. You can pick any of these yourself, including Decision models.

The page shows how active the server is, how many idle nudges to expect each week, and how often she
checks for active nudges.

### How often

- **Frequency** sets the pace, separately for idle nudges and for active nudges: Rare, Gentle (the
  default), Normal, or Lively. Even Lively stays quiet in a server that rarely talks to TomoriBot.
- **Daily limits** follow the frequency level: Rare allows 1 idle nudge and 1 active nudge a day,
  Gentle 3 of each, Normal 5 idle nudges and 6 active nudges, and Lively 8 idle nudges and 10 active
  nudges.
- **Check limits** keep active nudges from using up an AI key: TomoriBot checks conversations at
  most 10 times a day on Rare, 20 on Gentle, 40 on Normal, and 60 on Lively. After a check finds
  nothing, that channel waits longer before the next one, from 10 minutes up to 3 hours. If the AI
  provider says the key has hit its limit, active nudges pause for 3 hours.

### When it stays off

- **Usage stats are off.** TomoriBot judges how active a server is from its usage stats, so if
  whoever hosts your bot turned them off, nudges never start.
- **Members pay with their own keys.** If your server has each member use their own AI key, nobody's
  key covers a message no one asked for, so Natural Nudges stays off.

## Persona Settings

Each persona has its own **Nudges** page under `/config` > Persona:

- **Talkativeness**: how often this persona is the one who speaks up. Silent personas never start
  idle nudges or take part in active ones; shy ones speak up less, chatty ones more.
- **Interests**: up to 8 topics the persona likes to bring up and join in on, each with a short
  description and examples (for example **mecha anime**: Fiction about giant piloted robots, such as Gundam).

Official presets come with their own interests and talkativeness. `/persona generate` suggests
interests for new characters, and **Generate Interests** on the Nudges page adds up to 5 new ones at a
time from the persona's attributes and sample dialogues, using the Idle Nudge Planner model,
until the persona has 8. Persona exports carry them.

## What Gets Stored

Natural Nudges keeps your settings, custom idle nudges, and persona interests with your other server
configuration. It also remembers which idle nudges and active nudges ran recently, whether anyone
answered, and who a Ping User nudge went to, for 30 days, and each hidden agenda for up to 90 days.
`/reset` restores the settings and removes custom idle nudges. `/export config` and `/import config`
carry settings and custom idle nudges, but not a chosen channel list, which belongs to one server.
Your own Pings from Personas choice is part of your personal settings: `/reset personal config`
keeps it, `/export personal config` carries it, and `/personal nuke` erases it with the rest of your
data.
