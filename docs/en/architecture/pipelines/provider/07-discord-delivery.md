---
title: "07: Discord Delivery"
---

Discord delivery formats, paces, and transmits normalized segments to Discord. It manages delivery
modes, typing simulation, webhook identity routing, and Discord API rate caps.

## Flow and ownership

Delivery is shared by `StreamMessageDelivery.sendSegment()` and `StreamUiUpdater.sendSinglePayload()`.
The flusher passes normalized segments from [stage 06](/architecture/pipelines/provider/06-segment-normalization/)
to `sendSegment()`, which selects the delivery mode and chunks text:

- **Aggregated mode (`HumanizerDegree.NONE`):** Queues segments into `state.pendingAggregatedText`.
  Output is withheld until a tool call, table attachment, or final flush, delivering content in a
  single batch. Identity overrides flush queued text immediately to keep webhook identities aligned
  with their specific lines.
- **Streaming mode (`HumanizerDegree.LIGHT`, `MEDIUM`, `HEAVY`):** Splits segments into Discord-safe
  chunks via `chunkMessage()`. Chunks send immediately or pace through `sendChunksWithTyping()`.

`StreamUiUpdater.sendSinglePayload()` executes Discord REST calls, routing payloads through webhooks
or standard bot messages based on context.

## Message chunking and formatting

`chunkMessage()` parses text into typed blocks to fit within Discord message limits:

- **Preserved spans:** Protects regions that must not split across message boundaries, including
  fenced code blocks, URLs, markdown formatting (`**`, `*`, `~~`, `` ` ``, markdown links), paired
  quotes, balanced parentheses, and custom emoji tags. An oversized code block repeats its opening
  fence and syntax language tag on subsequent messages so syntax formatting survives.
- **Emoji isolation:** Custom emojis isolate into individual messages unless positioned mid-sentence
  or inside numbered or bulleted list items. Consecutive emojis sharing an initial name prefix merge
  into emoji runs.
- **Humanizer splitting:** Paragraph breaks divide messages at degrees 1 and 2. Degree 3 splits at
  sentence boundaries and runs `humanizeString()`, rolling punctuation marks between deletion,
  splitting, and preservation while keeping styled markup spans intact.

## Typing simulation

`sendChunksWithTyping()` calculates delays scaled to character count, bounded by
`minVisibleDurationMs` (750 ms) and `maxTypingTimeMs` (4,000 ms), with optional thinking pauses.
Delays poll the stop registry every 250 ms through `interruptibleDelay()` and exit promptly if a stop
or interrupt arrives.

## Dispatch and identity routing

`StreamUiUpdater.sendSinglePayload()` routes messages through one of two channels:

- **Webhook delivery:** Used when alter personas or render-modifier identity overrides are active.
  The updater routes sends to `sendWebhookMessageWithIdentity()` with persona avatars and names.
  The initial message answering a source message sends a standalone reply notice via
  `sendWebhookReplyNotice()`. Invalid webhook errors (Discord codes 10015 and 50027) trigger cache
  invalidation and retry with a recreated webhook.
- **Bot messages:** Used for standard bot personas via `channel.send()` or `message.reply()`.

After each successful send, `recordChannelDeliveredWebhookIdentity()` records the author identity
in `src/utils/discord/stream/channelDeliveryContinuity.ts`. Subsequent artifacts in the turn, such
as sticker expressions and fallback notices, read this record so their messages group under the same
author. The payload's reference is recorded in `context.deliveredMessageRefs` so the chat pipeline
can delete partial output if a generation attempt is superseded.

## Rendered markdown tables

Tables detected in stage 06 bypass `chunkMessage()`. They are rasterized to PNG via
`renderMarkdownTableToPng()` and delivered as attachments with an interactive `Show Markdown` button:

- Clicking the button replies ephemerally with the table's cached source markdown.
- Source text is read on demand from `markdownTableCache` rather than held in event closures.
- The button disables after `SHOW_MARKDOWN_BUTTON_TIMEOUT_MS` (2 hours), matching the cache TTL.
- Table atomicity in stage 05 guarantees the block arrives intact; see
  [stage 05 table atomicity](/architecture/pipelines/provider/05-buffer-management/#markdown-table-atomicity).

## Constraints and rationale

- **Deterministic stops over retries:** Hitting server `send_message_limit` or the safety cap
  `STREAMING_LIMITS.MAX_FLUSH_COUNT` (40 messages) queues an internal stop. Raising an error would
  trigger futile fallback retries against an unchangeable limit.
- **Quiet teardown for inaccessible channels:** If a channel is deleted or access is revoked
  (Discord error 10003 or 50001), `stopForUnreachableChannel()` terminates the stream without
  retrying.
- **Native reply limitations:** Webhooks cannot create native Discord reply references. The
  standalone reply notice provides the only visual link between an alter persona message and its
  source prompt.

## Source pointers

- `src/utils/discord/stream/messageDelivery.ts`: `StreamMessageDelivery` and typing simulation.
- `src/utils/discord/stream/uiUpdater.ts`: `StreamUiUpdater.sendSinglePayload` and webhook routing.
- `src/utils/text/processors/chunkProcessor.ts`: `chunkMessage` and span preservation.
- `src/utils/discord/markdownTableButton.ts`: interactive table button and cache interaction.
- `src/utils/discord/stream/channelDeliveryContinuity.ts`: delivered identity recording.
- `src/utils/security/rateLimiter.ts`: `STREAMING_LIMITS.MAX_FLUSH_COUNT` definition.
