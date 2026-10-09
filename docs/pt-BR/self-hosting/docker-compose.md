---
title: "Docker Compose"
sidebar:
  order: 3
---

Docker Compose executa TomoriBot e PostgreSQL juntos em contêineres. É a terceira opção de instalação junto com o [assistente de configuração](/pt-BR/self-hosting/setup-wizard/) e [configuração manual](/pt-BR/self-hosting/manual-setup/): escolha-a quando quiser executar tudo no Docker sem instalar Bun ou PostgreSQL em seu sistema host. Ele ignora o assistente de configuração interativo e configura a conexão com o banco de dados automaticamente.

:::caution[Host tools for updates]
`bun run update --docker` precisa do host Bun e Git para obter alterações de código. Seu backup de banco de dados é executado dentro do contêiner do aplicativo. Você também pode executar backups e restaurações manuais por meio do Compose; consulte [Manutenção e backups](/pt-BR/self-hosting/maintenance/).
:::

## 1. Obtenha o código

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## 2. Valores `.env` obrigatórios

Comece pelo arquivo de exemplo:

```sh
cp .env.example .env
```

Defina estas variáveis obrigatórias em `.env`:

| Variável | Valor |
|---|---|
| `DISCORD_TOKEN` | Seu token de bot Discord (habilite as intenções privilegiadas `GuildMembers`, `MessageContent` e `GuildPresences`). |
| `CRYPTO_SECRET` | Uma chave de criptografia de 32 caracteres usada para criptografar chaves API armazenadas. |
| `POSTGRES_PASSWORD` | A senha do banco de dados. Todos os outros valores `POSTGRES_*` são configurados automaticamente. |

Gere um valor aleatório de 32 caracteres para `CRYPTO_SECRET` usando Docker e copie-o para `.env`:

```sh
docker run --rm alpine:3.22 sh -c "head -c 24 /dev/urandom | base64"
```

Gere uma senha separada para `POSTGRES_PASSWORD`. Você pode copiar configurações de ajuste opcionais do `.env.optional.example`.

:::note[Database connection is automatic]
O serviço Compose PostgreSQL é executado em modo de desenvolvimento (sem SSL) em uma rede interna Docker. A imagem incluída inclui `pgvector` e `pg_cron`, para que a memória de documentos, a pesquisa de vetores e a limpeza programada funcionem imediatamente. Não defina `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER` ou `POSTGRES_DB` em `.env`; O Compose os configura automaticamente.
:::

No Linux, crie os diretórios bind-mount no host e atribua propriedade ao UID 1001 antes de iniciar os contêineres. Docker cria pontos de montagem ausentes como raiz, o que impede que o contêiner do bot salve backups, logs ou uploads:

```sh
mkdir -p backups logs data
sudo chown 1001:1001 backups logs data
```

## 3. Compilar e executar

```sh
docker compose build   # first time, or after code/dependency changes
docker compose up      # bot + database
```

Para inícios posteriores, apenas `docker compose up` é suficiente, a menos que você altere o código ou as dependências. Assim que o bot se conectar ao Discord, execute `/setup` em qualquer canal do servidor para adicionar sua chave de provedor de IA. Consulte o [Início rápido](/pt-BR/introduction/quickstart/) para opções de configuração em Discord.

Componha os pinos `RUN_ENV=development` em sua definição de serviço para que os segredos `.env` e os terminais HTTP locais funcionem. A verificação de integridade do contêiner informa se o processo do bot está em execução; ele não testa a conectividade do gateway Discord. Para diferenças no modo de produção (`RUN_ENV=production`) (gerenciadores secretos, restrições de rede e métricas), consulte [Arquitetura de segurança](/en/architecture/subsystems/security/).

## 4. Servidores locais opcionais (Perfis do Compose)

Execute servidores auxiliares locais opcionais com perfis do Compose para iniciar apenas o que precisa:

```sh
# SearXNG (private web search) + Crawl4AI (browser-rendered fetch)
docker compose --profile searxng --profile fetch-crawl4ai up
```

Ao ativar SearXNG, defina `SEARXNG_BASE_URL=http://searxng:8080/` em `.env`. Caso contrário, deixe-o sem definição. Defina `SEARXNG_SECRET` com um valor aleatório separado para assinatura de solicitação SearXNG.

Consulte [SearXNG](/pt-BR/self-hosting/local-endpoints/setup-searxng/), [Crawl4AI](/pt-BR/self-hosting/local-endpoints/setup-crawl4ai/) e [Monitoramento local](/pt-BR/self-hosting/local-monitoring/) para configuração específica do servidor.

## Manutenção, atualização e backups

Use `bun run update --docker` para atualizações de backup inicial em implantações do Compose. Para fazer backup ou restaurar seu banco de dados Compose, consulte [Manutenção e backups](/pt-BR/self-hosting/maintenance/). Antes de obter uma nova versão, revise [Migração segura](/pt-BR/self-hosting/safe-migration/).
