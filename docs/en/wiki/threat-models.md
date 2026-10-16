---
title: "Threat Models"
---

Updated on: 2026-10-16

TomoriBot accepts untrusted messages and files, lets models request tools, and stores credentials
for guilds and personal scopes. This review groups threats by four places where input can gain
access to a network, an action, or another tenant's data.

## Scope and references

This page describes application source on `main` and deployment defaults committed on `release`.
It does not verify a running deployment or certify that every caller is safe. Paths prefixed with
`release:` exist only on that branch; read them with `git show release:<path>`.

The groupings are specific to TomoriBot. Review references are the
[OWASP Agentic Top 10 (2026)](https://genai.owasp.org/download/52117/),
[OWASP LLM Top 10 (2025)](https://genai.owasp.org/llm-top-10/), and
[MITRE ATLAS](https://atlas.mitre.org/).

| Trust boundary | Relevant categories |
| :--- | :--- |
| Inbound untrusted input | ASI06 (memory and context poisoning), LLM01 (prompt injection), LLM10 (unbounded consumption) |
| Outbound egress and SSRF | ASI04 (agentic supply chain), ASI07 (insecure inter-agent communication), ATLAS exfiltration via AI agent tool invocation |
| Agentic execution and confused deputy | ASI01 (goal hijack), ASI02 (tool misuse), ASI03 (privilege abuse), ASI05 (unexpected code execution), LLM05 (improper output handling), LLM06 (excessive agency) |
| Multi-tenant data and secret custody | LLM02 (sensitive information disclosure), ATLAS credential harvesting and data leakage |

SSRF means server-side request forgery: an attacker makes the bot request a destination such as
cloud metadata. A confused deputy uses the bot's authority for an action the requester could not
perform directly. Model text, including a reviewer verdict, grants no authority.

ASI08 (cascading failures) and ASI10 (rogue agents) inform the execution limits below. ASI09
(human-agent trust exploitation) remains a limitation: people can mistake model output for
authorized instructions. TomoriBot does not train foundation models, so training-time poisoning
is outside this review; poisoning stored memories and retrieved content is included.
[NIST SP 800-218A](https://csrc.nist.gov/pubs/sp/800/218/a/final) provides secure-development guidance
for generative AI systems, rather than evidence that these controls pass an audit.

Related architecture: [Security & privacy](/architecture/subsystems/security/),
[Tool system](/architecture/subsystems/tool-system/), [Tool loop](/architecture/pipelines/tool-loop/),
and [Matrix bridge](/architecture/integrations/matrix/bridge/).

## 1. Inbound untrusted input

Discord messages, Matrix events, attachments, imports, provider media, and stored memories can
contain hostile data. Receiving an attachment or sending it to a configured model is an intended
capability; malformed payloads, persistent injection, and forged senders cross security controls.

| Threat | Control and source | Residual risk or operator duty |
| :--- | :--- | :--- |
| Oversized downloads or compressed media exhaust memory. | `src/utils/security/safeDownload.ts` validates URLs, bounds streamed bytes, and times out. `src/utils/image/naiImageGeneration.ts` caps ZIP replies at 32 MiB, rejects more than 8 entries, and checks declared image size before inflation and actual size afterward. | Byte limits do not bound decoder CPU. Concurrent downloads still compete for memory; keep media quotas conservative. |
| A crafted PDF stalls document extraction. | `src/utils/documents/textExtractor.ts` downloads under a cap and parses PDFs in `pdfParseWorker.ts`, terminating the worker after 20 seconds. Unsupported binary formats are rejected. | Concurrent PDFs each start a worker and compete for CPU until their deadlines. |
| Memories, documents, presets, or tool results poison later context. | Memory writes and management are scoped and limited in `src/utils/misc/memoryLimits.ts` and `src/utils/discord/interactions/memoriesRoutes.ts`. Tool authorization remains in execution code. | Server memory is shared. Moderators must remove poisoned or sensitive entries; context separation cannot make natural-language instructions trustworthy. |
| An outsider forges Matrix appservice transactions. | `src/utils/bridges/matrix/client.ts` checks `MATRIX_HS_TOKEN`; the listener defaults to loopback. The public callback URL requires HTTPS except for localhost. | The callback URL does not enable listener TLS. A non-loopback bind needs restricted ingress and TLS when crossing an untrusted network. |

## 2. Outbound egress and SSRF

User URLs, administrator-selected endpoints, MCP servers, and redirects are separate from fixed
provider API addresses. TomoriBot starts no local MCP process. A registered remote service sees
its tool arguments and results and controls any fetching it performs itself.

| Threat | Control and source | Residual risk or operator duty |
| :--- | :--- | :--- |
| A custom endpoint or download scans internal services or changes DNS after validation. | `src/utils/security/remoteUrlSecurity.ts` requires HTTPS and blocks private, reserved, and loopback addresses in production. `userRemoteFetch.ts` connects to validated IPs with the original Host and TLS name. Custom adapters and setup probes use this fetcher. | Private endpoints are allowed outside production; set `RUN_ENV=production` on hosted deployments. URL validation alone is insufficient without the pinned transport. |
| A URL steals cloud instance credentials. | Both URL gates use `src/utils/security/cloudMetadata.ts`: IPv4 link-local, IPv6 link-local, AWS and GCP IPv6 metadata addresses, and Alibaba's metadata address are always denied, including after DNS resolution. | Development mode and `FETCH_URL_ALLOW_PRIVATE_NETWORK` cannot relax this denylist. Other metadata addresses depend on the general private-range blocklist. |
| A redirect sends a saved endpoint key to another host. | `src/utils/security/userRemoteFetch.ts` validates each hop, drops credential-bearing headers at an origin change, never restores them on later hops, and refuses credentialed HTTPS downgrades. | Editing the saved endpoint URL deliberately sends its key to the new origin. Register authenticated redirecting services at their final URL and restrict who can edit them. |
| An MCP registration targets an internal service or redirects credentials. | `src/utils/mcp/guildMcpFetch.ts` uses pinned DNS, confines requests to the registered origin, refuses redirects, and caps replies. `smitheryConnection.ts` binds relay credentials to the Smithery API. | A relay sees registration traffic and fetches upstream itself. Neither its upstream fetching nor an MCP replacement's network behavior is covered by the bot's URL gate. |
| Fetch or search escapes network policy through a browser or sidecar. | `src/tools/fetchUrl/urlSafety.ts` validates destinations; the safe HTTP engine pins DNS and caps bodies through `src/utils/security/boundedResponse.ts`. Crawl4AI is admitted only when private fetching is allowed. Bundled Crawl4AI publishes on loopback; SearXNG has no published port. | Crawl4AI resolves redirects and subresources itself. Keep browser and search services on restricted networks; the bot cannot verify their internal SSRF protections. SearXNG disables bot detection on that assumption. |
| A stored Vertex configuration sends the host's Google credential to another host. | `src/providers/vertex/vertexClient.ts` accepts only a DNS-label location, because the Google SDK builds the regional hostname from it and attaches the host's Application Default Credentials token. | Every Vertex configuration authenticates as the host identity, so any project that identity can reach is usable by any server or user who names it. Grant that identity only projects whose usage the operator accepts. |
| A crafted Matrix media identifier escapes its authenticated route. | `src/utils/bridges/matrix/media.ts` validates `mxc://server/id` grammar, the exact path, and the homeserver origin before attaching a token. Redirects download anonymously through `safeDownload`. | Media and reply-event reads are capped. Homeserver operators remain trusted with their appservice traffic. |

## 3. Agentic execution and confused deputy

The model chooses tool arguments but the bot owns authorization. Availability filtering reduces
what the model sees; dispatch and each tool must enforce the permissions of the actual caller.

| Threat | Control and source | Residual risk or operator duty |
| :--- | :--- | :--- |
| Prompt injection triggers an unauthorized built-in action. | `src/tools/availability.ts` and `toolRegistry.ts` share checks for provider/model support, live context, feature flags, and declared bot permissions. Tool `execute()` implementations own invoker authorization, quotas, and target ownership. | There is no universal invoker-permission check. Bot visibility can exceed member visibility; every new target-sensitive tool needs an execution-time check. |
| A member invokes a server-management interaction despite command defaults. | Sensitive routes re-check `memberPermissions`; `/config` applies `src/utils/discord/interactions/configPermissionPolicy.ts` on each interaction. | Guild admins can override Discord registration defaults. A default `ManageGuild` permission is insufficient as a runtime authorization control. |
| A model copies messages from a channel the requester cannot view. | `src/tools/functionCalls/crossChannelMessageTool.ts` resolves the invoking guild member, requires the bot and member to have `ViewChannel` on the target, and applies the server blocklist. | Cross-channel reads have no separate feature flag. Block sensitive channels and limit the bot's channel access. |
| An MCP description or name collision substitutes an attacker-controlled tool. | `src/utils/mcp/guildMcpManager.ts` reserves built-in names and routes only unique registrations or explicit replacements. Configuration through `src/utils/discord/interactions/configMcpRoutes.ts` requires `ManageGuild`; responses are capped and SDK-schema checked. | Descriptions and results remain untrusted. Registering shell, file, or database tools grants the remote service those capabilities; TomoriBot cannot sandbox that service. |
| Repeated tool calls or external failures cause runaway work. | `src/utils/chat/toolLoop.ts` bounds iterations and consecutive errors; streams and tool calls have deadlines. Generation flags and quotas limit costly capabilities. | Quotas and cooldowns fail open on database errors. Turn limits leave aggregate spending during an outage unbounded; operators must choose quotas and supervise the process. |
| A malicious installed dependency gains runtime authority. | `bun.lock` records integrity hashes; frozen installs, dependency audits, and image controls reduce supply-chain changes. See the [dependency security policy](/contributing/policies/dependency-security/). | Dependency code shares runtime authority. A compromised bot process can use the credentials and provider access the bot needs; this design supplies no isolation for untrusted in-process plugins. |

## 4. Multi-tenant data and secret custody

### Key custody
<!-- anchor: key-custody -->

Provider credentials belong to guilds and personal scopes. PostgreSQL also stores managed webhook
tokens and MCP authentication. A database dump, the corresponding encryption keys, and runtime
diagnostics have different access requirements and must be stored separately.

| Threat | Control and source | Residual risk or operator duty |
| :--- | :--- | :--- |
| Discord UI, prompt inspection, or an export reveals a stored credential. | Provider panels show credential presence rather than values or prefixes; credential modals do not prefill. `src/utils/db/repositories/ExportRepository.ts` omits credential columns; context templates do not serialize configuration objects. | Keep credentials out of endpoint URLs, free-text fields, prompts, and error payloads. Such text can be copied into context or logs. |
| A missing owner filter leaks or changes another tenant's data. | `src/utils/db/repositories/LlmProviderRepository.ts` scopes credentials to server or user owners; `src/utils/provider/credentialResolver.ts` and `customEndpointService.ts` resolve an endpoint's URL and key together. Queries use parameterized values. | There is no row-level security. ID-only loads such as `loadVoiceSampleById` depend on callers' scope checks. `ConfigRepository` dynamic identifiers depend on typed constant callers. |
| A stolen dump exposes credentials, or retiring a key strands encrypted data. | `src/utils/security/crypto.ts` uses pgcrypto AES-256 with per-row key versions. `encryptedColumns.ts` defines the audit/rotation inventory; conditional rotation avoids overwriting concurrent replacements. | Use at least 32 random characters per master key; startup only warns about short keys. Stop all instances for rotation and retain versions required by backups. A dump plus its key archive exposes the encrypted credentials. |
| PostgreSQL parameter logs or database access expose plaintext keys. | Production TCP connections use verified TLS in `src/utils/db/client.ts`. Encryption and decryption run inside PostgreSQL with bound parameters in `src/utils/security/crypto.ts`. | PostgreSQL receives the plaintext encryption key and, on encryption, the credential. Prevent parameter capture in statement, error, and diagnostic logging; verify database configuration separately. Encryption at rest does not protect against a database operator or runtime compromise. |
| Logs, snapshots, or backups disclose secrets and private conversations. | `src/utils/misc/logger.ts` redacts sensitive fields and known key shapes. `src/init/heapSnapshot.ts` arms only with `HEAP_SNAPSHOT_DIR`; POSIX directory and file checks restrict access. New `src/utils/backup/dataBackup.ts` bundles omit `config.env`. | Redaction cannot recognize every secret. Snapshots may contain runtime secrets and conversations; legacy bundles include secrets. Keep diagnostics private, leave snapshots disabled routinely, and keep backup keys separate. See [Production tuning](/wiki/production-tuning/). |
| A member reads prompt text outside the configured audience. | `canViewPromptText` in `src/utils/text/promptInspection/delivery.ts` admits `ManageGuild` or the enabled member-snapshot setting; context and status interactions use that gate. | Enabling member snapshots deliberately exposes prompts and memories. Model instructions are not secret storage. |
| A stolen webhook token or forged webhook identity gains persona authority. | `src/utils/discord/webhook/webhookCore.ts` stores encrypted managed tokens. `src/utils/chat/webhookIdentity.ts` binds managed IDs to guild and channel before admission exemptions. | A managed token holder can post until rotation or deletion. Display names alone cannot prove identity to readers. |
| A stored asset path reads or deletes another owner's files. | `src/utils/storage/charrefStorage.ts` confines character references to owner directories or object prefixes; `avatarStorage.ts` constrains stored local paths and uses guarded downloads. | `resolveAvatarPath` in `src/utils/image/avatarHelper.ts` has no containment check and relies on authored preset paths. Do not expose it to user-controlled paths. |

## Accepted design boundaries
<!-- anchor: accepted-design-boundaries -->

These assumptions need review when their callers or deployment change. They do not establish that
every repository query or URL entry point has been audited.

| Area | Current assumption | Revisit when |
| :--- | :--- | :--- |
| Runtime custody | The bot process can decrypt credentials and call providers on users' behalf. | Third-party untrusted code enters the runtime and needs a separate execution boundary. |
| Database encryption | Database-side encryption is retained; parameter logging needs operator verification. | Database configuration cannot prevent parameter capture or measured performance requires another design. |
| Log redaction | Production logs errors by default; `info` and lower add full provider request payloads, including prompts and memories. Redaction covers known key names and credential shapes. | A concrete secret reaches logs despite those controls. |
| Scoped helpers | Typed identifiers, voice-sample IDs, and authored preset paths depend on their callers. | A new caller accepts request-shaped identifiers or paths without ownership validation. |
| Matrix audience | A manager links an unencrypted room; members can relay uploads and use `/kill` and `/refresh` for that channel. | Room membership bypasses an existing authorization rule or a Matrix role policy is introduced. |

## Contributor checks

- Re-check flags, permissions, quotas, and ownership when executing an action; a model or reviewer
  instruction cannot replace authorization.
- Use the existing validated, DNS-pinned fetch path for user URLs and guarded, bounded downloads
  for media. Keep credentials bound to the configured origin.
- Parameterize SQL values and scope reads and writes to the owner. Invalidate caches after
  successful writes in the same code path.
- Keep credentials out of UI values, prompts, logs, exports, and subprocess arguments. Treat
  snapshots, legacy backup bundles, and encryption-key archives as secret-bearing artifacts.
