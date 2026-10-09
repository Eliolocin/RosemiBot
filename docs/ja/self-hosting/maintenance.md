---
title: "メンテナンスとバックアップ"
sidebar:
  order: 5
---

CLIメンテナンススクリプトを使用してセルフホスト型TomoriBotインスタンスを管理し、コードの更新、データのバックアップまたは復元、暗号化キーのローテーション、環境変数の検査を行います。ホスト端末またはDocker環境からこれらのコマンドを実行します。Discord内のデータのエクスポートと削除については、[データ処理](/ja/features/knowledge/data-handling/) を参照してください。

`git pull`で更新する場合は、まず [安全な移行](/ja/self-hosting/safe-migration/) を確認して、オンブート移行ランナーがスキーマ変更を適用する前にバックアップを作成してください。

## メンテナンススクリプト

| コマンド | 説明 |
|---|---|
| `bun run setup` | 基本インストールとオプションモジュール用のセットアップウィザードを開きます。|
| `bun run update` | 先にバックアップを取ってから、最新のコードをプルして依存関係をインストールします。|
| `bun run backup` | データベースダンプと必要な暗号化バージョンメタデータを含むバンドルを`backups/`に作成します。シークレットは個別に保持されます。|
| `bun run restore-backup` | 個別にプロビジョニングされた暗号化キーを使用してデータベースを復元します（`--latest`または`--from backups/<dir>`）。|
| `bun run backup:personas` | すべてのサーバーにまたがるペルソナ（およびサーバーメモリー）のみをエクスポートします。`/persona import`経由で再インポートします。|
| `bun run nuke-db` | すべてのテーブルを削除します（その後ボットを起動して再初期化します）。|
| `bun run purge-commands` | 登録されているすべてのDiscordスラッシュコマンドをクリアします。|
| `bun run rotate-keys --bot-stopped` | 暗号化されているすべてのフィールドを現在のキーバージョンに再暗号化します。|
| `bun run env-doctor` | 設定を変更せずに確認し、コードで読み取られない`.env`変数の名前を表示します。|

ホストの`bun run backup`には`pg_dump`、`bun run restore-backup`には`psql`がPATHに必要です。`bun run update`もバックアップに`pg_dump`を使用します。`--docker`の場合、バックアップはコンテナ内で実行されるため、ホストにはBun、Git、Dockerが必要で、PostgreSQLクライアントツールは不要です。

バックアップコマンドと復元コマンドは、システムの一時フォルダー内にある短期間のパスワードファイルを介してデータベースパスワードを`pg_dump`および`psql`に渡すため、マシン上の他のユーザーがプロセスリストから読み取ることはできません。そのフォルダーは書き込み可能である必要があります。コマンドが終了すると、ファイルは削除されます。

## データベースのバックアップとリカバリキー
<!-- anchor: database-backups-and-recovery-keys -->

`bun run backup` と自動起動時バックアップは、`database.sql` と `bundle_info.json` を生成します。マニフェストはデータベースのみのバンドルであることを識別し、そのダンプで見つかった暗号化バージョンを一覧表示します。バージョンインベントリはリカバリに必要なキーを示し、復元時に実際の復号可能性を検証します。ダンプの作成には古いキーが存在する必要はないため、過去のキーが見つからなくてもデータベースの残りの部分を保持できます。`.env` をコピーすることはありません。データベースのみのダンプにもプライベートな会話やメモリーが含まれているため、バックアップディレクトリへのアクセスを制限してください。

暗号化バージョンは、暗号化されたパスワードマネージャーやシークレットマネージャーなどの保護された別のストレージに保管してください。`.env` を自分でコピーする場合は、認証情報として保護し、ダンプとは別に保管してください。必要な暗号化バージョンが失われると、保存されている認証情報は復元できなくなり、ユーザーはAPIキーを再入力する必要があります。プロバイダー側のキーは失効するまで有効なままです。

復元するには：

1. すべてのボットインスタンスを停止します。コマンドを実行する前に、通常のシークレットソースに対象データベース設定、Discordトークン、および対応する暗号化バージョンをプロビジョニングします。元のキーを完全にそのまま保持してください。
2. `psql` と、ダンプで使用されている拡張機能（存在する場合は `pgvector` を含む）をインストールします。`bun run restore-backup --from backups/<bundle-directory>` を実行するか、`--latest` を使用します。復元処理は、新規の対象データベースを含め、キーを検証する前に `pgcrypto` を有効化します。データベースアカウントにその拡張機能を作成する権限が付与されているか、データベース管理者が事前に有効化しておく必要があります。拡張機能のセットアップエラーは、認証情報の復旧失敗とは別に報告されます。
3. 復元処理は、ダンプを読み込む前に、指定されたキーを使用して暗号化されたすべての認証情報を検証します。キーが存在しないか間違っている場合、破壊的なSQLが実行される前に処理が停止します（`pgcrypto` はすでに有効化されている可能性があります）。復元先を確認して `RESTORE` と承認します。空でない復元先の場合は `RESTORE ANYWAY` も必要です。信頼できるSQLダンプのみを復元してください。
4. キーをそのまま維持します。再起動する前に、`bun run audit-keys` と `bun run rotate-keys --dry-run` を実行します。認証情報をアクティブなバージョンに移行する必要がある場合は、`bun run rotate-keys --bot-stopped` を実行し、インスタンスを起動する前にもう一度監査してください。`ON_ERROR_STOP=1` は最初のSQLエラーで停止しますが、それより前のステートメントによってすでにデータが変更されている可能性があります。ボットを停止したままエラーを修正して再試行してください。

レガシーバンドルには `config.env` に未加工のシークレットが含まれています。復元処理はそれらを検出して警告しますが、そのファイルをコピーまたは読み込むことはありません。安全な場所で内容を確認し、その暗号化バージョンを対象のシークレットソースに手動でプロビジョニングしてください。復元先のデータベース設定を維持してください。既存のバンドルはアップグレード後もシークレットを保持したままです。暗号化キーが保護されたストレージにアーカイブされた後は、レガシーバンドルから `config.env` を削除できます。復元処理は引き続きそのバンドルを受け入れ、ダンプを復号してキーを検証します。

## 暗号化キーのローテーション
<!-- anchor: rotating-encryption-keys -->

1. 稼働中のデータおよび保持されているバックアップに必要なすべてのキーの保護されたコピーを保管します。いずれかのバージョンを廃止する前に、データベースのバックアップを取得し、使い捨てのデータベースでリカバリをテストしてください。
2. `openssl rand -base64 32`（または `docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"`）で新しいキーを生成し、ボットが使用するのと同じシークレットソースに `CRYPTO_SECRET_V<version>` として追加します。ローテーションでは、32文字未満の現在のキーは拒否されます。明示的に選択する場合は、`CRYPTO_SECRET_CURRENT` をそのバージョンに設定します。すべての古いキーを保持してください。レガシーな `CRYPTO_SECRET` はV1です。
3. すべてのボットインスタンスを停止し、認証情報の書き込みを一時停止します。本番環境では、起動時と同じマウントされた `SECRET_FILE`、レガシーな `GCP_SECRET_FILE`、またはAWSシークレットおよびアクセス設定を指定して、`RUN_ENV=production` でスクリプトを実行します。監査とローテーションはそのソースからのボットの `POSTGRES_*` 設定を使用します。
4. `bun run audit-keys` を実行し、次に `bun run rotate-keys --dry-run` を実行します。両方が成功する必要があります。監査では、認証情報のチェックを継続しながら、失敗したテーブル、カラム、行ID、およびバージョンが報告されます。そのバージョン数には失敗したリカバリが含まれ、終了ステータスが0以外の場合は成功とみなされません。ドライランでは行を変更せずに認証情報を復号します。
5. `bun run rotate-keys --bot-stopped` を実行し、次に `bun run audit-keys` を実行します。部分的な成功を含め、クエリまたは行が1つでも失敗した場合は0以外の終了ステータスになります。すべてのバージョンを保持し、障害を修正して再実行してください。同時行置換は上書きされずに拒否されます。
6. 使い捨ての復元されたデータベースで、保持された現在のキーのみを設定した監査をテストします。保持されている古いバックアップには、アーカイブされたキーを使用した独自のテスト済みリカバリが必要です。これらの確認が完了した後にのみ、本番シークレットソースから古いバージョンを削除できます。バックアップが保持されている間は保護されたキーアーカイブを個別に保管し、その後すべてのボットインスタンスを再起動してください。

`--bot-stopped` フラグは確認を記録するものであり、他に実行中のインスタンスを検出することはできません。ローテーションスクリプトは他のプロセスの認証情報キャッシュをクリアしません。バージョンは連続している必要はありません。両方のキーが利用可能な場合、V1の認証情報は直接V4に移行できます。

ローテーションでは、現在のバージョンがV1の場合を含め、レガシーなnullバージョンタグも明示的な現在のバージョンに置き換えられます。

## 更新

まず実行中のボットを停止してから、バックアップファーストアップデーターを使用します。

```sh
bun run update
```

これにより、`bun run backup`、次に`git pull --rebase --autostash`、最後に`bun install --frozen-lockfile`が実行されます。バックアップバンドルは`backups/`に保存され、データベースダンプとマニフェストが含まれます。`.env`を保持する必要がある場合は、別途コピーして保護してください。`--skip-backup`を追加して、更新前のバックアップをバイパスします。

手動フォールバック:

```sh
bun run backup
git pull --rebase --autostash
bun install --frozen-lockfile
```

`dist/`からプリコンパイルされたコードを実行する場合は、`bun run update --build`を使用します。Docker Compose展開の場合は、`bun run update --docker`を使用します。アップデーターは最初に`docker compose run --rm tomoribot bun run backup`を実行します。

### 削除された環境変数

これらの変数は、内部テキストヒューリスティック、Discordコンポーネントのタイムアウト、キャッシュ期間、コマンドのクールダウン、およびサンプリングのデフォルトを事前に構成しました。これらはコード内で以前のデフォルトに修正されているため、`.env`の古い値はアップグレード後に無視されます。`bun run env-doctor`を実行して、安全に削除できる`.env`内に残っている変数をリストします。ホスト、ネットワーク、資格情報、またはコストに依存する設定は環境変数のままです。

コマンドのクールダウンでは、個々の`COOLDOWN_*`変数と`DEFAULT_COMMAND_COOLDOWN`を置き換えて、単一の乗数`COMMAND_COOLDOWN_SCALE` (デフォルトは`1`、`0`はクールダウンを無効にします) を使用するようになりました。カスタムのクールダウンを維持するには、古い値を以前のデフォルトで除算します。たとえば、`COOLDOWN_PERSONA=1000`は`COMMAND_COOLDOWN_SCALE=0.1`になります。

<details>
<summary>削除された177個の変数すべてとその固定値</summary>

| 変数 | 固定値 |
|---|---|
| `ALLOW_PERSONAL_LOCAL_ENDPOINTS` | なし（一度も読まれていない） |
| `BLOCK_USER_MAX_DURATION_HOURS` | `168` |
| `BOT_GENERATE_IMAGE_AGENT_MAX_ITERATIONS` | `5` |
| `BOT_GENERATE_IMAGE_HISTORY_LIMIT` | `24` |
| `BOT_GENERATE_SCENE_MAX_CYCLES` | `10` |
| `BOT_JSON_REPAIR_MAX_CHARS` | `1048576` |
| `BOT_MAX_CONSECUTIVE_TOOL_ERRORS` | `5` |
| `BOT_MAX_FUNCTION_CALL_ITERATIONS` | `100` |
| `BOT_MAX_STOP_STRINGS_PER_SERVER` | `40` |
| `BOT_MAX_STOP_STRING_LENGTH` | `200` |
| `BRAVE_IMAGE_COMPRESSION_TARGET_MB` | `BRAVE_IMAGE_DISCORD_LIMIT_MB`の1つ下 (デフォルトでは`7`) |
| `CHANNEL_WHITELIST_CACHE_TTL_MINUTES` | `5` |
| `CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE` | `10` |
| `CONDITIONING_REASON_MAX_LENGTH` | `250` |
| `COOLDOWN_CONDITIONING` | `3000`、`COMMAND_COOLDOWN_SCALE`でスケーリング |
| `COOLDOWN_CONFIG` | `3000`、`COMMAND_COOLDOWN_SCALE`でスケーリング |
| `COOLDOWN_FORGET` | `3000`、`COMMAND_COOLDOWN_SCALE`でスケーリング |
| `COOLDOWN_MEMORY` | `3000`、`COMMAND_COOLDOWN_SCALE`でスケーリング |
| `COOLDOWN_PERSONA` | `10000`、`COMMAND_COOLDOWN_SCALE`でスケーリング |
| `COOLDOWN_PERSONAL` | `3000`、`COMMAND_COOLDOWN_SCALE`でスケーリング |
| `COOLDOWN_SERVER` | `3000`、`COMMAND_COOLDOWN_SCALE`でスケーリング |
| `COOLDOWN_TEACH` | `3000`、`COMMAND_COOLDOWN_SCALE`でスケーリング |
| `DEEPSEEK_EXPRESSION_BATCH_SIZE` | `20` |
| `DEFAULT_COMMAND_COOLDOWN` | `1600`、`COMMAND_COOLDOWN_SCALE`でスケーリング |
| `DELIBERATE_TOOL_CONTEXT_TURNS` | `4`; サーバーは`/config`で引き続き変更できます (実験動作のツールコンテキスト)。|
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
| `NAI_CFG_RESCALE` | `0.0`; サーバーは`/config` (NovelAI画像設定) で変更できます。|
| `NAI_CHAR_REF_DESCRIPTION` | `character&style` |
| `NAI_CHAR_REF_INFO_EXTRACTED` | `1.0` |
| `NAI_CHAR_REF_SECONDARY_STRENGTH` | `0.0` |
| `NAI_CHAR_REF_STRENGTH` | `0.6` |
| `NAI_GLM_CHARS_PER_TOKEN` | `2.5` |
| `NAI_GLM_CONTEXT_LIMIT` | `12288` |
| `NAI_IMAGE_NEGATIVE_PROMPT` | 組み込みテキスト |
| `NAI_IMAGE_NOISE_SCHEDULE` | `karras`; サーバーは`/config` (NovelAI画像設定) で変更できます。|
| `NAI_IMAGE_SAMPLER` | `k_euler_ancestral`; サーバーは`/config` (NovelAI画像設定) で変更できます。|
| `NAI_IMAGE_SCALE` | `5`; サーバーは`/config` (NovelAI画像設定) で変更できます。|
| `NAI_IMAGE_STEPS` | `23`; サーバーは`/config` (NovelAI画像設定) で変更できます。|
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
| `SHORT_TERM_MEMORY_DEFAULT_CRUDE_MESSAGE_COUNT` | `6`; サーバーは`/config` (短期メモリ設定) で変更できます。|
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
| `STATS_DASHBOARD_TIMEOUT_MS` | なし（一度も読まれていない） |
| `STAT_FLUSH_INTERVAL_MS` | `5000` |
| `STAT_FLUSH_MAX_BUFFER` | `1000` |
| `STM_FRESH_INJECTION_DEPTH` | `2` |
| `STM_FRESH_WINDOW_MINUTES` | `60` |
| `STM_MAX_CATEGORIES` | `5` |
| `STREAM_ABANDONED_SETTLE_TIMEOUT_MS` | `5000` |
| `ST_PRESET_CACHE_TTL_MINUTES` | `10` |
| `SYSPROMPT_SHOW_MAX_PREVIEW` | `3800` |
| `TASK_EXPAND_BUTTON_TIMEOUT_MS` | `86400000` |
| `TENOR_FETCH_TIMEOUT_MS` | なし（一度も読まれていない） |
| `TEST_POSTGRES_DB` | なし（一度も読まれていない） |
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

### 削除されたTTSローカルサーバーの変数

`servers/tts/`下のTTSローカルサーバーは、共有ポートフォールバック、エンジンごとの制限、または認証設定を使用しなくなりました。`.env`またはシェルの古い設定は無視されます。

- **ポート:** 単一の共有変数が起動されたすべてのサーバーを同じポートにバインドしているため、`TOMORI_TTS_PORT`は削除されています。各エンジンは専用の変数を使用するようになりました: `CHATTERBOX_PORT` (8011)、`QWEN3TTS_PORT` (8012、または音声設計モードの8014)、`IRODORI_TTS_PORT` (8013)、`FISH_S2_PORT` (8015)、`VOXCPM2_PORT` (8016)、`COSYVOICE3_PORT` (8017)、および`MOSS_TTS_PORT` (8018)。
- **認証:** ローカルサーバーはベアラー トークンを検証したり、リモートネットワークバインディングを制限したりしなくなりました。以前に`FISH_S2_API_KEY`、`VOXCPM2_API_KEY`、`TOMORI_TTS_API_KEY`、または`COSYVOICE3_BEARER_TOKEN`を設定した場合、エンドポイントは資格情報なしでリクエストを受け入れるようになります。ループバックをバインドする前に、[ネットワークアクセス](/ja/self-hosting/local-endpoints/text-to-speech/#network-access) を確認してください。
- **インストーラー ピン:** Fish SpeechおよびCosyVoiceのコミットハッシュとモデルリビジョンは、インストーラー スクリプトにピン付けされます。これらを更新するには、各スクリプトで固定された値を編集する必要があります。

<details>
<summary>すべての削除されたTTSローカルサーバー変数</summary>

| 変数 | 今 |
|---|---|
| `COSYVOICE3_ALLOW_REMOTE_BIND` | 削除されました。あらゆる`TOMORI_TTS_HOST`が受け入れられます |
| `COSYVOICE3_BEARER_TOKEN` | 削除されました。認証なし |
| `COSYVOICE3_MAX_REF_AUDIO_BYTES` | `26214400` |
| `COSYVOICE3_MAX_REF_AUDIO_SECONDS` | `30` |
| `COSYVOICE3_MODEL_ID` | `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` |
| `COSYVOICE3_MODEL_REVISION` | インストーラーに固定されている |
| `COSYVOICE3_RUNTIME_COMMIT` | インストーラーに固定されている |
| `COSYVOICE3_RUNTIME_DIR` | `servers/tts/cosyvoice3/CosyVoice` |
| `COSYVOICE3_RUNTIME_REPO` | `https://github.com/QwenAudio/CosyVoice.git` |
| `COSYVOICE3_UPDATE` | 削除されました。再実行するとインストーラのピンがチェックアウトされます |
| `FISH_S2_ALLOW_INSECURE_REMOTE` | 削除されました。あらゆる`TOMORI_TTS_HOST`が受け入れられます |
| `FISH_S2_API_KEY` | 削除されました。認証なし |
| `FISH_S2_LAUNCH_TIMEOUT_MS` | `TOMORI_TTS_STARTUP_TIMEOUT_MS`が適用されます (`300000`) |
| `FISH_S2_MAX_REF_AUDIO_BYTES` | `10485760` |
| `FISH_S2_RUNTIME_REF` | インストーラーに固定されている |
| `FISH_S2_RUNTIME_REPOSITORY` | `https://github.com/Imagilux/fish-speech.git` |
| `FISH_S2_STARTUP_TIMEOUT_SECONDS` | `180` |
| `FISH_S2_SYNTHESIS_TIMEOUT_SECONDS` | `1800` |
| `FISH_S2_UPDATE` | 削除されました。再実行すると、インストーラーのピンがチェックアウトされ、モデルが更新されます。|
| `FISH_S2_UPDATE_MODEL_REVISION` | `FISH_S2_MODEL_REVISION`を使用してください |
| `FISH_S2_UPDATE_REF` | インストーラーに固定されている |
| `FISH_S2_UPSTREAM_HOST` | `127.0.0.1` |
| `FISH_SPEECH_DIR` | `servers/tts/fishs2/fish-speech` |
| `MOSS_TTS_MAX_REF_AUDIO_BYTES` | `10485760` |
| `TOMORI_TTS_ALLOW_REMOTE_BIND` | 削除されました。あらゆる`TOMORI_TTS_HOST`が受け入れられます |
| `TOMORI_TTS_API_KEY` | 削除されました。認証なし |
| `TOMORI_TTS_MAX_REF_AUDIO_BYTES` | `10485760` (魚) |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000` (Irodori-TTSの場合は`1000`) |
| `TOMORI_TTS_PORT` | エンジン自身のポート変数 |
| `TTS_CLONE_TIMEOUT_MS` | `TTS_SYNTHESIZE_TIMEOUT_MS`を使用してください |
| `VOXCPM2_API_KEY` | 削除されました。認証なし |
| `VOXCPM2_MAX_REF_AUDIO_BYTES` | `10485760` |

</details>

## バックアップと復元

`bun run backup`は、PostgreSQLデータベース全体を含むタイムスタンプ付きのバンドルを`backups/`（または`.env`で上書きされている場合は`TOMORI_BACKUP_DIR`）に作成します。これには`.env`は含まれないため、暗号化キーは保護された別のストレージに保管してください（[データベースのバックアップとリカバリキー](#database-backups-and-recovery-keys)を参照）。次のコマンドを使用して最新のバンドルを復元します：

```sh
bun run restore-backup --latest
```

または、特定のバンドルを復元します。

```sh
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

`bun run backup:personas`は、より狭いエクスポートです。すべてのサーバーにわたる、ペルソナプリセットとペルソナごとのサーバー メモリのみです。これは、`/persona import`を介して手動で再インポートする必要があり、`restore-backup`では使用できません (主キーの競合が発生する可能性があります)。

TomoriBotは、非運用環境でも自動起動バックアップを取得します。完全復元には、ターゲットデータベースに`pgvector`拡張子が存在する必要があります。どちらも [安全な移行](/ja/self-hosting/safe-migration/) で詳しく説明されており、ツールを直接操作したい場合は、手動の`pg_dump`および`pg_restore`手順も説明されています。

## Docker Composeのバックアップ

Docker Composeは、アプリコンテナ内での自動スタートアップバックアップをサポートしています。
Composeがホストの`backups/`ディレクトリをコンテナにマウントしているため、バンドルはそこに書き込まれます。

手動でのDockerバックアップを行うには、以下を実行します。

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

Dockerの復元を行うには、以下を実行します。

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

ホスト側のスクリプトはDocker経由では自動的に実行されません。
Composeのデータベースに対してホストスクリプトを実行するには、以下の接続値をホストに設定します。バックアップと復元にはPostgreSQLクライアントツールも必要です。`nuke-db`にはBunのみが必要です。

```dotenv
POSTGRES_HOST=localhost
POSTGRES_PORT=15432
POSTGRES_USER=tomori
POSTGRES_PASSWORD=your_password
POSTGRES_DB=tomodb
```

## クリーンインストール

`bun run nuke-db`はすべてのテーブルを削除します。
その後ボットを起動すると、スキーマ、シード、および移行が最初から再初期化されます。
ロールバック可能なまっさらな状態にしたい場合に、新しい`bun run backup`と組み合わせて使用してください。
現在のバックアップなしで実行することは絶対に避けてください。

## 関連項目

- [安全な移行](/ja/self-hosting/safe-migration/)：プル前のバックアップ、および`pgvector`復元の前提条件
- [データの取り扱い](/ja/features/knowledge/data-handling/)：Discord内でのユーザーごとのエクスポート/インポート/削除
- [セットアップウィザード](/ja/self-hosting/setup-wizard/)：ガイド付きの`bun run setup`インストール
