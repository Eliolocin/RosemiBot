# v0.8.1.00 | Natural Nudges Update

![Release Picture](https://github.com/{REPO_OWNER}/{REPO_NAME}/raw/release/.github/release/v0.8.1.00/natural-cheating.webp)

Was holding myself back to name it NNN (Natural Nudge November) but I lost and decided to bust it out this October instead. This update contains the long-awaited Natural Nudges update which allows your personas to reach out to you, your server's members, or to other personas autonomously without you mentioning them, just like how a "human" would do. Included are a bunch of QoL updates and new minor features:

## New Major Features
### Natural Nudges
All servers running this update are eligible for Nudges. The more messages sent to TomoriBot, the higher the chances of them happening at four different levels: server/persona/channel/user. There are two types of Nudges:
- **Idle Nudge** = messages that TomoriBot send in a channel that has gone too quiet, she can do the following, with 28 total different variations (each Default Persona also have their own special Nudges... and you can give your own custom personas their own too!), all of which get even more varied as it is adapted to your persona's *Interests* and personality:
  - Ping a user directly (granted they're close enough to her (persona-based))
  - Start a new topic
  - Revive the past topic
  - Talk to another persona
- **Active Nudge** = messages that TomoriBot sends if a persona wants to join in on an ongoing conversation because it matches their *Interests*. Some personas are more talkative than others (shy babies like Lilya would rarely speak up, unless you tweak them)
New commands to allow you to fully customize this behavior, as well as add your own:
- `/config > Plugins > Natural Nudges` = Change how often they happen, where, and what model powers them (Decision models recommended for Active Nudges). By default, all servers are set to have them rarely as to prevent surprise costs, if you want them to yap more proactively, please tune it up here!
- `/config > Persona > Nudges` = Customize a persona's *Interests*, special Nudges and talkativeness
- `/nudge-studio` = Customize serverwide nudges as well as their availability.
Read more about them in the [official docs](https://docs.tomoribot.app/en/features/chatting-personality/natural-nudges/)
### Built-In Danbooru
Danbooru searches as an MCP server is unreliable, so TomoriBot now directly integrates with Danbooru API to help with image generations esp. with imageboard-trained models.
- TomoriBot now has a built-in Danbooru tag tool that allows her to accurately search valid tags for image generation for imageboard-style imagegen prompts (eg. for NovelAI). Disable through `/config > Plugins > Tools`
- Added `/booru search` which allows you to quickly return pictures from Danbooru using tag search (limited to 2 due to API limits). Explicit/Questionable images can only be sent in NSFW channels, and will be spoiler-tagged (Sensitive Images are also spoiler-tagged incase)
### PluralKit and PluralBuddy Support
Much better accessibility for plural users that are using TomoriBot, the bot now recognizes alternate identities by using an opt-in `/personal message-proxy` service command. Turning it on would give your messages a very short buffer where PluralKit or PluralBuddy bot is present to see if a proxy will be done:
- Each identity has its own memory
- TomoriBot recognizes each identity as an individual part of your system
- You can use `/personal` commands with the optional `identity` parameter which points to your other identities, so you can easily manage memories, attributes, etc.
## Minor Features
- TomoriBot now accepts fractional/decimal timezone offsets like 5.5 or 5:30 (useful for users in parts of Canada, Australia, etc.)
- Whenever the main text model fails generation mid-stream of response, the fallback model will now continue the message rather than fully discarding it.
- Support for AI Provider-sourced TTS endpoints (OpenRouter and Gemini/Vertex for now)
- During a web search tool call, if Brave/SearXNG is unavailable and the current request is from OpenRouter, TomoriBot falls back to using OpenRouter's built-in search API instead
- You can now activate Voice Design and Voice Clone TTS models separately, allowing you to use different providers for each
- TomoriBot now creates new temporary webhooks if Discord PATCH request rate limits are hit instead of waiting, meaning locally hosted TomoriBots now send alter personas/sprites faster, especially in high volume within a channel
## QoL and Bug Fixes
- Better error messages across the board
- Documents/memories scoped to a channel now also work inside Threads inside that channel properly
- Reminders and random triggers in an empty channel no longer leave a blank `⠀` placeholder message behind
- Made `/config > Persona > Voice` page more intuitive by allowing users to edit the persona's voice clone source/prompt as well as which one to prioritize, even if there is no TTS model currently active
- Added QoL for `/config > Persona` wherein if you're in a different page, choosing a different persona in the dropdown does not reset you back to the first `Identity & Personality` page
- Added QoL for `/status` wherein if you're in a different page, choosing a different persona in the dropdown does not reset you back to the first page
- Response drafter now sees tool call choices in sequence, so it knows if the main author model is attempting multiple tool calls rather than just one
- You can now run `/personal` commands even in servers where TomoriBot setup is not yet finished
- `/config > Behavior` now notes the user if a SillyTavern Preset is active and their system prompt is being overriden by it
- `/stats generate` is now split into 3 different subcommands rather than being a single command that are only distinguished through its `type` parameter
- Moved Decision Model choice from `/config > Plugins > Response Drafting` to `/config > Models`
- Made `/persona export||remove` use Autocomplete field + Export JSON parameter as optional true or false instead of old modal flow
- TomoriBot now auto-disables MCP servers that continuously fail their initial connections
- "Analyzing image..." notice embed is now opt-in by default
- Adding channel tags to memories or `/learn history` now use an intuitive channel selector modal instead of having to type their exact names in a string input field
- Fixed bug wherein TomoriBot's cross channel tool would bypass privacy settings of users if `peek` was enabled
- Fixed bug wherein if welcomed user triggers TomoriBot before welcome message finishes, it would send double the messages
- Fixed bug wherein 'Models > Fallbacks' sometimes showed "None" for slots that *do* have a model registered under it
- Fixed bug wherein the `/config > Response Drafting` page would fail loading if there is no registered Rule Checker MCP
- Fixed bug wherein some non-English locales would cause modal errors when loading some command panel pages due to string length violations
- Fixed bug wherein prompts sent to the Response Draft subagent would have their content redacted
- Fixed bug wherein if the bot tries to mention a user that has a period in their name, the mention would break
- Fixed bug wherein if a model fails after tool calls, the fallback model that recovers the request would forget that it already did the tool calls
- Bug wherein pure video/audio file replies (no accompanying text) to a persona/sprite webhook would not trigger a response from TomoriBot
- Fixed bug whenever a persona tries to impersonate another persona with a sprite tag (eg. `shocked`), it would not also render the sprite properly
- Fixed bug wherein User Impersonation webhooks wouldn't trigger from direct replies
