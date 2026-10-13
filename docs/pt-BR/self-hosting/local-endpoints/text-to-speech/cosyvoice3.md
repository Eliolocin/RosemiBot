---
title: "CosyVoice 3"
aiGenerated: true
---

Sintetize vozes naturais e multilíngues de personagens com entrega emocional baseada em instruções usando [CosyVoice 3](https://github.com/QwenAudio/CosyVoice) do Alibaba.

CosyVoice 3 oferece clonagem de voz multilíngue e de disparo zero em 9 idiomas e mais de 18 dialetos chineses. TomoriBot envolve o tempo de execução oficial em `servers/tts/cosyvoice3/` para expor a interface de fala `POST /synthesize` padrão. O instalador incluído é padronizado para o modelo oficial não quantizado `FunAudioLLM/Fun-CosyVoice3-0.5B-2512`, rodando em 16 GB de VRAM.

## O que ele suporta

A versão atual do CosyVoice 3 suporta:

- Chinês, inglês, japonês, coreano, alemão, espanhol, francês, italiano e russo
- Mais de 18 dialetos e sotaques chineses
- clonagem de voz zero-shot
- clonagem de voz multilíngue e multilíngue
- instruções em linguagem natural para idioma, dialeto, emoção, velocidade de fala e volume
- controles refinados no tempo de execução upstream, incluindo `[breath]` e `[laughter]`
- streaming de entrada de texto e saída de áudio no tempo de execução upstream

Os exemplos oficiais do CosyVoice 3 incluem uma ressalva em japonês: o texto em japonês é mostrado após a conversão para katakana. O japonês é um idioma suportado, mas se a ortografia japonesa normal produzir uma pronúncia ruim, a conversão do texto de síntese em katakana é a solução alternativa recomendada pelo autor.

## Como o TomoriBot mapeia as solicitações

O wrapper aceita os campos `tts-clone` padrão:

- `text`
- `ref_audio`
- `ref_text`
- `instruct`
- `language`

Ele roteia solicitações para funções de inferência CosyVoice 3 da seguinte forma:

| Solicitar | CosyVoice 3 caminho |
|---|---|
| Áudio de referência + transcrição | `inference_zero_shot` |
| Áudio de referência sem transcrição | `inference_cross_lingual` |
| `instruct` ou `language` explícito | `inference_instruct2` |

Para obter a melhor qualidade de clonagem, forneça o áudio de referência e a transcrição correspondente. A instrução atual API do CosyVoice 3 condiciona o áudio de referência sem aceitar transcrições de referência, portanto, as solicitações contendo `instruct` mudam para o caminho `inference_instruct2` oficial.

### Controles de estilo e emoção

Registre o endpoint com a marcação `Simples`. A direção de entrega pertence ao campo `voice_instructions` global do terminal. Tags de colchetes arbitrários em linha são evitadas porque correm o risco de instruções contraditórias, como `[happy] Hello. [sad] Goodbye.`. As tags nativas `[breath]` e `[laughter]` são adiadas até que TomoriBot suporte a descoberta de tags específicas do mecanismo.

O campo `/synthesize` `instruct` é passado para o condicionamento de instruções do CosyVoice 3. Os exemplos incluem `sound relieved but still tired`, `speak as quickly as possible` ou `speak quietly with restrained excitement`.

## Streaming

CosyVoice 3 suporta streaming bidirecional upstream. Os benchmarks upstream relatam streaming de entrada de texto e saída de áudio com latência de áudio inicial em torno de 150 ms em configurações otimizadas.

A interface de voz do TomoriBot espera uma única resposta de áudio completa para mensagens de voz Discord, portanto, o wrapper retorna um arquivo WAV completo e padroniza a inferência upstream para `stream=False`. Defina `COSYVOICE3_UPSTREAM_STREAM=1` apenas ao avaliar diretamente o comportamento de streaming upstream; isso não altera a latência TomoriBot.

## Hardware

Hardware recomendado:

- GPU NVIDIA com 16 GB de VRAM
- Pitão 3.10
- Driver NVIDIA compatível com CUDA 12
- `git`
- `ffmpeg` para normalização de amostra de voz
- `sox` e `libsox-dev` no Linux se ocorrerem problemas de compatibilidade de áudio

O modelo de parâmetro de 0,5B cabe facilmente em VRAM de 16 GB sem quantização. O download do ponto de verificação inclui modelos de fluxo, tokenizadores de fala, modelos de texto e pesos de aprendizado por reforço, exigindo aproximadamente 10 GB de espaço em disco, além de dependências Python.

Embora a inferência da CPU seja tecnicamente suportada no upstream, ela é muito lenta para interações de voz Discord.

## Instalação

### Linux e WSL2 (recomendado)

Na raiz do repositório TomoriBot:

```bash
bash servers/tts/cosyvoice3/install-cosyvoice3.sh
servers/tts/cosyvoice3/.venv/bin/python servers/tts/cosyvoice3/server.py
```

Ou inicie o servidor configurado e TomoriBot juntos:

```bash
bun run launch --cosyvoice3
```

O instalador:

1. verifica `QwenAudio/CosyVoice` commit `074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc` recursivamente em `servers/tts/cosyvoice3/CosyVoice/`;
2. cria `servers/tts/cosyvoice3/.venv`;
3. instala requisitos de upstream CosyVoice e dependências de wrapper; e
4. baixa `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` na revisão Hugging Face `29e01c4e8d000f4bcd70751be16fa94bf3d85a18` para `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B/`.

A nova execução do script mantém essas revisões fixadas. O instalador se recusa a substituir checkouts por alterações locais não confirmadas.

Os requisitos upstream instalam PyTorch 2.3.1 com pacotes CUDA 12.1, pacotes CUDA 12 ONNX Runtime no Linux e pacotes TensorRT 10.13 no Linux. Se sua GPU exigir uma versão PyTorch mais recente, instale uma versão PyTorch compatível dentro do ambiente virtual após a conclusão da configuração.

### Windows PowerShell

O Windows nativo é fornecido como o caminho de melhor esforço:

```powershell
.\servers\tts\cosyvoice3\install-cosyvoice3.ps1
.\servers\tts\cosyvoice3\.venv\Scripts\python.exe servers\tts\cosyvoice3\server.py
```

WSL2 é fortemente recomendado para uso de GPU NVIDIA no Windows. Os requisitos upstream instalam o ONNX Runtime somente CPU no Windows, enquanto Linux e WSL2 instalam pacotes acelerados por GPU.

## Registrar no TomoriBot

Execute `/providers`, escolha `Adicionar Novo Endpoint Personalizado` (Adicionar Novo Endpoint Personalizado) e configure o endpoint de fala:

- Capability: `Speech`
- API Compatibility: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8017`
- Modo de Fonte de Voz: `Clone`
- Script Markup: `Plain`
- Supports Instruct: `Yes`

Após salvar a conexão, selecione-a e adicione um modelo (model) de Speech. Um código de modelo claro é `Fun-CosyVoice3-0.5B-2512`.

Em seguida, abra `/config` > Models > Switch Models e ative o endpoint de fala do CosyVoice 3.

## Atribuir uma voz de persona

Para clonagem de voz zero-shot:

1. Prepare um clipe de áudio limpo de 3 a 30 segundos com um alto-falante e ruído de fundo mínimo.
2. Abra `/config` em Modelos > `Parâmetros TTS e Vozes` e carregue a amostra.
3. Insira a transcrição correspondente quando disponível. CosyVoice 3 tokeniza esta transcrição como um prefixo de prompt para clonagem zero-shot; deve descrever os primeiros 30 segundos do áudio.
4. Abra `/config` em Persona > `Voz` e atribua a amostra à persona.

CosyVoice impõe uma janela de prompt de 30 segundos. Embora o mecanismo upstream gere um erro quando o áudio excede 30 segundos, o wrapper do TomoriBot corta os clipes para os primeiros 30 segundos automaticamente e registra o corte no console.

As incorporações de alto-falante e os tokens de fala de prompt são calculados a partir dos 30 segundos iniciais, portanto, clipes com mais de 30 segundos não adicionam detalhes de voz. Usar um clipe limpo entre 10 e 20 segundos garante um alinhamento preciso e imediato.

A clonagem multilíngue é suportada: o locutor de referência pode falar um idioma diferente do texto gerado. Se nenhuma transcrição de referência for fornecida, o wrapper roteia as solicitações para o caminho do mecanismo multilíngue dedicado do CosyVoice 3.

## Testar com `/generate voice-message`

Use `/generate voice-message` para testar a síntese sem esperar por um acionador de bate-papo automatizado. Você pode testar com a amostra atribuída à persona ou enviar um clipe único com sua transcrição.

Para orientar a emoção e a entrega, insira a direção no modal ou deixe o prompt da persona fornecer `voice_instructions`. Mantenha o texto falado como um diálogo simples; tags de estilo inline são removidas antes da síntese.

## Variáveis de ambiente

| Variável | Padrão | Propósito |
|---|---|---|
| `COSYVOICE3_MODEL_DIR` | `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B` | Diretório de ponto de verificação local |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Endereço de ligação do wrapper; consulte [Acesso à rede](/pt-BR/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `COSYVOICE3_PORT` | `8017` | Porta do wrapper |
| `COSYVOICE3_UPSTREAM_STREAM` | `0` | Habilite o gerador de streaming interno do CosyVoice |
| `COSYVOICE3_SPEED` | `1.0` | Multiplicador de velocidade numérica global passado para inferência upstream |
| `COSYVOICE3_DEFAULT_INSTRUCT` | vazia | Instrução opcional adicionada quando uma solicitação não fornece uma |
| `COSYVOICE3_FP16` | `0` | Peça ao tempo de execução oficial para usar o modo fp16 |
| `COSYVOICE3_LOAD_TRT` | `0` | Habilite o carregamento upstream do TensorRT quando preparado adequadamente |
| `COSYVOICE3_LOAD_VLLM` | `0` | Habilite o carregamento upstream do vLLM quando suas dependências separadas estiverem instaladas |

Por padrão, TensorRT, vLLM e fp16 permanecem desativados. O tempo de execução padrão do PyTorch funciona confortavelmente em GPUs de 16 GB sem dependências adicionais de tempo de execução.

## Desempenho e variantes do modelo

### Padrão: base `Fun-CosyVoice3-0.5B-2512`

Este é o padrão recomendado para TomoriBot. Ele fornece alta similaridade de alto-falantes, suporta todos os modos de clonagem e instrução CosyVoice 3 e não requer quantização em GPUs de 16 GB.

### Pesos de aprendizagem por reforço

O pacote de checkpoint inclui `llm.rl.pt` junto com pesos básicos. Os pesos RL reduzem as taxas de erro de conteúdo, enquanto os pesos básicos pontuam um pouco mais em benchmarks de similaridade de alto-falantes. Como a fidelidade de voz pessoal é priorizada, o padrão do wrapper é `llm.pt`.

O carregador upstream espera `llm.pt`. Para testar os pesos RL sem modificar os arquivos padrão, duplique o diretório do modelo, renomeie `llm.rl.pt` para `llm.pt` dentro da cópia e defina `COSYVOICE3_MODEL_DIR` para a pasta copiada.

### vLLM e TensorRT

CosyVoice 3 oferece suporte a tempos de execução vLLM e TensorRT opcionais. Documentos upstream vLLM 0.11.x+ com o mecanismo V1 e vLLM 0.9.0 como legado. Como essas bibliotecas introduzem requisitos rígidos de CUDA e de versão de dependência, TomoriBot não as instala por padrão.

## Licença

A base de código CosyVoice e os pesos `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` são publicados sob a licença Apache-2.0.

O cartão modelo upstream indica que os materiais de demonstração são para avaliação acadêmica. TomoriBot não distribui pesos de modelo. Revise o licenciamento e os termos upstream para seu caso de uso específico antes de implantar comercialmente.
