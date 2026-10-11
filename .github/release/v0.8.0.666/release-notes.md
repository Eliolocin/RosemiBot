# v0.8.0.00a | TomoriBot's Commands are NOT GOOD

![Release Picture](https://github.com/{REPO_OWNER}/{REPO_NAME}/raw/release/.github/release/v0.8.0.00a/not-good.webp)

Hi everyone, Aphthony Pheltano here. The internet's busiest UX nerd, and it's time for a review of TomoriBot's slash commands. The feature discoverability for TomoriBot sucks because its gated behind reading documentation as well as the HUGE list of 200+ slash commands upon typing a `/` in Discord.

And so this update is the first half of the major 0.8 update wherein it simply tightens things in terms of UX, especially for new users by moving lots of commands into panel-styled workflows, as well as renaming and reordering retained commands to cleaner ones (eg. `/conditioning punish` -> `/punish`), along with some other new features. Old users that are used to TomoriBot's convoluted TUI-style management with the tomorillion slash commands might need some time to adjust, but I hope everyone appreciates this update in making their TomoriBot experience better.

How the panels are ordered and how commands were consolidated into them are designed by my dad (who had to fight against Discord API limits), so if you have any ~~complaints~~ suggestions on how to make it more intuitive, bring it to him.

## Command Overhaul
We dropped down from 200+ spread-out commands to just around ~70 consolidated ones which intend to make it easier to configure TomoriBot all around. Some of the commands were also improved as they were turned into panels, for example `/setup` is now smoother and clearer:

### Configuration (The 6 Big Control Panels):
- `/config` = Absorbs behavior, channel overrides, model routing, plugins, and full persona editing (88 commands absorbed)
- `/providers` = Absorbs Discord server AI model providers, custom endpoints, and API keys (11 commands absorbed)
- `/personal` = Absorbs user account preferences, personal model routing, and personal memories/providers (36 commands absorbed)
  - `config` 17 commands absorbed
  - `memories` 11 commands absorbed
  - `providers` 8 commands absorbed
- `/memories` = Absorbs server-owned memories, documents, vectorization, and active STM management (9 commands absorbed)
- `/moderation` = Absorbs member access policies, user blacklists, whitelists, and generation quotas (10 commands absorbed)
- `/help` = Absorbs documentation, setup guides, and provider API-key walkthroughs (19 commands absorbed)

### System Snapshot, Reset & Data Transfer:
- `/status` = Retained as new panel-style command
- `/reset` = Retained category with improved flows
- `/export` = Retained category with improved flows
- `/import` = Retained category with improved flows
- `/nuke` = Purge all data stored by TomoriBot for this server
- `/personal nuke` = Purge all personal data stored by TomoriBot

### Entity Management & Lifecycles:
- `/persona` = Retained as persona creation and remoavl (create, default, export, generate, import, remove)
- `/model override remove` = Retained a command to quickly view and remove overrides
- `/conditioning remove` = Retains one-off all-persona removal modal
- `/impersonate` = Turned into direct subcommands with native inputs (persona, user, system)
- `/setup` = Improved guided setup wizard

### Direct Conversational & Generation Actions:
- `/respond` = Direct message response trigger
- `/kill` = Direct channel generation stream stop
- `/generate` = Creative generation commands (image, video, scene, voice)
- `/novelai generate image` = NovelAI image generation
- `/learn history` = Channel history ingestion (renamed from `/memory history import`)
- `/quota` = Immediate quota counter resets (reset user, reset global)
- `/punish` = Immediate negative conditioning actions (bite, bonk, pinch, spank, squeeze)
- `/reward` = Immediate positive conditioning actions (feed, headpat, hug, kiss, tickle)

### Direct Server Integrations & Administration:
- `/expressions` = Server expression management (edit, initialize)
- `/matrix` = Matrix chat bridge (link, unlink)

### Utility & Diagnostic Tools:
- `/comment` = Context injection comment
- `/compact` = Context window compaction
- `/ping` = Bot latency measurement
- `/refresh` = Channel context refresh + STM clear
- `/tool` = Miscellaneous utilities (delete turn, estimate cost, prompt snapshot)
- `/stats` = Usage analytics dashboards (generate, persona, personal, server)

### Meta, Legal & Bot Support:
- `/contribute` = Project contributions
- `/donate` = Supporter donations 
- `/legal` = Legal agreements & policies (license, privacy, terms)
- `/nsfw` = Age-restricted jailbreak toggles
- `/scheduled-task` = Scheduled tasks management (edit, remove)
- `/support` = Support server invite
- `/update` = Version & update check

## New Features
- (Thanks Palinalif!) Added support for NovelAI's new V5 Curated & Full image models
- (Thanks Palinalif!) Added `/novelai usage` command which allows NovelAI Opus subscribers to see their V5 usage limits.
- You can now use `/personal config` to change what each persona calls you, rather than just having one global nickname
- You can now set your gender/pronouns in `/personal config`, which Tomori will see in her context
  - This setting can also dynamically affect sample dialogues/prompt content through a prompt macro (eg. Nerine's Master vs Mistress, or Rose's "Bro" vs "Gurl").
- New `update_user_info` tool that allows TomoriBot to automatically set `/personal` settings for the user by themselves
  - So users can teach TomoriBot special dynamic settings such as their nickname, gender, and timezone without them having to run `/personal` commands themselves.
- "What You Can Do" error tips are now buttons that expand a text modal. "Fallback Used" buttons now also expand a text modal rather than an ephemeral text embed.
- `/impersonate persona` now accepts and properly parses sprite attempts like typing in "(shocked): WTF" or "Tomori (shocked):" if its an actual match
- `/persona import` now supports V3 character cards (.charx format on sites like botbooru)
- You can now register extra models for any API provider supported by Tomoribot, not just OpenRouter (useful if the curated lists for NVIDIA NIM, etc. do not contain your desired model)
- Tomori now loads "{user} pinned a message" in context, if a message pin action is inside her context window
- Data control commands such as `/nuke`, `/reset`, `/import`, and `/export` are now improved, allowing you to reliably clear, restart, as well as backup your TomoriBot data with more options.
- Improved TomoriBot's highest humanizer degree:
  - Commas now have a 40/40/20 split chance of: removing the comma (was the default), preserving it, or turning the comma into a newline
  - Exclamation marks and question marks now have a 50/50 split chance of: doing nothing (was the default) or flushing the stream chunk 
- Whenever an STM nudge fires, it will now always show the update_short_term_memory tool even in deliberate tool mode

### TTS Additions
In preparation for some TomoriBot voice chat work, more local TTS options have been added. Check out the [official docs page](https://docs.tomoribot.app/en/self-hosting/local-endpoints/text-to-speech/) for it to choose the right one for your setup.
- New `/generate voice-message` command that allows you to create a request to your TTS provider/endpoint manually without having to ask TomoriBot. Useful for iterating/testing over multiple voices
- Updated Irodori TTS support to latest v4.1 version (REALLY good at Japanese anime voice cloning, and fast too)
- Added Fish Audio S2 Pro local TTS support, a high-quality 4B multilingual voice-cloning model with controls like [whisper], [excited], and [angry] (about 11 GB VRAM with the default INT8 model, Linux/WSL2 recommended unless you enjoy watching Windows PyTorch dequantize 4 tomorillion weights by hand, one token at a time).
- Added VoxCPM2 local TTS support, a 2B model that can clone voices or create one from a description across 30 languages (about 8 GB VRAM)
- Added MOSS-TTS local support (4b), 31 languages, including Japanese for voice cloning and for voice desin.
- Added CosyVoice 3 local TTS support, a smol 0.5B model with cross-lingual voice cloning, letting a voice sampled in one language speak another, with controls for dialect, emotion, speed, and volume.
- Added Chatterbox Nano instructions in the docs' `/self-hosting/local-endpoints/text-to-speech/chatterbox.md`

## QoL and Bug Fixes
- TomoriBot now runs Bun 1.4.0 (the ~~slopped~~ Rust rewrite) which consumes much less memory (use `bun upgrade` then `bun run update`)
- Multiple commands now allow you to search and select the persona as a command parameter instead of having to select it through a paginated modal flow.
- `/punish` and `/reward` now auto-target the last persona in chat
- Server members without the proper permissions now cannot add/edit/remove attributes & sample dialogues by default (tweak with `/moderation`)
- Updating TomoriBot's avatar while she's on a default persona will now also remove all associated default sprites automatically.
- "Thought Logs" channel is now just named "Logs"
- Custom Endpoint user flows now consistently instruct users to use the `/v1` format, but will automatically correct bare URLs for compatible endpoints if omitted.
- OpenRouter catalogue now refreshes everytime a model addition is attempted (now using `/providers` or `/personal providers`)
- MCP views (now in `/config > Plugins`) now show the exact tools it provides to TomoriBot
- Failed tool calls due to truncation/unclosed JSON formats will now be recovered best-effort.
- Importing a new main persona now cleans up the replaced persona's sprites instead of causing the new persona to inherit them
- Fixed bug wherein `/impersonate user` generation errors do not surface any error messages
- Fixed a bug where pinning a persona's message would cause them to reply
- Fixed bug wherein if a new user enters the server but leaves right before the designated welcome delay, Tomori still welcomes this phantom member
- Max default MCPs per server increased to 10 from 5
- Fixed bug where OpenRouter models could still use tools even if it was explicitly disabled through settings
- Fixed bug wherein if newly imported personas' first message is a voice message, their avatars would not update
- Fixed bug wherein newly imported personas would not count purely tool call responses (like a voice message) as their first meeting with you
- Fixed bug wherein custom OpenRouter models display $0 cost for their stats
- Fixed bug wherein two default personas could exist in one server, causing `/setup` to always fail
- Fixed bug where DeepSeek didn't work with prefill text through `/respond`
- Fixed bug wherein /persona generate was using old, deprecated Google models for its search grounding
- Fixed bug wherein OpenRouter image models always fail (OR endpoint change)
- Fixed bug wherein diacritics can act as word boundaries which cause accidental keyword-based triggers

## Dev-Facing
- The new modernized commands uses routing with panel event handlers, so panel buttons will still work properly even after restarting the bot, better for iterating.
- Test scripts such as `vl` and `check-locales` now print compact summaries unless the `--verbose` flag is passed.
- Files that are not used for majority of local setups (such as Terraform, cloud deploys, and release assets) have been removed from the `main` branch, but are still available in the `release` branch.

## New Languages
These languages (chosen through prod statistics) will roll-out slowly as of this release's drop, covering all user-facing text, majority of docs, as well as localized default personas (that's right, French Lilya):
- Brazilian Portuguese (Português do Brasil)
- Spanish (Español)
- French (Français)
- Traditional Chinese (繁體中文)
- Simplified Chinese (简体中文)
- Vietnamese (Tiếng Việt)
- Russian (Русский)
- Korean (한국어)
-# Translations will be made with Generative AI (Gemini, with its highest MMLU trust-me-bro scores), if there are any mistranslations, please open an `Issue`