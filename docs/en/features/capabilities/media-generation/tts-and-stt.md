---
title: "Voice: TTS & STT"
sidebar:
  order: 3
aiGenerated: true
---

TomoriBot can speak and listen in Discord: send voice replies with text-to-speech (TTS),
and transcribe audio messages into conversation context with speech-to-text (STT).

Choose speech providers in `/providers`, or use `/personal providers` for your own Google or
OpenRouter speech models. You can also run local voice models on your own hardware.

## Text-to-Speech
<!-- anchor: text-to-speech -->

### Google Voice Design and OpenRouter Voice Clone

Adding Google selects Gemini Flash TTS for `TTS (Voice Design)`. Adding OpenRouter selects paid
Fish S2.1 Pro for `TTS (Voice Clone)`. Each replaces only its matching selection, so both can stay
active together. Flash-Lite and free Fish require explicit model selection; availability and
provider quotas still apply. Use `/config` > Models > Switch Models to change or clear either slot.
Personal selections and their on/off controls are in `/personal config` > Models > Switch Models.
Turning off one personal mode lets that mode use the server selection while the other stays active.

In `/config` > Persona > Voice, choose `Describe Voice` to save a description of up to 1,000
characters. You can write it before choosing a model. To use Fish or a local cloning model,
add a reference in `/config` > Models > TTS Parameters & Voices and assign it on the persona's
Voice page. Both inputs stay saved when you change providers. Choose `Voice Design` or `Voice
Clone` to set priority; if the preferred input has no matching model or usable voice, the other
saved input can be used. The page explains which source is effective for the server's selections.

Run `/generate voice-message` to enter a short script, or ask the persona to send a voice message.
The command also accepts a one-off description or reference upload. Saved descriptions reuse a
Gemini voice identity; edits retire it. One-off descriptions create a temporary identity that the
bot deletes after generation. Failed cleanup is retried when those credentials are used again;
operators may need to remove voices in the provider console after a crash or ambiguous timeout.
Gemini reference-audio cloning is deferred.

Personal speech failures follow the Server Model Fallback setting and server permissions. A
successful fallback appears in the command receipt. Providers may bill failed or cancelled work;
script and audio limits do not set a spending cap.

### ElevenLabs (cloud)

1. Get an API key from [ElevenLabs](https://elevenlabs.io/app/settings/api-keys).
2. Run `/providers`, choose `Add New Provider`, select `ElevenLabs`, and paste the key. This flow:
   - registers the ElevenLabs speech endpoint and transcription endpoint,
   - activates both endpoints,
   - optionally assigns a voice to one persona immediately.
3. Assign voices to additional personas in `/config` > Persona > Voice. Browse voices in the
   [ElevenLabs Voice Library](https://elevenlabs.io/app/voice-library), where you can also
   clone your own.

Select ElevenLabs in `/providers`, then choose `Edit Endpoint` whenever you need to update the key.

Notes:

- On the free plan, only premade voices work. Browse the
  [premade voice list](https://elevenlabs-sdk.mintlify.app/voices/premade-voices).
- Characters are counted when she generates voice messages. The free tier has monthly limits,
  so monitor your ElevenLabs dashboard.
- Voice replies require `voice_message_enabled` in `/config` > Permissions, and the active persona
  must have a voice assigned.
- Changing `/config` > Persona > Voice requires the Manage Server permission in a server, and
  remains available to the owner in DMs.

In `/help`, choose `Features`, then `Speech`, for the interactive walkthrough in Discord.

### Local voice-cloning engines (self-hosted)

On self-hosted instances, you can run a local voice-clone server. The workflow:
start the server, register its connection and model in `/providers`, select it in
`/providers`, upload a reference sample in `/config` > Models > TTS Parameters & Voices,
then assign it in `/config` > Persona > Voice. Any audio format is accepted (automatically
converted to mono WAV); 10 to 20 second clips without background music work best.

Each engine has its own setup guide:

- [Chatterbox-Turbo/Nano](/self-hosting/local-endpoints/text-to-speech/chatterbox/): fast English voice cloning with emotion tags such as `[laugh]`.
- [Qwen3-TTS](/self-hosting/local-endpoints/text-to-speech/qwen3tts/): multilingual (10 languages) plus a natural-language VoiceDesign mode.
- [MOSS-TTS](/self-hosting/local-endpoints/text-to-speech/moss/): multilingual cloning and English or Chinese voice design.
- [IrodoriTTS](/self-hosting/local-endpoints/text-to-speech/irodoritts/): Japanese-specialized engine that reads emojis as emotion cues.

See the [Text-to-Speech comparison table](/self-hosting/local-endpoints/text-to-speech/) for hardware guidance and the full engine list.

## Speech-to-Text
<!-- anchor: speech-to-text -->

Transcription endpoints turn user audio attachments into text for conversation context.
Whether transcripts are posted publicly in chat is controlled in `/config` > Behavior > Notice Behavior.

### ElevenLabs (cloud)

Adding ElevenLabs from `/providers` registers the transcription endpoint alongside speech.
Use `/providers` to switch between active transcription endpoints.

### Local engines (self-hosted)

- [WhisperX](/self-hosting/local-endpoints/speech-to-text/whisperx/): recommended local path; around 100 languages, GPU-accelerated, multiple model sizes.
- [KoboldCPP](/self-hosting/local-endpoints/speech-to-text/koboldcpp/): works when your build exposes an OpenAI-compatible transcription endpoint.
- [whisper.cpp](/self-hosting/local-endpoints/speech-to-text/whispercpp/).

See the [Speech-to-Text](/self-hosting/local-endpoints/speech-to-text/) hub for the full engine list. For the Discord summary, run `/help`, then choose `Features` and `Transcription`.
