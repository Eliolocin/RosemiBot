---
title: "06: Segment Normalization"
---

Segment normalization transforms a flushed text segment by resolving render modifiers, cleaning
model artifacts, resolving Discord mentions, and enforcing speaker guards before handing text to
[stage 07](/architecture/pipelines/provider/07-discord-delivery/).

## Flow and ownership

The flusher passes each discrete segment to `StreamSegmentProcessor.sendBufferSegment()`. The
processor applies transformations in a strict sequence:

1. **Orphan-punctuation guard:** Segments consisting entirely of punctuation (such as `…` or `...`)
   are held in `state.pendingOrphanPunctuation` and prepended to the next non-empty segment, preventing
   single-character messages.
2. **Render-modifier capture:** Segments opening with `SourcePersona (modifier): text` are parsed by
   `parseLeadingRenderModifier()`. The modifier resolves against persona sprites:
   - Standard sprites use the clean persona username in Discord.
   - Identity sprites (`is_identity = true`) use the flipped username `sprite (SourcePersona)`.
   - The model context prefix retains `SourcePersona (modifier): ` so future prompts remember the choice.
   - Unmatched modifiers fall back to copied identities (impersonating other participants in context).
   - `advanceChannelSpriteGroupParity()` alternates clean and decorated usernames across consecutive
     different sprites so Discord renders each avatar instead of grouping messages under the first.
3. **Opening-label leak guard:** Evaluated at response start before text is sent. It detects foreign
   speaker labels, such as `User:` or `Chris (smug):`. If retry budget remains
   (`emptyResponseRetryCount < MAX_EMPTY_RESPONSE_RETRIES`), it queues a `speaker_guard` stop with
   nothing sent. The turn resolves as `empty_response` so post-turn logic regenerates the response.
   When the retry budget is exhausted, the label is stripped and the body is delivered as the active
   persona.
4. **Emoji deduplication:** `filterDuplicateCustomEmojis()` strips custom emoji shortcodes (`:name:`)
   used in recent bot messages within a 5-message window.
5. **Output cleaning:** `cleanLLMOutput()` strips the bot's own name prefix, converts `:name:` shortcodes
   to `<:name:id>` tags, strips unresolved shortcodes by default, uncensors space characters, and
   removes opening template labels such as `{{char}}:`.
6. **Guild mention resolution:** `resolveGuildMentions()` replaces `@handle` text with Discord snowflake
   mentions (`<@id>`) using participant maps built at turn start.
7. **Prefill stripping:** `stripPrefillFromSegment()` removes echoed assistant prefill strings
   (`context.outputPrefill`).
8. **Speaker guard truncation:** When `llm_stop_speaker_pattern_enabled` is active,
   `truncateBeforeGenericSpeakerLine()` cuts output before mid-response foreign speaker lines and
   queues a `speaker_guard` stop.
9. **Markdown table extraction:** `extractMarkdownTableSegments()` isolates markdown tables. Tables
   are rendered to PNG attachments via `renderMarkdownTableToPng()`, while surrounding text proceeds
   to stage 07.

## Constraints and rationale

- **Identity continuity across lines:** Copied identities expire at the end of their line so the bot
  reverts to its standard identity on the next line. Persona sprites persist across newlines until a
  new sprite label appears or generation completes.
- **Leak discard versus stripping:** Discarding an early leak allows the model to retry with explicit
  persona directives. Stripping only occurs when retries are exhausted, prioritizing delivery over
  silence.
- **Empty segment suppression:** If cleaning removes all content from a segment, delivery is skipped
  to prevent sending empty Discord messages.

## Source pointers

- `src/utils/discord/stream/segmentProcessor.ts`: `StreamSegmentProcessor` implementation.
- `src/utils/discord/renderModifierParser.ts`: render modifier syntax and label parsing.
- `src/utils/discord/stream/channelDeliveryContinuity.ts`: sprite group parity and delivery tracking.
- `src/utils/text/processors/llmOutputProcessor.ts`: `cleanLLMOutput` and speaker guard truncation.
- `src/utils/discord/stream/mentionResolver.ts`: mention resolution helpers.
- `src/utils/text/emojiPenalty.ts`: emoji deduplication across turns.
