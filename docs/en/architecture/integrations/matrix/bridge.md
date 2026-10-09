---
title: "Matrix Bridge"
---

TomoriBot includes an embedded Matrix appservice bridge that connects Matrix rooms to Discord
channels. It relays user messages into Discord webhooks and projects TomoriBot persona responses
back into Matrix under distinct virtual user accounts.

## Flow and ownership

The bridge runs inside the TomoriBot process as an HTTP application service using
`matrix-appservice-bridge`. It requires no external bridging daemon. When configured, it listens on
an HTTP port (`MATRIX_APPSERVICE_PORT`, default 9993) to receive homeserver events and uses an
application service token (`as_token`) to call homeserver APIs.

### Listener exposure

The listener binds `127.0.0.1` by default, because the homeserver usually runs on the same host.
`MATRIX_APPSERVICE_BIND_HOST` chooses other local interfaces, for example `0.0.0.0` when the
homeserver reaches the bot over a container network or from another machine. The bind host and
`MATRIX_APPSERVICE_PUBLIC_URL` have different roles: the bind host chooses where the bot accepts
connections, and the public URL is the callback address registered with the homeserver.

The listener authenticates every homeserver request with `MATRIX_HS_TOKEN` and answers a missing or
wrong token with 403. It speaks plain HTTP unless `MATRIX_AS_TLS_KEY` and `MATRIX_AS_TLS_CERT`
(read by the `matrix-appservice` library) name a key and certificate. Before binding anything other
than loopback, restrict the port to the homeserver's network, and use those variables or a TLS
reverse proxy when traffic crosses an untrusted network. `MATRIX_APPSERVICE_PUBLIC_URL` must be
HTTPS unless it points at localhost; setting it does not add TLS to the listener itself.

Startup validates the bridge settings once. A port outside 1-65535, a bind host that is not an IP
address or hostname, a `MATRIX_MAX_ATTACHMENT_MB` of 0 or less or above 100, or a
`MATRIX_MEDIA_TIMEOUT_MS` outside 1000-120000 logs the offending variable and leaves the bridge
disabled.

```
Matrix Homeserver
  │  (HTTP push to appservice listener)
  ▼
handleMatrixEvent (src/utils/bridges/matrix/events.ts)
  │  Strips reply fallback, enforces size limits, builds username
  ▼
Discord Webhook ("[Matrix|@user:host] localpart")
  │  (Discord messageCreate gateway event)
  ▼
TomoriBot Core Engine (Admission, Context Assembly, LLM)
  │  Emits AI response in Discord channel
  ▼
matrixRelay Handler (src/events/messageCreate/matrixRelay.ts)
  │  Detects self-message, maps persona to virtual user, formats mentions
  ▼
sendToMatrixRoom (src/utils/bridges/matrix/media.ts)
  │  (Appservice intent API call)
  ▼
Matrix Room
```

### Inbound relay (Matrix to Discord)

1. A Matrix user posts an event in a bridged room.
2. The homeserver pushes the event to TomoriBot's appservice controller in `client.ts`, which
   delegates to `handleMatrixEvent` in `src/utils/bridges/matrix/events.ts`.
3. The event handler looks up the associated Discord channel from the `matrix_channel_links` table
   using `getDiscordChannelForRoom`, then passes the room through the
   [encryption gate](#room-encryption-gate).
4. Matrix reply block-quotes (`> <@user:host> ...\n\n`) are stripped by `stripMatrixReplyFallback`.
   When replying to a persona message, an explanatory reply annotation is appended to the message text.
5. Inbound media events (`m.image`, `m.video`, `m.file`, `m.audio`) are downloaded from the
   homeserver's authenticated media route and attached to the webhook. See
   [media downloads](#media-downloads) for the identifier and size rules. Files exceeding the
   limit send a descriptive notice.
6. The handler posts the message to the linked Discord channel using an automated webhook formatted
   as `[Matrix|@user:host] localpart`, truncated to the webhook username limit.
7. Native text commands `/kill` and `/refresh` are intercepted before webhook delivery:
   - `/kill` aborts active streams, empties channel queues, and clears persona typing indicators.
   - `/refresh` clears short-term memory for the channel and posts a confirmation notice.

   Any member of a linked room can run both, as any member of the Discord channel can. Linking a
   room requires `Manage Server` in Discord, so a linked room's members are an audience that
   manager chose. The bridge applies no Matrix power-level check to relayed messages, uploads, or
   these commands. It joins rooms it is invited to but relays nothing until a room is linked.

### Outbound relay (Discord to Matrix)

1. When TomoriBot sends an AI response in a Discord channel, `matrixRelay.ts` receives the Discord
   `messageCreate` event.
2. The handler checks whether the channel is linked to a Matrix room via `getLinkedMatrixRoom`,
   and relays only after the [encryption gate](#room-encryption-gate) confirms the room.
3. It confirms the sender is TomoriBot itself or an active alter persona webhook using
   `isSelfTriggerMessage`. Normal user messages and inbound Matrix relay webhooks are discarded.
4. The handler resolves which persona generated the message, obtaining the persona nickname and
   avatar URL.
5. Mentions targeting Discord users or `@{name}` placeholders are transformed into Matrix mention
   anchors (`<a href="https://matrix.to/#/@user:host">Name</a>`) alongside MSC3952 `m.mentions`
   payload metadata.
6. Discord embeds are serialized into plain text and partitioned into chunks when exceeding
   `MATRIX_EMBED_CHUNK_MAX_CHARS` (3,500 characters).
7. Discord attachments are downloaded from Discord's proxy CDN through `safeDownload` and uploaded
   to the Matrix media repository as typed events (`m.image`, `m.video`, or `m.file`).
8. Messages are delivered to the room using that persona's virtual Matrix user intent.

## Media downloads

`MATRIX_MAX_ATTACHMENT_MB` (default 8) bounds both directions. A declared size or
`Content-Length` above the limit refuses early, and the streaming read cancels the body once the
limit is exceeded, so a chunked response without a length is bounded too.

The [Matrix content repository](https://spec.matrix.org/v1.16/client-server-api/#matrix-content-mxc-uris)
defines `mxc://<server-name>/<media-id>`. `parseMxcUri` in `media.ts` accepts exactly those two
segments: the server name follows the appendix grammar (DNS name, IPv4, or bracketed IPv6, with an
optional port), and the media ID allows only `A-Z`, `a-z`, `0-9`, `_`, and `-`, as the spec's
traversal guidance requires. Anything else, including dot segments, extra separators, backslashes,
percent-encoding, queries, and fragments, is refused before any request. The encoded segments must
produce exactly the expected download path on the configured homeserver's origin before the
appservice token is attached.

The spec allows the download route to answer 307 or 308 with a CDN location. The bridge never
forwards the token to a redirect: it downloads the location anonymously through `safeDownload`,
which applies the SSRF gate and the same size limit. Persona avatars and Discord attachments use
`safeDownload` directly.

## Room encryption gate

The bridge relays messages as plain text, so it relays in a room only while it can confirm the room
is unencrypted. `getRoomEncryptionState` in `rooms.ts` reads the room's `m.room.encryption` state and
returns one of three results:

- **encrypted:** the state event exists (HTTP 200).
- **unencrypted:** HTTP 404 with errcode `M_NOT_FOUND`, the
  [client-server API](https://spec.matrix.org/v1.16/client-server-api/#get_matrixclientv3roomsroomidstateeventtypestatekey)
  response for a room with no state of that type.
- **unavailable:** anything else, including authentication failures (the homeserver answers 403 to
  non-members), server errors, malformed JSON, and timeouts.

`/matrix link` joins the room first, then links only an unencrypted room. An unavailable result
refuses with a localized message asking the user to invite the bot account and retry.

`ensureRoomRelayable` gates inbound relay, outbound relay, and reminder mentions. It caches a
confirmed unencrypted result for `MATRIX_LINK_CACHE_TTL_MS` (5 minutes). An unavailable result
skips that relay and checks again on the next message. An encrypted result deletes the link,
invalidates the link caches after the delete succeeds, and posts a localized notice in the Discord
channel. An `m.room.encryption` state event forces a fresh check. An `m.room.encrypted` event reuses
the cached result, because any member can send one, but it still catches a state change the bridge
missed while offline.

## Loop prevention

Two independent gates prevent message echo loops across platforms:

1. **Inbound filter:** `handleMatrixEvent` discards any event where the sender matches
   `MATRIX_BOT_USER_ID`, or starts with `@_tomori_` and ends with `:${serverName}`. Checking the
   server name suffix ensures that remote federated users with matching prefixes cannot spoof the
   bot's virtual identities.
2. **Outbound filter:** `matrixRelay.ts` processes only messages satisfying `isSelfTriggerMessage`.
   Webhook messages generated by the inbound bridge relay match `isMatrixRelayMessage` and fail this
   check, preventing them from being echoed back to Matrix.

## Identity and lifecycle constraints

### Virtual persona provisioning

The bridge registration reserves exclusive control over the `@_tomori_.*:${serverName}` user
namespace. On first use in a session, the persona virtual user is provisioned on the homeserver:

- Registered idempotently through the appservice intent.
- Assigned the persona display name.
- Given the persona avatar, downloaded through `safeDownload` (10 MB cap) and uploaded to the
  homeserver media repository.

Session-scoped intent caches (`provisionedIntents` in `state.ts`) avoid redundant provisioning calls
during normal conversation turns.

### Database persistence and user identity

Discord user records in the `users` table require 64-bit integer Discord snowflakes. Matrix user IDs
are formatted strings (`@localpart:homeserver`). Accommodating Matrix users without altering the
primary key structure of the database imposes specific operational boundaries:

- **Missing user rows:** Matrix users do not exist in the `users` table. User-scoped language
  preferences and timezones are bypassed, falling back to server-level defaults.
- **Per-user cooldowns:** `normalizeChatInvocation` in `src/utils/chat/admission.ts` extracts the
  bridge user ID via `extractBridgeUserId` and assigns it to `cooldownUserDiscId`. This isolates
  cooldown buckets so Matrix users do not share a single webhook cooldown.
- **Participant hydration:** In `src/utils/text/participants/hydration.ts`, Matrix participants
  hydrate as `matrix_user` identities. They are non-mentionable in the Discord target index. Their
  display names participate in alias collision indexes as lookup-only targets, preventing the model
  from generating ambiguous mentions.
- **Personal memories:** Tools attempting to save personal memories for a Matrix user downgrade the
  scope to server-wide attributed memories, substituting `{user}` with the resolved Matrix display
  name before database insertion.
- **Reminders:** The `reminders` table stores user identifiers in a `TEXT` column
  (`user_discord_id`), allowing Matrix user IDs to be stored directly. When a reminder triggers,
  `reminderProcessor.ts` invokes `sendMatrixReminderMention`, delivering a ping directly into the
  linked Matrix room using an MSC3952 mention anchor. Queue rejection or discard schedules bounded retries. At exhaustion, one-off reminders are removed
  and recurring reminders retain their next occurrence. The fallback mention helper logs its own
  failures, so failure to send that mention alone does not schedule another delivery.
- **Unencrypted rooms:** Bridged rooms must remain unencrypted, because Matrix encryption cannot be
  disabled once activated. The [encryption gate](#room-encryption-gate) enforces this at link time
  and on every relay.

## Source pointers

- `src/utils/bridges/bridgeUserId.ts`: Pure utilities for parsing `[BridgeName|userId]` webhook
  usernames and validating bridge user identifiers.
- `src/utils/bridges/matrix/client.ts`: Appservice registration, listener binding, and lifecycle.
- `src/utils/bridges/matrix/state.ts`: Validated bridge settings and in-memory caches.
- `src/utils/bridges/matrix/rooms.ts`: Link lookups and the room encryption gate.
- `src/utils/bridges/matrix/events.ts`: Inbound Matrix event handling, command dispatch, and
  webhook relay.
- `src/events/messageCreate/matrixRelay.ts`: Outbound Discord-to-Matrix relay handler and embed
  serialization.
- `src/utils/bridges/matrix/stateSync.ts`: Reply tracking, pending reply channels, and reminder
  mention dispatch.
- `src/utils/bridges/matrix/userMapping.ts`: Persona intent provisioning and display name resolution.
- `src/utils/bridges/matrix/media.ts`: MXC parsing, bounded media download, and upload.
