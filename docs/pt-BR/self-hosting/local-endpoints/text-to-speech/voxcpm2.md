---
title: "VoxCPM2"
aiGenerated: true
---

Sintetize fala expressiva de 48 kHz em 30 idiomas usando o modelo de conversão de texto em fala do OpenBMB [VoxCPM2](https://github.com/OpenBMB/VoxCPM).

VoxCPM2 é um modelo de fala multilíngue com parâmetros 2B que suporta clonagem de voz, clonagem final assistida por transcrição e design de voz em linguagem natural. TomoriBot se conecta à biblioteca oficial `voxcpm` Python por meio do servidor em `servers/tts/voxcpm2/`, executando o ponto de verificação oficial não quantizado `openbmb/VoxCPM2` BF16 confortavelmente dentro de 16 GB de VRAM.

## Licença

O código e os pesos do modelo VoxCPM2 são lançados sob a licença Apache-2.0, incluindo o uso comercial sujeito aos termos da licença. O TomoriBot não redistribui os pesos; o instalador os baixa do repositório oficial do Hugging Face.

Recursos oficiais da fonte (upstream):

- [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM)
- [openbmb/VoxCPM2 no Hugging Face](https://huggingface.co/openbmb/VoxCPM2)
- [Documentação do VoxCPM](https://voxcpm.readthedocs.io/)

## Idiomas suportados

O VoxCPM2 suporta oficialmente 30 idiomas sem exigir uma tag de idioma:

Árabe, Birmanês, Chinês, Dinamarquês, Holandês, Inglês, Finlandês, Francês, Alemão, Grego, Hebraico, Hindi, Indonésio, Italiano, Japonês, Khmer, Coreano, Laosiano, Malaio, Norueguês, Polonês, Português, Russo, Espanhol, Suaíli, Sueco, Tagalo, Tailandês, Turco e Vietnamita.

A OpenBMB também documenta vários dialetos chineses. O TomoriBot ainda pode enviar um campo `language` para manter a compatibilidade com o contrato comum de TTS, mas o VoxCPM2 detecta o idioma a partir do texto de síntese e o wrapper não força o uso de uma tag de idioma.

## Modos de voz

Um único endpoint do VoxCPM2 pode lidar com todos os modos úteis de fonte de voz do TomoriBot:

| Requisição do TomoriBot | Comportamento do VoxCPM2 |
|---|---|
| Apenas `text` | Rejeitado; escolha uma amostra de referência ou um prompt de VoiceDesign |
| `text` + `instruct` | Voice Design a partir de uma descrição em linguagem natural |
| `text` + `ref_audio` | Clonagem de voz por áudio de referência |
| `text` + `ref_audio` + `instruct` | Clonagem controlável: preserva o falante enquanto direciona a entrega |
| `text` + `ref_audio` + `ref_text` | Clonagem Suprema usando o áudio de referência e sua transcrição |
| `text` + `ref_audio` + `ref_text` + `instruct` | Clonagem controlável; a instrução específica tem precedência e a transcrição não é enviada |

O VoxCPM2 representa o Voice Design e o controle de estilo ao colocar uma descrição em linguagem natural entre parênteses antes do texto a ser sintetizado. O TomoriBot já possui um campo `instruct` para esse fim, então o wrapper realiza essa conversão automaticamente.

Use o Script Markup Plain. O VoxCPM2 não exige que o TomoriBot preserve as tags de colchetes ou a sintaxe de controle de emojis, e nenhum modo novo de Script Markup é necessário.

## Hardware e tempo de execução

Ponto de partida recomendado:

- Python 3.10-3.12
- Placa de vídeo NVIDIA com 8 GB de VRAM ou mais para a execução oficial em BF16; 12-16 GB oferecem uma margem confortável
- Driver NVIDIA atual e uma compilação do PyTorch habilitada para CUDA para aceleração por GPU
- O uso de CPU é suportado como um plano de fallback, mas é substancialmente mais lento

O pacote oficial também expõe a seleção de dispositivos CPU e Apple MPS. Para o TomoriBot no Windows, o pacote padrão do Python pode rodar de forma nativa; o WSL não é obrigatório. O instalador via PowerShell do Windows instala uma compilação do PyTorch habilitada para CUDA (`cu124`) por padrão.

Para instalar explicitamente em uma máquina que utilize apenas a CPU, passe o argumento `-Cpu`:

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1 -Cpu
```

Se a sua instalação nativa do PyTorch no Windows precisar de uma reinstalação manual ou de um realinhamento de driver, instale a compilação do PyTorch habilitada para CUDA diretamente no ambiente virtual do servidor:

```powershell
.\servers\tts\voxcpm2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

A OpenBMB relata cerca de 0,30 RTF em uma RTX 4090 com a execução padrão. A fonte (upstream) também oferece suporte para geração em streaming e documenta opções de serviço mais rápidas com o Nano-vLLM e o vLLM-Omni. O contrato atual do `POST /synthesize` do TomoriBot retorna uma única resposta WAV, então esse servidor propositalmente armazena a fala gerada em buffer, em vez de expor um protocolo de streaming separado.

## Instalação

O servidor fixa o pacote `voxcpm` 2.0.3 estável atual e baixa `openbmb/VoxCPM2` no cache normal do Hugging Face.

### Linux e WSL Bash

Na raiz do repositório TomoriBot:

```bash
bash servers/tts/voxcpm2/install-voxcpm2.sh
servers/tts/voxcpm2/.venv/bin/python servers/tts/voxcpm2/server.py
```

### Windows PowerShell

Na raiz do repositório TomoriBot:

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1
.\servers\tts\voxcpm2\.venv\Scripts\python.exe servers\tts\voxcpm2\server.py
```

A primeira configuração baixa vários gigabytes de pesos de modelo. Para instalar o ambiente Python sem pré-buscar o modelo, defina `VOXCPM2_PREFETCH=0`; a biblioteca oficial fará o download do ponto de verificação na primeira inicialização do servidor.

Linux e WSL:

```bash
VOXCPM2_PREFETCH=0 bash servers/tts/voxcpm2/install-voxcpm2.sh
```

PowerShell:

```powershell
$env:VOXCPM2_PREFETCH = "0"
.\servers\tts\voxcpm2\install-voxcpm2.ps1
```

Após a configuração, `bun run launch --voxcpm2` inicia o servidor junto com TomoriBot. O terminal padrão é `http://127.0.0.1:8016`.

## Registrar no TomoriBot

Execute `/providers`, escolha `Adicionar Novo Endpoint Personalizado` (Adicionar Novo Endpoint Personalizado) e configure o endpoint de Fala (Speech):

- Capacidade: `Speech`
- Compatibilidade da API: `tts-clone`
- URL do Endpoint: `http://127.0.0.1:8016`
- Modo da Fonte de Voz: `Auto`
- Script Markup: `Plain`
- Suporta Instrução (Instruct): `Yes` (Sim)

Depois de salvar a conexão, selecione-a e use o menu suspenso de modelos para adicionar um modelo de Fala. Em seguida, abra `/config` > Models (Modelos) > Switch Models (Mudar Modelos) e selecione o modelo de fala VoxCPM2.

O modo `Auto` é recomendado porque o mesmo servidor suporta tanto a clonagem por áudio de referência quanto o Voice Design. Você não precisa de processos separados do VoxCPM2 para os dois modos.

## Clonagem de voz da persona

Para uma persona que deve clonar um falante existente:

1. Prepare um clipe de referência nítido com um falante e pouca ou nenhuma música de fundo. A fonte (upstream) trata 5 a 30 segundos como a faixa prática.
2. Abra `/config` em Models (Modelos) > `Parâmetros TTS e Vozes` (`Parâmetros TTS e Vozes`) e envie o clipe (upload).
3. Adicione a transcrição exata do clipe de referência, quando disponível. O VoxCPM2 utiliza isso para a Clonagem Suprema e consegue reproduzir mais do ritmo, emoção e estilo da referência.
4. Abra `/config` em Persona > Voice (Voz), escolha a persona e atribua a amostra salva.

Se nenhuma transcrição for armazenada, o VoxCPM2 ainda executará a clonagem normal por áudio de referência.

O número de 5 a 30 segundos é uma faixa de qualidade documentada, e não um limite aplicado: o VoxCPM2 não aplica nenhum limite próprio de duração da referência, então o teto de upload do TomoriBot é o que impede um clipe mais longo.

## Design de voz pessoal

Para uma persona que deve ser criada a partir de uma descrição de voz escrita em vez de uma amostra:

1. Abra `/config` em Persona > `Voz` e escolha VoiceDesign.
2. Escolha a persona.
3. Insira uma descrição em linguagem natural, como `Young adult woman, soft warm voice, relaxed pace, slightly playful delivery`.

TomoriBot envia a descrição salva como `instruct`. VoxCPM2 o converte em seu prefixo de controle nativo do Voice Design.

Quando uma persona clonada também recebe instruções de voz únicas, VoxCPM2 usa clonagem controlável: a amostra de referência fornece a identidade do locutor enquanto a instrução orienta qualidades como emoção, ritmo ou entrega. Se uma transcrição também for armazenada, a instrução terá precedência porque o caminho Ultimate Cloning upstream não fornece um modo de instrução de controle confiável; a transcrição é omitida intencionalmente para essa solicitação.

## Testando com `/generate voice-message`

Uma vez que VoxCPM2 é o modelo de fala ativo, `/generate voice-message` usa a fonte de voz configurada da persona da mesma forma que as chamadas normais da ferramenta de mensagem de voz:

- clone personas envia o `ref_audio` armazenado e o `ref_text` opcional;
- Personas do VoiceDesign enviam seu prompt salvo como `instruct`;
- endpoints com capacidade de clonagem com Supports Instruct habilitado expõem o campo Delivery Direction e passam instruções únicas por meio de `instruct`;
- quando uma instrução está presente com uma amostra clone, TomoriBot usa apenas `reference_wav_path` e não envia os campos de prompt de transcrição.

## Variáveis de ambiente

| Variável | Padrão | Propósito |
|---|---|---|
| `VOXCPM2_MODEL_ID` | `openbmb/VoxCPM2` | ID do modelo no Hugging Face ou diretório do modelo local |
| `VOXCPM2_DEVICE` | `auto` | Dispositivo de execução: `auto`, `cuda`, `cuda:N`, `cpu` ou `mps` |
| `VOXCPM2_OPTIMIZE` | `1` | Ativa o caminho de otimização/compilação do tempo de execução oficial |
| `VOXCPM2_LOAD_DENOISER` | `0` | Carrega o removedor de ruídos (denoiser) opcional da fonte; desabilitado por padrão para economizar memória |
| `VOXCPM2_CFG_VALUE` | `2.0` | Força de orientação (Guidance strength) |
| `VOXCPM2_INFERENCE_TIMESTEPS` | `10` | Etapas de inferência para correspondência de fluxo (flow-matching); um número maior pode melhorar a qualidade à custa de velocidade |
| `VOXCPM2_MAX_LEN` | `4096` | Comprimento máximo da geração |
| `VOXCPM2_NORMALIZE` | `0` | Ativa a normalização de texto da fonte |
| `VOXCPM2_RETRY_BADCASE` | `1` | Ativa o comportamento de repetição da fonte para gerações anormais |
| `VOXCPM2_RETRY_BADCASE_MAX_TIMES` | `3` | Número máximo de repetições automáticas |
| `VOXCPM2_RETRY_BADCASE_RATIO_THRESHOLD` | `6.0` | Limite de comprimento de caso ruim (bad-case) da fonte |
| `VOXCPM2_PREFETCH` | `1` | Apenas para o instalador: baixar o modelo durante a configuração |
| `VOXCPM2_PORT` | `8016` | Porta do servidor local do VoxCPM2 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Endereço de bind do servidor local; consulte [Acesso de rede](/pt-BR/self-hosting/local-endpoints/text-to-speech/#network-access) |

O áudio de referência deve ser um contêiner WAV não vazio de no máximo 10 MB decodificado, o que o wrapper verifica antes de escrever um arquivo temporário.

## Checkpoints alternativos e tempos de execução

O modelo oficial em BF16 já se encaixa no alvo pretendido de uma GPU de consumidor de 16 GB, portanto o TomoriBot não utiliza um checkpoint quantizado por padrão. Quantizações da comunidade existem, mas elas adicionam outra camada de compatibilidade e manutenção sem serem necessárias para a configuração normal.

Para implantações com alto volume de processamento (high-throughput), a OpenBMB atualmente aponta para o Nano-vLLM-VoxCPM e o vLLM-Omni como opções de serviço aceleradas. Esses tempos de execução podem expor recursos de streaming e atendimento simultâneo (concurrent-serving) além deste servidor de referência. Eles não são exigidos para o fluxo normal de mensagens de voz locais do TomoriBot, e este wrapper deliberadamente se mantém na API oficial `voxcpm` para que as atualizações do modelo da fonte continuem fáceis de acompanhar.
