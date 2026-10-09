---
title: "Logit Bias"
---

Logit bias modifies token sampling probabilities by injecting numeric bias adjustments into LLM requests. TomoriBot provides a text-first interface that stores canonical terms and resolves tokenizer-specific token maps at runtime.

## Configuration surface

Logit bias is configured via the interactive interface in `/config` > Models > Text Samplers & Parameters > Logit Bias:

- Supports adding individual terms, removing terms, or uploading bulk JSON/YAML definitions.
- Accepts plain text strings (such as `sorry, hello`) paired with numeric bias values (such as `-100`), as well as explicit numeric token IDs.

## Source of truth and tokenization caching

Each saved logit-bias entry contains:

- `text`: The user-provided term.
- `value`: The numeric bias weight.
- `kind`: Identifies whether the source was `text` or `token_id`.
- `tokenizations`: Cached token ID lists keyed by tokenizer family.

Raw text remains the canonical source of truth; cached tokenizations are derived data. Switching to a different model or provider preserves the original text, allowing the runtime to recompute tokenizer mappings without data loss.

Storage locations:

- Server active configuration: `server_chat_configs.llm_logit_biases`.
- Saved provider snapshots: `saved_provider_configs.llm_logit_biases` and `user_saved_provider_configs.llm_logit_biases`.

### Refresh triggers

Tokenizer caches are refreshed when entries are modified or when the active model changes:

- Adding or uploading entries in `/config` > Models > Text Samplers & Parameters.
- Switching models in `/config` > Models.
- Activating a saved provider via `/config provider switch` or `/personal config`.

## Text variant expansion and tokenizers

Plain-text entries are approximated as token-level biases by expanding each term into four variants before tokenization:

1. Exact text (e.g. `sorry`)
2. Leading-space text (e.g. ` sorry`)
3. Sentence-case text (e.g. `Sorry`)
4. Leading-space sentence-case text (e.g. ` Sorry`)

This expansion ensures consistent bias application across word boundaries and sentence openings.

### Supported tokenizer families

Tokenizers resolve through two backends:

- **OpenAI BPE families**: Handled by `gpt-tokenizer` (`o200k_base`, `o200k_harmony`, `cl100k_base`, `p50k_base`, `p50k_edit`, `r50k_base`).
- **Local tokenizer families**: Loaded from `./tokenizers` (configurable via `TOKENIZER_ASSET_DIR`) in `src/utils/provider/localTokenizerRegistry.ts` (`deepseek_v3_r1`, `qwen3_5`, `mistral_small3`, `glm_zai`, `stepfun_step35`, `kimi_k2`, `gemma3`, `nemotron3`).
- **OpenRouter models**: Resolved using tokenizer metadata reported in startup capability caches or model codename heuristics.

Each tokenizer implementation should cover an entire model family rather than duplicating assets per seeded model row.

## Provider gating and constraints

Tokenization support and request parameter support are separate checks:

- Tokenization determines whether raw text can be converted to token IDs for a given model.
- Provider gating determines whether the API adapter accepts and transmits `logit_bias`.

Active providers:

- **OpenRouter**: Sent only when the model's `supported_parameters` list includes `logit_bias`.
- **DeepSeek, Z.ai, Z.ai Coding, NVIDIA NIM**: Sent whenever active entries match the current tokenizer.
- **Custom, NovelAI, Anthropic, Google**: Omit `logit_bias` from request payloads.

Logit bias operates on token IDs rather than whole words. Biasing the tokens that compose a word also shifts the sampling probability of other words that contain those same tokens.

## Source pointers

- `src/utils/provider/logitBiasResolver.ts`: Tokenizer family resolution and runtime bias map assembly (`buildRuntimeLogitBiasMapForLlm`).
- `src/utils/provider/localTokenizerRegistry.ts`: Local tokenizer encoders and asset loaders.
- `src/utils/discord/interactions/configModelOperations.ts`: Logit-bias entry creation, deletion, and upload handlers.
