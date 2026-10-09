---
title: "MOSS-TTS"
---

Evaluate voice cloning and natural-language voice design locally through a unified speech endpoint using [MOSS-TTS](https://github.com/OpenMOSS/MOSS-TTS).

Using `servers/tts/moss/server.py`, TomoriBot routes synthesis requests dynamically: it loads the clone model when a persona provides `ref_audio`, and switches to MOSS-VoiceGenerator when given natural-language `instruct` guidance. Only one model is held in GPU memory at a time to run within 16 GB VRAM budgets.

The default clone model is [MOSS-TTS-Local-Transformer-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5) (4B), selected as a practical baseline for 16 GB GPUs. [MOSS-TTS-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-v1.5) is an 8B flagship alternative that requires more VRAM at BF16. Voice design uses [MOSS-VoiceGenerator](https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator) (roughly 1.7B). Swapping between cloning and voice design incurs a model loading delay.

## Setup

Run commands from the TomoriBot repository root using Python 3.12 and a driver compatible with CUDA 12.8:

### Windows PowerShell

```powershell
python -m venv servers\tts\moss\.venv
servers\tts\moss\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers\tts\moss\requirements.txt
python servers\tts\moss\prefetch_models.py
python servers\tts\moss\server.py
```

### Linux or WSL Bash

```bash
python3.12 -m venv servers/tts/moss/.venv
source servers/tts/moss/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers/tts/moss/requirements.txt
python servers/tts/moss/prefetch_models.py
python servers/tts/moss/server.py
```

The prefetch command downloads the clone model, VoiceGenerator, and audio tokenizers into your Hugging Face cache before starting the server. If disk space is limited, set `HF_HOME` to a larger partition. To download only one model, pass `--mode clone` or `--mode voice-design`.

The default endpoint is `http://127.0.0.1:8018`. Run `bun run launch --moss` to launch the server alongside TomoriBot. Auto mode prewarms the clone model from local cache. Set `MOSS_TTS_WARM_MODE=voice-design` to prewarm VoiceGenerator instead, or `MOSS_TTS_WARM_MODE=none` for lazy initialization. Check `GET /health` for active `warm_mode`, `active_mode`, and `model_id`. The wrapper uses Hugging Face `trust_remote_code=True`, so review upstream code before updates.

## Register in TomoriBot

In `/providers`, choose `Add New Custom Endpoint`, set API Compatibility to `tts-clone`, and use endpoint URL `http://127.0.0.1:8018`. Add a Speech model with `Voice Source Mode` set to `Auto` and `Script Markup` set to `Plain`. Activate it under `/config` > Models > Switch Models.

For voice cloning, upload a clean reference clip under `/config` > Models > TTS Parameters & Voices and assign it under Persona > Voice. Shorter, clean audio clips yield the most consistent results. For voice design, save a natural-language description under Persona > Voice. Note that MOSS-VoiceGenerator is designed for English and Chinese. While the 4B clone model supports Japanese, explicit language tags improve synthesis clarity.

TomoriBot's clone adapter does not send language tags automatically. For single-language use, set `MOSS_TTS_DEFAULT_LANGUAGE=Japanese` (or `English`, `Chinese`, etc.) before starting the server. Manual `/synthesize` calls can pass `language` directly.

The server reads its own shell environment; settings in the bot's `.env` do not apply to an independently started Python terminal.

To run the 8B model on high-memory hardware, set `MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5` before prefetching. `MOSS_TTS_PORT`, `MOSS_TTS_DEVICE`, `MOSS_TTS_DTYPE`, and `MOSS_TTS_MAX_NEW_TOKENS` are configurable in `.env.optional.example`. Increase `TTS_SYNTHESIZE_TIMEOUT_MS` in TomoriBot if model swaps or CPU execution cause timeouts.
