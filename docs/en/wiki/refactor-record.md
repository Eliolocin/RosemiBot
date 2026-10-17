---
title: "Module Ownership Reference"
sidebar:
  order: 99
aiGenerated: true
---

Use the architecture pages to find the module that owns a behavior before changing it. Each page
describes the current flow and links to the source that enforces its constraints.

| Task | Owning explanation |
| :--- | :--- |
| Trace message admission, queuing, and turn execution | [Chat pipeline](/architecture/pipelines/chat/) |
| Change tool availability, dynamic schemas, or MCP routing | [Tool system](/architecture/subsystems/tool-system/) |
| Change tool execution and termination | [Tool loop](/architecture/pipelines/tool-loop/) |
| Change persistent data and repository access | [Database schema](/architecture/subsystems/database-schema/) |
| Change derived state or invalidation | [Caching](/architecture/subsystems/caching/) |
| Change credentials, remote fetching, or privacy controls | [Security & privacy](/architecture/subsystems/security/) |

The [architecture overview](/architecture/) connects these flows. Contributor procedures are in
[Development tasks](/contributing/development-tasks/).
