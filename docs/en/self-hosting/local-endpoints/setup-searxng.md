---
title: "Setup: SearXNG"
sidebar:
  order: 3
---

Add private, self-hosted web search to TomoriBot using [SearXNG](https://docs.searxng.org/).

The `web_search` tool queries an engine fallback chain: Brave, SearXNG, and DuckDuckGo. Running a local SearXNG instance provides a self-hosted search source when an external provider hits rate limits or fails, and enables specialized search categories: `science`, `it`, `files`, and `music`.

Choose a setup path:

### Option A: Docker Compose (when TomoriBot runs in Docker)

Use this path if you run TomoriBot with the repo's Docker Compose stack. Then run with the `searxng` profile:

```sh
docker compose --profile searxng up -d
```

Set `SEARXNG_BASE_URL=http://searxng:8080/` in `.env` before starting this profile. The bot uses that address to reach the `searxng` service. Leave the variable unset when the profile is off.

If you run TomoriBot directly with `bun run dev`, use the standalone path below instead.

Set `SEARXNG_SECRET` in `.env` to a separate random value for the container's signing key.

---

### Option B: Standalone Docker (when running `bun run dev`)

First, set `SEARXNG_BASE_URL=http://localhost:8080/` in `.env` so the bot knows where to connect.

Then, instead of running TomoriBot directly with `bun run dev`, use `bun run launch --searxng`. This handles the container lifecycle automatically and waits for the container to be healthy before starting the bot:

```sh
bun run launch --searxng
```

If you prefer to manage the container yourself, keep `SEARXNG_BASE_URL=http://localhost:8080/` in `.env`.
Build the repository's image first so it loads the JSON search settings and substitutes the signing key:

```sh
docker build -t tomoribot-searxng:latest -f servers/searxng/Dockerfile servers/searxng
```

Then run it:

PowerShell:

```powershell
docker run -d --name searxng -p 8080:8080 `
  --tmpfs /etc/searxng `
  tomoribot-searxng:latest
```

Bash (Linux/macOS):

```bash
docker run -d --name searxng -p 8080:8080 \
  --tmpfs /etc/searxng \
  tomoribot-searxng:latest
```

Then run `bun run dev` once the container is healthy (`docker ps` shows `(healthy)`).
Without `SEARXNG_SECRET` in the container environment, the image generates an ephemeral signing key.

---

### Option C: No SearXNG

Leave `SEARXNG_BASE_URL` unset. The chain falls back to `Brave → DuckDuckGo`.

When no SearXNG server is configured, the assembled `web_search` schema no longer advertises SearXNG-only categories. The common categories (`text`, `image`, `video`, `news`) still appear when Brave is configured, and text-only search appears when only the built-in DuckDuckGo fallback is available.

---

## Image result tuning

SearXNG image results are HEAD-validated, optionally compressed, and posted as Discord attachments: identical UX to Brave images. If all candidate URLs fail validation, SearXNG returns a text listing of image links instead of a hard failure.

| Variable | Default | Description |
|---|---|---|
| `SEARXNG_IMAGE_COUNT` | `3` (max 10) | How many valid images are sent to Discord. Overridden by the LLM's `count` arg. |
| `SEARXNG_IMAGE_POOL` | `10` | Candidate URL pool when the LLM does not specify `count`. When `count` is specified, the pool is `count × 3` (capped at 30) to absorb hotlink-protection failures. |
| `WEB_SEARCH_TIMEOUT_MS` | — | Per-engine request timeout. |

*(See `.env.optional.example` for all tunables.)*
