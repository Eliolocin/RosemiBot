---
title: "Configuração: LLM Local"
sidebar:
  order: 1
aiGenerated: false
---

O TomoriBot pode usar qualquer servidor de LLM local compatível com OpenAI para geração de texto e embeddings.
Este guia mostra o processo usando Ollama como exemplo, pois é o mais fácil para começar.

Depois de se familiarizar, considere um servidor mais flexível como o
[KoboldCPP](https://github.com/LostRuins/koboldcpp) e use modelos de código aberto direto do
[Hugging Face](https://huggingface.co), pois escolher e testar diferentes modelos feitos pela comunidade
é metade da diversão de rodar sua própria IA.

:::note[Nenhuma variável de ambiente necessária]
Modelos locais são registrados através de comandos slash no Discord e armazenados criptografados no banco de
dados. Não há configuração no `.env` para eles. Veja o [hub de endpoints locais](/pt-BR/self-hosting/local-endpoints/).
:::

## 1. Execute o servidor do seu modelo

Instale o [Ollama](https://ollama.com). Os exemplos abaixo usam o Gemma 4 do Google, mas qualquer coisa na [biblioteca do Ollama](https://ollama.com/library) funciona.

### Qual tamanho devo baixar?

Modelos locais rodam na VRAM da sua GPU (a memória embutida na sua placa de vídeo, separada
da memória RAM do sistema). Regra geral: um modelo precisa de pelo menos o seu tamanho de download livre na
VRAM, mais ~1-2 GB de margem para o contexto da conversa. Escolha o maior Gemma 4 que
caiba na sua placa:

| VRAM da sua GPU | Melhor escolha | Download (aprox.) |
|---|---|---|
| ~8 GB | `gemma4:e2b` | 7.2 GB |
| ~12 GB | `gemma4:12b` | 7.6 GB |
| ~16 GB | `gemma4:12b` (cabe totalmente), ou `gemma4:26b` | 7.6 / 18 GB |
| 24 GB+ | `gemma4:26b` ou `gemma4:31b` | 18 / 20 GB |

Os downloads são os tamanhos de quantização padrão do Ollama; veja a
[página do modelo](https://ollama.com/library/gemma4) para os números exatos. Não tem certeza de quanta VRAM você
tem? No Windows: Gerenciador de Tarefas → Desempenho → GPU, leia "Memória de GPU dedicada".

:::tip[Por que 26B pode superar seu tamanho]
O `gemma4:26b` é um modelo de Mistura de Especialistas (MoE - Mixture-of-Experts): ele contém várias sub-redes "especialistas", mas
ativa apenas ~4B de parâmetros por token. Então, mesmo que seus ~18 GB de pesos não caibam *exatamente*
em 16 GB, o pequeno vazamento para a RAM do sistema mal o desacelera, diferente de um modelo denso da
mesma proporção. É por isso que ele roda bem em muitas placas de 16 GB.
:::

Baixe o tamanho escolhido e inicie o servidor:

```sh
ollama pull gemma4:12b     # troque pela tag que couber na sua VRAM
ollama serve               # escuta em http://127.0.0.1:11434
```

Confirme se está acessível da máquina onde o TomoriBot roda:

```sh
curl http://127.0.0.1:11434/v1/models
```

Anote a tag exata instalada, pois este é o Nome do Modelo (Model Name) que você registrará:

```sh
ollama list
# NAME              ID            SIZE
# gemma4:12b        a1b2c3d4...   7.6 GB
```

## 2. Registre-o no Discord

Execute `/providers` (para o servidor todo) ou `/personal providers` (apenas para você), escolha
`+ Adicionar Novo Endpoint Personalizado` e insira:

| Campo | Valor para Ollama |
|-------|------------------|
| `endpoint_label` | Um nome de sua escolha, ex. `home-ollama` |
| Compatibilidade de API | `OpenAI-Compatible` (recomendado) ou `Ollama` |
| `endpoint_url` | `http://127.0.0.1:11434/v1` para OpenAI-Compatible · `http://127.0.0.1:11434` para Ollama |
| `auth_token` | *(deixe em branco)* |

:::tip[Escolha a URL que corresponde à compatibilidade de API]
Tanto `OpenAI-Compatible` quanto `Ollama` aceitam a raiz pura e a normalizam para a base `/v1`.
`/chat/completions` é adicionado automaticamente, então não o adicione. URLs que já contêm um
caminho, como `https://openrouter.ai/api/v1` ou um prefixo de gateway, são armazenadas exatamente como estão.
:::

Após salvar a conexão, selecione-a e escolha `+ Adicionar Novo Modelo de Texto` no menu suspenso de modelos.
Preencha:

- Nome do Modelo (ID exato da API): `gemma4:12b`, a tag exata de `ollama list`.
- Substituição da Janela de Contexto (Context Window Override): opcional, apenas Ollama / KoboldCPP. Defina isso (ex. `8192`,
  `16384`) para aumentar o `num_ctx` padrão do Ollama, que de outra forma seria pequeno o suficiente para truncar
  o contexto longo do TomoriBot. Deixe em branco para usar o padrão do servidor.
- Alternadores (Toggles): ative `Ferramentas` (Tools) se o modelo suportar chamadas de função; ative Compreensão de Imagem
  (Image Understanding) apenas para um modelo de visão; `Saída Estruturada` (Structured Output) se o modelo lidar com esquemas JSON
  bem. Para nosso exemplo, o Gemma 4 suporta todos eles, então marque todos.

O TomoriBot valida a conexão quando você a salva. Se ele relatar que o endpoint está inacessível, a
causa comum é uma incompatibilidade de `localhost`/Docker ou um `/v1` faltando/extra (veja
[notas e pegadinhas](#notas-e-pegadinhas)).

Adicionar o modelo o torna o modelo de `text` ativo automaticamente: comece a conversar para testá-lo. Se
não estiver ativo por algum motivo, execute `/config` > Modelos > Alternar Modelos e selecione o modelo recém-registrado.

O registro nunca altera nenhum modelo além do `text`. Se você marcou Compreensão de Imagem
para que este endpoint possa atuar como ajudante de visão para um modelo de chat que não enxerga imagens, selecione-o
explicitamente com `/config` > Modelos > Alternar Modelos; todo endpoint de texto que você registrou com esse alternador ativado aparecerá
lá. Note que o modelo de visão só é consultado quando o modelo de chat não consegue ver imagens, então
colocar um atrás de um modelo de chat com capacidade de visão não tem efeito até você alternar.

## 3. (Opcional) Embeddings locais para RAG

Selecione o endpoint salvo e use seu menu suspenso de modelos para adicionar um modelo de Embedding (ex.
`ollama pull nomic-embed-text`, Nome do Modelo `nomic-embed-text:latest`). Os recursos de RAG também precisam do
pgvector instalado no Postgres. Você pode ver o guia de [configuração manual](/pt-BR/self-hosting/manual-setup/) aqui.

## Outros servidores

Todos estes usam o mesmo fluxo, apenas a URL e algumas notas mudam.

### KoboldCPP

- Inicie com a compatibilidade OpenAI ativada (integrada). Padrão: `http://127.0.0.1:5001/v1`.
- Compatibilidade de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:5001/v1`.
- Respeita a Substituição da Janela de Contexto como o Ollama.
- Carrega modelos GGUF; o Nome do Modelo é qualquer coisa que o modelo carregado relatar (geralmente o nome
  base do arquivo), verifique a resposta de `/v1/models` do KoboldCPP.

### llama.cpp (`llama-server`)

- Compile ou instale o [llama.cpp](https://github.com/ggml-org/llama.cpp), depois sirva um GGUF com
  seu servidor compatível com OpenAI empacotado:
  ```sh
  llama-server -m model.gguf -c 16384 --host 0.0.0.0 --port 8080
  ```
- Compatibilidade de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:8080/v1`.
- Defina a janela de contexto no lançamento com `-c` (a Substituição da Janela de Contexto no modal é
  apenas para Ollama/KoboldCPP e não tem efeito aqui).
- O Nome do Modelo é o que `/v1/models` relatar; dê a ele um nome limpo com `--alias my-model`.
- Se você o iniciou com `--api-key`, coloque essa chave no `auth_token`.

### LM Studio

- No LM Studio, inicie o Local Server (aba Desenvolvedor). Padrão: `http://127.0.0.1:1234/v1`.
- Compatibilidade de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:1234/v1`.
- O Nome do Modelo é o identificador que o LM Studio mostra para o modelo carregado.

### vLLM

- Sirva com o servidor compatível com OpenAI: `vllm serve <model>` → `http://127.0.0.1:8000/v1`.
- Compatibilidade de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:8000/v1`.
- Se você iniciou o vLLM com `--api-key`, coloque essa chave no `auth_token`.
- O Nome do Modelo é o caminho/nome do modelo servido (corresponde a `/v1/models`).

### LiteLLM (proxy sobre muitos backends)

- Execute o proxy LiteLLM; padrão: `http://127.0.0.1:4000/v1`.
- Compatibilidade de API: `OpenAI-Compatible`. `endpoint_url`: `http://127.0.0.1:4000/v1`.
- O Nome do Modelo é o alias do modelo que você definiu na configuração do LiteLLM.
- Se o proxy impõe uma chave mestre, defina-a no `auth_token`.

### ChatMock (Conta ChatGPT / CLI do Codex)

Tem seu próprio guia dedicado por causa de uma solução alternativa para o prompt de sistema:
[Configuração: ChatMock](/pt-BR/self-hosting/local-endpoints/setup-chatmock/).

## Escolhendo modelos do Hugging Face

Além da biblioteca selecionada do Ollama, o [Hugging Face](https://huggingface.co) hospeda milhares de
modelos da comunidade. KoboldCPP, llama.cpp e LM Studio podem carregar o formato GGUF, que é um
pacote de arquivo único que você baixa e aponta para o servidor.

1. Encontre um GGUF. Pesquise no Hugging Face pelo seu modelo mais "GGUF"; quantizadores da comunidade como
   o [bartowski](https://huggingface.co/bartowski) publicam builds GGUF dos modelos mais populares
   logo após o lançamento. Prefira uma variante instruct/chat (nomes terminados em `-Instruct` ou
   `-Chat`); modelos base não mantêm uma conversa.
2. Escolha uma quantização que caiba na sua VRAM. Um repositório lista o mesmo modelo em vários níveis de quantização, e o
   tamanho de um arquivo ≈ a VRAM que ele precisa (mais ~1-2 GB para o contexto, mesma regra da
   [tabela de dimensionamento](#qual-tamanho-devo-baixar) acima). Baixe o `.gguf` único para a sua escolha.
3. Carregue-o. Inicie o KoboldCPP ou `llama-server` com esse arquivo (veja
   [Outros servidores](#outros-servidores)), e então registre o endpoint no Discord como de costume.

:::tip[Qual quantização? Q4 ou Q5 é o ponto ideal]
A Quantização armazena cada peso em menos bits para encolher o modelo, com um pequeno custo na qualidade.
O código em nomes como `Q4_K_M` / `Q5_K_M` são os bits por peso: **4 bits (Q4) ou 5 bits (Q5)
é o ponto ideal habitual**, pois mantêm a maior parte da qualidade com aproximadamente metade do tamanho de 8 bits. Abaixo de 4 bits
degrada rapidamente. E para um orçamento fixo de VRAM, um **modelo maior em Q4 geralmente supera um modelo menor
em Q8**.
:::

## Notas e pegadinhas

- Uma entrada de endpoint por rótulo. Para registrar vários modelos que compartilham um servidor, selecione o
  endpoint salvo e use seu menu suspenso de modelos novamente. Use rótulos distintos para
  servidores ou protocolos de API genuinamente diferentes.
- O Nome do Modelo é o identificador da API. É a string exata enviada para o servidor. Errarmos isso é a
  causa mais comum de "conectou, mas as respostas falham".
- Rodando o TomoriBot no Docker? `localhost` dentro do contêiner não é o seu host. Use
  `http://host.docker.internal:<port>` (Windows/macOS) ou o IP da rede local do host, e vincule o
  servidor do modelo a `0.0.0.0`.
