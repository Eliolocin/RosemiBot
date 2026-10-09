---
title: "02.2: Server Info"
---

Server info provides the LLM with its environment framing: server name, server description, or direct message context.

## Flow and ownership

The contributor `buildServerInfoContextItem` in `src/utils/text/context/serverInfo.ts` emits exactly one `system`-role context item tagged `KNOWLEDGE_SERVER_INFO`.

The text format varies by channel type and impersonation mode:

- **Guild channel**:
  ```markdown
  # Knowledge Base
  {botName} is currently in the Discord server named "{serverName}".
  ## {serverName}'s Description
  {serverDescription}
  ```
- **Direct message**:
  ```markdown
  # Knowledge Base
  {botName} is currently in a Direct Message with User.
  ```
- **Impersonation**:
  Replaces `{botName} is currently in` with `You are {impersonatedIdentityName}, currently in`.

The assembled text passes through `convertMentions` so that channel links and user mentions inside server descriptions resolve to readable labels.

## Constraints and rationale

- **Single item guarantee**: This contributor always emits exactly one item.
- **Tag stability**: The item is tagged `KNOWLEDGE_SERVER_INFO`. SillyTavern preset reassembly treats this as a TomoriBot-only knowledge tag, flushing it at the first knowledge anchor (`charPersonality`, `charDescription`, or `main`).

## Source pointers

- `src/utils/text/context/serverInfo.ts`: `buildServerInfoContextItem`.
- `src/utils/text/context/mentionNormalizer.ts`: `convertMentions`.
