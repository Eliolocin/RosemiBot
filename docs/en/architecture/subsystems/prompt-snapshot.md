---
title: "Prompt Snapshot"
---

The prompt snapshot subsystem reconstructs a prompt for the current channel history, persona, and configuration. It includes system instructions and request parameters, but does not capture an earlier generation request. It powers two surfaces sharing a single assembler (`assemblePromptInspection()`):

- `/tool prompt snapshot`: Exports the reconstructed prompt and sampling parameters to a file.
- `/context`: Visualizes context window consumption in an interactive usage grid with snapshot export buttons.

## Permission model and privacy

Prompt inspection separates aggregate token measurements from raw prompt content:

- **Guild-only execution**: Both commands require server context and cannot execute in direct messages.
- **Access tiers**: The `/context` panel shows token counts and segment proportions, open to all server members. Prompt text (the snapshot file and `/context` download buttons) contains server prompts and participant memories, so access requires the `ManageGuild` permission or the `prompt_snapshot_enabled` member permission setting (`canViewPromptText()` in `src/utils/text/promptInspection/delivery.ts`).
- **Privacy filters**: Messages from users configured with `FULL` privacy levels are excluded from the fetched message history, matching live chat execution.

## Faithfulness to runtime execution

Prompt assembly mirrors the production `messageCreate → tomoriChat` pipeline through `assemblePromptInspection()` in `src/utils/text/promptInspection/assemble.ts`:

- **Context construction**: Invokes `buildContext()` to assemble instructions, server memories, conditioning logs, SillyTavern preset reordering, and depth-injected `/context-note` content.
- **Participant discovery**: Calls `prepareParticipantContext()`, matching live chat profiles, synthetic identity mappings, and attribution logic.
- **Message boundary processing**: Respects conversation resets (`sliceMessagesAtResetMarker()`), link previews, stickers, and system-produced notice blocks (`extractNoticeTextFromComponents`).
- **History truncation**: Truncates conversation history against `resolveContextBudget()`, reproducing the drop policy applied during generation turns.
- **UI exclusion**: Diagnostic embeds and internal debug notices are omitted because they represent interface elements rather than model prompt input.

## Output formats

Snapshots can be exported in two formats:

### Text format (`format: text`)

Generates human-readable plain text annotated with configuration locator headers:

```text
=== Persona Attributes (`/config` > Persona > Identity & Personality) ===
...attribute definitions...

=== Server Memories (`/memories`) ===
...memory entries...

=== Conversation History (system-managed) ===
...dialogue turns...
```

Header markers indicate governing configuration commands and are annotations added for human readers; they are not sent to the LLM.

### JSON format (`format: json`)

Serializes the reconstructed context into provider-native request shapes:

- Google-family, Anthropic, and OpenAI-compatible serializers use request-building adapters. Providers without a probe builder, including NovelAI, use a generic OpenAI-style representation. Transport-time retries and degradation are outside the snapshot.
- Large media payloads are replaced with placeholders (`[BASE64_HIDDEN]`) to limit export file sizes.
- The optional `fetch_tools: true` flag appends provider-formatted tool definitions generated via `adapter.getAllToolsInProviderFormat()`.

### Request configuration block

Exports include provider sampling parameters constructed by `buildRequestConfig()`:

- Lists active parameters (such as `temperature`, `top_p`, `max_output_tokens`, and stop sequences).
- Includes provider-specific thinking configurations (such as Anthropic adaptive thinking or Gemini thinking budgets).
- Notes explicitly disabled parameters (`disabled_params`) and tool availability.

## Context usage panel (`/context`)

The `/context` command renders a 10x20 emoji grid where each cell represents 0.5% of the model's context window:

- **Token estimation**: Estimates character-to-token ratios (~4 characters per token for prose, ~3.5 for tool schemas via `tokenEstimate.ts`), matching history truncation heuristics.
- **Segment categorization**: Maps `ContextItemTag` values into seven visual categories (instructions, memories, notes, participants, tools, dialogue history, and media).
- **Window budgeting**: Free space terminates at the truncation ceiling (`floor((contextLength - outputReserve) * 0.9)`), with remaining space reserved for output generation and safety margins.
- **Dynamic interaction**: Snapshot buttons route through global interaction handlers (`context:v1:snapshot:<personaId>:<format>`), re-evaluating member permissions on each click.

## Source pointers

- `src/commands/tool/prompt/snapshot.ts`: Snapshot export command.
- `src/commands/context.ts`: Context usage command.
- `src/utils/text/promptInspection/assemble.ts`: Shared prompt inspection assembly (`assemblePromptInspection`).
- `src/utils/text/promptInspection/delivery.ts`: Permission validation (`canViewPromptText`) and file delivery.
- `src/utils/text/promptInspection/serialize.ts`: Plain text and native JSON formatting.
- `src/utils/discord/ui/contextUsagePanel.ts`: Grid layout and legend rendering.
- `src/utils/provider/contextBudget.ts`: Truncation budget calculations shared with live chat.
