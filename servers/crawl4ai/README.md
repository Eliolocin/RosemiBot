# Crawl4AI Local Server

Optional self-hosted Crawl4AI Docker server used by TomoriBot's hidden
`fetch_url` engine chain:

```text
crawl4ai -> safe_http
```

The LLM still sees only `fetch_url(url, max_length?, start_index?, raw?)`.
Crawl4AI is enabled only when `CRAWL4AI_BASE_URL` is set and `/health` responds
successfully. If the server is absent, unhealthy, or fails a fetch, TomoriBot
falls back to its built-in `safe_http` fetcher.

## Local Development

### Compose Profile

Start the optional local server with:

```bash
docker compose --profile fetch-crawl4ai up -d crawl4ai
```

Set the bot env to the compose service URL:

```env
CRAWL4AI_BASE_URL=http://crawl4ai:11235/
CRAWL4AI_TOKEN=change-me
# Only needed when RUN_ENV=production; outside production the guard auto-relaxes.
# FETCH_URL_ALLOW_PRIVATE_NETWORK=true
```

Crawl4AI 0.9.4 refuses outside connections without an API token, so
`CRAWL4AI_TOKEN` is required.

The compose service passes `CRAWL4AI_TOKEN` to the container as
`CRAWL4AI_API_TOKEN`, while TomoriBot sends it as `Authorization: Bearer ...`.

### Standalone Docker

Use this when running TomoriBot directly with `bun run dev`:

PowerShell:

```powershell
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g `
  -e CRAWL4AI_API_TOKEN="$env:CRAWL4AI_TOKEN" `
  unclecode/crawl4ai@sha256:<DIGEST>

$env:CRAWL4AI_BASE_URL = "http://localhost:11235/"
bun run dev
```

Bash:

```bash
docker run -d --name crawl4ai -p 11235:11235 --shm-size=3g \
  -e CRAWL4AI_API_TOKEN="$CRAWL4AI_TOKEN" \
  unclecode/crawl4ai@sha256:<DIGEST>

CRAWL4AI_BASE_URL=http://localhost:11235/ bun run dev
```

For quick local testing you can use `unclecode/crawl4ai:latest`, but production
deployments should pin by digest.

## Image Pinning

Crawl4AI is a large browser runtime. Pin production images to a digest instead
of a moving tag:

```bash
docker pull unclecode/crawl4ai:latest
docker inspect --format='{{index .RepoDigests 0}}' unclecode/crawl4ai:latest
```

Replace `unclecode/crawl4ai:latest` with the returned
`unclecode/crawl4ai@sha256:...` value in deployment files, then smoke test with
`docker compose --profile fetch-crawl4ai up`.

## Resource Notes

- Expect a large image download. Recent public images are roughly gigabyte-scale
  because they include a browser runtime and Playwright dependencies.
- Allocate at least 2-3 GB RAM for comfortable local use. More is recommended
  if multiple users can fetch JS-heavy pages at the same time.
- Keep `--shm-size=3g` or an equivalent `/dev/shm` mount. Browser engines can
  crash or hang with Docker's small default shared-memory segment.
- TomoriBot's `FETCH_URL_TIMEOUT_MS` bounds each Crawl4AI request from the bot
  side. The server may continue internal cleanup after a client timeout.

## Robots.txt and Site Policy

TomoriBot does not add a separate `robots.txt` enforcement layer in this pass.
Crawl4AI fetches pages according to its own crawler/runtime behavior and the
target site's responses. Operators are responsible for using this server only
where they have permission to fetch content and for honoring site terms,
rate-limits, and robots expectations.

In production TomoriBot blocks localhost/private/internal target URLs before it
calls Crawl4AI unless `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`. Outside production
(`RUN_ENV` != `production`) the guard auto-relaxes and no opt-in is needed. Keep
the production default false unless a trusted deployment must let `fetch_url`
reach internal network addresses.

## Internal Redis Notes

The Crawl4AI Docker server includes Redis-backed job and monitoring plumbing for
its broader API surface. TomoriBot uses only synchronous `POST /md` plus
`GET /health`; it does not submit Crawl4AI background jobs and does not depend on
the server's job queue. If Redis is exposed or configured separately in a custom
deployment, keep it private to the Crawl4AI service.

## TomoriBot Configuration

| Env var | Consumed by | Default |
|---|---|---|
| `CRAWL4AI_BASE_URL` | TomoriBot | unset, Crawl4AI disabled |
| `CRAWL4AI_TOKEN` | TomoriBot and the compose container | unset |
| `FETCH_URL_TIMEOUT_MS` | TomoriBot | `15000` |
| `FETCH_URL_HEALTHCHECK_CACHE_SEC` | TomoriBot | `60` |
| `FETCH_URL_ALLOW_PRIVATE_NETWORK` | TomoriBot | `false` (production-only opt-in; auto-relaxed outside production) |
| `FETCH_URL_FILTER_MODE` | TomoriBot Crawl4AI `/md` requests | `fit` |

`FETCH_URL_FILTER_MODE=fit` uses Crawl4AI's content filtering for cleaner
markdown. A `fetch_url(..., raw=true)` call overrides the filter to `raw` for
that request when less-filtered markdown is needed.
