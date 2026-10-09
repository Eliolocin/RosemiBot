---
title: "Assistente de Configuração"
sidebar:
  label: "Assistente de Configuração"
  order: 1
aiGenerated: false
---

:::note
Usuários que desejam usar Docker Compose devem pular este assistente, veja
[Docker Compose](/pt-BR/self-hosting/docker-compose/) para o caminho de instalação em contêineres.
:::

`bun run setup` é o caminho de hospedagem própria (self-hosting) recomendado para instalações locais baseadas no Bun. Ele cria seu `.env`, gera um `CRYPTO_SECRET`, pede o token do seu bot do Discord, configura o PostgreSQL e instala as dependências exatas do `bun.lock` interativamente, então apenas siga os comandos. É seguro
executar novamente; os valores do `.env` existentes são mantidos, a menos que você escolha reconfigurá-los.

Execute o assistente em um terminal interativo. Se a entrada padrão vier de um pipe ou o terminal
não aceitar perguntas, o assistente avisa que usará os valores padrão disponíveis. Uma pergunta
obrigatória sem valor padrão interrompe a configuração com um erro.

## Obter o código

```sh
git clone https://github.com/Bredrumb/TomoriBot.git
cd TomoriBot
```

## Escolha um caminho

Depois de executar o comando, você escolherá um de dois caminhos:

```bash
bun run setup
```

| Caminho | Usar Quando | O Que Ele Faz |
|---|---|---|
| Full Install | Você deseja a configuração recomendada com extras leves. | Executa Base Install e depois tenta os quatro extras abaixo. |
| Base Install | Você deseja apenas o bot funcionando com o mínimo. | Cria/configura `.env`, token do Discord, PostgreSQL e dependências. |

## O que ter pronto

- [Bun](https://bun.sh/) para rodar o bot e o próprio assistente.
- Um token de bot do Discord com as intents privilegiadas `GuildMembers`, `MessageContent` e `GuildPresences`
  habilitadas.
- Um banco de dados. O TomoriBot armazena tudo no PostgreSQL. Você não precisa configurá-lo manualmente pois
  o assistente faz isso por você: ele usará o PostgreSQL se você já o tiver instalado, ou executará
  um para você no [Docker](https://www.docker.com/) se não tiver. Apenas certifique-se de que um dos
  dois está instalado antes de começar.

:::caution
- O PostgreSQL embutido no Docker roda apenas o banco de dados no Docker. O bot em si, os backups na inicialização, `bun run backup` e `restore-backup` ainda rodam através do Bun no host e das ferramentas de cliente PostgreSQL no host. Se você preferir rodar tudo no Docker, use o
  [Docker Compose](/pt-BR/self-hosting/docker-compose/) em vez disso.
:::

Se o `psql` estiver ausente ou o provisionamento falhar, o assistente imprime o SQL para executar manualmente. De qualquer
forma, o TomoriBot inicializa seu esquema (schema), seeds, migrações, `pgcrypto` e o esquema RAG
automaticamente na primeira inicialização.

## Extras da Full Install

O Full Install executa o Base Install primeiro, depois tenta instalar os extras abaixo. Se algum falhar, ele
imprime o comando ou guia para terminar manualmente e continua:

| Extra | Propósito |
|---|---|
| `pgvector` | Busca vetorial para a memória pessoal/RAG. |
| `pg_cron` | Limpeza opcional e agendada de linhas de tempo de recarga/lembretes. |
| Ativos de tokenizador | Ativos locais de tokenizador para bias logit com base no modelo. |

Para instalar qualquer um deles manualmente, veja os
[Extras da Instalação Manual](/pt-BR/self-hosting/manual-setup/#optional-extras-the-manual-full-install).

## Após a configuração

```bash
bun run dev                          # apenas o bot
bun run launch --searxng --crawl4ai  # bot + servidores locais (veja bun run launch --help)
```

Quando o bot estiver online, execute `/setup` no Discord para conectar um provedor de IA. Um espaço de trabalho (workspace) que não contém um provedor próprio não pode responder, a menos que ele rode no modo BYOK de Usuário (BYOK de Usuário) onde o provedor pessoal de cada membro responde em seu lugar, então este é o último passo de todos os caminhos de instalação.

## O comando `/setup`
<!-- anchor: the-setup-command -->

O `/setup` abre um painel de checklist efêmero que apenas a pessoa que o executou pode operar. Em um servidor
isso exige Gerenciar Servidor (Gerenciar Servidor); em uma DM (Mensagem Direta) ele está disponível para o próprio espaço de trabalho da pessoa. Cada linha no
painel é um valor em rascunho: `Concluir Configuração` é o único controle que escreve alguma coisa, então abrir,
editar, cancelar ou reiniciar deixa todas as linhas do banco de dados intactas.

| Passo | Aparece | O que ele coleta |
|---|---|---|
| Políticas | Apenas `RUN_ENV=production` | Aceitação dos Termos de Serviço e da Política de Privacidade, ambos em um modal. |
| Provedor de IA | Todos os ambientes | Como as respostas chegam a um modelo. Um dos três modos de acesso abaixo. |
| Configurações Iniciais | Todos os ambientes | Persona inicial, estilo de resposta, fuso horário e a predefinição (preset) de prompt de sistema padrão do espaço de trabalho. |

Todo outro valor de `RUN_ENV` renderiza o layout de dois passos e nenhum texto de política. Uma implantação
rodando com `RUN_ENV=production` registra `/legal terms-of-service` e `/legal privacy-policy`
ao lado de `/legal license`; todo outro valor registra apenas `/legal license`.

### Modos de acesso do provedor

- **Provedor de IA (Recomendado)**: escolha um provedor do catálogo e cole sua chave de API. A chave é
  validada contra o provedor e criptografada no rascunho; o painel mostra apenas que uma chave está
  armazenada, nunca a própria chave. Execute `/help`, depois `Configuração` > Step 1: Obter uma Chave de API (Passo 1: Obter uma Chave de API) para o
  guia passo a passo por provedor.
- **Endpoint Personalizado (Avançado)**: uma subárea de dois botões para um endpoint de hospedagem própria ou proxy.
  Configurar Conexão coleta a compatibilidade da API, um rótulo, a URL e um token
  de autenticação opcional, e verifica se o endpoint responde. `Configurar Modelo de Texto` coleta o código do modelo, o
  tamanho de contexto e suas declarações de capacidade (capability declarations), e permanece desabilitado até que uma conexão seja validada.
  Salvar a conexão novamente limpa a declaração do modelo, porque as declarações dependem da
  compatibilidade da API escolhida. Este é o mesmo registro que `/providers` realiza, feito dentro do
  assistente, e ele não cria nenhuma linha antes de `Concluir Configuração`.
- BYOK de Usuário (apenas servidores, nunca em uma DM): o espaço de trabalho não mantém nenhum provedor próprio e todas as
  respostas ativadas por membros resolvem um provedor pessoal em seu lugar. Confirme isso no modal e, em seguida, peça para
  os membros registrarem os seus com `/personal providers`. Veja
  [Server Moderation](/pt-BR/features/setup-administration/server-moderation/#user-byok-bring-your-own-key).

### Configurações iniciais

Um modal de quatro linhas coleta a persona, o estilo de resposta, o deslocamento do fuso horário (timezone) e o prompt de sistema padrão. O fuso horário é opcional e o padrão é UTC. O prompt de sistema oferece
Padrão Integrado (Recomendado) além de toda predefinição (preset) no catálogo do espaço de trabalho: a escolha embutida
não armazena nenhum texto de prompt, então ela continua rastreando o padrão enviado de fábrica, e uma escolha de predefinição armazena
o texto daquela predefinição conforme ele é lido no momento do commit. Excluir uma persona ou prompt armazenado do catálogo
reabre o passo até que outro seja escolhido.

### Finalizando e cancelando

Concluir Configuração permanece desabilitado até que cada passo renderizado esteja completo. Ele revalida os catálogos e
o estado do espaço de trabalho, faz o commit de todo o rascunho em uma única transação, e substitui o painel com o
recibo. `Cancelar` descarta o rascunho e expira todo controle no painel.

Um rascunho vive no processo do bot, não no banco de dados, então ele termina apenas quando é cancelado,
concluído ou quando o processo é reiniciado. No máximo 200 rascunhos são mantidos
ao mesmo tempo; o mais antigo é descartado no limite. Um controle para uma sessão que não está mais disponível não escreve nada.

## Atualizando

Use o comando de atualização com backup primeiro: `bun run update`

Isso executa `bun run backup`, em seguida
`git pull --rebase --autostash`, depois `bun install --frozen-lockfile`. Adicione `--build` se você rodar a partir de `dist/`,
ou `--docker` para uma implantação Compose. Detalhes completos na
página [Manutenção & Backups](/pt-BR/self-hosting/maintenance/).
