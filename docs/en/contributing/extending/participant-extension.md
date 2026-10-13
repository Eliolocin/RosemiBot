---
title: "Adding a Participant Source or Profile Enricher"
sidebar:
  order: 10
aiGenerated: true
---

How to add participant identities or profile fields from a new integration without changing reply
routing, core hydration, or the prompt renderer. Both are compile-time contracts, registered in
code.

## Choose the contract

| Contract | File | Use when | Receives | Returns |
|---|---|---|---|---|
| `ParticipantSource` | `src/utils/text/participants/sources.ts` | The integration contributes identities | Visible participant input, persona catalog, reference plan, abort signal | Typed candidate keys, inclusion reasons, aliases, evidence |
| `ParticipantProfileEnricher` | `src/utils/text/participants/profileEnrichers.ts` | The integration adds display lines to a hydrated profile | Frozen identity snapshot, persona scope, privacy-filtered core fields, abort signal | Fields only; core adds the owner key and order |

## Register

Every contribution declares `ContributionMeta`:

```ts
const meta = {
  id: "example.badges",
  owner: "example-integration",
  source: "src/integrations/example/participantBadges.ts",
  order: 300,
  criticality: "optional",
  after: ["core.profile-fields"],
} as const;
```

IDs are case-normalized and unique per registry; a duplicate fails and names both owners. `after` and
`before` must name existing IDs without cycles. Order is resolved by dependencies, then `order`, then
ID, so registration order never changes output.

```ts
const sourceRegistry = createParticipantSourceRegistry([{ source: exampleSource }]);
const profileEnricherRegistry = createParticipantProfileEnricherRegistry([{ enricher: exampleEnricher }]);

const prepared = await prepareParticipantContext({ ...input, sourceRegistry, profileEnricherRegistry });
```

`buildContext()` accepts only a `PreparedParticipantContext`, which carries the enricher registry into
hydration, so no renderer change is needed.

## Security rules

- Sources cannot schedule replies: routing state is not in their input or output.
- Non-core sources cannot add a bot key or the `active_identity` reason.
- Each alias must belong to its candidate's exact typed key.
- Mentionability is a `ParticipantCapability` that only core grants. A new source gets none, even for
  a Discord user key.
- Enrichers cannot replace identity, aliases, mentionability, privacy decisions, or another owner's
  fields. Their field kinds must use the `extension:{contribution-id}` namespace; emitting a
  privacy-owned core kind fails the contribution.
- Deduplication, alias collisions, exposure policy, and rendering stay in participant core.

## Failures and timeouts

A source or enricher is aborted after 1500 ms (`SOURCE_TIMEOUT_MS`, `ENRICHER_TIMEOUT_MS`). An
optional contribution that fails or times out records a diagnostic and adds nothing. A critical one
throws `ContributionExecutionError` with its ID, owner, source, status, and cause. Diagnostics and
metrics hold contribution IDs and aggregate counts and durations, never participant IDs, aliases, or
message content.

## Tests

- Order is the same when registration order is reversed.
- Duplicate IDs, unknown dependencies, and cycles fail before anything runs.
- Optional failures, timeouts, and critical failures follow their declared policy.
- Source candidates keep their typed identity and cannot gain mentionability.
- Enricher output keeps the identity, core privacy fields, and order.
- The rendered participant golden output does not change.

Then run `bun run check`, `bun run lint`, `bun run audit-comments`, and `bun run test`.
