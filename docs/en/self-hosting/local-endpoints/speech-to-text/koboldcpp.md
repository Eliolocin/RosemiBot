---
title: "KoboldCPP Transcription"
sidebar:
  order: 3
---

Use your existing [KoboldCPP](https://github.com/LostRuins/koboldcpp) instance to transcribe audio attachments and voice messages in TomoriBot.

KoboldCPP includes Whisper-based speech-to-text. TomoriBot connects to KoboldCPP using its OpenAI-compatible audio transcription endpoint (`POST /v1/audio/transcriptions`).

## Setup

Start KoboldCPP with Whisper/STT enabled and confirm your build exposes:

- `POST /v1/audio/transcriptions`
- `GET /v1/models` or `GET /models`

Keep KoboldCPP running while TomoriBot is using it. If your build only exposes `/api/extra/transcribe` or another custom shape, use a wrapper until TomoriBot has a dedicated adapter.

## Register in TomoriBot

Run `/providers`, choose `Add New Custom Endpoint`, and use the transcription API compatibility:

- API Compatibility: `openai-compatible-transcription`
- `endpoint_url`: your KoboldCPP server root

After saving the connection, select it and use its model dropdown to add the model name your server reports as a Transcription model.

Use `/providers` for endpoint registration and model setup. Then open `/config` > Models > Switch Models to select and activate the registered endpoint.

## Use transcripts

After registration, TomoriBot transcribes audio attachments in the background and adds the text to chat context. Use `/config` > Engine > Notices only if you also want transcripts posted visibly in chat.
