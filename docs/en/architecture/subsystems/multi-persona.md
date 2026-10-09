---
title: "Multi-Persona System"
---

The multi-persona subsystem manages server-scoped character identities, coordinating one main persona and multiple alter personas. It governs identity persistence, single-owner trigger routing, sequential reply queuing, and webhook-based chat rendering while sharing conversation history and server configuration.

Official bundled presets follow a copy-on-write pointer model described in [Persona Presets](/architecture/subsystems/persona-presets/).

## Data model and ownership

Persona identity and behavior are stored across four core tables:

### `personas`

Each row defines a persona identity in a server:

- `is_alter`: `false` for the main persona; `true` for alter personas.
- `webhook_avatar_url`: Stored avatar reference. In production this is an object storage URL. In non-production environments it references a local file under `data/avatars/`. For unforked preset pointers, this is `NULL` and resolves the shared catalog URL live.
- `applied_avatar_hash`: For main preset pointers, the content hash last applied to the Discord guild member avatar by the background reconciler.
- `persona_lineage_id`: Scopes memory, conditioning history, and prompt inspection. Derived from preset lineage on creation, but preserved independently during pointer materialization.

### `persona_configs`

Holds per-persona behavior settings:

- `trigger_words`: Array of trigger strings for the persona.
- `humanizer_degree`: Optional per-persona humanizer level override. When set, state loading overlays this value onto the persona's assembled configuration so providers and stream buffers see persona-scoped humanization without call-site awareness.

### `persona_sprites`

Stores named avatar variations selected by generated render modifiers:

- `sprite_name`: Display label presented in prompt instructions.
- `sprite_key`: Normalized key for case-insensitive lookup.
- `avatar_url`: Object storage URL or local development asset path.
- `usage_instructions`: Guidance injected into the prompt describing when to adopt the sprite.
- `is_identity`: When `true`, renders the decorated `sprite (SourcePersona)` username directly in Discord (DID alter style). When `false`, renders the clean persona nickname.

Pointer personas resolve sprites live from `preset_sprites` via `PersonaSpriteRepository.listForPersona()`. Materializing a persona copies these rows by reference.

### `reminders`

Stores scheduled reminder tasks:

- `persona_id`: Identifies the persona that created the reminder. Delivery runs with that persona's identity, falling back to the main persona if the creating persona was deleted.

## Triggering and routing

### Direct routing

Incoming messages route through these priorities:

- **Direct bot replies**: Replying to a message sent by the bot user routes to the main persona.
- **Webhook replies**: `webhookIdentity.ts` verifies the webhook ID against the managed webhook cache or repository for that guild and channel before matching a persona nickname. Threads use the parent channel's registration. Copied render names resolve only after this check. A failed lookup grants no persona identity.
- **Bot mentions**: Mentioning the bot routes to the main persona.
- **Explicit trigger words**: Matching strings in `persona_configs.trigger_words` activate the matching personas.

Direct replies and mentions can combine with trigger words in the same message, scheduling multiple personas to respond.

### Single-owner trigger resolution

Because official character presets include the shared base name (`tomori`), pointer personas resolving triggers live would all match the same name simultaneously. `PersonaRepository.applyTriggerWordOwnership()` prevents collisions by assigning single ownership whenever a server's persona set is assembled:

1. **Main persona**: Reserves the locale's base trigger words from `getAllBaseTriggerWords()`, preventing alter personas from claiming the bot's core name.
2. **Alters in creation order**: Evaluated in ascending `persona_id` order. The oldest alter claims contested words; later alters drop them.

This deduplication runs at read time, so routing remains consistent across imports, materialization, and preset updates.

### Turn queuing and cascade limits

When an incoming message triggers multiple personas:

- `planChatTurns` in `src/utils/chat/turnPlanner.ts` identifies all matching personas.
- The first persona executes immediately.
- `queueAdditionalPersonaTurns()` in `src/utils/chat/personaQueue.ts` serializes subsequent personas by inserting them at the front of the channel lock queue (`queuePersonaJobsAtFront`). Personas respond consecutively before newer user messages in the queue.

To prevent uncontrolled cascades, `server_chat_configs.cascade_limit` (default 3) and `match_limit` (default 3) constrain activations:

- **First trigger free**: The initial persona activation in a trigger session does not consume the cascade budget.
- **Shared counter**: All subsequent automatic triggers in the session (multi-persona co-matches or persona-to-persona chain mentions) increment a channel-scoped counter.
- **Bypass**: Slash commands (`isManuallyTriggered = true`) and stop responses bypass the cascade counter.
- **Session reset**: The counter resets when a real user sends a message or after 30 minutes of inactivity (`SELF_REPLY_CHAIN_TTL_MS`).
- **Streaming interrupts**: If an incoming message carries an explicit trigger for a different persona while a stream is active, it bypasses follow-up mode and queues as a separate turn.

## Context isolation and participant profiles

Multi-persona turns within the same request share sanitized visible history through `prepareParticipantContext()`:

- A `ParticipantRequestScope` attached to `LockedChatTurn` memoizes discovery for equivalent sanitized
  inputs. Changed history gets a separate entry; each preparation call recomposes the active persona
  and hydrates its profiles. Queued persona jobs can acquire a fresh lock and scope.
- The active persona is excluded from public participant profiles.
- Co-responders and personas referenced by trigger text in visible history are injected into conversation participants with their public attributes and physical appearance tags.
- Private attributes remain visible only to their owning persona.
- Tool loops and function-call histories remain strictly isolated per persona turn.

## Rendering and delivery

Main and alter personas use different Discord delivery mechanisms:

```
Incoming Turn
  ├── Main Persona  ──> Discord Bot User (Guild Member Nickname)
  └── Alter Persona ──> Shared Channel Webhook ("TomoriBot Multi-Persona")
                         ├── Username: persona nickname or sprite label
                         └── AvatarURL: S3 URL / local asset / shared preset
```

### Webhook delivery

Alters deliver through a shared channel webhook (`TomoriBot Multi-Persona`):

- **Identity overrides**: Each send specifies `username` (persona nickname) and `avatarURL` (`webhook_avatar_url`).
- **Historic identity resolution**: Admission, reply attribution, context assembly, history import, and queued persona routing use verified managed webhook identity. The bot's own direct messages retain the main persona identity. Matrix relay prefixes and cached user impersonation are trusted only on a managed webhook. Foreign webhooks keep a generic webhook identity in history and cannot start natural persona jobs or gain their quota/cooldown exemptions. Managed cascades keep their originating user's metering. `getReplyContextAuthorName()` strips bridge prefixes only on verified sources. Direct bot messages use the available member display name, so later nickname changes can affect reconstructed attribution.

### Copied rendering and sprites

A persona can render lines with sprite avatars or copied identities using leading modifier syntax:

```text
SourcePersona (target): message
```

Resolution follows this sequence:

1. **Sprite match**: Matches `persona_sprites.sprite_key` on the active persona. Ordinary sprites (`is_identity = false`) render the clean persona nickname in Discord; identity sprites (`is_identity = true`) render `sprite (SourcePersona)`. To prevent Discord from grouping consecutive messages under the first avatar, alternating messages fall back to decorated usernames. Delivered mappings are recorded in `persona_sprite_messages` so context rebuilding restores model-facing labels.
2. **Copied identity**: Resolves `target` against known personas and conversation users, rendering `target (SourcePersona)` with the target's avatar.
3. **Plain output**: Unmatched modifiers are stripped before delivery.

### Embeds and stickers

- **Tool embeds**: Tool results sent via `sendStandardEmbed` reuse the persona webhook identity when available.
- **Stickers**: Webhooks cannot dispatch native Discord stickers. For alters, TomoriBot posts the sticker CDN preview URL via webhook; if delivery fails, it falls back to a standard bot message.

## Source pointers

- `src/utils/db/repositories/PersonaRepository.ts`: Persona loading, configuration caching, and single-owner trigger deduction (`applyTriggerWordOwnership`).
- `src/utils/chat/turnPlanner.ts`: Turn evaluation and trigger matching.
- `src/utils/chat/personaQueue.ts`: Front-of-queue serialization (`queueAdditionalPersonaTurns`).
- `src/utils/text/participants/preparation.ts`: Turn-scoped participant discovery and public profile filtering.
- `src/utils/discord/webhookManager.ts`: Shared channel webhook lifecycle and delivery.
- `src/utils/discord/webhookReply.ts`: Historic author identity recovery (`getReplyContextAuthorName`).
- `src/utils/discord/renderModifierParser.ts`: Sprite and copied-identity syntax parsing.
