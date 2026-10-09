---
title: "Maintenance & Backups"
sidebar:
  order: 5
---

Manage your self-hosted TomoriBot instance using CLI maintenance scripts to update code, back up or restore data, rotate encryption keys, and inspect environment variables. Run these commands from your host terminal or Docker environment. For in-Discord data exports and deletions, see [Data Handling](/features/knowledge/data-handling/).

If you are updating with `git pull`, review [Safe Migration](/self-hosting/safe-migration/) first to create a backup before the on-boot migration runner applies schema changes.

## Maintenance scripts

| Command | Description |
|---|---|
| `bun run setup` | Open the setup wizard for base install and optional modules. |
| `bun run update` | Back up first, then pull latest code and install dependencies. |
| `bun run backup` | Create a bundle in `backups/` with your database dump and required encryption-version metadata. Secrets stay separate. |
| `bun run restore-backup` | Restore the database using separately provisioned encryption keys (`--latest` or `--from backups/<dir>`). |
| `bun run backup:personas` | Export ONLY personas (with server memories) across all servers; re-import via `/persona import`. |
| `bun run nuke-db` | Drop all tables (start the bot afterward to reinitialize). |
| `bun run purge-commands` | Clear all registered Discord slash commands. |
| `bun run rotate-keys --bot-stopped` | Re-encrypt all encrypted fields to the current key version. |
| `bun run env-doctor` | Read-only check of your configuration: lists `.env` entries that nothing reads (names only, never values) and where each variable is used. |

Host `bun run backup` needs `pg_dump`, and host `bun run restore-backup` needs `psql` in your PATH. `bun run update` needs `pg_dump` for its backup. The `--docker` update path runs the backup in the container, so it needs host Bun, Git, and Docker but no host PostgreSQL tools.

The backup and restore commands hand your database password to `pg_dump` and `psql` through a short-lived password file in the system temporary folder, so other users on the machine cannot read it from the process list. That folder must be writable. The file is deleted when the command finishes.

## Database backups and recovery keys

`bun run backup` and automatic startup backups produce `database.sql` and `bundle_info.json`. The manifest identifies a database-only bundle and lists encryption versions found in that dump. The version inventory describes which keys recovery needs; restore checks actual decryptability. Creating a dump does not require old keys to be present, so a missing historical key does not prevent preserving the rest of the database. It never copies `.env`. A database-only dump still contains private conversations and memories, so restrict access to the backup directory.

Keep the encryption versions in separate protected storage, such as an encrypted password manager or secret manager. If you copy `.env` yourself, protect it as credentials and keep it separate from the dump. Losing a required encryption version makes those stored credentials unrecoverable; users must enter their API keys again. Provider-side keys remain valid until revoked.

To restore:

1. Stop every bot instance. Provision the target database settings, Discord token, and the matching encryption versions in the normal secret source before running the command. Preserve the original keys exactly.
2. Install `psql` and the extensions used by the dump, including `pgvector` when present. Run `bun run restore-backup --from backups/<bundle-directory>` or use `--latest`. Restore enables `pgcrypto` before checking keys, including on a fresh target. The database account must be allowed to create that extension, or a database administrator must enable it first. Extension setup errors are reported separately from credential recovery failures.
3. Restore checks every encrypted credential with the supplied keys before loading the dump. Missing or wrong keys stop it before any destructive SQL; `pgcrypto` may already have been enabled. Review the target and confirm `RESTORE`; a non-empty target also requires `RESTORE ANYWAY`. Only restore trusted SQL dumps.
4. Keep the keys in place. Before restarting, run `bun run audit-keys` and `bun run rotate-keys --dry-run`. If credentials need migration to the active version, run `bun run rotate-keys --bot-stopped` and audit again before starting any instance. `ON_ERROR_STOP=1` stops at the first SQL error, but earlier statements may already have changed data. Fix the error and retry while the bot remains stopped.

Legacy bundles include raw secrets in `config.env`. Restore identifies them and warns, but never copies or loads that file. Deliberately review it in a private location and provision its encryption versions into the target secret source yourself. Keep target database settings in place. Existing bundles remain secret-bearing even after upgrading. Once its encryption keys are archived in protected storage, you can delete `config.env` from a legacy bundle; restore still accepts the bundle and checks the keys by decrypting the dump.

## Rotating encryption keys

1. Keep a protected copy of every key needed by live data and retained backups. Take a database backup and test recovery on a disposable database before retiring any version.
2. Generate the new key with `openssl rand -base64 32` (or `docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"`) and add it as `CRYPTO_SECRET_V<version>` to the same secret source the bot uses. Rotation refuses a current key shorter than 32 characters. Set `CRYPTO_SECRET_CURRENT` to that version if you want explicit selection. Retain all older keys. Legacy `CRYPTO_SECRET` is V1.
3. Stop every bot instance and pause credential writers. In production, run the scripts with `RUN_ENV=production` and the same mounted `SECRET_FILE`, legacy `GCP_SECRET_FILE`, or AWS secret and access configuration as startup. Audit and rotation use the bot's `POSTGRES_*` settings from that source.
4. Run `bun run audit-keys`, then `bun run rotate-keys --dry-run`. Both must succeed. Audit reports failing tables, columns, row IDs, and versions while continuing credential checks. Its version counts include failed recovery and cannot establish success when the exit status is non-zero. Dry-run decrypts the credentials without changing rows.
5. Run `bun run rotate-keys --bot-stopped`, then `bun run audit-keys`. Any failed query or row gives a non-zero exit, including partial success. Keep every version, correct the failure, and rerun. Concurrent row replacement is refused rather than overwritten.
6. In a disposable restored database, test an audit with only the retained current key configured. Retained older backups need their own tested recovery with archived keys. Only after those checks may you remove old versions from the live secret source. Keep the separate protected key archive for as long as its backups are retained, then restart all bot instances.

The `--bot-stopped` flag records your confirmation; it cannot detect other running instances. Rotation scripts do not clear another process's credential caches. Versions need not be consecutive: a V1 credential can move directly to V4 when both keys are available.

Rotation also replaces legacy null version tags with the explicit current version, including when the current version is V1.

## Updating

Stop the running bot first, then use the backup-first updater:

```sh
bun run update
```

This runs `bun run backup`, then `git pull --rebase --autostash`, and finally `bun install --frozen-lockfile`. The backup bundle is saved to `backups/` and contains your database dump and manifest. Copy and protect `.env` separately if you need to retain it. Add `--skip-backup` to bypass the pre-update backup.

Manual fallback:

```sh
bun run backup
git pull --rebase --autostash
bun install --frozen-lockfile
```

If you run precompiled code from `dist/`, use `bun run update --build`. For Docker Compose deployments, use `bun run update --docker`; the updater first runs `docker compose run --rm tomoribot bun run backup`.

### Removed environment variables

These variables previously configured internal text heuristics, Discord component timeouts, cache durations, command cooldowns, and sampling defaults. They are now fixed in code at their former defaults, so old values in `.env` are ignored after upgrading. Run `bun run env-doctor` to list any leftover variables in your `.env` that you can safely delete. Settings that depend on your host, network, credentials, or costs remain environment variables.

Command cooldowns now use a single multiplier, `COMMAND_COOLDOWN_SCALE` (default `1`; `0` disables cooldowns), replacing the individual `COOLDOWN_*` variables and `DEFAULT_COMMAND_COOLDOWN`. To keep a custom cooldown, divide your old value by its former default: for example, `COOLDOWN_PERSONA=1000` becomes `COMMAND_COOLDOWN_SCALE=0.1`.

<details>
<summary>All 177 removed variables and their fixed values</summary>

| Variable | Fixed value |
|---|---|
| `ALLOW_PERSONAL_LOCAL_ENDPOINTS` | none (it was never read) |
| `BLOCK_USER_MAX_DURATION_HOURS` | `168` |
| `BOT_GENERATE_IMAGE_AGENT_MAX_ITERATIONS` | `5` |
| `BOT_GENERATE_IMAGE_HISTORY_LIMIT` | `24` |
| `BOT_GENERATE_SCENE_MAX_CYCLES` | `10` |
| `BOT_JSON_REPAIR_MAX_CHARS` | `1048576` |
| `BOT_MAX_CONSECUTIVE_TOOL_ERRORS` | `5` |
| `BOT_MAX_FUNCTION_CALL_ITERATIONS` | `100` |
| `BOT_MAX_STOP_STRINGS_PER_SERVER` | `40` |
| `BOT_MAX_STOP_STRING_LENGTH` | `200` |
| `BRAVE_IMAGE_COMPRESSION_TARGET_MB` | one below `BRAVE_IMAGE_DISCORD_LIMIT_MB` (`7` by default) |
| `CHANNEL_WHITELIST_CACHE_TTL_MINUTES` | `5` |
| `CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE` | `10` |
| `CONDITIONING_REASON_MAX_LENGTH` | `250` |
| `COOLDOWN_CONDITIONING` | `3000`, scaled by `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_CONFIG` | `3000`, scaled by `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_FORGET` | `3000`, scaled by `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_MEMORY` | `3000`, scaled by `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_PERSONA` | `10000`, scaled by `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_PERSONAL` | `3000`, scaled by `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_SERVER` | `3000`, scaled by `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_TEACH` | `3000`, scaled by `COMMAND_COOLDOWN_SCALE` |
| `DEEPSEEK_EXPRESSION_BATCH_SIZE` | `20` |
| `DEFAULT_COMMAND_COOLDOWN` | `1600`, scaled by `COMMAND_COOLDOWN_SCALE` |
| `DELIBERATE_TOOL_CONTEXT_TURNS` | `4`; a server can still change it in `/config` (Tool Context under Experimental Behavior) |
| `DISCORD_TYPING_KEEPALIVE_INTERVAL_MS` | `8000` |
| `DOCUMENT_CHUNK_OVERLAP` | `200` |
| `DOCUMENT_CHUNK_SIZE` | `1000` |
| `DOCUMENT_MAX_RESULTS` | `6` |
| `DOCUMENT_MIN_SIMILARITY` | `0.5` |
| `EMOJI_PENALTY_LOOKBACK` | `3` |
| `EMOJI_PENALTY_THRESHOLD` | `1` |
| `EMOJI_RUN_PREFIX_LENGTH` | `3` |
| `EMOJI_STICKER_CACHE_TTL_MINUTES` | `10` |
| `EMOJI_UNIQUE_LOOKBACK` | `5` |
| `ENHANCED_CONTEXT_STASH_MAX_ENTRIES` | `16` |
| `ENHANCED_CONTEXT_STASH_TTL_MS` | `300000` |
| `EXPRESSION_DESC_MAX_LENGTH` | `500` |
| `EXPRESSION_INIT_BATCH_DELAY_MS` | `1000` |
| `EXPRESSION_INIT_MAX_CHUNK_RETRIES` | `3` |
| `FALLBACK_NOTICE_BUTTON_TIMEOUT_MS` | `86400000` |
| `FETCH_URL_HEALTHCHECK_CACHE_SEC` | `60` |
| `FORWARD_CHAIN_MAX_DEPTH` | `3` |
| `GENERATE_SCENE_MAX_CYCLES` | `10` |
| `GIF_JPEG_QUALITY` | `80` |
| `GIF_MAX_KEYFRAMES` | `10` |
| `GUILD_MCP_CONFIG_CACHE_TTL_MINUTES` | `5` |
| `HELP_COST_EST_OUTPUT_LONG` | `500` |
| `HELP_COST_EST_OUTPUT_SHORT` | `80` |
| `HELP_COST_EST_OUTPUT_TYPICAL` | `220` |
| `HISTORY_EXTRACTION_WINDOW_SIZE` | `40` |
| `HISTORY_INCHARACTER_RAG_MAX_RESULTS` | `16` |
| `HUMANIZER_COMMA_FLUSH_PROBABILITY` | `0.2` |
| `HUMANIZER_COMMA_REMOVE_PROBABILITY` | `0.4` |
| `HUMANIZER_EMPHASIS_FLUSH_PROBABILITY` | `0.5` |
| `IMAGE_CONTEXT_JPEG_QUALITY` | `85` |
| `IMAGE_MIN_SIZE_BYTES` | `5120` |
| `IMAGE_REFERENCE_TINY_MAX_BYTES` | `950000` |
| `IMAGE_TAG_MAX_TAGS` | `100` |
| `IMAGE_TAG_MAX_TAG_LENGTH` | `200` |
| `KEY_ROTATION_ERROR_COOLDOWN_MS` | `300000` |
| `KEY_ROTATION_RATE_LIMIT_COOLDOWN_MS` | `60000` |
| `MARKDOWN_TABLE_BUTTON_TIMEOUT_MS` | `7200000` |
| `MARKDOWN_TABLE_CACHE_TTL_MINUTES` | `120` |
| `MARKDOWN_TABLE_RENDER_MAX_HEIGHT` | `5000` |
| `MARKDOWN_TABLE_RENDER_MAX_WIDTH` | `1400` |
| `MATRIX_EMBED_CHUNK_MAX_CHARS` | `3500` |
| `MATRIX_LINK_CACHE_TTL_MINUTES` | `5` |
| `MATRIX_MAX_TRACKED_SENT_EVENTS` | `500` |
| `MATRIX_TYPING_TIMEOUT_MS` | `60000` |
| `MAX_ATTRIBUTES` | `10` |
| `MAX_ATTRIBUTE_LENGTH` | `2000` |
| `MAX_FLUSH_COUNT` | `40` |
| `MAX_SAMPLE_DIALOGUES` | `15` |
| `MAX_SAMPLE_DIALOGUE_LENGTH` | `2000` |
| `MAX_TRIGGER_WORDS` | `10` |
| `MCP_TOOL_SNAPSHOT_MAX_NAMES` | `100` |
| `MCP_TOOL_SNAPSHOT_NAME_MAX_CHARS` | `128` |
| `MEDIA_MAX_DIMENSION` | `768` |
| `MEDIA_SIZE_LIMIT_BYTES` | `1048576` |
| `MEMORY_EXPAND_BUTTON_TIMEOUT_MS` | `86400000` |
| `MEMORY_NOTICE_PREVIEW_LIMIT` | `600` |
| `NAI_CFG_RESCALE` | `0.0`; a server can still change it in `/config` (NovelAI image settings) |
| `NAI_CHAR_REF_DESCRIPTION` | `character&style` |
| `NAI_CHAR_REF_INFO_EXTRACTED` | `1.0` |
| `NAI_CHAR_REF_SECONDARY_STRENGTH` | `0.0` |
| `NAI_CHAR_REF_STRENGTH` | `0.6` |
| `NAI_GLM_CHARS_PER_TOKEN` | `2.5` |
| `NAI_GLM_CONTEXT_LIMIT` | `12288` |
| `NAI_IMAGE_NEGATIVE_PROMPT` | built-in text |
| `NAI_IMAGE_NOISE_SCHEDULE` | `karras`; a server can still change it in `/config` (NovelAI image settings) |
| `NAI_IMAGE_SAMPLER` | `k_euler_ancestral`; a server can still change it in `/config` (NovelAI image settings) |
| `NAI_IMAGE_SCALE` | `5`; a server can still change it in `/config` (NovelAI image settings) |
| `NAI_IMAGE_STEPS` | `23`; a server can still change it in `/config` (NovelAI image settings) |
| `NAI_INPAINT_PADDING` | `0.15` |
| `NAI_INPAINT_STRENGTH` | `1.0` |
| `NAI_KAYRA_CHARS_PER_TOKEN` | `3.5` |
| `NAI_KAYRA_CONTEXT_LIMIT` | `8192` |
| `NAI_TOOL_FAILURE_RETRY_THRESHOLD` | `3` |
| `NVIDIA_IMAGE_CFG_SCALE` | `3.5` |
| `NVIDIA_IMAGE_STEPS` | `30` |
| `OPENROUTER_CATALOG_REFRESH_MIN_INTERVAL_MS` | `60000` |
| `OPENROUTER_CATALOG_TTL_MS` | `21600000` |
| `OPENROUTER_LENGTH_EMPTY_RETRY_DROP_PAIRS` | `2` |
| `OPENROUTER_MIN_OUTPUT_TOKENS` | `256` |
| `OPENROUTER_OUTPUT_SAFETY_FACTOR` | `0.9` |
| `PARTICIPANT_ENRICHER_TIMEOUT_MS` | `1500` |
| `PARTICIPANT_SOURCE_TIMEOUT_MS` | `1500` |
| `PERSONAL_SPOTLIGHT_CACHE_MAX_ENTRIES` | `2000` |
| `PERSONAL_SPOTLIGHT_CACHE_TTL_MINUTES` | `5` |
| `PERSONA_IMPORT_NOW_BUTTON_TIMEOUT_MS` | `840000` |
| `PERSONA_SPRITE_CACHE_TTL_MINUTES` | `10` |
| `PERSONA_SPRITE_MAX_INSTRUCTIONS_LENGTH` | `300` |
| `PERSONA_SPRITE_MESSAGE_CACHE_TTL_MINUTES` | `120` |
| `PERSONA_SPRITE_PROMPT_MAX_COUNT` | `20` |
| `PERSONA_USER_BLOCK_CACHE_TTL_SECONDS` | `60` |
| `PERSONA_WORKFLOW_COMPONENT_TIMEOUT_MS` | `120000` |
| `PRESET_GENERATION_MAX_OUTPUT_TOKENS` | `16384` |
| `PRESET_MAX_ATTRIBUTES` | `200` |
| `PRESET_MAX_IMAGE_TAGS` | `200` |
| `PRESET_MAX_SAMPLE_DIALOGUES` | `100` |
| `PRESET_MAX_STRING_LENGTH` | `5000` |
| `PRESET_MAX_TRIGGER_WORDS` | `100` |
| `RAG_AVAILABILITY_REPROBE_INTERVAL_MS` | `300000` |
| `REACTION_CONTEXT_MAX_API_CALLS_PER_TURN` | `20` |
| `REACTION_CONTEXT_MAX_REACTIONS_PER_MESSAGE` | `4` |
| `REACTION_CONTEXT_MAX_USERS_PER_REACTION` | `5` |
| `RELEASE_CARD_WEBP_QUALITY` | `90` |
| `REMINDER_DELIVERY_MAX_RETRIES` | `5` |
| `REMINDER_DELIVERY_RETRY_DELAY_MS` | `60000` |
| `RESET_CONFIRMATION_TIMEOUT_MS` | `60000` |
| `SCHEDULED_WORK_RECONCILE_INTERVAL_MS` | `60000` |
| `SEND_FAILURE_RETRY_MINUTES` | `15` |
| `SETUP_DRAFT_MAX_ENTRIES` | `200` |
| `SHORT_TERM_MEMORY_DEFAULT_CRUDE_MESSAGE_COUNT` | `6`; a server can still change it in `/config` (short-term memory settings) |
| `SHORT_TERM_MEMORY_MAX_MESSAGES_PER_CHANNEL` | `10` |
| `SHORT_TERM_MEMORY_MAX_OTHER_CHANNELS` | `3` |
| `SHORT_TERM_MEMORY_MAX_SUMMARY_LENGTH` | `1500` |
| `SHORT_TERM_MEMORY_SUMMARY_TTL_HOURS` | `24` |
| `SHORT_TERM_MEMORY_TTL_HOURS` | `12` |
| `SPRITE_GROUP_CONTINUITY_TTL_MINUTES` | `10` |
| `STARTUP_GRACE_PERIOD_MINUTES` | `3` |
| `STATS_CARD_THEME_ACCENT` | `#e7322a` |
| `STATS_CARD_THEME_BG` | `#1d100e` |
| `STATS_CARD_THEME_SURFACE` | `#2c1815` |
| `STATS_CARD_W` | `1080` |
| `STATS_DASHBOARD_TIMEOUT_MS` | none (it was never read) |
| `STAT_FLUSH_INTERVAL_MS` | `5000` |
| `STAT_FLUSH_MAX_BUFFER` | `1000` |
| `STM_FRESH_INJECTION_DEPTH` | `2` |
| `STM_FRESH_WINDOW_MINUTES` | `60` |
| `STM_MAX_CATEGORIES` | `5` |
| `STREAM_ABANDONED_SETTLE_TIMEOUT_MS` | `5000` |
| `ST_PRESET_CACHE_TTL_MINUTES` | `10` |
| `SYSPROMPT_SHOW_MAX_PREVIEW` | `3800` |
| `TASK_EXPAND_BUTTON_TIMEOUT_MS` | `86400000` |
| `TENOR_FETCH_TIMEOUT_MS` | none (it was never read) |
| `TEST_POSTGRES_DB` | none (it was never read) |
| `THINKING_LEVEL_BUDGET_HIGH_TOKENS` | `8192` |
| `THINKING_LEVEL_BUDGET_LOW_TOKENS` | `1024` |
| `THINKING_LEVEL_BUDGET_MEDIUM_TOKENS` | `4096` |
| `TIME_AWARENESS_NOTE_DEPTH` | `3` |
| `TIME_AWARENESS_REUNION_CLAIM_TTL_MS` | `240000` |
| `TIME_AWARENESS_REUNION_DAYS` | `7` |
| `TIP_BUTTON_TIMEOUT_MS` | `86400000` |
| `TOMORI_STATE_CACHE_TTL_MINUTES` | `10` |
| `TRANSFER_SNAPSHOT_MAX_ENTRIES` | `200` |
| `TRANSFER_SNAPSHOT_TTL_MINUTES` | `15` |
| `USER_CACHE_TTL_MINUTES` | `30` |
| `VERBATIM_TOOL_CALL_MAX_BUFFER_CHARS` | `8192` |
| `VISION_CAPTION_MAX_OUTPUT_TOKENS` | `2048` |
| `VOICE_TRANSCRIPT_CACHE_TTL_MINUTES` | `120` |
| `WEBHOOK_ERROR_COOLDOWN_MS` | `600000` |
| `WEBHOOK_FAILURE_RETRY_MINUTES` | `15` |
| `WEB_SEARCH_HEALTHCHECK_CACHE_SEC` | `60` |
| `WELCOME_DELAY_MS` | `60000` |

</details>

### Removed TTS local server variables

TTS local servers under `servers/tts/` no longer use shared port fallbacks, per-engine limits, or authentication settings. Old settings in `.env` or your shell are ignored:

- **Ports:** `TOMORI_TTS_PORT` is removed because a single shared variable bound every launched server to the same port. Each engine now uses its dedicated variable: `CHATTERBOX_PORT` (8011), `QWEN3TTS_PORT` (8012, or 8014 in voice-design mode), `IRODORI_TTS_PORT` (8013), `FISH_S2_PORT` (8015), `VOXCPM2_PORT` (8016), `COSYVOICE3_PORT` (8017), and `MOSS_TTS_PORT` (8018).
- **Authentication:** Local servers no longer validate bearer tokens or restrict remote network binding. If you previously set `FISH_S2_API_KEY`, `VOXCPM2_API_KEY`, `TOMORI_TTS_API_KEY`, or `COSYVOICE3_BEARER_TOKEN`, the endpoints now accept requests without credentials. Review [Network access](/self-hosting/local-endpoints/text-to-speech/#network-access) before binding off loopback.
- **Installer pins:** Commit hashes and model revisions for Fish Speech and CosyVoice are pinned in the installer scripts. Updating them requires editing the pinned values in each script.

<details>
<summary>All removed TTS local server variables</summary>

| Variable | Now |
|---|---|
| `COSYVOICE3_ALLOW_REMOTE_BIND` | removed; any `TOMORI_TTS_HOST` is accepted |
| `COSYVOICE3_BEARER_TOKEN` | removed; no authentication |
| `COSYVOICE3_MAX_REF_AUDIO_BYTES` | `26214400` |
| `COSYVOICE3_MAX_REF_AUDIO_SECONDS` | `30` |
| `COSYVOICE3_MODEL_ID` | `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` |
| `COSYVOICE3_MODEL_REVISION` | pinned in the installer |
| `COSYVOICE3_RUNTIME_COMMIT` | pinned in the installer |
| `COSYVOICE3_RUNTIME_DIR` | `servers/tts/cosyvoice3/CosyVoice` |
| `COSYVOICE3_RUNTIME_REPO` | `https://github.com/QwenAudio/CosyVoice.git` |
| `COSYVOICE3_UPDATE` | removed; a rerun checks out the installer's pins |
| `FISH_S2_ALLOW_INSECURE_REMOTE` | removed; any `TOMORI_TTS_HOST` is accepted |
| `FISH_S2_API_KEY` | removed; no authentication |
| `FISH_S2_LAUNCH_TIMEOUT_MS` | `TOMORI_TTS_STARTUP_TIMEOUT_MS` applies (`300000`) |
| `FISH_S2_MAX_REF_AUDIO_BYTES` | `10485760` |
| `FISH_S2_RUNTIME_REF` | pinned in the installer |
| `FISH_S2_RUNTIME_REPOSITORY` | `https://github.com/Imagilux/fish-speech.git` |
| `FISH_S2_STARTUP_TIMEOUT_SECONDS` | `180` |
| `FISH_S2_SYNTHESIS_TIMEOUT_SECONDS` | `1800` |
| `FISH_S2_UPDATE` | removed; a rerun checks out the installer's pin and refreshes the model |
| `FISH_S2_UPDATE_MODEL_REVISION` | use `FISH_S2_MODEL_REVISION` |
| `FISH_S2_UPDATE_REF` | pinned in the installer |
| `FISH_S2_UPSTREAM_HOST` | `127.0.0.1` |
| `FISH_SPEECH_DIR` | `servers/tts/fishs2/fish-speech` |
| `MOSS_TTS_MAX_REF_AUDIO_BYTES` | `10485760` |
| `TOMORI_TTS_ALLOW_REMOTE_BIND` | removed; any `TOMORI_TTS_HOST` is accepted |
| `TOMORI_TTS_API_KEY` | removed; no authentication |
| `TOMORI_TTS_MAX_REF_AUDIO_BYTES` | `10485760` (Fish) |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000` (`1000` for Irodori-TTS) |
| `TOMORI_TTS_PORT` | the engine's own port variable |
| `TTS_CLONE_TIMEOUT_MS` | use `TTS_SYNTHESIZE_TIMEOUT_MS` |
| `VOXCPM2_API_KEY` | removed; no authentication |
| `VOXCPM2_MAX_REF_AUDIO_BYTES` | `10485760` |

</details>

## Backups and restore

`bun run backup` creates a timestamped bundle in `backups/` (or your `TOMORI_BACKUP_DIR` if overridden in `.env`) containing your entire PostgreSQL database. It does not include `.env`, so keep your encryption keys in separate protected storage (see [Database backups and recovery keys](#database-backups-and-recovery-keys)). Restore the latest bundle with:

```sh
bun run restore-backup --latest
```

Or restore a specific bundle:

```sh
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

`bun run backup:personas` is a narrower export: persona presets and per-persona server memories only, across all servers. It must be re-imported manually via `/persona import` and cannot be used with `restore-backup` (that would cause primary-key conflicts).

TomoriBot also takes automatic startup backups in non-production environments, and a full restore requires the `pgvector` extension to be present on the target database. Both are covered in detail under [Safe Migration](/self-hosting/safe-migration/), along with a manual `pg_dump` and `pg_restore` procedure if you prefer to drive the tooling directly.

## Docker Compose backups

Docker Compose supports automatic startup backups inside the app container. Bundles are written to the host `backups/` directory because Compose mounts it into the container.

For a manual Docker backup:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

For a Docker restore:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

Host-side scripts do not automatically run through Docker. To run them against the Compose database, set the following connection values on the host. Backup and restore also need the PostgreSQL client tools; `nuke-db` needs Bun only.

```dotenv
POSTGRES_HOST=localhost
POSTGRES_PORT=15432
POSTGRES_USER=tomori
POSTGRES_PASSWORD=your_password
POSTGRES_DB=tomodb
```

## Clean reinstall

`bun run nuke-db` drops all tables; starting the bot afterward reinitializes the schema, seeds, and migrations from scratch. Use it together with a fresh `bun run backup` when you want a clean slate you can still roll back from: never run it without a current backup.

## See also

- [Safe Migration](/self-hosting/safe-migration/): backing up before pulling, and the `pgvector` restore prerequisite
- [Data Handling](/features/knowledge/data-handling/): per-user, in-Discord export/import/delete
- [Setup Wizard](/self-hosting/setup-wizard/): the guided `bun run setup` install
