---
title: "IrodoriTTS"
aiGenerated: true
---

Generate natural Japanese speech with voice cloning, caption-based VoiceDesign, and expressive emoji markup using [Irodori-TTS v4.1](https://github.com/Aratako/Irodori-TTS).

Irodori-TTS v4.1 is a Japanese-focused text-to-speech model supporting both voice cloning and text-described VoiceDesign within a single checkpoint. TomoriBot connects to Irodori through the local FastAPI wrapper in `servers/tts/irodoritts/`, defaulting to `Aratako/Irodori-TTS-v4.1-Small`.

Compatible Hugging Face checkpoints can be selected with `IRODORI_TTS_MODEL_ID`, including community fine-tunes such as `phasefield-audio/Irodori-TTS-v4.1-Anime`.

## Setup

Irodori uses `uv` for dependency and PyTorch backend management. The server maintains its own `pyproject.toml` with pinned Irodori and `dacvae` dependencies for reproducible installations. Install `uv` first, then run the setup script from the TomoriBot repository root:

### Windows PowerShell (NVIDIA)

```powershell
.\servers\tts\irodoritts\install-irodori.ps1 cu128
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

### Linux Bash (NVIDIA)

```bash
bash servers/tts/irodoritts/install-irodori.sh cu128
servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

The setup scripts create `servers/tts/irodoritts/.venv`, so `bun run launch --irodoritts` continues to work after installation.

Available backends:

- `cu128`: NVIDIA CUDA 12.8 on Windows and Linux
- `cpu`: CPU-only, or macOS CPU/MPS through PyPI
- `rocm`: AMD ROCm on Linux/WSL
- `xpu`: Intel XPU on Windows and Linux

The default endpoint URL is `http://127.0.0.1:8013`.

## Using a different checkpoint

The default model is `Aratako/Irodori-TTS-v4.1-Small`. You can select other official checkpoints (including the 3.29B parameter Large model and its quantized variants), community fine-tunes, or local checkpoint files through environment variables.

### Checkpoints and variants

| Model / `IRODORI_TTS_MODEL_ID` | Parameters | Checkpoint size | Recommended VRAM | Notes |
|---|---|---|---|---|
| `Aratako/Irodori-TTS-v4.1-Small` | 766M | 1.5 GB | 4-6 GB | Default model: fast inference and low memory use. |
| `Aratako/Irodori-TTS-v4-Large` | 3.29B | 12.25 GB | 10-14 GB | Full unquantized Large model with T5Gemma 2 text backbone. |
| `Aratako/Irodori-TTS-v4-Large-Quantized/float8-weight-only` | 3.29B | 3.58 GB | 6-8 GB | FP8 weights with BF16 activations: recommended for NVIDIA Ada (RTX 40-series) and newer. |
| `Aratako/Irodori-TTS-v4-Large-Quantized/int8-weight-only` | 3.29B | 3.58 GB | 6-8 GB | General-purpose INT8 weights with BF16 compute on NVIDIA CUDA. |
| `Aratako/Irodori-TTS-v4-Large-Quantized/int4-weight-only` | 3.29B | 2.75 GB | 5-6 GB | Smallest Large variant: requires NVIDIA Ampere (RTX 30-series) or newer. |
| `phasefield-audio/Irodori-TTS-v4.1-Anime` | 766M | 1.5 GB | 4-6 GB | Community fine-tune for anime-style speech delivery. |

### Choosing between Small and Large

- **Reference voice cloning (recommended: `v4.1-Small`):** For clean reference clips (15-30 seconds), `v4.1-Small` renders faster (~0.23x RTF on modern GPUs) and produces sharper, higher-contrast vocal harmonics with punchy Japanese prosody. Pure reference voice cloning does not benefit from the heavier model.
- **VoiceDesign and long reference audio (recommended: `v4-Large`):** The 3.29B Large model integrates a 1B T5Gemma 2 text backbone, giving it superior adherence to natural-language VoiceDesign caption prompts (describing delivery, timbre, and mood) and supporting up to 120 seconds of combined reference audio. On pure reference clips without descriptive captions, Large produces a softer, breathier texture at roughly 0.75x RTF.

When you start the server (directly with Python or via `bun run launch --irodoritts`), it automatically reads the repository root `.env` (or a local `.env` in `servers/tts/irodoritts/`) and logs the active model ID on startup.

### Via `.env` (persistent)

Add to your `.env` in the TomoriBot root:

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### Via environment variable per session

In Windows PowerShell:

```powershell
$env:IRODORI_TTS_MODEL_ID = "phasefield-audio/Irodori-TTS-v4.1-Anime"
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

On Linux Bash:

```bash
IRODORI_TTS_MODEL_ID=phasefield-audio/Irodori-TTS-v4.1-Anime \
  servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

### Using a local checkpoint file

If you have downloaded a checkpoint file (`.pt` or `.safetensors`) locally, set `IRODORI_TTS_CHECKPOINT` to its path:

```dotenv
IRODORI_TTS_CHECKPOINT="/path/to/custom_checkpoint.pt"
```

Current Irodori downloads the checkpoint together with any tokenizer assets bundled in the Hugging Face repo. Hugging Face subfolder variants are also supported by `IRODORI_TTS_MODEL_ID` when the model repo provides them.

## Register in TomoriBot

Run `/providers`, choose `Add New Custom Endpoint`, and use the speech API compatibility:

- API Compatibility: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8013`

After saving the connection, select it and use its model dropdown to add a Speech model. For v4.1, the recommended settings are:

- `Voice Source Mode`: `Auto`
- `Script Markup Style`: `Emoji`

`Auto` lets the same Irodori endpoint support both TomoriBot voice modes, so emotion cues survive the send:

- Personas with a voice sample assigned under Persona > Voice send a stored reference clip for voice cloning.
- Personas with a VoiceDesign prompt set under Persona > Voice send the saved natural-language prompt as Irodori caption conditioning.

You can still choose `Voice Clone` as the Voice Source Mode if you only want reference-audio voice cloning.

Use `/providers` for endpoint registration and model setup. Then open `/config` > Models > Switch Models to select and activate the registered endpoint.

## Set up persona voices

### Voice cloning

1. Prepare a clean Japanese voice clip with one speaker and no background music. Around 30 seconds is already enough: past that point the extra audio buys little timbre fidelity while costing upload size and inference time.
2. Open `/config` under Models > TTS Parameters & Voices and upload the clip.
3. Open `/config` under Persona > Voice, then choose the persona and the voice sample.

Irodori v4.1 supports longer reference conditioning than earlier models, but clean source audio remains more important than raw duration.

The v4.1 runtime caps the reference clip at the checkpoint default, which the v4.1 checkpoint sets to 120 seconds. Anything longer is trimmed to that cap rather than refused, and `IRODORI_MAX_REF_SECONDS` overrides it. A clip at TomoriBot's 130-second upload ceiling therefore still works: Irodori conditions on the first 120 seconds of it.

Longer clips do not improve voice quality. Upstream reports that approximately 30 seconds of clean reference speech already captures most of the measurable speaker-similarity gain, and that multiple shorter clips from the same speaker beat one long recording. The extra reference latent steps that come with a longer clip also lengthen every synthesis request. Reach past 30 seconds only when a speaker's timbre drifts across the recording.

### VoiceDesign

1. Open `/config` under Persona > Voice.
2. Choose the persona.
3. Enter a natural-language description of the desired voice and delivery.

TomoriBot sends this prompt as `instruct`; the Irodori wrapper maps it to the v4.1 `caption` condition. VoiceDesign requests do not require a stored reference clip.

TomoriBot strips Discord custom emoji syntax before sending text to TTS. With `script_markup: emoji`, Unicode emojis are preserved for Irodori's text conditioning.

### Emoji style controls

IrodoriTTS supports emoji annotations in input text to influence sound effects, speaking styles, and emotional expressions. With TomoriBot's `Script Markup Style` set to `Emoji`, these Unicode emojis are preserved and sent to Irodori.

| Emoji | Meaning / emotion / style |
| --- | --- |
| 👂 | Whisper, sounds close to the ear |
| 😮‍💨 | Breath, sigh, sleeping breath |
| ⏸️ | Pause, silence |
| 🤭 | Chuckle, giggle, suppressed laugh |
| 🥵 | Panting, moan, groan |
| 📢 | Echo, reverb |
| 😏 | Teasing, playfully sweet / coaxing |
| 🥺 | Trembling voice, timidly / uncertainly |
| 🌬️ | Shortness of breath, heavy breathing |
| 😮 | Gasp |
| 👅 | Licking sound, chewing sound, wet sound |
| 💋 | Lip smack / lip noise |
| 🫶 | Gently, tenderly |
| 😭 | Sobbing, crying, sorrowfully / sadly |
| 😱 | Scream, shout, shriek |
| 😪 | Sleepily, sluggishly / languidly |
| 😴 | Sleep talking, snoring |
| ⏩ | Fast-speaking, rapid-fire, hurriedly |
| 📞 | Over the phone, through a speaker |
| 🐢 | Slowly |
| 🥤 | Gulp, swallowing sound |
| 🤧 | Coughing, sniffling, sneeze, clearing throat |
| 😒 | Tutting, clicking tongue |
| 😰 | Panicked, agitated, nervous, stuttering |
| 😆 | Joyfully, happily |
| 💥 | With force / momentum, forcefully |
| 😠 | Angry, displeased, sulking |
| 😲 | Surprise, awe / exclamation |
| 🥱 | Yawn |
| 😖 | Painfully, agonizingly |
| 😟 | Anxiously, worriedly |
| 🫣 | Shyly, bashfully |
| 🙄 | Exasperatedly, rolling eyes |
| 😊 | Cheerfully, gladly |
| 😎 | Confidently, proudly |
| 👌 | Backchanneling, sound of agreement |
| 🙏 | Pleadingly, begging |
| 🥴 | Drunkenly |
| 🎵 | Humming |
| 🤐 | Muffled (mouth covered) |
| 😌 | Relieved, contentedly |
| 🤔 | Questioning voice, wondering |
| 💪 | With effort, strongly |
| 👃 | Sniffing / smelling sound |
| 📖 | Narration, monologue |

Repeating the same emoji can strengthen its effect. Emoji control is not perfectly consistent, so treat these as style cues rather than guaranteed output. See the [official IrodoriTTS emoji annotations](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small/blob/main/EMOJI_ANNOTATIONS.md) for the upstream list and future updates.

## Long voice messages

Irodori v4.1 predicts output length with its duration predictor rather than generating a fixed-length clip, so the server does not impose a per-utterance duration cap of its own. TomoriBot still chunks long text before synthesis and concatenates the generated audio into one WAV response, so Discord receives one voice message; the chunking keeps each inference pass short, which is what bounds latency.

The implementation starts from the chunking approach used by the [official Irodori OpenAI-compatible server](https://github.com/Aratako/Irodori-TTS-Server/blob/main/src/irodori_openai_tts/app.py), whose defaults enable chunking at 80 non-whitespace characters. TomoriBot adds stricter boundary handling so closing quotes and brackets stay with the punctuation they close, punctuation runs such as `！？` and `...` stay together, decimal points next to digits do not split, and very short final tails are merged back into the previous chunk.

Chunking prefers strong sentence endings such as `。`, `！`, `？`, `.`, `!`, `?`, ellipses, and line breaks once the configured minimum length is reached. Commas are only used as fallback boundaries after the chunk grows to about 1.5 times that threshold. With the default `IRODORI_CHUNK_MIN_CHARS=80`, strong boundaries become eligible at 80 non-whitespace characters and commas at about 120. If a long passage contains no eligible punctuation, it can still remain a single synthesis request.

For caption-only VoiceDesign, the first chunk's generated Irodori seed is reused for the remaining chunks to reduce random variation between seams. Reusing a seed does not guarantee identical timbre across independently synthesized chunks. Reference-audio mode continues to apply the same reference clip to each chunk.

Long inputs require multiple sequential inference passes and can take substantially longer on slower hardware. TomoriBot's default TTS client timeout is 240 seconds. You can disable chunking with `IRODORI_CHUNKING_ENABLED=false` or tune the approximate split threshold with `IRODORI_CHUNK_MIN_CHARS`.

## Faster inference with sway sampling

The default remains Irodori's higher-quality 40-step linear sampling. For lower latency, try Sway Sampling with fewer steps:

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

This is an inference quality and speed tradeoff, so test it with your chosen checkpoint and voices before making it permanent.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Hugging Face model repo or supported repo/subfolder source |
| `IRODORI_TTS_CHECKPOINT` | unset | Optional local `.pt` or `.safetensors` checkpoint; overrides the Hugging Face model |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Server bind address; see [Network access](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `IRODORI_TTS_PORT` | `8013` | Server port |
| `IRODORI_MODEL_DEVICE` | `auto` | Model device (`auto`, `cuda`, `cpu`, `mps`, `xpu`) |
| `IRODORI_CODEC_DEVICE` | `auto` | Codec device |
| `IRODORI_MODEL_PRECISION` | `bf16` on CUDA, otherwise `fp32` | Model precision |
| `IRODORI_CODEC_PRECISION` | `fp32` | Codec precision |
| `IRODORI_COMPILE_MODEL` | `false` | Enable `torch.compile` for the Irodori model |
| `IRODORI_COMPILE_DYNAMIC` | `false` | Enable dynamic shapes when compiling |
| `IRODORI_NUM_STEPS` | `40` | Euler sampling steps |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | Sampling schedule (`linear` or `sway`) |
| `IRODORI_SWAY_COEFF` | `-1.0` | Sway coefficient when using the `sway` schedule |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | Text guidance scale |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | Caption / VoiceDesign guidance scale |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | Reference-speaker guidance scale |
| `IRODORI_MAX_REF_SECONDS` | checkpoint default | Optional cap on reference audio duration |
| `IRODORI_CHUNKING_ENABLED` | `true` | Split long text at eligible punctuation boundaries and concatenate the generated chunks |
| `IRODORI_CHUNK_MIN_CHARS` | `80` | Minimum non-whitespace characters before strong sentence boundaries split; commas are fallback boundaries at about 1.5x this value |
