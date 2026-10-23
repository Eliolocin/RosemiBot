---
title: "Voice System"
sidebar:
  label: "Overview"
  groupLabel: "Voice"
aiGenerated: true
---

TomoriBot provides a bidirectional voice pipeline: inbound speech-to-text (STT) transcribes user
audio attachments into conversation context, and outbound text-to-speech (TTS) synthesizes native
Discord voice messages for persona replies.

## Architecture and endpoints

Inbound transcription routes through custom endpoints registered per server. Outbound configuration
stores an independent Voice Design target and Voice Clone target, each a custom endpoint or hosted model:

- `transcription`: powers inbound audio transcription.
- `speech`: powers outbound voice message synthesis.

Custom endpoints support local engines (such as `tts-clone` and `openai-compatible-transcription`)
and ElevenLabs. Hosted synthesis adapters support OpenRouter Fish cloning, OpenRouter Seed Audio
Voice Design, direct Gemini Voice Design, and standard Vertex Voice Design with a `global` location.
Vertex Express has no admitted voice lifecycle transport.

```
INBOUND (STT)
Discord User Audio Attachment
  │
  ▼
admission.ts (transcribeMessageAudioAttachment)
  │  Checks active transcription endpoint
  ▼
Transcription Adapter (OpenAI-compatible / ElevenLabs)
  │  Caches transcript or posts transcript webhook
  ▼
Context Assembly ("\n[System: This was sent as a voice message.]\n<transcript>")

─────────────────────────────────────────────────────────────────────────────

OUTBOUND (TTS)
/generate voice-message OR generate_voice_message Tool
  │
  ▼
voiceSourceCapabilities.ts (resolveVoiceSourceCapabilities)
  │  Determines accepted body shapes (clone vs design vs ElevenLabs)
  ▼
voiceSourceResolution.ts (resolveCandidateVoiceSources)
  │  Selects active voice source with deterministic priority
  ▼
voiceMessageSynthesis.ts (synthesizeVoiceMessage)
  │  Dispatches to backend adapter, returns generated audio and backend
  ▼
voiceMessageDelivery.ts (deliverVoiceMessage)
  │  Multipart payload, waveform, duration, bare MIME type, flags: 8192
  ▼
Discord Channel (Bot REST for main persona, Webhook for alter persona)
```

## Inbound transcription (STT)

When a Discord message includes an audio attachment, turn admission in `src/utils/chat/admission.ts`
initiates transcription via `transcribeMessageAudioAttachment`:

Audio transcription requires an active `transcription` endpoint. Successful transcripts replace the
effective input with the original text plus a voice-message annotation. In transcript chat mode, supported
guild channels receive a user-identity webhook transcript; otherwise admission caches it as `user_stt`.
This mode is controlled by `voice_transcript_chat_mode`, rather than the server notice toggle.

If transcription fails, an audio-only turn is ignored, including when no endpoint is configured.
A message that also contains text can proceed using that text. Failure notices require an eligible
invocation and exclude missing-endpoint or missing-key failures. `evaluateAudioTranscriptionAdmission()`
owns this decision, while `src/utils/audio/audioAttachmentTranscription.ts` owns downloading and backend dispatch.

## Outbound synthesis (TTS)

Outbound synthesis is driven by two pathways:

- The `generate_voice_message` LLM tool, available when the active persona has a compatible voice
  assignment.
- The `/generate voice-message` slash command, which drives the speech endpoint directly without an
  LLM call.

The command, tool availability, tool assembly, and execution resolve speech targets for the
triggering user independently of the chat provider. Both callers pass the discriminated target,
source, credential ownership, and fallback context to the shared dispatcher.

Both callers converge on shared synthesis and delivery modules:

| Module | Responsibility |
|---|---|
| `src/utils/speech/voiceSourceCapabilities.ts` | Resolves which request bodies an endpoint accepts. |
| `src/utils/speech/voiceSourceResolution.ts` | Matches voice sources to the two targets and applies persona priority. |
| `src/utils/speech/voiceMessageSynthesis.ts` | Dispatches synthesis and returns generated audio and its backend. |
| `src/utils/discord/webhook/voiceMessageDelivery.ts` | Transmits native Discord voice message payloads. |

### Source resolution and endpoint capabilities

`resolveVoiceSourceCapabilities` inspects a custom endpoint or hosted model to determine supported
request formats:

- `acceptsCloneShape`: endpoint accepts reference audio clips (`ref_audio` and `ref_text`).
- `acceptsDesignShape`: endpoint accepts text prompt instructions (`instruct`).
- `cloneInstructionsAvailable`: clone endpoints that accept delivery directives via `instruct`.

Endpoints using the `tts-clone` API style declare a `voice_mode` of `clone`, `voice-design`, or
`auto`. An `auto` endpoint accepts both clone and design request shapes on a single endpoint URL.
ElevenLabs endpoints accept neither shape, relying strictly on stored voice identifiers.

Server speech routing stores an independent Design target and Clone target in `server_speech_configs`.
Each mode selects either a custom endpoint or a hosted `speech_models` row; database validation
rejects selecting both. Design accepts local `voice-design` or `auto` endpoints, registered Gemini
Design models, and admitted OpenRouter Design models. Clone accepts local `clone` or `auto` endpoints,
ElevenLabs, and admitted Fish models. Hosted rows are never `auto`, so a hosted selection fills one slot.
Transcription continues to use `is_default`.

`speechEndpointResolver.ts` returns a discriminated hosted-model or custom-endpoint target with its
credential owner. Hosted credentials come from that model's provider snapshot; custom endpoint keys
remain connection-bound. Personal `speech_design` and `speech_clone` assignments override their server
slots independently when enabled. Disabling one mode preserves its saved model and owner, while
resolution inherits the server target for that mode. Personal local endpoints are unsupported.

The catalogue keeps one default per provider and voice mode: Flash TTS for Google and Vertex Design,
Seed Audio 1.0 for OpenRouter Design, and paid Fish S2.1 Pro for OpenRouter Clone. Flash-Lite and free
Fish require explicit selection. Adding a provider applies its default for each mode, using matching
saved credentials. Google and Vertex replace the Design slot. OpenRouter's Design default is additive:
it fills Design only when the owner has no Design target, so adding or re-keying OpenRouter never
replaces a Gemini or Vertex design. Each mode is written in its own transaction, so a Design failure
after a successful Clone leaves Clone set; retrying is idempotent. Schema upgrades preserve existing
targets, so an existing OpenRouter owner's empty Design slot stays empty until they select Seed or
add the OpenRouter key again, which reruns the defaults and fills it.
Credentials saved before hosted speech existed receive the same defaults once, for each server and
user with no speech target, registered speech endpoint, or personal speech assignment; each mode
takes the first eligible provider in the order Google, OpenRouter, Vertex.

Activating a registration replaces every slot its mode supports in one transaction. Auto replaces
both slots with the same endpoint. Clearing one slot preserves the other. Mode edits clear unsupported
selections, and endpoint or connection deletion clears its references. The migration selects the
former default by `updated_at DESC, custom_endpoint_id DESC` and fills only its supported slots.

Both generation callers resolve saved sources against selected custom or hosted targets before synthesis.
A persona's `voice_source_priority` defaults to Design; if that saved source or its matching target
is unavailable, the other usable pair wins. Existing Auto personas with a sample and no
`VoiceDesign` marker migrate to Clone priority. Voice names are display text.

The command puts an uploaded reference first, then a typed description, then saved sources in persona
priority order. Its source selection applies only to that invocation. Submission rechecks the target
and saved source; stale forms require a new invocation. Revalidation includes target kind, model
identity, provider, credential owner, and credential revision. Tool assembly records the selected
source and target identity in the turn context; execution checks them against fresh selections and
persona state before synthesis. Delivery direction and expressiveness apply
to the selected target. Neither caller retries synthesis through the other slot after a failure.

Persona > Voice keeps both source sections and priority controls available without an active target.
The workspace exposes this page to server managers and the DM owner; non-manager guild views omit it.
The description preview uses the same fenced preview as other persona text editors. Saving or clearing
a description preserves the reference sample, ElevenLabs voice ID, and priority. Only the Clone target
chooses between the reference library and ElevenLabs catalogue, including when no Clone target is
selected. The quote below the selector identifies its contents and points to reference management.
Clear actions name and remove only their own source, even if the provider changes before the click.
The priority effect names the effective source and target and explains why a secondary source is used.
Missing or incompatible targets produce a quote notice linking to `/config` > Models while authoring stays
available. Generation retains the legacy optional ElevenLabs credential path; the persona selector shows an
ElevenLabs catalogue only when ElevenLabs is the active Clone target. A saved ElevenLabs ID has a separate
clear action beside the reference library when another Clone target or no Clone target is selected.
Saved descriptions, preset imports, and hosted synthesis share the 1,000-character description limit.

### Stored voice bindings

`SpeechRepository.ts` persists Gemini voice IDs separately from persona prompts and ElevenLabs IDs.
Binding identity includes the persona, credential snapshot and revision, transport, prompt hash, and
Cloud project/location. The synthesis model is excluded, so Flash and Flash-Lite can share a binding.
A unique index retains one active identity during concurrent creation.

Prompt edits and credential ciphertext replacement mark bindings for deletion. Changing source
priority preserves them. Persona deletion retains the remote voice ID as a pending deletion with no
persona reference. Bindings cascade when their credential snapshot is removed, so provider cleanup
uses the old credential before replacing or removing that snapshot. Persona removal attempts cleanup
after its database write succeeds. Subsequent operations retry known pending deletions for the same
owner and credential revision; a replacement key never attempts to delete an old revision's voices.
Pending rows from older revisions or other Cloud projects or locations remain available for manual
recovery but do not affect subsequent cleanup status or repeat the original operator error. Failures for the
current credential and project remain retryable and continue to report pending cleanup. Bindings are
excluded from configuration exports and have no in-memory cache.

`googleVoiceLifecycle.ts` creates saved identities lazily and retains the binding selected by the
database's unique index. Concurrent creators delete their surplus voices. A prompt check in the save
transaction rejects an identity created while the persona's description changed. Delivery direction
does not affect identity. Successful synthesis clears the old expiry estimate because provider use
extends the voice's lifetime. A recorded expiry, or a failed synthesis followed by a confirmed missing
voice lookup, permits one recreation. Authentication, quota, and transient failures preserve identity.

One-off descriptions create temporary stored voices and delete them in `finally`. Cleanup uses a
separate bounded signal so turn cancellation cannot skip it. Failed deletions remain in the binding
store and produce an operator error with provider-console recovery instructions. A crash before the
voice ID is saved, cancellation or an ambiguous timeout during creation, or credential removal after
failed cleanup can leave a remote voice that requires manual removal in the provider console.
Cleanup has no scheduler.

### Hosted dispatcher contract

The shared dispatcher implements hosted synthesis when a request supplies a resolved `target`.
Hosted requests enforce 2,000 script, 1,000 description, and 300 delivery-direction characters, a
240-second generation deadline, and a 10 MiB decoded output ceiling. `maxOutputBytes` can impose a
smaller destination attachment limit. Reference audio uses the existing sample download and WAV
conversion owners, with byte limits checked again after conversion. Oversized references are rejected
without trimming. These limits do not establish a monetary cap.

OpenRouter Clone requests inline reference bytes and MP3 output. Seed interprets `input` instead of
reading it aloud and ignores `instructions`, so an OpenRouter Design request sends one composed prompt,
`Speaker (<description>) says, <direction>: "<script>"`, with inner double quotes turned into single
quotes. `openrouterSpeechModels.ts` records each admitted model's request shape, Seed's
2,048-character prompt ceiling (shared by the description, direction, and script), and a
1,100-character script ceiling measured against OpenRouter's 120-second audio cap, which it enforces
with a 400 before generating. Either overflow fails before any request as `script_too_long`, which shows a dedicated notice and does not start server
fallback. Seed keeps no remote voice, so it samples the voice again for every message and never writes
`speech_voice_bindings`. Selecting an OpenRouter model rechecks the live catalogue; Clone also requires
an endpoint with `supports_voice_cloning`, while Design checks presence only because no endpoint flag
describes text-prompted design. Gemini and Vertex requests keep the voice description, spoken text, and
direction separate and validate WAV output. Response reads are bounded
before JSON/base64 allocation; audio validation rejects empty, malformed, truncated, wrong-MIME, and
oversized output. Hosted credentials use fixed provider origins with redirects disabled. Cancellation
reaches creation, synthesis, response reads, reference downloads, and conversion. It cannot undo
provider work already accepted.

A request's `routing` context identifies the triggering user and whether its source was explicit.
After a qualifying personal provider failure, the dispatcher may resolve fresh server targets once.
The user's `personal_server_fallback_enabled` setting and the server's BYOK restriction both apply.
Saved persona sources are resolved again against server targets in persona priority order; an explicit
source stays fixed and requires a compatible target. Invalid input, cancellation, and successful
synthesis do not start fallback. Delivery runs after synthesis and cannot initiate another generation.

Results retain provider, model, credential scope, and operation usage for every attempt, including a
failed personal attempt before server fallback. Creation and synthesis usage remain separate.
OpenRouter generation IDs support one bounded metadata lookup; missing cost stays unknown, and a
failed lookup preserves generated audio. The dispatcher reports synthesis success independently of
Discord delivery. The command and tool own delivery and `audio_generated` metrics for their connected
custom and hosted paths. Command receipts and tool results report the final source and target label,
including server fallback: a custom endpoint's label or a hosted model's codename.

The dispatcher reports every failed hosted or ElevenLabs attempt through `reportProviderFailure`, so a
failed personal attempt and its server fallback each produce a record. Provider 400 and 422 responses,
5xx responses, malformed responses, and network failures become `log.error` records carrying the
provider status and response body, with the request's own key removed. Cancellation, timeouts, local
input checks, and authentication, quota, or rate-limit refusals become a `provider_failure` metric and a
warning. A provider `invalid_request` is told apart from a local one by the status it carries. The
command's failure notice offers that same detail behind **Show Full Error**, gated like the chat error
modal: Manage Server for a server credential, and only the requester for a personal one. The voice tool
keeps the detail out of its result because the model reads tool results.

## Native Discord delivery constraints

Discord voice messages must comply with strict gateway and REST requirements handled by
`src/utils/discord/webhook/voiceMessageDelivery.ts`:

- **Voice message flag:** Payloads must set message flag 8192 (`MessageFlags.IsVoiceMessage`).
- **Multipart transmission:** Attachment metadata (`waveform` and `duration_secs`) must transmit
  via raw multipart `FormData`. Discord's standard `MessagePayload` serializes attachments through a
  wrapper that drops unrecognized fields.
- **REST body passthrough:** Bot REST paths must specify `passThroughBody` so the Discord REST
  manager does not convert the `FormData` body into JSON.
- **Bare MIME types:** Discord rejects voice waveform metadata when content types contain
  parameters. Content types are normalized to bare MIME strings (such as `audio/ogg` or `audio/wav`).
- **Webhook acknowledgement:** Webhook executions require `wait=true` to retrieve the created
  message ID.

### Identity resolution

Voice messages preserve persona identity through the same transport split used by text chat:

- **Main persona:** Sent via Bot REST using the bot's native username and avatar.
- **Alter persona:** Sent via persona webhook using `resolvePersonaWebhookIdentity`. Locally stored
  avatars resolve to `avatarDataUri` rather than public HTTP URLs; reading `avatarUrl` alone would
  cause webhooks to post with the bot's default avatar.
- **Delivery fallback:** If native webhook delivery fails, the helper tries bot REST, then an ordinary
  attachment. A fallback can change the displayed identity or lose native voice metadata. Tool cancellation
  forwards an abort signal to synthesis and checks it before delivery; it cannot undo provider work
  already accepted.
- **Channel routing:** Deliveries address the destination channel directly by snowflake ID. When
  posting into a thread, delivery targets the thread ID itself rather than the thread's parent
  channel.

## Related documentation

- [Text-to-Speech self-hosting](/self-hosting/local-endpoints/text-to-speech/)
- [Speech-to-Text self-hosting](/self-hosting/local-endpoints/speech-to-text/)

## Source pointers

- `src/utils/chat/admission.ts`: Audio attachment detection and transcription dispatch during
  turn admission.
- `src/utils/speech/voiceSourceCapabilities.ts`: Speech endpoint capability resolution.
- `src/utils/speech/voiceSourceResolution.ts`: Candidate voice source discovery and prioritization.
- `src/utils/speech/voiceMessageSynthesis.ts`: Multi-backend synthesis dispatcher and attempt metadata.
- `src/utils/discord/webhook/voiceMessageDelivery.ts`: Native Discord voice message payload delivery.
- `src/tools/functionCalls/generateVoiceMessageTool.ts`: Built-in LLM voice message tool.
