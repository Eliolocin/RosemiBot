---
title: "Add a New AI Provider"
sidebar:
  order: 10
---

How to wire a new AI provider into TomoriBot. For how the provider layer works, read
[Provider pipeline](/architecture/pipelines/provider/) first.

A provider is more than a folder. It needs an implementation, static metadata, seeded model rows, and
an optional capability for each app feature it supports beyond chat. Auto-discovery finds the
implementation and the metadata; nothing else registers itself.

## Rules

- `featureSupport` in `providerInfo.ts` describes what TomoriBot has wired end to end. It does not
  describe what the vendor API offers. Keep a flag `false` until the app path works.
- Model inventory and defaults come from the database. Do not hardcode model lists in provider code.
  Shared helpers take the calling provider's resolved default as an argument, so two providers on one
  wire protocol never share each other's models.
- Commands ask `providerSupportsFeature()`, or resolve a capability with the matching
  `resolve*Capability()` in `providerCapabilityResolver.ts` (for example
  `resolvePresetGenerationCapability()`). Do not add `if (providerName === "example")` checks to commands. A
  literal provider name is correct only for behavior that exists for one vendor, such as a
  vendor-only credential.
- Provider-specific HTTP calls, prompt shaping, and response parsing stay in
  `src/providers/{providerName}/`. Only code that every provider uses goes in a shared utility.

## 1. Choose the scope

Decide whether the provider is chat only, chat with tools, or also covers images, embeddings,
structured output, compaction, preset generation, or history extraction. The capability list is
`ProviderInfo.featureSupport` in `src/types/provider/interfaces.ts`.

## 2. Create the folder

```text
src/providers/{providerName}/
  providerInfo.ts
  {providerName}Provider.ts
  {providerName}StreamAdapter.ts
  {providerName}ToolAdapter.ts
```

For an OpenAI-style chat completions API, extend `OpenAICompatibleStreamAdapter` from
`src/providers/openaiCompatible/` instead of copying another provider. `deepseek`, `zai`, and `nvidia`
are the models to follow. Providers that extend it also inherit the parameter-degradation retry in
`src/providers/utils/paramDegradation.ts`. Other references: `google`, `openrouter`, `novelai`,
`custom`.

## 3. Write `providerInfo.ts`

```ts
import type { ProviderInfo } from "@/types/provider/interfaces";

export const exampleProviderInfo: ProviderInfo = {
	name: "example",
	displayName: "Example AI",
	aliases: ["ex"],
	supportedModels: [],
	requiresApiKey: true,
	supportsStreaming: true,
	supportsFunctionCalling: true,
	supportsImages: true,
	supportsVideos: false,
	apiFamily: "openai-compatible",
	featureSupport: {
		imageGeneration: "none",
		videoGeneration: "none",
		embeddings: false,
		structuredOutput: false,
		presetGeneration: false,
		expressionInitialization: false,
		liveTokenCounting: false,
		conversationCompaction: false,
		historyExtraction: false,
	},
	supportedParams: ["temperature", "topP"] as const,
};
```

- `supportedModels` stays `[]`; the database holds the inventory.
- `apiFamily` names the wire protocol, such as `openai-compatible`.
- `featureImplementations` is optional. Set it only when the provider routes a shared feature
  (`imageGeneration`, `videoGeneration`, `liveTokenCounting`) through an existing implementation key.
- `usageCostMode: "none"` stops `/tool estimate cost` from reporting per-token charges.

Without a valid `providerInfo.ts`, chat can still stream while every feature-gated command treats the
provider as unsupported.

## 4. Implement the provider class

Extend `BaseLLMProvider` and implement `getInfo()`, `validateApiKey()`, `formatErrorDescription()`,
`getTools()`, `createConfig()`, `streamToDiscord()`, and `getDefaultModel()`.

- `getInfo()` returns the object from `providerInfo.ts`.
- In `createConfig()`, set `maxOutputTokens` from `resolveRequestMaxOutputTokens(tomoriState)`. History
  truncation reserves the same figure, and it clamps to the model's ceiling. A provider with its own
  env cap or default adds an entry to `CHAT_OUTPUT_BUDGETS` in `src/utils/provider/maxOutputTokens.ts`;
  otherwise it falls back to 4096. Either default shrinks to a quarter of a known context window.
- `formatErrorDescription()` owns the provider's user-facing error text, so commands never format
  vendor errors themselves.
- Build the `StreamContext` with `buildStreamContext()` from `src/utils/provider/streamContext.ts`.
  It copies every shared field (locale fallback, prefill and reply-notice flags, webhook identity,
  abort signal, and the rest), so a new cross-cutting field reaches every provider in one edit.

## 5. Implement the stream and tool adapters

The stream adapter turns vendor chunks into TomoriBot's stream pipeline. The tool adapter converts
tool schemas and results into the vendor's function-calling format. Tool conversion differs per
vendor, so a serializer change (nested schemas, for example) has to land in every tool adapter.

- **Media the model cannot see**: the context pipeline can include image or video parts for a
non-vision model, because a fallback model in the chain may accept them. When the adapter meets a
part it cannot send, it must push a text part instead of skipping it:
`[System: An image/video is attached to this message that this model cannot process.]`. The reference
is `openaiCompatibleMessageBuilder.ts`.

- **Reasoning output**: put displayable reasoning on `ProcessedChunk.thoughts`: `kind: "summary"` for
vendor summaries, `kind: "raw"` for readable raw reasoning. Strip `<think>...</think>` style tags from
visible text and surface their contents as `raw`. Replay-only fields (Gemini `thoughtSignature`,
OpenRouter `reasoning_details`, DeepSeek `reasoning_content`) may go back to the vendor inside a
tool loop, but never into thought logs or Discord messages.

## 6. Add guild MCP declarations to the tool adapter

Tool definitions come from `getAvailableToolsWithMCP()`, and `ToolRegistry.executeTool()` dispatches
both built-in and guild MCP calls, so the adapter needs no registration. Its `getAllToolsIn*Format()`
must still add guild MCP tools (registered through `/config` > Plugins > MCP Servers): when
`serverId && allowedMCPFunctions`, call `getGuildMcpManager().getGuildMCPTools(serverId)`, keep only
the declarations in `allowedMCPFunctions`, convert them, and append. Without this step the model
never sees guild tools.

## 7. Implement optional capabilities

Features such as embeddings, structured output, preset generation, compaction, expression
initialization, and history extraction run outside the chat stream. For each `featureSupport` flag you
set to `true`, implement the matching interface from `src/types/provider/featureInterfaces.ts` on the
provider class. Routing goes through `src/utils/provider/providerCapabilityResolver.ts` and
`src/providers/utils/providerFeatureExecutors.ts`.

| Feature | What to build |
|---|---|
| Structured output | `callStructuredJSON()` for the mode the vendor supports: strict `json_schema`, or `json_object` with the schema injected into the prompt and validated with Zod. Examples: `googleStructuredOutput.ts`, `deepseekStructuredOutput.ts`, `zaiStructuredOutput.ts`. |
| Compaction | `compactGenerator.ts` exporting `generateConversationSummary{Provider}()` (plain text, no `response_format`) and `generateRoleplaySummary{Provider}()` (structured). Import `buildRoleplaySchema()` and `CompactRoleplaySummarySchema` from `src/providers/utils/compactCommon.ts`. Implement `SupportsConversationCompaction`. |
| Preset generation | `presetGenerator.ts` exporting `generatePresetFromPrompt{Provider}()`. See below. |
| Image generation | Only when the app has a native path for the vendor. Seed `image_diffusion_models` only for wired models. |
| Embeddings | Only with a real embedding API. Check dimensions, batching, and input limits, then seed `embedding_models`. |
| Thinking level | Map the `thinking_level` setting (`/config` > Models > Text Samplers & Parameters) to a verified request field, or document a deliberate no-op in `docs/en/architecture/subsystems/thinking-level.md`. Never invent a request field for a vendor that only has startup flags. |
| Live cost | A minimal non-streaming probe that reads prompt-token usage from the response. Prices come from `inputPricePerMillion` and `outputPricePerMillion` on the model's catalog row. |

Preset generation details:

- Use the helpers in `src/providers/utils/presetCommon.ts`: `buildPresetResponseSchema()`,
  `buildPresetPrompt()`, `buildToolErrorResult()`, and the `Preset*` types.
- Parse the response with `extractPresetGenerationFields(responseText, parse)`. It repairs output the
  token limit truncated and enforces the 6-attribute and 5-pair contract, so do not re-implement
  either. Map its `PresetFieldFailure` with `presetGenerationFailureErrorType()` and
  `presetGenerationFailureMessage()`. A tool-call provider that already holds a decoded object calls
  `validatePresetGenerationFields()` directly.
- Where strict schema support depends on the model, try `json_schema` and retry with `json_object` on
  a 400 or 422, as NVIDIA does.
- Run the tool loop up to `options.maxToolRounds`, building tools with `getAvailableToolsWithMCP()`.
- Two providers on one endpoint family (Z.ai and Z.ai Coding) share one generator parameterized by
  `endpointUrl` and `toolAdapter`.

Reasoning models that reject `temperature` need a guard before the request in both compaction and
preset generation (DeepSeek reasoner, Z.ai GLM reasoning models).

## 8. Seed the models

Add rows to the typed catalog in `src/db/seed/catalog/models.ts`. There is no SQL seed file;
`seedModelsFromCatalog()` upserts the catalog on every startup. Capability flags default to `false`,
so list only the true ones:

```ts
{ provider: "google", codename: "gemini-3.5-flash-lite", isDefault: true, hasTools: true,
  seesImages: true, seesVideos: true, seesYoutube: true, supportsStructoutput: true,
  desc: "Balanced model…", ja: "汎用…" },
```

| Catalog section | Table | Needed when |
|---|---|---|
| `llmSections` | `llms` | Always |
| `imageSections` | `image_diffusion_models` | Native image generation |
| `videoSections` | `video_generation_models` | Native video generation |
| `embeddingSections` | `embedding_models` | Embeddings |

Set `hasTools` and `supportsStructoutput` per model, only for models you tested. To retire a model
set `isDeprecated: true`; to remove it, delete the row.

Set `contextWindow` and `maxOutputTokens` from the vendor's official docs. Without a window, history
truncation is skipped and a long channel fails with a context-length error instead of trimming. Add the
provider to `LIMIT_REQUIRED_PROVIDERS` in `modelSeed.ts` so a future row cannot forget them.

The seeder throws before any write, and `bun run check-seed-catalogs` fails offline, unless each
provider has exactly one non-deprecated `isDefault`, `llms` has exactly one non-deprecated
`isSmartest` per provider, and `(provider, codename)` is unique per table. The `custom` provider is
exempt.

## 9. Check the vendor contract

Test the vendor's actual request and response shapes. "OpenAI-compatible" does not guarantee any of
these:

- Tool calls: test the full loop of assistant, tool call, tool result, and assistant continuation. A
  vendor can emit the first tool call correctly and still reject the tool result.
- Reasoning mode: fields that must be replayed inside one turn. DeepSeek keeps `reasoning_content`
  across tool sub-turns but not across chat turns. Z.ai's thinking mode drops `temperature`, `top_p`,
  and the penalties.
- Assistant prefill: whether it needs a beta endpoint, a trailing assistant message, or a flag such as
  `prefix: true`.
- Parameters: whether reasoning models reject `temperature`, `top_p`, or logprob settings. Strip them
  in the provider.

## 10. Update help text

- The `/help` API Keys catalog in `src/utils/discord/helpProviderGuides.ts`, and its copy in
  `src/locales/en-US/`.
- The `/config params` provider lists in `src/locales/en-US/`. List a provider under a parameter only
  when that saved setting reaches its runtime.
- Setup Step 1 in `src/utils/discord/helpCatalog.ts` if onboarding changes.

## 11. Verify

Run the bot against the real provider. Add automated tests only for code with its own regression risk,
such as a response parser or error mapping (see [Tests](/contributing/development-tasks/#tests)).

- [ ] The provider is discovered at startup and its aliases resolve.
- [ ] `/providers` saves and validates a key, and provider errors read correctly.
- [ ] `/config` > Models > Switch Models lists the seeded models.
- [ ] Chat streams.
- [ ] Each supported feature works: tools with continuation, structured output, history extraction,
      prefill, `/tool estimate cost`.
- [ ] Unsupported features fail with a clean message, and feature-gated commands match
      `featureSupport`.
- [ ] `bun run check` and `bun run lint` pass; `bun run check-locales` if locale files changed.

## Related files

- `src/types/provider/interfaces.ts`, `src/types/provider/featureInterfaces.ts`
- `src/utils/provider/providerFactory.ts`, `src/utils/provider/providerInfoRegistry.ts`
- `src/utils/provider/providerCapabilityResolver.ts`, `src/providers/utils/providerFeatureExecutors.ts`
- `src/db/seed/catalog/models.ts`, `types.ts`, `modelSeed.ts`
