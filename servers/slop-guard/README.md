# slop-guard Local Server

Optional [slop-guard](https://github.com/eric-tramel/slop-guard) prose linter, served over MCP
Streamable HTTP so TomoriBot can register it as a `Prose Linter` and use it as the Response
Drafting rule checker.

slop-guard's own entry point only speaks stdio. `serve.py` imports its FastMCP server, applies the
optional rule configuration, and runs the same tools over HTTP at `/mcp`.

## Files

- `Dockerfile`: installs the pinned `slop-guard` release on `python:3.12-slim` and runs as a
  non-root user.
- `serve.py`: binds `0.0.0.0`, keeps FastMCP's DNS-rebinding protection on with an explicit
  `Host` allowlist, and starts Streamable HTTP.

## Run

```bash
docker compose --profile slop-guard up -d
```

Standalone, with the bot in watch mode:

```bash
bun run launch --slopguard
```

Setup, registration, and settings: `docs/en/self-hosting/local-endpoints/setup-slop-guard.md`.
