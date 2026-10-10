---
title: "Modal Input Components"
---

TomoriBot uses Discord modal dialogs to collect structured inputs: text inputs, single-choice radio groups, multi-choice checkbox groups, binary toggles, entity selects, and file uploads. Because discord.js lacks complete native support for newer modal components, TomoriBot coordinates modal dispatch via raw Discord REST API payloads and intercepts gateway packets before client parsing. For complete wire schema definitions and modal lifecycles, refer to the [Discord Modal documentation](https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-response-object-modal).

## The discord.js gap and raw modal architecture

The pinned discord.js version does not provide complete builder classes or parser structures for Label wrappers (type 18), Radio Groups (21), Checkbox Groups (22), Checkboxes (23), modal File Uploads (19), or modal entity selects (types 5, 6, 8).

TomoriBot handles these components through raw REST transmission and WebSocket interception:

- **Raw REST transmission:** `showRoutedRawModal` in `src/utils/discord/ui/interactionCore.ts` sends raw JSON payloads to Discord's interaction callback REST endpoint (`InteractionResponseType.Modal`, type 9). It marks the interaction in the `rawModalAcknowledged` `WeakMap` so internal flow logic recognizes that the interaction has been answered, even though discord.js properties (`replied`, `deferred`) remain false.
- **WebSocket packet interception:** `setupWebSocketInterception` in `src/utils/discord/ui/interactionCore.ts` hooks into the Discord client WebSocket packet handler (`client.ws.handlePacket`). When an `INTERACTION_CREATE` gateway packet arrives with type 5 (Modal Submit) containing Type 18 Label components:
  - **Structured value extraction:** The interceptor extracts submitted values from nested components into session memory maps keyed by interaction ID:
    - `modalSelectValues`: String selects, user selects, role selects, channel selects, radio group values, and checkbox booleans.
    - `modalCheckboxGroupValues`: Checkbox group selection string arrays.
    - `modalFileUploadValues`: File upload attachment ID arrays.
    - `modalResolvedAttachments`: Discord API attachment objects from `packet.d.data.resolved.attachments`.
  - **Packet transformation:** `transformModalSubmissionPacket` rewrites Type 18 Label components into standard Type 1 Action Rows containing the nested inputs. This allows discord.js native modal parsing to process the submission without throwing unhandled component type errors.
- **Consume-once value extraction:** Route handlers and modal helpers read stored values using `takeRawModalSelectValue`, `takeRawModalCheckboxGroupValues`, and `takeRawModalFileUpload`. Each call deletes the retrieved entry from memory, reclaiming memory immediately after submission.

## Modal limits and wire constraints

`validateRawModalLimits` in `src/utils/discord/ui/componentsV2Limits.ts` validates raw modal payloads against Discord wire limits:

- **Dialog title:** At most 45 Unicode codepoints (`DISCORD_MODAL_TITLE_MAX`).
- **Top-level components:** 1 to 5 components (`DISCORD_MODAL_COMPONENTS_MIN` and `DISCORD_MODAL_COMPONENTS_MAX`).
- **Field labels:** At most 45 characters on Type 18 Label wrappers (`DISCORD_MODAL_FIELD_LABEL_MAX`).
- **Field descriptions:** At most 100 characters on Type 18 Label wrappers (`DISCORD_MODAL_FIELD_DESCRIPTION_MAX`).
- **Radio and checkbox groups:** Discord requires 2-10 radio options and 1-10 checkbox options. The local validator currently permits a one-option radio group; callers must still satisfy the [upstream component limits](https://docs.discord.com/developers/components/reference).
- **Text inputs:** At most 4,000 characters per field (`DISCORD_TEXT_INPUT_MAX`).

Discord clients cache checked states and selections by component `custom_id`. Re-opening a modal or opening paginated slices that share custom IDs causes the client to restore stale user selections instead of displaying truthful defaults. Modal builders generate a unique timestamp nonce (`modalNonce = Date.now().toString(36)`) appended to both modal and component custom IDs (`${customId}_${modalNonce}`).

## Interaction timing and acknowledgment constraints

Modal forms must satisfy Discord interaction timing deadlines:

- **The 3-second acknowledgment window:** Discord requires modal dialogs to be sent as the first response to an interaction via `showModal()` or the raw modal REST callback. Calling `deferReply()` or `deferUpdate()` before sending a modal causes Discord to reject the modal opening with an error.
- **Unacknowledged confirmations:** Standard confirmation dialogs like `promptWithConfirmation` call `deferUpdate()` inside their collector filter, consuming the button interaction. When a button click must lead to a modal, handlers use `promptWithUnacknowledgedConfirmation` in `src/utils/discord/ui/interactionCore.ts`, which returns the raw, unacknowledged `ButtonInteraction` so `showModal()` or `promptWithRawModal()` can serve as the first response.
- **Asynchronous option loading:** In anchor workflows (`runPersonaPickerWorkflow`), modal options that require database or network queries are passed as an asynchronous factory to `selection.openModal(async () => ...)` in `src/utils/discord/ui/personaWorkflow.ts`. The workflow immediately acknowledges the initial button with `deferUpdate()`, replaces the anchor message with a loading indicator, loads the options, and renders a fresh `Open Form` button (or range selector). The user clicks the fresh button, allowing its unacknowledged interaction to call `showModal()`.
- **Submission timing:** Modal submissions arrive as unacknowledged interactions. To prevent the 3-second interaction timeout during slow validation or database writes, handlers immediately acknowledge submissions with `submitted.deferReply()` or `modal.phase.beginInPlaceWork()`.

## Component selection standards

Use these guidelines when selecting modal input components:

- **Text Input (type 4):** Free-form string values (names, prompts, keys, numbers).
- **Radio Group (type 21):** Small fixed sets of 2 to 10 mutually exclusive choices.
- **Checkbox (type 23):** Single optional binary toggles (`true` or `false`). Standalone checkboxes cannot be required by Discord API rules.
- **Checkbox Group (type 22):** Multi-select options (1 to 10 choices). Also provides the required boolean pattern: a Checkbox Group with 1 option and `required: true`, requiring explicit user confirmation before submission.
- **String Select (type 3):** Dynamic collections or sets with 11 to 25 choices.
- **Entity Selects (types 5, 6, 8):** Native server entity selection for users, roles, or channels with optional type filtering.

All structured modal inputs must be wrapped inside a Label component (type 18). Text inputs in raw modals are also wrapped in Labels to support field descriptions.

Prompts exceeding 4,000 characters are partitioned across up to 4 text inputs using `splitPromptIntoModalParts` from `src/utils/text/modalPromptParts.ts`. Labels are generated via `promptPartLabel` and `promptPartDescription` in `src/utils/discord/ui/modalPromptPartLabels.ts` (for example `System Prompt (Part 2 of 4)`). On submission, parts are rejoined with `combineModalPromptParts`.

## High-volume patterns and form coordination

Complex configuration workflows coordinate modals with persistent panels and anchor flows:

- **Bulk configuration checklist pattern:** Used in `/moderation` (user blacklists, channel whitelists, role whitelists, persona mappings) and `/config` channel rules. Combines up to 5 Checkbox Groups with 10 options each (up to 50 total entries). A `/moderation` list already pages in the panel, so its Remove modal presents only the entries on the visible page. All current items are pre-checked; unchecking an entry indicates removal upon submission without requiring a second confirmation dialog. The submission handler compares the submitted array against a short-lived presented snapshot keyed by modal nonce, preventing accidental deletion of items added concurrently after the modal was displayed.
- **Range selector bridges:** When collections exceed single-modal limits (50 items for Checkbox Groups, 25 options for String Selects), control panels display bounded range buttons (`1-25`, `26-50` or `1-50`, `51-100`). Each range button opens a modal sliced to that exact subset.
- **Provider select to model modal pattern:** In `/config` and `/personal config` model settings (`src/utils/discord/ui/modelRoutingControls.ts`), selecting a provider opens a modal containing that provider's model list. This moves large model catalogs into modal dialogs, preserving the 40-component limit on the parent panel page.
- **Setup wizard modals:** `src/utils/discord/ui/setupPanel.ts` constructs configuration modals directly from draft records. All inputs are enclosed in Type 18 Labels. The setup string selects currently reopen on placeholders, whereas text inputs preserve existing configured strings. Discord supports default selections; the setup builder chooses not to set them.

## Source pointers

- `src/utils/discord/ui/interactionCore.ts`: `showRoutedRawModal`, `promptWithRawModal`, `setupWebSocketInterception`, and value extraction helpers.
- `src/utils/discord/ui/componentsV2Limits.ts`: `validateRawModalLimits` and modal limit constants.
- `src/utils/text/modalPromptParts.ts`: `splitPromptIntoModalParts` and `combineModalPromptParts`.
- `src/utils/discord/ui/modalPromptPartLabels.ts`: `promptPartLabel` and `promptPartDescription`.
- `src/utils/discord/ui/personaWorkflow.ts`: `openModal` lifecycle and asynchronous option bridging.
- `src/utils/discord/ui/modelRoutingControls.ts`: Provider-to-model modal generation.
- `src/utils/discord/ui/setupPanel.ts`: Setup wizard modal construction.
