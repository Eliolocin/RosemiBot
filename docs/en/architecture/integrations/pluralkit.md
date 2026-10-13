---
title: "PluralKit Adapter"
sidebar:
  order: 2
---

The PluralKit adapter supplies authoritative message correlation, stable member identity, reply
recovery, and service-owned prompt wording to the generic [message-proxy subsystem](/architecture/integrations/message-proxy/).
PluralKit is one of the selectable message-proxy services.

## Descriptor

`src/utils/messageProxy/services/pluralkit/descriptor.ts` registers these facts:

| Property | Value |
|---|---|
| Service ID | `pluralkit` |
| Synthetic user prefix | `pk:` |
| External identity kind | `pluralkit_member` |
| Correlation | Authoritative message lookup |
| Identity | Stable member and system UUIDs |
| Identity bio | Inline public member description |
| Namespace bio | Inline public system description |

Member and system UUIDs are the canonical keys. Names, tags, short IDs, webhook names, and avatars
are cosmetic data and never establish identity.

## Message lookup transport

`services/pluralkit/api.ts` calls `GET /v2/messages/{messageId}` on the selected instance origin and validates the response with
Zod before it reaches generic code. The message model carries the full member object, so the public
member name, description, and pronouns arrive in that one response and no separate member-profile
request is made. PluralKit omits or nulls a value the member keeps private, so an absent key is
never replaced with a placeholder. The adapter converts the validated transport DTO
into a `ProxyMessageAttestation` containing the proxy message, original message, sender account, and
an optional stable identity.

The client preserves PluralKit-specific behavior:

- `404` is retried because PluralKit may receive a proxy message before its API index does.
- `429` honors a sane positive `Retry-After`; zero or malformed values use bounded backoff. A
  `Retry-After` that leaves the budget no room to retry after it fails the lookup immediately,
  rather than retrying early or sleeping out the deadline.
- `MESSAGE_PROXY_LOOKUP_TIMEOUT_MS` (shared with every service) bounds the complete lookup budget. One attempt may spend at most
  half of it, so a stalled connection is aborted with the first backoff step and a second attempt
  still inside the same deadline. A response that stalls while sending its body takes the same
  retry path. Every retry sleep also leaves a minimum attempt's time, and the final attempt uses
  whatever remains.
- A lookup resolves `null` only when PluralKit answered that it has no such message. A stall,
  network failure, rate limit, `5xx`, or untrustworthy payload rejects as
  `PluralKitLookupUnavailableError`, which the router counts as `timeout_or_error` rather than
  `unmatched`. Neither outcome invents an identity.
- `PLURALKIT_API_TOKEN`, when set, is sent as the authorization token.
- Concurrent reads for one message share a single request. Successful results are cached; failed
  results are never cached, so a later attempt can still resolve the message.
- A missing, deleted, private, or otherwise unavailable member produces no stable identity claim.

The generic router still requires the returned service ID, original ID, and sender ID to match a
live expectation exactly. A display-name or timing resemblance is never accepted.

## Identity mapping

PluralKit maps its concepts into generic persistence as follows:

```text
PluralKit member UUID
  -> external_identities(kind = pluralkit_member, instance_id = pluralkit:official)
  -> users(user_disc_id = pk:<member-uuid>)
  -> message_proxy_identities

PluralKit system UUID
  -> message_proxy_namespaces(instance_id = pluralkit:official)
  -> message_proxy_namespace_accounts(host Discord accounts)

Proxy message ID
  -> message_proxy_message_index(member identity + attested sender)
```

The host account owns authorization, privacy, blacklist state, cooldowns, quotas, usage telemetry,
and personal settings. The synthetic member owns conversational attribution, personal memories, the
profile fields a service publishes for it, and its own first-meeting and reunion clock, so two members
of one system each meet Tomori and return to her independently. Host `PrivacyLevel.FULL` or blacklist
state shields every linked member.

## Prompt presentation

`presentation.ts` owns all PluralKit vocabulary rendered to the model. It describes an identity as
a member, renders its system using name then tag then an unnamed fallback, and emits one system note
per system. That note also labels linked Discord accounts as shared accounts; the shared renderer
outputs the adapter's completed entry without assigning relationship semantics. Shared participant
and history code only sees generic identity and namespace DTOs.

A present member has no independent Discord presence and cannot be mentioned. Its memories remain
member-specific. A public system description is refreshed when observed and rendered once for the
system; a public member description may be seeded once as a global personal memory when the member
is first registered. Later service edits do not rewrite that memory.

A member's public pronouns follow the same one-time rule, written into that member's own `pronouns`
setting on the attestation that first registers the identity. PluralKit stays the source of the
initial value only: a pronoun set the member changes on PluralKit later does not overwrite an edit
made through `/personal config identity:`, and a member who reports no pronouns leaves the setting
empty. Nothing here infers a gender or an addressing style, and the system's own pronouns are not
imported.

## Reply embeds

PluralKit represents proxied replies with an embed. `replyEmbed.ts` validates the expected author
suffix and Discord message URL before recovering the channel and message IDs. The context pipeline
suppresses that service metadata as a link preview while retaining the recovered reply target.

## User and bot host settings

Users select the adapter with `/personal message-proxy service:pluralkit`, may choose a bot
host-approved instance with `instance:`, and disable it with `service:none`. The mechanism delay is
`MESSAGE_PROXY_WAIT_MS`; only transport authentication and lookup timing remain under `PLURALKIT_*`
variables. The optional `PLURALKIT_API_TOKEN` goes only to the official PluralKit origin.

For user-visible behavior and limitations, see [PluralKit Support](/features/integrations/pluralkit-support/).
