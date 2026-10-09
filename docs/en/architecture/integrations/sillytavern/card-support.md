---
title: "SillyTavern Card Import Support"
---

TomoriBot's `/persona import` command ingests and converts SillyTavern character cards into native
persona records. It supports PNG images with embedded metadata, legacy V2 root JSON files,
`chara_card_v3` JSON files, and Character Card V3 `.charx` archives.

## Container dispatch and archive safety

Dispatch selects the extraction path by attachment file extension before parsing:

| Extension | Extraction mechanism |
|---|---|
| `.png` | Extracts text chunks (`tEXt`, `zTXt`, `iTXt`) searching for `chara` or `char` keys. Decodes direct or base64-encoded JSON. |
| `.json` | Parses JSON directly, accepting root-level V2 objects or nested `data` V3 objects. |
| `.charx` | Unpacks zip archives using `src/utils/persona/charxArchive.ts` to retrieve `card.json`. |

Unsupported extensions are rejected before reading file content.

### Archive handling (`.charx`)

A `.charx` archive contains a Character Card V3 object as `card.json` alongside an optional `assets/`
directory. The reader in `charxArchive.ts` applies strict safety boundaries:

- **Safe parsing:** Archives are opened with `JSZip.loadAsync`, returning structured failure
  diagnostics without uncaught exceptions.
- **Card resolution:** `card.json` resolves by exact root path first, falling back to a
  case-insensitive basename search. This exact-match priority prevents a decoy `assets/card.json`
  entry from overriding the canonical root specification.
- **Decompression limits:** The uncompressed size declared in the zip central directory is validated
  against the card-byte limit before decompression, then the decoded bytes are measured again.
  The attachment download has a separate archive-byte limit.
- **Format recognition:** The container accepts cards lacking a `spec` property or declaring any
  `chara_card` specification, deferring schema validation to the conversion layer.
- **Asset bounds:** After parsing the card, the reader bounds its declared asset list and sums the
  central-directory sizes of referenced embedded assets. Asset contents are never decompressed.

### Asset exclusions

Only `card.json` is decompressed and converted. The `assets/` directory is excluded from import:

1. **Payload diversity:** `.charx` assets can bundle arbitrary audio, video, 3D models, fonts, and
   scripts.
2. **Sprite mapping incompatibility:** TomoriBot sprites require an explicit `sprite_key` and
   structured usage instructions. SillyTavern V3 emotion assets provide raw images without
   contextual trigger metadata.

When an imported archive carries bundled assets, the import succeeds for text data and surfaces a
notice pointing the user to `/server avatar` and `/config` > Persona > Sprites to configure visuals
manually.

## Field mapping and schema validation

Conversion is performed by `convertSillyTavernJsonToPresetData` in
`src/utils/db/repositories/PresetRepository.ts`.

### Field transformations

Card attributes map into TomoriBot's persona schema:

| SillyTavern field | TomoriBot destination |
|---|---|
| `name` | `persona_nickname` (capitalizes initial letter) |
| `description` | `attribute_list` (injected without prefix) |
| `personality`, `scenario`, `system_prompt` | `attribute_list` (prefixed with section headers) |
| `post_history_instructions`, depth prompts | `attribute_list` (prefixed with section headers) |
| `character_book.entries[].content` | `attribute_list` (enabled entries only) |
| `mes_example`, `first_mes`, `alternate_greetings` | `sample_dialogues_in` and `sample_dialogues_out` |
| Character name derivations | `trigger_words` |

Fields without operational equivalents in TomoriBot (`creator_notes`, `tags`, `spec_version`,
`group_only_greetings`) are omitted during import.

### Import safety schema

Converted data validates against TomoriBot's preset Zod schema before database insertion:

- Text fields are capped at 5,000 characters.
- Persona prompts permit up to 16,003 characters, aligning with the four-part modal configuration
  limit.
- Lists are bounded to 200 attributes, 200 NovelAI diffusion tags, 100 sample dialogue pairs, and
  100 trigger words.
- The SillyTavern converter also uses current runtime limits to split attribute text and cap
  sample dialogue lengths, pair counts, and trigger counts before Zod validation.

## Conversation and template adaptations

### Unpaired sample dialogues

SillyTavern cards frequently contain assistant-only dialogue examples without corresponding user
turns. The importer marks unpaired examples with `UNPAIRED_SAMPLE_DIALOGUE_SENTINEL` from
`src/types/preset/presetExport.ts`. `buildSampleDialogueContextItems()` in
`src/utils/text/context/templates.ts` omits the user side of those pairs. Preset reassembly adds a separator when sample dialogues end the assembled prompt, keeping examples distinct from the active scene.

### Template placeholders

The template engine supports single-brace and double-brace macros during string substitution:

- Single-brace: `{user}`, `{bot}`, `{char}`
- Double-brace: `{{user}}`, `{{bot}}`, `{{char}}`

### Avatar handling

Imported JSON files and `.charx` archives lack native avatar image streams. When importing an alter
persona without an avatar image, the system assigns the active main persona's avatar as the alter's
`webhook_avatar_url` fallback. When updating a main persona without an avatar, the existing avatar is
preserved.

## Source pointers

- `src/commands/persona/import.ts`: Command handler for file upload and import dispatch.
- `src/utils/persona/charxArchive.ts`: `.charx` zip inspection, safety bounds, and `card.json`
  extraction.
- `src/utils/image/pngMetadata.ts`: PNG chunk parsing (`tEXt`, `zTXt`, `iTXt`).
- `src/utils/db/repositories/PresetRepository.ts`: `convertSillyTavernJsonToPresetData` mapping and
  transformation logic.
- `src/utils/text/context/templates.ts`: `buildSampleDialogueContextItems` and unpaired dialogue handling.
- `src/types/preset/presetExport.ts`: Preset schema interfaces and Zod validation.
