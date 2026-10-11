# v0.8.0.666 | Locketober Update

![Release Picture](https://github.com/{REPO_OWNER}/{REPO_NAME}/raw/release/.github/release/v0.8.0.666/locke-ura.gif)

It's spooptober and what better way to kick it off with a new default persona that's scary to use? Not because the persona itself has jumpscares, but because there's a chance of a ban email from Discord or your provider right after using her. But I'm pretty sure some people have been using TomoriBot for more depraved purposes and if I were you, Jon, I'd use a ZDR provider outside of a proprietary messaging app for ERP... you and me both.

## New Major Features
### New Persona: Unhinged Tomori
A psychopathic sadist inside a masochistic half-goat body, Locke (Unhinged Tomori) acts like the curious user that likes to treat living beings as toys, sometimes a voice speaks to him (now, her) to go even further, or to just give in to being a ~~power~~ bottom. For people that:
- Want a persona that doesn't back out from degenerate discussions
- Need someone to enable them to be vile in a Discord server
- Like the "uninstalled door" type: unhinged and ready to be mounted
Note that Locke is gated behind `/nsfw persona default` which can only be run inside NSFW channels. You can still trigger Locke in non-NSFW channels thereafter.

### Response Drafting
Added new plugin called "Response Drafting", which can be toggled on in `/config > Plugins > Response Drafting`. Turning it on will cause all replies to undergo a revision pass using a reviewer subagent to improve replies and make them less boring/sloppy/safeguard-y, in exchange for increased token cost and inference time. You can completely customize what this subagent uses as well as what it focuses on in the same page.
#### Decision Models and Prose Linters
- Added [Slop-guard](https://github.com/eric-tramel/slop-guard) as an optional MCP server you can run locally as your rule checker for `/config > Plugins > Response Drafting`
- TomoriBot now accepts a new "Prose Linter" MCP server type in `/config > Plugins > MCPs` that accepts input text, which can be picked as the rule checker for `/config > Plugins > Response Drafting`
- You can set System One models (or Decision models, eg. Jev or Kev) on TomoriBot in `/config > Plugins > Response Drafting` as well as register endpoints for them in `/providers`, currently they do not function (undergoing testing) and will be more relevant during the next major Natural Nudge update
### Custom Expressions
You can now upload custom images/gif links/videos/etc. into TomoriBot as custom expressions with `/expressions manage > Customs`, allowing you to give your Tomori an arsenal of meme reacts if Discord is limiting you (damn nitro). You can also whitelist custom expressions to only certain personas so you can have your Megumin have only Megumin GIFs from tenor.
- `/expressions edit` has been absorbed by `/expressions manage`
### Minor Features
- System prefills are now supported, configurable through `/config > Behavior`. Only providers that actually support prefill can benefit from this.
- New `/context` command that lets you visualize current context using in the current channel for the selected persona 
- Made memory, tasks, etc. saving/updating to be hideable as a notice embed.
- Added `/troubleshoot` command category that allows users to export privacy-safe diagnostics data for debugging/getting help
- Tool success/progress embeds are now minimalist (the new default). Verbose tool details are now sent to your servers' Logs channel, and minimalism can be toggled back off using `/config > Behavior > Notice behavior` if you want to go back to old behavior.
- Loyal Tomori (Nerine) now has 5 new sprites! Careful not to give her sake.
- TomoriBot now automatically prevents logs from being sent to logs channels if it comes from a channel that is restricted to certain roles only.
- Improved Deliberate Tool Mode (DTM) such that replies/triggers with attached files (such as .pdfs, images) or links would automatically enable its corresponding tool for TomoriBot (eg. PDF reader, GIF processor, etc.)
- TomoriBot now uses a built-in DDG search engine instead of relying on an external MCP server for better security and speed, also meaning TomoriBot does not need Node.js anymore (updated setup guides with this change)
- `flow_parameterization` has been added to TomoriBot's Irodori TTS server to support its new `v4-Large` series
- Personas can now get marked as "NSFW" (currently it can only be applied by bot hosts or by directly editing persona files). Added /nsfw persona import and /nsfw persona default which filters/allows importing of such marked personas.
- Instead of suffixing emotion tag for non-identity sprites, TomoriBot now does best-effort to swap lettering to their closest lookalike (max 1) in order to prevent Discord from merging two consecutive avatars together in chat in a cleaner way.
## QoL and Bug Fixes
- Error embeds now hide the full error log behind a button that shows it. This button can only be used by the owner of the response's personal provider, or a member with Manage Server if its a server model.
- Gemini Flash models that do not accept "MINIMAL" as a thinking level would now fallback to "LOW" instead of aborting the operation as an error 
- Welcome messages are now more reliable by using the `CompletedOnboarding` flag for new members instead of using hardcoded minute delays. Servers with no Onboarding will get greets instantly as expected
- Polished context builder to improve Attention/reduce ambiguity to user details (Instead of "Pronouns: she/her", it's now "{user}'s Pronouns: she/her", etc.)
- Added a warning embed whenever a user tries to trigger TomoriBot inside a Logs channel, instead of silently ignoring.
- Placeholder tags like {bot}, {char}, {user}, etc. now work in Sprite descriptions
- Automatic STM Summarization on/off toggle is now in its correct page (/config > Behavior > Memory)
- TomoriBot now sends stickers/custom expressions upon tool call invocation instead of always sending them upon finishing text generation
- Deliberate Tool Mode now doesn't gate the Sticker tool behind a keyword, similar to automatic STM summarizations, as it is a spontaneous reaction tool. Users can still disable stickers as needed through `/config > Plugins`
- Improved prompt previews in panels such that it doesn't take up too much space when opening its page. Also made them render as a markdown code block instead of a text one to make it look a lil' prettier.
- Whenever a webhook send request is rate limited due to rapid avatar changes, TomoriBot instead sends the webhook with the last avatar if applicable (is an emotion difference, sent by the same persona/identity). Mostly benefits local users that rely on data.uri PATCHes
- Gemini API/Vertex recently deprecated temperature, topP and topK parameters, TomoriBot now prevents those parameters from being sent to Gemini 3.6+ models to prevent errors
- TomoriBot now trims history properly in its rolling context window instead of failing the request if input context exceeds the model's context window
- Threads now inherit parent channel override settings if the thread itself has no corresponding override present
- Fixed bug wherein TomoriBot would be urged to reply to a new member joining when she's already mid-reply
- Fixed bug wherein code blocks are always sent by the persona's neutral sprites even if a different sprite was attempted
- Fixed bug wherein Anthropic models would always fail structured output requests (such as expressions, history extraction, etc.)
- Fixed bug wherein Task successes for updates/deletions are not visible in context for TomoriBot, which can cause repeat work
- Fixed bug wherein DeepSeek would sometimes fail generations during cases wherein it completely omits `reasoning_content`
- Fixed where where `/config`'s Persona Promote to Main button allowed rapid double-submits
- Fixed bug wherein queued Alter persona turns that use the reply tool would use the Main persona's avatar and name
- Fixed bug wherein the documentation site was returning 404 for some pages that *do* exist
- Fixed bug wherein TomoriBot requests using Anthropic API for Opus 4.8+ would always fail if the temperature wasn't `1` or `top_p` is undefined.
- Fixed bug wherein DeepSeek models ignore `thinking_level=none`
- Fixed bug wherein if user/channel blacklist exceeded 50 items, it would be impossible to remove entries through `/moderation`
- Fixed bug wherein the system would still suggest to TomoriBot to use a tool that isn't actually available/isn't loaded in by Deliberate Tool Mode
- Fixed bug wherein in some choice lists, custom endpoints show up as crude IDs like "custom:<id>" instead of their assigned endpoint name like "KoboldCPP"
## Security Patches
Improved TomoriBot's security and patched more possible vulnerabilities (see `https://docs.tomoribot.app/wiki/threat-models/`). Should be much safer to run your TomoriBot now even if it somehow lands on a malicious Discord server with several bad actors. This shouldn't affect existing behavior, but please report any bugs!