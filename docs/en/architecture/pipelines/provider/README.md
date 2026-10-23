---
title: "Provider Pipeline"
sidebar:
  label: "Overview"
  groupLabel: "Provider"
  order: 400
aiGenerated: true
---

The provider pipeline streams an LLM response from a provider API to Discord messages. It coordinates
request construction, text processing, safety guards, delivery timing, and stop signals between the
HTTP stream and Discord's message API.

The pipeline starts from the tool loop stage [`streamOnce`](/architecture/pipelines/tool-loop/01-stream-once/)
via `LLMProvider.streamToDiscord()`. That facade constructs a provider-specific `StreamAdapter` and
a `StreamConfig`, then delegates to `StreamOrchestrator.streamToDiscord()`.

## Optional Decision capability

`SupportsDecisions` extends the optional capability map and resolver. `OpenrouterProvider` and
`CustomProvider` own its implementations; other providers remain unsupported.
`llmModelRepo.loadDecisionModelOptions(scope)` returns `DecisionModelOption`
records. Consumers persist their `reference`: `provider`, `modelId`, nullable `registrationId`, and
nullable `customEndpointId`. Global native entries have null registration IDs. Scoped native entries
carry their exact scoped registration ID. Custom entries use `custom:<connection_id>` and the exact
endpoint row ID, with a null native registration ID. Deletion and re-registration invalidate old
references even when a codename repeats.

`callDecisionsForProvider({scope, reference, evidence, questions, abortSignal?, onUsage?})` rechecks ownership,
the exact registration, saved credentials, and the stored custom protocol. Null selection returns
`unavailable/not-selected`. Evidence is text; questions are `{type: "predicate", id, instructions}`.
IDs are unique application-owned identifiers, start with a lowercase letter, contain lowercase
letters/digits/underscores, and have at most 64 characters. Requests admit 1-64 questions. Rubrics,
thresholds, calibration, and response routing belong to consumers.

| Transport | Translation |
|---|---|
| Native OpenRouter | `/api/alpha/decisions`: text `state`, named `noul` questions and answers |
| Custom System One | `POST <stored-base>/systemone`: the same named `noul` protocol |
| Custom OpenAI Decisions | `POST <stored-base>/decisions`: text `input`, ordered predicates and predicate/refusal answers |

Results distinguish `completed`, `refused`, `cancelled`, `invalid-input`, `unavailable`, and `failed`.
Completed/refused results carry ordered typed answers, optional actual usage/cost, local correlation,
bounded provider request identity, and returned model ID. Probabilities must be finite in [0, 1].
Missing/extra/duplicate answers, wrong types/order, invalid usage, and explicit evidence truncation
fail validation. Partial OpenAI refusals return `refused`. No chat or prose interpretation is used.

`onUsage` receives validated usage before answer validation. A malformed verdict or cancellation
after response decoding retains reported spend. Routing records this callback once, including
responses settling after its deadline, without accepting their late verdict. Missing or invalid
usage stays unknown; raw HTTP error bodies are discarded without parsing private prose.

Requests compose caller cancellation with the existing `STREAM_SDK_CALL_TIMEOUT_MS` policy. Responses
are bounded to 1 MiB. Until callers need a model-specific tokenizer, the serialized request's UTF-8
byte count must fit its documented input-token ceiling. This conservative admission rule can reject
otherwise fitting requests and never truncates evidence. Custom calls retain the SSRF gate and pinned
fetch. Discovery checks explicit Decision output modality, finite prices, and documented input limits.
Only OpenRouter receives global seeds; seeding does not select a model or activate a drafting gate.

INFO traces contain protocol, numeric model/registration identities, correlation, counts, elapsed
time, outcome, and actual usage/cost when supplied. They omit evidence, question text, caller labels,
raw bodies, credentials, and endpoint URLs. Operational failures emit one sanitized ERROR where their
cause is known, with stage/category and optional HTTP status in existing `ErrorContext` metadata.
`failed.errorLogged` is true, so recovery must not log the failure again. Cancellation, valid refusal,
missing selection, and rejected input are expected outcomes. The existing logger hides INFO under
`RUN_ENV=production` unless `TEST_PRODUCTION=true`; ERROR retains production visibility, persistence,
and ambient workspace/turn context.

Protocol references: [OpenRouter Decisions](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request),
[System One](https://docs.typesafe.ai/api), and
[OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions).

## Usage reporting and request denial

`src/utils/provider/providerUsage.ts` owns optional usage reporting and request-denial translation.
`ResolvedCredentials.usageContext` carries request ownership through auxiliary requests, tool calls,
and stream contexts. `ProviderUsageContext` is a branded interface that deployment modules augment
through TypeScript declaration merging. Keep the same context object through a request: denial
matching uses object identity, so a nested request cannot claim another request's refusal.
`withProviderUsageContext` binds that owner for the duration of provider work, including awaited
adapter calls. The release spend guard reads this context at admission, so concurrent scopes sharing
one member key cannot replace each other's request owner; a nested operation binds its own context.

Callers report provider usage once per completed provider response, or pass
`createProviderUsageRecorder(context, model)` as the provider's `onUsage` callback. Reports preserve
reported cost, tokens, and provider request identity; they do not estimate missing charges. Job
polling reports the final job identity once at the caller. A registered reporter owns persistence and
deduplication. Reporting does not await storage, and reporter failures cannot fail inference.
Without a reporter, reporting does nothing.

`ProviderRequestDeniedError` carries its context and a locale-dependent renderer. The renderer returns
a title locale key and localized description, and accepts a flag for fallback notices. A registered
translator can turn a provider failure into this error using the failed request's context.
`findProviderRequestDeniedError` searches both `cause` and `originalError`, checks ownership before
translation, and never translates a denial belonging to another context. Omit the context argument only
for credential resolution or an already-scoped error propagating to its presentation owner. An
explicit undefined context matches only an unscoped denial.
Check for denials before credential-specific and generic handling. `deferNotice` lets the stream
state machine leave a notice to the retry owner rather than posting it before fallback completes.

OpenRouter limit classification uses `error.metadata.limit_source`. A member-key rejection can also
include a minimum balance for image or video output, even when the generation price fits the remaining
allowance. The Subscription translator preserves that numeric minimum for the notice, which directs
the user to choose another model. Provider prose stays out of the notice; allowance caps and fallback
ownership still apply.

Commands and streams render `getProviderRequestFailureCopy`. Tools use
`notifyProviderToolFailure`, which returns the description and posts the same notice to the channel.
User impersonation returns the description without posting. Channel-send failures preserve the
returned tool error. `StreamingContext` copies usage context through `buildStreamContext` so stream
error handling sees the same owner as its caller.

These entry points intentionally have no in-tree reporter, translator, or denial producer on main.
The release branch registers deployment implementations and supplies contexts during credential
resolution, including paths that main still serves through direct key decryption. This is an
exception to the dead-code rule: the release branch is a real consumer of this shared contract.
Registration belongs at startup; each registration returns a disposer that restores the previous
handler, which also lets tests isolate their registrations.

## Request holds

`src/utils/provider/providerRequestHook.ts` owns the optional request hook. A registered hook returns
an optional hold for one provider request: `reportCost` settles the request's reported cost, and
`release(retainEstimate)` ends the hold, counting the initial estimate as spent when `retainEstimate`
is set and no cost arrived. The stream adapter and the job-based adapters call `beginProviderRequest`
before the HTTP call, report each cost the provider or the job reports, and release the hold on
completion or failure. HTTP errors and pre-send aborts report zero; an in-flight failure releases
the hold without retaining an unreported estimate. Already-reported costs survive release.
With no hook registered,
`beginProviderRequest` returns no hold and each adapter sends exactly the request it sent before.

`fetchWithProviderRequest` wraps the one-shot POST JSON callers. With no hook registered it calls the
underlying fetch directly, with no body buffering. With a hook, it begins a hold from the bearer key,
the URL path, and the parsed body; reads the response through the bounded reader; reports the JSON
response's `usage.cost`; and returns an equivalent response so callers still read the body. Callers
that need a gated transport pass it as the third argument. Hooks must never log the API key, path, or
body. A registered hook also disables the OpenRouter adapter's verbose fetch output, because that
output can print the headers and body the hook accounts for.

The hook has no in-tree implementation on main. The release branch registers its deployment
implementation at startup, and the registration returns a disposer like the usage and denial ones.

## Provider options

`src/utils/provider/providerOptionRegistry.ts` owns the optional extra entries the provider panels,
setup wizard, and model views can offer beside the built-in providers. Built-in providers keep their
existing code paths: every surface asks the registry first and falls through unchanged when nothing
is registered. Registration returns a disposer, and no option is registered in-tree on main.

An option declares its stored provider value, the provider catalog its models come from, the
capabilities it serves, and the copy keys every surface renders. Its `availability` decides whether
the workspace or user can use it and supplies the locale key that explains a refusal. Its `selection`
hooks own the payer state: `load` reports a stored selection the panel can show, `ensure` creates one,
`owns` answers which capabilities that payer currently holds, `claim` and `release` move a capability
between payers, `validateModel` refuses a model the payer cannot serve, and `remove` deletes the
stored selection. `setSpeech` writes speech selection and registration under the option's payer;
its input preserves scope, mode and replacement identity. Hosted speech registration resolves the
catalog separately and sends option writes to this callback, so personal options can store selections
without built-in credentials. Built-in speech writes keep using the speech repository.
The registry never adds storage of its own.

An option's panel `handleAction` owns interaction acknowledgement. It may show a modal immediately,
or acknowledge before awaiting its lazy `loadSelection()` callback, which loads the scope and edit
entry. Returning false repaints an acknowledged interaction or sends a refusal on an unacknowledged
one. Setup acknowledges option selection before awaiting readiness and component rendering.
Setup rendering passes `actionRouteId`, which an option's components can use for one control. The
setup route acknowledges that press, awaits `setup.handleAction`, and repaints the wizard with the
receipt it returns.

Surfaces resolve an option through `findProviderOption` before treating a provider value as a
built-in one. `getProviderDisplayName` resolves the option's `copy.labelKey`, and
`loadConfigModelChoices` loads models from its `catalogProvider`. Model views attribute a slot to
the option only while its `owns` answers for that capability, so the same model ID under the catalog
provider and under the option stay distinct.
`claimProviderModelSelection` records ownership after a successful selection write, and
`clearProviderModelSelection` releases it when a slot is emptied. Built-in selections release the
previous option's marker even when the new model comes from another catalog. Removing a built-in
server provider checks text ownership the same way, so a catalog provider whose models an option
pays for is not reported as the active payer. The model-write
wrapper runs `onWritten` after every successful model write, including failed or throwing ownership
updates, so callers can invalidate cached state.

Deployment behavior maps onto these fields:

| Behavior | Field |
|---|---|
| Stored provider value | `value` |
| Models sourced from an existing catalog | `catalogProvider` |
| Capabilities offered and panel sections exposed | `capabilities` |
| Scope eligibility and refusal copy key | `availability` |
| Stored payer presence for the panel entry | `selection.load`, `selection.ensure` |
| Capability ownership read, write, and clear | `selection.owns`, `selection.claim`, `selection.release` |
| Model admission and refusal | `selection.validateModel` |
| Payer-aware speech selection and registration | `selection.setSpeech` |
| Removing the stored selection | `selection.remove` |
| Panel entry, description, and removal copy | `copy.labelKey`, `copy.entryDescriptionKeys`, `copy.removeImpactKey` |
| Panel select action and its copy | `copy.addActionLabelKey`, `copy.addActionDescriptionKeys`, `panel.handleAction` |
| Panel entry buttons and extra components | `panel.entryActions`, `panel.entryComponents`, `panel.entryOwned` |
| Model option description | `copy.modelDescriptionKey` |
| Setup option, summary, receipt, onboarding, and commit | `setup.optionLabelKey`, `setup.optionDescriptionKey`, `setup.summaryKey`, `setup.receiptDescriptionKey`, `setup.available`, `setup.ready`, `setup.components`, `setup.committed` |
| Setup onboarding control | `setup.handleAction` |

One deployment-managed behavior stays outside the registry because main has no field for it: a
fallback ref's payer tag. A deployment that needs it keeps that tag on its own branch, where
`src/types/db/schema.ts` and the fallback identity helpers already differ.

## Read order

1. [Overview](/architecture/pipelines/provider/): pipeline structure and entry points
2. [01: Context Assembly](/architecture/pipelines/provider/01-context-assembly/): translating structured context into provider requests
3. [02: Raw Chunk Generation](/architecture/pipelines/provider/02-raw-chunk-generation/): opening HTTP streams, transport degradation, and raw chunks
4. [03: Chunk Normalization](/architecture/pipelines/provider/03-chunk-normalization/): mapping raw chunks, extracting reasoning, and normalizing errors
5. [04: Orchestrator State Machine](/architecture/pipelines/provider/04-orchestrator-state-machine/): driving the generator loop, routing chunks, and handling stops
6. [05: Buffer Management](/architecture/pipelines/provider/05-buffer-management/): accumulating text, protecting markdown blocks, and flushing boundaries
7. [06: Segment Normalization](/architecture/pipelines/provider/06-segment-normalization/): cleaning text, resolving mentions, render modifiers, and speaker guards
8. [07: Discord Delivery](/architecture/pipelines/provider/07-discord-delivery/): message chunking, typing simulation, webhook routing, and rate limits

## Stage flow

```
tool loop pipeline -> LLMProvider.streamToDiscord()
                            |  (builds StreamConfig + StreamAdapter)
                            v
                    [Stage 01] startStream: Context assembly
                            |  contextItems -> provider-native payload
                            |  tools, history replay, stop strings
                            v
                    [Stage 02] startStream: Raw chunk generation
                            |  HTTP stream open -> yield RawStreamChunk
                            |  parameter degradation, speaker tail holdback
                            v
                    [Stage 03] processChunk: Chunk normalization
                            |  RawStreamChunk -> ProcessedChunk
                            |  (text, function_call, error, done, thoughts)
                            v
                    [Stage 04] executeStream: Orchestrator state machine
                      for-await loop -> checks stop signals and heartbeats
                            |
                       +----+-------------------------------------------+
                       | type="text"          | type="function_call"    | type="done"
                       v                      v                         v
               [Stage 05]               flush buffer -> return      record terminal
           processTextChunk          { status: "function_call" }   metadata; continue
            Buffer management
                       |
                       v
               [Stage 06]
           sendBufferSegment
            Segment normalization
            (clean, mentions, guard)
                       |
                       v
               [Stage 07]
            sendSegment ->
          sendSinglePayload
            Discord delivery
          (webhook / channel,
           typing simulation)
                       |
                       v
             StreamResult
           { status, accumulatedText,
             thoughtLog, detailsContent }
                       |
                       v
              tool loop pipeline
```

## Stage index

| File | Stage | Code symbol | Primary ownership |
|---|---|---|---|
| `01-context-assembly.md` | 1 | `BaseStreamAdapter.startStream` (setup) | Native request construction |
| `02-raw-chunk-generation.md` | 2 | `BaseStreamAdapter.startStream` (generator) | HTTP streaming and parameter degradation |
| `03-chunk-normalization.md` | 3 | `BaseStreamAdapter.processChunk` | `RawStreamChunk` to `ProcessedChunk` conversion |
| `04-orchestrator-state-machine.md` | 4 | `StreamOrchestrator.executeStream` | Chunk routing, stop signals, and `StreamResult` assembly |
| `05-buffer-management.md` | 5 | `StreamBufferFlusher.processTextChunk` | Text accumulation, block holds, and boundary flush |
| `06-segment-normalization.md` | 6 | `StreamSegmentProcessor.sendBufferSegment` | Text cleaning, mentions, render modifiers, and prefill |
| `07-discord-delivery.md` | 7 | `StreamMessageDelivery.sendSegment` | Discord API calls, typing simulation, and webhooks |

## Cross-references

- **Direct caller:** [tool loop Stage 01 `streamOnce`](/architecture/pipelines/tool-loop/01-stream-once/):
  entry point invoking `LLMProvider.streamToDiscord()`.
- **Upstream caller:** [chat per-turn Stage 03 `runGenerationTurn`](/architecture/pipelines/chat/06-per-turn/03-run-generation-turn/):
  coordinates model and key fallback loops.
- **Result consumer:** [tool loop Stage 04 `buildResult`](/architecture/pipelines/tool-loop/04-build-result/):
  evaluates `StreamResult` and routes `accumulatedText` and `detailsContent` to short-term memory.

## Pipeline-wide concerns
<!-- anchor: pipeline-wide-concerns -->

### Provider identity and separation

Each provider defines `LLMProvider.streamToDiscord()` (such as `GoogleProvider` or `OpenrouterProvider`).
The method creates an adapter implementing `StreamProvider` and forwards execution to
`StreamOrchestrator`. Stages 01 to 03 are provider-owned, isolating API formats and transport
details. Stages 04 to 07 are orchestrator-owned and provider-agnostic.

### Stop and interrupt signals

The stop registry (`src/utils/discord/stream/stopRequests.ts`) tracks channel stop states checked on
every orchestrator iteration:

- **Graceful user stop** (`status: "stopped_by_user"`): a stop request observed in the loop flushes
  pending text before returning. `/kill` also aborts the active HTTP request and rejects the caller's
  stream race, so it can return immediately without this flush.
- **Follow-up interrupt** (`status: "follow_up_interrupt"`): triggered when a user sends a new
  message during generation. The buffer is discarded immediately so the chat pipeline can restart.
- **Internal stops** (`send_message_limit`, `flush_limit`, `speaker_guard`, `channel_deleted`,
  `missing_access`): skip buffer flushes to avoid duplicate rejections or outliving the turn.

### Delivery modes

`HumanizerDegree` from configuration sets delivery timing:

- `NONE` (0): aggregated mode. Text accumulates until a tool call, table attachment, or final flush,
  delivering in one batch.
- `LIGHT` or `MEDIUM` (1-2): streaming mode. Each segment sends as flushes occur, inserting
  interruptible typing simulation between messages.
- `HEAVY` (3): streaming mode with sentence-level splits and probabilistic comma and emphasis rolls.

### Persona and webhook routing

When `StreamContext.webhook` and `personaUsername` are set, stage 07 routes messages through
`sendWebhookMessageWithIdentity()`. The initial message of a webhook reply that references
`replyToMessage` sends a standalone reply notice via `sendWebhookReplyNotice()`.

### Reasoning and details capture

In-band `<think>` blocks are captured into `state.thoughtRawSegments` rather than sent to Discord.
At stream completion, stage 04 compiles them into `StreamResult.thoughtLog` for dedicated thought
logging. `<details>` blocks collect into `state.detailsSegments` and map to
`StreamResult.detailsContent` for short-term memory caching.

## Source pointers

- `src/types/stream/interfaces.ts`: `StreamProvider`, `BaseStreamAdapter`, `IStreamOrchestrator`, `StreamConfig`, and `StreamContext`.
- `src/utils/discord/stream/stateMachine.ts`: `StreamOrchestrator` implementation.
- `src/utils/discord/stream/stopRequests.ts`: channel stop registry.
