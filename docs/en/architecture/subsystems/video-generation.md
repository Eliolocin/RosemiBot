---
title: "Video Generation"
---

The video generation subsystem coordinates asynchronous AI video generation across external providers and custom endpoints for the `/generate video` command and the `generate_video` built-in tool.

## Command and tool entry points

Video generation exposes two user-facing surfaces:

- **Slash command (`src/commands/generate/video.ts`):** Opens a modal collecting prompt text, aspect ratio, duration (seconds), optional frame rate (FPS), and an optional reference image attachment.
- **Built-in tool (`src/tools/functionCalls/generateVideoTool.ts`):** Allows models to invoke `generate_video` with a prompt, target duration, resolution (`480p`, `720p`, `1080p`), optional starting image (`media_id`), and looping controls. Tool progress notices display the active model codename, prompt excerpt, reference image usage, and elapsed execution time.

Administrative controls manage model selection and quotas:

- Model selection: `/config` > Models > Switch Models (`src/utils/discord/interactions/configModelRoutes.ts`) binds `server_model_configs.video_model_id`.
- Quota administration: `/moderation` (Quotas page) and `/quota reset` (`src/commands/quota/reset/global.ts`, `src/commands/quota/reset/user.ts`) manage user and server-wide quotas.

## Asynchronous job lifecycle and providers

Provider implementations are resolved via `resolveProviderFeatureImplementation` in `src/utils/provider/providerInfoRegistry.ts`:

- Google Veo: `src/providers/google/googleVideoGeneration.ts`
- OpenRouter: `src/providers/openrouter/openrouterVideoGeneration.ts`
- Z.ai: `src/providers/zai/zaiVideoGeneration.ts`
- Custom ComfyUI endpoints: `src/providers/custom/customEndpointDispatcher.ts` via `generateCustomVideoViaEndpoint`

Video adapters submit remote work and poll for completion before downloading MP4 data. Polling budgets
belong to each adapter: Google and Z.ai use roughly five minutes of polling intervals; OpenRouter
uses roughly ten. Network request time adds to those intervals.

### OpenRouter asynchronous API

OpenRouter video generation submits jobs to `POST /api/v1/videos`. The adapter polls the returned `polling_url` until the job reaches a terminal status, then downloads the binary video from `unsigned_urls` (falling back to `/api/v1/videos/{jobId}/content?index=0`).

To protect credentials, relative polling URLs are resolved against `https://openrouter.ai`, and authenticated polling is restricted to that origin. A dedicated video model cache (`src/utils/cache/openrouterVideoModelCache.ts`) queries `GET /api/v1/videos/models` to validate supported durations, resolutions, aspect ratios, and frame capabilities before submitting jobs.

Image-to-video requests pass reference images via `frame_images` with `frame_type: "first_frame"`. Setting loop mode supplies the same image as `last_frame` when the model supports it. If a model lacks first-frame or last-frame capabilities, the request fails before submitting a paid job.

## Transport bypass for OpenRouter

The OpenRouter video adapter uses an external HTTP process to work around HTML responses observed
with Bun's transport at the provider's edge. This is an adapter-specific compatibility measure;
it does not establish a permanent rule about the provider's TLS filtering.

To preserve connectivity, `src/providers/openrouter/openrouterVideoGeneration.ts` delegates requests to `externalHttpRequest()`, which spawns an external process with standard TLS fingerprints:

- **Windows:** PowerShell 7 (`pwsh`) with `Invoke-WebRequest`, using .NET Schannel TLS with HTTP/2 negotiation. Request data passes via stdin as JSON, and binary output returns base64-encoded.
- **Linux and Docker:** `curl` with HTTP/2 via `nghttp2` (`--proto =https`, `-H "Expect:"`). Headers, including the bearer token, and the request body travel through stdin as a curl config (`-K -`), so neither appears in the process table.

Google and Z.ai adapters use the native transport.

## State and quota coordination

Video generation persists configuration in server-scoped tables:

- `server_capabilities_configs.videogen_enabled`: Feature gate for the command and tool.
- `server_model_configs.video_model_id`: Active video model foreign key.
- `saved_provider_configs.video_model_id`: Preserved model slot when switching provider profiles.

### Quota tracking and delivery invariant

Video quotas use `video_quota_configs`, `video_quotas`, and `video_serverwide_quotas`. Both user and
server limits default to unlimited (`0`); a configured server limit uses a 365-day default reset period.

Server-funded generation checks quota before submission and increments usage after successful Discord
delivery. Personal-provider selections bypass server quota accounting. The check and increment are
separate operations, so concurrent requests can pass the same preflight; the increment transaction
does not reserve capacity. Failed delivery consumes no local quota, but a submitted provider job may
still run or incur charges. Tool cancellation checks the turn signal before delivery.

## Discord delivery constraints

Generated videos must satisfy Discord attachment limits:

- **File size limit:** Command and tool enforce a local 25 MiB ceiling (`DISCORD_FILE_SIZE_LIMIT`). This fixed ceiling does not represent every Discord account or guild's current upload allowance.
- **Format:** Providers return binary MP4 video.
- **Components V2 presentation:** `src/utils/discord/generatedVideoMessage.ts` wraps the attachment in a Components V2 message. A `MediaGallery` item references the `attachment://` file so Discord renders its inline player, and a `TextDisplay` component places a localized generation time notice ("Generated in Xs") below the player. If Components V2 rendering fails, delivery falls back to a standard attachment-only message.

## Source pointers

- `src/commands/generate/video.ts`: Slash command modal flow and input normalization.
- `src/tools/functionCalls/generateVideoTool.ts`: Built-in tool execution and progress notice dispatch.
- `src/providers/openrouter/openrouterVideoGeneration.ts`: OpenRouter async polling and external HTTP process dispatcher.
- `src/providers/google/googleVideoGeneration.ts`, `src/providers/zai/zaiVideoGeneration.ts`: Native provider video adapters.
- `src/utils/quota/videoQuotaManager.ts`: Quota validation and post-delivery increment logic.
- `src/utils/discord/generatedVideoMessage.ts`: Components V2 media gallery message formatting.
