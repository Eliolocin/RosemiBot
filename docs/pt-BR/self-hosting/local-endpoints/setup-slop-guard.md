---
title: "Configuração: slop-guard"
sidebar:
  order: 8
aiGenerated: true
---

Execute o [slop-guard](https://github.com/eric-tramel/slop-guard), um verificador de prosa baseado em regras, como o verificador de regras para a [Revisão de respostas](/pt-BR/features/chatting-personality/behavior-tweaking/#response-drafting). Ele pontua cada resposta retida em busca de padrões de escrita repetitivos e passa o relatório ao revisor. A verificação é baseada em regras, portanto não consome tokens.

O slop-guard é distribuído apenas como um processo stdio local. O diretório `servers/slop-guard/` empacota a versão fixada (`0.5.0`) em um contêiner pequeno que fornece as mesmas ferramentas via MCP Streamable HTTP, que é como o TomoriBot se conecta aos servidores MCP.

## Iniciar o servidor

### Opção A: Docker Compose (quando o TomoriBot roda no Docker)

```sh
docker compose --profile slop-guard up -d
```

O contêiner se conecta à rede Docker do TomoriBot como `slop-guard`. Ele não publica nenhuma porta do host.

### Opção B: Docker Independente (quando o TomoriBot roda na sua máquina)

Inicie o bot com o verificador em vez de `bun run dev`:

```sh
bun run launch --slopguard
```

Isso compila a imagem, inicia um contêiner `slop-guard` em `127.0.0.1:8765`, aguarda que ele aceite conexões e executa o bot no modo de observação. O contêiner continua em execução após `Ctrl+C`; pare-o com `docker stop slop-guard`. Após alterar `servers/slop-guard/`, remova o contêiner antigo (`docker rm -f slop-guard`) para que o launch crie um novo a partir da imagem reconstruída.

## Registrar

1. Abra `/config` > Plugins > Servidores MCP e escolha `+ Adicionar MCP`.
2. Defina a `URL do Servidor` como `http://slop-guard:8765/mcp` (Opção A) ou `http://localhost:8765/mcp` (Opção B). Deixe o `Token de Autenticação` vazio.
3. Defina o `Tipo de Servidor` como `Corretor de prosa`.
4. Abra `/config` > Plugins > Revisão de respostas e escolha `<nome do servidor> / check_slop` em `Verificações de regras`.

`Corretor de prosa` mantém as ferramentas do servidor isoladas da própria Tomori. O slop-guard também possui o `check_slop_file`, que lê um caminho de arquivo dentro do contêiner; o verificador de regras nunca o oferece porque ele não recebe o texto da resposta.

Endereços locais funcionam porque o TomoriBot auto-hospedado roda com `RUN_ENV=development` (o Compose fixa isso). Com `RUN_ENV=production`, o TomoriBot recusa URLs de MCP que resolvem para endereços privados ou de loopback.

## Configurações

| Variável | Padrão | Propósito |
|---|---|---|
| `SLOP_GUARD_CONFIG` | regras empacotadas | Caminho dentro do contêiner para uma configuração de regras JSONL. Monte o arquivo e aponte esta variável para ele. |
| `SLOP_GUARD_PORT` | `8765` | Porta de escuta. |
| `SLOP_GUARD_ALLOWED_HOSTS` | `slop-guard:*,localhost:*,127.0.0.1:*` | Valores do cabeçalho `Host` que o servidor aceita. Adicione o nome do host colocado em `URL do Servidor` se não estiver nesta lista; qualquer outro host recebe HTTP 421. |

As regras padrão do slop-guard visam a prosa gerada em documentações e artigos. Respostas informais de roleplay podem ativar algumas delas, como as verificações de marcadores e listas de três itens, portanto o relatório é consultivo: o revisor decide se uma ocorrência importa para a persona. Mencione o relatório no seu prompt do revisor se desejar que o revisor o avalie de uma forma específica. A ferramenta `sg-fit` do slop-guard pode calibrar uma configuração de regras com seus próprios exemplos bons e ruins.

## Atualização

Altere a versão em `servers/slop-guard/Dockerfile`, reconstrua e envie uma mensagem de teste com a Revisão de respostas ativada. Uma nova versão pode alterar as regras e o formato do relatório lido pelo revisor.
