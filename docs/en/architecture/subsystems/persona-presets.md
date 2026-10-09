---
title: "Persona Presets"
---

Official persona presets are seeded from typed catalog definitions under `src/db/seed/catalog/personas/` into `persona_presets`. They provide copy-on-write pointers that receive upstream catalog updates until local customization forks them into independent rows.

## Data model and pointer resolution

### `persona_presets`

The canonical preset catalog stores character definitions keyed by `(preset_lineage_id, preset_language)`:

- `preset_lineage_id`: Identifies the official character family across localized variants. Display names (`persona_preset_name`) can change in the catalog without altering lineage or requiring schema migrations.
- `preset_attribute_public_flags`: Boolean array indicating which attributes are shared publicly in conversation participant profiles. Official presets mark their appearance attributes public; other seeded attributes stay private.
- `preset_avatar_shared_url` and `preset_avatar_hash`: Object storage reference and content hash for the bundled character avatar.
- `preset_naming_config`: Defines gendered and neutral address terms for the character.

### Pointer personas

When a server adopts an official preset via `/setup` or `/persona default`, the database creates a pointer persona with `personas.is_pointer = true`:

- **Live content resolution**: Runtime state loading resolves prompt text, attributes, public attribute flags, and sample dialogues directly from `persona_presets`.
- **Trigger deduplication**: Trigger words resolve live from `persona_presets` and pass through `applyTriggerWordOwnership()` to prevent collisions on shared keywords (see [Multi-Persona System](/architecture/subsystems/multi-persona/)).
- **Lineage separation**: `preset_lineage_id` identifies the official preset row, while `persona_lineage_id` scopes server memories, personal memories, and conditioning history. Applying a preset stamps `persona_lineage_id` with the preset lineage, but memory updates never fork the pointer.

## Shared assets and reconciliation

Preset media is stored once and shared across servers:

```
Seeder / Sweep Lock (PostgreSQL Advisory Lock)
  ├── Seed Pass ──> Uploads immutable assets to presets/{lineage}/...
  │                 ├── preset_avatar_shared_url (avatars)
  │                 └── preset_sprites (expressions)
  └── Fan-out
      ├── Alters  ──> Live-resolve shared URL per webhook send (no local copy)
      └── Main    ──> Reconciler PATCHes guild member avatar on hash delta
```

### Alter avatars

Alter personas send messages via webhooks that accept an image URL per delivery. Pointer alters store `NULL` in `personas.webhook_avatar_url` and live-resolve `preset_avatar_shared_url` at load time (`PersonaRepository.resolvePointerAlterAvatarUrl`). Assets are stored under immutable paths (`presets/{lineage}/avatar-{hash}.png`), eliminating per-server storage costs.

### Main avatar reconciler

The main persona uses Discord's guild member identity, which cannot live-resolve per message. `reconcilePresetMainAvatars()` in `src/utils/persona/presetAvatarReconciler.ts` handles synchronization:

- Runs as a background task following `clientReady`.
- Compares `personas.applied_avatar_hash` with `persona_presets.preset_avatar_hash`.
- PATCHes Discord guild member avatars only when content hashes differ, skipping unchanged servers.
- Materialized (non-pointer) personas are skipped automatically.

### Shared sprites (`preset_sprites`)

Official sprite variations are uploaded once to immutable storage paths (`presets/{lineage}/sprites/{key}-{hash}.png`). `PersonaSpriteRepository.listForPersona()` reads from `preset_sprites` for pointer personas and from `persona_sprites` for materialized personas, exposing a uniform interface to prompts and render modifiers.

### Asset protection and cleanup

`deletePersonaAvatarFromStorage()` guards all paths under `presets/`, preventing server resets or persona removals from deleting shared catalog assets. Obsolete asset cleanup is handled through `bun run sweep-preset-assets`, which runs under a PostgreSQL advisory lock shared with startup seeders to prevent race conditions during deployments.

## Materialization and customization

The first local edit to prompt text, attributes, sprites, or naming forks the pointer into an independent copy:

- `is_pointer` transitions to `false`.
- The live preset state is copied into per-persona database tables (`personas`, `persona_attributes`, `persona_configs`, `persona_sprites`).
- `persona_lineage_id` is preserved so existing memories and conditioning history remain intact.
- **Reference preservation**: Sprites and alter avatars copy shared `presets/` URLs by reference, avoiding byte duplication while retaining protection under storage deletion guards.
- **Avatar customization exception**: Editing an avatar forks the persona and removes preset sprites referencing shared assets (`removePresetSpritesAfterAvatarChange`), preventing expressions from the previous character from persisting alongside the new face.
- **Pointer restoration**: Applying an official preset via `/persona default` discards local content edits and restores the live pointer.

## Cards, imports, and vision generation

- **Export**: Exports materialize pointer state into self-contained cards, tagging `preset_lineage_id` for character provenance.
- **Import**: Re-establishes a live preset pointer only when attributes, public flags, dialogues, triggers, and prompt text exactly match the seeded preset. Deviations produce independent materialized copies.
- **Image captioning**: During `/persona generate`, an uploaded image is paired with the primary model. If the primary model cannot accept images, `analyzeImageWithVisionModel()` requests a description from the configured vision model and passes that text via `appearanceDescription`, keeping raw images out of text-only model requests.

## Source pointers

- `src/db/seed/catalog/personas/` & `src/db/seed/catalog/personaSeed.ts`: Canonical preset catalog and startup seed logic.
- `src/utils/persona/presetAvatarReconciler.ts`: Background fan-out reconciler for main persona guild avatars.
- `src/utils/db/repositories/PersonaRepository.ts`: Live pointer state assembly and alter avatar resolution.
- `src/utils/db/repositories/PersonaSpriteRepository.ts`: Unified sprite resolution across pointer and materialized personas.
- `src/utils/persona/spriteArchive.ts`: Sprite package export and import serialization.
