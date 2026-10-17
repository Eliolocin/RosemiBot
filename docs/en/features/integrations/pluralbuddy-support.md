---
title: "PluralBuddy Support"
description: "Use PluralBuddy webhook reposts with TomoriBot's per-alter identity and memories."
sidebar:
  order: 4
---

TomoriBot can recognize verified [PluralBuddy](https://pluralbuddy.app/) webhook reposts and keep
each alter's name, profile settings, and personal memories separate from the host Discord account.
Your TomoriBot host must [authorize the PluralBuddy instance](/self-hosting/pluralbuddy-oauth/)
before you can select it.

## Use PluralBuddy with TomoriBot

Run `/personal message-proxy service:pluralbuddy` on the Discord account that sends your PluralBuddy
messages. If your TomoriBot host has approved another instance, select it with the optional
`instance` field; leaving that field empty selects the official instance. Use `service:none` to turn
the wait off. TomoriBot also skips the wait automatically in guilds where the selected PluralBuddy
bot is not installed. Your account's privacy settings, blacklist state, cooldowns, and quotas still
apply to every alter it hosts. After TomoriBot verifies an alter's first
repost, use `/personal config identity:` and `/personal memories identity:` to edit that alter's
stored profile and memories.

PluralBuddy must send a webhook repost for TomoriBot to verify the alter. A nickname-only message
does not give TomoriBot an alter identity. PluralBuddy can render its webhook reposts with Components
V2; no message-format change is needed. If an alter uses nickname-only mode, choose PluralBuddy's
`webhook` or `both` proxy mode for that alter.

## Current limits

PluralBuddy's message lookup confirms the repost, host, channel, and alter, but does not identify
the exact original message. TomoriBot matches it to a recent message from the same account and
channel. With overlapping messages or a late repost, it may miss the alter or reply twice. A failed
lookup never creates an alter identity.

TomoriBot uses the webhook name for the alter's display name because PluralBuddy's message lookup
does not return one. It does not import private alter or system profile fields. A rename updates the
display name when TomoriBot next verifies that alter, while its identity and memories remain stable.
Verified alters cannot be mentioned as Discord users.

The [message-proxy overview](/features/integrations/message-proxy-support/) covers the shared wait
and service selection. [PluralKit support](/features/integrations/pluralkit-support/) describes its
different correlation and bio handling.
