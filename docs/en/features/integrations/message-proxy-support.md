---
title: "Message-Proxy Support"
description: "Choose a supported Discord message-proxy service and let TomoriBot safely follow its verified webhook reposts."
sidebar:
  order: 3
---

Message-proxy support lets TomoriBot follow messages that an external Discord bot deletes and reposts
through a webhook.

## Choose a service

Run `/personal message-proxy service:pluralkit` or `/personal message-proxy service:pluralbuddy`.
If the bot host has enabled another instance, choose it with the optional `instance` field. Leaving
that field empty selects the official instance.
Choose `service:none` (shown as Off) to disable proxy handling. This is a personal setting on
the Discord account that sends the original messages and follows that account across servers.
See [PluralKit Support](/features/integrations/pluralkit-support/) or
[PluralBuddy Support](/features/integrations/pluralbuddy-support/) for service-specific behavior.

After TomoriBot sees an alter's first verified message, use `/personal config identity:` to edit its
profile and `/personal memories identity:` to edit its memories. Autocomplete includes stored
identities from both services even while proxy handling is Off. Account interface, privacy, and model
settings stay on the host account. A nickname set in TomoriBot remains until cleared; otherwise the
service display name refreshes on verified messages. Autocomplete shows the service beside each
identity and adds the instance name for custom instances. Matching display names across services or
instances remain separate profiles and memories because each source verifies its own stable ID.

## What the safety check means

Tomori never assigns a webhook identity from its name or avatar. The selected service must verify the
repost ID, host account, and stable alter ID. PluralKit also identifies the exact original message,
so TomoriBot can transfer its trigger decision and reply target. PluralBuddy does not provide that
original ID. TomoriBot uses a recent message from the same host and channel as a best-effort match.
If a PluralBuddy repost is verified after the original wait, TomoriBot ignores it as a chat trigger
because the original has already been released for processing. Several overlapping originals cannot
be paired reliably and their reposts may be ignored. Failed or conflicting verification never
creates an identity.

This is why Tupperbox is not currently offered as a choice. Its public documentation describes
proxying but not a public authoritative message-attestation API that TomoriBot can safely use.

## Small message delay

When a service is selected and its proxy bot is present in the guild, Tomori briefly waits before
processing each ordinary guild message from your account. This gives the service time to delete and
repost it. If the selected proxy bot is not installed, Tomori skips the wait. Unproxied messages
continue after the wait. PluralKit reposts inherit the original trigger decision and reply target. PluralBuddy uses
the verified repost content and best-effort recent-message match.

Self-hosters can tune this mechanism with `MESSAGE_PROXY_WAIT_MS`. Service transport settings remain
separate, such as PluralKit's API timeout and optional token. PluralBuddy message lookup requires
an OAuth connection authorized by the bot host for the selected instance. Individual users do not supply
tokens. If authorization is unavailable, `/personal message-proxy` leaves the selection unchanged.
Bot hosts can follow [PluralBuddy OAuth Setup](/self-hosting/pluralbuddy-oauth/).
