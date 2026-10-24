export default {
  help: {
    description: `Browse setup, features, providers, memory, behavior, tools, media, and integration guides.`,
    dashboard: {
      categories: {
        setup: `Setup`,
        features: `Features`,
        moderation: `Moderation`,
        plugins: `Plugins`,
      },
      pages: {
        custom_endpoints: `Custom Endpoints`,
      },
      page_reference: `the **{page}** page in \`/help\``,
      page_select_placeholder: `Choose a page`,
      subsection_select_placeholder: `Choose a topic`,
      provider_select_placeholder: `Choose Provider`,
      optional_provider_select_placeholder: `Optional Services`,
      previous_button: `← Previous`,
      next_button: `Next →`,
      docs_link_label: `Read the Web Version`,
      support_link_label: `Get Technical Support`,
      sections: {
        getting_started: `Getting Started`,
        getting_started_description: `Key, triggers, persona, and what to try next`,
        personal_profile: `Personal Profile`,
        personal_profile_description: `Your nickname, your memories, your own provider`,
        custom_endpoints: `Custom Endpoints (Advanced)`,
        custom_endpoints_description: `Register an endpoint you run or trust`,
        multiple_personas: `Multiple personas`,
        multiple_personas_description: `Keep several identities and import character cards`,
        media_generation: `Media generation`,
        media_generation_description: `Make images, video, and voice messages`,
        tons_of_tweakability: `Tons of Tweakability`,
        tons_of_tweakability_description: `Where behavior, server, and personal settings live`,
        memory: `Memory`,
        memory_description: `What I remember, and for how long`,
        scheduled_tasks: `Scheduled Tasks`,
        scheduled_tasks_description: `Reminders and tasks I come back for on my own`,
        server_moderation: `Server Moderation`,
        server_moderation_description: `Who may use me here, and where`,
        quotas: `Quotas`,
        quotas_description: `Cap how much generation this server allows`,
        age_restricted_commands: `Age-Restricted Commands`,
        age_restricted_commands_description: `Adult features, and what I do not filter`,
        user_byok: `User BYOK (Advanced)`,
        user_byok_description: `Make every member bring their own key`,
        sillytavern_presets: `SillyTavern Presets`,
        sillytavern_presets_description: `Build my prompts from an imported preset`,
        mcp_servers: `MCP Servers`,
        mcp_servers_description: `Connect external tools I can actually use`,
        matrix: `Matrix`,
        matrix_description: `Bridge a Matrix room to a Discord channel`,
      },
      subsections: {
        get_api_key: `Get an API Key`,
        get_api_key_description: `Where to get one, and how to keep it safe`,
        change_trigger_behavior: `Change Trigger Behavior`,
        change_trigger_behavior_description: `When and where I am allowed to answer`,
        create_first_persona: `Create your First Persona`,
        create_first_persona_description: `Edit me, generate a new one, or import one`,
        explore_features: `Explore my Features!`,
        explore_features_description: `A short tour of what I can do now`,
        nickname_pronouns: `Your Nickname and Pronouns`,
        nickname_pronouns_description: `How I address you, in every server`,
        personal_memories: `Personal Memories`,
        personal_memories_description: `What I remember about you specifically`,
        personal_providers: `Personal Providers (Advanced)`,
        personal_providers_description: `Answer with your own key and model`,
        text_models: `Text Models`,
        text_models_description: `Register a chat endpoint and its model`,
        comfyui: `ComfyUI (for video and image)`,
        comfyui_description: `Upload a workflow and generate from it`,
        text_to_speech: `Text-to-Speech (for voice)`,
        text_to_speech_description: `Give each persona a real voice`,
        image_generation: `Image Generation`,
        image_generation_description: `Draw your prompt, or the current scene`,
        video_generation: `Video Generation`,
        video_generation_description: `Short clips, with an optional first frame`,
        speech_generation: `Speech Generation`,
        speech_generation_description: `Turn text into a voice message`,
        art_search: `Art Search`,
        art_search_description: `Post existing anime art from Danbooru`,
        behavior_tuning: `Behavior Tuning`,
        behavior_tuning_description: `Model, humanizer, instructions, and tools`,
        server_wide_settings: `Server-wide Settings`,
        server_wide_settings_description: `Boundaries that apply to everyone here`,
        personal_settings: `Personal Settings`,
        personal_settings_description: `Your preferences, in every server`,
        long_term_memory: `Long-Term Memory`,
        long_term_memory_description: `Facts I keep permanently`,
        short_term_memory: `Short-Term Memory`,
        short_term_memory_description: `My working note of this conversation`,
        rewards_punishments: `Rewards and Punishments`,
        rewards_punishments_description: `Gestures I notice and remember`,
        memory_tagging: `Memory Tagging (Advanced)`,
        memory_tagging_description: `Wake a memory only when it is relevant`,
        blacklisting: `Blacklisting`,
        blacklisting_description: "Make me ignore one member completely",
      },
    },
    breadcrumbs: {
      persona: {
        general: `Persona > Identity & Personality`,
        advanced: `Persona > Advanced`,
        voice: `Persona > Voice`,
        sprites: `Persona > Sprites`,
        triggers: `Persona > Triggers`,
      },
      behavior: {
        general: `Behavior > General Behavior`,
        trigger: `Behavior > Trigger Behavior`,
        memory: `Behavior > Advanced Memory`,
      },
      channels: {
        destinations: `Channels > Logs & Welcome`,
        "auto-trigger": `Channels > Auto-Trigger`,
        overrides: `Channels > Channel Overrides`,
      },
      plugins: {
        "available-tools": `Plugins > Available Tools`,
        "mcp-servers": `Plugins > MCP Servers`,
        "sillytavern-presets": `Plugins > SillyTavern Presets`,
      },
      models: {
        switch: `Models > Switch Models`,
        voices: `Models > TTS Parameters & Voices`,
        image: `Models > Image Generation Defaults`,
        parameters: `Models > Text Samplers & Parameters`,
      },
      personal: {
        profile: {
          general: `Profile > General Preferences`,
        },
        privacy: {
          controls: `Privacy > Privacy Controls`,
        },
        models: {
          switch: `Models > Switch Models`,
        },
        advanced: {
          spotlight: `Advanced > Personal Spotlight`,
        },
      },
      moderation: {
        "member-access": `Member Access`,
        "user-blacklist": `User Blacklist`,
        whitelist: `Whitelist`,
        quotas: `Quotas`,
      },
    },
    features: {
      title: `TomoriBot Features (Version {version})`,
    },
    matrix: {
      bot_user_fallback: `the configured Matrix bot account`,
    },
    "api-key": {
      provider_choice_brave: `Brave Search`,
      provider_choice_google: `Google Gemini (Recommended, Free)`,
      provider_choice_deepseek: `DeepSeek`,
      provider_choice_custom: `Custom Endpoint`,
      provider_choice_nvidia: `NVIDIA NIM (Free)`,
      provider_choice_novelai: `NovelAI`,
      provider_choice_openrouter: `OpenRouter (Recommended)`,
      provider_description_google: `General-purpose and has generous free usage`,
      provider_description_openrouter: `Paid but reliable and flexible; can generate images, videos, and voice`,
      provider_description_deepseek: `Cheaper paid alternative that is fairly uncensored`,
      provider_description_novelai: `For uncensored role-playing, storytelling, and image generation`,
      provider_description_nvidia: `Hosted text, embedding, and image models`,
      provider_description_zai: `GLM text and image models with coding-use policy limits`,
      provider_description_vertexexpress: `Gemini through Google Cloud with API key authentication`,
      provider_description_vertex: `Enterprise Gemini through Google Cloud credentials`,
      provider_description_custom: `Self-hosted or proxy endpoint; authentication may be optional`,
      provider_description_brave: `Optional web, image, video, and news search`,
      provider_description_elevenlabs: `Speech and transcription API, not a text model`,
      provider_choice_zai: `Z.ai`,
      provider_choice_vertex: `Google Vertex AI`,
      provider_choice_vertexexpress: `Google Vertex AI Express`,
      provider_choice_elevenlabs: `ElevenLabs TTS`,
      brave_title: `Setting Up Brave Search API Key`,
      brave_description: `Brave Search is optional and only enhances my search capabilities. It does NOT power my AI as that's handled by your main provider.
- Enables image, video, and news search
- Provides real-time information from the internet
- Enhances my ability to answer current questions`,
      brave_getting_key_title: `Getting Your API Key:`,
      brave_getting_key_description: `1. Visit [Brave Search API](https://brave.com/search/api/)
2. Sign up for a free account
3. Navigate to your [API Keys](https://api-dashboard.search.brave.com/app/keys) section in the Dashboard
4. Create a new API key
5. Copy and input your API key using the {configBraveapiSet} command`,
      brave_important_title: `Important Notes:`,
      brave_important_description: `- This is separate from your main AI provider
- Without Brave API key, I can still function and use built-in web search
- Brave includes $5 in free monthly credits, but usage above that can be billed. If you only want the free tier, set a $5 usage limit in the [Brave usage limits dashboard](https://api-dashboard.search.brave.com/app/subscriptions/usage-limits)`,
      brave_footer: `For your main AI provider, choose another provider from the API Keys page in \`/help\``,
      google_title: `Setting Up Google Gemini API Key`,
      google_description: `Google Gemini offers free and paid tiers with powerful AI models.
- Free tier available
- [Gemini Privacy Policy](https://ai.google.dev/gemini-api/terms)`,
      google_getting_key_title: `Getting Your API Key:`,
      google_getting_key_description: `1. Visit [Google AI Studio](https://aistudio.google.com/apikey)
2. Click \`Create API Key\` on the top-right (create a new Project if needed)
3. Copy this API key into {configSetup} or {configApikeySet}`,
      google_footer: `After setting up this provider, you may change its default model with {configModel}`,
      deepseek_title: `Setting Up DeepSeek API Key`,
      deepseek_description: `DeepSeek is a pay-as-you-go text provider.
- [DeepSeek API Docs](https://api-docs.deepseek.com/)`,
      deepseek_getting_key_title: `Getting Your API Key:`,
      deepseek_getting_key_description: `1. Visit [DeepSeek API Keys](https://platform.deepseek.com/api_keys)
2. Sign in or create a DeepSeek platform account
3. Create a new API key
4. If needed, add credits in your DeepSeek platform account before use
5. Copy this API key into {configSetup} or {configApikeySet}`,
      deepseek_footer: `After setting up this provider, you may change its default model with {configModel}`,
      custom_title: `Custom Endpoint Setup`,
      custom_description: `The legacy inline Custom Provider flow has moved.

For server-scoped endpoints, use {configSetup} and choose **Custom Endpoint (finish after setup)**, then run {configCustomModelsAdd} and select it with {configModel}.

For personal endpoints, use {personalCustomModelsAdd}.

Use {helpCustomModels} for the full command guide, supported endpoint types, and capability notes.`,
      nvidia_title: `Setting Up NVIDIA NIM API Key`,
      nvidia_description: `NVIDIA NIM provides hosted text, embedding, and image APIs through NVIDIA Build.`,
      nvidia_getting_key_title: `Getting Your API Key:`,
      nvidia_getting_key_description: `1. Visit [NVIDIA Build](https://build.nvidia.com/)
2. Sign in or create an NVIDIA developer account
3. Create or manage your API keys from the [API Keys page](https://build.nvidia.com/settings/api-keys)
4. Copy this API key into {configSetup} or {configApikeySet}`,
      nvidia_important_title: `Important Notes:`,
      nvidia_important_description: `- Text and embeddings use NVIDIA's hosted \`integrate.api.nvidia.com\` surface
- Native image generation uses NVIDIA's hosted \`ai.api.nvidia.com\` FLUX endpoint`,
      nvidia_footer: `After setting up this provider, you may change text, embedding, and image models with {configModel}, {configModelEmbedding}, and {configModelImage}`,
      zai_title: `Setting Up Z.ai API Key`,
      zai_description: `Z.ai provides access to the GLM family through a general API and a separate coding endpoint.

⚠️ **Terms of Service Update:** Z.ai's ToS have been updated to only permit coding/agent use cases. Using the general endpoint for non-coding chat is at your own risk and may violate their terms.`,
      zai_getting_key_title: `Getting Your API Key:`,
      zai_getting_key_description: `1. Visit the [Z.ai Platform](https://z.ai)
2. Sign in or create an account
3. Navigate to API Keys in your dashboard
4. Create a new API key
5. Copy this API key into {configSetup} or {configApikeySet}`,
      zai_important_title: `Important Notes:`,
      zai_important_description: `- Use the general endpoint for normal chat, reasoning, and native image generation
  - The dedicated Coding endpoint is separate and intended for coding-specific workflows
  - ⚠️ Z.ai's ToS restricts usage to coding/agent scenarios only, general chat/roleplay use is at your own risk`,
      zai_footer: `After setting up this provider, you may change its default model with {configModel}`,
      novelai_title: `Setting Up NovelAI API Key`,
      novelai_description: `NovelAI is a subscription-based service focused on creative storytelling and roleplay.
- Unlimited uncensored messages
- Supports uncensored text generation and NovelAI image generation, which is configured separately
- NovelAI text models do not support vision input
- [NovelAI Terms of Service](https://novelai.net/terms)`,
      novelai_getting_key_title: `Getting Your API Key:`,
      novelai_getting_key_description: `1. Visit [NovelAI](https://novelai.net/stories)
2. Navigate to settings through the ⚙️ icon on the top-left
3. Go to \`Account\`
4. Look for \`Get Persistent API Token\` (subscription required!)
5. Copy this API key into {configSetup} or {configApikeySet}`,
      novelai_footer: `After setting up this provider, you may change its default model with {configModel}`,
      openrouter_title: `Setting Up OpenRouter API Key`,
      openrouter_description: `OpenRouter provides access to multiple AI models from different providers on a pay-as-you-go basis.
 - Access to latest and most powerful AI models (some are free)
 - [OpenRouter Terms of Service](https://openrouter.ai/terms)`,
      openrouter_getting_key_title: `Getting Your API Key:`,
      openrouter_getting_key_description: `1. Visit [OpenRouter](https://openrouter.ai/settings/keys)
2. Click \`Create API Key\`
3. Copy this API key {configSetup} or {configApikeySet}`,
      openrouter_important_title: `Important Notes:`,
      openrouter_important_description: `- **Free models have strict rate limits**; paid models are usually more reliable
- **Always check pricing** before selecting a model
- Your OpenRouter account settings still apply here
- If you need a model that is not listed, suggest it in {supportServer}`,
      openrouter_footer: `After setting up this provider, you may change its default model with {configModel}`,
      vertex_title: `Setting Up Google Vertex AI`,
      vertex_description: `Google Vertex AI provides enterprise-grade access to Gemini models through Google Cloud.
- Uses Application Default Credentials (ADC) for authentication, no API key to manage
- Uses local gcloud ADC or a hosted workload identity/service account
- [Vertex AI Documentation](https://cloud.google.com/vertex-ai/docs)`,
      vertex_getting_key_title: `Configuration:`,
      vertex_getting_key_description: `**Step 1: Install the [Google Cloud CLI](https://cloud.google.com/cli)**

**Step 2: Create a Google Cloud project**
Run: \`gcloud projects create PROJECT_ID --name="Vertex AI Project"\`
(replace \`PROJECT_ID\` with a globally unique ID, e.g. \`my-vertex-project-12345\`)

**Step 3: Set it as your active project**
Run: \`gcloud config set project PROJECT_ID\`

**Step 4: Link a billing account**
Run: \`gcloud billing accounts list\` to find your billing account ID,
then: \`gcloud billing projects link PROJECT_ID --billing-account=ACCOUNT_ID\`

**Step 5: Enable the Vertex AI API**
Run: \`gcloud services enable aiplatform.googleapis.com\`

**Step 6: Set up Application Default Credentials**
Run: \`gcloud auth application-default login\` and log in via your browser.

**Step 7: Enter your configuration**
Enter \`{project_id}::{location}\` using {configSetup} or {configApikeySet}
- Use \`global\` as the location (recommended for preview models and best availability)
- Example: \`my-vertex-project-12345::global\``,
      vertex_important_title: `Important Notes:`,
      vertex_important_description: `- The stored value is **configuration** (project + location), not a credential secret
- All Vertex requests use the host's Application Default Credentials identity
- An AI Studio API key alone does not authenticate this provider. The project must have billing and the Vertex AI API enabled, and the host identity needs Vertex access.
- Supports chat, tool calling, streaming, structured output, compaction, embeddings, and preset generation`,
      vertex_footer: `After setting up this provider, you may change its default model with {configModel}`,
      vertexexpress_title: `Setting Up Google Vertex AI Express`,
      vertexexpress_description: `Google Vertex AI Express provides API-key access to Gemini on Vertex AI.
- Uses your own Google Cloud API key instead of host Application Default Credentials
- Best for deployed TomoriBot BYOK setups where each user stores their own key
- Preview feature with a smaller Gemini-only model catalog
- [Vertex AI Express Mode Overview](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/overview)`,
      vertexexpress_getting_key_title: `Setup Steps:`,
      vertexexpress_getting_key_description: `1. Open [Vertex AI Express Mode](https://console.cloud.google.com/expressmode)
2. If Google redirects you to standard Google Cloud, use the separate \`vertex\` provider instead. This is because Express Mode only works with Google accounts that have not created a billed GCP account yet.
3. In the Express console, open **APIs & Services > Credentials** and copy the Express API key
4. Add that raw API key with {configSetup} or {configApikeySet}
5. Choose a Vertex AI Express model with {configModel}`,
      vertexexpress_important_title: `Important Notes:`,
      vertexexpress_important_description: `- Store the raw API key, not \`{project_id}::{location}\`
- No location setting is needed here; \`global\` is only for the separate \`vertex\` provider
- Full Google Cloud Vertex projects should use \`vertex\`, not \`vertexexpress\`
- Model availability is limited to the Vertex AI Express Gemini catalog
- Image generation is available, but video and embeddings are not
- Express Mode is currently a Google Preview feature`,
      vertexexpress_footer: `After setting up this provider, you may change its default model with {configModel}`,
    },
    elevenlabs: {
      description: `Learn how to set up ElevenLabs text-to-speech`,
      title: `Setting Up ElevenLabs TTS`,
      getting_key_title: `Getting Your API Key:`,
      getting_key_description: `1. Visit [ElevenLabs](https://elevenlabs.io/app/settings/api-keys)
2. Sign up or sign in to your account
3. Create a new API key
4. Copy this API key using {configSpeechElevenlabs}`,
      choosing_voice_title: `Choosing a Voice:`,
      choosing_voice_description: `After setting up your API key, use {configSpeechVoiceAssign} to browse available voices.
- Add more voices from the [Voice Library](https://elevenlabs.io/app/voice-library), where you can also clone your own voices.`,
      free_voices_title: `Premade Voices (Free Tier):`,
      free_voices_description: `Only premade voices work on the free plan. Browse the full list at [ElevenLabs Premade Voices](https://elevenlabs-sdk.mintlify.app/voices/premade-voices), then use {configSpeechElevenlabs} or {configSpeechVoiceAssign} to assign one to each persona.`,
      important_notes_title: `Important Notes:`,
      important_notes_description: `- Characters are counted when I generate and read voice messages
- Free tier has monthly limits; check your usage on the ElevenLabs dashboard
- Visible transcript posting is controlled separately by {configSpeechTranscripts}`,
      footer: `Run {configSpeechElevenlabs} again to update the ElevenLabs key.`,
    },
    getting_started: {
      title: `Getting Started`,
      description: `Guide on how to get started with me and my features`,
      get_api_key: {
        title: `Get an API Key`,
        description:
          "An API key grants me access to an AI provider's model. Whatever I generate is billed to that key, so treat it like any other password. To finish setup I need one:\n> **1.** Pick a provider below to open its guide.\n> **2.** Copy the key it gives you. **Do NOT share it** with anyone, and never paste it into a channel: only into the box {setup} opens for you.\n> **3.** Run {setup} and paste the key when I ask for it.",
        picker_footer:
          "-# If your endpoint isn't listed, skip the key and read **Custom Endpoints (Advanced)** in this same page.",
      },
      change_trigger_behavior: {
        title: `Change Trigger Behavior`,
        description:
          "Out of the box I answer when you say my name, @mention me, or reply to me. You can widen that, narrow it, or turn it off per channel.\n\n**Where I am allowed to speak**\nYou can make me only reply in whitelisted channels. Add them under {moderationWhitelist}.\n> A channel that is not on the list stays quiet.\n\n**Speaking up on my own**\n{configAutoTrigger} lets me automatically send a message either every few messages or at random.\n\n**Trigger me with mentions only**\nDeliberate Trigger Mode prevents me from responding at a simple name call. Makes me wait for @mentions instead. Turn it on in {configBehaviorTrigger}.",
      },
      create_first_persona: {
        title: `Create your First Persona`,
        description:
          "A *Persona* is me with a different name, avatar, personality, and more, but with the same features! Edit the one you already have, or make new ones.\n\n**Change the one you have**\n{configPersonaGeneral} sets my name, personality, and how I address people. {configPersonaAppearance} sets my avatar.\n\n**Write a new one from a sentence**\n{personaGenerate} builds a whole persona from a short description. {personaCreate} gives you the blank template.\n\n**Bring one in from elsewhere**\n{personaImport} accepts character cards downloaded from card sites such as botbooru or chub.",
        footer: "You can keep several personas at once. See **Multiple personas** under Features.",
      },
      explore_features: {
        title: `Explore my Features!`,
        description:
          "Setup is done. Here is what I can do now that I can talk.\n- **Use this server's emoji and stickers** once you run {expressionsInitialize}.\n- **Greet new members** from {configWelcome}.\n- **Remember and remind**: just ask me to remind you, or tell me something worth keeping.\n- **Search the web** and use other tools, switched on in {configTools}.\n- **Make images, video, and voice** with {generateImage}, {generateVideo}, and {generateVoice}.\n\nMost of my switches live in {config}, but not all of them.",
        footer:
          "**Brave Search** adds web results to the search I already do. It needs its own key, and **Get an API Key** under Setup opens its guide from the optional services list. The documentation site is the complete version of this panel, and it explains every setting in detail.",
      },
    },
    personal_profile: {
      title: `Personal Profile`,
      description: "Settings that belong to you and follow you into every server I am in.",
      nickname_pronouns: {
        title: `Your Nickname and Pronouns`,
        description:
          "Tell me what to call you, which I will use everywhere.\n\nSet them in {personalProfile}.\n> Nickname: what I call you instead of your Discord name\n> Prefix and suffix: a title or honorific, like `-san`\n> Pronouns: `she/her`, `they/them`, `any`, or your name\n\nLeave a field blank and I fall back to your live Discord name and the persona's own naming habits.",
        footer: "A single persona can address you differently. Set that under Profile > Persona-specific Preferences.",
      },
      personal_memories: {
        title: `Personal Memories`,
        description:
          "Things I remember about you specifically, in every server.\n\n**Just tell me**\nSay it in chat and I will save it myself. A confirmation message will appear when this happens.\n\n**Or manage them by hand**\n{personalMemories} lists everything I hold about you and lets you edit or delete any single entry.\n\n**Decide how much I may use**\n{personalPrivacy} sets your privacy level, from full personalization down to no personalization at all.",
        footer: "These are separate from this server's shared memories, which anyone here can see and edit.",
      },
      personal_providers: {
        title: `Personal Providers (Advanced)`,
        description:
          "Answer with your own API key and your own model instead of whatever the server uses, everywhere you talk to me.\n\n**Save a provider**\n{personalProviders} stores your key and turns on your personal text model right away.\n\n**Pick a different model**\n{personalModels} switches models, and samplers and fallbacks sit beside it in the same category.\n> Your personal setup only affects replies you trigger.\n> Nobody else in the server is switched over.\n\nSome servers require this. If a server has User BYOK turned on, I cannot answer you until you save a provider here.",
      },
    },
    custom_endpoints: {
      title: `Custom Endpoints (Advanced)`,
      description:
        "Point me at an endpoint you run or trust: Ollama, LM Studio, LiteLLM, KoboldCPP, ComfyUI, or a self-hosted speech server.\n> {providers} registers one for the whole server.\n> {personalProviders} registers one for you alone.",
      text_models: {
        title: `Text Models`,
        description:
          "Choose **Add New Custom Endpoint**, then give it a label, a base URL, and its API style. Add an auth token if it needs one.\n\nSelect the saved label, choose **+ Add new Text Model**, and enter the exact model code the endpoint expects. Adding the model activates it.\n> Declare vision, tool use, and structured output honestly.\n> I trust those flags when I decide what to send you.\n\nSwitch to it later from {configSwitchModels}.",
        footer: "The full API-style and compatibility reference is on the documentation site.",
      },
      comfyui: {
        title: `ComfyUI (for video and image)`,
        description:
          "Build and test the workflow in ComfyUI first, then export it with **Save (API Format)**.\n\nPut the prompt placeholder where the prompt belongs, and the other placeholders wherever you want size, duration, or the model code injected.\n\nRegister the endpoint with API Compatibility `ComfyUI` (for example `http://127.0.0.1:8188`), then add an image or video model to it and upload the exported JSON.\n> The graph has to end in a real save node. Preview-only nodes leave me with no file to download.",
        footer:
          "Ready-made workflows ship in the GitHub repository, and the full placeholder list is on the documentation site.",
      },
      text_to_speech: {
        title: `Text-to-Speech (for voice)`,
        description:
          "Register a speech endpoint the same way, then give each persona a voice.\n\nHosted services and self-hosted servers both work, among them Chatterbox-Turbo, Qwen3-TTS, IrodoriTTS, and ElevenLabs. Register the endpoint, then add a speech model to it.\n> Assign the voice in {configPersonaVoice}.\n> Tune speed and defaults in {configVoices}.",
        footer:
          "Voice messages you send me are transcribed through the same endpoint list, set up the same way. For hosted voices, ElevenLabs has its own guide in **Get an API Key** under Setup, listed with the optional services.",
      },
    },
    multiple_personas: {
      title: `Multiple personas`,
      description: "You can have multiple personas in one server, each with its own name, memories, and agendas!",
      mains_alters_title: `Mains and alters`,
      mains_alters_body:
        "The main persona is the persona representing me in the server. An alter is a second identity I can speak as, with its own name and avatar on the message itself.",
      bringing_in_title: `Bringing a persona in`,
      bringing_in_body:
        "{personaImport} takes a character card as a file:\n> `.png` card, from TomoriBot or SillyTavern\n> `.json` card, from TomoriBot or SillyTavern\n> `.charx` archive, Character Card V3\n\nOnly the character's text is read. Currently, bundled sprites, audio, and video are skipped, so set those yourself under {configPersonaAppearance} and {configPersonaSprites}.",
      where_to_find_title: `Where to find cards`,
      where_to_find_body:
        "Make your own with {personaGenerate} or {personaCreate}, or look for one that already exists.\n\nCard sites such as botbooru and chub host thousands of them. They are other people's sites, and a card written for another bot may not convert cleanly.",
      talking_title: `Letting them talk to each other`,
      talking_body:
        "Give each persona its own trigger words and channels in {configPersonaTriggers}, and they will answer side by side in the same conversation.",
      footer: `Share one of your own with {personaExport}.`,
    },
    media_generation: {
      title: `Media generation`,
      description:
        "I can make images, video, and voice, either from a command or because you asked me to in conversation.\n> Each one counts against a server's quota. See **Quotas** under Moderation.",
      image_generation: {
        title: `Image Generation`,
        description:
          "{generateImage} opens a prompt box. Write your own prompt, or choose **Draw what's happening now** and I will illustrate the scene myself.\n> Attach up to three reference images to steer the result.\n> Pick the aspect ratio in the same box.\n\nAny provider or endpoint saved here that lists image support can draw, and {providers} shows which of yours do. One that cannot use reference images says so and draws from the text.",
        footer: `Defaults live in {configImageDefaults}.`,
      },
      video_generation: {
        title: `Video Generation`,
        description:
          "{generateVideo} takes a prompt, and optionally a starting frame from an image already in the channel.\n\nAny provider or endpoint that lists video support can make one, ComfyUI video workflows included. {providers} shows which of yours do.\n> Video is slow and expensive everywhere. Expect a wait.",
      },
      speech_generation: {
        title: `Speech Generation`,
        description:
          "{generateVoice} turns text into a voice message in the current persona's voice.\n\nA speech endpoint has to be registered first, hosted or self-hosted: see **Custom Endpoints (Advanced)** under Setup.\n> Each persona can sound different. The voice comes from {configPersonaVoice}.",
      },
      art_search: {
        title: `Art Search`,
        description:
          "{booruSearch} posts 4 random well-rated Danbooru images for one or two tags. Suggestions appear as you type, and a nickname or typo turns into the real tag.\n> Questionable and explicit results only show in age-restricted channels.\n\nYou can also just ask me to show you some art; the **Danbooru Search** switch in {configTools} controls that. To limit who can run the command, use Server Settings > Integrations.",
      },
    },
    tons_of_tweakability: {
      title: `Tons of Tweakability`,
      description: `Tweak me to you and your server members' preferences`,
      behavior_tuning: {
        title: `Behavior Tuning`,
        description:
          "How I write, how I think, and what I am allowed to do.\n> **Model**: {configSwitchModels} picks what model is actually answering, as well as its parameters\n> **Humanizer**: {configBehaviorGeneral} controls how humanlike my delivery is, from formal to very casual.\n> **System instructions**: also {configBehaviorGeneral}, for orders that apply to every reply.\n> **Tools**: {configTools} decides which capabilities I may reach for, such as web search or image generation.",
        footer:
          "Sampler-level knobs (temperature and friends) sit under {configParameters} for adjusting randomness, etc.",
      },
      server_wide_settings: {
        title: `Server-wide Settings`,
        description:
          "Boundaries that apply to everyone in this server. Managers only.\n> **Where I talk**: whitelisted channels, per-persona channel limits, and cooldowns, all under {moderation}.\n> **When I talk on my own**: {configAutoTrigger}.\n> **Who may trigger me**: whitelisted roles, also under {moderation}.\n> **Where my notes go**: {configWelcome} sets the log and welcome channels.",
        footer: "Channel-level overrides can give one channel its own model or rules. See {configChannelOverrides}.",
      },
      personal_settings: {
        title: `Personal Settings`,
        description:
          "Your own preferences, which quietly override the server's for replies you trigger.\n> **Who I think you are**: nickname, pronouns, and privacy, in {personalProfile}.\n> **What answers you**: your own provider and model, in {personalProviders}.\n> **How I treat you**: response modes and Personal Spotlight, in {personalConfig}.\n\nEverything here travels with you between servers.",
        footer: "Personal Spotlight lets one persona treat you as its focus, and is set in {personalSpotlight}.",
      },
    },
    memory_catalog: {
      title: `Memory`,
      description:
        "I keep two kinds of memory: lasting facts, and a working note of the conversation happening right now.",
      long_term_memory: {
        title: `Long-Term Memory`,
        description:
          "Facts I keep permanently, for this server or for you.\n\n**Teach me**\nSay it in chat, or add it by hand in {memories} for the server and {personalMemories} for yourself.\n\n**Make me forget**\nThe same two commands list every entry and delete any of them.\n\n**Give me documents**\n{memories} also accepts uploaded files. I read the relevant parts back when they matter, instead of all of it at once by using Retrieval Augmented Generation (RAG).\n> A server memory reaches everyone here. A personal memory only surfaces when you are part of the conversation.",
      },
      short_term_memory: {
        title: `Short-Term Memory`,
        description:
          "My working note of the conversation in this channel right now, kept separately per channel.\n\nI summarize what is happening as we go, so a long thread stays coherent without resending every message.\n> **Refresh cadence**: how often I update that note.\n> **Render mode**: whether the summary replaces the recent messages or sits beside them.\n> **Categories**: up to five labeled fields, such as `Goals` or `Inventory`, instead of one free-form note.\n\nManagers tune all of it in {configAdvancedMemory}, and {memories} can clear an active note.",
        footer: "Ask me to remember something for good and it becomes a long-term memory instead.",
      },
      rewards_punishments: {
        title: `Rewards and Punishments`,
        description:
          "Fun commands I actually notice and remember. Be nice to me, or do not, and I will act accordingly.\n> {reward} for a headpat, hug, kiss, tickle, or feeding.\n> {punish} for a bonk, bite, pinch, spank, or squeeze.",
        footer: `Pick which persona you meant when several are active.`,
      },
      memory_tagging: {
        title: `Memory Tagging (Advanced)`,
        description:
          "By default every memory in scope is sent with every message. Tagging narrows that down.\n> **Keyword tags**: a tagged memory wakes up only when its keyword appears in the conversation. An untagged memory is always active.\n> **Channels**: a server memory can be limited to channels you pick in its form (their threads included), and a personal memory to a `#channel` tag. Both combine with keyword tags.\n\nTurn both on in {configAdvancedMemory}, then use {toolPromptSnapshot} to see exactly which memories are active right now.",
        footer: "Uploaded documents and extracted history can be limited to channels too.",
      },
    },
    scheduled_tasks: {
      title: `Scheduled Tasks`,
      description: `I can respond on a set timer, once or on a repeat.`,
      making_title: `Making one`,
      making_body:
        'Just ask. "Remind me to stretch at 14:30" or "every morning, post the standup question" is enough, and I will set it up and confirm the details.',
      changing_title: `Changing or cancelling one`,
      changing_body:
        "{scheduledTaskEdit} opens any existing task: its content, next trigger time, repeat interval, and whether it pings you. {scheduledTaskRemove} deletes one.",
      who_title: `Who can touch what`,
      who_body:
        "You can always edit your own. Server managers can edit anyone's, since a task posts into a shared channel.\n> Times use the timezone set during setup, so double-check that one before trusting a 6am alarm.",
    },
    server_moderation: {
      title: `Server Moderation`,
      description:
        "Everything about who may use me here, and where. All of it needs the Manage Server permission and lives in {moderation}.\n> **Member Access**: who may trigger me at all, and which models they may reach.\n> **Whitelist**: the channels, roles, and personas I am allowed to answer in.\n> **Quotas**: how much generation this server permits.\n> **User Blacklist**: individual members I must ignore.",
      blacklisting: {
        title: `Blacklisting`,
        description:
          "I ignore a blacklisted member completely. They cannot trigger me in any channel or with any persona, their messages never reach my context, and I refuse the commands that would have me act for them, such as `/respond`, `/reward`, and `/punish`. They also cannot change server memories, attributes, or sample dialogues.\n\nAdd one in {moderationBlacklist}. The same page lists every current entry and removes them, one at a time or in bulk.\n> Blacklisting is about access, not deletion. Memories about that member stay until someone removes them.",
        footer: "To silence a whole channel rather than a person, take the channel off the whitelist instead.",
      },
    },
    quotas: {
      title: `Quotas`,
      description:
        "A quota caps how much generation happens here, so one cannot accidentally spend a month of credits.",
      spent_title: `How it is spent`,
      spent_body:
        "There are three separate pools: text, image, and video. Each one is counted twice, per member and for the server as a whole, and whichever runs out first stops the request.\n> A refused request tells you which pool ran out and when it comes back.",
      limits_title: `Setting the limits`,
      limits_body:
        "{moderationQuotas} sets the daily allowance for each pool. Leave a pool unlimited if you would rather not cap it.",
      starting_over_title: `Starting a pool over`,
      starting_over_body:
        "{quotaResetUser} clears one member's daily usage, and {quotaResetGlobal} clears the server-wide pool. Both need Manage Server.",
      footer: "Pools reset on their own daily. A manual reset is for when someone should not have to wait.",
    },
    age_restricted_commands: {
      title: `Age-Restricted Commands`,
      description: `Adults only. Read this section before turning anything on.`,
      filter_title: `I do not filter by default`,
      filter_body:
        "I ship with no content filter of my own, because filtering degrades ordinary replies as much as it blocks anything else. What is appropriate here is the server manager's call, not mine.\n> Your AI provider still enforces its own rules on its own side, and can refuse a request no matter what is set here.",
      gated_title: `Deliberate adult features are gated`,
      gated_body:
        "Anything explicitly adult sits behind {nsfw} and works only in channels Discord itself marks age-restricted.\n\n{nsfwJailbreaks} chooses which prompt strategies are active for this server. Every one of them is off until a manager turns it on.\n> These strategies change how I am prompted. They can make me refuse less but may also cause unintended behavior.",
      footer:
        "By enabling these, the server's managers confirm the channel is adults-only and take responsibility for it.",
    },
    user_byok: {
      title: `User BYOK (Advanced)`,
      description: "BYOK means bring your own key: every member pays for their own replies with their own provider.",
      changes_title: `What it changes`,
      changes_body:
        "With BYOK on, a message from a member is answered only if that member has saved a personal provider. The server's own provider is not a fallback for them.\n> Turn it on in {moderationMemberAccess}, or choose it during {setup}.",
      suits_title: `Who it suits`,
      suits_body:
        "A large or public server where one shared API key would be drained. A small server is usually happier sharing one provider.",
      members_title: `What members have to do`,
      members_body:
        "Save a key in {personalProviders}. Point them at **Personal Providers (Advanced)** under Setup for the walkthrough.",
      footer: "Servers only. A direct message has no members to bring keys, so the option is not offered there.",
    },
    sillytavern_presets: {
      title: `SillyTavern Presets`,
      description: "Import a SillyTavern prompt preset and I will build my prompts the way that preset says to.",
      importing_title: `Importing one`,
      importing_body:
        "{configStPresets} takes the exported preset JSON, then lets you enable, disable, or remove it later.",
      controls_title: `What it controls`,
      controls_body:
        "The preset takes over prompt ordering and the instruction blocks around the conversation.\n> An enabled preset overrides the system prompt from {configBehaviorGeneral} and the persona prompt from {configPersonaAdvanced}.",
      still_applies_title: `What still applies`,
      still_applies_body:
        "Persona attributes, sample dialogue, memories, and tools are still sent. The preset decides arrangement, not contents.",
      footer: "Turn the preset off to fall back to my own prompt layout with nothing lost.",
    },
    mcp_servers: {
      title: `MCP Servers`,
      description:
        "MCP is a standard way to hand a tool to an AI. Connect one and its tools become things I can actually do.",
      hosted_title: `Hosted servers`,
      hosted_body:
        "{configMcp} takes a URL and an optional auth token. Anything that server exposes appears in my tool list.",
      local_title: `Local servers`,
      local_body:
        "A server running on your own machine works the same way once it is reachable. The documentation site has the walkthrough.",
      before_title: `Before you connect one`,
      before_body:
        "> An MCP server's tools run with whatever access you gave it, and I will use them when they look relevant. Connect servers you trust, and read what their tools do first.",
      footer: `Switch individual tools off any time in {configTools}.`,
    },
    matrix_bridge: {
      title: `Matrix`,
      description: "I can sit in a Matrix room and a Discord channel at once, carrying the conversation between them.",
      linking_title: `Linking a room`,
      linking_body:
        "{matrixLink} connects the current channel to a Matrix room ID, which looks like `!abcdef:matrix.org`. Invite {matrixBotUser} to that room first.",
      reads_title: `How it reads`,
      reads_body:
        "Messages from either side reach me as one conversation, and I answer in both.\n> Attachments, edits, and reactions do not all survive the trip. Text is what travels reliably.",
      footer: "Nothing linked? Check that the invite was accepted before anything else.",
    },
  },
};
