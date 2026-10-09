---
title: "Chatting & Triggers"
sidebar:
  order: 1
---

TomoriBot responds when summoned. This page covers the ways she can be triggered,
how to enable hands-free chatting with auto-trigger, and how to prevent accidental
activations with Deliberate Trigger Mode.

## How to Trigger Her
<!-- anchor: how-to-trigger-her -->

By default, she replies when you:

- **Mention her**: `@TomoriBot`
- **Reply** to one of her messages (including a persona's webhook message)
- **Use a trigger word**: any registered trigger word anywhere in a message
- **Use `/respond`**: manually request a response

In a DM, send a message directly without any trigger word or mention.

### Managing Trigger Words
<!-- anchor: managing-trigger-words -->

Server managers use `/config` > Persona > Triggers to add or remove trigger words for
the active persona. Members without Manage Server can view existing triggers in read-only mode.

## Expressions & Reactions
<!-- anchor: expressions--reactions -->

When replying, she can use server custom emojis, stickers, and emoji reactions:

- Custom emojis appear naturally in conversation with `:name:` syntax.
- She can send one sticker per reply, as its own message before, between, or after her text.
- Server managers can add [custom expressions](/features/chatting-personality/behavior-tweaking/#expressions)
  with `/expressions manage`: reaction GIFs, image jokes, or links to any website.
- Run `/expressions initialize` so she learns when each server emoji and sticker fits.

## Roleplay Channels
<!-- anchor: roleplay-channels -->

Roleplay channels suppress custom emoji and sticker messages in her responses. Members can
also use `/tool delete turn` in roleplay channels to delete her latest turn without needing
the Manage Server permission.

Configure roleplay channels in `/config` > Channels > Channel Rules.

## Situational Awareness

Whenever she replies, she receives context describing where and when the conversation is
happening:

- **Location**: the server name, channel name, or whether the chat is a Direct Message.
- **Time**: server local time and time of day from `/config` > Behavior > General Behavior,
  plus local clocks for users who set a timezone in `/personal config`.
- **Participants**: display names, mention handles, appearance tags, and pending reminders.
- **Discord activity**: what participants are currently playing, streaming, listening to
  (such as Spotify tracks), or their custom status.

Activity status requires Discord's `Guild Presences` intent and respects user privacy
(`/personal config`). Users who raise their privacy setting are not included in presence context.

## Auto-Trigger (Hands-Free Chatting)

Auto-trigger lets TomoriBot join conversations without being directly mentioned:

- `/config` > Channels > Auto-Trigger (or `/server autotrigger channels`): choose channels where
  she responds autonomously.
- `/config` > Channels > Auto-Trigger (or `/server autotrigger threshold`): set how many messages
  must accumulate before she chimes in.
- `/config` > Behavior > Trigger Behavior: configure timer-based random triggers for a channel.

Use auto-trigger in dedicated casual channels where you want the bot to participate naturally.

## Deliberate Trigger Mode
<!-- anchor: deliberate-trigger-mode -->

If a persona's name is used often in regular conversation, plain trigger words can activate
her by accident. Deliberate Trigger Mode (DTM) prevents accidental activation by ignoring
unadorned trigger words.

When DTM is active:

- `@{trigger}` (the trigger word prefixed with `@`) triggers a reply
- Discord mentions `@TomoriBot` still trigger a reply
- Message replies still work
- `/respond` still works
- Plain trigger words without `@` no longer trigger her

### Server and Personal Control

- `/server dtm`: server managers toggle the server default.
- `/personal config`: individual members override the setting for their own messages:
  - `off`: always allow plain trigger words
  - `follow`: follow the server setting
  - `on`: always require deliberate invocation

In `/help`, choose `Behavior`, then `Deliberate Trigger Mode`, for the Discord summary.

:::note
Deliberate Trigger Mode (this page) controls when she replies. Deliberate Tool Mode
controls which tools are presented to the model on a turn. Both are abbreviated "DTM"
in Discord; see
[Tools & Extensions](/features/capabilities/tools-and-extensions/#deliberate-tool-mode).
:::
