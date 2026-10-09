---
title: "Setup: Local MCP Server"
sidebar:
  order: 6
---

Connect TomoriBot to Model Context Protocol ([MCP](https://modelcontextprotocol.io/)) servers running on your local machine or private network to provide custom local tools.

For remote HTTPS servers, see [Tools & Extensions](/features/capabilities/tools-and-extensions/#mcp-servers). Local MCP endpoints require a self-hosted instance:

:::caution[Self-hosting only]
Local MCP servers are supported on self-hosted instances only. The public hosted bot requires HTTPS and blocks local/private addresses for security, so it cannot reach a server on `localhost` or your LAN.
:::

## 1. Run a local MCP server

Start an MCP server that exposes an HTTP/SSE transport on a local port. For example, many MCP servers run via Node:

```sh
npx -y <some-mcp-server> --port 3000
```

The exact command depends on the server you are running. Note the URL and transport path it prints (commonly `http://localhost:3000/sse`).

## 2. Register it in Discord

Open `/config` > Plugins > MCP Servers, choose `+ Add MCP`, set the `Server URL` field to your local endpoint, and keep `Server Type` on its default `General Purpose` setting:

```text
http://localhost:3000/sse
```

Leave `Auth Token (Optional)` blank: local servers do not require authentication tokens.

## 3. Manage it

Open the Config page and choose `Remove` on the server's row. Confirming unregisters it, immediately disconnects it, and frees a slot.

## Security

:::danger[Only add MCP servers you trust]
Even a local server you run yourself can misbehave if its code is untrusted. A malicious MCP server can prompt-inject the model, exfiltrate data passed to its tools, or return harmful results TomoriBot will relay. Review what an MCP server does before wiring it up.
:::

For the online-MCP flow and full security details, see [Tools & Extensions](/features/capabilities/tools-and-extensions/#mcp-servers).
