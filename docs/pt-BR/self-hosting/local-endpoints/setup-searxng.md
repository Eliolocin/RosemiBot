---
title: "Configuração: SearXNG"
sidebar:
  order: 3
---

Adicione pesquisa na web privada e auto-hospedada a TomoriBot usando [SearXNG](https://docs.searxng.org/).

A ferramenta `web_search` consulta uma cadeia de fallback do mecanismo: Brave, SearXNG e DuckDuckGo. A execução de uma instância SearXNG local fornece uma fonte de pesquisa auto-hospedada quando um provedor externo atinge limites de taxa ou falha e permite categorias de pesquisa especializadas: `science`, `it`, `files` e `music`.

Escolha um caminho de configuração:

### Opção A: Docker Compose (quando TomoriBot é executado em Docker)

Use este caminho se você executar TomoriBot com a pilha Docker Compose do repositório. Em seguida, execute com o perfil `searxng`:

```sh
docker compose --profile searxng up -d
```

Defina `SEARXNG_BASE_URL=http://searxng:8080/` em `.env` antes de iniciar este perfil. O bot usa esse endereço para acessar o serviço `searxng`. Deixe a variável não definida quando o perfil estiver desativado.

Se você executar TomoriBot diretamente com `bun run dev`, use o caminho independente abaixo.

Defina `SEARXNG_SECRET` em `.env` como um valor aleatório separado para a chave de assinatura do contêiner.

---

### Opção B: Docker independente (ao executar `bun run dev`)

Primeiro, defina `SEARXNG_BASE_URL=http://localhost:8080/` em `.env` para que o bot saiba onde se conectar.

Então, em vez de executar TomoriBot diretamente com `bun run dev`, use `bun run launch --searxng`. Isso lida com o ciclo de vida do contêiner automaticamente e espera que o contêiner esteja íntegro antes de iniciar o bot:

```sh
bun run launch --searxng
```

Se preferir gerenciar o contêiner sozinho, mantenha `SEARXNG_BASE_URL=http://localhost:8080/` em `.env`. Crie primeiro a imagem do repositório para que ela carregue as configurações de pesquisa JSON e substitua a chave de assinatura:

```sh
docker build -t tomoribot-searxng:latest -f servers/searxng/Dockerfile servers/searxng
```

Em seguida, execute-o:

PowerShell:

```powershell
docker run -d --name searxng -p 8080:8080 `
  --tmpfs /etc/searxng `
  tomoribot-searxng:latest
```

Bash (Linux/macOS):

```bash
docker run -d --name searxng -p 8080:8080 \
  --tmpfs /etc/searxng \
  tomoribot-searxng:latest
```

Em seguida, execute `bun run dev` quando o contêiner estiver íntegro (`docker ps` mostra `(healthy)`). Sem `SEARXNG_SECRET` no ambiente do contêiner, a imagem gera uma chave de assinatura efêmera.

---

### Opção C: Não SearXNG

Deixe `SEARXNG_BASE_URL` indefinido. A cadeia volta para `Brave → DuckDuckGo`.

Quando nenhum servidor SearXNG está configurado, o esquema `web_search` montado não anuncia mais categorias somente SearXNG. As categorias comuns (`text`, `image`, `video`, `news`) ainda aparecem quando o Brave está configurado, e a pesquisa somente texto aparece quando apenas o fallback integrado do DuckDuckGo está disponível.

---

## Ajuste de resultado de imagem

Os resultados da imagem SearXNG são validados por HEAD, opcionalmente compactados e postados como anexos Discord: UX idêntico às imagens Brave. Se todos os URLs candidatos falharem na validação, SearXNG retornará uma lista de texto de links de imagem em vez de uma falha grave.

| Variável | Padrão | Descrição |
|---|---|---|
| `SEARXNG_IMAGE_COUNT` | `3` (máx. 10) | Quantas imagens válidas são enviadas para Discord. Substituído pelo argumento `count` do LLM. |
| `SEARXNG_IMAGE_POOL` | `10` | Conjunto de URLs candidatos quando o LLM não especifica `count`. Quando `count` é especificado, o conjunto é `count × 3` (limitado a 30) para absorver falhas de proteção de hotlink. |
| `WEB_SEARCH_TIMEOUT_MS` | — | Tempo limite de solicitação por mecanismo. |

*(Veja `.env.optional.example` para todos os ajustáveis.)*
