---
title: "Thinking Level"
aiGenerated: true
---

The `thinking_level` setting is a provider-scoped preference (`auto`, `none`, `low`, `medium`, `high`) configured in `/config` > Models > Text Samplers & Parameters or `/personal config`. It translates abstract reasoning effort into provider-specific request parameters at runtime, leaving providers without request-side controls unaffected.

Stored in `saved_provider_configs.thinking_level` and `user_saved_provider_configs.thinking_level`, the setting defaults to `auto` and restores automatically when switching active providers.

## Shared semantics and overrides

TomoriBot interprets thinking levels before converting them to vendor fields:

| Level | Intended behavior |
|---|---|
| `auto` | Follows the provider or model default behavior. |
| `none` | Disables thinking if supported; otherwise selects the provider's lowest safe setting. |
| `low` | Requests light reasoning effort. |
| `medium` | Requests balanced reasoning effort. |
| `high` | Requests maximum available reasoning effort. |

### Dynamic request overrides

When a turn sets `forceReason = true` (such as invoking `/respond` with reasoning enabled), TomoriBot upgrades an effective level of `auto` or `none` to `high` for that individual generation request. The stored configuration row remains unmodified.

### Numeric budget defaults

For providers accepting numeric token budgets rather than named effort strings, TomoriBot maps non-empty levels using defaults from `src/utils/provider/thinkingControl.ts`:

- `low`: 1,024 tokens (`DEFAULT_LOW_BUDGET_TOKENS`)
- `medium`: 4,096 tokens (`DEFAULT_MEDIUM_BUDGET_TOKENS`)
- `high`: 8,192 tokens (`DEFAULT_HIGH_BUDGET_TOKENS`)

## Provider mappings and runtime constraints

### Google / Vertex

Gemini behavior branches by model family:

- **Gemini 2.5**: Maps to numeric `thinkingBudget`. `auto` sends `-1`. `none` sends `0` for Flash models and clamps to `128` for Pro models (which cannot disable thinking). Flash-Lite clamps upward to `512`.
- **Gemini 3 / 3.1**: Maps to enum `thinkingLevel` (`MINIMAL`, `LOW`, `MEDIUM`, `HIGH`). `auto` omits the configuration. `none` and `minimal` map to `MINIMAL` only for Flash releases known to accept it (an allow-list in `thinkingControl.ts`) and to `LOW` everywhere else, because Pro models and Gemini 3.7 Flash onward reject `MINIMAL` while every Gemini 3 model accepts `LOW`.
- **Assistant prefill interaction**: Gemini suppresses internal thought tags when continuing assistant prefills, emitting reasoning tokens directly into visible response text. The prefill resolver (`resolvePrefillBlocker` in `src/utils/chat/assistantPrefill.ts`) permits server prefills on Gemini only when thinking resolves to `thinkingBudget: 0` or `thinkingLevel: MINIMAL`.

### Anthropic

Claude models listed in the profile table in `thinkingControl.ts` map to adaptive thinking. Each family rejects another family's off switch with HTTP 400, so an unlisted model receives no thinking fields until its profile is added:

- `auto`: `thinking: { type: "adaptive" }`
- `low` / `medium` / `high`: `thinking: { type: "adaptive" }` paired with `output_config: { effort }`
- `none`: `thinking: { type: "disabled" }` on most models. Sonnet 5.5 uses `{ type: "between_tools" }` instead, and Opus 5.5 and Fable cannot stop thinking, so they get adaptive thinking at `effort: "low"`.
- `temperature` and `top_p` are omitted whenever thinking is on. Opus 4.7 and later, Sonnet 5 and later, and Haiku 5.5 reject them in every mode, so those models never receive them.

### OpenRouter

Maps directly to OpenRouter's reasoning effort parameter:

- `auto`: Omits `reasoning`.
- `none`: `reasoning: { effort: "none" }`.
- `low` / `medium` / `high`: `reasoning: { effort }`.

### DeepSeek

- **Thinking toggle**: V4 models (`deepseek-flash` and its aliased codenames, `deepseek-v4-pro`) think at high effort when the switch is omitted, so `auto` keeps that default and `none` sends `thinking: { type: "disabled" }`. `low`, `medium`, and `high` send `thinking: { type: "enabled" }` with a matching `reasoning_effort` (DeepSeek folds `medium` into `high`). The retired `deepseek-chat` and `deepseek-reasoner` codenames are sent as `deepseek-flash` and follow the same mapping.
- **Tool replay constraint**: When thinking is enabled, DeepSeek returns HTTP 400 if a replayed assistant tool-call turn omits `reasoning_content`. TomoriBot enforces the presence of this key (`requiresReasoningContentReplay`), supplying an empty string fallback (`""`) when no reasoning was captured.
- **Degradation ladder protection**: Parameter degradation lists `thinking` in `mandatoryBodyKeys` for DeepSeek, preventing the adapter from dropping thinking while retaining tools (which would produce tool responses that cannot be replayed).

### Z.ai / Z.ai Coding

Maps to Z.ai's thinking flag:

- `auto`: Omits `thinking`.
- `none`: `thinking: { type: "disabled" }`.
- `low` / `medium` / `high`: `thinking: { type: "enabled" }`.
- Temperature and penalty parameters are omitted when thinking is active.

### Custom endpoints

- **Ollama**: Automatically detected by URL or port `11434`, mapping to `reasoning_effort` (`"none"`, `"low"`, `"medium"`, `"high"`).
- **Other local servers** (vLLM, llama.cpp, KoboldCPP): Do not receive speculative request fields. Thinking on these engines is managed via startup arguments or chat template flags to avoid request validation errors.

### NVIDIA NIM

NIM serves diverse model families behind one interface. Because different architectures read different parameters, non-auto levels send multi-switch payloads:

- `chat_template_kwargs: { enable_thinking: boolean, thinking: boolean }`
- `reasoning_effort: "low" | "medium" | "high"`
- `none` sends `reasoning_effort: "low"` rather than `"none"` because NIM rejects `"none"` with HTTP 400 on gpt-oss and Llama.

### NovelAI

Maps to GLM prompt directives: `none` emits `/nothink`, while active levels emit `<think></think>`.

## Response parsing and privacy

- **Response parsing**: For models outputting thinking tokens (such as Gemma 4 on KoboldCPP), `GemmaThinkingParser` strips thought blocks from `delta.content` and routes them to thoughts before tool parsing runs.
- **Thought log suppression**: Thought logs are suppressed in channels governed by channel rules.

## Source pointers

- `src/constants/thinkingLevels.ts`: Thinking level values and localization keys.
- `src/utils/provider/thinkingControl.ts`: Provider mapping implementations (`buildGoogleThinkingConfig`, `buildAnthropicThinkingRequest`).
- `src/utils/chat/assistantPrefill.ts`: Assistant prefill gating against thinking states (`resolvePrefillBlocker`).
- `src/providers/deepseek/deepseekStreamAdapter.ts`: replay policy and mandatory thinking field.
- `src/providers/openaiCompatible/openaiCompatibleMessageBuilder.ts`: `reasoning_content` history replay.
