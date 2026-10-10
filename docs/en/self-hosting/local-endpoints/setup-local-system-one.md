---
title: "Setup: Local Decision Model"
sidebar:
  order: 7
---

Run a small Decision model on your own machine and register it in TomoriBot. A Decision model answers yes/no questions about a text with a probability. [Kev](https://github.com/jaredpalmer/kev) is an open one that speaks the System One protocol, the same one TypeSafe's hosted Jev uses.

:::note[Registration only for now]
In this release you can register a Decision model and select it under [Response Drafting](/features/chatting-personality/behavior-tweaking/#response-drafting), but TomoriBot sends it no requests and review skipping stays off. See [Decision Models](/features/setup-administration/providers-and-models/#decision-models) for the details. Registering now confirms that your server works with TomoriBot.
:::

## 1. Run Kev

Kev needs [Git](https://git-scm.com), [uv](https://docs.astral.sh/uv/), and Python 3.12 or 3.13 (uv installs it for you). Pick a size that fits your GPU:

| Model | Hub ID | Weights (approx.) | Notes |
|---|---|---|---|
| Kev-0.8B | `jaredpalmer/kev-0.8b` | 2 GB | Runs on a 4 GB GPU. Least accurate. |
| Kev-4B | `jaredpalmer/kev-4b` | 8-9 GB | Kev's recommended starting point if it fits in your GPU memory. |

Kev's README names CUDA, ROCm, and Apple Silicon. The Windows steps below were checked on native Windows with an NVIDIA GPU. If the server will not start on your setup, run the same steps in WSL2.

Clone it somewhere outside the TomoriBot folder:

```powershell
git clone https://github.com/jaredpalmer/kev.git
cd kev
uv sync --extra serve
```

On Windows with an NVIDIA GPU, `uv sync` installs a CPU-only PyTorch, which is far too slow. Replace it with the CUDA build and check that it sees your GPU:

```powershell
uv pip install --reinstall-package torch "torch>=2.6,<2.9" --index-url https://download.pytorch.org/whl/cu128
uv run --no-sync python -c "import torch; print(torch.cuda.is_available())"
```

It must print `True`. From now on start Kev with `uv run --no-sync`, because a plain `uv run` would sync the CPU build back in. On Linux and macOS, use `uv run --extra serve` instead.

Start the server. The first run downloads the model, so it takes a few minutes:

```powershell
uv run --no-sync python -m kev.serve --run jaredpalmer/kev-4b --port 8009 --device cuda
```

`--device cuda` makes Kev fail loudly if it cannot use your GPU instead of silently running on the CPU. Use `jaredpalmer/kev-0.8b` if Kev-4B runs out of memory. On a Mac, drop `--device cuda`.

Leave it running and check it from another PowerShell window. The first command lists the model name, and the second returns a probability between 0 and 1 for the yes/no question:

```powershell
Invoke-RestMethod http://127.0.0.1:8009/v1/models
$body = '{"state":"The fictional door is blue.","model":"kev-latest","questions":{"q":{"type":"noul","instructions":"Is the door blue?"}}}'
Invoke-RestMethod http://127.0.0.1:8009/v1/systemone -Method Post -ContentType "application/json" -Body $body
```

Kev prints a warning that `flash-linear-attention` is missing. It then uses a slower path that gives the same answers, so you can ignore it.

## 2. Register it in Discord

Run `/providers` (server-wide) or `/personal providers` (just you), choose `Add New Custom Endpoint`, and enter:

| Field | Value |
|---|---|
| `Endpoint Label` | `kev` |
| `Endpoint URL` | `http://127.0.0.1:8009/v1` |
| `API Compatibility` | `System One compatible` |
| `Auth Token` | Leave blank, unless you set `KEV_API_KEY` |

TomoriBot checks `GET /v1/models` when you save. A server that answers `404` or `405` there is still accepted.

Open the saved `kev` endpoint, choose `+ Add a Decisions Model` from its model dropdown, and enter:

- `Code Name`: `kev-latest`, the model name Kev's examples use.
- `Context Window`: `8192`, the longest text Kev-0.8B and Kev-4B are validated for. Kev refuses anything over 65,536 tokens.

## 3. Select it

Open `/config` > `Plugins` > `Response Drafting` > `Decisions` dropdown and pick `kev-latest`. Reopen the page to confirm it stays selected. `None` clears it without deleting the registration.

## Notes and gotchas

- **Stop the server** with `Ctrl+C`. TomoriBot does not start or stop Kev for you.
- **TomoriBot in Docker?** `127.0.0.1` inside the container is not your host. Use `http://host.docker.internal:8009/v1` and start Kev with `--host 0.0.0.0`. Kev has no login by default, so set `KEV_API_KEY` first and put the same value in `Auth Token`.
- **Production runtimes** enforce HTTPS and block private addresses for provider endpoints. A local HTTP URL works when `RUN_ENV=development`. See [Local LLM](/self-hosting/local-endpoints/setup-local-llm/#notes--gotchas).
- **Other System One servers** such as Laya use the same steps with their own URL and model name. A server that implements the OpenAI Decisions API uses `OpenAI Decisions compatible` instead.
