---
title: "Status Command"
---

The `/status` slash command provides a read-only snapshot dashboard for durable personal, server, and persona configuration state. It lets users inspect active settings without opening separate management commands.

## Implementation boundary

- Slash command registration and dispatch live in `src/commands/status.ts`.
- The status coordinator in `src/utils/metrics/status/command.ts` manages initial interaction deferral and category assembly.
- Persistent category and page routes live in `src/utils/discord/statusDashboardCatalog.ts` and `src/utils/discord/interactions/statusRoutes.ts`.
- `src/utils/metrics/status/statusDashboard.ts` resolves the ordered category list.
- Scoped page builders live under `src/utils/metrics/status/`:
  - `personalPages.ts` builds personal settings and provider pages.
  - `personaPages.ts` builds the five persona detail pages.
  - `serverModelPages.ts`, `serverConfigPages.ts`, and `serverChannelPages.ts` build server configuration scopes.
  - `channelFormatters.ts`, `providerConfigFormatters.ts`, and `sharedFormatters.ts` provide redaction and text formatting.

## Scope coverage and navigation

The dashboard organizes settings into five ordered categories: Persona, Behavior, Access, Personal, and Models. Invocations open on the main persona's Identity page. Every view renders category buttons across the top, allowing users to switch among categories without re-running the command.

### Persistent interaction routing

Category and page controls use versioned `status:v1` interaction routes registered with the global interaction router. These routes preserve the selected persona ID across category transitions and rebuild pages from fresh database rows on each interaction. Because routes encode all required state into custom IDs, the dashboard operates without Discord component collectors or database writes.

Persona selection renders a string select menu holding up to 25 personas (`STATUS_PERSONA_SELECT_PAGE_SIZE`). Roster sizes above 25 display range pagination buttons. Selection and range routes encode numeric persona IDs and offsets, keeping interaction payloads within Discord custom ID byte limits.

### Category and page inventory

The dashboard renders as a private Components V2 message (`MessageFlags.Ephemeral`). Layout builders reserve four of Discord's 40 allowed component slots for future controls and bound text displays to Discord's 4,000-codepoint limit.

Persona pages show identity and memories; Behavior and Access pages show automation, admission, and quotas; Personal and Models pages distinguish member settings from server provider configuration. `statusDashboardCatalog.ts` owns the page inventory. Each page names the management command that edits its settings.

## Privacy and redaction rules

The status dashboard must not expose plaintext credentials, tokens, or private endpoint URLs:

- **API keys:** Show configured presence or key rotation pool counts only.
- **Optional credentials:** Show service names without token contents.
- **MCP authentication tokens:** Never display token values.
- **Custom endpoint URLs:** Display configured status without revealing hostnames or paths.
- **Matrix room IDs:** Omit room identifiers; show linked channel names and counts only.
- **Automated trigger prompts:** Display configured status without printing custom prompt text.
- **Prompt and context previews:** `canViewPromptText` gates system prompts, persona prompts, and context notes, matching prompt snapshots. Members can see them when prompt inspection is enabled; `ManageGuild` holders can also inspect them when that setting is disabled. Without verified permissions, a caller cannot claim the administrator exception. Initial replies and every category, page, and persona-selection route evaluate current permissions and settings before building previews. Hidden fields retain a localized label, and safe status information remains available.

New durable settings need a view in the owning status category, with the same credential and endpoint redaction as existing fields. The management command remains the write owner; the dashboard only reads and directs users to it.

## Source pointers

- `src/commands/status.ts`: Slash command registration and entrypoint.
- `src/utils/metrics/status/command.ts`: Ephemeral interaction lifecycle and category resolution.
- `src/utils/discord/statusDashboardCatalog.ts`: Route encoders, codecs, and category definitions.
- `src/utils/discord/interactions/statusRoutes.ts`: Global interaction route handlers.
- `src/utils/metrics/status/statusPageRenderer.ts`: Components V2 layout and pagination builder.
