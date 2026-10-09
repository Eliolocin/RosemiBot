---
title: "维护与备份"
sidebar:
  order: 5
---

使用CLI维护脚本来管理你的自部署TomoriBot实例，以更新代码、备份或恢复数据、轮换加密密钥以及检查环境变量。从主机终端或Docker环境运行这些命令。对于Discord内的数据导出和删除，请参见[数据处理](/zh-CN/features/knowledge/data-handling/)。

如果你使用`git pull`进行更新，请先查看 [安全迁移](/zh-CN/self-hosting/safe-migration/) 以在启动迁移运行程序应用架构更改之前创建备份。

## 维护脚本

| 指令 | 说明 |
|---|---|
| `bun run setup` | 打开安装向导，可做基础安装与可选模块。|
| `bun run update` | 先备份，再拉取最新代码并安装依赖。|
| `bun run backup` | 在`backups/`中创建包含数据库转储和所需加密版本元数据的包。凭据单独保留。|
| `bun run restore-backup` | 使用单独配置的加密密钥恢复数据库（`--latest`或`--from backups/<dir>`）。|
| `bun run backup:personas` | 只导出所有服务器上的人格（含服务器记忆）；用`/persona import`重新导入。|
| `bun run nuke-db` | 删除所有表（之后启动bot会重新初始化）。|
| `bun run purge-commands` | 清除所有已注册的Discord斜杠指令。|
| `bun run rotate-keys --bot-stopped` | 把所有加密字段重新加密到当前密钥版本。|
| `bun run env-doctor` | 只读检查你的配置：列出没有任何代码读取的`.env`条目（仅名称，绝不包含值）以及每个变量的使用位置。|

宿主机上的`bun run backup`需要PATH中有`pg_dump`，宿主机上的`bun run restore-backup`需要PATH中有`psql`。`bun run update`的备份也需要`pg_dump`。`--docker`更新路径在容器内运行备份，因此需要宿主机具备Bun、Git和Docker，但不需要宿主机具备PostgreSQL工具。

备份和恢复命令通过系统临时文件夹中的临时密码文件将数据库密码传递给`pg_dump`和`psql`，因此机器上的其他用户无法从进程列表中读取该密码。该文件夹必须可写。命令执行完毕后该文件会被删除。

## 数据库备份与恢复密钥
<!-- anchor: database-backups-and-recovery-keys -->

`bun run backup`和自动启动备份会生成`database.sql`与`bundle_info.json`。清单文件标识仅含数据库的包，并列出在该转储中找到的加密版本。版本清单说明恢复所需的密钥；恢复过程会检查实际的可解密性。创建转储并不要求旧密钥存在，因此缺失的历史密钥不会阻止保留数据库的其余部分。它绝不会复制`.env`。仅含数据库的转储仍包含私密对话和记忆，因此请限制对备份目录的访问。

请将加密版本保存在单独的受保护存储中，例如加密密码管理器或凭据管理器。如果你自行复制`.env`，请将其作为凭据进行保护并与转储分开存放。丢失所需的加密版本将导致这些已存储的凭据无法恢复；用户必须重新输入其API密钥。提供商端的密钥在撤销前保持有效。

恢复步骤：

1. 停止所有机器人实例。在运行命令之前，在常规凭据源中配置目标数据库设置、Discord令牌以及匹配的加密版本。务必完全保留原始密钥。
2. 安装`psql`以及转储所使用的扩展，包括存在时的`pgvector`。运行`bun run restore-backup --from backups/<bundle-directory>`或使用`--latest`。恢复程序在检查密钥之前会启用`pgcrypto`，包括在全新的目标数据库上。数据库账户必须拥有创建该扩展的权限，或者必须由数据库管理员预先启用它。扩展设置错误会与凭据恢复失败分开报告。
3. 恢复程序在加载转储之前会使用提供的密钥检查每个加密凭据。缺失或错误的密钥会在执行破坏性SQL之前停止操作；`pgcrypto`可能已被启用。检查目标并确认`RESTORE`；非空目标还需要确认`RESTORE ANYWAY`。仅恢复受信任的SQL转储。
4. 保持密钥就位。在重启之前，运行`bun run audit-keys`和`bun run rotate-keys --dry-run`。如果凭据需要迁移到活动版本，请运行`bun run rotate-keys --bot-stopped`并在启动任何实例前再次审计。`ON_ERROR_STOP=1`会在出现第一个SQL错误时停止，但先前的语句可能已经更改了数据。在机器人保持停止的状态下修复错误并重试。

旧版备份包在`config.env`中包含原始凭据。恢复程序会识别它们并发出警告，但绝不会复制或加载该文件。请在私密位置仔细检查它，并自行将其加密版本配置到目标凭据源中。保持目标数据库设置就位。即使在升级后，现有的备份包仍包含凭据。一旦将加密密钥归档在受保护的存储中，你就可以从旧版备份包中删除 `config.env`；恢复程序仍会接受该备份包，并通过解密转储来检查密钥。

## 轮换加密密钥
<!-- anchor: rotating-encryption-keys -->

1. 保留活动数据和已保留备份所需的每个密钥的受保护副本。在废弃任何版本之前，先进行数据库备份并在一次性数据库上测试恢复。
2. 使用`openssl rand -base64 32`（或`docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"`）生成新密钥，并将其作为`CRYPTO_SECRET_V<version>`添加到机器人使用的相同凭据源中。轮换操作拒绝短于32个字符的当前密钥。如果你需要明确选择，请将`CRYPTO_SECRET_CURRENT`设置为该版本。保留所有旧密钥。旧版`CRYPTO_SECRET`即为V1。
3. 停止所有机器人实例并暂停凭据写入进程。在生产环境中，使用`RUN_ENV=production`以及与启动时相同的挂载`SECRET_FILE`、旧版`GCP_SECRET_FILE`或AWS机密与访问配置运行脚本。审计和轮换使用来自该凭据源的机器人的`POSTGRES_*`设置。
4. 运行`bun run audit-keys`，然后运行`bun run rotate-keys --dry-run`。两者都必须成功。审计会报告失败的表、列、行ID和版本，同时继续检查凭据。其版本计数包含恢复失败的项，如果退出状态非零则不能视为成功。模拟运行在不更改行的情况下解密凭据。
5. 运行`bun run rotate-keys --bot-stopped`，然后运行`bun run audit-keys`。任何失败的查询或行都会产生非零退出，包括部分成功的情况。保留所有版本，修复故障并重新运行。并发的行替换将被拒绝而不是覆盖。
6. 在一次性恢复的数据库中，测试仅配置了保留的当前密钥的审计。保留的较旧备份需要使用存档密钥进行其各自经过测试的恢复。只有在完成这些检查之后，你才可以从活动凭据源中删除旧版本。在保留其备份的期间内保留单独受保护的密钥存档，然后重启所有机器人实例。

`--bot-stopped`标志记录你的确认；它无法检测其他正在运行的实例。轮换脚本不会清除另一个进程的凭据缓存。版本不必连续：当两个密钥均可用时，V1凭据可以直接迁移到V4。

轮换还会将旧版的null版本标记替换为明确的当前版本，包括当前版本为V1的情况。

## 更新

首先停止正在运行的机器人，然后使用备份优先更新程序：

```sh
bun run update
```

它运行`bun run backup`，然后运行 `git pull --rebase --autostash`，最后运行`bun install --frozen-lockfile`。备份包保存到`backups/`，并包含数据库转储和清单。如果需要保留`.env`，请单独复制并保护它。添加`--skip-backup`以绕过更新前备份。

手动回退：

```sh
bun run backup
git pull --rebase --autostash
bun install --frozen-lockfile
```

如果你从`dist/`运行预编译代码，请使用`bun run update --build`。对于Docker Compose部署，请使用`bun run update --docker`； 更新程序首先运行`docker compose run --rm tomoribot bun run backup`。

### 已移除的环境变量

这些变量先前配置了内部文本启发式、Discord组件超时、缓存持续时间、命令冷却时间和采样默认值。它们现在已在代码中修复为以前的默认值，因此升级后`.env`中的旧值将被忽略。运行`bun run env-doctor`以列出`.env`中你可以安全删除的所有剩余变量。取决于你的主机、网络、凭据或成本的设置仍然是环境变量。

命令冷却时间现在使用单个乘数`COMMAND_COOLDOWN_SCALE`（默认`1`；`0`禁用冷却时间），替换单个`COOLDOWN_*`变量和`DEFAULT_COMMAND_COOLDOWN`。要保留自定义冷却时间，请将旧值除以之前的默认值：例如，`COOLDOWN_PERSONA=1000`变为`COMMAND_COOLDOWN_SCALE=0.1`。

<details>
<summary>所有177个已删除的变量及其固定值</summary>

| 多变的 | 固定值 |
|---|---|
| `ALLOW_PERSONAL_LOCAL_ENDPOINTS` | 无（从未读过） |
| `BLOCK_USER_MAX_DURATION_HOURS` | `168` |
| `BOT_GENERATE_IMAGE_AGENT_MAX_ITERATIONS` | `5` |
| `BOT_GENERATE_IMAGE_HISTORY_LIMIT` | `24` |
| `BOT_GENERATE_SCENE_MAX_CYCLES` | `10` |
| `BOT_JSON_REPAIR_MAX_CHARS` | `1048576` |
| `BOT_MAX_CONSECUTIVE_TOOL_ERRORS` | `5` |
| `BOT_MAX_FUNCTION_CALL_ITERATIONS` | `100` |
| `BOT_MAX_STOP_STRINGS_PER_SERVER` | `40` |
| `BOT_MAX_STOP_STRING_LENGTH` | `200` |
| `BRAVE_IMAGE_COMPRESSION_TARGET_MB` | `BRAVE_IMAGE_DISCORD_LIMIT_MB`以下之一（默认为`7`） |
| `CHANNEL_WHITELIST_CACHE_TTL_MINUTES` | `5` |
| `CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE` | `10` |
| `CONDITIONING_REASON_MAX_LENGTH` | `250` |
| `COOLDOWN_CONDITIONING` | `3000`，按`COMMAND_COOLDOWN_SCALE`缩放 |
| `COOLDOWN_CONFIG` | `3000`，按`COMMAND_COOLDOWN_SCALE`缩放 |
| `COOLDOWN_FORGET` | `3000`，按`COMMAND_COOLDOWN_SCALE`缩放 |
| `COOLDOWN_MEMORY` | `3000`，按`COMMAND_COOLDOWN_SCALE`缩放 |
| `COOLDOWN_PERSONA` | `10000`，按`COMMAND_COOLDOWN_SCALE`缩放 |
| `COOLDOWN_PERSONAL` | `3000`，按`COMMAND_COOLDOWN_SCALE`缩放 |
| `COOLDOWN_SERVER` | `3000`，按`COMMAND_COOLDOWN_SCALE`缩放 |
| `COOLDOWN_TEACH` | `3000`，按`COMMAND_COOLDOWN_SCALE`缩放 |
| `DEEPSEEK_EXPRESSION_BATCH_SIZE` | `20` |
| `DEFAULT_COMMAND_COOLDOWN` | `1600`，按`COMMAND_COOLDOWN_SCALE`缩放 |
| `DELIBERATE_TOOL_CONTEXT_TURNS` | `4`; 服务器仍然可以在`/config`中更改它（实验行为下的工具上下文） |
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
| `NAI_CFG_RESCALE` | `0.0`; 服务器仍然可以在`/config`（NovelAI图像设置）中更改它 |
| `NAI_CHAR_REF_DESCRIPTION` | `character&style` |
| `NAI_CHAR_REF_INFO_EXTRACTED` | `1.0` |
| `NAI_CHAR_REF_SECONDARY_STRENGTH` | `0.0` |
| `NAI_CHAR_REF_STRENGTH` | `0.6` |
| `NAI_GLM_CHARS_PER_TOKEN` | `2.5` |
| `NAI_GLM_CONTEXT_LIMIT` | `12288` |
| `NAI_IMAGE_NEGATIVE_PROMPT` | 内置文本 |
| `NAI_IMAGE_NOISE_SCHEDULE` | `karras`; 服务器仍然可以在`/config`（NovelAI图像设置）中更改它 |
| `NAI_IMAGE_SAMPLER` | `k_euler_ancestral`; 服务器仍然可以在`/config`（NovelAI图像设置）中更改它 |
| `NAI_IMAGE_SCALE` | `5`; 服务器仍然可以在`/config`（NovelAI图像设置）中更改它 |
| `NAI_IMAGE_STEPS` | `23`; 服务器仍然可以在`/config`（NovelAI图像设置）中更改它 |
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
| `SHORT_TERM_MEMORY_DEFAULT_CRUDE_MESSAGE_COUNT` | `6`; 服务器仍然可以在`/config`（短期记忆设置）中更改它 |
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
| `STATS_DASHBOARD_TIMEOUT_MS` | 无（从未读过） |
| `STAT_FLUSH_INTERVAL_MS` | `5000` |
| `STAT_FLUSH_MAX_BUFFER` | `1000` |
| `STM_FRESH_INJECTION_DEPTH` | `2` |
| `STM_FRESH_WINDOW_MINUTES` | `60` |
| `STM_MAX_CATEGORIES` | `5` |
| `STREAM_ABANDONED_SETTLE_TIMEOUT_MS` | `5000` |
| `ST_PRESET_CACHE_TTL_MINUTES` | `10` |
| `SYSPROMPT_SHOW_MAX_PREVIEW` | `3800` |
| `TASK_EXPAND_BUTTON_TIMEOUT_MS` | `86400000` |
| `TENOR_FETCH_TIMEOUT_MS` | 无（从未读过） |
| `TEST_POSTGRES_DB` | 无（从未读过） |
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

### 已移除的TTS本地服务器变量

`servers/tts/`下的TTS本地服务器不再使用共享端口回退、每引擎限制或身份验证设置。`.env`或shell中的旧设置将被忽略：

- **端口：** `TOMORI_TTS_PORT`被删除，因为单个共享变量将每个启动的服务器绑定到同一端口。每个引擎现在使用其专用变量：`CHATTERBOX_PORT` (8011)、`QWEN3TTS_PORT`（8012或语音设计模式下的8014）、`IRODORI_TTS_PORT` (8013)、`FISH_S2_PORT` (8015)、`VOXCPM2_PORT` (8016)、`COSYVOICE3_PORT` (8017) 和`MOSS_TTS_PORT` （8018）。
- **身份验证：**本地服务器不再验证承载令牌或限制远程网络绑定。如果你之前设置了`FISH_S2_API_KEY`、`VOXCPM2_API_KEY`、`TOMORI_TTS_API_KEY`或`COSYVOICE3_BEARER_TOKEN`，则端点现在无需凭据即可接受请求。在绑定环回之前检查[网络访问](/zh-CN/self-hosting/local-endpoints/text-to-speech/#network-access)。
- **安装程序固定：** Fish Speech和CosyVoice的提交哈希值和模型修订固定在安装程序脚本中。更新它们需要编辑每个脚本中的固定值。

<details>
<summary>全部删除TTS本地服务器变量</summary>

| 多变的 | 现在 |
|---|---|
| `COSYVOICE3_ALLOW_REMOTE_BIND` | 删除； 接受任何`TOMORI_TTS_HOST` |
| `COSYVOICE3_BEARER_TOKEN` | 删除； 没有认证 |
| `COSYVOICE3_MAX_REF_AUDIO_BYTES` | `26214400` |
| `COSYVOICE3_MAX_REF_AUDIO_SECONDS` | `30` |
| `COSYVOICE3_MODEL_ID` | `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` |
| `COSYVOICE3_MODEL_REVISION` | 固定在安装程序中 |
| `COSYVOICE3_RUNTIME_COMMIT` | 固定在安装程序中 |
| `COSYVOICE3_RUNTIME_DIR` | `servers/tts/cosyvoice3/CosyVoice` |
| `COSYVOICE3_RUNTIME_REPO` | `https://github.com/QwenAudio/CosyVoice.git` |
| `COSYVOICE3_UPDATE` | 删除； 重新运行检查安装程序的引脚 |
| `FISH_S2_ALLOW_INSECURE_REMOTE` | 删除； 接受任何`TOMORI_TTS_HOST` |
| `FISH_S2_API_KEY` | 删除； 没有认证 |
| `FISH_S2_LAUNCH_TIMEOUT_MS` | `TOMORI_TTS_STARTUP_TIMEOUT_MS`适用（`300000`） |
| `FISH_S2_MAX_REF_AUDIO_BYTES` | `10485760` |
| `FISH_S2_RUNTIME_REF` | 固定在安装程序中 |
| `FISH_S2_RUNTIME_REPOSITORY` | `https://github.com/Imagilux/fish-speech.git` |
| `FISH_S2_STARTUP_TIMEOUT_SECONDS` | `180` |
| `FISH_S2_SYNTHESIS_TIMEOUT_SECONDS` | `1800` |
| `FISH_S2_UPDATE` | 删除； 重新运行检查安装程序的PIN并刷新模型 |
| `FISH_S2_UPDATE_MODEL_REVISION` | 使用`FISH_S2_MODEL_REVISION` |
| `FISH_S2_UPDATE_REF` | 固定在安装程序中 |
| `FISH_S2_UPSTREAM_HOST` | `127.0.0.1` |
| `FISH_SPEECH_DIR` | `servers/tts/fishs2/fish-speech` |
| `MOSS_TTS_MAX_REF_AUDIO_BYTES` | `10485760` |
| `TOMORI_TTS_ALLOW_REMOTE_BIND` | 删除； 接受任何`TOMORI_TTS_HOST` |
| `TOMORI_TTS_API_KEY` | 删除； 没有认证 |
| `TOMORI_TTS_MAX_REF_AUDIO_BYTES` | `10485760`（鱼） |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000`（`1000`为Irodori-TTS） |
| `TOMORI_TTS_PORT` | 引擎自己的端口变量 |
| `TTS_CLONE_TIMEOUT_MS` | 使用`TTS_SYNTHESIZE_TIMEOUT_MS` |
| `VOXCPM2_API_KEY` | 删除； 没有认证 |
| `VOXCPM2_MAX_REF_AUDIO_BYTES` | `10485760` |

</details>

## 备份和恢复

`bun run backup` 会在 `backups/`（如果在 `.env` 中覆盖，则为 `TOMORI_BACKUP_DIR`）中创建一个带有时间戳的备份包，其中包含你的整个 PostgreSQL 数据库。它不包含 `.env`，因此请将加密密钥保存在独立的受保护存储中（请参阅[数据库备份与恢复密钥](#database-backups-and-recovery-keys)）。使用以下命令恢复最新的备份包：

```sh
bun run restore-backup --latest
```

或者恢复特定的包：

```sh
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

`bun run backup:personas`是一个较窄的导出：仅限人格预设和每个人格服务器内存，跨所有服务器。它必须通过`/persona import`手动重新导入，并且不能与`restore-backup`一起使用（这会导致主键冲突）。

TomoriBot还在非生产环境中进行自动启动备份，并且完整恢复需要目标数据库上存在`pgvector`扩展。[安全迁移](/zh-CN/self-hosting/safe-migration/) 中详细介绍了两者，如果你希望直接驱动工具，还可以查看手动`pg_dump`和`pg_restore`程序。

## Docker Compose的备份

Docker Compose支持在应用容器内做启动时自动备份。备份包会写到主机的`backups/`目录，因为Compose把它挂载进了容器。

手动做Docker备份：

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

Docker还原：

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

`bun run backup`、`bun run update`、`bun run nuke-db`这类主机端脚本不会自动经由Docker运行。要让主机端脚本改而作用于Compose的数据库，请在装好Bun和PostgreSQL客户端工具的主机上运行它们，并设置：

备份与恢复还需要PostgreSQL客户端工具；`nuke-db`只需要Bun。

```dotenv
POSTGRES_HOST=localhost
POSTGRES_PORT=15432
POSTGRES_USER=tomori
POSTGRES_PASSWORD=your_password
POSTGRES_DB=tomodb
```

## 干净重装

`bun run nuke-db`会删除所有表；之后启动bot会从零重新初始化数据库结构、种子数据和迁移。当你想要一块仍然能回滚的干净底板时，把它和一次全新的`bun run backup`配合使用：没有当前备份就绝不要运行它。

## 另见

- [安全迁移](/zh-CN/self-hosting/safe-migration/)：拉取之前先备份，以及`pgvector`这个还原前提
- [数据处理](/zh-CN/features/knowledge/data-handling/)：按用户、在Discord内进行的导出、导入与删除
- [安装向导](/zh-CN/self-hosting/setup-wizard/)：引导式的`bun run setup`安装
