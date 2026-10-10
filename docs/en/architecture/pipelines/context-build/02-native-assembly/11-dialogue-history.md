---
title: "02.11: Dialogue History"
---

The dialogue history contributor formats recent conversation turns, records capability-neutral media descriptors, and injects context notes and date spacers at designated dialogue depths.

## Flow and ownership

The contributor `appendDialogueHistoryContext` in `src/utils/text/context/dialogueHistory.ts` appends directly to `contextItems`:

```
simplifiedMessageHistory
  │
  ├─ calculate media window & duplicate image indices
  ├─ assemble active context notes (persona, channel, global, verbatim, reunion)
  │
  └─ loop messages:
       ├─ emit date spacer if day boundary crossed
       ├─ emit active note if index matches note target depth
       ├─ map role (user vs model) and sender metadata
       ├─ attach capability-neutral mediaDescriptors (within window & image limits)
       ├─ format text: author label ("resolve") + content ("preserve" macros)
       └─ push item (tagged DIALOGUE_HISTORY)
```

### Turn mapping and formatting

- **Role mapping**: Messages from the active persona map to `model`. During user impersonation, messages from the impersonated user ID map to `model`. All other messages map to `user`.
- **Blocked users**: Messages from users with an active persona-scoped block (`block_type = 'block'`) are replaced in history by a single `[System: ...]` notice, and reply quote annotations targeting them are suppressed.
- **Text formatting**: Lines format as `${authorName}: ${content}`. Author names resolve macros (`identityMacroMode: "resolve"`), whereas message bodies preserve `{bot}` and `{user}` literals (`identityMacroMode: "preserve"`). This prevents template drafts typed by users from collapsing into persona names.
- **File hints**: each `documentAttachments` entry adds a `[System: ...]` part built from
  `DOCUMENT_HINT_TEMPLATE`. The native builder expands the template once with the turn's tool macro
  resolver, so the instruction to call `read_file` appears only when the turn exposes it; otherwise the
  hint says the contents are unavailable. The filename and media ID are filled in after expansion, so a
  filename is never parsed as a macro.
- **Deterministic humanization**: At `humanizer_degree >= HumanizerDegree.HEAVY`, model-role historical turns pass through `humanizeString` with `suppressPunctuationNoise: true`. This applies casing normalization and semicolon stripping without randomized comma noise, preserving prefix stability for provider prompt caching.

### Media descriptor emission

Instead of adapting media to a specific model's vision capabilities during context build, this stage records capability-neutral `MediaDescriptor` objects:

- **Media window**: Capped by `Math.min(memoryGuard.getMediaWindow(), configuredMessageFetchLimit)`.
- **Rendered image limits**: Messages with counted images (attachments other than emojis or stickers) are limited to the most recent `MEDIA_IMAGE_MESSAGE_LIMIT` (default 3 messages). Images exceeding this limit emit a `[System: N image(s) omitted due to rendered-image limit]` note.
- **Deduplication**: When an identical image appears multiple times within the window, earlier occurrences are omitted so only the latest occurrence renders.
- **Per-attempt resolution**: Concrete adaptation runs later in `resolveMediaForModel` during each generation attempt. That stage determines whether a descriptor becomes provider image/video parts, a blind-model notice, or a notice that names `{image_analysis_tool}` only when that attempt's model and the turn's Deliberate Tool Mode allowlist expose it.

### Context note and spacer injection

Notes are injected at calculated depths measured from the end of history (`totalMessages - depth`):

- **Persona and channel notes**: Persona notes and channel notes are additive; both inject when configured. The global server context note is a fallback used only when neither persona nor channel configures a note.
- **Verbatim tool-calling nudge**: When `shouldInjectVerbatimToolCallingNudge(tomoriState)` is true, injects `VERBATIM_TOOL_CALLING_NUDGE` at depth 3 to guide custom endpoint models on verbatim tool syntax.
- **Reunion note**: Injects a precomputed reunion note at `TIME_AWARENESS_NOTE_DEPTH` (3) when a returning triggerer has an eligible absence gap.
- **Date spacers**: Injects an absolute-date `[System: ...]` separator before any message whose server-calendar day differs from the preceding timestamped turn. The pointer to `reveal_message_metadata` sits inside `{{if tool:reveal_message_metadata}}`.

## Constraints and rationale

- **Capability-neutral history**: Decoupling media descriptors from provider vision capabilities allows the same assembled context to be evaluated across fallback models without rebuilding history.
- **Prompt cache preservation**: Bypassing randomized punctuation noise keeps history formatting deterministic. Participant state, memory updates, and changing history windows can still alter the prompt prefix.
- **Hints follow the tool list**: a hint that tells the model to call a tool wraps that instruction in `{{if tool:...}}`, because history is simplified before the Deliberate Tool Mode allowlist exists. A hint written into message text at simplification time would name tools the turn never exposes.
- **Macro preservation**: Preserving identity macros in user message bodies prevents corruption when users ask personas to draft or edit prompts containing `{user}` or `{bot}`.
- **Preset reassembly**: Dialogue items are tagged `DIALOGUE_HISTORY` and `CONTEXT_NOTE_INJECTION`, which SillyTavern preset reassembly maps to the `chatHistory` marker.

## Source pointers

- `src/utils/text/context/dialogueHistory.ts`: `appendDialogueHistoryContext`.
- `src/utils/text/context/history.ts`: media descriptor filtering, timestamp formatting, and image limits.
- `src/utils/text/context/mediaResolver.ts`: `resolveMediaForModel` for per-attempt media adaptation.
- `src/utils/tools/verbatimToolCalling.ts`: `VERBATIM_TOOL_CALLING_NUDGE`.
- `src/utils/text/context/timeAwareness.ts`: `buildDateSpacer` and `TIME_AWARENESS_NOTE_DEPTH`.
