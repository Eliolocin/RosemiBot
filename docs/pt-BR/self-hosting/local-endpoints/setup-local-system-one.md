---
title: "Configuração: Modelo de Decisão Local"
sidebar:
  order: 7
aiGenerated: true
---

Execute um pequeno modelo de decisão em sua própria máquina e registre-o no TomoriBot. Um modelo de decisão responde a perguntas sobre um texto, como sim ou não ou qual de vários tópicos se encaixa, com probabilidades. O [Kev](https://github.com/jaredpalmer/kev) é um modelo aberto que utiliza o protocolo System One, o mesmo que o Jev hospedado da TypeSafe utiliza.

:::note[O que o utiliza]
Depois de selecionado em `/config` > `Modelos` > `Trocar Modelos`, ou como o Verificador de Toques Ativos em `/config` > `Plugins` > `Natural Nudges`, o modelo de decisão determina quando o [Natural Nudges](/features/chatting-personality/natural-nudges/#active-nudges) entra em uma conversa, pedindo a ele que escolha um tópico entre vários. Consulte [Modelos de Decisões](/features/setup-administration/providers-and-models/#decision-models) para obter detalhes.
:::

## 1. Executar o Kev

O Kev precisa de [Git](https://git-scm.com), [uv](https://docs.astral.sh/uv/) e Python 3.12 ou 3.13 (o uv instala para você). Escolha um tamanho adequado para a sua GPU:

| Modelo | ID no Hub | Pesos (aprox.) | Notas |
|---|---|---|---|
| Kev-0.8B | `jaredpalmer/kev-0.8b` | 2 GB | Executa em uma GPU de 4 GB. Menor precisão. |
| Kev-4B | `jaredpalmer/kev-4b` | 8-9 GB | Ponto de partida recomendado do Kev se couber na memória da sua GPU. |

O README do Kev menciona CUDA, ROCm e Apple Silicon. As etapas do Windows abaixo foram verificadas no Windows nativo com uma GPU NVIDIA. Se o servidor não iniciar na sua configuração, execute as mesmas etapas no WSL2.

Clone-o em um local fora da pasta do TomoriBot:

```powershell
git clone https://github.com/jaredpalmer/kev.git
cd kev
uv sync --extra serve
```

No Windows com uma GPU NVIDIA, o `uv sync` instala o PyTorch apenas para CPU, que é lento demais. Substitua-o pela compilação CUDA e verifique se ele reconhece sua GPU:

```powershell
uv pip install --reinstall-package torch "torch>=2.6,<2.9" --index-url https://download.pytorch.org/whl/cu128
uv run --no-sync python -c "import torch; print(torch.cuda.is_available())"
```

A saída deve ser `True`. A partir de agora, inicie o Kev com `uv run --no-sync`, porque um `uv run` comum sincronizaria a compilação de CPU de volta. No Linux e macOS, use `uv run --extra serve`.

Inicie o servidor. A primeira execução baixa o modelo, portanto, leva alguns minutos:

```powershell
uv run --no-sync python -m kev.serve --run jaredpalmer/kev-4b --port 8009 --device cuda
```

`--device cuda` faz com que o Kev falhe explicitamente se não puder usar sua GPU, em vez de executar silenciosamente na CPU. Use `jaredpalmer/kev-0.8b` se o Kev-4B ficar sem memória. No Mac, remova `--device cuda`.

Deixe-o em execução e verifique-o em outra janela do PowerShell. O primeiro comando lista o nome do modelo e o segundo retorna uma probabilidade entre 0 e 1 para a pergunta de sim/não:

```powershell
Invoke-RestMethod http://127.0.0.1:8009/v1/models
$body = '{"state":"The fictional door is blue.","model":"kev-latest","questions":{"q":{"type":"noul","instructions":"Is the door blue?"}}}'
Invoke-RestMethod http://127.0.0.1:8009/v1/systemone -Method Post -ContentType "application/json" -Body $body
```

O Kev imprime um aviso de que `flash-linear-attention` está ausente. Em seguida, ele usa um caminho mais lento que fornece as mesmas respostas, portanto, você pode ignorá-lo.

## 2. Registrá-lo no Discord

Execute `/providers` (no servidor inteiro) ou `/personal providers` (apenas para você), escolha `Add New Custom Endpoint` e insira:

| Campo | Valor |
|---|---|
| `Endpoint Label` | `kev` |
| `Endpoint URL` | `http://127.0.0.1:8009/v1` |
| `API Compatibility` | `System One compatible` |
| `Auth Token` | Deixe em branco, a menos que tenha definido `KEV_API_KEY` |

O TomoriBot verifica `GET /v1/models` ao salvar. Um servidor que responda `404` ou `405` ainda será aceito.

Abra o endpoint `kev` salvo, escolha `+ Adicionar um modelo de decisões` no menu suspenso de modelos e insira:

- `Code Name`: `kev-latest`, o nome de modelo usado nos exemplos do Kev.
- `Context Window`: `8192`, o texto mais longo para o qual Kev-0.8B e Kev-4B foram validados. O Kev recusa qualquer valor acima de 65.536 tokens.

## 3. Selecioná-lo

Abra `/config` > `Modelos` > `Trocar Modelos` e escolha `kev-latest` no slot `Decisão`. `- Sem Modelo` desmarca sem excluir o registro.

## Notas e observações

- **Parar o servidor**: use `Ctrl+C`. O TomoriBot não inicia nem para o Kev para você.
- **TomoriBot no Docker?** `127.0.0.1` dentro do contêiner não é o seu host. Use `http://host.docker.internal:8009/v1` e inicie o Kev com `--host 0.0.0.0`. O Kev não tem autenticação por padrão, portanto defina `KEV_API_KEY` primeiro e coloque o mesmo valor em `Auth Token`.
- **Ambientes de produção**: impõem HTTPS e bloqueiam endereços privados para endpoints de provedores. Uma URL HTTP local funciona quando `RUN_ENV=development`. Consulte [LLM Local](/self-hosting/local-endpoints/setup-local-llm/#notes--gotchas).
- **Outros servidores System One**: como o Laya, usam as mesmas etapas com sua própria URL e nome de modelo. Um servidor que implemente a API OpenAI Decisions usa `OpenAI Decisions compatible`.
