---
title: "Adding a Persona Preset"
sidebar:
  order: 10
---

How to add an official persona preset to the seed catalog. Locale variants of an existing preset are
covered in [Adding a Locale](/contributing/localization/new-locale/).

## Steps

1. Create `src/db/seed/catalog/personas/<name>/` with one file per language (`en-US.ts`, `ja.ts`),
   each exporting `persona: PersonaInput`, and register each in `personas/index.ts`. There is no
   directory scan. Required fields:
   - `preset_lineage_id`: identical in every language variant. It makes the variants one character
     and becomes the persona's `persona_lineage_id`, which scopes its memories. A locale without a
     variant lists the base-language or `en-US` variant instead.
   - `name`, `desc`, `attributes`, paired `sampleDialoguesIn` / `sampleDialoguesOut`, `language`,
     `avatarPath`, `triggerWords`.
   - Do not author `preset_attribute_public_flags`. `personaSeed.ts` derives it: the first attribute
     is public and the rest are private.
   - Add the lineage to `OFFICIAL_LINEAGE_IDS` and the `preset_lineage_id IN (...)` list in
     `personaSeed.ts`, to `PRESET_LINEAGE_BY_AVATAR` in `src/commands/persona/default.ts`, and to the
     naming snapshot in `tests/unit/db/personaNamingCatalog.test.ts`.
   - Optional `isNsfw: true` hides the preset from `/persona default` and `/setup`; the
     age-restricted `/nsfw persona default` lists only NSFW presets. Personas created from it copy the flag, and only
     `/nsfw persona import` accepts a file that carries it.
2. Put the avatar image in the folder and set `avatarPath` to the folder; the first image
   alphabetically is used.
3. Optionally add sprites under `sprites/` and list them per locale file:

   ```ts
   sprites: [
     { name: "mad", file: "sprites/mad.png", usageInstructions: "Use when angry or annoyed." },
     { name: "shy", file: "sprites/shy.png", isIdentity: false },
   ],
   ```

   `name` becomes the `sprite_key`, `file` is relative to `avatarPath`, `usageInstructions` is prompt
   guidance, and `isIdentity` renders the name as `sprite (Persona)`.
4. Add or edit shared system prompt presets in `src/db/seed/catalog/systemPrompts.ts` if needed.
5. Keep each image under 1 MiB; `bun run compress-media` shrinks oversized art.

## How presets reach servers

Applying a preset through `/setup` or `/persona default` creates a copy-on-write pointer:
`personas.is_pointer = true` with `preset_lineage_id` and `preset_language`. Reads resolve text and
config from the live `persona_presets` row, so seed edits reach every pointer persona after the next
boot.

- **Sprites** upload once to the immutable `presets/` storage prefix into `preset_sprites`, and every
  pointer persona resolves them live. Removing a sprite from the array removes it everywhere.
- **Avatars** upload once to `presets/`, recording `preset_avatar_shared_url` and
  `preset_avatar_hash`. Pointer alters resolve that URL live. A pointer main persona uses the bot's
  guild avatar, which `reconcilePresetMainAvatars` re-uploads per guild when
  `applied_avatar_hash != preset_avatar_hash`.
- The first local content edit, including `/server avatar`, turns the pointer into an independent
  copy that keeps `persona_id` and `persona_lineage_id`. Memory writes do not. `/persona default`
  restores the pointer and discards local changes.
- `/persona export` writes a self-contained copy stamped with `preset_lineage_id`. Import re-links to
  the official pointer only when the content exactly matches the seeded preset of that lineage.

## Verify

```bash
bun run check-seed-catalogs   # names, paired dialogues, attributes, sprite files, prompts
bun run check-media-size
bun run check
bun run lint
```

Then seed a dev database and check `/setup`, `/persona default`, `/persona export`, and
`/persona import`. A pointer persona should show the seeded values, pick up a seed edit after cache
invalidation, and become a copy on its first local edit. See
[Persona Presets](/architecture/subsystems/persona-presets/) for the pointer model.
