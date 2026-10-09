---
title: "維護與備份"
sidebar:
  order: 5
---

使用CLI維護腳本來管理你的自架TomoriBot實例，以更新程式碼、備份或還原資料、輪換加密金鑰以及檢查環境變數。從主機終端機或Docker環境執行這些命令。關於Discord內的資料匯出和刪除，請參閱[資料處理](/zh-TW/features/knowledge/data-handling/)。

如果你使用`git pull`進行更新，請先查看 [安全遷移](/zh-TW/self-hosting/safe-migration/) 以在啟動遷移運行程式應用架構變更之前建立備份。

## 維護指令稿

| 指令 | 說明 |
|---|---|
| `bun run setup` | 開啟設定精靈，進行基礎安裝與選用模組。|
| `bun run update` | 先備份，再拉取最新程式碼並安裝相依套件。|
| `bun run backup` | 在`backups/`中建立包含資料庫傾印與所需加密版本中繼資料的套件。秘密資訊分開保存。|
| `bun run restore-backup` | 使用分開佈建的加密金鑰還原資料庫（`--latest`或`--from backups/<dir>`）。|
| `bun run backup:personas` | 只匯出所有伺服器上的人格（含伺服器記憶）；用`/persona import`重新匯入。|
| `bun run nuke-db` | 刪除所有資料表（之後啟動bot即可重新初始化）。|
| `bun run purge-commands` | 清除所有已註冊的Discord斜線指令。|
| `bun run rotate-keys --bot-stopped` | 把所有加密欄位重新加密到目前的金鑰版本。|
| `bun run env-doctor` | 唯讀檢查你的設定：列出沒有任何程式碼讀取的`.env`項目（僅名稱，絕不包含值）以及每個變數的使用位置。|

主機上的`bun run backup`需要PATH中有`pg_dump`，主機上的`bun run restore-backup`需要PATH中有`psql`。`bun run update`的備份也需要`pg_dump`。`--docker`更新路徑在容器內執行備份，因此需要主機具備Bun、Git和Docker，但不需要主機具備PostgreSQL工具。

備份與還原指令透過系統暫存資料夾中的暫存密碼檔案將資料庫密碼傳遞給`pg_dump`與`psql`，因此機器上的其他使用者無法從處理程序清單中讀取該密碼。該資料夾必須可寫入。指令執行完畢後該檔案會被刪除。

## 資料庫備份與復原金鑰
<!-- anchor: database-backups-and-recovery-keys -->

`bun run backup`和自動啟動備份會產生`database.sql`與`bundle_info.json`。資訊清單檔案識別僅含資料庫的套件，並列出在該傾印中找到的加密版本。版本清單說明復原所需的金鑰；還原程序會檢查實際的可解密性。建立傾印並不要求舊金鑰存在，因此遺失的歷史金鑰不會阻止保留資料庫的其餘部分。它絕不會複製`.env`。僅含資料庫的傾印仍包含私密對話與記憶，因此請限制對備份目錄的存取。

請將加密版本保存在分開的受保護儲存空間中，例如加密密碼管理器或機密管理器。如果你自行複製`.env`，請將其作為認證資訊進行保護並與傾印分開存放。遺失所需的加密版本將導致這些已儲存的認證資訊無法復原；使用者必須重新輸入其API金鑰。提供者端的金鑰在撤銷前保持有效。

還原步驟：

1. 停止所有機器人執行個體。在執行指令之前，在常規機密來源中佈建目標資料庫設定、Discord權杖以及相符的加密版本。務必完全保留原始金鑰。
2. 安裝`psql`以及傾印所使用的擴充功能，包括存在時的`pgvector`。執行`bun run restore-backup --from backups/<bundle-directory>`或使用`--latest`。還原程式在檢查金鑰之前會啟用`pgcrypto`，包括在全新的目標資料庫上。資料庫帳戶必須擁有建立該擴充功能的權限，或者必須由資料庫管理員預先啟用它。擴充功能設定錯誤會與認證資訊復原失敗分開回報。
3. 還原程式在載入傾印之前會使用提供的金鑰檢查每個加密認證資訊。缺少或錯誤的金鑰會在執行破壞性SQL之前停止操作；`pgcrypto`可能已被啟用。檢查目標並確認`RESTORE`；非空目標還需要確認`RESTORE ANYWAY`。僅還原受信任的SQL傾印。
4. 保持金鑰就位。在重新啟動之前，執行`bun run audit-keys`和`bun run rotate-keys --dry-run`。如果認證資訊需要遷移到作用中版本，請執行`bun run rotate-keys --bot-stopped`並在啟動任何執行個體前再次稽核。`ON_ERROR_STOP=1`會在出現第一個SQL錯誤時停止，但先前的陳述式可能已經變更了資料。在機器人保持停止的狀態下修復錯誤並重試。

舊版套件在`config.env`中包含原始秘密資訊。還原程式會識別它們並發出警告，但絕不會複製或載入該檔案。請在私密位置仔細檢查它，並自行將其加密版本佈建到目標機密來源中。保持目標資料庫設定就位。即使在升級後，現有的套件仍包含秘密資訊。一旦將加密金鑰封存在受保護的儲存空間中，你就可以從舊版套件中刪除 `config.env`；還原程式仍會接受該套件，並透過解密傾印來檢查金鑰。

## 輪換加密金鑰
<!-- anchor: rotating-encryption-keys -->

1. 保留作用中資料和已保留備份所需的每個金鑰的受保護複本。在淘汰任何版本之前，先進行資料庫備份並在一次性資料庫上測試復原。
2. 使用`openssl rand -base64 32`（或`docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"`）產生新金鑰，並將其作為`CRYPTO_SECRET_V<version>`新增到機器人使用的相同機密來源中。輪換操作拒絕短於32個字元的目前金鑰。如果你需要明確選擇，請將`CRYPTO_SECRET_CURRENT`設定為該版本。保留所有舊金鑰。舊版`CRYPTO_SECRET`即為V1。
3. 停止所有機器人執行個體並暫停認證資訊寫入處理程序。在實際執行環境中，使用`RUN_ENV=production`以及與啟動時相同的掛載`SECRET_FILE`、舊版`GCP_SECRET_FILE`或AWS機密與存取設定執行指令稿。稽核和輪換使用來自該機密來源的機器人的`POSTGRES_*`設定。
4. 執行`bun run audit-keys`，然後執行`bun run rotate-keys --dry-run`。兩者都必須成功。稽核會回報失敗的資料表、欄、資料列識別碼和版本，同時繼續檢查認證資訊。其版本計數包含復原失敗的項目，如果結束狀態非零則不能視為成功。模擬執行在不變更資料列的情況下解密認證資訊。
5. 執行`bun run rotate-keys --bot-stopped`，然後執行`bun run audit-keys`。任何失敗的查詢或資料列都會產生非零結束狀態，包括部分成功的情況。保留所有版本，修復錯誤並重新執行。並行的資料列取代將被拒絕而不是覆寫。
6. 在一次性還原的資料庫中，測試僅設定了保留的目前金鑰的稽核。保留的較舊備份需要使用封存金鑰進行其各自經過測試的復原。只有在完成這些檢查之後，你才可以從作用中機密來源中移除舊版本。在保留其備份的期間內保留分開受保護的金鑰封存，然後重新啟動所有機器人執行個體。

`--bot-stopped`旗標記錄你的確認；它無法偵測其他正在運行的執行個體。輪換指令稿不會清除另一個處理程序的認證快取。版本不必連續：當兩個金鑰均可用時，V1認證資訊可以直接遷移到V4。

輪換還會將舊版的null版本標籤取代為明確的目前版本，包括目前版本為V1的情況。

## 更新

首先停止正在運行的機器人，然後使用備份優先更新程式：

```sh
bun run update
```

它運行`bun run backup`，然後運行`git pull --rebase --autostash`，最後運行`bun install --frozen-lockfile`。備份套件保存到`backups/`，並包含資料庫傾印與資訊清單。如果需要保留`.env`，請單獨複製並保護它。新增`--skip-backup`以繞過更新前備份。

手動回退：

```sh
bun run backup
git pull --rebase --autostash
bun install --frozen-lockfile
```

如果你從`dist/`執行預編譯程式碼，請使用`bun run update --build`。對於Docker Compose部署，請使用`bun run update --docker`；更新程式首先執行`docker compose run --rm tomoribot bun run backup`。

### 已移除的環境變數

這些變數先前配置了內部文字啟發式、Discord元件逾時、快取持續時間、命令冷卻時間和取樣預設值。現在它們已在程式碼中修復為先前的預設值，因此升級後`.env`中的舊值將被忽略。執行`bun run env-doctor`以列出`.env`中你可以安全刪除的所有剩餘變數。取決於你的主機、網路、憑證或成本的設定仍然是環境變數。

命令冷卻時間現在使用單一乘數`COMMAND_COOLDOWN_SCALE`（預設`1`；`0`停用冷卻時間），取代單一`COOLDOWN_*`變數和`DEFAULT_COMMAND_COOLDOWN`。若要保留自訂冷卻時間，請將舊值除以先前的預設值：例如，`COOLDOWN_PERSONA=1000`變為`COMMAND_COOLDOWN_SCALE=0.1`。

<details>
<summary>所有177個已刪除的變數及其固定值</summary>

| 多變的 | 固定值 |
|---|---|
| `ALLOW_PERSONAL_LOCAL_ENDPOINTS` | 無（從未讀過） |
| `BLOCK_USER_MAX_DURATION_HOURS` | `168` |
| `BOT_GENERATE_IMAGE_AGENT_MAX_ITERATIONS` | `5` |
| `BOT_GENERATE_IMAGE_HISTORY_LIMIT` | `24` |
| `BOT_GENERATE_SCENE_MAX_CYCLES` | `10` |
| `BOT_JSON_REPAIR_MAX_CHARS` | `1048576` |
| `BOT_MAX_CONSECUTIVE_TOOL_ERRORS` | `5` |
| `BOT_MAX_FUNCTION_CALL_ITERATIONS` | `100` |
| `BOT_MAX_STOP_STRINGS_PER_SERVER` | `40` |
| `BOT_MAX_STOP_STRING_LENGTH` | `200` |
| `BRAVE_IMAGE_COMPRESSION_TARGET_MB` | `BRAVE_IMAGE_DISCORD_LIMIT_MB`以下之一（預設為`7`） |
| `CHANNEL_WHITELIST_CACHE_TTL_MINUTES` | `5` |
| `CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE` | `10` |
| `CONDITIONING_REASON_MAX_LENGTH` | `250` |
| `COOLDOWN_CONDITIONING` | `3000`，按`COMMAND_COOLDOWN_SCALE`縮放 |
| `COOLDOWN_CONFIG` | `3000`，按`COMMAND_COOLDOWN_SCALE`縮放 |
| `COOLDOWN_FORGET` | `3000`，按`COMMAND_COOLDOWN_SCALE`縮放 |
| `COOLDOWN_MEMORY` | `3000`，按`COMMAND_COOLDOWN_SCALE`縮放 |
| `COOLDOWN_PERSONA` | `10000`，按`COMMAND_COOLDOWN_SCALE`縮放 |
| `COOLDOWN_PERSONAL` | `3000`，按`COMMAND_COOLDOWN_SCALE`縮放 |
| `COOLDOWN_SERVER` | `3000`，按`COMMAND_COOLDOWN_SCALE`縮放 |
| `COOLDOWN_TEACH` | `3000`，按`COMMAND_COOLDOWN_SCALE`縮放 |
| `DEEPSEEK_EXPRESSION_BATCH_SIZE` | `20` |
| `DEFAULT_COMMAND_COOLDOWN` | `1600`，按`COMMAND_COOLDOWN_SCALE`縮放 |
| `DELIBERATE_TOOL_CONTEXT_TURNS` | `4`;伺服器仍然可以在`/config`中更改它（實驗行為下的工具上下文） |
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
| `NAI_CFG_RESCALE` | `0.0`;伺服器仍然可以在`/config`（NovelAI圖像設定）中更改它 |
| `NAI_CHAR_REF_DESCRIPTION` | `character&style` |
| `NAI_CHAR_REF_INFO_EXTRACTED` | `1.0` |
| `NAI_CHAR_REF_SECONDARY_STRENGTH` | `0.0` |
| `NAI_CHAR_REF_STRENGTH` | `0.6` |
| `NAI_GLM_CHARS_PER_TOKEN` | `2.5` |
| `NAI_GLM_CONTEXT_LIMIT` | `12288` |
| `NAI_IMAGE_NEGATIVE_PROMPT` | 內建文字 |
| `NAI_IMAGE_NOISE_SCHEDULE` | `karras`;伺服器仍然可以在`/config`（NovelAI圖像設定）中更改它 |
| `NAI_IMAGE_SAMPLER` | `k_euler_ancestral`;伺服器仍然可以在`/config`（NovelAI圖像設定）中更改它 |
| `NAI_IMAGE_SCALE` | `5`;伺服器仍然可以在`/config`（NovelAI圖像設定）中更改它 |
| `NAI_IMAGE_STEPS` | `23`;伺服器仍然可以在`/config`（NovelAI圖像設定）中更改它 |
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
| `SHORT_TERM_MEMORY_DEFAULT_CRUDE_MESSAGE_COUNT` | `6`;伺服器仍然可以在`/config`（短期記憶體設定）中更改它 |
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
| `STATS_DASHBOARD_TIMEOUT_MS` | 無（從未讀過） |
| `STAT_FLUSH_INTERVAL_MS` | `5000` |
| `STAT_FLUSH_MAX_BUFFER` | `1000` |
| `STM_FRESH_INJECTION_DEPTH` | `2` |
| `STM_FRESH_WINDOW_MINUTES` | `60` |
| `STM_MAX_CATEGORIES` | `5` |
| `STREAM_ABANDONED_SETTLE_TIMEOUT_MS` | `5000` |
| `ST_PRESET_CACHE_TTL_MINUTES` | `10` |
| `SYSPROMPT_SHOW_MAX_PREVIEW` | `3800` |
| `TASK_EXPAND_BUTTON_TIMEOUT_MS` | `86400000` |
| `TENOR_FETCH_TIMEOUT_MS` | 無（從未讀過） |
| `TEST_POSTGRES_DB` | 無（從未讀過） |
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

### 已移除的TTS本機伺服器變數

`servers/tts/`下的TTS本機伺服器不再使用共用連接埠回退、每引擎限製或驗證設定。`.env`或shell中的舊設定將被忽略：

- **連接埠：**`TOMORI_TTS_PORT`已移除，因為單一共用變數會讓所有啟動的伺服器綁定同一個連接埠。每個引擎改用各自的變數：`CHATTERBOX_PORT`（8011）、`QWEN3TTS_PORT`（8012，語音設計模式為8014）、`IRODORI_TTS_PORT`（8013）、`FISH_S2_PORT`（8015）、`VOXCPM2_PORT`（8016）、`COSYVOICE3_PORT`（8017）及`MOSS_TTS_PORT`（8018）。
- **身份驗證：**本機伺服器不再驗證承載令牌或限制遠端網路綁定。如果你之前設定了`FISH_S2_API_KEY`、`VOXCPM2_API_KEY`、`TOMORI_TTS_API_KEY`或`COSYVOICE3_BEARER_TOKEN`，則端點現在無需憑證即可接受請求。在綁定環回之前檢查[網路存取](/zh-TW/self-hosting/local-endpoints/text-to-speech/#network-access)。
- **安裝程式固定：** Fish Speech和CosyVoice的提交雜湊值和模型修訂固定在安裝程式腳本中。更新它們需要編輯每個腳本中的固定值。

<details>
<summary>全部刪除TTS本機伺服器變數</summary>

| 多變的 | 現在 |
|---|---|
| `COSYVOICE3_ALLOW_REMOTE_BIND` | 刪除；接受任何`TOMORI_TTS_HOST` |
| `COSYVOICE3_BEARER_TOKEN` | 刪除；沒有認證 |
| `COSYVOICE3_MAX_REF_AUDIO_BYTES` | `26214400` |
| `COSYVOICE3_MAX_REF_AUDIO_SECONDS` | `30` |
| `COSYVOICE3_MODEL_ID` | `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` |
| `COSYVOICE3_MODEL_REVISION` | 固定在安裝程序中 |
| `COSYVOICE3_RUNTIME_COMMIT` | 固定在安裝程序中 |
| `COSYVOICE3_RUNTIME_DIR` | `servers/tts/cosyvoice3/CosyVoice` |
| `COSYVOICE3_RUNTIME_REPO` | `https://github.com/QwenAudio/CosyVoice.git` |
| `COSYVOICE3_UPDATE` | 刪除；重新執行檢查安裝程式的引腳 |
| `FISH_S2_ALLOW_INSECURE_REMOTE` | 刪除；接受任何`TOMORI_TTS_HOST` |
| `FISH_S2_API_KEY` | 刪除；沒有認證 |
| `FISH_S2_LAUNCH_TIMEOUT_MS` | `TOMORI_TTS_STARTUP_TIMEOUT_MS`適用（`300000`） |
| `FISH_S2_MAX_REF_AUDIO_BYTES` | `10485760` |
| `FISH_S2_RUNTIME_REF` | 固定在安裝程序中 |
| `FISH_S2_RUNTIME_REPOSITORY` | `https://github.com/Imagilux/fish-speech.git` |
| `FISH_S2_STARTUP_TIMEOUT_SECONDS` | `180` |
| `FISH_S2_SYNTHESIS_TIMEOUT_SECONDS` | `1800` |
| `FISH_S2_UPDATE` | 刪除；重新執行檢查安裝程式的PIN並刷新模型 |
| `FISH_S2_UPDATE_MODEL_REVISION` | 使用`FISH_S2_MODEL_REVISION` |
| `FISH_S2_UPDATE_REF` | 固定在安裝程序中 |
| `FISH_S2_UPSTREAM_HOST` | `127.0.0.1` |
| `FISH_SPEECH_DIR` | `servers/tts/fishs2/fish-speech` |
| `MOSS_TTS_MAX_REF_AUDIO_BYTES` | `10485760` |
| `TOMORI_TTS_ALLOW_REMOTE_BIND` | 刪除；接受任何`TOMORI_TTS_HOST` |
| `TOMORI_TTS_API_KEY` | 刪除；沒有認證 |
| `TOMORI_TTS_MAX_REF_AUDIO_BYTES` | `10485760`（魚） |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000`（`1000`為Irodori-TTS） |
| `TOMORI_TTS_PORT` | 引擎自己的連接埠變量 |
| `TTS_CLONE_TIMEOUT_MS` | 使用`TTS_SYNTHESIZE_TIMEOUT_MS` |
| `VOXCPM2_API_KEY` | 刪除；沒有認證 |
| `VOXCPM2_MAX_REF_AUDIO_BYTES` | `10485760` |

</details>

## 備份和復原

`bun run backup` 會在 `backups/`（如果在 `.env` 中覆寫，則為 `TOMORI_BACKUP_DIR`）中建立一個帶有時間戳記的套件，其中包含你的整個 PostgreSQL 資料庫。它不包含 `.env`，因此請將加密金鑰保存在獨立且受保護的儲存空間中（請參閱[資料庫備份與復原金鑰](#database-backups-and-recovery-keys)）。使用以下指令還原最新的套件：

```sh
bun run restore-backup --latest
```

或恢復特定的包：

```sh
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

`bun run backup:personas`是一個較窄的導出：僅限人格預設和每個人格伺服器內存，跨所有伺服器。它必須透過`/persona import`手動重新匯入，並且不能與`restore-backup`一起使用（這會導致主鍵衝突）。

TomoriBot也在非生產環境中進行自動啟動備份，且完整復原需要目標資料庫上存在`pgvector`擴充。[安全遷移](/zh-TW/self-hosting/safe-migration/) 中詳細介紹了兩者，如果你希望直接驅動工具，你也可以查看手動`pg_dump`和`pg_restore`程式。

## Docker Compose備份

Docker Compose支援在應用程式容器內自動進行啟動備份。套件會寫到主機的`backups/`目錄，因為Compose會將它掛載進容器。

手動的Docker備份：

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

Docker還原：

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

`bun run backup`、`bun run update`、`bun run nuke-db`這類主機端指令稿不會自動透過Docker執行。若想改為對Compose資料庫執行主機端指令稿，請在主機上安裝Bun與PostgreSQL用戶端工具後執行，並設定：

備份與還原還需要PostgreSQL用戶端工具；`nuke-db`只需要Bun。

```dotenv
POSTGRES_HOST=localhost
POSTGRES_PORT=15432
POSTGRES_USER=tomori
POSTGRES_PASSWORD=your_password
POSTGRES_DB=tomodb
```

## 乾淨重裝

`bun run nuke-db`會刪除所有資料表；之後啟動bot會從零重新初始化結構描述、種子資料與移轉。當你想要一個仍然能回溯的乾淨狀態時，請搭配新的`bun run backup`一起使用，而且永遠不要在沒有現行備份的情況下執行它。

## 延伸閱讀

- [安全移轉](/zh-TW/self-hosting/safe-migration/)：拉取前先備份，以及`pgvector`的還原前置條件
- [資料處理](/zh-TW/features/knowledge/data-handling/)：Discord內、以使用者為單位的匯出、匯入與刪除
- [設定精靈](/zh-TW/self-hosting/setup-wizard/)：引導式的`bun run setup`安裝
