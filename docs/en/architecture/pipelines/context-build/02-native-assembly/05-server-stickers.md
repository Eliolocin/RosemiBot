---
title: "02.5: Server Stickers"
---

The server sticker contributor emits available native and custom server stickers that the persona can send using the sticker tool.

## Flow and ownership

The contributor `buildServerStickerContextItem` in `src/utils/text/context/serverAssets.ts` emits a `system`-role item tagged `KNOWLEDGE_SERVER_STICKERS`:

1. **Eligibility**: Returns `null` if sticker usage is disabled (`sticker_usage_enabled === false`), the turn is a DM or user impersonation, or persona state is missing.
2. **Candidate projection**: Loads sticker metadata and custom expressions (using preloaded collections or querying `ServerRepository`). `projectStickerCandidates` in `src/utils/discord/stickerCandidates.ts` filters sendable native guild stickers and custom stickers assigned to the persona ID.
3. **Tool macro gating**: Wraps the projected sticker list inside `{{if tool:select_sticker_for_response}}...{{/if}}`. The tool macro resolver suppresses the entire block if `select_sticker_for_response` is unavailable to the provider, model, or turn allowlist.
4. **Formatting**: Formats entries as `- "<name>" (Expresses <emotion>; <description>)`, followed by an instruction to invoke `{sticker_tool}` with the sticker's case-insensitive name.

The output passes through `convertMentions` before emission.

## Constraints and rationale

- **Sendability filtering**: Native stickers check `isStickerSendable`. Explicitly unavailable stickers and IDs rejected by Discord are excluded from the candidate list.
- **Persona restriction**: Custom expressions can restrict access to specific persona IDs. Unrestricted expressions are available to all personas in the guild; restricted expressions require an exact match with the active persona.
- **Preset reassembly**: Tagged as `KNOWLEDGE_SERVER_STICKERS`, which SillyTavern preset reassembly flushes at the first knowledge anchor.

## Source pointers

- `src/utils/text/context/serverAssets.ts`: `buildServerStickerContextItem`.
- `src/utils/discord/stickerCandidates.ts`: `projectStickerCandidates`.
- `src/utils/db/repositories/ServerRepository.ts`: `loadStickersByInternalId` and `loadCustomExpressions`.
- [04: Server Emojis](/architecture/pipelines/context-build/02-native-assembly/04-server-emojis/): companion asset contributor.
- [Execute Tool Call](/architecture/pipelines/tool-loop/02-execute-tool-call/): tool execution and sticker delivery.
