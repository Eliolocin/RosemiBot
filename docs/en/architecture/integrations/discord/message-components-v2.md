---
title: "Discord Message Components V2"
---

TomoriBot uses Discord Components V2 to render structured interactive messages, control panels, and tool media cards with layout encapsulation. Payloads set `MessageFlags.IsComponentsV2` (`32768`), group elements inside containers and sections, and reference attachments directly within component media fields. For complete wire schema definitions and component types, refer to the [Discord Message Components documentation](https://discord.com/developers/docs/interactions/message-components).

## Message layout and component limits

`src/utils/discord/ui/componentsV2Limits.ts` enforces Discord structural constraints before REST transmission. Discord rejects oversized or invalid component trees with an HTTP 400 Bad Request error.

The repository enforces these limits:

- **Total components:** 40 (`DISCORD_MESSAGE_TOTAL_COMPONENTS_MAX`), counted recursively across top-level components, container children, and section accessories.
- **Text Display content:** 4,000 Unicode codepoints total across Text Displays. `getDiscordTextLength` counts codepoints; `truncateDiscordText` preserves whole grapheme clusters while fitting that budget. UTF-16 `.length` overcounts supplementary characters, and `.slice` can split surrogate pairs.
- **Action rows:** At most 5 buttons (`DISCORD_ACTION_ROW_BUTTONS_MAX`) or exactly 1 select menu (`DISCORD_ACTION_ROW_SELECTS_MAX`). Buttons and selects cannot share an action row.
- **Sections:** 1 to 3 Text Display components (`DISCORD_SECTION_TEXT_DISPLAYS_MIN` and `DISCORD_SECTION_TEXT_DISPLAYS_MAX`) with exactly one accessory component (Button or Thumbnail).
- **String selects:** 1 to 25 options (`DISCORD_SELECT_OPTIONS_MIN` and `DISCORD_SELECT_OPTIONS_MAX`). Option label, value, and description accept up to 100 characters; placeholder accepts up to 150 characters.
- **Buttons:** Label accepts up to 80 characters (`DISCORD_BUTTON_LABEL_MAX`). Interactive custom IDs require 1 to 100 characters (`DISCORD_CUSTOM_ID_MAX`) and must be unique within the message payload. Link URLs accept up to 512 characters (`DISCORD_BUTTON_URL_MAX`).
- **Media descriptions:** Alt text accepts up to 1,024 characters (`DISCORD_MEDIA_DESCRIPTION_MAX`).

## Validation and guarded delivery

`validateComponentsV2MessageLimits` in `src/utils/discord/ui/componentsV2Limits.ts` is a pure validator. It checks payloads without mutating text or clipping collections silently. When a payload exceeds bounds, it returns a structured list of violations with paths, observed values, and error codes (`DiscordLimitViolationCode`).

Dynamic page budgeting in `tests/unit/discord/configPanelTextBudget.test.ts` derives text reserves by subtracting measured fixed chrome from the message budget rather than subtracting static constants. This keeps dynamic collections bounded at stored maxima without rotted assumptions.

All panel updates (`reply`, `editReply`, `update`, `replace`) route through `deliverGuardedPanel` in `src/utils/discord/ui/interactionCore.ts`:

- In development and test environments, invalid payloads throw `ComponentsV2LimitError` to catch payload errors early.
- In production, `validateAndFallbackPanelPayload` logs redacted diagnostics and substitutes a minimal localized error card (`buildPanelFallbackPayload`). It attempts to repaint even when payload fitting fails after a committed write; Discord transport failure can still prevent delivery.
- Failures emit `panel_failure` metrics through `reportPanelFailure` for telemetry tracking.

The producer manifest in `tests/unit/discord/componentsV2ProducerManifest.test.ts` scans `src/` for `MessageFlags.IsComponentsV2` usage and asserts that every payload builder is registered and covered by fixture sweeps across all runtime locales.

## Interaction lifetime and state ownership

TomoriBot separates interaction lifetime into two patterns:

- **Bounded anchor workflows:** Used by ephemeral persona wizards such as `runPersonaPickerWorkflow(...)` in `src/utils/discord/ui/personaWorkflow.ts`. The workflow maintains a single ephemeral message using `AnchorMessageController`. Operations (`replace`, `edit`, `disableControls`, `delete`) verify that they target the original anchor message ID. `replace()` clears stale file attachments (such as persona avatar previews) unless explicitly retained. For public outcomes (such as `/stats generate`), `beginSeparatePublicReply` compacts the private anchor card before emitting exactly one public follow-up. Option sets exceeding 25 choices transition the anchor to localized range buttons (`1-25`, `26-50`) instead of opening an invalid modal.
- **Persistent panels:** Used by configuration, moderation, help, and status dashboards (`src/utils/discord/interactions/`). Panels use versioned custom IDs (`config:v2:*`, `moderation:v1:*`, `help:v2:*`, `status:v1:*`). They do not keep in-memory collectors alive. Route handlers own authorization and reload the state relevant to each action before repainting. Outdated version routes resolve to a localized message directing the user to reopen the panel.

Identity-sensitive collection controls, such as personal spotlight and endpoint selectors, bind their
custom IDs to an actor, server, and collection fingerprint. Submission checks the current collection
so a stale list position cannot mutate a different entity. Mutation routes must recheck permissions
and target scope after slow work, then invalidate cached state after database success.

## Container conventions and presentation hierarchy

Control panels and message cards follow consistent structure:

- **Container titles:** Use Markdown H3 headings. Persistent panels convey tone through accent bars and keep headings bare; status and notice helpers can add circles through `withStatusCircle`. Locale title strings omit leading circles and heading prefixes. See [Status circles](/architecture/subsystems/localization/#status-circles).
- **Panel text hierarchy:** Standardized across four levels:
  1. Major headings (`### `) for page titles and category counts.
  2. Nested subsection labels for grouped configuration fields.
  3. Plain explanatory prose (never quoted) for instructions and empty-state guidance.
  4. Quote rows (`>`) for configuration values, semantic status lines, and Discord mention lists (`<@id>`, `<#id>`). Mentions omit duplicate raw snowflakes.
- **Dividers and status footers:** Separator components (`ComponentType.Separator, divider: true, spacing: 1`) separate navigation controls from body content, and precede stale-read warning footers (`-# ...`).
- **Notice containers:** `buildNoticeContainer` constructs compact cards with an H3 title, Text Display description, separator, muted subtext footer, and optional action buttons (such as an Expand button).

## Generated media delivery and reverse discovery

Tool outputs for generated images (`buildGeneratedImageComponentsV2Payload` in `src/utils/discord/generatedImageMessage.ts`) and videos (`buildGeneratedVideoComponentsV2Payload` in `src/utils/discord/generatedVideoMessage.ts`) use Components V2 so timing footers appear below the media. The attachment is uploaded with the request and referenced via `attachment://<filename>` inside a `MediaGallery` item, followed by a `TextDisplay` component with subtext formatting (`-# Generated after 4.2 seconds.`).

- **Mode lock:** Once a message is sent with `MessageFlags.IsComponentsV2`, Discord forbids mixing legacy `content` or `embeds` on subsequent edits. `interactionCore.ts` tracks V2 interaction replies in the `componentsV2Reply` `WeakSet` so legacy embed sinks automatically emit V2-safe notice containers instead of triggering 400 Bad Request errors.
- **Webhook delivery:** Webhook executions in discord.js require `withComponents: true` when sending or editing Components V2 messages.
- **Reverse discovery:** Re-reading images from message context (for vision analysis, image-to-image generation, or inpainting) cannot inspect top-level attachments alone because Components V2 images are referenced inside component trees. `collectImageUrlsFromMessage` in `src/utils/image/imageExtractor.ts` delegates to `appendComponentMediaFromMessage` in `src/utils/chat/contextMedia.ts` to extract media from `MediaGallery`, `Thumbnail`, and `File` components.

## Source pointers

- `src/utils/discord/ui/componentsV2Limits.ts`: Limit constants and `validateComponentsV2MessageLimits`.
- `src/utils/text/discordTextLimits.ts`: Unicode codepoint length calculation and safe truncation.
- `src/utils/discord/ui/interactionCore.ts`: `deliverGuardedPanel`, `buildNoticeContainer`, and `componentsV2Reply` tracking.
- `src/utils/discord/ui/personaWorkflow.ts`: `runPersonaPickerWorkflow` and `AnchorMessageController`.
- `src/utils/discord/generatedImageMessage.ts`: Image Media Gallery card builder.
- `src/utils/discord/generatedVideoMessage.ts`: Video Media Gallery card builder.
- `src/utils/image/imageExtractor.ts`: Component media extraction for vision and image tools.
- `tests/unit/discord/componentsV2ProducerManifest.test.ts`: Producer manifest coverage checks.
- `tests/unit/discord/configPanelTextBudget.test.ts`: Text budget validation at stored maxima.
