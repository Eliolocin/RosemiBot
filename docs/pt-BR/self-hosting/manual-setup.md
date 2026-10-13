---
title: "Configuração Manual"
sidebar:
  order: 2
aiGenerated: false
---

:::note
Usuários que desejam usar o Docker Compose devem pular este assistente, veja
[Docker Compose](/pt-BR/self-hosting/docker-compose/) para o caminho de instalação em contêiner.
:::

Este é o procedimento de instalação manual para usuários técnicos que preferem não usar o assistente guiado. Se você deseja um caminho mais passo a passo, use o [assistente de configuração](/pt-BR/self-hosting/setup-wizard/), pois ele cria o `.env`, gera um `CRYPTO_SECRET` seguro, configura o PostgreSQL e executa a instalação para você.

## Pré-requisitos

- [Bun](https://bun.sh/)
- PostgreSQL instalado nativamente ou executado em um contêiner Docker (veja o passo 2)

O esquema do PostgreSQL, `pgcrypto`, sementes e migrações são inicializados automaticamente na inicialização do bot.

## 1. Instalar

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
bun install --frozen-lockfile
```

## 2. Configurar

Crie seu arquivo de ambiente a partir do exemplo e preencha os valores necessários:

```sh
cp .env.example .env
```

Obrigatória:

- `DISCORD_TOKEN`: seu token de bot Discord (habilite as intenções privilegiadas `GuildMembers`, `MessageContent` e `GuildPresences`).
- `CRYPTO_SECRET`: uma chave de criptografia de 32 caracteres (usada para criptografar chaves API armazenadas).
- Conexão PostgreSQL: `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.

Mantenha uma cópia protegida do seu segredo de criptografia separada dos backups do banco de dados. Novos backups não contêm `.env`. Para rotação, use `CRYPTO_SECRET_V1`, `CRYPTO_SECRET_V2` ou qualquer versão posterior com número inteiro positivo, com a seleção opcional de `CRYPTO_SECRET_CURRENT`. `CRYPTO_SECRET` permanece V1. Os comandos de inicialização e manutenção carregam a mesma fonte: valores de ambiente locais em desenvolvimento, ou JSON montado / AWS Secrets Manager em produção. Consulte [Rotacionando chaves de criptografia](/pt-BR/self-hosting/maintenance/#rotating-encryption-keys) antes de substituir um segredo.

Em fontes de segredos JSON, as chaves mestras devem ser strings. `CRYPTO_SECRET_CURRENT` aceita uma string como `"2"` ou um número inteiro positivo seguro como `2` que indica uma versão disponível.

:::note[No native PostgreSQL?]
Execute apenas o banco de dados em um contêiner e aponte os valores `POSTGRES_*` para ele:

```sh
docker run -d --name tomori-db \
  -e POSTGRES_USER=tomori -e POSTGRES_PASSWORD=yourpassword -e POSTGRES_DB=tomori \
  -p 5432:5432 pgvector/pgvector:pg16
```

Em seguida, defina `POSTGRES_HOST=localhost`, `POSTGRES_PORT=5432` e o usuário/senha/db acima. A imagem `pgvector/pgvector` vem com a extensão RAG pré-instalada; troque-o por `postgres:16` se você não precisar de memória de documento/RAG. Isso executa apenas o banco de dados em Docker e o bot ainda é executado no host Bun. Para um bot e banco de dados totalmente conteinerizados, use [Docker Compose](/pt-BR/self-hosting/docker-compose/).
:::

O ajuste opcional reside em `.env.optional.example`. Copie quaisquer valores que você deseja personalizar (limites, tempos limite, alternância de recursos, URLs do servidor local, etc.).

A expressão personalizada carrega o padrão para arquivos locais em `data/custom-expressions/`. Mantenha esse diretório em armazenamento persistente. `EXPRESSION_STORAGE_BACKEND` aceita `local`, `gcs` ou `s3`. Os back-ends em nuvem exigem `EXPRESSION_STORAGE_BUCKET` e as credenciais SDK correspondentes. S3 também usa `AWS_REGION` (padrão `us-east-1`) e `S3_ENDPOINT` opcional. GCS usa credenciais padrão do aplicativo. As expressões usam sua própria configuração de intervalo; as configurações de armazenamento de avatar não selecionam um intervalo de expressão. Os objetos permanecem legíveis por meio do SDK e são anexados como bytes, portanto, um URL de mídia veiculado publicamente é desnecessário. Preserve chaves de back-end, bucket e objeto ao restaurar referências existentes.

`MAX_CUSTOM_EXPRESSIONS_PER_SERVER` limita as expressões personalizadas por servidor (padrão `20`, mínimo `1`). Links e arquivos enviados compartilham o limite entre todas as personas; emojis e figurinhas nativos estão excluídos. Reinicie o bot após alterá-lo. Diminuir o limite preserva as expressões existentes e permite edições e exclusões, mas bloqueia adições até que a contagem fique abaixo do limite.

## 3. Executar

```sh
bun run dev
```

Quando você ver `TomoriBot up and running!`, vá para o Discord e execute `/setup` no seu
servidor para conectar um provedor de IA e inicializar o bot. O comando abre um painel de lista de verificação
guiado, e nada é escrito até que você pressione `Concluir Configuração`; veja
[O comando `/setup`](/pt-BR/self-hosting/setup-wizard/#the-setup-command) para os passos e o
[Início Rápido](/pt-BR/introduction/quickstart/) para a parte dentro do Discord.

Use `bun run launch` em vez de `bun run dev` se você quiser que servidores locais opcionais (SearXNG, Crawl4AI, TTS/STT local) sejam iniciados junto com o bot:

```sh
bun run launch --searxng --crawl4ai
bun run launch --help        # see all flags
```

## Extras opcionais (a "Instalação Completa" manual)
<!-- anchor: optional-extras-the-manual-full-install -->

O caminho de Instalação Completa do [assistente de configuração](/pt-BR/self-hosting/setup-wizard/) sobrepõe quatro extras leves
em cima da instalação base. Nenhum deles é necessário para executar o bot, mas cada um desbloqueia um recurso. Se
você estiver instalando manualmente, adicione o que quiser:

### `pgvector` : memória de documentos/RAG

RAG (upload de documentos e recall entre canais) armazena embeddings em uma coluna `vector`, o que
precisa da extensão [pgvector](https://github.com/pgvector/pgvector). Instale-a para a sua
versão principal do PostgreSQL:

```sh
# Debian/Ubuntu, e.g. for PostgreSQL 16
sudo apt-get install -y postgresql-16-pgvector
```

Em seguida, habilite-a uma vez no seu banco de dados. Conecte-se com `psql` usando os valores `POSTGRES_*` do
seu `.env`: ele solicitará o `POSTGRES_PASSWORD`:

:::note[Windows]
Não há um pacote pré-construído do pgvector para o PostgreSQL nativo do Windows. Instalado significa
compilar a partir do código-fonte para a sua versão exata do PostgreSQL com o Visual Studio C++ e `nmake`
(veja as [instruções para Windows](https://github.com/pgvector/pgvector#windows) do pgvector). O
caminho mais simples no Windows é executar o banco de dados no contêiner `pgvector/pgvector` mostrado em
[Configurar](#2-configurar) acima, que já traz a extensão pré-instalada.
:::

```sh
# Native / host psql (substitute your own POSTGRES_USER and POSTGRES_DB):
psql -h localhost -p 5432 -U tomori -d tomodb

# Or, if the database runs in the Docker container from step 2:
docker exec -it tomori-db psql -U tomori -d tomori
```

Uma vez conectado, execute:

```sql
CREATE EXTENSION vector;
```

Sem o pgvector, o bot ainda funciona, mas os recursos de RAG ficam completamente indisponíveis. Esta extensão também é
necessária no banco de dados de destino antes de restaurar um backup; veja
[Migração Segura](/pt-BR/self-hosting/safe-migration/) para detalhes.

### `pg_cron` : tarefas de limpeza programadas

O `pg_cron` possibilita a manutenção periódica opcional do banco de dados (limpeza de linhas de lembrete/tempo de recarga).
O Docker Compose deste repositório já o configura.

:::caution[Não é necessário para lembretes ou gatilhos]
O `pg_cron` é puramente para limpeza, pois limpa apenas linhas obsoletas. A entrega de lembretes e
os gatilhos aleatórios são executados no próprio aplicativo, portanto, esses recursos funcionam com ou sem o `pg_cron`.
:::

Para um PostgreSQL gerenciado por você mesmo, encontre seu arquivo de configuração ativo:

```sql
SHOW config_file;
```

Habilite a extensão no `postgresql.conf`: anexe a `shared_preload_libraries` se já
listar outras bibliotecas:

```ini
shared_preload_libraries = 'pg_cron'   # e.g. 'pg_stat_statements,pg_cron'
cron.database_name = 'your_dbname'
```

Reinicie o PostgreSQL, depois:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

### Ativos do tokenizador : logit bias compatível com o modelo

Logit bias (penalidades de repetição de emoji/palavra) precisa de ativos de tokenizador locais:

```sh
bun run setup:tokenizers
```

Algumas famílias (ex. Gemma) são restritas e requerem um
[token do HuggingFace](https://huggingface.co/settings/tokens) após você aceitar sua licença:

```sh
# Windows (PowerShell)
$env:HF_TOKEN="hf_xxx"; bun run setup:tokenizers

# macOS/Linux
HF_TOKEN=hf_xxx bun run setup:tokenizers
```

Sem esta etapa, o logit bias é silenciosamente desativado e tudo mais funciona normalmente.

O fallback seguro do `fetch_url` e o fallback do `web_search` do DuckDuckGo são executados dentro do processo, portanto, nenhum deles precisa de instalação extra.

## Manutenção, atualização e backups

Depois de instalado, os scripts do lado do host (`bun run update`, `bun run backup`,
`bun run restore-backup`, `bun run nuke-db`, `bun run rotate-keys`, ...) e os procedimentos de atualização e
backup estão todos na página de [Manutenção e Backups](/pt-BR/self-hosting/maintenance/). Se você está prestes a
obter uma nova versão, comece com a [Migração Segura](/pt-BR/self-hosting/safe-migration/).
