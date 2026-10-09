---
title: "02.9: Conditioning"
---

The conditioning contributor injects feedback memories detailing behaviors the persona was thanked or corrected for in past interactions.

## Flow and ownership

The contributor `buildConditioningContextItem` in `src/utils/text/context/templates.ts` formats reinforcement feedback for the persona:

1. **Eligibility**:
   - In `nativeBuilder.ts`, the stage is skipped during user impersonation, when `serverId` is missing, when `persona_lineage_id < 0`, or when neither reward nor punish conditioning is enabled on the persona.
2. **Database retrieval**:
   - Queries `conditioningMemoryRepository.loadGroupsForPersona(serverId, personaLineageId, type)` for `"reward"` and `"punish"` feedback.
   - Filters out entries with blank reason text.
   - Caps each category to `CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE` groups.
3. **Formatting and emission**:
   - Groups format with action past participles (`getConditioningContextPastParticiple`), triggerer user mentions, reasons, and repetition counts:
     - `## Rewarded Behaviors`: "Here are past things {botName} did that got rewarded for. Strive to do them again:"
     - `## Punished Behaviors`: "Here are past things {botName} did that got punished for. Avoid doing them again:"
   - Passes assembled sections through `convertMentions`.
   - Emits a single `system`-role item tagged `KNOWLEDGE_SERVER_CONDITIONING`. If both sections produce zero groups, returns `null`.

## Constraints and rationale

- **Feedback isolation**: Conditioning is persona-lineage scoped. It reinforces character consistency across server turns without bleeding feedback across distinct personas.
- **Impersonation suppression**: User impersonation turns suppress conditioning so that past bot critiques do not bias the imitated user persona.
- **Preset reassembly**: Tagged as `KNOWLEDGE_SERVER_CONDITIONING`, which SillyTavern preset reassembly flushes before the first dialogue anchor (`dialogueExamples` or `chatHistory`).

## Source pointers

- `src/utils/text/context/templates.ts`: `buildConditioningContextItem`.
- `src/utils/db/repositories/ConditioningMemoryRepository.ts`: `loadGroupsForPersona`.
- `src/utils/conditioning/conditioning.ts`: `CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE` and past-participle mappings.
- [03: Server Memories](/architecture/pipelines/context-build/02-native-assembly/03-server-memories/): companion persistent memory contributor.
