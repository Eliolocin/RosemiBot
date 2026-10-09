---
title: "Chatterbox TTS"
aiGenerated: true
---

Clone English voices with emotion tags using the local [Chatterbox](https://github.com/resemble-ai/chatterbox) text-to-speech server.

Chatterbox runs locally via `servers/tts/chatterbox/server.py`. It defaults to the fast Chatterbox-Turbo model (350M parameters) with inline emotion event tags like `[laugh]` and `[sigh]`. You can also configure the lightweight Chatterbox-Nano model (110M parameters) for CPU setups or the standard 0.5B model for classifier-free guidance (`cfg_weight`) and emotional `exaggeration` tuning. This wrapper does not load Chatterbox Multilingual V3.

## Setup

Run these commands from the TomoriBot repo root, the folder where you cloned TomoriBot:

### Windows PowerShell

```powershell
python -m venv servers\tts\chatterbox\.venv
servers\tts\chatterbox\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install numpy
pip install -r servers\tts\chatterbox\requirements.txt
python servers\tts\chatterbox\server.py
```

### Linux/macOS Bash

```bash
python3 -m venv servers/tts/chatterbox/.venv
source servers/tts/chatterbox/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install numpy
python -m pip install -r servers/tts/chatterbox/requirements.txt
python servers/tts/chatterbox/server.py
```

Keep that terminal open while TomoriBot is using Chatterbox. The default endpoint URL is `http://127.0.0.1:8011`; set `CHATTERBOX_PORT` to use another port.

### Optional: use Chatterbox-Nano

Nano requires a Chatterbox build with the `nano=True` loader option. After the normal setup above, install the pinned upstream revision in the same virtual environment. The commit hash fixes the compatible source version; it is not a security guarantee. This command requires `git` and keeps the already installed runtime dependencies:

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

Then set `CHATTERBOX_FAST_MODEL=nano` before starting the wrapper. Leave the variable unset for Turbo. On Windows PowerShell, set it with `$env:CHATTERBOX_FAST_MODEL = "nano"`; on Linux or macOS, use `CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`. The `/health` response reports `fast_model` so you can verify the loaded choice. Nano and Turbo use the same cloning request and supported event tags. Both are English-only.

The `/config` fast-model toggle must stay enabled to use Nano or Turbo. Disabling it selects the standard Chatterbox 0.5B model for CFG weight and exaggeration tuning.

### Standard Chatterbox (0.5B with CFG and exaggeration)

The original 0.5B base Chatterbox model (`ChatterboxTTS`) is built directly into the server wrapper. It trades Turbo's inline bracket event tags for fine-grained vocal control using Classifier-Free Guidance (`cfg_weight`) and emotional `exaggeration`.

To use the Standard model:
1. Start the server wrapper as normal.
2. In Discord, run `/config` > `Models` > `TTS Parameters & Voices`.
3. Toggle off the `Fast Model (Turbo)` option.
4. On the next generation, the wrapper lazily downloads and loads the standard 0.5B model into memory.

Both values are text fields in the `Edit Parameters` modal. They are always editable, and the page notes that they are ignored while the fast model is enabled:
- **`cfg_weight`** (default `0.5`): Adjusts how closely the synthesized audio adheres to the reference tempo and vocal style.
- **`exaggeration`** (default `0.5`): Controls the emotional intensity and dramatic inflection of the delivery.

> [!NOTE]
> Standard Chatterbox does not support inline bracket event tags (such as `[laughs]` or `[sigh]`). TomoriBot automatically strips bracket tags from prompt text when the Fast Model toggle is turned off.

## Register in TomoriBot

Include `Chatterbox` in the endpoint label or model name. TomoriBot recognizes a Chatterbox endpoint only by that name (or an endpoint URL containing it), so the Turbo tag whitelist, the standard-model tag stripping, and the Chatterbox options in `/generate voice-message` apply only when it is present.

Run `/providers`, choose `Add New Custom Endpoint`, and use the speech API compatibility:

- API Compatibility: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8011`

After saving the connection, select it and choose `+ Add new Speech Model` from the model dropdown. Choose `Voice Clone` as the `Voice Source Mode` and `Bracket Tags` as the `Script Markup Style` so delivery tags survive the send.

Use `/providers` for endpoint registration and model setup. Then open `/config` > Models > Switch Models to select and activate the registered endpoint.

## Set up a persona voice

1. Prepare a clean 10-second voice clip with one speaker and no background music.
2. Open `/config` under Models > TTS Parameters & Voices and upload the clip.
3. Open `/config` under Persona > Voice, then choose the persona and the voice sample.

A longer clip adds nothing for Chatterbox, and it is not refused either. Its runtime truncates the reference before conditioning, so audio past the window is uploaded, stored, and then ignored ([`tts_turbo.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts_turbo.py), [`tts.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts.py)):

- The acoustic prompt is the first 10 seconds on every variant.
- The speech-token context is the first 15 seconds on Turbo and Nano, and 6 seconds on Standard.

Those windows are constants in the upstream runtime rather than published guidance: the repository README gives no reference-clip length, and its example filename is only `your_10s_ref_clip.wav`. The one length the runtime actually enforces is a minimum, asserting that the prompt is longer than 5 seconds.

Ten seconds is therefore the practical target. It fills the acoustic prompt, which is where timbre and delivery are set, and a clip between 10 and 15 seconds adds speech-token context on Turbo and Nano only. The speaker embedding is still computed from the whole clip, so going longer does not change the speaker identity, only how much of the prompt is discarded unread.

Turbo and Nano can use bracket event tags such as `[laugh]` and `[sigh]` when the fast-model toggle is enabled.

## Optional tuning

Use `/config` under Models > TTS Parameters & Voices to tune the Chatterbox request payload:

- The fast-model toggle defaults to enabled. TomoriBot keeps supported Turbo/Nano event tags and strips unsupported bracket descriptors before the wrapper calls `ChatterboxTurboTTS.generate(...)`.
- `cfg_weight` defaults to `0.5`. Minimum is `0`; TomoriBot does not set a hard maximum. It only applies when `turbo` is `false`; lower values can help slow fast reference voices, while higher values follow the reference more strongly.
- `exaggeration` defaults to `0.5`. Minimum is `0`; TomoriBot does not set a hard maximum. It only applies when `turbo` is `false`; higher values make delivery more expressive or dramatic and may speed speech up.

Supported Turbo/Nano event tags are `[clear throat]`, `[sigh]`, `[shush]`, `[cough]`, `[groan]`, `[sniff]`, `[gasp]`, `[chuckle]`, and `[laugh]`. Unsupported descriptors such as `[excited]`, `[whisper]`, or `[smiles]` are stripped instead of being sent to TTS.

When `turbo` is disabled, TomoriBot strips all bracket descriptors before sending text to TTS, then the wrapper lazily loads the standard `ChatterboxTTS` model and calls `model.generate(..., cfg_weight, exaggeration)`.
