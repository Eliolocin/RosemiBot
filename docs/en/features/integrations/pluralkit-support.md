---
title: "PluralKit Support"
# Keyword-rich <title> targeting "PluralKit Discord bot support" queries;
# replaces Starlight's default for this page only. H1 and sidebar keep the
# plain title.
head:
  - tag: title
    content: "TomoriBot | PluralKit Support for Plural Systems in Discord"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "TomoriBot works with PluralKit proxied messages. Each system member is treated as their own person with their own personal memories, while settings stay on the host account."
sidebar:
  order: 3
---

TomoriBot supports [PluralKit](https://pluralkit.me/) proxied messages. When enabled,
she replies to the proxied webhook repost and treats each system member as an independent
participant with their own name, profile, and personal memories. Technical internals are
documented in the [PluralKit adapter architecture](/architecture/integrations/pluralkit/), and the
shared security model is in [Message-Proxy Support](/features/integrations/message-proxy-support/).

## Enabling support

Run `/personal message-proxy service:pluralkit`. If the bot host has approved another PluralKit
instance, select it with the optional `instance` field; leaving it empty selects the official
instance. The setting applies to your Discord account and follows you across servers. System
members do not opt in individually. Run `/personal message-proxy service:none` to disable proxy
handling.

If you do not use a proxy bot, leave this setting off to avoid the brief message wait.

## Behavior when enabled

- **Replies to the proxied message.** TomoriBot waits for PluralKit to delete and repost the
  message, responding directly to the webhook repost and recovering proxied reply targets.
- **Mid-reply follow-ups.** A follow-up proxied message from the same member interrupts an active
  generation turn to answer the newer message.
- **Message wait window.** When the selected PluralKit bot is present in the server, ordinary
  messages wait up to 2 seconds (`MESSAGE_PROXY_WAIT_MS`) for it to repost before normal processing continues.
- **Per-member identity and memories.** Each member has an independent name, isolated personal
  memories, and their own last-seen timestamp. Memories do not bleed to system-mates or the host
  account.
- **One-time bio and pronoun seeding.** On first meeting, a member's public PluralKit description is
  seeded as a starting personal memory (up to 1,000 characters) and public pronouns populate their
  `/personal config identity:` setting. Later changes in PluralKit do not overwrite stored values;
  update them directly in TomoriBot.
- **Dynamic system description.** A public system description is included in context whenever any
  system member is present, and updates when edited on PluralKit.

## Identity behavior

- **Stable UUID recognition.** Members are tracked by internal PluralKit UUIDs. Renaming an alter
  updates their display name cosmetically without affecting stored memories or settings.
- **Event-driven presence.** Identities are resolved strictly from verified webhook reposts. TomoriBot
  never polls fronters.
- **Context referencing.** Naming a known member brings their memories into context, scoped to
  systems whose host account is in the server.
- **Privacy preservation.** TomoriBot reads only public fields returned by PluralKit's message
  endpoint. Private system or member details remain inaccessible.

## Settings stay on the host account

The host Discord account governs safety and limits: privacy levels, server blacklists, cooldowns,
quotas, API keys, and account-level `/personal` settings are shared across all hosted members. Setting
account privacy to full shields every member at once.

## Current limitations

- Use `/personal memories identity:` to manage a member's memories and `/personal config identity:`
  for their profile, nickname, and appearance.
- Bio and pronoun imports occur only on first registration.
- Webhook members cannot be `@`-mentioned; TomoriBot addresses them by name.
- If PluralKit's API cannot verify a repost, TomoriBot ignores it. If PluralKit has already
  deleted the original, TomoriBot will not respond to that turn. No member identity is created.
