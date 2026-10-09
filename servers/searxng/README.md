# SearXNG Local Server

Self-hosted [SearXNG](https://docs.searxng.org/) instance fronted by the TomoriBot
web-search engine chain (`Brave → SearXNG → DuckDuckGo`).

SearXNG is a privacy-respecting metasearch aggregator. It calls upstream engines
(Google, Bing, DDG, Brave, Wikipedia, …) and returns a unified JSON result. By
running our own instance we sidestep single-engine rate limits and scrape
breakage.

TomoriBot exposes the common categories (`text`, `image`, `video`, `news`) and
SearXNG-only verticals (`science`, `it`, `files`, `music`) through the unified
`web_search` tool. The specialty categories only work when this server is
configured and SearXNG has active engines for that category.

## Files

- `settings.yml` — SearXNG configuration. Mounted read-only at
  `/etc/searxng/settings.yml`. References `${SEARXNG_SECRET}` which the
  container substitutes from env at startup.
- `limiter.toml` — Disables SearXNG's bot detection. Safe because the container
  only listens on the private container network.

## Local development

### Compose (recommended)

```bash
docker compose up -d
```

This starts SearXNG alongside Postgres + TomoriBot. The bot picks up the
`SEARXNG_BASE_URL=http://searxng:8080/` env var automatically.

### Standalone Docker (when running `bun run dev`)

PowerShell (Windows):

```powershell
docker run -d --name searxng -p 8080:8080 `
  -v "${PWD}/servers/searxng:/etc/searxng:ro" `
  -e SEARXNG_SECRET=dev-only-not-for-production `
  searxng/searxng@sha256:<DIGEST>

$env:SEARXNG_BASE_URL = "http://localhost:8080/"
bun run dev
```

Bash:

```bash
docker run -d --name searxng -p 8080:8080 \
  -v "$(pwd)/servers/searxng:/etc/searxng:ro" \
  -e SEARXNG_SECRET=dev-only-not-for-production \
  searxng/searxng@sha256:<DIGEST>

SEARXNG_BASE_URL=http://localhost:8080/ bun run dev
```

### No SearXNG (graceful absence)

Leave `SEARXNG_BASE_URL` unset. The chain falls back to `Brave → DuckDuckGo`.

SearXNG-only categories return the standard category-unavailable message in
this mode.

## Upgrade procedure

The image is **pinned by digest** in `docker-compose.yaml`, Terraform, and the
AWS task definition. To upgrade:

1. Pull the latest upstream tag and resolve its digest:
   ```bash
   docker pull searxng/searxng:latest
   docker inspect --format='{{index .RepoDigests 0}}' searxng/searxng:latest
   ```
2. Replace `searxng/searxng@sha256:<OLD>` with `searxng/searxng@sha256:<NEW>`
   in:
   - `docker-compose.yaml`
   - `terraform/gcp/variables.tf` (`searxng_image` default)
   - `.github/workflows/deploy-aws.yml` task-def container image
3. Smoke test locally with `docker compose up`.
4. Open a PR. CI build + deploy will roll the new digest forward.

## Configuration knobs

| Env var | Where consumed | Default |
|---|---|---|
| `SEARXNG_BASE_URL` | TomoriBot (`webSearch/searxngEngine.ts`) | unset → SearXNG disabled |
| `SEARXNG_SECRET` | SearXNG container (substituted into `settings.yml`) | required |
| `WEB_SEARCH_TIMEOUT_MS` | TomoriBot per-engine request budget | 5000 |
| `WEB_SEARCH_HEALTHCHECK_CACHE_SEC` | TomoriBot health-probe cache TTL | 60 |
