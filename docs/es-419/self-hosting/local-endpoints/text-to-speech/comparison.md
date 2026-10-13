---
title: "Comparación de motores de texto a voz"
sidebar:
  order: 1
aiGenerated: false
---

TomoriBot admite múltiples servidores locales de texto a voz, cada uno adecuado para diferentes idiomas, perfiles de hardware y requisitos de latencia.

Esta página proporciona resultados de benchmarks empíricos, tiempos de síntesis y clips de comparación de audio grabados en un entorno de prueba idéntico con referencias de clonación de voz coincidentes.

## Clonación de voz multilingüe y en inglés

### Prompts de benchmark

- Prompt estándar *(usado para Chatterbox Standard/Turbo/Nano, MOSS-TTS, CosyVoice 3, VoxCPM2, Qwen3-TTS)*:
  > *"Pain and pleasure are two sides of the same coin. Go on now... flip it. Either way, I'll let you feel all of me."*
- Prompt de Fish Audio S2 Pro *(probado con etiquetas de expresión entre corchetes)*:
  > *"Pain and pleasure are two sides of the same coin. [laughs] Go on now... flip it. [whispers] Either way, I'll let you feel all of me."*

### Rendimiento y comparación de audio

Los tiempos informan tanto el tiempo de generación completo (segundos totales del reloj desde la solicitud hasta el audio terminado) como el Factor de tiempo real (RTF), definido como el tiempo de generación dividido por la duración del audio:

- RTF < 1.0 (negrita): el motor genera voz más rápido que en tiempo real (por ejemplo, `0.50× RTF` renderiza un clip de 10 segundos en 5 segundos). Solo estos motores podrían mantener el ritmo de una llamada de voz en vivo, lo cual TomoriBot no implementa hoy.
- RTF > 1.0: la generación tarda más que el audio hablado. TomoriBot envía cada mensaje de voz como un archivo completo, por lo que un RTF más alto solo significa una espera más larga.

| Motor | Nativo de Windows<sup>(1)</sup><br/>(RTX 4070 Ti SUPER) | Linux / WSL2 | macOS<br/>(Apple Silicon) | Muestra de audio |
|---|---|---|---|---|
| [Fish Audio S2 Pro](/es-419/self-hosting/local-endpoints/text-to-speech/fishs2/) | ~8-10 min<sup>(2)</sup><br/>*(~65× RTF)* | Sin probar | Sin probar | <audio controls preload="none" src="/audio/tts/fish-s2-pro.wav"></audio> |
| [Chatterbox (Turbo, predeterminado)](/es-419/self-hosting/local-endpoints/text-to-speech/chatterbox/) | ~5.0s *(clip de 8.7s)*<br/>0.57× RTF | Sin probar | Sin probar | <audio controls preload="none" src="/audio/tts/chatterbox-turbo.wav"></audio> |
| [Chatterbox (Nano)](/es-419/self-hosting/local-endpoints/text-to-speech/chatterbox/) | ~3.0s *(clip de 8.0s)*<br/>0.38× RTF | Sin probar | Sin probar | <audio controls preload="none" src="/audio/tts/chatterbox-nano.wav"></audio> |
| [Chatterbox (Estándar)](/es-419/self-hosting/local-endpoints/text-to-speech/chatterbox/) | ~6.0s *(clip de 7.8s)*<br/>0.77× RTF | Sin probar | Sin probar | <audio controls preload="none" src="/audio/tts/chatterbox.wav"></audio> |
| [MOSS-TTS](/es-419/self-hosting/local-endpoints/text-to-speech/moss/) | ~12.0s *(clip de 8.8s)*<br/>1.36× RTF | Sin probar | Sin probar | <audio controls preload="none" src="/audio/tts/moss-tts.wav"></audio> |
| [CosyVoice 3](/es-419/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | ~6.0s *(clip de 13.9s)*<br/>0.43× RTF | Sin probar | Sin probar | <audio controls preload="none" src="/audio/tts/cosy-voice-3.wav"></audio> |
| [VoxCPM2](/es-419/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | ~8.0s *(clip de 7.4s)*<br/>1.09× RTF | Sin probar | Sin probar | <audio controls preload="none" src="/audio/tts/voxcpm2.wav"></audio> |
| [Qwen3-TTS](/es-419/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | ~10.0s *(clip de 9.2s)*<br/>1.09× RTF | Sin probar | Sin probar | <audio controls preload="none" src="/audio/tts/qwen3-tts.wav"></audio> |

- <sup>(1)</sup> Entorno de prueba: NVIDIA GeForce RTX 4070 Ti SUPER (16 GB GDDR6X, Ada Lovelace) en Windows 11 (ejecución nativa) usando una muestra de audio de referencia mono de 24 kHz de 26.6 segundos con transcripción literal coincidente.
- <sup>(2)</sup> Fish Audio S2 Pro: la ejecución de Windows se ejecuta en modo entusiasta sin compilar (~65× RTF) debido a la latencia de lanzamiento del kernel CUDA en sus evaluaciones de 76 capas por token. Se recomienda ejecutar en Linux o WSL2 con la fusión del compilador OpenAI Triton (`torch.compile`) para evitar este estancamiento de despacho.

---

## Clonación de voz en japonés

### Prompt de benchmark japonés

> *「そんな顔して……ほんとは私にやられたいんでしょ？ざぁこざぁこ～♡」*

### Rendimiento y comparación de audio en japonés

| Motor | Nativo de Windows<sup>(1)</sup><br/>(RTX 4070 Ti SUPER) | Linux / WSL2 | macOS<br/>(Apple Silicon) | Muestra de audio |
|---|---|---|---|---|
| [IrodoriTTS](/es-419/self-hosting/local-endpoints/text-to-speech/irodoritts/) | ~4.0s *(clip de 8.5s)*<br/>0.47× RTF | Sin probar | Sin probar | <audio controls preload="none" src="/audio/tts/irodori.wav"></audio> |

- <sup>(1)</sup> Medido en el mismo entorno de prueba RTX 4070 Ti SUPER Windows 11.

---

## ¿Qué motor deberías elegir?

- Elige [Fish Audio S2 Pro](/es-419/self-hosting/local-endpoints/text-to-speech/fishs2/) si quieres la mayor fidelidad vocal posible, etiquetas de expresión entre corchetes detalladas (`[whisper]`, `[laughs]`, `[sigh]`), y tienes acceso a Linux o WSL2 donde la fusión del compilador Triton puede habilitarse.
- Elige [Chatterbox (Turbo / Nano / Estándar)](/es-419/self-hosting/local-endpoints/text-to-speech/chatterbox/) para la clonación de voz en inglés con una pequeña huella de VRAM. Nano (~3.0s, 0.38× RTF) proporciona la máxima velocidad en CPU/GPU, Turbo (~5.0s, 0.57× RTF) admite etiquetas de eventos paralingüísticos (`[laughter]`, `[sigh]`), y Estándar (~6.0s, 0.77× RTF) permite una guía CFG creativa y un ajuste de exageración emocional.
- Elige [MOSS-TTS](/es-419/self-hosting/local-endpoints/text-to-speech/moss/) para clonación de voz multimodal experimental y generación de voz en inglés/chino descrita por texto.
- Elige [CosyVoice 3](/es-419/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) si necesitas clonación zero-shot multilingüe de alta calidad con dirección de entrega en lenguaje natural (`"Speak in English with excitement"`).
- Elige [VoxCPM2](/es-419/self-hosting/local-endpoints/text-to-speech/voxcpm2/) si necesitas soporte multilingüe completo (30 idiomas), Clonación Definitiva asistida por transcripción y diseño de voz natural.
- Elige [Qwen3-TTS](/es-419/self-hosting/local-endpoints/text-to-speech/qwen3tts/) si quieres una clonación limpia en varios idiomas con diseño de voz flexible y cumplimiento estable de prompts.
- Elige [IrodoriTTS](/es-419/self-hosting/local-endpoints/text-to-speech/irodoritts/) si tu bot habla japonés. Fue el único motor exclusivo para japonés medido (~4s, 0.47× RTF en Windows) y analiza de forma nativa emojis Unicode (`😊`, `😭`, `😠`) para modular la emoción del personaje.

---

## Compara los motores

Todos los servidores de texto a voz de TomoriBot devuelven actualmente un WAV completo al bot. "Ruta de transmisión" significa que el modelo ascendente o un backend de servicio separado tiene una; no significa que la transmisión de chat de voz de Discord esté implementada. Los tamaños son parámetros del modelo, no tamaños de VRAM o descarga, y la columna de 16 GB es una guía de configuración en lugar de un pico medido. La columna de velocidad describe la compensación prevista de cada motor; los tiempos medidos arriba provienen de una máquina con Windows y no clasifican los motores en Linux.

La columna "Clip de referencia" indica la duración de la referencia de clonación que cada motor documenta o aplica en tiempo de ejecución, así que mezcla orientación publicada con límites leídos del código upstream. La mayoría de los motores recorta en silencio la referencia a su ventana en lugar de rechazar la solicitud, y por eso la columna dice lo que el motor lee, no solo lo que acepta. Es comportamiento upstream, no una medición tomada aquí, y es independiente del límite de subida de TomoriBot.

| Motor | Tamaño del modelo; GPU de 16 GB | Idiomas | Clip de referencia | Fuentes de voz y controles | Velocidad / ruta de transmisión | Elígelo para |
|---|---|---|---|---|---|---|
| [Chatterbox](/es-419/self-hosting/local-endpoints/text-to-speech/chatterbox/) | 350M Turbo (predeterminado), 110M Nano, o 500M Estándar; sí, Nano puede usar CPU | Inglés | 10 segundos; lo más largo se ignora en silencio más allá de la ventana de 10 s del prompt | Clonación de referencia, etiquetas de eventos compatibles; el modelo estándar ofrece CFG/exageración | Enfoque rápido/pequeño; el envoltorio devuelve WAV completo | Configuración de clonación pequeña en inglés o experimentos con CPU |
| [Qwen3-TTS](/es-419/self-hosting/local-endpoints/text-to-speech/qwen3tts/) | 1.7B por modo; sí, los modelos se intercambian | 10, incluyendo inglés/japonés | Desde 3 segundos; sin límite documentado | Clon o Diseño de voz descrito con texto | Enfoque en la calidad; transmisión upstream, el envoltorio almacena en búfer | Clon multilingüe de propósito general y Diseño de voz en japonés |
| [MOSS-TTS](/es-419/self-hosting/local-endpoints/text-to-speech/moss/) | Clon 4B + diseño ~1.7B, intercambiados; 16 GB es un objetivo de prueba, no verificado; insignia de 8B probablemente no | Clon: 31, incluyendo japonés; diseño: inglés/chino | No documentado upstream; sin límite de tiempo de ejecución | Clon o Generador de voz descrito con texto; etiquetas de idioma de clonación | Experimental; el clon local tiene backend de transmisión upstream, el envoltorio almacena en búfer | Comparar la calidad del clon MOSS o el diseño de voz en inglés/chino |
| [IrodoriTTS](/es-419/self-hosting/local-endpoints/text-to-speech/irodoritts/) | ~0.8B Pequeño v4.1 actual; ~3-4 GB VRAM observados en una ejecución local | Solo japonés | ~30 segundos; recortado en el límite de 120 s del punto de control | Clon o Diseño de voz; pistas de estilo emoji | Los pasos de muestreo cambian calidad por velocidad; el envoltorio almacena en búfer | Voces japonesas de huella pequeña y entrega impulsada por emoji |
| [Fish S2 Pro](/es-419/self-hosting/local-endpoints/text-to-speech/fishs2/) | 4B; predeterminado oficial BF16 (~16-18 GB), INT8 opcional para 16 GB | 83 afirmados upstream | 10-30 segundos; sin límite de tiempo de ejecución | Clonación de referencia (requiere transcripción de referencia), etiquetas de expresión entre corchetes de forma libre | Modelo Dual-AR pesado; requiere Linux/WSL2 con Triton para síntesis rápida (~65× RTF en modo entusiasta en Windows) | Clonación expresiva de grano fino; verifica los términos de la licencia de investigación |
| [VoxCPM2](/es-419/self-hosting/local-endpoints/text-to-speech/voxcpm2/) | 2B; ~8 GB BF16 reportados upstream | 30 | 5-30 segundos; rango documentado, sin límite de tiempo de ejecución | Clon, Diseño de voz, Clonación Definitiva asistida por transcripción, instrucciones de entrega | ~0.30 RTF en RTX 4090 upstream; transmisión upstream, el envoltorio almacena en búfer | Un modelo multilingüe con los controles de fuente de voz más amplios |
| [CosyVoice 3](/es-419/self-hosting/local-endpoints/text-to-speech/cosyvoice3/) | Núcleo de 0.5B; 16 GB cómodos, descarga/tiempo de ejecución mayor | 9, incluyendo japonés, más dialectos chinos | 3-30 segundos: lo más largo se recorta a los primeros 30 s | Clon, clon translingüe, entrega en lenguaje natural | Enfoque de baja latencia; transmisión nativa de texto/audio upstream, el envoltorio almacena en búfer | Un futuro candidato de transmisión con clonación translingüe |

El tamaño del modelo y los recuentos de idiomas siguen las páginas upstream de [Chatterbox](https://github.com/resemble-ai/chatterbox), [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS), [MOSS](https://github.com/OpenMOSS/MOSS-TTS), [Irodori](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small), [Fish S2 Pro](https://huggingface.co/fishaudio/s2-pro), [VoxCPM2](https://huggingface.co/openbmb/VoxCPM2), y [CosyVoice 3](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512). Revisa cada guía para detalles de sistema operativo, controlador, licencia, revisión del modelo y memoria. Una GPU de 16 GB no puede alojar necesariamente un modelo de texto a voz y un LLM local grande simultáneamente.

La cifra de VRAM de Irodori es una sola observación local, no un mínimo publicado o un benchmark entre motores. El uso de la memoria varía con el tiempo de ejecución, la precisión, la longitud del guion y otras cargas de trabajo de la GPU.

La primera solicitud automática de Qwen3-TTS incluye la carga del modelo. MOSS descarga previamente ambos modelos durante la configuración y calienta el modelo de clonación al inicio de forma predeterminada, pero cualquier servidor automático aún tiene que cargar el otro modelo después de un cambio de modo. TomoriBot espera hasta `TTS_SYNTHESIZE_TIMEOUT_MS` (predeterminado 240000 ms) por cada respuesta completa.
