---
title: "Adding an Environment Variable"
sidebar:
  order: 10
aiGenerated: true
---

When a setting should be an environment variable, where it goes in `.env.optional.example`, and how
to name it.

## Where a setting belongs

Pick the first row that fits. A code constant is the default.

| Location | For | Examples |
|---|---|---|
| Database (a command or server setting) | Values servers or users change at runtime | Channel rules, persona prompts, temperature |
| `.env.example` | Credentials and endpoints the bot cannot boot without | `DISCORD_TOKEN`, `DATABASE_URL` |
| `.env.optional.example` | Host resources, network behavior, external credentials or quotas, opt-in integrations, choices that differ between installations. Each needs a working default in code | `WEB_SEARCH_TIMEOUT_MS`, `MAX_DOCUMENT_SIZE_MB` |
| Code constant (module, or `src/constants/` when shared) | Probabilities, lookbacks, UI geometry, algorithm tuning, protocol and Discord limits | The 15-minute interaction token window |

Make a constant a variable only when you can name the deployment that needs a different value. Use
one variable per setting, never an engine-specific name plus a shared fallback.

## Tiers in `.env.optional.example`

Sections are grouped into tiers, ordered by how often an operator changes them:

| Tier | Contents |
|---|---|
| 1. Identity and behavior | What the bot says and does: trigger words, `EMOJI_PENALTY_ENABLED`, reaction context |
| 2. Optional features | External services that are off while unset: Matrix, S3, search APIs, documents and RAG, MCP |
| 3. Local servers | TTS engines, Crawl4AI, SearXNG, ComfyUI |
| 4. Providers and models | Per-provider tuning and turn timeouts (tool execution, SDK call, channel lock) |
| 5. Limits and quotas | Counts, sizes, payload lengths, rates, `COMMAND_COOLDOWN_SCALE` |
| 6. Diagnostics and tooling | Debug logging, test database credentials, `vl` gate limits |
| 7. Production hosting | Sizing, pool recycling, pressure detection, metrics sinks |

A variable for an existing subsystem goes in that subsystem's `## Section`, whatever kind of value it
is, because operators tune a feature as a unit. A new subsystem gets a new section in the first tier
that fits. Tier 7 rationale is in `docs/en/wiki/production-tuning.md`.

## Naming

- `UPPER_SNAKE_CASE`, with the unit as a suffix: `_MS`, `_SECONDS`, `_MINUTES`, `_HOURS`, `_DAYS`,
  `_MB`, `_BYTES`.
- The comment above it states the unit and default, unless the section heading already does.
- The code works without the variable:

```ts
const WEB_SEARCH_TIMEOUT_MS = Number.parseInt(process.env.WEB_SEARCH_TIMEOUT_MS || "15000", 10);
const FEATURE_ENABLED = process.env.ENABLE_EXAMPLE_FEATURE === "true";
```

## Check it with `env-doctor`

`bun run env-doctor` lists every variable with where it is declared, what reads it (TypeScript,
Python, shell, PowerShell, Dockerfiles, Compose, workflows), its documented default beside its code
fallback, and any Compose or Docker override.

```bash
bun run env-doctor                     # summary and diagnostics
bun run env-doctor --var MY_VARIABLE   # everything about one variable
bun run env-doctor --json
bun run env-doctor --no-live-env       # leave out your .env names before sharing output
```

After adding a variable, run `--var` on it. The doctor should find your read, and the code fallback
should match `.env.optional.example`; a difference appears under `Conflicting defaults`.

- It never prints a live `.env` value, and redacts every value of a credential-named variable.
- Its classification (`deployment`, `runtime-preference`, `algorithmic-invariant`, `dead`,
  `undecided`) guides review; it is not a verdict. `dead` means nothing reads the name and every
  consumer was scanned. Without the `release` ref, `deploy/` and `terraform/` cannot be scanned and the
  result is `undecided`.
- An unregistered dynamic read needs a literal name, or an entry with its reason in
  `REGISTERED_DYNAMIC_READS` in `scripts/devtools/envDoctor/policy.ts`. A variable only a dependency
  reads (a cloud SDK, for example) goes in `LIBRARY_CONSUMERS` in the same file.

Then run `bun run check` and `bun run lint`.
