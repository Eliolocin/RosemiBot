---
title: "02.6: Participants"
---

The participant contributor compiles all active conversation participants into a single structured context item detailing display names, mention handles, presence, roles, personal memories, reminders, persona self-tasks, and current conversation time.

## Preparation and hydration flow

Participant processing separates discovery from prompt rendering across two main phases:

```
prepareParticipantContext(sanitizedMessages, ...)
  │  (extracts seeds from visible authors, mentions, references, bridges)
  ▼
PreparedParticipantContext { discoveryPlan, seeds, matrixUsers, syntheticUsers, ... }
  │
  ▼
buildParticipantContextItem(params)
  │
  ├─ hydrateParticipantProfiles(seeds, activePersonaScope, ...)
  │    ├─ load user rows, privacy levels, blacklist status
  │    ├─ fetch member roles and presence details
  │    ├─ load personal memories (filtered by lineage and corpus tags)
  │    ├─ load user reminders and persona self-tasks
  │    └─ resolve unique mention handles and collision indices
  │
  ├─ renderParticipantPrompt(hydratedProfiles, ...)
  │    └─ pure text rendering of participant cards and time footer
  │
  └─ convertMentions(renderedText, ...)
       → StructuredContextItem (KNOWLEDGE_USERS_IN_CONVERSATION)
```

### Discovery preparation

Callers invoke `prepareParticipantContext` in `src/utils/text/participants/preparation.ts` before calling `buildContext`. Discovery inspects visible message authors, bridge webhooks, and explicit text references across the history window. It produces an ordered `ParticipantDiscoveryPlan` containing typed `ParticipantSeed` records.

A `ParticipantRequestScope` attached to the turn caches discovery results across multi-persona turns within the same request.

### Profile hydration

`hydrateParticipantProfiles` in `src/utils/text/participants/hydration.ts` receives seeds alongside an `activePersonaScope` (active persona ID, lineage ID, alter flag, and impersonation state). Hydration enriches each participant:

- **Discord member details**: Resolves display names, server roles, and live presence details (online status and current activity via `getUserPresenceDetails`).
- **Privacy and moderation**: Checks cached user privacy levels and blacklist status. Users with `PrivacyLevel.FULL` have custom nicknames and personal memories hidden.
- **Personal memories**: Loads persona-scoped personal memories from `personalMemoryRepository.loadForUserLineage`. When `memory_tagging_enabled` is active, memories are tag-filtered against `conversationCorpus`.
- **User reminders and persona tasks**: Loads pending reminders for human participants matching the active persona. Independently loads pending self-reminders (`self_reminder = true`) assigned to the active `persona_id`.
- **Mention handles**: Assembles alias catalogs (server nicknames, usernames, global names). Normalizes handles and detects collisions so that only unambiguous handles are recommended as ping handles.

### Prompt rendering

`renderParticipantPrompt` in `src/utils/text/participants/renderer.ts` formats the hydrated data into a single text block:

The renderer groups participant names, safe mention handles, recalled personal memories, and matching reminders into one block. It adds persona self-tasks separately and appends the current channel and time. Hydration decides what is safe to include; rendering formats that prepared data without further identity discovery.

## Constraints and rationale

- **Single context item**: All participants render inside a single `user`-role item tagged `KNOWLEDGE_USERS_IN_CONVERSATION`. Grouping participants prevents multiple disjoint system blocks from diluting model attention.
- **Collision-aware mention handles**: Aliases claimed by multiple participants are dropped from the recommended mention handles list. The model is instructed to clarify rather than emit an ambiguous ping.
- **Privacy enforcement**: Personal memories, pronouns, and physical appearance tags require at least `PrivacyLevel.MINIMAL`. Blacklisted users receive no memory recall or custom nickname expansion.
- **Reminder and task scoping**: User reminders require context membership and an active-persona match (main personas also match legacy unassigned reminders). Persona self-tasks require an exact active `persona_id` match and do not require human participant membership. Persona self-tasks are omitted during user impersonation.
- **Downstream target index**: The contributor attaches `participantTargetIndex` and a compatibility `conversationUsers` projection to the context item alongside text output. Downstream tool execution uses this index to resolve user parameters back to Discord snowflakes.
- **Preset reassembly**: Tagged as `KNOWLEDGE_USERS_IN_CONVERSATION`, which SillyTavern preset reassembly flushes before the first dialogue anchor (`dialogueExamples` or `chatHistory`).

## Source pointers

- `src/utils/text/context/participants.ts`: `buildParticipantContextItem`.
- `src/utils/text/participants/preparation.ts`: `prepareParticipantContext` and request-scope caching.
- `src/utils/text/participants/hydration.ts`: `hydrateParticipantProfiles` and privacy/memory loading.
- `src/utils/text/participants/renderer.ts`: `renderParticipantPrompt`.
- `src/utils/text/participants/targetIndex.ts`: `ParticipantTargetIndex` and downstream tool targeting.
