---
title: "Providers & Models"
sidebar:
  order: 1
---

TomoriBot connects to external AI providers rather than hosting a built-in model. You can
connect hosted services like Google Gemini, OpenRouter, and NovelAI, or point her at local
self-hosted endpoints. You need at least one provider to start chatting.

## API Keys
<!-- anchor: api-keys -->

Add a provider key during first-time setup with `/setup`, or later from `/providers` by choosing
`+ Add new Provider`. Keys are encrypted at rest, so no one, including server admins, can read
them back.

`/setup` asks how replies should reach a model before anything else, and the answer decides what it
collects:

| Mode | What it collects |
|---|---|
| AI Provider (Recommended) | A provider from the catalog plus its API key, validated and encrypted as a draft. |
| Custom Endpoint (Advanced) | The endpoint connection and one text model, registered inside the wizard. See [Custom Endpoints](#custom-endpoints). |
| User BYOK (guilds only) | Nothing: the workspace keeps no provider of its own, so members must supply personal ones. |

Nothing is written to the database until you press `Finish Setup`. An abandoned or expired
wizard leaves the workspace's existing provider rows untouched. To replace an existing key, use
`/providers`, because `/setup` will not run on an already configured workspace.

Each provider has its own key-generation steps. In `/help`, choose `Setup`, then
`Get an API Key`, and pick your provider for a step-by-step walkthrough, or use these starting points:

| Provider | Notes | Get a key |
|---|---|---|
| Google Gemini | Free tier, runs every feature. Recommended first setup. | [AI Studio](https://aistudio.google.com/apikey) |
| OpenRouter | One key, many models (some free). | [OpenRouter keys](https://openrouter.ai/settings/keys) |
| NovelAI | Subscription; uncensored storytelling and roleplay (text only). | [NovelAI](https://novelai.net/) |
| DeepSeek | Pay-as-you-go reasoning models. | [DeepSeek](https://platform.deepseek.com/api_keys) |
| NVIDIA NIM | Hosted text, embeddings, and image. | [NVIDIA Build](https://build.nvidia.com/) |
| Anthropic | Claude models via the API (not Claude Code). | [Anthropic](https://console.anthropic.com/) |
| Z.ai | GLM family. ⚠️ ToS restricts usage to coding and agent scenarios. | [Z.ai](https://z.ai/) |
| Vertex AI | Google Cloud via `gcloud` ADC (best for locally-run or dev setups). | see below |
| Vertex AI Express | Google Cloud API-key BYOK (Preview, Gemini subset). | [Express Mode](https://console.cloud.google.com/expressmode) |
| Custom | Any OpenAI-compatible endpoint (Ollama, vLLM, LiteLLM, …). | see [Custom Endpoints](#custom-endpoints) |

:::caution
Never share your API key with anyone else. Add or replace a custom endpoint's Bearer auth token
from its `Edit Endpoint` action in `/providers`.
:::

Vertex AI authenticates with Application Default Credentials (ADC) rather than a stored secret.
For local hosting, ADC can come from `gcloud`; hosted deployments should use a workload identity
or service account. An AI Studio API key alone does not authenticate full Vertex AI. The selected
Google Cloud project must have billing and the Vertex AI API enabled, and the host identity needs
Vertex access. The setup guide is available from Google Vertex AI on the `API Keys` page in `/help`.

Google-backed provider setup validates credentials through the authenticated model-listing
endpoint. It does not generate text or depend on whichever chat model is currently marked as the
catalog default, so a retired default model cannot prevent a valid credential from being saved.

### Optional: Brave Search key

Brave Search is separate from your AI provider and enhances web search with image, video, and
news results. Set it in `/providers`. ⚠️ Brave includes $5/month of free credit, so set a $5
usage limit in the Brave dashboard to avoid unexpected charges.

## Choosing Models

Use `/providers` to manage server credentials, model catalogs, and endpoint registrations.
Then use `/config` > Models > Switch Models to select the shared capability assignments every
member of the server uses. Both commands require server management permissions.

Individual members manage their own credentials and catalogs with `/personal providers`, then
select personal models in `/personal config`. Personal settings follow them across every server
where they use TomoriBot. See
[Personalization](/features/knowledge/personalization/#your-own-providers) for user setup.

The panels are titled `Server Providers` and `Personal Providers` so ownership is clear upon
opening.

In `/config` > Models > Switch Models, you can assign models and endpoints across eight capability slots:

- **Text**: the main chat model.
- **Vision**: reads images when the chat model cannot.
- **Embeddings**: powers the [document knowledge base](/features/knowledge/memory/#document-knowledge-base-rag).
- **Standard Image**: standard image generation (see [Image Generation](/features/capabilities/media-generation/image-generation/)).
- **NovelAI Image**: NovelAI image generation.
- **Video**: video generation.
- **TTS Endpoint**: text-to-speech voice endpoint.
- **STT Endpoint**: speech-to-text audio transcription endpoint.

The first six slots choose model catalog records. The TTS and STT slots choose workspace-scoped
endpoints instead, activating the selected endpoint rather than writing a model column. Register
and edit those endpoints in `/providers`. `/personal config` retains six personal model-routing
slots and does not include personal TTS/STT endpoint selectors.

You can also manage backup keys for automatic failover and load balancing in `/providers`.

## Decision Models

Decision Models are a separate category in `/providers` and `/personal providers`. They answer typed
predicates with probabilities. Registration does not change the active chat model, establish
calibration, or enable response-review skipping. These panels do not yet select a Decision model.

OpenRouter is the supported native provider. Save its key, open its model dropdown, and choose
`+ Add a Decisions Model`. Enter an ID from its verified Decision catalog. The global catalog
includes `typesafe/jev-1.13`; additional registrations belong to their server or personal owner.
Native discovery supplies the documented input limit and prices. Chat catalogs cannot establish
Decision support.

For a custom service, choose `Add New Custom Endpoint`, then `System One compatible` or
`OpenAI Decisions compatible` in `API Compatibility`. Save the API base URL and optional Bearer
credential. Its model dropdown offers `+ Add a Decisions Model` and inherits that protocol. Enter
the documented model ID and input token limit (at least 512). Jev, Laya, and Kev use System One
compatibility. Existing chat-compatible and Ollama-native endpoints do not offer this action.

Bare origins normalize to `/v1`. Explicit versions and gateway prefixes remain intact:
`https://decision.example.invalid/gateway/v1` calls `/gateway/v1/systemone` for System One, or
`/gateway/v1/decisions` for OpenAI Decisions. Reachability uses `GET <stored-base>/models` without sending conversation
data; it does not certify model capabilities. Custom models are registered manually from their
service documentation when discovery cannot establish the necessary capability metadata.

Open a saved Decision registration to edit it. Custom edits preserve its exact model and endpoint
identity. Choose `Delete This Decision Registration` under `Registration Action` to remove it while
retaining the connection and credentials. Removing its parent provider or endpoint removes that
owner's registrations. Other owners retain shared entries. Model lists paginate after 18 editable
registrations using the existing page controls.

Provider registrations and credentials remain outside persona/configuration exports and imports.
Configuration reset preserves saved registrations; parent deletion explicitly cleans them up.

## Custom Endpoints
<!-- anchor: custom-endpoints -->

Custom endpoints let you register self-hosted or proxy-backed services (Ollama, LM Studio,
LiteLLM, vLLM, ComfyUI, local TTS/STT) as labeled provider bundles.

- **Server scope**: open `/providers` for workspace endpoint registration and editing.
- **Personal scope**: open `/personal providers` for personal model catalogs (see
  [Personalization](/features/knowledge/personalization/#your-own-providers)). Personal speech
  endpoints are not selected from `/personal config`.

A label is the user-facing menu name and groups capabilities under one bundle when they share one
endpoint URL. It is never sent to the remote service. Capabilities served from different URLs need
distinct labels.

To add a custom endpoint:

1. In `/providers`, choose `Add New Custom Endpoint`.
2. Select the API compatibility and save the connection. Saving prepares the capabilities
   supported by that protocol without registering any models.
3. Select the new endpoint and use its model dropdown to register an exact model code and
   capability. Adding a model activates it for that capability.
4. Use the same dropdown to attach more models or edit existing registrations. Text models
   declare their own capabilities in that form, and image models declare which request modes
   they support.

For TTS and STT, register the endpoint and its models in `/providers`, then choose and activate the
endpoint in `/config` > Models > Switch Models. Those speech slots select an endpoint rather than a
model catalog entry.

API compatibility determines the request paths and payloads the service implements, so it also
determines which capability slots the connection prepares. Registering exact models for those slots
is a separate step, because the protocol cannot be inferred reliably from the endpoint URL alone.

`/setup`'s `Custom Endpoint (Advanced)` mode performs the same two steps inside the wizard:
`Configure Connection` saves the API compatibility, label, URL, and optional auth token behind a
reachability check, and `Configure Text Model` registers the exact text model and its capability
declarations. The model button stays disabled until the connection validates, and re-saving the
connection clears the model declaration because declarations depend on API compatibility. The wizard
creates the connection, saved provider, model, and active-model rows together when you press
`Finish Setup`. The wizard registers text models only; image, video, TTS, and STT capabilities are
registered in `/providers`.

OpenCode Go (`https://opencode.ai/zen/go/v1`) and OpenCode Zen (`https://opencode.ai/zen/v1`) work as
OpenAI-compatible custom endpoints. TomoriBot sends them the per-conversation session ID they require,
derived from a hash of the channel and persona, so no Discord ID leaves the bot.

For full walkthroughs of running local servers, see:

- [Setup: Local LLM](/self-hosting/local-endpoints/setup-local-llm/): Ollama, KoboldCPP, LM Studio, vLLM, LiteLLM.
- [Setup: ComfyUI](/self-hosting/local-endpoints/setup-comfyui/): local image and video generation.
- [Setup: ChatMock](/self-hosting/local-endpoints/setup-chatmock/): ChatGPT account or Codex CLI.

## Supported Providers
<!-- anchor: supported-providers -->

If you do not have the hardware to host your own models, TomoriBot supports a wide range of
cloud services. Not every feature is available on every provider.

### LLM Providers

| Provider | Streaming | Tool Calling | Image Input | Embeddings | Notes |
|---|---|---|---|---|---|
| Google Gemini | ✅ | ✅ | ✅ | ✅ | Free models available |
| OpenRouter | ✅ | ✅ | ✅ | ✅ | Free models available |
| Anthropic (API) | ✅ | ✅ | ✅ | - | Not Claude Code |
| NovelAI | ✅ | ✅ | - | - | Only GLM 4.6 can use tools |
| NVIDIA NIM | ✅ | ✅ | ✅ | ✅ | Free models available |
| DeepSeek | ✅ | ✅ | - | - | - |
| Z.ai | ✅ | ✅ | ✅ | - | Free models; ⚠️ ToS = coding and agent use only |
| Z.ai Coding | ✅ | ✅ | - | - | Subscription plan |
| Google Vertex AI | ✅ | ✅ | ✅ | ✅ | Includes 'free' Express version |
| Codex CLI (via ChatMock) | ✅ | ✅ | ✅ | - | [Setup](/self-hosting/local-endpoints/setup-chatmock/) |

### Image Generation

| Provider | Text-to-Image | Image-to-Image | Inpainting | Notes |
|---|---|---|---|---|
| Google | ✅ | ✅ | - | - |
| OpenRouter | ✅ | ✅ | - | - |
| NovelAI | ✅ | ✅ | ✅ | Can combine with other providers |
| NVIDIA | ✅ | - | - | Text-to-image only; reference images are ignored |
| Z.ai | ✅ | - | - | - |

These are the defaults a provider's image models start from. NovelAI runs through its own pipeline
rather than this table. Registering an image model through `/providers` lets you declare that
model's own modes, which is how you enable inpainting on a ComfyUI workflow or on a provider model
whose API supports masked editing. A model you never declare keeps following the defaults above.
Declare only what the model supports: TomoriBot offers tools only for the modes you select, and
unsupported modes will fail at generation time.

### Video Generation

| Provider | Text-to-Video | Image-to-Video | Notes |
|---|---|---|---|
| Google | ✅ | ✅ | Async polling workflow |
| OpenRouter | ✅ | ✅ | Async polling workflow |
| Z.ai | ✅ | ✅ | Async polling workflow |

### Voice & Audio

| Provider | Text-to-Speech | Speech-to-Text |
|---|---|---|
| ElevenLabs | ✅ | ✅ |

Local voice engines are covered under [Self-Hosting](/self-hosting/). For built-in web search and
URL reading, see [Tools & Extensions](/features/capabilities/tools-and-extensions/#web-search--url-reading).
