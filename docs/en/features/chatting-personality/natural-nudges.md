---
title: "Natural Nudges"
description: "Let your TomoriBot personas start conversations on their own when a Discord channel goes quiet, at a pace that follows how active your server is."
sidebar:
  order: 4
aiGenerated: true
---

Natural Nudges lets TomoriBot speak without being mentioned. When an allowed channel has gone
quiet, one of your personas picks something to do, such as picking a conversation back up or
raising a new topic, and posts it in its own voice. Each of these is an **episode**.

Nudges are meant to feel like a friend checking in, not a bot posting on a timer:

- **The pace follows your server.** Servers that talk to TomoriBot every day get about one episode a
  day; servers that rarely talk to her get none.
- **She waits for a natural gap.** An episode only starts in a channel that has been quiet for one
  to three hours, during the hours your server is usually awake.
- **She goes quiet when nobody answers.** Each unanswered episode makes the next one wait longer,
  and after three in a row she stops until someone talks to her again.
- **When in doubt, she says nothing.** If someone posts first, the channel gets busy, or the
  planner finds nothing that fits, the episode is dropped.

Natural Nudges works in servers only, never in DMs.

## Turning It On

Open `/config` > Plugins > Natural Nudges (you need Manage Server):

1. Turn **Episodes** on.
2. Choose the **Allowed Channels** where personas may start conversations. A channel where other
   bots post often never goes quiet, so it is left alone.
3. Choose a **Planner Model**. Before a persona speaks, this model decides what to bring up and
   which channel suits it. It needs structured output and runs on the server's own key.

The page shows how active the server is and how many episodes to expect each week.

Episodes need two things from the server:

- **Stat tracking.** The pace comes from how many messages people send TomoriBot, so a host that
  turned stat tracking off never gets episodes.
- **A server key.** A server set to bill each member's own key has nobody to pay for a message no
  one asked for, so Natural Nudges stays off there.

### Frequency, weights, and the daily cap

- **Frequency** sets the overall pace: Rare, Gentle (the default), Normal, or Lively. Even Lively
  stays quiet in a server that rarely talks to TomoriBot.
- **Weights** decide which kind of episode comes up more often. A weight of 0 turns that kind off.
- **Daily cap** limits episodes per day, 3 by default.

## Episodes
<!-- anchor: episodes -->

Each episode belongs to a category:

| Category | What happens |
|---|---|
| **Revive** | A persona picks up a conversation that was left hanging: an unanswered question, a second opinion, or something it looked up. |
| **New Topic** | A persona raises something new, usually from its own interests: a thought, a hot take, a "would you rather", a news item, a picture, or a voice note. |

`/config` > Plugins > Nudge Episodes lists every episode. Built-in episodes can be turned off,
and you can add up to 25 of your own:

- **Name** and **Category**.
- **Planner brief**: what the persona sets out to do. Write `{persona}` where its name goes.
- **Example agenda** (optional): the kind of small goal the persona keeps after its opener.
- **Needs**: what must be true before the episode can run, such as a hanging conversation or an
  available tool.
- **Recommended tools**: tools the persona is encouraged to use, offered only when available.

### Hidden agendas

Along with its opener, each episode gives the persona a small private goal, such as "find out who
else likes this anime". The goal stays attached above the opener and only that persona sees it,
so it keeps pursuing the goal in later replies. Once the opener scrolls out of the conversation
the persona keeps, the goal is gone. Agendas never ask for personal details, money, or anything
outside the chat. Members allowed to use the prompt snapshot can see them.

## Persona Settings

Each persona has its own **Nudges** page under `/config` > Persona:

- **Talkativeness**: how often this persona is the one who speaks up. Silent personas never start
  episodes; shy ones speak up less, chatty ones more.
- **Interests**: up to 8 topics the persona likes to bring up, each with a short description and
  examples (for example **mecha anime**: Fiction about giant piloted robots, such as Gundam).

Official presets come with their own interests and talkativeness. `/persona generate` suggests
interests for new characters, and persona exports carry them.

## What Gets Stored

Natural Nudges keeps your settings, custom episodes, and persona interests with your other server
configuration. It also remembers which episodes ran recently and whether anyone answered, for 30
days, and each hidden agenda for up to 90 days. `/reset` restores the settings and removes custom
episodes. `/export config` and `/import config` carry settings and custom episodes, but not the allowed channels, which
belong to one server.
