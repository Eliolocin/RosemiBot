---
title: "Configuração: Crawl4AI"
sidebar:
  order: 4
---

Renderize páginas da web com muito JavaScript em Markdown limpo para TomoriBot usando um servidor local [Crawl4AI](https://github.com/unclecode/crawl4ai).

A ferramenta `fetch_url` integrada usa o mecanismo leve `safe_http` por padrão. Crawl4AI adiciona um navegador Playwright sem cabeça opcional que executa scripts do lado do cliente e extrai o conteúdo da página antes de retornar o Markdown ao bot.

Como Crawl4AI segue redirecionamentos fora do cliente HTTP protegido de TomoriBot, ele só é admitido onde a busca em rede privada é permitida. Fora da produção (`RUN_ENV` != `production`), a busca de rede privada é habilitada automaticamente. Em ambientes de produção, é necessária a configuração de `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`.

:::caution[O que o TomoriBot pode e não pode verificar]
O TomoriBot recusa uma URL cujo nome de host não seja resolvido ou seja resolvido para um endereço de metadados de nuvem, antes de solicitar que o Crawl4AI a abra. Ele não pode controlar o que o navegador faz em seguida: o Crawl4AI resolve o nome novamente, segue redirecionamentos e carrega imagens e scripts por conta própria. O bloqueio de metadados sempre ativo do TomoriBot não cobre essas solicitações.

A imagem fixada (`unclecode/crawl4ai:0.9.4`) envia seu navegador por meio de seu próprio proxy, que bloqueia endereços privados, de loopback e de metadados em todas as solicitações e redirecionamentos. Deixe `CRAWL4AI_ALLOW_INTERNAL_URLS` indefinido: defini-lo como `true` desativa esse proxy, metadados incluídos.
:::

O Crawl4AI 0.9.4 precisa de um token de API antes de aceitar conexões de fora de seu próprio contêiner. Gere um (por exemplo, `openssl rand -hex 32`) e defina-o como `CRAWL4AI_TOKEN` no `.env` para cada caminho de configuração abaixo. Sem ele, o contêiner inicia, mas o TomoriBot não consegue alcançá-lo e recorre ao `safe_http`.

Escolha um caminho de configuração:

### Opção A: Docker Compose (quando TomoriBot é executado em Docker)

Use este caminho se você executar TomoriBot com a pilha Docker Compose do repositório. Primeiro, defina `CRAWL4AI_BASE_URL=http://crawl4ai:11235/` e `CRAWL4AI_TOKEN` em `.env`. Fora da produção, nenhuma adesão à rede privada é necessária; adicione `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` apenas se você executar esta pilha com `RUN_ENV=production`.

Então, comece com:

```sh
docker compose --profile fetch-crawl4ai up -d
```

Isso inicia a pilha do Compose com o contêiner Crawl4AI na rede Docker de TomoriBot. O Compose passa `CRAWL4AI_TOKEN` para o contêiner como `CRAWL4AI_API_TOKEN`, e o TomoriBot o envia como um token bearer. A porta 11235 é publicada apenas em `127.0.0.1`, para depuração local; o TomoriBot conecta-se pela rede Docker.

Se você executar TomoriBot diretamente com `bun run dev`, use o caminho independente abaixo.

Se você também deseja SearXNG, encadeie os perfis:

```sh
docker compose --profile searxng --profile fetch-crawl4ai up -d
```

---

### Opção B: Docker independente (ao executar `bun run dev`)

Primeiro, defina `CRAWL4AI_BASE_URL=http://localhost:11235/` e `CRAWL4AI_TOKEN` em `.env` para que o bot se conecte à porta do contêiner publicada em `127.0.0.1`. Fora da produção, nenhuma adesão à rede privada é necessária; adicione `FETCH_URL_ALLOW_PRIVATE_NETWORK=true` apenas se você executar com `RUN_ENV=production`.

Depois, em vez de executar o TomoriBot diretamente com `bun run dev`, use `bun run launch --crawl4ai`. Isso gerencia o ciclo de vida do contêiner automaticamente e espera até que o servidor esteja íntegro antes de iniciar o bot. Ele é interrompido com um erro se `CRAWL4AI_TOKEN` estiver ausente:

```sh
bun run launch --crawl4ai
```

Se você também quiser SearXNG:

```sh
bun run launch --searxng --crawl4ai
```

Se preferir gerenciar o contêiner sozinho, mantenha `CRAWL4AI_BASE_URL=http://localhost:11235/` em `.env` e execute:

PowerShell:

```powershell
docker run -d --name crawl4ai -p 127.0.0.1:11235:11235 --shm-size=3g `
  -e CRAWL4AI_API_TOKEN=<your-token> unclecode/crawl4ai:0.9.4
```

Bash (Linux/macOS):

```bash
docker run -d --name crawl4ai -p 127.0.0.1:11235:11235 --shm-size=3g \
  -e CRAWL4AI_API_TOKEN=<your-token> unclecode/crawl4ai:0.9.4
```

Use o mesmo valor para `<your-token>` que `CRAWL4AI_TOKEN` no `.env`.

Em seguida, execute `bun run dev` quando o contêiner estiver íntegro (`docker ps` mostra `(healthy)`).

---

### Opção C: Nenhum servidor de renderização de navegador

Deixe `CRAWL4AI_BASE_URL` indefinido. A ferramenta `fetch_url` usa o mecanismo `safe_http` protegido.

---

## Ordem inicial

TomoriBot investiga a integridade do servidor na primeira chamada `fetch_url` após a inicialização e armazena o resultado em cache por 60 segundos. Se o contêiner não estiver pronto quando a primeira investigação for acionada, o bot o tratará como indisponível no minuto seguinte.

Para Docker independente, inicie seu contêiner Crawl4AI antes de iniciar TomoriBot. `bun run launch --crawl4ai` já faz isso por você.

### Configuração pela primeira vez

1. Inicie o contêiner e espere até que ele mostre `(healthy)` em `docker ps`:
   ```powershell
   docker ps
   ```
2. Defina `CRAWL4AI_BASE_URL` em `.env` usando o valor do caminho de configuração acima.
3. Inicie TomoriBot (`bun run dev` ou `docker compose up`).

### Atualizando de `latest`

Um contêiner `crawl4ai` existente mantém a imagem a partir da qual foi criado, portanto, `docker start` não o atualiza. Remova-o uma vez e use seu caminho de configuração novamente:

```powershell
docker rm -f crawl4ai
```

Com o Compose, `docker compose --profile fetch-crawl4ai up -d` recria o contêiner a partir da imagem fixada.

### Retornando após uma reinicialização

Se o contêiner já existir em uma execução anterior, use `docker start` em vez de `docker run` para evitar conflito de nomenclatura:

```powershell
# Start an existing container
docker start crawl4ai

# Confirm healthy before starting TomoriBot
docker ps
```

Em seguida, inicie TomoriBot normalmente. Reiniciar `bun run dev` redefine o cache de integridade da memória, portanto, desde que o contêiner esteja pronto primeiro, o mecanismo correto será selecionado imediatamente.

---

## Injeção de biscoito

Crawl4AI suporta a injeção de cookies no nível do navegador para que o navegador sem cabeça pareça já conectado ao buscar uma página. Isso é útil para sites que exigem uma sessão para visualizar o conteúdo (por exemplo, notícias com acesso pago, fóruns privados, painéis controlados por login).

O substituto `safe_http` não oferece suporte à injeção de cookies. Os cookies só se aplicam quando Crawl4AI está ativo.

:::note[Bot detection limits]
A injeção de cookies ignora as paredes de login, mas não a impressão digital do bot. Sites com detecção anti-bot agressiva (principalmente Twitter/X) detectam o Playwright sem cabeça por meio de impressão digital canvas/WebGL e veiculam páginas vazias mesmo com cookies de sessão válidos. A injeção de cookies funciona bem para sites que utilizam apenas autenticação.
:::

### Obtendo seus biscoitos

1. Abra seu navegador e faça login no site de destino.
2. Abra DevTools (`F12`) > guia `Application` > `Storage` > `Cookies` > selecione o domínio do site.
3. Copie o `Value` de cada cookie necessário (normalmente um token de sessão; verifique os nomes dos cookies do site).

### Crawl4AI

Defina `CRAWL4AI_COOKIES_JSON` em `.env` como uma matriz JSON:

```dotenv
CRAWL4AI_COOKIES_JSON=[{"name":"session","value":"YOUR_SESSION_TOKEN","domain":".example.com"}]
```

Quando definido, `fetch_url` alterna automaticamente do terminal `/md` para `/crawl` com `browser_config.cookies`. `/md` não suporta injeção de cookies.

### Campos de objeto de cookie

| Campo | Obrigatória | Descrição |
|---|---|---|
| `name` | Sim | Nome do biscoito |
| `value` | Sim | Valor do cookie |
| `domain` | Não | Escopo do domínio (por exemplo, `.x.com`). Recomendado para correção. |
| `path` | Não | Escopo do caminho. O padrão é `/` se omitido. |

:::caution[Protect session tokens]
Os valores dos cookies são confidenciais, portanto trate-os como senhas. Eles concedem acesso completo à sessão da sua conta. Não confirme `.env` para controle de versão.
:::

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `CRAWL4AI_BASE_URL` | não definida | Ativa o Crawl4AI quando definido: o TomoriBot tenta usá-lo primeiro e recorre ao `safe_http` se estiver fora do ar ou uma busca falhar. Ignorado em produção a menos que `FETCH_URL_ALLOW_PRIVATE_NETWORK=true`. Use `http://crawl4ai:11235/` do Docker Compose ou `http://localhost:11235/` quando o TomoriBot for executado diretamente em sua máquina. |
| `CRAWL4AI_TOKEN` | não definida | Token bearer obrigatório. Deve corresponder a `CRAWL4AI_API_TOKEN` no contêiner Crawl4AI, que recusa conexões externas sem ele. |
| `FETCH_URL_TIMEOUT_MS` | `15000` | Tempo limite de solicitação por mecanismo para Crawl4AI e outros mecanismos de busca de URL. |
| `FETCH_URL_MAX_CONTENT_LENGTH` | `50000` | Máximo de caracteres retornados por uma chamada de busca antes que a continuação seja necessária. |
| `FETCH_URL_ALLOW_PRIVATE_NETWORK` | `false` | Ativação apenas de produção. Fora da produção (`RUN_ENV` != `production`) o guarda SSRF relaxa automaticamente, então buscas localhost/privadas/internas e despacho Crawl4AI funcionam sem configuração. Defina `true` apenas para permitir buscas de rede privada em uma implantação de produção confiável. |
| `FETCH_URL_FILTER_MODE` | `fit` | Modo de filtro Crawl4AI `/md`. `fit` mantém markdown mais limpo para uso LLM; `fetch_url(..., raw=true)` o substitui por solicitação. |
