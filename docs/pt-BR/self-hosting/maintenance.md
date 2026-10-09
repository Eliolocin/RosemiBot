---
title: "Manutenção & Backups"
sidebar:
  order: 5
---

Gerencie sua instância TomoriBot auto-hospedada usando scripts de manutenção CLI para atualizar código, fazer backup ou restaurar dados, alternar chaves de criptografia e inspecionar variáveis de ambiente. Execute esses comandos em seu terminal host ou ambiente Docker. Para exportações e exclusões de dados em Discord, consulte [Manipulação de dados](/pt-BR/features/knowledge/data-handling/).

Se você estiver atualizando com `git pull`, revise [Migração Segura](/pt-BR/self-hosting/safe-migration/) primeiro para criar um backup antes que o executor de migração na inicialização aplique alterações de esquema.

## Scripts de manutenção

| Comando | Descrição |
|---|---|
| `bun run setup` | Abre o assistente de configuração para a instalação base e módulos opcionais. |
| `bun run update` | Faz backup primeiro, em seguida puxa o código mais recente e instala as dependências. |
| `bun run backup` | Cria um pacote em `backups/` com o dump do seu banco de dados e os metadatos de versão de criptografia necessários. Os segredos ficam separados. |
| `bun run restore-backup` | Restaura o banco de dados usando chaves de criptografia provisionadas separadamente (`--latest` ou `--from backups/<dir>`). |
| `bun run backup:personas` | Exporta APENAS personas (com memórias do servidor) em todos os servidores; reimporte via `/persona import`. |
| `bun run nuke-db` | Remove todas as tabelas (inicie o bot depois para reinicializar). |
| `bun run purge-commands` | Limpa todos os comandos de barra registrados do Discord. |
| `bun run rotate-keys --bot-stopped` | Recriptografa todos os campos criptografados para a versão atual da chave. |
| `bun run env-doctor` | Verificação somente leitura da sua configuração: lista as entradas do `.env` que nada lê (apenas nomes, nunca valores) e onde cada variável é usada. |

No host, `bun run backup` precisa de `pg_dump`, e `bun run restore-backup` precisa de `psql` no PATH. `bun run update` precisa de `pg_dump` para fazer o backup. O caminho de atualização com `--docker` executa o backup no contêiner, portanto precisa de Bun, Git e Docker no host, mas dispensa ferramentas do PostgreSQL no host.

Os comandos de backup e restauração passam a senha do seu banco de dados para o `pg_dump` e `psql` por meio de um arquivo de senha temporário na pasta temporária do sistema, para que outros usuários na máquina não possam lê-la na lista de processos. Essa pasta deve permitir gravação. O arquivo é excluído quando o comando termina.

## Backups de banco de dados e chaves de recuperação
<!-- anchor: database-backups-and-recovery-keys -->

`bun run backup` e backups automáticos de inicialização produzem `database.sql` e `bundle_info.json`. O manifesto identifica um pacote contendo apenas o banco de dados e lista as versões de criptografia encontradas nesse dump. O inventário de versões descreve quais chaves a recuperação precisa; a restauração verifica a capacidade real de descriptografia. Criar um dump não exige que chaves antigas estejam presentes, portanto uma chave histórica ausente não impede a preservação do restante do banco de dados. Ele nunca copia o `.env`. Um dump contendo apenas o banco de dados ainda contém conversas e memórias privadas, portanto restrinja o acesso ao diretório de backup.

Mantenha as versões de criptografia em um armazenamento protegido separado, como um gerenciador de senhas criptografado ou gerenciador de segredos. Se você mesmo copiar o `.env`, proteja-o como credenciais e mantenha-o separado do dump. A perda de uma versão de criptografia necessária torna essas credenciais armazenadas irrecuperáveis; os usuários deverão inserir suas chaves de API novamente. As chaves do lado do provedor permanecem válidas até serem revogadas.

Para restaurar:

1. Pare todas as instâncias do bot. Provisione as configurações do banco de dados de destino, o token do Discord e as versões de criptografia correspondentes na fonte de segredos normal antes de executar o comando. Preserve as chaves originais com exatidão.
2. Instale o `psql` e as extensões usadas pelo dump, incluindo `pgvector` quando presente. Execute `bun run restore-backup --from backups/<bundle-directory>` ou use `--latest`. A restauração habilita o `pgcrypto` antes de verificar as chaves, inclusive em um destino novo. A conta do banco de dados deve ter permissão para criar essa extensão, ou um administrador de banco de dados deve habilitá-la primeiro. Erros de configuração de extensão são relatados separadamente de falhas na recuperação de credenciais.
3. A restauração verifica cada credencial criptografada com as chaves fornecidas antes de carregar o dump. Chaves ausentes ou incorretas interrompem a operação antes de qualquer SQL destrutivo; o `pgcrypto` já pode ter sido habilitado. Revise o destino e confirme `RESTORE`; um destino não vazio também requer `RESTORE ANYWAY`. Restaure apenas dumps SQL confiáveis.
4. Mantenha as chaves no lugar. Antes de reiniciar, execute `bun run audit-keys` e `bun run rotate-keys --dry-run`. Se as credenciais precisarem de migração para a versão ativa, execute `bun run rotate-keys --bot-stopped` e audite novamente antes de iniciar qualquer instância. `ON_ERROR_STOP=1` para no primeiro erro de SQL, mas instruções anteriores já podem ter alterado dados. Corrija o erro e tente novamente enquanto o bot permanece parado.

Pacotes legados incluem segredos brutos em `config.env`. A restauração os identifica e emite um aviso, mas nunca copia nem carrega esse arquivo. Revise-o com cuidado em um local privado e provisione você mesmo suas versões de criptografia na fonte de segredos de destino. Mantenha as configurações do banco de dados de destino no lugar. Pacotes existentes continuam contendo segredos mesmo após a atualização. Depois que as chaves de criptografia estiverem arquivadas em um armazenamento protegido, você poderá excluir o `config.env` de um pacote legado; a restauração ainda aceitará o pacote e verificará as chaves descriptografando o dump.

## Rotacionando chaves de criptografia
<!-- anchor: rotating-encryption-keys -->

1. Mantenha uma cópia protegida de cada chave necessária para os dados ativos e backups retidos. Faça um backup do banco de dados e teste a recuperação em um banco de dados descartável antes de desativar qualquer versão.
2. Gere a nova chave com `openssl rand -base64 32` (ou `docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"`) e adicione-a como `CRYPTO_SECRET_V<version>` à mesma fonte de segredos que o bot usa. A rotação recusa uma chave atual com menos de 32 caracteres. Defina `CRYPTO_SECRET_CURRENT` para essa versão se desejar seleção explícita. Conserve todas as chaves mais antigas. O `CRYPTO_SECRET` legado é V1.
3. Pare todas as instâncias do bot e pause os processos que gravam credenciais. Em produção, execute os scripts com `RUN_ENV=production` e o mesmo `SECRET_FILE` montado, o `GCP_SECRET_FILE` legado ou as configurações de segredo e acesso da AWS usados na inicialização. A auditoria e a rotação usam as configurações `POSTGRES_*` do bot dessa fonte.
4. Execute `bun run audit-keys` e, em seguida, `bun run rotate-keys --dry-run`. Ambos devem ter sucesso. A auditoria relata tabelas, colunas, IDs de linha e versões com falha enquanto continua as verificações de credenciais. Suas contagens de versão incluem recuperações que falharam e não podem atestar sucesso quando o status de saída for diferente de zero. O dry-run descriptografa as credenciais sem alterar as linhas.
5. Execute `bun run rotate-keys --bot-stopped` e, em seguida, `bun run audit-keys`. Qualquer consulta ou linha com falha gera uma saída diferente de zero, incluindo em caso de sucesso parcial. Mantenha todas as versões, corrija a falha e execute novamente. A substituição simultânea de linhas é recusada em vez de sobrescrita.
6. Em um banco de dados restaurado descartável, teste uma auditoria configurando apenas a chave atual retida. Backups mais antigos retidos precisam de sua própria recuperação testada com chaves arquivadas. Somente após essas verificações você poderá remover versões antigas da fonte de segredos ativa. Mantenha o arquivo de chaves protegido separadamente enquanto seus backups forem retidos e, em seguida, reinicie todas as instâncias do bot.

A flag `--bot-stopped` registra sua confirmação; ela não pode detectar outras instâncias em execução. Os scripts de rotação não limpam os caches de credenciais de outro processo. As versões não precisam ser consecutivas: uma credencial V1 pode migrar diretamente para V4 quando ambas as chaves estiverem disponíveis.

A rotação também substitui marcas de versão nula legadas pela versão atual explícita, inclusive quando a versão atual for V1.

## Atualizando

Pare o bot em execução primeiro e depois use o atualizador de backup primeiro:

```sh
bun run update
```

Isso executa `bun run backup`, depois `git pull --rebase --autostash` e, finalmente, `bun install --frozen-lockfile`. O pacote de backup é salvo em `backups/` e contém o dump do banco de dados e o manifesto. Copie e proteja o `.env` separadamente se precisar retê-lo. Adicione `--skip-backup` para ignorar o backup pré-atualização.

Substituição manual:

```sh
bun run backup
git pull --rebase --autostash
bun install --frozen-lockfile
```

Se você executar código pré-compilado de `dist/`, use `bun run update --build`. Para implantações Docker Compose, use `bun run update --docker`; o atualizador primeiro executa `docker compose run --rm tomoribot bun run backup`.

### Variáveis de ambiente removidas

Essas variáveis configuraram anteriormente heurísticas de texto internas, tempos limite do componente Discord, durações de cache, resfriamento de comandos e padrões de amostragem. Eles agora estão corrigidos no código com seus padrões anteriores, portanto, os valores antigos em `.env` são ignorados após a atualização. Execute `bun run env-doctor` para listar quaisquer variáveis restantes em seu `.env` que você possa excluir com segurança. As configurações que dependem do seu host, rede, credenciais ou custos permanecem variáveis de ambiente.

Os resfriamentos de comando agora usam um único multiplicador, `COMMAND_COOLDOWN_SCALE` (padrão `1`; `0` desativa os resfriamentos), substituindo as variáveis individuais `COOLDOWN_*` e `DEFAULT_COMMAND_COOLDOWN`. Para manter um tempo de espera personalizado, divida o valor antigo pelo padrão anterior: por exemplo, `COOLDOWN_PERSONA=1000` se torna `COMMAND_COOLDOWN_SCALE=0.1`.

<details>
<summary>Todas as 177 variáveis removidas e seus valores fixos</summary>

| Variável | Valor fixo |
|---|---|
| `ALLOW_PERSONAL_LOCAL_ENDPOINTS` | nenhum (nunca foi lido) |
| `BLOCK_USER_MAX_DURATION_HOURS` | `168` |
| `BOT_GENERATE_IMAGE_AGENT_MAX_ITERATIONS` | `5` |
| `BOT_GENERATE_IMAGE_HISTORY_LIMIT` | `24` |
| `BOT_GENERATE_SCENE_MAX_CYCLES` | `10` |
| `BOT_JSON_REPAIR_MAX_CHARS` | `1048576` |
| `BOT_MAX_CONSECUTIVE_TOOL_ERRORS` | `5` |
| `BOT_MAX_FUNCTION_CALL_ITERATIONS` | `100` |
| `BOT_MAX_STOP_STRINGS_PER_SERVER` | `40` |
| `BOT_MAX_STOP_STRING_LENGTH` | `200` |
| `BRAVE_IMAGE_COMPRESSION_TARGET_MB` | um abaixo de `BRAVE_IMAGE_DISCORD_LIMIT_MB` (`7` por padrão) |
| `CHANNEL_WHITELIST_CACHE_TTL_MINUTES` | `5` |
| `CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE` | `10` |
| `CONDITIONING_REASON_MAX_LENGTH` | `250` |
| `COOLDOWN_CONDITIONING` | `3000`, dimensionado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_CONFIG` | `3000`, dimensionado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_FORGET` | `3000`, dimensionado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_MEMORY` | `3000`, dimensionado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_PERSONA` | `10000`, dimensionado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_PERSONAL` | `3000`, dimensionado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_SERVER` | `3000`, dimensionado por `COMMAND_COOLDOWN_SCALE` |
| `COOLDOWN_TEACH` | `3000`, dimensionado por `COMMAND_COOLDOWN_SCALE` |
| `DEEPSEEK_EXPRESSION_BATCH_SIZE` | `20` |
| `DEFAULT_COMMAND_COOLDOWN` | `1600`, dimensionado por `COMMAND_COOLDOWN_SCALE` |
| `DELIBERATE_TOOL_CONTEXT_TURNS` | `4`; um servidor ainda pode alterá-lo em `/config` (contexto da ferramenta em comportamento experimental) |
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
| `NAI_CFG_RESCALE` | `0.0`; um servidor ainda pode alterá-lo em `/config` (configurações de imagem NovelAI) |
| `NAI_CHAR_REF_DESCRIPTION` | `character&style` |
| `NAI_CHAR_REF_INFO_EXTRACTED` | `1.0` |
| `NAI_CHAR_REF_SECONDARY_STRENGTH` | `0.0` |
| `NAI_CHAR_REF_STRENGTH` | `0.6` |
| `NAI_GLM_CHARS_PER_TOKEN` | `2.5` |
| `NAI_GLM_CONTEXT_LIMIT` | `12288` |
| `NAI_IMAGE_NEGATIVE_PROMPT` | texto embutido |
| `NAI_IMAGE_NOISE_SCHEDULE` | `karras`; um servidor ainda pode alterá-lo em `/config` (configurações de imagem NovelAI) |
| `NAI_IMAGE_SAMPLER` | `k_euler_ancestral`; um servidor ainda pode alterá-lo em `/config` (configurações de imagem NovelAI) |
| `NAI_IMAGE_SCALE` | `5`; um servidor ainda pode alterá-lo em `/config` (configurações de imagem NovelAI) |
| `NAI_IMAGE_STEPS` | `23`; um servidor ainda pode alterá-lo em `/config` (configurações de imagem NovelAI) |
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
| `SHORT_TERM_MEMORY_DEFAULT_CRUDE_MESSAGE_COUNT` | `6`; um servidor ainda pode alterá-lo em `/config` (configurações de memória de curto prazo) |
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
| `STATS_DASHBOARD_TIMEOUT_MS` | nenhum (nunca foi lido) |
| `STAT_FLUSH_INTERVAL_MS` | `5000` |
| `STAT_FLUSH_MAX_BUFFER` | `1000` |
| `STM_FRESH_INJECTION_DEPTH` | `2` |
| `STM_FRESH_WINDOW_MINUTES` | `60` |
| `STM_MAX_CATEGORIES` | `5` |
| `STREAM_ABANDONED_SETTLE_TIMEOUT_MS` | `5000` |
| `ST_PRESET_CACHE_TTL_MINUTES` | `10` |
| `SYSPROMPT_SHOW_MAX_PREVIEW` | `3800` |
| `TASK_EXPAND_BUTTON_TIMEOUT_MS` | `86400000` |
| `TENOR_FETCH_TIMEOUT_MS` | nenhum (nunca foi lido) |
| `TEST_POSTGRES_DB` | nenhum (nunca foi lido) |
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

### Variáveis removidas dos servidores locais de TTS

Os servidores locais TTS em `servers/tts/` não usam mais fallbacks de porta compartilhada, limites por mecanismo ou configurações de autenticação. Configurações antigas em `.env` ou em seu shell são ignoradas:

- **Portas:** `TOMORI_TTS_PORT` foi removido porque uma única variável compartilhada vinculava cada servidor iniciado à mesma porta. Cada mecanismo agora usa sua variável dedicada: `CHATTERBOX_PORT` (8011), `QWEN3TTS_PORT` (8012 ou 8014 no modo de design de voz), `IRODORI_TTS_PORT` (8013), `FISH_S2_PORT` (8015), `VOXCPM2_PORT` (8016), `COSYVOICE3_PORT` (8017) e `MOSS_TTS_PORT` (8018).
- **Autenticação:** Os servidores locais não validam mais tokens de portador nem restringem a ligação de rede remota. Se você configurou anteriormente `FISH_S2_API_KEY`, `VOXCPM2_API_KEY`, `TOMORI_TTS_API_KEY` ou `COSYVOICE3_BEARER_TOKEN`, os terminais agora aceitam solicitações sem credenciais. Revise o [Acesso à rede](/pt-BR/self-hosting/local-endpoints/text-to-speech/#network-access) antes de desativar o loopback.
- **Pinos do instalador:** Hashes de commit e revisões de modelo para Fish Speech e CosyVoice são fixados nos scripts do instalador. Atualizá-los requer a edição dos valores fixados em cada script.

<details>
<summary>Todas as variáveis do servidor local TTS removidas</summary>

| Variável | Agora |
|---|---|
| `COSYVOICE3_ALLOW_REMOTE_BIND` | removido; qualquer `TOMORI_TTS_HOST` é aceito |
| `COSYVOICE3_BEARER_TOKEN` | removido; sem autenticação |
| `COSYVOICE3_MAX_REF_AUDIO_BYTES` | `26214400` |
| `COSYVOICE3_MAX_REF_AUDIO_SECONDS` | `30` |
| `COSYVOICE3_MODEL_ID` | `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` |
| `COSYVOICE3_MODEL_REVISION` | fixado no instalador |
| `COSYVOICE3_RUNTIME_COMMIT` | fixado no instalador |
| `COSYVOICE3_RUNTIME_DIR` | `servers/tts/cosyvoice3/CosyVoice` |
| `COSYVOICE3_RUNTIME_REPO` | `https://github.com/QwenAudio/CosyVoice.git` |
| `COSYVOICE3_UPDATE` | removido; uma nova execução verifica os pinos do instalador |
| `FISH_S2_ALLOW_INSECURE_REMOTE` | removido; qualquer `TOMORI_TTS_HOST` é aceito |
| `FISH_S2_API_KEY` | removido; sem autenticação |
| `FISH_S2_LAUNCH_TIMEOUT_MS` | `TOMORI_TTS_STARTUP_TIMEOUT_MS` se aplica (`300000`) |
| `FISH_S2_MAX_REF_AUDIO_BYTES` | `10485760` |
| `FISH_S2_RUNTIME_REF` | fixado no instalador |
| `FISH_S2_RUNTIME_REPOSITORY` | `https://github.com/Imagilux/fish-speech.git` |
| `FISH_S2_STARTUP_TIMEOUT_SECONDS` | `180` |
| `FISH_S2_SYNTHESIS_TIMEOUT_SECONDS` | `1800` |
| `FISH_S2_UPDATE` | removido; uma nova execução verifica o pin do instalador e atualiza o modelo |
| `FISH_S2_UPDATE_MODEL_REVISION` | usar `FISH_S2_MODEL_REVISION` |
| `FISH_S2_UPDATE_REF` | fixado no instalador |
| `FISH_S2_UPSTREAM_HOST` | `127.0.0.1` |
| `FISH_SPEECH_DIR` | `servers/tts/fishs2/fish-speech` |
| `MOSS_TTS_MAX_REF_AUDIO_BYTES` | `10485760` |
| `TOMORI_TTS_ALLOW_REMOTE_BIND` | removido; qualquer `TOMORI_TTS_HOST` é aceito |
| `TOMORI_TTS_API_KEY` | removido; sem autenticação |
| `TOMORI_TTS_MAX_REF_AUDIO_BYTES` | `10485760` (Peixe) |
| `TOMORI_TTS_MAX_TEXT_CHARS` | `2000` (`1000` para Irodori-TTS) |
| `TOMORI_TTS_PORT` | a própria variável de porta do mecanismo |
| `TTS_CLONE_TIMEOUT_MS` | usar `TTS_SYNTHESIZE_TIMEOUT_MS` |
| `VOXCPM2_API_KEY` | removido; sem autenticação |
| `VOXCPM2_MAX_REF_AUDIO_BYTES` | `10485760` |

</details>

## Backups e restauração

`bun run backup` cria um pacote com carimbo de data e hora em `backups/` (ou seu `TOMORI_BACKUP_DIR` se substituído em `.env`) contendo todo o seu banco de dados PostgreSQL. Ele não inclui o `.env`, portanto, mantenha suas chaves de criptografia em um armazenamento protegido separado (consulte [Backups de banco de dados e chaves de recuperação](#database-backups-and-recovery-keys)). Restaure o pacote mais recente com:

```sh
bun run restore-backup --latest
```

Ou restaure um pacote específico:

```sh
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

`bun run backup:personas` é uma exportação mais restrita: apenas predefinições de persona e memórias de servidor por persona, em todos os servidores. Deve ser reimportado manualmente via `/persona import` e não pode ser usado com `restore-backup` (isso causaria conflitos de chave primária).

TomoriBot também faz backups de inicialização automáticos em ambientes que não sejam de produção, e uma restauração completa requer que a extensão `pgvector` esteja presente no banco de dados de destino. Ambos são abordados detalhadamente em [Migração segura](/pt-BR/self-hosting/safe-migration/), juntamente com um procedimento manual `pg_dump` e `pg_restore` se você preferir conduzir o ferramental diretamente.

## Backups com Docker Compose

O Docker Compose suporta backups automáticos na inicialização dentro do contêiner do aplicativo. Os pacotes são gravados no diretório `backups/` do host porque o Compose o monta dentro do contêiner.

Para um backup manual no Docker:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run backup
docker compose start tomoribot
```

Para uma restauração no Docker:

```sh
docker compose stop tomoribot
docker compose run --rm tomoribot bun run restore-backup --latest
docker compose up -d
```

Os scripts do host não são executados automaticamente pelo Docker. Para usá-los com o banco do
Compose, defina os valores de conexão abaixo no host. Backup e restauração também precisam das
ferramentas de cliente do PostgreSQL; `nuke-db` precisa apenas do Bun.

```dotenv
POSTGRES_HOST=localhost
POSTGRES_PORT=15432
POSTGRES_USER=tomori
POSTGRES_PASSWORD=your_password
POSTGRES_DB=tomodb
```

## Reinstalação limpa

`bun run nuke-db` remove todas as tabelas; iniciar o bot depois reinicializa o esquema, os dados iniciais e as migrações do zero. Use-o junto com um `bun run backup` recente quando você quiser começar com a lousa limpa, mas ainda puder reverter: nunca o execute sem um backup atual.

## Veja também

- [Migração Segura](/pt-BR/self-hosting/safe-migration/): fazendo backup antes de puxar as atualizações, e o pré-requisito de restauração do `pgvector`
- [Manuseio de Dados](/pt-BR/features/knowledge/data-handling/): fluxos de exportar/importar/excluir por usuário dentro do Discord
- [Assistente de Configuração](/pt-BR/self-hosting/setup-wizard/): a instalação guiada por `bun run setup`
