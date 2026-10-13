"""Serve slop-guard's MCP tools over Streamable HTTP for a TomoriBot Prose Linter registration."""

import os

from mcp.server.transport_security import TransportSecuritySettings
from slop_guard.apps import mcp as slop_guard
from slop_guard.rules.pipeline import Pipeline

DEFAULT_ALLOWED_HOSTS = "slop-guard:*,localhost:*,127.0.0.1:*"

# slop-guard's own entry point only speaks stdio, and TomoriBot reaches MCP servers over HTTP.
server = slop_guard.mcp_server
slop_guard.ACTIVE_PIPELINE = Pipeline.from_jsonl(os.environ.get("SLOP_GUARD_CONFIG") or None)
server.settings.host = "0.0.0.0"
server.settings.port = int(os.environ.get("SLOP_GUARD_PORT", "8765"))
# FastMCP turns DNS-rebinding protection on only for loopback binds. Binding 0.0.0.0 would leave it
# off, so keep it on and admit only the hostnames TomoriBot uses to reach this container.
server.settings.transport_security = TransportSecuritySettings(
    enable_dns_rebinding_protection=True,
    allowed_hosts=[
        host.strip()
        for host in os.environ.get("SLOP_GUARD_ALLOWED_HOSTS", DEFAULT_ALLOWED_HOSTS).split(",")
        if host.strip()
    ],
)
server.run(transport="streamable-http")
