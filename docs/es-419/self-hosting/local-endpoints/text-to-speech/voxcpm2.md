---
title: "VoxCPM2"
aiGenerated: true
---

Sintetice voz expresiva de 48 kHz en 30 idiomas utilizando el modelo de texto a voz [VoxCPM2](https://github.com/OpenBMB/VoxCPM) de OpenBMB.

VoxCPM2 es un modelo de voz multilingüe de parámetros 2B que admite clonación de voz, Ultimate Cloning asistida por transcripción y diseño de voz en lenguaje natural. TomoriBot se conecta a la biblioteca oficial de Python `voxcpm` a través del servidor en `servers/tts/voxcpm2/`, ejecutando cómodamente el punto de control oficial no cuantificado `openbmb/VoxCPM2` BF16 dentro de 16 GB de VRAM.

## Licencia

El código y los pesos del modelo VoxCPM2 se publican bajo Apache-2.0, incluido el uso comercial sujeto a los términos de la licencia. TomoriBot no redistribuye los pesos; el instalador los descarga del repositorio oficial de Hugging Face.

Recursos oficiales upstream:

- [OpenBMB/VoxCPM](https://github.com/OpenBMB/VoxCPM)
- [openbmb/VoxCPM2 en Hugging Face](https://huggingface.co/openbmb/VoxCPM2)
- [Documentación de VoxCPM](https://voxcpm.readthedocs.io/)

## Idiomas admitidos

VoxCPM2 admite oficialmente 30 idiomas sin requerir una etiqueta de idioma:

Árabe, birmano, chino, danés, holandés, inglés, finlandés, francés, alemán, griego, hebreo, hindi, indonesio, italiano, japonés, jemer, coreano, lao, malayo, noruego, polaco, portugués, ruso, español, swahili, sueco, tagalo, tailandés, turco y vietnamita.

OpenBMB también documenta varios dialectos chinos. TomoriBot aún puede enviar un campo `language` para compatibilidad con el contrato común de texto a voz, pero VoxCPM2 detecta el idioma a partir del texto de síntesis y el envoltorio no fuerza una etiqueta de idioma.

## Modos de voz

Un endpoint VoxCPM2 puede manejar todos los modos de fuente de voz útiles de TomoriBot:

| Solicitud de TomoriBot | Comportamiento de VoxCPM2 |
|---|---|
| Solo `text` | Rechazado; elige una muestra de referencia o un prompt de Diseño de voz |
| `text` + `instruct` | Diseño de voz a partir de una descripción en lenguaje natural |
| `text` + `ref_audio` | Clonación de voz de audio de referencia |
| `text` + `ref_audio` + `instruct` | Clonación controlable: preserva al orador mientras dirige la entrega |
| `text` + `ref_audio` + `ref_text` | Clonación Definitiva usando el audio de referencia y su transcripción |
| `text` + `ref_audio` + `ref_text` + `instruct` | Clonación controlable; la instrucción única tiene prioridad y la transcripción no se envía |

VoxCPM2 representa el Diseño de voz y el control de estilo colocando una descripción en lenguaje natural entre paréntesis antes del texto a sintetizar. TomoriBot ya tiene un campo `instruct` para este propósito, por lo que el envoltorio realiza esa conversión automáticamente.

Usa el Estilo de marcado del guion `Plano`. VoxCPM2 no requiere que TomoriBot conserve las etiquetas entre corchetes o la sintaxis de control de emoji, y no es necesario un nuevo modo de Estilo de marcado del guion.

## Hardware y tiempo de ejecución

Punto de partida recomendado:

- Python 3.10-3.12
- GPU NVIDIA con 8 GB VRAM o más para el tiempo de ejecución oficial BF16; 12-16 GB proporcionan un margen cómodo
- Controlador NVIDIA actual y una compilación de PyTorch con CUDA habilitado para aceleración de GPU
- Se admite la CPU como respaldo, pero es sustancialmente más lenta

El paquete oficial también expone la selección de dispositivos CPU y Apple MPS. Para TomoriBot en Windows, el paquete estándar de Python puede ejecutarse de forma nativa; WSL no es necesario. El instalador de Windows PowerShell instala una compilación de PyTorch con CUDA habilitado (`cu124`) de forma predeterminada.

Para instalar explícitamente en una máquina solo con CPU, pasa el interruptor `-Cpu`:

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1 -Cpu
```

Si tu instalación nativa de PyTorch en Windows alguna vez necesita una reinstalación manual o una realineación de controladores, instala la compilación de PyTorch con CUDA habilitado directamente en el entorno virtual del servidor:

```powershell
.\servers\tts\voxcpm2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

OpenBMB reporta aproximadamente 0.30 RTF en una RTX 4090 con el tiempo de ejecución estándar. Upstream también admite la generación en streaming y documenta las opciones de servicio más rápidas Nano-vLLM y vLLM-Omni. El contrato actual `POST /synthesize` de TomoriBot devuelve una respuesta WAV, por lo que este servidor almacena intencionalmente en búfer el enunciado generado en lugar de exponer un protocolo de transmisión separado.

## Instalación

El servidor fija el paquete estable actual `voxcpm` 2.0.3 y descarga `openbmb/VoxCPM2` en la caché normal de Hugging Face.

### Linux y WSL Bash

Desde la raíz del repositorio TomoriBot:

```bash
bash servers/tts/voxcpm2/install-voxcpm2.sh
servers/tts/voxcpm2/.venv/bin/python servers/tts/voxcpm2/server.py
```

### Windows PowerShell

Desde la raíz del repositorio TomoriBot:

```powershell
.\servers\tts\voxcpm2\install-voxcpm2.ps1
.\servers\tts\voxcpm2\.venv\Scripts\python.exe servers\tts\voxcpm2\server.py
```

La primera configuración descarga varios gigabytes de pesos de modelos. Para instalar el entorno Python sin precargar el modelo, configure `VOXCPM2_PREFETCH=0`; La biblioteca oficial descargará el punto de control en el primer inicio del servidor.

Linux y WSL:

```bash
VOXCPM2_PREFETCH=0 bash servers/tts/voxcpm2/install-voxcpm2.sh
```

PowerShell:

```powershell
$env:VOXCPM2_PREFETCH = "0"
.\servers\tts\voxcpm2\install-voxcpm2.ps1
```

Después de la configuración, `bun run launch --voxcpm2` inicia el servidor junto con TomoriBot. El punto final predeterminado es `http://127.0.0.1:8016`.

## Registro en TomoriBot

Ejecuta `/providers`, elige `Agregar nuevo punto de conexión personalizado`, y configura el endpoint de Voz:

- Capacidad: `Speech`
- Compatibilidad de API: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8016`
- Modo de fuente de voz: `Auto`
- Estilo de marcado del guion: `Plain`
- Compatibilidad con instrucciones: `Yes`

Después de guardar la conexión, selecciónala y usa su menú desplegable de modelos para agregar un modelo de Voz. Luego abre `/config` > Modelos > `Cambiar modelos` y selecciona el modelo de voz de VoxCPM2.

Se recomienda `Auto` porque el mismo servidor admite clonación de audio de referencia y Diseño de voz. No necesitas procesos separados de VoxCPM2 para los dos modos.

## Clonación de voz de persona

Para una persona que debe clonar a un orador existente:

1. Prepara un clip de referencia limpio con un solo orador y poca o ninguna música de fondo. La fuente upstream considera 5 a 30 segundos como el rango práctico.
2. Abre `/config` bajo Modelos > `Parámetros y voces TTS` y sube el clip.
3. Agrega la transcripción exacta del clip de referencia cuando esté disponible. VoxCPM2 la usa para Clonación Definitiva y puede reproducir más del ritmo, la emoción y el estilo de referencia.
4. Abre `/config` bajo Persona > Voz, elige la persona y asigna la muestra guardada.

Si no se guarda ninguna transcripción, VoxCPM2 aún realiza la clonación normal de audio de referencia.

La cifra de 5 a 30 segundos es un rango de calidad documentado, y no un límite aplicado: VoxCPM2 no aplica ningún límite propio de duración de la referencia, así que el techo de carga de TomoriBot es lo que detiene un clip más largo.

## Diseño de voz personal.

Para una persona que debe crearse a partir de una descripción de voz escrita en lugar de una muestra:

1. Abre `/config` en Persona > `Voz` y elija VoiceDesign.
2. Elige la persona.
3. Ingresa una descripción en lenguaje natural como `Young adult woman, soft warm voice, relaxed pace, slightly playful delivery`.

TomoriBot envía la descripción guardada como `instruct`. VoxCPM2 lo convierte en su prefijo de control nativo de Voice Design.

Cuando una persona clonada también recibe instrucciones de voz únicas, VoxCPM2 utiliza una clonación controlable: la muestra de referencia proporciona la identidad del hablante mientras que la instrucción dirige cualidades como la emoción, el ritmo o la entrega. Si también se almacena una transcripción, la instrucción tiene prioridad porque la ruta ascendente de Ultimate Cloning no proporciona un modo de control-instrucción confiable; la transcripción se omite intencionalmente para esa solicitud.

## Prueba con `/generate voice-message`

Una vez que VoxCPM2 es el modelo de voz activo, `/generate voice-message` usa la fuente de voz configurada de la persona de la misma manera que las llamadas normales a la herramienta de mensajes de voz:

- las personas clonadas envían el `ref_audio` almacenado y el `ref_text` opcional;
- Las personas de VoiceDesign envían su mensaje guardado como `instruct`;
- los puntos finales con capacidad de clonación con Supports Instruct habilitado exponen el campo Dirección de entrega y pasan instrucciones únicas a través de `instruct`;
- cuando hay una instrucción presente con una muestra de clonación, TomoriBot usa solo `reference_wav_path` y no envía los campos de solicitud de transcripción.

## Variables de entorno

| Variable | Predeterminado | Propósito |
|---|---|---|
| `VOXCPM2_MODEL_ID` | `openbmb/VoxCPM2` | ID del modelo de Hugging Face o directorio del modelo local |
| `VOXCPM2_DEVICE` | `auto` | Dispositivo de tiempo de ejecución: `auto`, `cuda`, `cuda:N`, `cpu`, o `mps` |
| `VOXCPM2_OPTIMIZE` | `1` | Habilitar la ruta de optimización / compilación del tiempo de ejecución oficial |
| `VOXCPM2_LOAD_DENOISER` | `0` | Cargar el eliminador de ruido opcional upstream; deshabilitado de forma predeterminada para ahorrar memoria |
| `VOXCPM2_CFG_VALUE` | `2.0` | Fuerza de orientación |
| `VOXCPM2_INFERENCE_TIMESTEPS` | `10` | Pasos de inferencia de coincidencia de flujo; más pueden mejorar la calidad a costa de la velocidad |
| `VOXCPM2_MAX_LEN` | `4096` | Longitud máxima de generación |
| `VOXCPM2_NORMALIZE` | `0` | Habilitar la normalización de texto upstream |
| `VOXCPM2_RETRY_BADCASE` | `1` | Habilitar el comportamiento de reintento upstream para generaciones anormales |
| `VOXCPM2_RETRY_BADCASE_MAX_TIMES` | `3` | Reintentos automáticos máximos |
| `VOXCPM2_RETRY_BADCASE_RATIO_THRESHOLD` | `6.0` | Umbral de longitud de caso malo upstream |
| `VOXCPM2_PREFETCH` | `1` | Solo instalador: descargar el modelo durante la configuración |
| `VOXCPM2_PORT` | `8016` | Puerto del servidor local de VoxCPM2 |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Dirección de enlace del servidor local; consulta [Acceso de red](/es-419/self-hosting/local-endpoints/text-to-speech/#network-access) |

El audio de referencia debe ser un contenedor WAV no vacío de 10 MB decodificados como máximo, lo que el envoltorio verifica antes de escribir un archivo temporal.

## Puntos de control y tiempos de ejecución alternativos

El modelo BF16 oficial ya se adapta al objetivo previsto de GPU de consumo de 16 GB, por lo que TomoriBot no usa por defecto un punto de control cuantificado. Existen cuantificaciones de la comunidad, pero agregan otra capa de compatibilidad y mantenimiento sin ser necesarias para la configuración normal.

Para implementaciones de alto rendimiento, OpenBMB apunta actualmente a Nano-vLLM-VoxCPM y vLLM-Omni como opciones de servicio acelerado. Esos tiempos de ejecución pueden exponer funciones de transmisión y de servicio simultáneo más allá de este servidor de referencia. No son requeridos para el flujo de trabajo local normal de mensajes de voz de TomoriBot, y este envoltorio se mantiene deliberadamente en la API oficial de `voxcpm` para que las actualizaciones del modelo upstream sigan siendo fáciles de seguir.
