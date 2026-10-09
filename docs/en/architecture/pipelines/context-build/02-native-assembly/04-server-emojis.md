---
title: "02.4: Server Emojis"
---

Server emojis list the custom emojis available in the guild, augmented with optional emotion keys and descriptive metadata.

## Flow and ownership

The contributor `buildServerEmojiContextItem` in `src/utils/text/context/serverAssets.ts` emits a `system`-role context item tagged `KNOWLEDGE_SERVER_EMOJIS`:

1. **Eligibility**: Returns `null` if the channel is a DM, `emoji_usage_enabled` is false, persona state is missing, or the guild's live emoji cache is empty.
2. **Metadata merging**: Uses `preloadedEmojis` from turn asset loading, or queries `serverRepository.loadEmojis(serverId)`. When Discord emojis share the same name, it retains the entry with the richest metadata (emotion key or description), breaking ties by the most recent update timestamp.
3. **Ordering and formatting**: Emojis are sorted by `createdTimestamp` ascending. Each entry formats as `:name:` or `:name: (Expresses <emotion>; <description>)`.
4. **Usage instructions**: Appends guidance instructing the model to write `:name:` without numeric Discord IDs. In impersonation mode, the wording simplifies to generic instructions.

The assembled text passes through `convertMentions` before emission.

## Constraints and rationale

- **Name deduplication**: Each emoji name appears at most once in the prompt so the LLM is not presented with duplicate choices.
- **Raw name syntax**: The output cleaner resolves `:name:` to Discord emoji tags using the guild's emoji list. The model supplies names instead of guessing snowflake IDs.
- **Preset reassembly**: Tagged as `KNOWLEDGE_SERVER_EMOJIS`, which SillyTavern preset reassembly flushes at the first knowledge anchor.

## Source pointers

- `src/utils/text/context/serverAssets.ts`: `buildServerEmojiContextItem`.
- `src/utils/db/repositories/ServerRepository.ts`: `loadEmojis`.
- `src/utils/text/context/mentionNormalizer.ts`: `convertMentions`.
- [05: Server Stickers](/architecture/pipelines/context-build/02-native-assembly/05-server-stickers/): companion asset contributor.
