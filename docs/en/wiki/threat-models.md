---
title: "Threat Models"
---

Updated on: 2026-10-10

<!-- Evidence paths under `terraform/` and `deploy/` cited below live on the `release` branch and are
     absent from `main`. Read one with `git show release:terraform/aws/ecs-health-check.tf`. -->

## TL;DR

- **Stored provider keys cannot be read out through Discord.** Reads are scoped to the owner in SQL, no surface renders a key or a masked prefix, credential modals never prefill, and exports omit credential columns. See [Key custody](#key-custody).
- **The remaining key exposures need host or database access:** an opt-in heap snapshot, legacy backup bundles that hold `config.env`, the separate key archive, and anything that records database query parameters.
- **API keys are encrypted at rest** with `pgcrypto` (AES-256). A dump without the matching key versions is ciphertext only. The key and the secret still reach PostgreSQL as query parameters, and startup only warns about keys shorter than 32 characters.
- **Credentials stay with their host.** No download attaches the Discord bot token, and a saved endpoint key never follows a redirect to another origin. Editing an endpoint URL does send its stored key to the new URL.
- **TomoriBot starts no local MCP process.** MCP tools come from administrator-registered remote servers, which see tool arguments and results and do their own fetching.
- **SQL values are always parameters.** `ConfigRepository` still builds table and column names from typed arguments, so never pass it a request-shaped object.
- **Discord permissions are enforced per route.** `ManageGuild` on a command is only a registration default; the routes that matter re-check `memberPermissions`.
- **Model output is untrusted.** Prompt injection through memories, documents, web pages, and MCP descriptions is real, so execution code checks every tool call. Prompt text is shown only to members that `canViewPromptText` admits.
- **User-supplied URLs go through `validateRemoteUrl()`, `fetchUserRemoteUrl()`, or `safeDownload()`.** Crawl4AI's browser and administrator-selected remote MCP services fetch outside those guards.
- **Operators should set quotas and turn off feature flags they do not need.** Dispatch re-checks flags, so a stale call cannot run a disabled tool. Cross-channel reads have no flag, so restrict `/providers` and use the cross-channel blocklist.

---

## How to read this page

This page describes source on `main` and the deployment defaults committed on `release`. It does not verify the settings of any running deployment. It lists the known residual risks and trust assumptions from that review; it does not claim that no other vulnerabilities exist.

The tables use STRIDE, a checklist of six threat types: spoofing (posing as someone else), tampering (changing data or behavior), repudiation (denying an action), information disclosure, denial of service, and elevation of privilege. SSRF (server-side request forgery) means tricking the bot into requesting an address the attacker chooses, such as a cloud metadata service that hands out credentials. "Residual risk" is what remains after the control, including what an operator must assume or do.

Related pages: [Security & privacy](/architecture/subsystems/security/), [Tool loop](/architecture/pipelines/tool-loop/), [Matrix bridge](/architecture/integrations/matrix/bridge/), [Voice](/architecture/integrations/voice/), and [Production tuning](/wiki/production-tuning/) for heap profiling.

---

## 1. Database, secrets, key custody, and tenant isolation

PostgreSQL stores server configuration, personas, memories, API credentials, managed webhook tokens, Matrix links, custom endpoints, quota state, reminders, and caches.

### Key custody
<!-- anchor: key-custody -->

The production instance holds roughly a thousand registered provider keys across guilds and personal scopes, so key custody gets its own table.

| Path | Who can reach it | Control | Source | Residual risk |
| :--- | :--- | :--- | :--- | :--- |
| **Read a stored key through Discord** | Any member or admin | No surface renders a key or a masked prefix. Status pages show presence and counts, modals use placeholders, and prompts and exports carry no credentials. | `src/utils/metrics/status/serverConfigPages.ts`, `src/utils/discord/ui/providersPanel.ts`, `src/utils/db/repositories/ExportRepository.ts` | A "show key" button, a masked prefix, or a credential field in an export would open a disclosure path. |
| **Read another tenant's key** | Any member or admin | Reads are owner-scoped in SQL, and an endpoint's URL and key come from the same saved row. Editing an endpoint checks its owner and capability before writing. | `src/utils/db/repositories/LlmProviderRepository.ts`, `src/utils/provider/credentialResolver.ts`, `src/utils/provider/customEndpointService.ts` | There is no database row-level security. Other loads by ID rely on their callers' scoping. |
| **Encryption at rest** | Anyone with a database dump | `pgcrypto` AES-256 with a per-row key version, on every column listed in `encryptedColumns.ts`. | `src/utils/security/crypto.ts`, `src/utils/security/encryptedColumns.ts` | There is no application key derivation, so strength equals the entropy of `CRYPTO_SECRET`. Use at least 32 random characters. |
| **Secret in transit to PostgreSQL** | Statement logs, database operators, network capture | None. | `src/utils/security/crypto.ts` | The secret and the plaintext key are parameters of every encrypt and decrypt query, so a log that records parameters exposes both. Removing this requires encrypting in-process. |
| **Heap snapshot** | Anyone who can signal the container and read the diagnostics directory | The `SIGUSR2` handler is armed only when `HEAP_SNAPSHOT_DIR` is set. The release Azure compose file leaves it empty and mounts a private `/app/diagnostics` (host mode `0700`). On POSIX the handler refuses public or symlinked directories and writes `0600` files. | `src/init/heapSnapshot.ts`, `release:deploy/azure/docker-compose.yml` | A snapshot holds every decrypted key, `CRYPTO_SECRET`, the Discord token, and the database password. Earlier compose files armed it into the log mount, so check old log directories for snapshots. |
| **Backup bundle** | Anyone who obtains a bundle | New bundles hold only the dump and a list of the key versions it needs. Restore decrypts with separately provisioned keys and never loads `config.env`. `bun run db:lifecycle` fails if a new bundle contains `config.env`. | `src/utils/backup/dataBackup.ts`, `scripts/checks/validateLifecycle.ts` | A dump still holds private conversations. Legacy bundles carry `config.env` and are the whole key set. A dump plus the key archive is a full compromise, so store them apart. |
| **Subprocesses** | Local users reading the process list, and child processes | `pg_dump` and `psql` get the password through a private `PGPASSFILE`, with the bot's database variables removed. The OpenRouter `curl` fallback reads its headers from stdin, and the Crawl4AI launcher passes its token through the environment. No local MCP process exists. | `src/utils/backup/dataBackup.ts`, `src/providers/openrouter/openrouterVideoGeneration.ts`, `scripts/devtools/launch.ts` | Other child processes inherit the full bot environment, including `CRYPTO_SECRET`. Give any new child process an explicit environment. |
| **Logs and metrics** | Log readers | Every `log` method, including `log.metric`, redacts sensitive field names and known key shapes before any sink. Production logs at `error` level unless `LOG_LEVEL` raises it, and metric fields carry codes and counts rather than free text. | `src/utils/misc/logger.ts`, `src/utils/db/repositories/ErrorLogRepository.ts` | Redaction is pattern-based, so an unknown key shape survives. Only the chat diagnostic snippet is capped (2,000 characters). `metric_samples` rows are unsanitized and today hold only codes and counts. |
| **Credential sent to an unintended host** | Anyone who can edit an endpoint URL, and any host that answers with a redirect | Pinned DNS and per-hop validation. A credential belongs to one origin: a cross-origin redirect drops credential headers and never reattaches them, and a credentialed HTTPS to HTTP downgrade is refused. | `src/utils/security/userRemoteFetch.ts` | Editing an endpoint URL sends that label's stored key to the new URL, so a repointed URL is a leaked key. An endpoint that redirects authenticated calls must be registered at its final URL. |

### Database and secrets

| Threat | Scenario | Risk | Control | Source | Residual risk |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Tampering / Elevation of privilege** | SQL injection through messages, command options, persona text, imports, memories, or endpoint settings. | Critical | Bun SQL template literals for every value, constants in `sql.unsafe`, and schema-derived column allowlists in four repositories. | `src/utils/db/client.ts`, `src/utils/db/sqlSecurity.ts` | `ConfigRepository` interpolates table and column names with only type-level protection; current callers pass constants. `bun run audit-sql` checks only where raw SQL may appear; it does not prove values are parameterized. |
| **Information disclosure** | A missing server, user, persona, or channel filter leaks data across tenants. | High | Queries are scoped in repositories and route handlers, and export and delete are scope-specific. | `src/utils/db/repositories/*`, `src/utils/discord/interactions/configPermissionPolicy.ts` | No row-level security. `loadVoiceSampleById` is not server-scoped and `resolveAvatarPath` has no containment check; both are safe only because of their current callers. |
| **Information disclosure** | An encryption key version is retired while rows or backups still need it. | High | The secret source supplies the whole version set, including `CRYPTO_SECRET_CURRENT`. `audit-keys` decrypts every inventoried column. `rotate-keys` and lazy re-encryption on read update a row only while it still holds the ciphertext they read, so a concurrent replacement is never overwritten. | `src/utils/security/keyManager.ts`, `src/utils/security/encryptedColumns.ts`, `scripts/devtools/rotateAllKeys.ts` | `--bot-stopped` records the operator's word and cannot detect a running instance, whose caches keep the old key until restart. A partial failure leaves earlier rows migrated. Retained backups still need their archived keys. |
| **Repudiation** | A user denies creating, editing, or deleting memory or configuration. | Medium | Commands are Discord-authenticated, and logs carry command, user, and server metadata. | `src/utils/misc/logger.ts` | Logs are diagnostics that an operator can edit or delete, so they cannot prove who made a change. |
| **Denial of service** | Imports, documents, vector work, or reminders consume database or CPU time. | Medium | Size and count caps before writes, quotas, and at most 100 pending reminders per server, counted under a row lock. | `src/utils/security/rateLimiter.ts`, `src/tools/functionCalls/reminderTool.ts` | Caps bound size and count. One operation under the caps can still take long CPU time. |
| **Tampering** | A cache keeps serving old permissions, configuration, memories, webhooks, or Matrix links. | Medium | Invalidation runs after a successful write, and no cache holds a decrypted key. | `src/utils/cache/*` | `guildMcpConfigCache` holds encrypted tokens and `webhookCache` holds live webhook objects. New writes must invalidate after success. |

---

## 2. Discord commands, permissions, and webhooks

Discord is both the identity provider and the main execution surface.

| Threat | Scenario | Risk | Control | Source | Residual risk |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Elevation of privilege** | A normal member runs server-management commands. | High | The loader sets a `ManageGuild` default on the `model`, `nsfw`, `server`, `expressions`, `matrix`, and `quota` categories. `/providers`, `/setup`, `/nuke`, `/moderation`, `/matrix link`, `/quota reset`, and `/expressions manage` re-check `memberPermissions`, and `/config` applies a default-deny policy on every interaction. | `src/utils/discord/commandLoader.ts`, `src/utils/discord/interactions/configPermissionPolicy.ts` | A guild admin can grant any command to any role, and the shared command handler adds no check. Five commands have no runtime gate (see [accepted design boundaries](#accepted-design-boundaries)). |
| **Spoofing** | A foreign webhook poses as a persona to poison attribution, loop replies, or skip metering. | High | Persona and Matrix identity require a managed webhook ID bound to the guild and channel before any name matching or admission and metering exemption. A failed lookup grants nothing, and managed persona turns are metered to the originating user. | `src/utils/chat/webhookIdentity.ts`, `src/utils/chat/admission.ts` | Holders of a managed webhook token are trusted. A copied display name can still fool people. |
| **Information disclosure / Spoofing** | A stolen managed webhook token posts as a persona. | High | Tokens are encrypted, bound to a guild and channel, and decrypted only to post. Avatar edits are rate limited. | `src/utils/discord/webhook/webhookCore.ts` | A leaked token works until the webhook is rotated or deleted. |
| **Tampering** | The model pins, edits, or deletes messages through `manage_message`. | Medium | Dispatch re-checks the flag. Edit and delete apply only to bot or managed persona messages, and pin requires `ManageMessages`. | `src/tools/functionCalls/manageMessageTool.ts` | The tool acts with bot permissions, never the invoker's. |
| **Tampering** | The model creates unwanted threads through `create_thread`. | Medium | `execute()` re-checks the flag, the blocklist, bot permissions, and target visibility; ambiguous names fail closed. | `src/tools/functionCalls/createThreadTool.ts` | Threads are created with bot permissions. Turn off the flag where threads should stay manual. |
| **Information disclosure** | `cross_channel_message` copies recent messages from one channel into another. | High | The bot and the invoking member both need `ViewChannel` on the target, and the server blocklist applies. | `src/tools/functionCalls/crossChannelMessageTool.ts` | There is no feature flag, so the blocklist is the only per-channel control. Block sensitive channels. |
| **Information disclosure** | Tool notices, reasoning logs, or image diagnostics leak private-channel activity into the thought log. | Medium | Content is mirrored only from channels `@everyone` can view without a deny overwrite, and only to a log in the same server. | `src/utils/discord/thoughtLogAudience.ts` | The thought log still collects activity from every public channel. Treat it as a sensitive operational log. |
| **Denial of service** | Members spam interactions, triggers, or Discord API calls. | Medium | Per-user command cooldowns, trigger cooldowns, stream locks, queues, quotas, and memory-pressure cooldowns. | `src/utils/db/repositories/CooldownRepository.ts`, `src/utils/security/rateLimiter.ts` | `ManageGuild` members skip trigger cooldowns for trigger types 1-3 unless `DISABLE_COOLDOWN_EXEMPTIONS=true`. Cooldowns and quotas fail open on database errors (accepted design boundary). |

---

## 3. LLM, prompt, persona, and tool execution

The model can be steered by users, memories, documents, web pages, tool results, MCP descriptions, and persona prompts.

| Threat | Scenario | Risk | Control | Source | Residual risk |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Tampering** | Prompt injection causes persona drift, unsafe instructions, or system prompt leaks. | Medium | Context blocks are kept separate, and built-in behavior is enforced in TypeScript where possible. | `src/utils/text/contextBuilder.ts` | Injection cannot be fully prevented, so execution code must check every tool call. The model can repeat its own system prompt. |
| **Information disclosure** | `/tool prompt snapshot`, the `/context` view buttons, or `/status` expose prompts, memories, or messages. | High | `canViewPromptText` runs on every interaction: `ManageGuild` passes, and members pass only when `prompt_snapshot_enabled` allows it. | `src/utils/text/promptInspection/delivery.ts`, `src/utils/discord/interactions/contextRoutes.ts`, `src/utils/metrics/status/command.ts` | Enabling snapshots for members discloses prompts on purpose. `/context` shows the model, provider, context window, estimated cost, and last token count to everyone, and other status pages stay visible to members. |
| **Information disclosure** | A stored credential reaches prompt text. | High | Prompts receive text fields and tool schemas only, no configuration object is serialized, and no tool takes a credential argument. | `src/utils/text/context/templates.ts` | Keep keys out of endpoint URLs, which can appear in errors and logs. |
| **Tampering / Information disclosure** | Memories, documents, or imported presets poison later context or leak sensitive content. | High | Scoped memories, privacy levels, limits, and scoped management, export, and delete commands. | `src/utils/misc/memoryLimits.ts`, `src/utils/discord/interactions/memoriesRoutes.ts` | Server memory is shared; moderators must remove poisoned or sensitive entries. |
| **Elevation of privilege** | A prompt causes an unauthorized tool call. | High | Advertisement and dispatch share one availability check: provider and model support, feature flags, live context, and bot permissions. | `src/tools/availability.ts`, `src/tools/toolRegistry.ts` | There is no universal permission layer, so each tool's `execute()` must check the invoker, quotas, and target ownership. |
| **Information disclosure / Tampering** | Response drafting sends drafts to a reviewer, Decision model, or rule checker other than the answering provider. | Medium | Drafting is off by default. A pinned reviewer uses the workspace's own registration and key, Decision calls validate the exact registration, review packets redact credentials, and the rule checker uses the guild MCP transport and its cap. | `src/utils/chat/responseReview.ts`, `src/utils/chat/responseRuleCheck.ts`, `src/providers/utils/decisions.ts` | The reviewer and checker receive drafts and private context, as data recipients the administrator chose. Decision skipping stays off until calibrated. When review is unavailable, the reply is delivered under the ordinary checks; a model verdict never replaces authorization, feature flags, SSRF checks, or limits. |
| **Information disclosure** | Raw Discord IDs in context are reused incorrectly. | Medium | Recent targets appear as opaque `media_N` and `ref_N` handles. | `src/utils/text/messageIdMap.ts` | The handles are cosmetic: a raw message ID still works in media tools. |
| **Denial of service / Cost** | Long prompts, tool loops, generation, or retries burn tokens and credits. | High | Fetch limits, context trimming, flood guards, a bounded pending-reply buffer, cooldowns, and quotas. | `src/utils/security/rateLimiter.ts`, `src/utils/quota/*` | Admins must set quotas and flags for their risk tolerance. |

---

## 4. MCP and web or search tools

TomoriBot runs no local MCP process. `web_search` tries Brave, then SearXNG, then a built-in DuckDuckGo engine that reads through the strict pinned fetcher. `fetch_url` reads pages itself or through an optional self-hosted Crawl4AI. Guild administrators can register remote MCP servers and select one to replace `fetch_url` (`url_fetcher`) or `web_search`.

| Threat | Scenario | Risk | Control | Source | Residual risk |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Information disclosure** | A remote MCP URL points at localhost, a private network, or an internal service. | High | Production blocks private, reserved, and loopback addresses and requires HTTPS. DNS is pinned, requests stay on the registered origin, and redirects are refused. | `src/utils/security/remoteUrlSecurity.ts`, `src/utils/mcp/guildMcpFetch.ts`, `src/utils/mcp/smitheryConnection.ts` | A `*.run.tools` registration with a key sends it only to `api.smithery.ai`, but Smithery sees all of that registration's tool traffic and fetches the upstream itself. |
| **Information disclosure** | A crafted URL reaches a cloud metadata service. | High | An always-on denylist in both URL gates, which neither development mode nor `FETCH_URL_ALLOW_PRIVATE_NETWORK` relaxes: `169.254.0.0/16`, `fe80::/10`, AWS `fd00:ec2::254`, GCP `fd20:ce::254`, and Alibaba Cloud `100.100.100.200`. Alternate IPv4 spellings are normalized, and IPv4-mapped IPv6 is unwrapped. | `src/utils/security/cloudMetadata.ts`, `src/tools/fetchUrl/urlSafety.ts` | A metadata address outside this list relies on the production private-range blocklist. |
| **Tampering** | MCP tool names, descriptions, or results carry prompt injection, or a name collides with a built-in. | High | Built-in names are reserved. Only explicit replacements and unique names bound to one registration are routed, the same way for listing and dispatch. Responses stop at 8 MiB and must pass the SDK schema. | `src/tools/availability.ts`, `src/utils/mcp/guildMcpManager.ts` | Descriptions and results stay untrusted. Ambiguous registrations stay hidden until an administrator fixes them. |
| **Elevation of privilege** | A dangerous MCP tool, such as shell or file access, is registered and called. | Critical | TomoriBot adds no host shell or file access. Registration requires `ManageGuild`, and fetch or search replacements follow the `web_search` flag. | `src/utils/discord/interactions/configMcpRoutes.ts` | Safety depends on the server's design and the admin's trust. A replacement's own DNS, redirects, and downloads are outside bot control. |
| **Information disclosure / SSRF** | Fetch or search reaches internal URLs, huge responses, or pages that try to exfiltrate data. | Medium / High | Private targets are blocked before dispatch in production unless `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`, unresolvable hosts are refused, and a byte cap applies while streaming. A malformed `MAX_FETCH_SIZE_MB` falls back to the default. | `src/tools/fetchUrl/*`, `src/utils/security/boundedResponse.ts` | Crawl4AI is allowed only where private fetching is, because its browser fetches outside the bot; its replies are bounded and shape-checked. Page content stays untrusted. |
| **Elevation of privilege / Information disclosure** | A compromised SearXNG image acts with the task's network identity. | High | The container gets only `SEARXNG_SECRET`. The Dockerfile and the release AWS default pin the same image digest, and legacy GCP disables the container. | `servers/searxng/Dockerfile`, `release:terraform/aws/variables.tf` | The AWS sidecar is on by default, and a variable override replaces the digest, so pin overrides too. |
| **Information disclosure** | SearXNG is exposed beyond the private network and becomes an open search proxy. | High | `limiter.toml` turns off bot detection on the assumption that only TomoriBot reaches it, and no deployment publishes its port. | `servers/searxng/limiter.toml`, `release:terraform/aws/ecs-health-check.tf` | On AWS the sidecar port is reachable on the task's private network interface. Never add public ingress or a per-guild `SEARXNG_BASE_URL`. |
| **Information disclosure** | The bundled Crawl4AI profile becomes an unauthenticated crawl proxy. | Medium | The profile is opt-in, pins `unclecode/crawl4ai:0.9.4`, publishes its port on `127.0.0.1` only, and that image requires a token for any outside connection. | `docker-compose.yaml`, `scripts/devtools/launch.ts` | The image's own block on private browser destinations is a vendor control the bot cannot verify. |

---

## 5. Custom providers, endpoints, speech, and transcription

Custom endpoints cover text, embedding, image, video, speech, and transcription. Server endpoints are configured by admins and personal endpoints by users. Both allow local and private addresses outside production and block them in production.

| Threat | Scenario | Risk | Control | Source | Residual risk |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Information disclosure / SSRF** | An endpoint URL targets internal infrastructure or changes DNS after validation. | High | Every adapter and setup probe uses `fetchUserRemoteUrl()`, and the URL and key come from the same saved row. | `src/providers/custom/*`, `src/utils/security/userRemoteFetch.ts` | Local endpoints work outside production, so production must set `RUN_ENV=production`. |
| **Information disclosure** | An endpoint receives chat history, images, audio, voice samples, or memories. | High | Registration is explicit and scoped, and the key attaches only to that endpoint's origin. | `src/utils/provider/credentialResolver.ts` | Endpoint operators see every payload by design. See [Key custody](#key-custody) for URL edits. |
| **Information disclosure** | A voice-cloning endpoint receives a stored voice sample. | High | Speech endpoints are server-scoped, and endpoint-side reads require an enabled voice page and `ManageGuild`. | `src/providers/custom/styles/ttsCloningAdapter.ts`, `src/utils/storage/voiceSampleStorage.ts` | Any server manager can list, play, assign, and delete every sample, because samples have no owner or consent record. Treat them as biometric data. |
| **Information disclosure** | A transcription endpoint receives uploaded audio. | High | Transcription runs only with a configured endpoint, under size and timeout checks. | `src/utils/audio/audioAttachmentTranscription.ts` | Members of enabled servers should expect audio to reach that endpoint. |
| **Tampering / Denial of service** | A ComfyUI or custom workflow is malicious, huge, or expensive. | Medium | Workflows are stored at registration, and generation is gated by flags and quotas. | `src/providers/custom/customComfyUiEndpoint.ts` | The remote runtime is the endpoint operator's risk. |
| **Information disclosure** | A provider error body appears in a channel or in model context. | Medium | Public messages carry classified summaries and sanitized codes, and setup strips tokens, URLs, and hosts from probe failures. | `src/utils/discord/stream/errorUi.ts`, `src/utils/provider/providerErrorClassification.ts` | Routine failures log at `warn`, which production's `error` level hides, so upstream detail may be missing when diagnosing. |

---

## 6. Files, attachments, media, and assets

TomoriBot processes attachments, images, video, GIFs, PDFs and text, audio, avatars, character references, expressions, sprite and character-card archives, and Matrix media.

| Threat | Scenario | Risk | Control | Source | Residual risk |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Denial of service** | Oversized or slow downloads exhaust memory or time. | High | `safeDownload()` checks known sizes, validates the URL, caps bytes while streaming, and times out. Attachments, imports, avatars, references, voice samples, expressions, sprites, Matrix relays, and provider media use it. NovelAI replies stop at 32 MiB with at most 8 ZIP entries checked before inflating, and OpenRouter video helpers cap output and never follow redirects. | `src/utils/security/safeDownload.ts`, `src/tools/functionCalls/generateImageNaiTool.ts`, `src/providers/utils/providerVideoDownload.ts` | Byte and time limits do not bound decoder CPU on crafted media. |
| **Denial of service** | A crafted PDF or text file stalls the single-threaded runtime. | High | Size limit, binary-type blocklist, memory guard, and truncation. PDFs are parsed in a worker thread that is terminated after 20 seconds. Office documents, spreadsheets, and archives are rejected. | `src/tools/functionCalls/readFileTool.ts`, `src/utils/documents/textExtractor.ts`, `src/utils/documents/pdfParseWorker.ts` | A crafted PDF can keep one worker thread busy until the deadline, and concurrent uploads each start their own worker, so many at once still compete for CPU. |
| **Information disclosure** | `read_file`, image analysis, or GIF processing exposes attachments. | Medium | `read_file` and GIF processing reach the last 100 messages through handles. | `src/tools/functionCalls/readFileTool.ts`, `src/tools/functionCalls/analyzeImageTool.ts` | `analyze_image` accepts any message ID in the channel plus one reply hop. All three use bot visibility. |
| **Information disclosure / SSRF** | Stored assets load arbitrary URLs or another owner's files. | Medium | Uploads use the guarded download, stored paths are contained under per-owner prefixes, and a character reference loads, replaces, or deletes only within its owner's directory or S3 prefix. | `src/utils/storage/avatarStorage.ts`, `src/utils/storage/charrefStorage.ts` | Remote assets should stay on Tomori-controlled S3 or CloudFront and the Discord CDN. `resolveAvatarPath` has no containment check; only preset seeds call it. |
| **Information disclosure** | Generation and analysis send user images, avatars, stickers, or embeds to providers. | Medium / High | Feature flags, capability and quota checks, and ownership checks on expression media. | `src/tools/functionCalls/generateImageTool.ts`, `src/utils/storage/expressionMedia.ts` | Provider privacy is outside TomoriBot. `sharp` and ffmpeg limits reduce but do not remove decoder risk. |

---

## 7. Matrix bridge

The optional Matrix bridge runs as an appservice: it relays Matrix messages into Discord through webhooks and sends TomoriBot replies back through virtual persona users.

| Threat | Scenario | Risk | Control | Source | Residual risk |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Spoofing / Elevation of privilege** | An outsider posts forged appservice transactions. | Critical | `MATRIX_HS_TOKEN` is checked on every transaction. The listener binds `MATRIX_APPSERVICE_BIND_HOST` (default `127.0.0.1`), and the callback URL must use HTTPS unless it is localhost. | `src/utils/bridges/matrix/client.ts` | A non-loopback bind relies on the token, network restrictions, and operator TLS. |
| **Information disclosure** | A room is linked to a sensitive channel, or the bot joins an unvetted room. | High | `/matrix link` requires `ManageGuild`, and unlinked rooms do nothing. | `src/commands/matrix/link.ts`, `src/utils/bridges/matrix/events.ts` | Matrix controls room membership. Any Matrix user can invite the bot, which joins and posts a setup notice. |
| **Information disclosure** | An encrypted room is linked or becomes encrypted. | Medium | Only rooms verified as unencrypted can be linked. Every relay rechecks, and an encryption event forces a recheck that unlinks the room with a notice. | `src/utils/bridges/matrix/rooms.ts` | There is no startup sweep: an encrypted room's link retires on its next relay or state event. |
| **Spoofing** | Matrix users pick names resembling personas or Discord users. | Medium | The webhook name includes the Matrix ID, and loop prevention checks the homeserver suffix. | `src/events/messageCreate/matrixRelay.ts` | Display names can still fool people; identify users by full Matrix ID. |
| **Tampering / Denial of service** | A hostile homeserver sends oversized media or events, or a crafted media ID escapes its path. | Medium | Settings are validated once. Media and reply-event reads are byte-capped. A media ID (`mxc://server/id`) must match the spec grammar and the exact download path before the token is attached, and redirects are followed without it. | `src/utils/bridges/matrix/media.ts`, `src/utils/bridges/matrix/stateSync.ts` | A CDN on a private address is refused in production. |
| **Tampering** | Room members run `/kill` or `/refresh`, or relay files into Discord. | Medium | Commands work only in linked rooms and affect only the linked channel. | `src/utils/bridges/matrix/events.ts` | There is no permission gate, matching Discord, and inbound files are reposted with no type allowlist (accepted design boundary). |

---

## 8. Supply chain, deployment, and operations

| Threat | Scenario | Risk | Control | Source | Residual risk |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Tampering / Elevation of privilege** | A malicious dependency runs code during install, build, or runtime. | High | Committed `bun.lock` with integrity hashes, `--frozen-lockfile`, overrides, a digest-pinned base image, and a non-root user. Pull-request CI runs the SQL placement audit and an advisory `bun audit`. Release deploy workflows run semgrep, trufflehog, `bun run audit:clean`, and Trivy, and stop on failure. | `package.json`, `.github/workflows/ci.yml`, `.github/workflows/deploy-azure.yml` | Most version ranges float on `^`, and `ffmpeg-static` downloads an unverified binary at install. Audit exceptions, such as one for a docs-build-only package with no fix yet, are listed with removal conditions in the [dependency security policy](/contributing/policies/dependency-security/). |
| **Information disclosure** | CI or deployment secrets leak through logs or a compromised action. | High | Actions are pinned to commit SHAs, deployment uses OIDC, and trufflehog scans for committed secrets. | `.github/workflows/*` | GitHub Actions and cloud IAM remain trusted. |
| **Information disclosure / Tampering** | Production loads secrets from the wrong place, or a key version goes missing. | High | Production reads AWS Secrets Manager, a mounted JSON file, or a GCP secret file and never falls back to environment values. The source supplies the whole key version set, an invalid current version stops startup, and `TEST_PRODUCTION=true` skips database TLS only for loopback hosts. | `src/utils/security/secretsManager.ts`, `src/utils/security/keyManager.ts` | Short keys only produce a warning, and `TEST_PRODUCTION=true` reads `.env` instead of the production source. |
| **Denial of service** | A memory leak, parser crash, provider hang, or unhandled promise crashes the process. | Medium | A memory monitor with tiered thresholds, a first-token watchdog, and adapter inactivity timeouts. | `src/timers/memoryMonitor.ts`, `src/utils/chat/toolLoop.ts` | External process supervision is still required. An armed heap snapshot pauses the process while it writes. |
| **Information disclosure** | A diagnostic leaves secrets on the host. | High | Production skips the startup backup, and the container is read-only with dropped capabilities and `no-new-privileges`. The heap handler is unarmed by default (see [Key custody](#key-custody)). | `src/init/backup.ts`, `release:deploy/azure/docker-compose.yml` | Restrict who can signal the container and who can read the diagnostics, log, and backup directories. |

---

## Security follow-ups

No defect traced in this review is waiting for a fix. The items below are deliberate behaviors and operator duties.

### Accepted design boundaries
<!-- anchor: accepted-design-boundaries -->

These behaviors are deliberate. Each was traced, and none currently lets someone bypass an existing permission.

| Area | Behavior and reason | Revisit when |
| :--- | :--- | :--- |
| Command permissions | `/persona create`, `/persona export`, `/persona generate`, `/status`, and `/troubleshoot chat` have no runtime gate. They reach only preset files, already-visible fields, a per-user quota, or the caller's own diagnostics. | A command performs a Manage Server action without a gate, or Discord publishes a permission invariant. |
| Cooldowns and quotas | They fail open on database errors so an outage does not lock everyone out. | An outage admits traffic above its limits, or unprivileged senders can saturate the database pool. Change cooldowns and quotas together. |
| Dynamic identifiers and asset helpers | `ConfigRepository` identifiers are protected by types only, and `loadVoiceSampleById` and `resolveAvatarPath` are unscoped. Current callers pass constants or authored values. | A caller passes request-shaped identifiers or another owner's path. |
| Matrix room roles | Room members can `/kill`, `/refresh`, invite the bot, and relay uploads. Discord requires no permission for those commands either. | A Matrix authorization contract is defined, or room membership bypasses an existing permission. |

### Operational hardening

| Area | Action |
| :--- | :--- |
| MCP | Treat shell, file, database, or broad-network MCP tools as granting that access. Register only remote services, including Smithery-relayed ones, that you trust with tool arguments and results. |
| Matrix | Keep the appservice listener on loopback or a restricted network, rotate `MATRIX_HS_TOKEN` after a host compromise, and moderate linked rooms. |
| Secrets | After a key, token, or host compromise, rotate the affected secrets. Rotate encryption keys with every bot instance stopped, following [Maintenance & Backups](/self-hosting/maintenance/#rotating-encryption-keys), and never retire a version that a retained backup still needs. |
| Secret strength | Generate every `CRYPTO_SECRET` version with at least 32 random characters, because startup only warns about short keys. |
| Discord permissions | Give the bot least-privilege channel access; several tools act with its visibility rather than the invoker's. |
| Quotas and feature flags | Keep conservative defaults for image, video, web fetch, prompt snapshot, and manage-message, and restrict `/providers`, MCP registration, and the cross-channel blocklist. |
| Diagnostics | Leave `HEAP_SNAPSHOT_DIR` unset outside an authorized diagnostic session, limit access to the diagnostics, log, backup, and data mounts, and treat heap snapshots and legacy backup bundles as production credentials. Keep the key archive apart from backups. |

---

## Contributor checklist

1. Enforce security in TypeScript, because a prompt instruction does not stop a call, and re-check feature flags, permissions, quotas, and target ownership inside `execute()`.
2. Use `fetchUserRemoteUrl()` or `validateRemoteUrl()` for user-supplied or admin-configured URLs unless the URL is a fixed first-party provider URL, and compare parsed hostnames, never substrings, before attaching a credential.
3. Use `safeDownload()` or equivalent size, timeout, and streaming-cap checks for user-controlled media.
4. Use Bun SQL template literals for values and `sqlSecurity.ts` helpers for dynamic columns; never interpolate identifiers a request can shape.
5. Scope every database read and write by server, user, persona, or channel.
6. Invalidate caches after successful writes, in the same code path.
7. Never render a credential, prefill one into a component, or put one in prompt text, logs, exports, or a subprocess argument.
8. Treat MCP definitions and results, web pages, documents, memories, imports, provider error bodies, and endpoint responses as untrusted prompt content.
9. Treat heap snapshots and legacy backup bundles as credential-bearing, and keep `.env` out of anything that travels.
