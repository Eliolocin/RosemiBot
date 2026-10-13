---
title: "CosyVoice 3"
aiGenerated: true
---

Sintetiza voces de personajes naturales y multilingües con entrega emocional basada en instrucciones utilizando [CosyVoice 3](https://github.com/QwenAudio/CosyVoice) de Alibaba.

CosyVoice 3 proporciona clonación de voz multilingüe y sin disparos en 9 idiomas y más de 18 dialectos chinos. TomoriBot incluye el tiempo de ejecución oficial en `servers/tts/cosyvoice3/` para exponer la interfaz de voz estándar `POST /synthesize`. El instalador incluido utiliza de forma predeterminada el modelo oficial no cuantificado `FunAudioLLM/Fun-CosyVoice3-0.5B-2512`, que se ejecuta con 16 GB de VRAM.

## Qué admite

La versión actual CosyVoice 3 admite:

- Chino, inglés, japonés, coreano, alemán, español, francés, italiano y ruso
- Más de 18 dialectos y acentos chinos
- clonación de voz de disparo cero
- clonación de voz multilingüe y entre idiomas
- Instrucciones en lenguaje natural para lenguaje, dialecto, emoción, velocidad de habla y volumen.
- controles detallados en el tiempo de ejecución ascendente, incluidos `[breath]` y `[laughter]`
- transmisión de entrada de texto y salida de audio en el tiempo de ejecución ascendente

Los ejemplos oficiales de CosyVoice 3 incluyen una advertencia en japonés: el texto en japonés se muestra después de la conversión a katakana. El japonés es un idioma admitido, pero si la ortografía japonesa normal produce una pronunciación deficiente, la solución alternativa recomendada por los desarrolladores es convertir el texto de síntesis a katakana.

## Cómo asigna las solicitudes TomoriBot

El contenedor acepta los campos estándar `tts-clone`:

- `text`
- `ref_audio`
- `ref_text`
- `instruct`
- `language`

Enruta solicitudes a funciones de inferencia CosyVoice 3 de la siguiente manera:

| Pedido | CosyVoice 3 camino |
|---|---|
| Audio de referencia + transcripción | `inference_zero_shot` |
| Audio de referencia sin transcripción. | `inference_cross_lingual` |
| `instruct` o `language` explícito | `inference_instruct2` |

Para obtener la mejor calidad de clonación, proporcione tanto el audio de referencia como su transcripción correspondiente. La instrucción actual API de CosyVoice 3 condiciona el audio de referencia sin aceptar transcripciones de referencia, por lo que las solicitudes que contienen `instruct` cambian a la ruta oficial `inference_instruct2`.

### Estilo y controles de emoción

Registre el punto final con el marcado `Plano`. La dirección de entrega pertenece al campo global `voice_instructions` del terminal. Se evitan etiquetas de corchetes arbitrarias en línea porque corren el riesgo de instrucciones contradictorias, como `[happy] Hello. [sad] Goodbye.`. Las etiquetas nativas `[breath]` y `[laughter]` se difieren hasta que TomoriBot admita la detección de etiquetas específicas del motor.

El campo `/synthesize` `instruct` se pasa al condicionamiento de instrucciones de CosyVoice 3. Los ejemplos incluyen `sound relieved but still tired`, `speak as quickly as possible` o `speak quietly with restrained excitement`.

## Transmisión

CosyVoice 3 admite transmisión bidireccional ascendente. Los puntos de referencia ascendentes informan transmisión de entrada de texto y salida de audio con una latencia de audio inicial de alrededor de 150 ms en configuraciones optimizadas.

La interfaz de voz de TomoriBot espera una única respuesta de audio completa para los mensajes de voz de Discord, por lo que el contenedor devuelve un archivo WAV completo y establece de forma predeterminada la inferencia ascendente en `stream=False`. Configura `COSYVOICE3_UPSTREAM_STREAM=1` solo cuando compare directamente el comportamiento de transmisión ascendente; no cambia la latencia de TomoriBot.

## Hardware

Hardware recomendado:

- GPU NVIDIA con 16 GB de VRAM
- Pitón 3.10
- Controlador NVIDIA compatible con CUDA 12
- `git`
- `ffmpeg` para normalización de muestras de voz
- `sox` y `libsox-dev` en Linux si ocurren problemas de compatibilidad de audio

El modelo de parámetros de 0,5 B cabe fácilmente en 16 GB de VRAM sin cuantificación. La descarga del punto de control incluye modelos de flujo, tokenizadores de voz, modelos de texto y pesos de aprendizaje por refuerzo, lo que requiere aproximadamente 10 GB de espacio en disco más dependencias de Python.

Si bien la inferencia de CPU es técnicamente compatible en sentido ascendente, es demasiado lenta para las interacciones de voz Discord.

## Instalación

### Linux y WSL2 (recomendado)

Desde la raíz del repositorio TomoriBot:

```bash
bash servers/tts/cosyvoice3/install-cosyvoice3.sh
servers/tts/cosyvoice3/.venv/bin/python servers/tts/cosyvoice3/server.py
```

O inicie el servidor configurado y TomoriBot juntos:

```bash
bun run launch --cosyvoice3
```

El instalador:

1. comprueba que `QwenAudio/CosyVoice` confirme `074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc` de forma recursiva en `servers/tts/cosyvoice3/CosyVoice/`;
2. crea `servers/tts/cosyvoice3/.venv`;
3. instala requisitos de CosyVoice ascendentes y dependencias de contenedor; y
4. descarga `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` en la revisión de Hugging Face `29e01c4e8d000f4bcd70751be16fa94bf3d85a18` en `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B/`.

Al volver a ejecutar el script se mantienen estas revisiones fijadas. El instalador se niega a sobrescribir los pagos con cambios locales no confirmados.

Los requisitos ascendentes instalan PyTorch 2.3.1 con paquetes CUDA 12.1, paquetes CUDA 12 ONNX Runtime en Linux y paquetes TensorRT 10.13 en Linux. Si su GPU requiere una compilación de PyTorch más nueva, instale una compilación de PyTorch compatible dentro del entorno virtual una vez completada la instalación.

### Windows PowerShell

Windows nativo se proporciona como la mejor opción:

```powershell
.\servers\tts\cosyvoice3\install-cosyvoice3.ps1
.\servers\tts\cosyvoice3\.venv\Scripts\python.exe servers\tts\cosyvoice3\server.py
```

Se recomienda encarecidamente WSL2 para el uso de GPU NVIDIA en Windows. Los requisitos ascendentes instalan ONNX Runtime solo para CPU en Windows, mientras que Linux y WSL2 instalan paquetes acelerados por GPU.

## Registro en TomoriBot

Ejecuta `/providers`, elige `Agregar nuevo punto de conexión personalizado`, y configura el endpoint de voz:

- Capacidad: `Speech`
- Compatibilidad de API: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8017`
- Modo de fuente de voz: `Clone`
- Estilo de marcado del guion: `Plain`
- Compatibilidad con instrucciones: `Yes`

Después de guardar la conexión, selecciónala y agrega un modelo de Voz. Un código de modelo claro es `Fun-CosyVoice3-0.5B-2512`.

Luego abre `/config` > Modelos > `Cambiar modelos` y activa el endpoint de voz de CosyVoice 3.

## Asignación de una voz de persona

Para clonación de voz cero:

1. Prepare un clip de audio limpio de 3 a 30 segundos con un altavoz y un mínimo de ruido de fondo.
2. Abre `/config` en Modelos > `Parámetros y voces TTS` y cargue la muestra.
3. Ingresa la transcripción correspondiente cuando esté disponible. CosyVoice 3 tokeniza esta transcripción como un prefijo de aviso para la clonación de disparo cero; debe describir los primeros 30 segundos del audio.
4. Abre `/config` en Persona > `Voz` y asigne la muestra a la persona.

CosyVoice impone una ventana de aviso de 30 segundos. Mientras que el motor ascendente genera un error cuando el audio excede los 30 segundos, el contenedor de TomoriBot recorta los clips a sus primeros 30 segundos automáticamente y registra el recorte en la consola.

Las incrustaciones de oradores y los tokens de voz rápida se calculan a partir de los primeros 30 segundos, por lo que los clips de más de 30 segundos no agregan detalles de voz. El uso de un clip limpio entre 10 y 20 segundos garantiza una alineación rápida y precisa.

Se admite la clonación multilingüe: el hablante de referencia puede hablar un idioma diferente al del texto generado. Si no se proporciona una transcripción de referencia, el contenedor enruta las solicitudes a la ruta del motor multilingüe dedicada de CosyVoice 3.

## Prueba con `/generate voice-message`

Utilice `/generate voice-message` para probar la síntesis sin esperar a que se active el chat automatizado. Puedes realizar la prueba con la muestra asignada a la persona o cargar un clip único con su transcripción.

Para guiar la emoción y la entrega, ingrese la dirección en el modal o deje que la persona indique `voice_instructions`. Mantén el texto hablado como un diálogo sencillo; Las etiquetas de estilo en línea se eliminan antes de la síntesis.

## Variables de entorno

| Variable | Por defecto | Objetivo |
|---|---|---|
| `COSYVOICE3_MODEL_DIR` | `CosyVoice/pretrained_models/Fun-CosyVoice3-0.5B` | Directorio de puntos de control locales |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Dirección de enlace del contenedor; consulte [Acceso a la red](/es-419/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `COSYVOICE3_PORT` | `8017` | Puerto contenedor |
| `COSYVOICE3_UPSTREAM_STREAM` | `0` | Habilita el generador de transmisión interno de CosyVoice |
| `COSYVOICE3_SPEED` | `1.0` | Multiplicador de velocidad numérica global pasado a inferencia ascendente |
| `COSYVOICE3_DEFAULT_INSTRUCT` | vacía | Instrucción opcional agregada cuando una solicitud no proporciona una |
| `COSYVOICE3_FP16` | `0` | Solicite al tiempo de ejecución oficial que use su modo fp16 |
| `COSYVOICE3_LOAD_TRT` | `0` | Habilita la carga TensorRT aguas arriba cuando esté preparada adecuadamente |
| `COSYVOICE3_LOAD_VLLM` | `0` | Habilita la carga de vLLM ascendente cuando sus dependencias separadas estén instaladas |

De forma predeterminada, TensorRT, vLLM y fp16 permanecen deshabilitados. El tiempo de ejecución estándar de PyTorch se ejecuta cómodamente en GPU de 16 GB sin dependencias de tiempo de ejecución adicionales.

## Rendimiento y variantes del modelo

### Predeterminado: `Fun-CosyVoice3-0.5B-2512` base

Este es el valor predeterminado recomendado para TomoriBot. Proporciona una alta similitud de los altavoces, admite todos los modos de instrucción y clonación del CosyVoice 3 y no requiere cuantificación en GPU de 16 GB.

### Pesos de aprendizaje por refuerzo

El paquete de punto de control incluye `llm.rl.pt` junto con pesos base. Las ponderaciones RL reducen las tasas de error de contenido, mientras que las ponderaciones base obtienen una puntuación ligeramente más alta en los puntos de referencia de similitud de hablantes. Debido a que se prioriza la fidelidad de la voz de la persona, el contenedor predeterminado es `llm.pt`.

El cargador ascendente espera `llm.pt`. Para probar los pesos RL sin modificar los archivos predeterminados, duplique el directorio del modelo, cambie el nombre de `llm.rl.pt` a `llm.pt` dentro de la copia y configure `COSYVOICE3_MODEL_DIR` en la carpeta copiada.

### vLLM y TensorRT

CosyVoice 3 admite tiempos de ejecución opcionales de vLLM y TensorRT. Los documentos ascendentes vLLM 0.11.x+ con el motor V1 y vLLM 0.9.0 como legado. Debido a que estas bibliotecas introducen requisitos estrictos de versión de dependencia y CUDA, TomoriBot no las instala de forma predeterminada.

## Licencia

El código base CosyVoice y los pesos `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` se publican bajo la licencia Apache-2.0.

La tarjeta modelo anterior señala que los materiales de demostración son para evaluación académica. TomoriBot no distribuye pesos de modelos. Revisa las licencias y los términos ascendentes para su caso de uso específico antes de realizar la implementación comercial.
