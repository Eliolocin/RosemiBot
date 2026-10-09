---
title: "Personalization"
sidebar:
  order: 3
---

TomoriBot can remember personal details, custom names, and AI provider credentials that
follow you across every server you share with her. You can manage these settings with
the `/personal` commands without altering any server's shared configuration.

## Personal Memories

Facts she learns or remembers about you follow you between servers. Managing them (adding,
removing, exporting, or clearing context) is covered on the
[Memory](/features/knowledge/memory/#personal-vs-server-memories) page.

## Profile and Persona-Aware Names

Configure how TomoriBot addresses and refers to you across servers in `/personal config` >
Profile.

### Profile details

In `/personal config` > Profile > General Preferences, the **About You** section stores three
independent, optional preferences:

- **Gender identity**: your gender description.
- **Pronouns**: your preferred pronouns.
- **Addressing style**: chooses a persona's masculine, feminine, or neutral naming variant.
  Neutral is the default.

TomoriBot never infers one field from another. Blank fields are cleared and omitted from the
prompt context. Raw profile fields are exposed to the AI only when your privacy level is set to
`None`.

The **Interface** section lets you set your numeric UTC offset (-12 through
+14) or match the server default. TomoriBot stores only this numeric offset, never a geographic
location or IANA timezone.

### Naming inheritance

In `/personal config` > Profile > General Preferences or Persona-specific Preferences, you
can set a nickname, prefix, or suffix:

- **Global scope**: applies across all personas unless overridden.
- **Persona scope**: applies only to a specific persona lineage across servers.

Names resolve from most specific to least specific:

1. **Persona preference**: custom nickname set for that persona.
2. **Global preference**: custom nickname set across all personas.
3. **Discord display name**: your live server display name.

Leaving your global nickname blank allows TomoriBot to follow your Discord display name
automatically, including future changes. Saving a custom global nickname freezes that value
until you clear it.

Prefixes and suffixes inherit the same way. For example, a prefix from one level and a suffix from
another can combine into `Master Mirri-san`. To stop a persona from using a title it generates on
its own, ask it directly in chat ("stop calling me Master"); that suppresses the title for that
persona while leaving other personas untouched.

Server managers configure server-wide persona defaults under `/config` > Persona >
Identity & Personality. When the User Info Updates capability is enabled, personas can also
update your profile details when requested during conversation.

## Your Own Providers
<!-- anchor: your-own-providers -->

Personal providers let your own requests use your own API keys and models instead of the
server's defaults. This is bring-your-own-key (BYOK) at the individual user level.

Two scopes are available:

- **Server default**: shared credentials and models configured in `/providers` and `/model`
  by server managers. Applies to everyone in the server.
- **Personal override**: credentials and models configured in `/personal providers` and
  `/personal config`. Applies only to your requests across every server where you use TomoriBot.

### Setup

1. Run `/personal providers` to save a provider (your API key is encrypted). Saving a provider
   enables your personal text override immediately with that provider's default model.
2. Run `/personal config` > Models > Switch Models to select a different model for your personal
   text override.
3. Return to `/personal providers` whenever you need to update credentials, manage custom
   endpoints, or add custom model registrations.

Switching a capability from the server default to a personal override shows a confirmation prompt
before saving. Updating credentials for a provider you already use skips confirmation.

Thought logs attribute turns using your personal key to you. You can adjust your personal model
parameters (temperature, top-p, token caps) in `/personal config` > Models > Samplers & Parameters.
To register private custom endpoints, see
[Custom Endpoints](/features/setup-administration/providers-and-models/#custom-endpoints).

### Error handling and fallback

If a request fails while using your personal provider, error tips direct you to your personal
commands (`/personal providers`, `/personal config`) rather than server settings.

When every model on your personal text route fails, TomoriBot can fall back to the server's
default text model rather than failing silently. Server fallbacks run on server credentials, count
against the server's text quota, and display a `Fallback Used` button with details.

You can disable server fallback in `/personal config` > Models > Fallbacks under
`Server Model Fallback`. The setting is account-wide and enabled by default.

:::note[BYOK-required servers]
A server can require members to supply their own API keys via User BYOK mode
([Server Moderation](/features/setup-administration/server-moderation/#user-byok-bring-your-own-key)).
When enabled, your messages require a configured personal provider before TomoriBot will respond,
and failed personal routes do not fall back to server credentials.
:::

## Other Personal Settings

Use `/personal config` to customize additional features:

- **Appearance** (`Profile` > `Appearance`): save booru-style appearance tags used whenever an
  [image generation](/features/capabilities/media-generation/image-generation/#tag-customization)
  references you. Submit an empty box to clear them.
- **Privacy Controls** (`Privacy` > `Privacy Controls`): choose your visibility level
  (`None`, `Partial`, or `Full`), or toggle cross-server short-term memory sharing.
- **Response Modes** (`Advanced` > `Response Modes`): toggle your personal override for
  [Deliberate Trigger Mode](/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode).
- **Impersonation** (`Advanced` > `Impersonation`): set a reusable prompt used when someone
  invokes `/impersonate user` for you.

## Personal Spotlight
<!-- anchor: personal-spotlight -->

Personal Spotlight narrows which personas you can trigger in a specific channel, and optionally
assigns a fallback auto-trigger persona for your messages there. It is scoped to you and one
channel: it does not affect anyone else in the server.

To configure a spotlight in `/personal config` > Advanced > Personal Spotlight:

1. Select a duration in hours (enter `0` to keep it active until removed manually).
2. Choose the target channel.
3. Select the personas you want to allow in your spotlight.
4. Optionally pick one of those personas as your **personal auto-trigger persona** (the default
   responder for your messages in that channel). Explicit mentions can still target any allowed
   persona. Press `Save Spotlight` to skip setting an auto-trigger persona.

### Spotlight rules

- Spotlight only narrows access: you cannot trigger personas excluded from your spotlight list.
- It respects server-level persona permissions configured under `/moderation`.
- Persona proxy handoffs are restricted to personas included in your spotlight list.

Manage or remove spotlights in `/personal config` > Advanced > Personal Spotlight (uncheck
entries to remove them; timed spotlights expire automatically). In `/help`, choose
`Advanced` > `Personal Spotlight` for a quick summary.
