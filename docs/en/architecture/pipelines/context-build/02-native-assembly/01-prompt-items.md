---
title: "02.1: Prompt Items"
---

Prompt items form the top of the context list, establishing the LLM's identity framing and behavioral rules.

## Flow and ownership

The contributor `buildPromptContextItems` in `src/utils/text/context/templates.ts` emits up to four `system`-role items depending on channel configuration and impersonation status:

1. **System prompt slot (`SYSTEM_HUMANIZER_RULES`)**:
   - In standard turns, this slot contains the server's configured `system_prompt` or the built-in `DEFAULT_SYSTEM_PROMPT`.
   - When the active channel has a prompt override configured in `replace` mode, the channel prompt replaces this slot's content.
   - When a SillyTavern preset is active and the server has no configured `system_prompt`, `suppressDefaultSystemPrompt` suppresses this item so the preset's system blocks control the prompt.
   - During user impersonation, this slot instead holds `impersonatedUserPrompt`.
2. **Channel prompt block (`SYSTEM_CHANNEL_PROMPT`)**:
   - When the active channel has a prompt override configured in `append` mode, the channel prompt is emitted as a distinct block immediately after the system prompt. Under SillyTavern preset reassembly, this block accompanies the `main` marker so it remains adjacent to the system prompt.
3. **Persona prompt block (`SYSTEM_PERSONA_PROMPT`)**:
   - Emits the persona's distinctive prompt instructions (`personaPrompt`). Omitted during user impersonation.
4. **Personality attributes (`SYSTEM_PERSONALITY`)**:
   - Emits the persona's personality traits (`tomoriAttributes`, joined by newlines). Omitted during user impersonation.

## Transforms and expansion

Before emission, every prompt text undergoes macro and mention expansion:

- **Capability and tool macros**: `toolPromptMacroResolver.expand` prunes inactive `{{if capability:...}}` and `{{if tool:...}}` conditionals, and substitutes active tool names such as `{short_term_memory_tool}` or `{memory_tool}`. Conditionals resolve against provider capabilities and the turn's Deliberate Tool Mode allowlist.
- **Mention normalization**: `convertMentions` resolves `<@id>`, `<#id>`, and `{bot}` / `{user}` tokens. Because prompt items instruct the model rather than addressing a specific user, the user name argument is fixed to `"User"`.

## Constraints and rationale

- **Impersonation isolation**: Impersonation turns emit only the impersonated user prompt. Persona prompts, attributes, and default humanizer rules are suppressed so the model adheres strictly to the target identity.
- **Channel override scope**: Channel overrides alter only the system prompt slot. They never alter or overwrite persona prompts or personality attributes.
- **Prompt tag stability**: Distinct metadata tags (`SYSTEM_HUMANIZER_RULES`, `SYSTEM_CHANNEL_PROMPT`, `SYSTEM_PERSONA_PROMPT`, `SYSTEM_PERSONALITY`) allow SillyTavern preset reassembly to map each block to its corresponding preset marker (`main`, `charDescription`, `charPersonality`).

## Source pointers

- `src/utils/text/context/templates.ts`: `buildPromptContextItems` and `DEFAULT_SYSTEM_PROMPT`.
- `src/utils/cache/channelPromptCache.ts`: `getCachedChannelPrompt` channel override lookup.
- `src/utils/tools/toolPromptMacros.ts`: `toolPromptMacroResolver` conditional and macro evaluation.
- `src/utils/text/context/mentionNormalizer.ts`: `convertMentions` mention conversion.
