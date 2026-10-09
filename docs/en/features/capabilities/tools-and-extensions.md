---
title: "Tools & Extensions"
sidebar:
  order: 1
---

Beyond chatting, TomoriBot can call tools to search the web, read documents, generate media,
set reminders, and interact with Discord messages. She decides when to use them based on
the conversation. This page covers built-in tools, how to extend her with MCP servers, and
how to keep prompts lean with Deliberate Tool Mode.

Here are a few examples of what tools enable in conversation:

- **1. Wellness Checker**
  ```text
  Every few hours, do a mandatory wellness check on @bau_h.
  Ask them how they feel right now and if they've taken a break from coding recently.
  Track their emotional state over time with {memory_tool} and/or {memory_update_tool} to report back to them later.
  ```
- **2. Weekly Yuri News**
  ```text
  Every Friday, compile the week's notable yuri manga chapters, anime episodes, and community fanart drops using {web_search_tool}.
  Present findings with {voice_message_tool} in a seductive ASMR voice.
  ```
- **3. Sleep Police**
  ```text
  If you notice through {message_metadata_tool} that someone is chatting past 2 AM, use {voice_message_tool} to send them a threateningly calm ASMR lullaby telling them to go to bed.
  If they keep talking 10 minutes later, use {manage_message_tool} to delete their message for their own good and remind them that sleep deprivation is a leading cause of their issues.
  ```

## Built-In Tools
<!-- anchor: built-in-tools -->

Tools depend on the active provider and model supporting tool calling. Many are gated behind
a feature flag (`/config` > Permissions), a Discord permission, a model capability, or an
optional API key.

| Tool | Prompt macro | Requires | What it does |
|---|---|---|---|
| Review capabilities | `{capabilities_tool}` | - | Check current chat abilities, commands, or settings before answering. |
| Create / update long-term memory | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | Save or replace a stable server fact or user preference. |
| Update short-term memory | `{short_term_memory_tool}` | (not on NovelAI) | Save temporary working memory for the current channel or story arc. |
| Create / update task | `{task_tool}` / `{task_update_tool}` | - | Schedule or edit reminders and self-tasks (see [Scheduled Tasks](/features/capabilities/scheduled-tasks/)). |
| Cross-channel message | `{cross_channel_tool}` | (not on NovelAI) | Act in another channel or thread, with an optional report-back. |
| Create thread | `{create_thread_tool}` | `thread_creation_enabled` + thread perms | Open a public thread and post its starter message. |
| Select sticker | `{sticker_tool}` | `sticker_usage_enabled` | Add a matching server sticker or custom expression to a reply. |
| Manage message | `{manage_message_tool}` | `manage_message_enabled` | Pin, edit, or delete recent messages (pin needs `Manage Messages`). |
| Block / unblock user | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | Persona-scoped mute/block of a user (does not touch memories). |
| Interact with recent message | `{message_interaction_tool}` | - | React to or send a short reply to a recent message. |
| Peek profile picture | `{profile_picture_tool}` | vision model or `vision_llm` | Inspect a user's or the persona's avatar. |
| Read document | `{document_tool}` | - | Extract text from a PDF or any UTF-8 text file: source code (`.py`/`.ts`/`.rs`/…), `.json`, `.yaml`, `.md`, `.txt`, and any non-binary attachment. |
| Reveal message metadata | `{message_metadata_tool}` | - | Annotate recent turns with handles and timestamps for precise targeting. |
| Process YouTube video | `{youtube_tool}` | model with video support | Analyze a specific YouTube link on demand. |
| Analyze image | `{image_analysis_tool}` | configured `vision_llm` | Delegate image understanding to a separate vision model. |
| Generate image / anime image | `{image_generation_tool}` / `{anime_image_generation_tool}` | `imagegen_enabled` + capable provider | Generate or edit images (see [Media Generation](/features/capabilities/media-generation/)). |
| Generate voice message | `{voice_message_tool}` | ElevenLabs key + persona voice + `voice_message_enabled` | Send a spoken Discord voice reply. |

:::note[For prompt authors]
When customizing her system prompt or persona instructions, reference tools by their **prompt
macros** from the table above rather than hardcoding tool names, because the macros expand to the
correct names at context-assembly time and degrade gracefully when a tool is not available.
`{pin_tool}` and `{timestamp_refresh_tool}` still work as compatibility aliases for
`{manage_message_tool}` and `{message_metadata_tool}`. The web search and URL tools below
have macros too: `{web_search_tool}`, `{image_search_tool}`, `{video_search_tool}`,
`{news_search_tool}`, `{url_fetch_tool}`, and `{url_metadata_tool}`. These resolve
dynamically to the best available engine, including guild MCP replacements.
:::


### Conditional Prompt Blocks

Prompt text that supports the tool macros above also supports scoped conditionals:

```text
{{if capability:self_teaching}}
Use {memory_tool} when a detail is worth remembering.
{{else}}
Do not promise to save long-term memories.
{{/if}}
```

Use `capability:<name>` for an enabled TomoriBot setting, or `tool:<function_name>` when
the text should appear only if that exact tool is available to the active provider and
model. Use `tool_family:url_fetch` when either the bundled URL reader or a guild MCP
replacement is available. Prefix a condition with `!` to invert it. Blocks can be nested
and may contain one `{{else}}`; general `and`/`or` expressions are not supported.

The supported capability names are `tool_use`, `self_teaching`, `personal_memories`,
`emoji_usage`, `sticker_usage`, `web_search`, `manage_message`, `thread_creation`,
`image_generation`, `video_generation`, `voice_message`, `user_blocking`,
`short_term_memory`, and `time_awareness`.

Tool conditions reflect provider/model support, server configuration, configured backends,
MCP replacements, and the current Deliberate Tool Mode allowlist. They do not bypass or
predict Discord permission checks performed when a tool executes. Unknown capability names
evaluate as false and are logged; malformed blocks are omitted. Raw chat messages, model
output, and tool results are never treated as conditional templates.

## Web Search & URL Reading
<!-- anchor: web-search--url-reading -->

The model sees a single unified `web_search(query, category)` tool. Behind it, a dispatcher
routes each call through an engine chain and returns the first success:

Brave → SearXNG → DuckDuckGo

- **Brave** runs first when a Brave API key is configured (set it with
  `/providers`); it adds image, video, and news search. ⚠️ Set a $5 usage limit
  in the Brave dashboard to avoid surprise charges.
- DuckDuckGo is the default when no key is set. It covers text search only. When DuckDuckGo
  rate-limits the bot or shows it a bot check, the search fails and she posts a notice suggesting
  Brave.
- SearXNG and Crawl4AI are optional self-hosted servers that add more categories
  and browser-rendered page fetches; see [Self-Hosting](/self-hosting/).

For reading a specific page, she uses `fetch_url`. It's unavailable on NovelAI.

## MCP Servers
<!-- anchor: mcp-servers -->

[MCP](https://modelcontextprotocol.io/) (Model Context Protocol) servers extend her with
external tools you register yourself.

### Adding an Online MCP

Use a provider's direct HTTPS endpoint supporting MCP Streamable HTTP or SSE:

1. Get the MCP endpoint and its authentication requirements from the provider.
2. Open `/config` > Plugins > MCP Servers and choose `Add MCP`.
3. Paste the endpoint into `URL`, enter its bearer token in `Auth Token` if required, and
   choose the required `Server Type`. **General Purpose** is selected by default.

### Adding a Smithery Server

Servers hosted on Smithery have addresses ending in `.run.tools`. Paste that address into `URL`
and your Smithery API key into `Auth Token`. TomoriBot sends the key only to Smithery's API at
`api.smithery.ai`, never to the server address itself. Smithery then passes each tool call to the
server, so Smithery sees every tool request and result. Registrations saved before this support
returned work again without changes.

TomoriBot keeps one Smithery connection per server address in the first namespace of your Smithery
account (Smithery creates a namespace if you have none) and reuses it, so adding, testing, and
reconnecting do not pile up connections. TomoriBot never deletes connections. Earlier TomoriBot
versions made a new connection on every reconnect, so your account may hold many unused ones for
the same server; you can remove them from your Smithery dashboard.

Some servers ask you to sign in with the service they wrap. Adding one fails with a message that
authorization is needed, and TomoriBot never shows the sign-in link in Discord. Open your Smithery
dashboard, finish the sign-in for the connection whose name starts with `tomoribot-`, then add the
server again. Connecting and listing tools must finish within 15 seconds.

Disabling a registration selected for search or URL reading restores TomoriBot's built-in
selection; leaving it enabled prevents an automatic switch. Saved tool names describe the last
discovery, so they do not prove a connection still works.

Responses stop at 8 MiB while downloading. Large tool catalogs or results can leave a
plugin unavailable or cause a tool call to fail. For SSE connections, the limit covers
the whole response stream, including successive updates. Ask the provider for smaller
results, pagination, or file links when a tool returns large documents or embedded media.

If a server needs no auth, leave `Auth Token` blank. Your auth token is encrypted at rest
and never shown again. Open the same Config page to inspect configured state, enable or disable a server,
or remove one with explicit confirmation. Removal disconnects it immediately and frees a slot.
Each saved row also shows the bounded tool names from its last successful discovery. `None discovered` is a known zero-tool result; `Discovery unknown` identifies a legacy row or a server
that has no successful snapshot yet. Opening the MCP management surface only reads saved metadata and does not contact the
remote server.

### Local MCP Servers

Local MCP servers are supported on self-hosted instances only, because the public hosted bot
requires HTTPS and blocks local/private addresses. If you run your own instance, see
[Setup: Local MCP Server](/self-hosting/local-endpoints/setup-local-mcp/).

:::danger[Only add MCP servers you trust]
A malicious MCP server can prompt-inject her with hidden instructions, exfiltrate
data users pass to its tools, or return harmful or false results she'll relay to your
server. Treat MCP servers like browser extensions: if in doubt, don't add it. Always review
an MCP's described tools before adding it.
:::

## Deliberate Tool Mode
<!-- anchor: deliberate-tool-mode -->

Every declared tool adds to the prompt. `Deliberate Tool Mode` keeps tool declarations out
of ordinary chat turns unless the message looks like it actually needs a task tool; this
reduces prompt size and helps smaller/local models answer faster. Sticker selection remains
available for spontaneous expression when stickers and tool use are enabled and the provider
supports it. DM, impersonation, and roleplay restrictions still apply. Disable sticker usage
to prevent sticker replies. A due short-term memory refresh also admits its maintenance tool
without a user request.

- She first checks the message for tool intent. Built-in triggers cover common requests
  (reminders, web search, memory updates, cross-channel messages, image/video/voice
  generation, media analysis, thread creation, message actions). Questions about her current
  model, tools, settings, or why a capability is unavailable expose capability review and
  official documentation access together. Follow-up wording works too, like "do that again
  but angrier" after a voice-message request.
- Server managers can add literal custom trigger phrases with `/server trigger add`, for
  example mapping `pic`, `img`, or `pfp` to image generation.
- The built-in triggers read English phrasing. Other languages reach the same tools through
  each language's keyword list. Every shipped language's list is checked on every message,
  whatever your language setting is, so a bilingual server works in both languages.
- Custom phrases in Japanese, Chinese, or Korean also match inside longer words, because those
  languages do not separate words with spaces. A phrase ending in `*` matches any word that
  starts with it: `remind*` covers `reminder` and `reminding`.

### Controls

- `/server dtm`: server managers toggle it.
- `/personal config`: users override it for themselves.
- With a thought-log channel configured (`/server thought-logs`), successful deliberate-mode
  tool calls are logged there along with the trigger that exposed the tool.

Deliberate Tool Mode only decides which tools are *shown* to the model, but the model still has
to choose to call one. In `/help`, choose `Behavior`, then `Deliberate Tool Mode`, for the Discord summary.

:::note
`Deliberate Tool Mode` (this section) is unrelated to `Deliberate Trigger Mode`, which
controls how *she* is triggered; see
[Chatting & Triggers](/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode). Both are
abbreviated "DTM" in Discord.
:::

## Structured User Info Updates

TomoriBot can automatically update your profile and persona naming preferences when you
ask directly in chat (such as "call me Captain" or "my pronouns are they/them"):

| Preference | Scope | Effect |
|---|---|---|
| Nickname, prefix, suffix | Per persona | Only the active persona addresses you with this name or title. |
| Gender identity, pronouns, addressing style, timezone | Global | Every persona uses the same value across all servers. |

- **Removing a title**: asking her to stop using a title (such as "stop calling me Master")
  clears it for that persona.
- **Privacy**: restrictive privacy levels block new additions and edits while still allowing
  you to clear existing data.
- **Permissions**: server managers can toggle automatic updates using `User Info Updates` in
  `/config` > Permissions. You can always edit your profile manually with `/personal config`.

For tool parameter schemas and database storage layout, see the
[tool system architecture](/architecture/subsystems/tool-system/#structured-user-info-updates).
