---
title: "Testing Chat Changes"
sidebar:
  order: 30
aiGenerated: true
---

How to use the chat regression tests, which pin the decisions made before a provider is called: whether
the bot replies (`shouldBotReply()` in `src/utils/chat/replyDecision.ts`) and which personas answer, in
what order (`determineMatchingPersonas()` in `src/utils/chat/triggerProcessor.ts`).

```bash
bun test tests/regression/chat/
```

The tests need no Discord token, API key, or database. They build mock `Message`, `Client`, and
`TextChannel` objects with only the fields these functions read.

## Fixtures

Inputs are in `tests/regression/chat/fixtures/conversations.json` and expected results in
`expected-decisions.json` beside it. The fixtures cover a direct mention, deliberate `@trigger` mode
and its rejection of plain trigger words, an autochat channel assigned to an alter, multi-persona
ordering, and a persona webhook that must not trigger itself.

To add one:

1. Add the conversation to `conversations.json` with stable fake IDs (`user_004`, `channel_001`).
2. Add its expected decision to `expected-decisions.json`.
3. Run `bun test tests/regression/chat/`.

Each fixture protects one behavior. When you extract logic out of `tomoriChat.ts`, add fixtures that
call the new module directly. When you fix a chat bug, add its fixture in the same change.

Behaviors worth a fixture when a chat stage changes: tool-call routing (REST and MCP), multi-persona
order, webhook self-trigger suppression, empty mentions and malformed reply references, rate-limit and
cooldown rejection, and provider fallback or missing credentials.

`chat.regression.test.ts` has a skipped `[REGRESSION PROBE]` that inverts one expectation. Remove its
`.skip`, confirm it fails, and restore it to check that the tests still detect a wrong decision.
