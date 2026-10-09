---
title: "Fish Audio S2 Pro"
aiGenerated: true
---

Synthesize highly expressive, multilingual character speech with fine-grained emotion tags using [Fish Audio S2 Pro](https://github.com/fishaudio/fish-speech).

Fish Audio S2 Pro is a multilingual 4B parameter text-to-speech model built for high-fidelity voice cloning. TomoriBot connects to the model through the local wrapper in `servers/tts/fishs2/`. It defaults to official BF16 weights (`fishaudio/s2-pro`), with an optional INT8 quantized checkpoint (`Imagilux/fishaudio-s2-pro`) for GPUs with 8 to 12 GB of VRAM.

Fish S2 Pro supports bracket expression tags such as `[whisper]`, `[excited]`, and `[angry]`. Configure the endpoint with `Bracket Tags` markup so TomoriBot preserves these controls in generated voice scripts.

## License

Fish Speech code and S2 Pro model weights are distributed under the Fish Audio Research License. Research and non-commercial use are permitted under its terms; commercial use requires a separate Fish Audio license.

TomoriBot does not redistribute the model weights. Each self-hosting user downloads Fish S2 Pro directly from Hugging Face and is responsible for complying with the Fish Audio Research License. The required attribution is: Built with Fish Audio.

## Hardware and operating systems

> [!IMPORTANT]
> Fish Audio officially targets Linux and WSL2. Fish S2 Pro uses a Dual-Autoregressive (Dual-AR) architecture (36 slow transformer layers + 10 fast codebook passes = 76 layer evaluations per token). On Linux, OpenAI Triton compiles this loop into fused GPU kernels (`torch.compile(backend="inductor")`), enabling real-time synthesis. The wrapper leaves compilation off by default; set `FISH_S2_COMPILE=1` to enable it.
>
> On native Windows, Triton is unsupported, forcing PyTorch into uncompiled eager mode with over 120,000 sequential CUDA kernel dispatches through the Windows WDDM driver. This causes a severe dispatch stall, slowing generation down to ~8-10 minutes (~65s compute per second of audio) for the exact same clip. For usable inference, run Fish S2 Pro inside Linux or WSL2.

Recommended hardware:

- **Linux or WSL2 (Strongly Recommended)**
- NVIDIA GPU with 16 GB to 24 GB VRAM (BF16 fits comfortably in ~16-18 GB VRAM with KV caching and offload)
- Python 3.12 recommended
- `git`, `ffmpeg`, and standard audio libraries required by Fish Speech

## Setup

### Linux and WSL2 (recommended)

From the TomoriBot repository root:

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

The installer:

1. clones `Imagilux/fish-speech` into `servers/tts/fishs2/fish-speech/` and checks out the pinned runtime commit;
2. creates the isolated `.venv`;
3. installs Fish Speech plus the TomoriBot wrapper dependencies; and
4. downloads the official BF16 `fishaudio/s2-pro` checkpoint into `fish-speech/checkpoints/fish-speech-s2-pro/`.

A normal reinstall stays on the pinned runtime commit `2225e924e7d35cc0a1d24dbc67cd1819e6cf429f` rather than following a moving branch; moving to a newer runtime means changing that pin in the installer. The model revision defaults to `main`; pin `FISH_S2_MODEL_REVISION` to an immutable Hugging Face revision when a deployment must be reproducible. The installer settings are listed under [Installer variables](#installer-variables).

The Hugging Face model is gated. Accept its license on Hugging Face first. If the download asks for authentication, run:

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

Then rerun the installer.

### Windows PowerShell (best-effort only)

Native Windows is provided for evaluation only. Due to driver dispatch latency on uncompiled eager mode, generation will be extremely slow (~8-10 minutes per clip):

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

The PowerShell installer targets CUDA GPU acceleration (`cu124`) by default. To install on a CPU-only machine without an NVIDIA GPU, pass `-Cpu`:

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

If PyTorch on Windows ever needs to be manually installed or updated with CUDA support, run:

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

TomoriBot stops waiting for a voice message after `TTS_SYNTHESIZE_TIMEOUT_MS` (default 240000 ms), which is shorter than a native Windows clip takes. Raise it in TomoriBot's `.env` (for example `TTS_SYNTHESIZE_TIMEOUT_MS=900000`) while evaluating on Windows.

## Mandatory reference transcript

> [!WARNING]
> Reference text (`ref_text`) is required for voice cloning; Fish S2 Pro's cross-attention mechanism requires the transcript of the reference audio to align phonetic tokens with acoustic codes.
>
> If you upload a voice sample without providing its matching reference transcript, Fish Speech silently drops the reference audio tokens and falls back to random zero-reference speech. The TomoriBot Fish wrapper validates and rejects synthesis requests that lack reference text with a `400 Bad Request` to prevent accidental unconditioned generation.

When adding a persona voice in `/config` under `Models > TTS Parameters & Voices`, always fill in the `Reference transcript` field with the verbatim text spoken in your reference audio clip.

## Register in TomoriBot

In `/providers`, choose `Add New Custom Endpoint` and configure:

- Capability: `Speech`
- API Compatibility: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8015`
- Voice Source Mode: `Clone`
- Script Markup: `Bracket Tags`
- API key: leave empty. The wrapper has no authentication; see [Network access](/self-hosting/local-endpoints/text-to-speech/#network-access).

Then add the endpoint's model entry and activate it through `/config` under Models > Switch Models.

## Add persona voices

1. Prepare a clean 10-20 second reference clip with one speaker and little or no background noise.
2. In `/config`, open Models > TTS Parameters & Voices and upload the voice sample.
3. **Enter the exact transcript** spoken in the reference clip into the reference text field.
4. In `/config`, open Persona > Voice and assign the sample to the persona.
5. Generate a voice message with `/generate voice-message` or let TomoriBot generate one through its voice-message tool.

Upstream describes accurate cloning from reference samples of typically 10-30 seconds. Fish S2 Pro's own runtime applies no reference-duration cap, so a longer clip is accepted rather than trimmed, but the documented clone quality comes from the 10-30 second range.

## Expression controls

Fish S2 Pro can vary delivery within one utterance using bracket tags. For example:

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

Because the endpoint uses `Bracket Tags` markup, TomoriBot preserves these tags instead of stripping them before synthesis.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | S2 Pro checkpoint directory |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Model repository and health metadata label for the configured checkpoint |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Wrapper bind address; see [Network access](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `FISH_S2_PORT` | `8015` | Fish wrapper port |
| `FISH_S2_UPSTREAM_PORT` | `8025` | Internal Fish API port |
| `FISH_S2_COMPILE` | `0` | Enable Fish Speech `torch.compile` (requires Linux/WSL2 with Triton) |
| `FISH_S2_HALF` | `0` | Request FP16 runtime mode |
| `FISH_S2_CHUNK_LENGTH` | `200` | Fish iterative prompt chunk length |
| `FISH_S2_TOP_P` | `0.8` | Sampling top-p |
| `FISH_S2_TEMPERATURE` | `0.8` | Sampling temperature |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | Repetition penalty |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | Maximum semantic tokens generated per request |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | Cache encoded reference voices in the Fish runtime |

### Installer variables

Read by `install-fishs2.sh` and `install-fishs2.ps1`. Record any value you override so the deployment can be reproduced.

| Variable | Default | Purpose |
|---|---|---|
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Hugging Face repository to download |
| `FISH_S2_MODEL_REVISION` | `main` | Hugging Face revision to download |

Reference audio must be a non-empty, uncompressed PCM RIFF/WAVE file of at most 10 MB decoded. The limit is checked before inference so an oversized base64 request cannot consume unbounded memory, and it holds about 237 seconds of the 22.05 kHz mono WAV that TomoriBot sends.

## Low-VRAM option (INT8 quantization)

Users running on GPUs with constrained VRAM (for example 8-12 GB) who cannot fit the official BF16 checkpoint can opt into the INT8 quantized model (`Imagilux/fishaudio-s2-pro`).

To install and run the INT8 checkpoint:

```bash
# In Linux / WSL2:
export FISH_S2_MODEL_ID="Imagilux/fishaudio-s2-pro"
export FISH_S2_MODEL_DIR="servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
export FISH_S2_MODEL_REVISION="9706ff036580881d87cc09465dd10014527bc481"
bash servers/tts/fishs2/install-fishs2.sh
```

```powershell
# In Windows PowerShell:
$env:FISH_S2_MODEL_ID = "Imagilux/fishaudio-s2-pro"
$env:FISH_S2_MODEL_DIR = "servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
$env:FISH_S2_MODEL_REVISION = "9706ff036580881d87cc09465dd10014527bc481"
.\servers\tts\fishs2\install-fishs2.ps1
```

Start `server.py` from the same shell, or set the same three variables before launching it, so the wrapper loads the INT8 directory instead of the BF16 default.

The INT8 checkpoint reduces transformer weights from ~10.3 GB to ~5.1 GB while keeping audio embeddings and codec layers in BF16, fitting inside ~10 GB total VRAM.
