---
title: "Context-Build Pipeline"
sidebar:
  label: "Overview"
  groupLabel: "Context Build"
  order: 200
---

The context-build pipeline assembles system messages, memories, persona instructions, sample dialogues, and recent conversation turns into structured context items for an LLM provider.

The public entry point is `buildContext` in `src/utils/text/contextBuilder.ts`, which delegates to `src/utils/text/context/builder.ts`.

## Flow and routing

Context assembly follows a two-tier structure:

```
buildContext(BuildContextParams)
  │
  ├─ if SillyTavern preset active and not impersonation:
  │     buildContextNative(...)
  │     reassembleWithPreset(nativeOutput, presetData, ...)
  │     resolveRandomChoiceMacrosInBuildOutput(...)
  │     → preset-reassembled result
  │
  └─ else:
        buildContextNative(...)
        resolveRandomChoiceMacrosInBuildOutput(...)
        → native result
```

Native assembly always runs first. If a SillyTavern preset is active for the server and the current turn is not a user impersonation, the pipeline passes the native items into `reassembleWithPreset` in `src/utils/text/presetContextBuilder.ts` to arrange them into preset sections. Otherwise, the native build is returned directly.

Both paths finish by passing the assembled output through `resolveRandomChoiceMacrosInBuildOutput`, which resolves `{{random:a::b}}` and `{random::a::b}` choices across all emitted text.

## Stages

| Stage | Path | Purpose |
|---|---|---|
| 01 | [Preset Routing](/architecture/pipelines/context-build/01-preset-routing/) | Selects native fixed-order assembly or SillyTavern preset reassembly. |
| 02 | [Native Assembly](/architecture/pipelines/context-build/02-native-assembly/) | Assembles context items in a deterministic sequence. |

## Output contract

Directives and deferred short-term memory items pass through the return shape instead of appending directly to `contextItems`:

- `tailDirectives` hold instructions such as impersonation prefixes, stop requests, or manual system prompts.
- `lowerPriorityTailDirectives` hold guidance inserted before the latest dialogue pair.
- `uncensorDirective` holds stripped uncensor prompt injection text.
- `nudgeItem` and `memoryInjectionItems` provide short-term memory reminders and content blocks for dialogue-depth injection.
- `messageIdMap` maps compact media and reference IDs to Discord message IDs.

The chat pipeline's turn builder in [Build Context](/architecture/pipelines/chat/06-per-turn/01-build-context/) consumes this result, orders tail directives, and inserts positional items before passing the prompt to the [Provider Pipeline](/architecture/pipelines/provider/).

Media resolution runs per generation attempt after context build. The dialogue history contributor records capability-neutral `mediaDescriptors`, and `resolveMediaForModel` adapts attachments to the routed model's vision capabilities.

## Source pointers

- `src/utils/text/context/builder.ts`: routing wrapper and macro resolution.
- `src/utils/text/context/nativeBuilder.ts`: native fixed-order assembly.
- `src/utils/text/presetContextBuilder.ts`: SillyTavern preset rearrangement.
- `src/utils/text/context/types.ts`: build parameters and result contracts.
