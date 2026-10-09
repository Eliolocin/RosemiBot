---
title: "Voice: TTS & STT"
sidebar:
  order: 3
---

TomoriBot can speak and listen in Discord: send voice replies with text-to-speech (TTS),
and transcribe audio messages into conversation context with speech-to-text (STT).

Both use the provider endpoint system. ElevenLabs is the quickest cloud option. You can
also run local voice models on your own hardware using self-hosted engines.

## Text-to-Speech
<!-- anchor: text-to-speech -->

### ElevenLabs (cloud, easiest)

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
