---
title: "SillyTavern Support"
# Keyword-rich <title> targeting "SillyTavern character cards in Discord"
# queries; replaces Starlight's default for this page only. H1 and sidebar
# keep the plain title.
head:
  - tag: title
    content: "TomoriBot | Use SillyTavern Character Cards in Discord"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "Import SillyTavern character cards and prompt presets into Discord with TomoriBot. Bring your existing characters to your server."
sidebar:
  order: 2
---

TomoriBot can import two assets from [SillyTavern](https://github.com/SillyTavern/SillyTavern):
Prompt Manager presets (which control prompt structure) and character cards (the character definition).
If you have never used SillyTavern, you can safely skip this page.

## Character Card Import

Bring an existing SillyTavern character into Discord with `/persona import`. It accepts:

- **PNG cards** with embedded `chara` or `char` metadata.
- **v2-style JSON** cards with root-level properties (`name`, `description`, `first_mes`).
- **v3 JSON** cards (`spec: "chara_card_v3"` with a nested `data` object).
- **`.charx` archives** (Character Card V3 packages).

A `.charx` file is a ZIP archive containing a `card.json` definition. TomoriBot imports the
character text from `card.json` and skips bundled asset files (icons, sprites, audio, video).
You can set an avatar in `/config` > Persona > Identity & Personality and add sprites in
`/config` > Persona > Sprites.

If an uploaded file is a valid SillyTavern card without TomoriBot metadata, the import
converts it automatically. You can also pass a card to `/persona generate` to create a fresh
persona inspired by the character.

Imports are validated before saving (default limits: 5,000 characters per text field, 200
attributes, 100 sample dialogues per side, 100 trigger words). For field mapping and
conversion mechanics, see the
[card-support architecture](/architecture/integrations/sillytavern/card-support/).

## Prompt Presets
<!-- anchor: prompt-presets -->

A SillyTavern Prompt Manager preset controls the order and layout of the prompt sent to the
model. Open `/config` > Plugins > SillyTavern Presets to import presets, toggle individual
nodes, switch active presets, or restore default formatting.

### What a Preset Controls

- Prompt ordering and marker placement
- Custom prompt nodes
- Post-history and depth-injection nodes
- Initial enabled state for imported nodes

### What a Preset Does Not Replace

A preset structures prompt layout; it does not replace the text sources that fill it:

- System instructions and persona fields: `/config` > Behavior > General Behavior,
  `/config` > Persona > Advanced, and `/config` > Persona > Identity & Personality.
- Live chat history and retrieved document context.
- Automatic context: server memories, emoji and sticker data, participant lists, and
  short-term memories.

### How Native Blocks Map

Native blocks map directly to TomoriBot prompt components:

- `main`: the active system prompt (`/config` > Behavior > General Behavior, or the default fallback)
- `charDescription`: `/config` > Persona > Advanced
- `charPersonality`: `/config` > Persona > Identity & Personality
- `dialogueExamples`: `/config` > Persona > Identity & Personality
- `chatHistory`: live channel message history
- `worldInfoBefore` and `worldInfoAfter`: retrieved document context (not SillyTavern lorebooks)

### System Prompt Rule

When an imported preset is active, the built-in fallback system prompt is removed. However,
if you configure a custom system prompt in `/config` > Behavior > General Behavior, that prompt
is always included.

### Compatibility Notes

- Nodes disabled in `prompt_order` remain inactive until enabled in `/config` > Plugins > SillyTavern Presets. Empty and comment-only nodes are never sent.
- Block order is literal: placing `chatHistory` ahead of `dialogueExamples` places chat history first in the prompt.
- Post-history injections merge into existing conversation history rather than sending as standalone messages.
- Regex post-processing, preset-defined sampling parameters (temperature, top-p), and layered presets are not supported. Legacy text-completion presets import with ST-only blocks dropped.

In `/help`, choose `Plugins`, then `SillyTavern Presets`, for the Discord guide. For internal
preset processing, see the
[preset-system architecture](/architecture/integrations/sillytavern/preset-system/).
