---
title: "Setup: slop-guard"
sidebar:
  order: 8
aiGenerated: true
---

Run [slop-guard](https://github.com/eric-tramel/slop-guard), a rule-based prose linter, as the
rule checker for [Response Drafting](/features/chatting-personality/behavior-tweaking/#response-drafting).
It scores each held reply for formulaic writing patterns and passes the report to the reviewer. The
check is rule-based, so it costs no tokens.

slop-guard only ships as a local stdio process. `servers/slop-guard/` wraps the pinned release
(`0.5.0`) in a small container that serves the same tools over MCP Streamable HTTP, which is how
TomoriBot connects to MCP servers.

## Start the server

### Option A: Docker Compose (when TomoriBot runs in Docker)

```sh
docker compose --profile slop-guard up -d
```

The container joins TomoriBot's Docker network as `slop-guard`. It publishes no host port.

### Option B: Standalone Docker (when TomoriBot runs on your machine)

Start the bot with the linter instead of `bun run dev`:

```sh
bun run launch --slopguard
```

This builds the image, starts a `slop-guard` container on `127.0.0.1:8765`, waits for it to accept
connections, then runs the bot in watch mode. The container keeps running after `Ctrl+C`; stop it with
`docker stop slop-guard`. After changing `servers/slop-guard/`, remove the old container
(`docker rm -f slop-guard`) so launch creates one from the rebuilt image.

## Register it

1. Open `/config` > Plugins > MCP Servers and choose `+ Add MCP`.
2. Set `Server URL` to `http://slop-guard:8765/mcp` (Option A) or `http://localhost:8765/mcp`
   (Option B). Leave `Auth Token` empty.
3. Set `Server Type` to `Prose Linter`.
4. Open `/config` > Plugins > Response Drafting and choose `<server name> / check_slop` under
   `Rule Checks`.

`Prose Linter` keeps the server's tools away from Tomori herself. slop-guard also has
`check_slop_file`, which reads a file path inside the container; the rule checker never offers it
because it does not take the reply text.

Local addresses work because self-hosted TomoriBot runs with `RUN_ENV=development` (Compose pins it).
With `RUN_ENV=production`, TomoriBot refuses MCP URLs that resolve to private or loopback addresses.

## Settings

| Variable | Default | Purpose |
|---|---|---|
| `SLOP_GUARD_CONFIG` | packaged rules | Path inside the container to a JSONL rule configuration. Mount the file and point this at it. |
| `SLOP_GUARD_PORT` | `8765` | Listening port. |
| `SLOP_GUARD_ALLOWED_HOSTS` | `slop-guard:*,localhost:*,127.0.0.1:*` | `Host` header values the server accepts. Add the hostname you put in `Server URL` if it is not in this list; any other host receives HTTP 421. |

slop-guard's default rules target generated prose in documentation and articles. Casual roleplay
replies trip some of them, such as the bullet and list-of-three checks, so the report is advisory:
the reviewer decides whether a hit matters for the persona. Mention the report in your reviewer
prompt if you want the reviewer to weigh it in a particular way. slop-guard's `sg-fit` tool can fit
a rule configuration to your own good and bad examples.

## Upgrade

Change the version in `servers/slop-guard/Dockerfile`, rebuild, and send a test message with
Response Drafting on. A new release can change the rules and the report format the reviewer reads.
