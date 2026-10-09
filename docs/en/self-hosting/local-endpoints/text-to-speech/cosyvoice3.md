---
title: "CosyVoice 3"
aiGenerated: true
---

Synthesize natural, multilingual character voices with instruction-based emotional delivery using Alibaba's [CosyVoice 3](https://github.com/QwenAudio/CosyVoice).

CosyVoice 3 provides zero-shot and cross-lingual voice cloning across 9 languages and over 18 Chinese dialects. TomoriBot wraps the official runtime in `servers/tts/cosyvoice3/` to expose the standard `POST /synthesize` speech interface. The bundled installer defaults to the official unquantized `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` model, running within 16 GB of VRAM.

## What it supports

The current CosyVoice 3 release supports:

- Chinese, English, Japanese, Korean, German, Spanish, French, Italian, and Russian
- 18+ Chinese dialects and accents
- zero-shot voice cloning
- multilingual and cross-lingual voice cloning
- natural-language instructions for language, dialect, emotion, speaking speed, and volume
- fine-grained controls in the upstream runtime, including `[breath]` and `[laughter]`
- text-in and audio-out streaming in the upstream runtime

The official CosyVoice 3 examples include one Japanese caveat: Japanese text is shown after conversion to katakana. Japanese is a supported language, but if normal Japanese orthography produces poor pronunciation, converting synthesis text to katakana is the upstream-recommended workaround.

## How TomoriBot maps requests

The wrapper accepts the standard `tts-clone` fields:

- `text`
- `ref_audio`
- `ref_text`
- `instruct`
- `language`

It routes requests to CosyVoice 3 inference functions as follows:

| Request | CosyVoice 3 path |
|---|---|
| Reference audio + transcript | `inference_zero_shot` |
| Reference audio without transcript | `inference_cross_lingual` |
| `instruct` or explicit `language` | `inference_instruct2` |

For the best cloning quality, provide both the reference audio and its matching transcript. CosyVoice 3's current instruction API conditions on reference audio without accepting reference transcripts, so requests containing `instruct` switch to the official `inference_instruct2` path.

### Style and emotion controls

Register the endpoint with `Plain` markup. Delivery direction belongs in the endpoint's global `voice_instructions` field. Arbitrary inline bracket tags are avoided because they risk contradictory instructions, such as `[happy] Hello. [sad] Goodbye.`. Native `[breath]` and `[laughter]` tags are deferred until TomoriBot supports engine-specific tag discovery.

The `/synthesize` `instruct` field is passed into CosyVoice 3's instruction conditioning. Examples include `sound relieved but still tired`, `speak as quickly as possible`, or `speak quietly with restrained excitement`.

## Streaming

CosyVoice 3 supports bidirectional streaming upstream. Upstream benchmarks report text-in and audio-out streaming with initial audio latency around 150 ms in optimized setups.

TomoriBot's voice interface expects a single complete audio response for Discord voice messages, so the wrapper returns a complete WAV file and defaults upstream inference to `stream=False`. Set `COSYVOICE3_UPSTREAM_STREAM=1` only when benchmarking upstream streaming behavior directly; it does not change TomoriBot latency.

## Hardware

Recommended hardware:

- NVIDIA GPU with 16 GB VRAM
- Python 3.10
- NVIDIA driver compatible with CUDA 12
- `git`
- `ffmpeg` for voice-sample normalization
- `sox` and `libsox-dev` on Linux if audio compatibility issues occur

The 0.5B parameter model fits easily in 16 GB VRAM without quantization. The checkpoint download includes flow models, speech tokenizers, text models, and reinforcement learning weights, requiring roughly 10 GB of disk space plus Python dependencies.

While CPU inference is technically supported upstream, it is too slow for Discord voice interactions.

## Installation

### Linux and WSL2 (recommended)

From the TomoriBot repository root:

```bash
bash servers/tts/cosyvoice3/install-cosyvoice3.sh
servers/tts/cosyvoice3/.venv/bin/python servers/tts/cosyvoice3/server.py
```

Or start the configured server and TomoriBot together:

```bash
bun run launch --cosyvoice3
```

The installer:

1. checks out `QwenAudio/CosyVoice` commit `074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc` recursively into `servers/tts/cosyvoice3/CosyVoice/`;
2. creates `servers/tts/cosyvoice3/.venv`;
3. installs upstream CosyVoice requirements and wrapper dependencies; and
4. downloads `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` at Hugging Face revision `29e01c4e8d000f4bcd70751be16fa94bf3d85a18` into `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B/`.

Rerunning the script maintains these pinned revisions. The installer refuses to overwrite checkouts with uncommitted local changes.

Upstream requirements install PyTorch 2.3.1 with CUDA 12.1 packages, CUDA 12 ONNX Runtime packages on Linux, and TensorRT 10.13 packages on Linux. If your GPU requires a newer PyTorch build, install a compatible PyTorch build inside the virtual environment after setup completes.

### Windows PowerShell

Native Windows is provided as a best-effort path:

```powershell
.\servers\tts\cosyvoice3\install-cosyvoice3.ps1
.\servers\tts\cosyvoice3\.venv\Scripts\python.exe servers\tts\cosyvoice3\server.py
```

WSL2 is strongly recommended for NVIDIA GPU usage on Windows. Upstream requirements install CPU-only ONNX Runtime on Windows, whereas Linux and WSL2 install GPU-accelerated packages.

## Register in TomoriBot

Run `/providers`, choose `Add New Custom Endpoint`, and configure the speech endpoint:

- Capability: `Speech`
- API Compatibility: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8017`
- Voice Source Mode: `Clone`
- Script Markup: `Plain`
- Supports Instruct: `Yes`

After saving the connection, select it and add a Speech model. A clear model code is `Fun-CosyVoice3-0.5B-2512`.

Then open `/config` > Models > Switch Models and activate the CosyVoice 3 speech endpoint.

## Assign a persona voice

For zero-shot voice cloning:

1. Prepare a clean 3 to 30 second audio clip with one speaker and minimal background noise.
2. Open `/config` under Models > TTS Parameters & Voices and upload the sample.
3. Enter the matching transcript when available. CosyVoice 3 tokenizes this transcript as a prompt prefix for zero-shot cloning; it should describe the first 30 seconds of the audio.
4. Open `/config` under Persona > Voice and assign the sample to the persona.

CosyVoice enforces a 30-second prompt window. While the upstream engine raises an error when audio exceeds 30 seconds, TomoriBot's wrapper trims clips to their first 30 seconds automatically and logs the trim to the console.

Speaker embeddings and prompt speech tokens are computed from the opening 30 seconds, so clips longer than 30 seconds do not add voice detail. Using a clean clip between 10 and 20 seconds ensures accurate prompt alignment.

Cross-lingual cloning is supported: the reference speaker can speak a different language than the generated text. If no reference transcript is provided, the wrapper routes requests to CosyVoice 3's dedicated cross-lingual engine path.

## Test with `/generate voice-message`

Use `/generate voice-message` to test synthesis without waiting for an automated chat trigger. You can test with the persona's assigned sample or upload a one-off clip with its transcript.

To guide emotion and delivery, enter direction in the modal or let the persona prompt supply `voice_instructions`. Keep the spoken text as plain dialogue; inline style tags are removed before synthesis.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `COSYVOICE3_MODEL_DIR` | `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B` | Local checkpoint directory |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Wrapper bind address; see [Network access](/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `COSYVOICE3_PORT` | `8017` | Wrapper port |
| `COSYVOICE3_UPSTREAM_STREAM` | `0` | Enable CosyVoice's internal streaming generator |
| `COSYVOICE3_SPEED` | `1.0` | Global numeric speed multiplier passed to upstream inference |
| `COSYVOICE3_DEFAULT_INSTRUCT` | empty | Optional instruction added when a request does not provide one |
| `COSYVOICE3_FP16` | `0` | Ask the official runtime to use its fp16 mode |
| `COSYVOICE3_LOAD_TRT` | `0` | Enable upstream TensorRT loading when properly prepared |
| `COSYVOICE3_LOAD_VLLM` | `0` | Enable upstream vLLM loading when its separate dependencies are installed |

By default, TensorRT, vLLM, and fp16 remain disabled. The standard PyTorch runtime runs comfortably on 16 GB GPUs without additional runtime dependencies.

## Performance and model variants

### Default: base `Fun-CosyVoice3-0.5B-2512`

This is the recommended default for TomoriBot. It provides high speaker similarity, supports all CosyVoice 3 cloning and instruction modes, and requires no quantization on 16 GB GPUs.

### Reinforcement learning weights

The checkpoint package includes `llm.rl.pt` alongside base weights. The RL weights reduce content error rates, while the base weights score slightly higher in speaker similarity benchmarks. Because persona voice fidelity is prioritized, the wrapper defaults to `llm.pt`.

The upstream loader expects `llm.pt`. To test the RL weights without modifying the default files, duplicate the model directory, rename `llm.rl.pt` to `llm.pt` inside the copy, and set `COSYVOICE3_MODEL_DIR` to the copied folder.

### vLLM and TensorRT

CosyVoice 3 supports optional vLLM and TensorRT runtimes. Upstream documents vLLM 0.11.x+ with the V1 engine and vLLM 0.9.0 as legacy. Because these libraries introduce strict CUDA and dependency version requirements, TomoriBot does not install them by default.

## License

The CosyVoice codebase and `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` weights are published under the Apache-2.0 license.

The upstream model card notes that demonstration materials are for academic evaluation. TomoriBot does not distribute model weights. Review upstream licensing and terms for your specific use case before deploying commercially.
