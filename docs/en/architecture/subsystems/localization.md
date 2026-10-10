---
title: "Localization System"
---

TomoriBot localizes user-facing text through modular category files in `src/locales/`. The localization system handles translation loading, key resolution, fallback chains, Discord command metadata, embed protocols, and UI status formatting.

## Supported locales

The runtime discovers authored locale directories under `src/locales/`:

- `en-US` (canonical default and fallback)
- `es-419` (Latin American Spanish, serving `es-ES` as an alias)
- `ja` (Japanese)
- `pt-BR` (Brazilian Portuguese)
- `vi` (Vietnamese)
- `zh-CN` (Simplified Chinese)
- `zh-TW` (Traditional Chinese)

## Runtime architecture

The loader and resolver live in `src/utils/text/localizer.ts`.

- **Module structure:** Each locale directory (`src/locales/{locale}/`) organizes strings into category slices (`general.ts`, `commands.ts`, `providers.ts`, `tools.ts`, `bridges.ts`, and subdirectories under `commands/`).
- **Startup merging:** `initializeLocalizer()` scans authored locale directories, dynamically imports each slice, and merges them into a single nested tree via `Object.assign`. Duplicate top-level keys within a locale emit a warning.
- **Indentation normalization:** Multi-line template strings are automatically dedented on import, preserving code formatting in source files without leaking excess indentation to Discord messages.
- **Single-flight initialization:** Concurrent callers share one initialization promise. The runtime state lives on `globalThis` under a unique symbol (`tomoribot-localizer-runtime-state`) so multiple module instances across Bun share readiness state.
- **Protocol and intent setup:** Once locale trees load, initialization binds the embed protocol (`initializeEmbedProtocol()`) and keyword detectors (`initializeIntentPacks()`). Multi-locale intent packs union keyword lists across all authored locales so bilingual servers match triggers in any supported language.

```ts
// Example lookup
localizer(locale, "commands.config.setup.description")
```

## Resolution and fallback chain

Locale resolution follows three stages:

1. **Locale mapping:** The input code resolves via `resolveSupportedLocale()`. It tests an exact match among loaded locales, then checks `LOCALE_ALIASES` in `src/constants/locales.ts` (mapping `es-ES` to `es-419`), then an unambiguous base-language match. If no match exists, it resolves to `en-US`.
2. **Key lookup:** The runtime resolves the dot-path against the chosen locale tree. If the key exists, variables (`{placeholder}`) interpolate into the string.
3. **Per-key fallback:** When a key is missing from the chosen locale, `localizer()` falls back to `en-US` for that specific key. A rate-limited warning logs once per `locale:key` per process, keeping gaps visible in development without flooding production logs.
4. **Verbatim key return:** If the key is absent in both the requested locale and `en-US`, the dot-path string returns unchanged. Callers verify unknown keys by checking equality against the queried path.

Callers must not test translation presence by checking the returned string, because missing keys resolve to English. Instead, `hasLocaleKey(locale, key)` walks the requested locale tree strictly without fallback. `getLocaleSubKeys(locale, path)` enumerates child keys strictly defined within that locale.

`getSupportedLocales()` returns authored directories ordered by `LOCALE_DISPLAY_ORDER`. `getRegisterableLocales()` includes valid aliases (such as `es-ES`) when their underlying authored source tree is active.

## Slash command metadata

Slash command names, descriptions, and choices are localized during discovery in `src/utils/discord/commandLoader.ts`:

- Command descriptions: `commands.{category}.{path}.description`
- Option descriptions: `commands.{category}.{path}.{option_name}_description`
- Choice labels: `commands.{category}.{path}.{choice_value}_option` (or `{option_name}_choice_{choice_value}`)

Command builders set English baseline copy with `localizer("en-US", key)`. During command compilation, `commandLoader.ts` applies localized descriptions and choices across all loaded registerable locales. Translations are registered with Discord only when the authored locale defines the key; English runtime fallback is omitted from registration metadata.

## Status circles
<!-- anchor: status-circles -->

Status title circles are owned by the surface accent color rather than authored in locale strings. This constraint prevents title copy from contradicting its adjacent card color. `src/utils/discord/ui/statusTitle.ts` manages this behavior:

- Surface colors map to tones: `ColorCode.ERROR` maps to `🔴`, `WARN` to `🟡`, and `SUCCESS` to `🟢`.
- `withStatusCircle()` strips any existing leading circle with `stripStatusCircle()` before applying the tone circle, preventing double markers on legacy strings.
- Titles opening with author-chosen emojis (such as `⏳` or `✅`) retain their custom emoji without prepending a circle.
- Minimal notices render the same title as their Verbose form, circle included, and drop only the body. The embed protocol still matches emoji-free titles for Minimal kinds, because older Minimal notices that dropped the emoji remain in channel history.
- Non-status colors (info, neutral) and question surfaces remain bare. Components V2 panels convey tone through accent bars and do not render status circles in headings.

## Embed protocol persistence
<!-- anchor: embed-protocol-persistence -->

Discord embeds persist in channels across restarts and conversation turns. The bot classifies past embeds by matching rendered titles and author templates registered in `src/utils/discord/embedProtocol.ts`:

- Registered categories include memories learned, conversation resets, scene directives, compact summaries, and moderation notices.
- Startup validates reverse lookups across all authored locales, failing fast if distinct protocol keys produce identical titles.
- Once a locale ships, its protocol title values must remain immutable. Modifying a title template breaks historical recognition of existing messages in Discord channels.
- Legacy `[tomori:v1:<kind>]` footer tokens are recognized during classification for backward compatibility with older embeds.

## Tip-item keys
<!-- anchor: tip-item-keys-genaitips -->

User hints are stored as atomic, single-sentence bullet keys under `genai.tips.*` in `providers.ts`.

- `createTipText()` in `src/utils/discord/embedHelper.ts` resolves an array of `tipKeys` into formatted markdown rendered in a read-only Discord modal (`textDisplayModal.ts`).
- Callers compose tips conditionally by passing different key arrays across branches, avoiding duplicated multi-sentence copy.
- `genai.tips.support_server` is reserved. `createTipText()` appends it as the closing bullet of non-empty tip modals, so the support link is always present without manual caller inclusion.

## User preference routing

User language preferences are stored in `users.language_pref`:

- User registration records the observed interaction locale or guild preferred locale into `language_pref`.
- Command handlers pass `userData.language_pref` (falling back to interaction locale) into replies and panels.
- Unsupported stored preferences remain intact in storage. If an authored locale for that language is added later, the localizer resolves it automatically without requiring a database migration.

## Source pointers and recipes

- `src/utils/text/localizer.ts`: loader, cache, and lookup implementation.
- `src/constants/locales.ts`: Discord locale definitions and aliases.
- `src/utils/discord/commandLoader.ts`: command metadata auto-localization.
- `src/utils/discord/ui/statusTitle.ts`: status circle and tone helpers.
- `src/utils/discord/embedProtocol.ts`: embed protocol title registry.
- Contributor guide for adding translations: [Adding a Locale](/contributing/localization/new-locale/).
- Documentation site translation guide: [Docs Site Localization](/contributing/localization/docs-site/).
