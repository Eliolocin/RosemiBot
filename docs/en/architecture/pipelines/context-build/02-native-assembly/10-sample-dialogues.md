---
title: "02.10: Sample Dialogues"
---

The sample dialogues contributor emits few-shot example turns from persona configuration to demonstrate speaking voice and dialogue cadence.

## Flow and ownership

The contributor `buildSampleDialogueContextItems` in `src/utils/text/context/templates.ts` maps paired example arrays to structured context items:

1. **Eligibility**:
   - Returns an empty array during user impersonation, when persona state is missing, when either `sample_dialogues_in` or `sample_dialogues_out` is empty, or when array lengths do not match.
2. **Turn transformation**:
   - **User example**: When the user prompt matches `UNPAIRED_SAMPLE_DIALOGUE_SENTINEL`, the user turn is omitted and only the model turn emits. Otherwise, the turn text passes through humanization (if enabled), mention conversion, and uncensor transforms, and emits as a `user`-role item tagged `DIALOGUE_SAMPLE`.
   - **Model example**: Ensures the bot name prefix (`${botName}: `) is present on the model output. The text passes through humanization, mention conversion, and uncensor transforms, and emits as a `model`-role item tagged `DIALOGUE_SAMPLE`.
3. **Humanizer handling**:
   - At `humanizer_degree >= HumanizerDegree.HEAVY`, both turns pass through `humanizeString` with `suppressPunctuationNoise: true`. This applies casing normalization and semicolon stripping while keeping commas and quotes intact as stable few-shot syntax examples.

## Constraints and rationale

- **Impersonation suppression**: Sample dialogues demonstrate the bot persona's voice and are suppressed during user impersonation.
- **Preset reassembly and terminal spacer**: Tagged as `DIALOGUE_SAMPLE`, which SillyTavern preset reassembly maps to the `dialogueExamples` marker. If a custom preset configuration places sample dialogues at the terminal position of the assembled prompt, `presetContextBuilder.ts` appends a terminal warning notice to prevent models from mistaking the example dialogue for the active conversation turn.

## Source pointers

- `src/utils/text/context/templates.ts`: `buildSampleDialogueContextItems`.
- `src/utils/text/processors/formatters.ts`: `humanizeString` formatting.
- `src/utils/text/presetContextBuilder.ts`: `dialogueExamples` mapping and terminal spacer.
