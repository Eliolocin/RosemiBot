---
title: "Comparação de Motores TTS"
sidebar:
  order: 1
aiGenerated: false
---

O TomoriBot suporta vários servidores locais de Text-to-Speech, cada um adequado a diferentes idiomas, perfis de hardware e requisitos de latência.

Esta página traz resultados empíricos de benchmark, tempos de síntese e clipes de áudio para comparação, gravados em um ambiente de teste idêntico com as mesmas referências de clonagem de voz.

## Clonagem de Voz Multilíngue e em Inglês

### Prompts do Benchmark

- Prompt padrão *(usado para Chatterbox Standard/Turbo/Nano, MOSS-TTS, CosyVoice 3, VoxCPM2 e Qwen3-TTS)*:
  > *"Pain and pleasure are two sides of the same coin. Go on now... flip it. Either way, I'll let you feel all of me."*
- Prompt do Fish Audio S2 Pro *(testado com tags de expressão entre colchetes)*:
  > *"Pain and pleasure are two sides of the same coin. [laughs] Go on now... flip it. [whispers] Either way, I'll let you feel all of me."*

### Desempenho e Comparação de Áudio

Os tempos informam o tempo total de geração (segundos de relógio desde a requisição até o áudio pronto) e o Real-Time Factor (RTF), definido como o tempo de geração dividido pela duração do áudio:

- RTF < 1.0 (negrito): o motor gera a fala mais rápido que o tempo real (por exemplo, `0.50× RTF` renderiza um clipe de 10 segundos em 5 segundos). Só esses motores conseguiriam acompanhar uma chamada de voz ao vivo, que o TomoriBot não implementa hoje.
- RTF > 1.0: a geração demora mais que o áudio falado. O TomoriBot envia cada mensagem de voz como um arquivo completo, então um RTF maior significa apenas uma espera mais longa.

| Motor | Windows nativo<sup>(1)</sup><br/>(RTX 4070 Ti SUPER) | Linux / WSL2 | macOS<br/>(Apple Silicon) | Amostra de áudio |
|---|---|---|---|---|
| [Fish Audio S2 Pro](/pt-BR/self-hosting/local-endpoints/text-to-speech/fishs2/) | ~8-10 min<sup>(2)</sup><br/>*(~65× RTF)* | Não testado | Não testado | <audio controls preload="none" src="/audio/tts/fish-s2-pro.wav"></audio> |
| [Chatterbox (Turbo, padrão)](/pt-BR/self-hosting/local-endpoints/text-to-speech/chatterbox/) | ~5.0s *(clipe de 8.7s)*<br/>0.57× RTF | Não testado | Não testado | <audio controls preload="none" src="/audio/tts/chatterbox-turbo.wav"></audio> |
| [Chatterbox (Nano)](/pt-BR/self-hosting/local-endpoints/text-to-speech/chatterbox/) | ~3.0s *(clipe de 8.0s)*<br/>0.38× RTF | Não testado | Não testado | <audio controls preload="none" src="/audio/tts/chatterbox-nano.wav"></audio> |
| [Chatterbox (Standard)](/pt-BR/self-hosting/local-endpoints/text-to-speech/chatterbox/) | ~6.0s *(clipe de 7.8s)*<br/>0.77× RTF | Não testado | Não testado | <audio controls preload="none" src="/audio/tts/chatterbox.wav"></audio> |
| [MOSS-TTS](/pt-BR/self-hosting/local-endpoints/text-to-speech/moss/) | ~12.0s *(clipe de 8.8s)*<br/>1.36× RTF | Não testado | Não testado | <audio controls preload="none" src="/audio/tts/moss-tts.wav"></audio> |
| [CosyVoice 3](/pt-BR/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | ~6.0s *(clipe de 13.9s)*<br/>0.43× RTF | Não testado | Não testado | <audio controls preload="none" src="/audio/tts/cosy-voice-3.wav"></audio> |
| [VoxCPM2](/pt-BR/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | ~8.0s *(clipe de 7.4s)*<br/>1.09× RTF | Não testado | Não testado | <audio controls preload="none" src="/audio/tts/voxcpm2.wav"></audio> |
| [Qwen3-TTS](/pt-BR/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | ~10.0s *(clipe de 9.2s)*<br/>1.09× RTF | Não testado | Não testado | <audio controls preload="none" src="/audio/tts/qwen3-tts.wav"></audio> |

- <sup>(1)</sup> Ambiente de teste: NVIDIA GeForce RTX 4070 Ti SUPER (16 GB GDDR6X, Ada Lovelace) no Windows 11 (execução nativa), usando uma amostra de áudio de referência mono de 24 kHz com 26.6 segundos e transcrição literal correspondente.
- <sup>(2)</sup> Fish Audio S2 Pro: no Windows, a execução roda em modo eager não compilado (~65× RTF) por causa da latência de lançamento de kernels CUDA ao longo das suas 76 avaliações de camada por token. Recomenda-se executar no Linux ou WSL2 com a fusão do compilador OpenAI Triton (`torch.compile`) para evitar esse travamento de despacho.

---

## Clonagem de Voz em Japonês

### Prompt do Benchmark em Japonês

> *「そんな顔して……ほんとは私にやられたいんでしょ？ざぁこざぁこ～♡」*

### Desempenho e Comparação de Áudio em Japonês

| Motor | Windows nativo<sup>(1)</sup><br/>(RTX 4070 Ti SUPER) | Linux / WSL2 | macOS<br/>(Apple Silicon) | Amostra de áudio |
|---|---|---|---|---|
| [IrodoriTTS](/pt-BR/self-hosting/local-endpoints/text-to-speech/irodoritts/) | ~4.0s *(clipe de 8.5s)*<br/>0.47× RTF | Não testado | Não testado | <audio controls preload="none" src="/audio/tts/irodori.wav"></audio> |

- <sup>(1)</sup> Medido no mesmo ambiente de teste com RTX 4070 Ti SUPER e Windows 11.

---

## Qual Motor Escolher?

- Escolha o [Fish Audio S2 Pro](/pt-BR/self-hosting/local-endpoints/text-to-speech/fishs2/) se você quer a maior fidelidade vocal possível, tags de expressão refinadas entre colchetes (`[whisper]`, `[laughs]`, `[sigh]`) e tem acesso a Linux ou WSL2, onde a fusão do compilador Triton pode ser ativada.
- Escolha o [Chatterbox (Turbo / Nano / Standard)](/pt-BR/self-hosting/local-endpoints/text-to-speech/chatterbox/) para clonagem de voz em inglês com pouco uso de VRAM. O Nano (~3.0s, 0.38× RTF) oferece a maior velocidade em CPU/GPU, o Turbo (~5.0s, 0.57× RTF) suporta tags de evento paralinguísticas (`[laughter]`, `[sigh]`) e o Standard (~6.0s, 0.77× RTF) permite ajuste criativo de orientação CFG e de exagero emocional.
- Escolha o [MOSS-TTS](/pt-BR/self-hosting/local-endpoints/text-to-speech/moss/) para clonagem de voz multimodal experimental e geração de voz descrita por texto em inglês/chinês.
- Escolha o [CosyVoice 3](/pt-BR/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) se você precisa de clonagem zero-shot multilíngue de alta qualidade com direção de entrega em linguagem natural (`"Speak in English with excitement"`).
- Escolha o [VoxCPM2](/pt-BR/self-hosting/local-endpoints/text-to-speech/voxcpm2/) se você precisa de suporte multilíngue abrangente (30 idiomas), Ultimate Cloning assistida por transcrição e design de voz natural.
- Escolha o [Qwen3-TTS](/pt-BR/self-hosting/local-endpoints/text-to-speech/qwen3tts/) se você quer clonagem limpa em vários idiomas, com design de voz flexível e boa aderência ao prompt.
- Escolha o [IrodoriTTS](/pt-BR/self-hosting/local-endpoints/text-to-speech/irodoritts/) se o seu bot fala japonês. Foi o único motor exclusivo para japonês medido (~4s, 0.47× RTF no Windows) e interpreta nativamente emojis Unicode (`😊`, `😭`, `😠`) para modular a emoção da personagem.

---

## Compare os Motores

Todos os servidores TTS do TomoriBot atualmente retornam um WAV completo para o bot. "Caminho de streaming" significa que o modelo upstream ou um backend de serviço separado tem um; isso não significa que o streaming de chat de voz do Discord está implementado. Os tamanhos são parâmetros de modelo, não tamanhos de VRAM ou de download, e a coluna de 16 GB é uma orientação de configuração, não um pico medido. A coluna de velocidade descreve a troca pretendida de cada motor; os tempos medidos acima vêm de uma única máquina Windows e não classificam os motores no Linux.

A coluna "Clipe de referência" informa o comprimento da referência de clonagem que cada motor documenta ou aplica no runtime, então ela mistura orientação publicada com limites lidos do código upstream. A maioria dos motores corta silenciosamente a referência para caber na própria janela em vez de recusar a requisição, e é por isso que a coluna indica o que o motor lê, não apenas o que ele aceita. É comportamento upstream, não uma medição feita aqui, e é independente do limite de upload do TomoriBot.

| Motor | Tamanho do modelo; GPU de 16 GB | Idiomas | Clipe de referência | Fontes de voz e controles | Velocidade / caminho de streaming | Escolha para |
|---|---|---|---|---|---|---|
| [Chatterbox](/pt-BR/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 350M Turbo (padrão), 110M Nano ou 500M Standard; sim, o Nano pode usar CPU | Inglês | 10 segundos; trechos mais longos são ignorados silenciosamente além da janela de 10 s do prompt | Clonagem por referência, tags de evento suportadas; o modelo Standard oferece CFG/exagero | Foco em rapidez e tamanho pequeno; o wrapper retorna o WAV completo | Configuração pequena de clone em inglês ou experimentos com CPU |
| [Qwen3-TTS](/pt-BR/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | 1.7B por modo; sim, os modelos são trocados | 10, incluindo inglês/japonês | A partir de 3 segundos; nenhum limite documentado | Clone ou VoiceDesign descrito por texto | Focado em qualidade; streaming upstream, o wrapper faz buffer | Clone multilíngue de uso geral e VoiceDesign em japonês |
| [MOSS-TTS](/pt-BR/self-hosting/local-endpoints/text-to-speech/moss/) | 4B clone + ~1.7B design, trocados; 16 GB é um alvo de teste, não verificado; o flagship de 8B provavelmente não | Clone: 31, incluindo japonês; design: inglês/chinês | Não documentado upstream; sem limite de runtime | Clone ou VoiceGenerator descrito por texto; tags de idioma no clone | Experimental; o clone Local tem backend de streaming upstream, o wrapper faz buffer | Comparar a qualidade de clone do MOSS ou design de voz em inglês/chinês |
| [IrodoriTTS](/pt-BR/self-hosting/local-endpoints/text-to-speech/irodoritts/) | ~0.8B na v4.1 Small atual; ~3-4 GB de VRAM observados em uma execução local | Apenas japonês | ~30 segundos; cortado no limite de 120 s do checkpoint | Clone ou VoiceDesign; dicas de estilo por emoji | Passos de amostragem trocam qualidade por velocidade; o wrapper faz buffer | Vozes japonesas leves e entrega guiada por emoji |
| [Fish S2 Pro](/pt-BR/self-hosting/local-endpoints/text-to-speech/fishs2/) | 4B; BF16 oficial por padrão (~16-18 GB), INT8 opcional para 16 GB | 83 declarados upstream | 10-30 segundos; sem limite de runtime | Clonagem por referência (exige transcrição de referência), tags de expressão livres entre colchetes | Modelo Dual-AR pesado; exige Linux/WSL2 com Triton para síntese rápida (~65× RTF no modo eager do Windows) | Clonagem expressiva refinada; verifique os termos da licença de pesquisa |
| [VoxCPM2](/pt-BR/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | 2B; ~8 GB em BF16 relatados upstream | 30 | 5-30 segundos; faixa documentada, sem limite de runtime | Clone, Voice Design, Ultimate Cloning assistida por transcrição, instruções de entrega | ~0.30 RTF em RTX 4090 upstream; streaming upstream, o wrapper faz buffer | Um único modelo multilíngue com os controles de fonte de voz mais amplos |
| [CosyVoice 3](/pt-BR/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | 0.5B no núcleo; 16 GB com folga, download/runtime maiores | 9, incluindo japonês, mais dialetos chineses | 3-30 segundos: trechos mais longos são cortados para os primeiros 30 s | Clone, clone interlinguístico, entrega em linguagem natural | Foco em baixa latência; streaming nativo de texto/áudio upstream, o wrapper faz buffer | Um futuro candidato a streaming com clonagem interlinguística |

Os tamanhos dos modelos e as contagens de idiomas seguem as páginas upstream de [Chatterbox](https://github.com/resemble-ai/chatterbox), [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS), [MOSS](https://github.com/OpenMOSS/MOSS-TTS), [Irodori](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small), [Fish S2 Pro](https://huggingface.co/fishaudio/s2-pro), [VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) e [CosyVoice 3](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512). Consulte cada guia para detalhes de SO, driver, licença, revisão do modelo e memória. Uma GPU de 16 GB não necessariamente comporta um modelo TTS e um LLM local grande ao mesmo tempo.

O valor de VRAM do Irodori é uma única observação local, não um mínimo publicado nem um benchmark entre motores. O uso de memória varia com o runtime, a precisão, o tamanho do script e outras cargas de trabalho da GPU.

A primeira requisição automática do Qwen3-TTS inclui o carregamento do modelo. O MOSS baixa os dois modelos durante a configuração e aquece o modelo de clone na inicialização por padrão, mas qualquer um dos servidores automáticos ainda precisa carregar o outro modelo após uma troca de modo. O TomoriBot espera até `TTS_SYNTHESIZE_TIMEOUT_MS` (padrão 240000 ms) por cada resposta completa.
