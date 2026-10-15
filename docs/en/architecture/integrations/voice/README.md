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

Voice features route through custom endpoint capabilities registered per server:

- `transcription`: powers inbound audio transcription.
- `speech`: powers outbound voice message synthesis.

Endpoints support local engines (such as `tts-clone` and `openai-compatible-transcription`) and
hosted providers (ElevenLabs).

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
  │  Dispatches to backend adapter, records audio_generated metric
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

Both callers converge on shared synthesis and delivery modules:

| Module | Responsibility |
|---|---|
| `src/utils/speech/voiceSourceCapabilities.ts` | Resolves which request bodies an endpoint accepts. |
| `src/utils/speech/voiceSourceResolution.ts` | Matches voice sources to the two targets and applies persona priority. |
| `src/utils/speech/voiceMessageSynthesis.ts` | Dispatches synthesis to the target adapter and records metrics. |
| `src/utils/discord/webhook/voiceMessageDelivery.ts` | Transmits native Discord voice message payloads. |

### Source resolution and endpoint capabilities

`resolveVoiceSourceCapabilities` inspects the active `speech` endpoint to determine supported
request formats:

- `acceptsCloneShape`: endpoint accepts reference audio clips (`ref_audio` and `ref_text`).
- `acceptsDesignShape`: endpoint accepts text prompt instructions (`instruct`).
- `cloneInstructionsAvailable`: clone endpoints that accept delivery directives via `instruct`.

Endpoints using the `tts-clone` API style declare a `voice_mode` of `clone`, `voice-design`, or
`auto`. An `auto` endpoint accepts both clone and design request shapes on a single endpoint URL.
ElevenLabs endpoints accept neither shape, relying strictly on stored voice identifiers.

Server speech routing stores an independent Design target and Clone target in `server_speech_configs`.
Each mode selects either a custom endpoint or a hosted `speech_models` row; database validation
rejects selecting both. Design accepts local `voice-design` or `auto` endpoints and registered Gemini
Design models. Clone accepts local `clone` or `auto` endpoints, ElevenLabs, and admitted Fish models.
Transcription continues to use `is_default`.

`speechEndpointResolver.ts` returns a discriminated hosted-model or custom-endpoint target with its
credential owner. Hosted credentials come from that model's provider snapshot; custom endpoint keys
remain connection-bound. Personal `speech_design` and `speech_clone` assignments override their server
slots independently when enabled. Disabling one mode preserves its saved model and owner, while
resolution inherits the server target for that mode. Personal local endpoints are unsupported.

Adding Google or OpenRouter applies its default speech model to Design or Clone respectively, using
matching saved credentials. The catalogue seeds Flash TTS for Design and paid Fish S2.1 Pro for Clone;
Flash-Lite and free Fish require explicit selection. Schema upgrades preserve existing targets and
do not activate hosted defaults.

Activating a registration replaces every slot its mode supports in one transaction. Auto replaces
both slots with the same endpoint. Clearing one slot preserves the other. Mode edits clear unsupported
selections, and endpoint or connection deletion clears its references. The migration selects the
former default by `updated_at DESC, custom_endpoint_id DESC` and fills only its supported slots.

Both generation callers resolve saved sources against their matching targets before synthesis.
A persona's `voice_source_priority` defaults to Design; if that saved source or its matching target
is unavailable, the other usable pair wins. Existing Auto personas with a sample and no
`VoiceDesign` marker migrate to Clone priority. Voice names are display text.

The command puts an uploaded reference first, then a typed description, then saved sources in persona
priority order. Its source selection applies only to that invocation. Submission rechecks the target
and saved source; stale forms require a new invocation. Delivery direction and expressiveness apply
to the selected target. Neither caller retries synthesis through the other slot after a failure.

Persona > Voice keeps the description editor available without an active target. Saving or clearing
a description preserves the reference sample, ElevenLabs voice ID, and priority. Only the Clone target
chooses between the reference library and ElevenLabs catalogue. Legacy installations with an
ElevenLabs optional key and no Clone endpoint retain that credential path.

### Stored voice bindings

`SpeechRepository.ts` persists Gemini voice IDs separately from persona prompts and ElevenLabs IDs.
Binding identity includes the persona, credential snapshot and revision, transport, prompt hash, and
Cloud project/location. The synthesis model is excluded, so Flash and Flash-Lite can share a binding.
A unique index retains one active identity during concurrent creation.

Prompt edits and credential ciphertext replacement mark bindings for deletion. Changing source
priority preserves them. Persona deletion retains the remote voice ID as a pending deletion with no
persona reference. Bindings cascade when their credential snapshot is removed, so provider cleanup
must use the old credential before removing that snapshot. Bindings are excluded from configuration
exports and have no in-memory cache.

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
- `src/utils/speech/voiceMessageSynthesis.ts`: Multi-backend synthesis dispatcher and metrics.
- `src/utils/discord/webhook/voiceMessageDelivery.ts`: Native Discord voice message payload delivery.
- `src/tools/functionCalls/generateVoiceMessageTool.ts`: Built-in LLM voice message tool.
