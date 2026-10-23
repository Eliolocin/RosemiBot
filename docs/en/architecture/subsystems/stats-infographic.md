---
title: "Stats Infographic"
aiGenerated: true
---

The `/stats generate` subcommand group renders one of three shareable PNG image cards using a satori and resvg rasterization pipeline. Metric data reuses the same `StatRepository` queries that power the text dashboard.

## Card types and roles

Each card has its own subcommand:

| Type | Subcommand | Gatherer | Renderer |
|---|---|---|---|
| Personal Wrapped | `/stats generate personal` | `personalCardGatherer.ts` | `renderPersonalCard()` |
| Persona Affinity | `/stats generate persona` | `personaCardGatherer.ts` | `renderPersonaCard()` |
| Server Leaderboard | `/stats generate server` | `serverCardGatherer.ts` | `renderServerCard()` |

Cards summarize personal usage, one user-persona pairing, or server rankings. Layout dimensions and ranking limits belong to `statsInfographic.tsx`; callers share its height calculators so the PNG canvas matches the rendered content.

## Gather and render architecture

```
gatherXxxCardData()   ← DB and Discord API (async, sole external touchpoint)
        ↓
  renderXxxCard()     ← Pure VNode tree (statsInfographic.tsx, no DB)
        ↓
  renderCardToPng()   ← satori (JSX → SVG) + @resvg/resvg-js (SVG → PNG)
        ↓
  AttachmentBuilder   ← Discord PNG attachment
```

### Gather and render split

Database and Discord API calls are isolated to the gatherer layer (`src/utils/stats/personalCardGatherer.ts`, `personaCardGatherer.ts`, `serverCardGatherer.ts`). Renderer functions in `src/utils/stats/statsInfographic.tsx` are pure functions of their data structs (`PersonalCardData`, `PersonaCardData`, `ServerCardData`). They execute synchronously without database, network, or Discord dependencies, allowing deterministic unit testing without database mocks.

Palette extraction occurs in the gatherer via `src/utils/stats/cardColor.ts` (`extractCardPalette`, `extractAvatarAccentColor`). Personal Wrapped derives its light-mode palette from the leading persona avatar, Persona Affinity samples the selected persona avatar, and Server Leaderboard samples the server icon. Persona avatar resolution in `src/utils/stats/personaAvatar.ts` prefers `webhook_avatar_url` and falls back to `preset_avatar_shared_url`.

### Rasterizer constraints

Card rasterization in `src/utils/stats/cardRenderer.ts` coordinates satori and `@resvg/resvg-js`:

- **Font buffer caching:** Static font buffers (`Noto Sans JP` Regular and Bold) are loaded once at module initialization using `readFileSync` and cached in memory across the process lifetime. This avoids repeated 5.5 MB per-weight disk reads and eliminates host fontconfig dependencies in Alpine production containers.
- **SVG gradient limitation:** Satori cannot parse CSS `conic-gradient()`. The `Donut` chart primitive generates an SVG arc string directly and embeds it as a base64 `data:image/svg+xml;base64,...` image URI, which resvg rasterizes.
- **Height coordination:** The command caller and card renderer share the same `getXxxCardHeight(data)` calculator so canvas boundaries match rendered content.

## Metric aggregation and pricing collapse

The gatherers read daily `tokens_in` and `tokens_out` metrics from `stat_counters`. Per-persona and per-model costs are computed in a single grouped query by joining `stat_counters` to `llms` pricing in `src/utils/db/repositories/StatRepository.ts`:

- **Pricing collapse:** An LLM codename can appear under multiple providers with different pricing. Because `stat_counters.metric_key` stores only the model codename rather than the provider, the query collapses pricing to one rate per codename using `MAX` across published providers before joining. This prevents duplicate join rows from inflating token counts.
- **Approximation trade-off:** If providers share a codename at different rates, the displayed estimate uses the higher rate. It does not determine the provider's bill. Exact provider attribution would require preserving provider identity with usage metrics.

## Privacy gate and persona selection

- **Privacy gate:** Personal cards reject users with `PrivacyLevel.FULL` with an ephemeral warning embed before deferring the interaction. Persona and server cards display aggregate data rather than individual user history, so they omit the privacy gate.
- **Persona selection:** `/stats generate persona` takes a required `persona` autocomplete option, the same server-wide autocomplete `/stats persona` uses. Discord cannot make an option required only when another option holds a given value, so each card is a separate subcommand that declares only the options it reads. The command defers ephemerally, resolves the option value against the server's personas, and deletes that private reply before posting the PNG as a public follow-up, so validation failures stay private.

## Source pointers

- `src/commands/stats/generate/`: One subcommand per card, including the privacy gate and persona validation.
- `src/utils/stats/cardRenderer.ts`: Font loading, satori SVG generation, and resvg PNG rasterization.
- `src/utils/stats/statsInfographic.tsx`: Pure JSX component trees, layout geometry, and theme constants.
- `src/utils/stats/personalCardGatherer.ts`, `personaCardGatherer.ts`, `serverCardGatherer.ts`: Scoped metric gatherers.
- `src/utils/db/repositories/StatRepository.ts`: Metric aggregation queries and pricing joins.
