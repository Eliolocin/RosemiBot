---
title: "04: Build Result"
---

`buildResult` constructs the `GenerationTurnResult` at every termination point of `runToolLoop`. It
merges NovelAI scene metadata into the response text, packages persona response entries, resolves
thought-log ownership, and returns the result to `runGenerationTurn`.

## Result assembly and transformations
<!-- anchor: result-assembly-and-transformations -->

The stage packages accumulated iteration state into a standardized structure:

1. **Scene metadata suffix (`mergeDetails`):**
   NovelAI models can return structured scene metadata in `streamResult.detailsContent`. When present,
   `mergeDetails` appends this metadata below the model response text under a `[Scene Metadata]` header.
   The merged text is a short-term-memory payload. The scene metadata is separated from the
   visible streaming buffer during chunk normalization, so Discord users never see it in the channel.

2. **Persona response packaging (`personaResponses`):**
   When the merged response text is non-empty, the stage creates a single `ChatPersonaResponse`
   containing the current persona's nickname, text, persona ID, and lineage ID. When no text was produced
   (such as an error before generation, or a turn that delivered an expression only), `personaResponses`
   is an empty array.

3. **Thought-log identity resolution (`resolveThoughtLogOwner`):**
   If an iteration emitted a thought log, `resolveThoughtLogOwner` identifies the authoring entity for
   UI rendering:
   - User impersonation (`isUserImpersonation: true`): maps to `{ type: "user_impersonation", username, avatarUrl }`.
   - Alter persona (`currentPersona.is_alter: true`): maps to `{ type: "persona", persona: currentPersona }`.
   - Default persona: maps to `{ type: "default" }`.
   If no thought log was produced, `thoughtLogOwner` remains `undefined`.

4. **Direct delivery tracking (`toolResponseDelivered`):**
   The stage records whether a tool delivered output directly to the channel. When an expression was
   sent without additional assistant text, `personaResponses` is empty while `toolResponseDelivered`
   is `true`. Downstream consumers use this flag to recognize the turn as completed rather than
   treating the empty text as an unexpected failure.

## Handoff to the chat pipeline
<!-- anchor: handoff-to-the-chat-pipeline -->

The assembled `GenerationTurnResult` passes back up the chat pipeline:

1. **Attempt evaluation (`runGenerationTurn`):**
   `runGenerationTurn` inspects `result.status`. If the attempt ended in a retryable status (`error` or
   `timeout`) and fallback options remain, it deletes any partial Discord messages sent by this attempt
   via `purgeSupersededDeliveries` and retries with the next key or model.
2. **Delivery finalization (`responseSink.finalize`):**
   Once an attempt succeeds or fallbacks are exhausted, `runGenerationTurn` sends fallback model notices
   if applicable and invokes `responseSink.finalize(result)` to conclude Discord message streaming.
3. **Post-turn effects (`runPostTurnEffects`):**
   The root chat handler (`tomoriChat`) receives the result and runs post-turn effects:
   - Appends `result.personaResponses` to short-term memory dialogue history.
   - Records expression usage statistics.
   - Handles empty-response retries, quota accounting, thought logs, and boomerang follow-ups.

## Constraints and invariants
<!-- anchor: constraints-and-invariants -->

- **Pure assembly:** `buildResult` performs no network, database, or cache I/O. It transforms in-memory
  iteration state into the final turn result.
- **Complete history:** `streamResults` preserves every `StreamResult` object produced across all
  iterations, giving diagnostic loggers the complete record of intermediate tool attempts.
- **Distinguishable outcomes:** Consumers treat empty `personaResponses` with `toolResponseDelivered: true`
  as a successful expression delivery, distinct from an unhandled empty response or a skipped turn.

## Source pointers
<!-- anchor: source-pointers -->

- `src/utils/chat/toolLoop.ts`: `buildResult`, `mergeDetails`, `resolveThoughtLogOwner`.
- `src/utils/chat/generationTurn.ts`: `runGenerationTurn`.
- `src/utils/chat/types.ts`: `GenerationTurnResult`, `ChatPersonaResponse`.
- `src/utils/chat/postTurnEffects.ts`: `runPostTurnEffects`.
