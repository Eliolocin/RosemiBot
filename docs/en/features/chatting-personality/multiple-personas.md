---
title: "Multiple Personas"
# Keyword-rich <title> targeting "AI companion Discord" queries; replaces
# Starlight's default "{title} | TomoriBot" for this page only. H1 and sidebar
# keep the plain title. The homepage title bets on "AI agent" + "roleplay";
# this page carries the "companion" keyword instead.
head:
  - tag: title
    content: "TomoriBot | AI Companions & Personas for Your Discord Server"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "Run multiple AI companions in one Discord server. Custom personas with their own avatars, triggers, and speaking styles."
sidebar:
  order: 2
---


TomoriBot's personality lives in a persona: her name, avatar, traits, speaking style,
and behavior. You can run multiple personas at once, each as a distinct character with
its own trigger words and webhook avatar. This page covers how personas behave. For
facts and memories, see [Memory](/features/knowledge/memory/).

## Creating a Persona

- `/persona create`: build a custom persona from scratch.
- `/persona generate`: have the AI generate a persona from a prompt and an image (requires
  a provider that supports structured output). You can also provide an existing TomoriBot
  preset or SillyTavern card (see [SillyTavern Support](/features/integrations/sillytavern-support/)).
- `/persona default`: switch to one of the built-in default characters.
- `/persona export` and `/persona import`: back up or share persona files. Import supports
  adding a character as an alter persona with its own triggers and webhook avatar.
- `/persona remove`: delete an alter persona.

## Alter Personas

Alter personas let multiple characters coexist in one server:

- Each alter has its own personality, trigger words, and webhook avatar, so different
  characters post under their own name and image in the same channel.
- Multiple alters can reply to a single message, up to the limit set in
  `/config` > Behavior > Trigger Behavior.
- Replying directly to a webhook message continues the conversation with that specific persona.
- Add alters with `/persona import` (select the alter option), and manage them with
  `/persona` and `/persona remove`.

For runtime routing and webhook identity details, see the architecture guide on
[multi-persona behavior](/architecture/subsystems/multi-persona/).

## Shaping Personality

Fine-tune how a persona looks, talks, and behaves:

### Attributes
<!-- anchor: attributes -->

Open `/config` > Persona > Identity & Personality to define personality traits or physical
details (such as `friendly`, `red hair`, or `ends sentences with *Nya~*`).

### Sample Dialogues
<!-- anchor: sample-dialogues -->

Open `/config` > Persona > Identity & Personality to teach her speaking style by example
using `{user}` and `{bot}` placeholders:

- `{user}`: replaced with the actual user's display name or nickname.
- `{bot}`: replaced with her current persona name.

```text
{user}: What's your favorite hobby?
{bot}: Fufu~ I like knitting tiny clothes for tiny plushies~♥
```

Tips for effective sample dialogues:

- Write natural exchanges that show rather than tell.
- Demonstrate the tone and vocabulary you want her to use.
- Add variety across several examples so she generalizes well.

### Name and Avatar

Open `/config` > Persona > Identity & Personality to set what she calls herself and upload
her profile picture.

You can also set a custom system prompt in `/config` > Behavior > General Behavior;
see [Behavior Tweaking](/features/chatting-personality/behavior-tweaking/).


### Naming Habits

Server managers can open `/config` > Persona > Naming Habits to set how a persona addresses
members:

- Configure separate masculine, feminine, and neutral prefixes, suffixes, and address terms.
- Different personas can address the same user with different titles (such as one calling
  them "Captain" and another calling them "Senpai").
- Personal overrides follow each user across servers; see
  [Personalization](/features/knowledge/personalization/).

## Sprites (Emotion Avatars)
<!-- anchor: sprites-emotion-avatars -->

Sprites are alternate avatars a persona switches to during conversation to reflect emotions
(such as `happy`, `mad`, or `embarrassed`).

When replying, she picks the sprite matching her emotion. To use one, she starts the reply
line with `PersonaName (label):`, and Discord delivers that message with the matching sprite
avatar. If no sprite fits, she replies with her default avatar.

Manage sprites in `/config` > Persona > Sprites (requires Manage Server):

- **Add or replace**: select the persona, provide a label, upload an image (PNG, JPG, or GIF),
  and optionally write usage instructions describing when to display it.
- **Edit**: update an existing sprite's label, image, or instructions.
- **Delete**: remove sprites you no longer want.
- **Export and import**: share or back up the persona's complete sprite pack as a file.

The `Save as Identity` toggle displays the message author as `Label (Persona)` in Discord,
useful for characters with multiple forms.

Replacing a default persona's avatar clears its built-in sprites, because they depict the
original character. Sprites you added yourself remain intact. Running `/persona default`
restores the built-in sprites.

## Per-Channel Persona Picks

To choose which persona replies to you in a specific channel without changing server-wide
settings, use Personal Spotlight; see
[Personalization](/features/knowledge/personalization/#personal-spotlight).
