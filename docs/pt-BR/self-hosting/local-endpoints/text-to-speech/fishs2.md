---
title: "Fish Audio S2 Pro"
aiGenerated: true
---

Sintetize fala de personagem multilíngue altamente expressiva com tags de emoção refinadas usando [Fish Audio S2 Pro](https://github.com/fishaudio/fish-speech).

Fish Audio S2 Pro é um modelo multilíngue de conversão de texto em fala com parâmetros 4B desenvolvido para clonagem de voz de alta fidelidade. TomoriBot se conecta ao modelo por meio do wrapper local em `servers/tts/fishs2/`. O padrão é os pesos BF16 oficiais (`fishaudio/s2-pro`), com um ponto de verificação quantizado INT8 opcional (`Imagilux/fishaudio-s2-pro`) para GPUs com 8 a 12 GB de VRAM.

Fish S2 Pro oferece suporte a tags de expressão de colchetes, como `[whisper]`, `[excited]` e `[angry]`. Configure o endpoint com marcação `Tags em Colchetes` para que TomoriBot preserve esses controles em scripts de voz gerados.

## Licença

O código do Fish Speech e os pesos do modelo S2 Pro são distribuídos sob a Fish Audio Research License. Pesquisa e uso não comercial são permitidos de acordo com seus termos; o uso comercial exige uma licença separada da Fish Audio.

O TomoriBot não redistribui os pesos do modelo. Cada usuário de hospedagem própria baixa o Fish S2 Pro diretamente do Hugging Face e é responsável por cumprir a Fish Audio Research License. A atribuição exigida é: Built with Fish Audio.

## Hardware e sistemas operacionais

> [!IMPORTANTE]
> Fish Audio tem como alvo oficial Linux e WSL2. Fish S2 Pro usa uma arquitetura Dual-Autoregressive (Dual-AR) (36 camadas de transformador lento + 10 passagens rápidas de livro de código = 76 avaliações de camada por token). No Linux, o OpenAI Triton compila esse loop em kernels de GPU fundidos (`torch.compile(backend="inductor")`), permitindo a síntese em tempo real. O wrapper deixa a compilação desativada por padrão; defina `FISH_S2_COMPILE=1` para habilitá-lo. >
> No Windows nativo, o Triton não é compatível, forçando o PyTorch a entrar no modo ansioso não compilado com mais de 120.000 despachos sequenciais de kernel CUDA por meio do driver WDDM do Windows. Isso causa uma grave paralisação de despacho, diminuindo a geração para aproximadamente 8 a 10 minutos (aproximadamente 65s de computação por segundo de áudio) para exatamente o mesmo clipe. Para inferência utilizável, execute Fish S2 Pro dentro de Linux ou WSL2.

Hardware recomendado:

- **Linux ou WSL2 (altamente recomendado)**
- GPU NVIDIA com VRAM de 16 GB a 24 GB (BF16 cabe confortavelmente em VRAM de ~16-18 GB com cache e descarregamento KV)
- Python 3.12 recomendado
- `git`, `ffmpeg` e bibliotecas de áudio padrão exigidas por Fish Speech

## Configuração

### Linux e WSL2 (recomendado)

Na raiz do repositório TomoriBot:

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

O instalador:

1. clona `Imagilux/fish-speech` em `servers/tts/fishs2/fish-speech/` e verifica o commit de tempo de execução fixado;
2. cria o `.venv` isolado;
3. instala Fish Speech mais as dependências do wrapper TomoriBot; e
4. baixa o ponto de verificação oficial do BF16 `fishaudio/s2-pro` em `fish-speech/checkpoints/fish-speech-s2-pro/`.

Uma reinstalação normal permanece no commit de tempo de execução fixado `2225e924e7d35cc0a1d24dbc67cd1819e6cf429f` em vez de seguir uma ramificação móvel; mudar para um tempo de execução mais recente significa alterar esse pino no instalador. O padrão da revisão do modelo é `main`; fixe `FISH_S2_MODEL_REVISION` em uma revisão imutável do Hugging Face quando uma implantação precisar ser reproduzível. As configurações do instalador estão listadas em [Variáveis do instalador](#installer-variables).

O modelo Hugging Face é fechado. Aceite sua licença no Hugging Face primeiro. Se o download solicitar autenticação, execute:

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

Em seguida, execute novamente o instalador.

### Windows PowerShell (somente melhor esforço)

O Windows nativo é fornecido apenas para avaliação. Devido à latência de envio do driver no modo ansioso não compilado, a geração será extremamente lenta (cerca de 8 a 10 minutos por clipe):

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

O instalador do PowerShell tem como alvo a aceleração de GPU CUDA (`cu124`) por padrão. Para instalar em uma máquina somente CPU sem GPU NVIDIA, passe `-Cpu`:

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

Se o PyTorch no Windows precisar ser instalado ou atualizado manualmente com suporte CUDA, execute:

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

TomoriBot para de esperar por uma mensagem de voz após `TTS_SYNTHESIZE_TIMEOUT_MS` (padrão 240.000 ms), que é mais curto do que um clipe nativo do Windows. Aumente-o no `.env` do TomoriBot (por exemplo, `TTS_SYNTHESIZE_TIMEOUT_MS=900000`) durante a avaliação no Windows.

## Transcrição de referência obrigatória

> [!AVISO]
> O texto de referência (`ref_text`) é necessário para clonagem de voz; O mecanismo de atenção cruzada do Fish S2 Pro requer a transcrição do áudio de referência para alinhar tokens fonéticos com códigos acústicos. >
> Se você fizer upload de uma amostra de voz sem fornecer sua transcrição de referência correspondente, Fish Speech descartará silenciosamente os tokens de áudio de referência e retornará à fala aleatória de referência zero. O wrapper TomoriBot Fish valida e rejeita solicitações de síntese que não possuem texto de referência com um `400 Bad Request` para evitar geração acidental não condicionada.

Ao adicionar uma voz de persona em `/config` no campo `Models > `Parâmetros TTS e Vozes``, always fill in the `Transcrição de referência` com o texto literal falado em seu clipe de áudio de referência.

## Registrar no TomoriBot

Em `/providers`, escolha `Adicionar Novo Endpoint Personalizado` (Adicionar Novo Endpoint Personalizado) e configure:

- Capability (Capacidade): `Speech`
- API Compatibility (Compatibilidade de API): `tts-clone`
- Endpoint URL (URL do Endpoint): `http://127.0.0.1:8015`
- Modo de Fonte de Voz (Modo da Fonte de Voz): `Clone`
- Script Markup (Marcação do Script): `Tags em Colchetes`
- API key (Chave de API): deixe em branco. O wrapper não tem autenticação; consulte [Acesso de rede](/pt-BR/self-hosting/local-endpoints/text-to-speech/#network-access).

Em seguida, adicione a entrada do modelo (model) do endpoint e ative-o através de `/config` em Models > Switch Models.

## Adicionar vozes de persona

1. Prepare um clipe de referência limpo de 10-20 segundos com apenas um orador e pouco ou nenhum ruído de fundo.
2. Em `/config`, abra Models > `Parâmetros TTS e Vozes` e faça o upload da amostra de voz.
3. Insira a transcrição exata falada no clipe de referência no campo de texto de referência.
4. Em `/config`, abra Persona > Voice e atribua a amostra à persona.
5. Gere uma mensagem de voz com `/generate voice-message` ou deixe o TomoriBot gerar uma através da sua ferramenta de mensagem de voz.

O upstream descreve uma clonagem precisa a partir de amostras de referência de tipicamente 10-30 segundos. O próprio runtime do Fish S2 Pro não aplica nenhum limite de duração da referência, então um clipe mais longo é aceito em vez de cortado, mas a qualidade de clonagem documentada vem da faixa de 10-30 segundos.

## Controles de expressão

O Fish S2 Pro pode variar a entrega dentro de uma mesma fala usando tags entre colchetes. Por exemplo:

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

Como o endpoint usa a marcação `Tags em Colchetes`, o TomoriBot preserva essas tags em vez de removê-las antes da síntese.

## Configuração

| Variável | Padrão | Propósito |
|---|---|---|
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | Diretório do checkpoint do S2 Pro |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Repositório do modelo e rótulo de metadados de integridade (health) para o checkpoint configurado |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Endereço de bind do wrapper; consulte [Acesso de rede](/pt-BR/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `FISH_S2_PORT` | `8015` | Porta do wrapper do Fish |
| `FISH_S2_UPSTREAM_PORT` | `8025` | Porta interna da API do Fish |
| `FISH_S2_COMPILE` | `0` | Habilitar `torch.compile` do Fish Speech (requer Linux/WSL2 com Triton) |
| `FISH_S2_HALF` | `0` | Solicitar modo de tempo de execução FP16 |
| `FISH_S2_CHUNK_LENGTH` | `200` | Comprimento do chunk do prompt iterativo do Fish |
| `FISH_S2_TOP_P` | `0.8` | Amostragem top-p |
| `FISH_S2_TEMPERATURE` | `0.8` | Temperatura de amostragem |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | Penalidade de repetição |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | Máximo de tokens semânticos gerados por requisição |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | Fazer cache de vozes de referência codificadas no tempo de execução do Fish |

### Variáveis do instalador

Lidas por `install-fishs2.sh` e `install-fishs2.ps1`. Registre qualquer valor que você sobrescrever para que a implantação possa ser reproduzida.

| Variável | Padrão | Propósito |
|---|---|---|
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Repositório do Hugging Face a baixar |
| `FISH_S2_MODEL_REVISION` | `main` | Revisão do Hugging Face a baixar |

O áudio de referência deve ser um arquivo PCM RIFF/WAVE não compactado, não vazio e com no máximo 10 MB decodificado. O limite é verificado antes da inferência para que uma requisição base64 muito grande não consuma memória ilimitada, e comporta cerca de 237 segundos do WAV mono de 22,05 kHz que o TomoriBot envia.

## Opção de baixo VRAM (quantização INT8)

Os usuários que executam GPUs com VRAM restrito (por exemplo, 8-12 GB) que não conseguem se enquadrar no ponto de verificação oficial do BF16 podem optar pelo modelo quantizado INT8 (`Imagilux/fishaudio-s2-pro`).

Para instalar e executar o ponto de verificação INT8:

```bash
# In Linux / WSL2:
export FISH_S2_MODEL_ID="Imagilux/fishaudio-s2-pro"
export FISH_S2_MODEL_DIR="servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
export FISH_S2_MODEL_REVISION="9706ff036580881d87cc09465dd10014527bc481"
bash servers/tts/fishs2/install-fishs2.sh
```

```powershell
# In Windows PowerShell:
$env:FISH_S2_MODEL_ID = "Imagilux/fishaudio-s2-pro"
$env:FISH_S2_MODEL_DIR = "servers/tts/fishs2/fish-speech/checkpoints/fish-speech-s2-pro-int8"
$env:FISH_S2_MODEL_REVISION = "9706ff036580881d87cc09465dd10014527bc481"
.\servers\tts\fishs2\install-fishs2.ps1
```

Inicie `server.py` a partir do mesmo shell ou defina as mesmas três variáveis antes de iniciá-lo, para que o wrapper carregue o diretório INT8 em vez do padrão BF16.

O ponto de verificação INT8 reduz o peso do transformador de ~10,3 GB para ~5,1 GB, mantendo os embeddings de áudio e camadas de codec no BF16, cabendo dentro de ~10 GB de VRAM total.
