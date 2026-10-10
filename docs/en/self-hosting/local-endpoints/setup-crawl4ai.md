---
title: "Setup: Crawl4AI"
sidebar:
  order: 4
---

Render JavaScript-heavy web pages into clean Markdown for TomoriBot using a local [Crawl4AI](https://github.com/unclecode/crawl4ai) server.

The built-in `fetch_url` tool uses the lightweight `safe_http` engine by default. Crawl4AI adds an optional headless Playwright browser that executes client-side scripts and extracts page content before returning Markdown to the bot.

Because Crawl4AI follows redirects outside TomoriBot's guarded HTTP client, it is only admitted where private-network fetching is permitted. Outside production (`RUN_ENV` != `production`), private-network fetching is enabled automatically. In production environments, it requires setting `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`.

:::caution[What TomoriBot can and cannot check]
TomoriBot refuses a URL whose hostname does not resolve, or resolves to a cloud metadata address, before it asks Crawl4AI to open it. It cannot control what the browser does next: Crawl4AI resolves the name again, follows redirects, and loads images and scripts on its own. TomoriBot's always-on metadata block does not cover those requests.

The pinned image (`unclecode/crawl4ai:0.9.4`) sends its browser through its own proxy, which blocks private, loopback, and metadata addresses on every request and redirect. Leave `CRAWL4AI_ALLOW_INTERNAL_URLS` unset: setting it to `true` turns that proxy off, metadata included.
:::

Crawl4AI 0.9.4 needs an API token before it accepts connections from outside its own container. Generate one (for example `openssl rand -hex 32`) and set it as `CRAWL4AI_TOKEN` in `.env` for every setup path below. Without it, the container starts but TomoriBot cannot reach it and falls back to `safe_http`.

Choose a setup path:

### Option A: Docker Compose (when TomoriBot runs in Docker)

Use this path if you run TomoriBot with the repo's Docker Compose stack. First, set `CRAWL4AI_BASE_URL=http://crawl4ai:11235/` and `CRAWL4AI_TOKEN` in `.env`. Outside production no private-network opt-in is needed; only add `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` if you run this stack with `RUN_ENV=production`.

Then, start with:

```sh
docker compose --profile fetch-crawl4ai up -d
```

This starts the Compose stack with the Crawl4AI container on TomoriBot's Docker network. Compose passes `CRAWL4AI_TOKEN` to the container as `CRAWL4AI_API_TOKEN`, and TomoriBot sends it as a bearer token. Port 11235 is published on `127.0.0.1` only, for local debugging; TomoriBot itself connects over the Docker network.

If you run TomoriBot directly with `bun run dev`, use the standalone path below instead.

If you also want SearXNG, chain the profiles:

```sh
docker compose --profile searxng --profile fetch-crawl4ai up -d
```

---

### Option B: Standalone Docker (when running `bun run dev`)

First, set `CRAWL4AI_BASE_URL=http://localhost:11235/` and `CRAWL4AI_TOKEN` in `.env` so the bot connects to the container port published on `127.0.0.1`. Outside production no private-network opt-in is needed; only add `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` if you run with `RUN_ENV=production`.

Then, instead of running TomoriBot directly with `bun run dev`, use `bun run launch --crawl4ai`. This handles the container lifecycle automatically and waits for the server to be healthy before starting the bot. It stops with an error if `CRAWL4AI_TOKEN` is missing:

```sh
bun run launch --crawl4ai
```

If you also want SearXNG:

```sh
bun run launch --searxng --crawl4ai
```

If you prefer to manage the container yourself, keep `CRAWL4AI_BASE_URL=http://localhost:11235/` in `.env` and run:

PowerShell:

```powershell
docker run -d --name crawl4ai -p 127.0.0.1:11235:11235 --shm-size=3g `
  -e CRAWL4AI_API_TOKEN=<your-token> unclecode/crawl4ai:0.9.4
```

Bash (Linux/macOS):

```bash
docker run -d --name crawl4ai -p 127.0.0.1:11235:11235 --shm-size=3g \
  -e CRAWL4AI_API_TOKEN=<your-token> unclecode/crawl4ai:0.9.4
```

Use the same value for `<your-token>` as `CRAWL4AI_TOKEN` in `.env`.

Then run `bun run dev` once the container is healthy (`docker ps` shows `(healthy)`).

---

### Option C: No browser-rendering server

Leave `CRAWL4AI_BASE_URL` unset. The `fetch_url` tool uses the guarded `safe_http` engine.

---

## Starting order

TomoriBot probes server health on the first `fetch_url` call after startup and caches the result for 60 seconds. If the container is not ready when that first probe fires, the bot treats it as unavailable for the next minute.

For standalone Docker, start your Crawl4AI container before starting TomoriBot. `bun run launch --crawl4ai` already does this for you.

### First-time setup

1. Start the container and wait until it shows `(healthy)` in `docker ps`:
   ```powershell
   docker ps
   ```
2. Set `CRAWL4AI_BASE_URL` in `.env` using the value for your setup path above.
3. Start TomoriBot (`bun run dev` or `docker compose up`).

### Upgrading from `latest`

An existing `crawl4ai` container keeps the image it was created from, so `docker start` does not upgrade it. Remove it once, then use your setup path again:

```powershell
docker rm -f crawl4ai
```

With Compose, `docker compose --profile fetch-crawl4ai up -d` recreates the container from the pinned image.

### Returning after a restart

If the container already exists from a previous run, use `docker start` instead of `docker run` to avoid a naming conflict:

```powershell
# Start an existing container
docker start crawl4ai

# Confirm healthy before starting TomoriBot
docker ps
```

Then start TomoriBot as normal. Restarting `bun run dev` resets the in-memory health cache, so as long as the container is ready first the correct engine will be picked up immediately.

---

## Cookie injection

Crawl4AI supports injecting browser-level cookies so the headless browser appears already logged in when fetching a page. This is useful for sites that require a session to view content (e.g. paywalled news, private forums, login-gated dashboards).

The `safe_http` fallback does not support cookie injection. Cookies only apply when Crawl4AI is active.

:::note[Bot detection limits]
Cookie injection bypasses login walls but not bot fingerprinting. Sites with aggressive anti-bot detection (notably Twitter/X) detect headless Playwright via canvas/WebGL fingerprinting and serve empty pages even with valid session cookies. Cookie injection works well for sites that gate on authentication alone.
:::

### Getting your cookies

1. Open your browser and log in to the target site.
2. Open DevTools (`F12`) > `Application` tab > `Storage` > `Cookies` > select the site's domain.
3. Copy the `Value` of each required cookie (typically a session token; check the site's cookie names).

### Crawl4AI

Set `CRAWL4AI_COOKIES_JSON` in `.env` as a JSON array:

```dotenv
CRAWL4AI_COOKIES_JSON=[{"name":"session","value":"YOUR_SESSION_TOKEN","domain":".example.com"}]
```

When this is set, `fetch_url` automatically switches from the `/md` endpoint to `/crawl` with `browser_config.cookies`. `/md` does not support cookie injection.

### Cookie object fields

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Cookie name |
| `value` | Yes | Cookie value |
| `domain` | No | Domain scope (e.g. `.x.com`). Recommended for correctness. |
| `path` | No | Path scope. Defaults to `/` if omitted. |

:::caution[Protect session tokens]
Cookie values are sensitive, so treat them like passwords. They grant full session access to your account. Do not commit `.env` to version control.
:::

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CRAWL4AI_BASE_URL` | unset | Enables Crawl4AI when set: TomoriBot tries it first and falls back to `safe_http` when it is down or a fetch fails. Ignored in production unless `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`. Use `http://crawl4ai:11235/` from Docker Compose, or `http://localhost:11235/` when TomoriBot runs directly on your machine. |
| `CRAWL4AI_TOKEN` | unset | Required bearer token. Must match `CRAWL4AI_API_TOKEN` on the Crawl4AI container, which refuses outside connections without one. |
| `FETCH_URL_TIMEOUT_MS` | `15000` | Per-engine request timeout for Crawl4AI and the other URL-fetch engines. |
| `FETCH_URL_MAX_CONTENT_LENGTH` | `50000` | Maximum characters returned by one fetch call before continuation is required. |
| `FETCH_URL_ALLOW_PRIVATE_NETWORK` | `false` | Production-only opt-in. Outside production (`RUN_ENV` != `production`) the SSRF guard auto-relaxes, so localhost/private/internal fetches and Crawl4AI dispatch work with no setup. Set `true` only to permit private-network fetches in a trusted production deployment. |
| `FETCH_URL_FILTER_MODE` | `fit` | Crawl4AI `/md` filter mode. `fit` keeps markdown cleaner for LLM use; `fetch_url(..., raw=true)` overrides it per request. |
