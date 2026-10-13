---
title: "Fish Audio S2 Pro"
aiGenerated: true
---

Sintetice discursos de personajes multilingües altamente expresivos con etiquetas de emociones detalladas utilizando [Fish Audio S2 Pro](https://github.com/fishaudio/fish-speech).

Fish Audio S2 Pro es un modelo multilingüe de conversión de texto a voz con parámetros 4B creado para la clonación de voz de alta fidelidad. TomoriBot se conecta al modelo a través del contenedor local en `servers/tts/fishs2/`. El valor predeterminado es el peso oficial BF16 (`fishaudio/s2-pro`), con un punto de control cuantificado INT8 opcional (`Imagilux/fishaudio-s2-pro`) para GPU con 8 a 12 GB de VRAM.

Fish S2 Pro admite etiquetas de expresión entre corchetes como `[whisper]`, `[excited]` y `[angry]`. Configura el punto final con el marcado `Etiquetas entre corchetes` para que TomoriBot conserve estos controles en los scripts de voz generados.

## Licencia

El código de Fish Speech y los pesos del modelo S2 Pro se distribuyen bajo la Licencia de Investigación de Fish Audio. Se permite la investigación y el uso no comercial bajo sus términos; el uso comercial requiere una licencia de Fish Audio separada.

TomoriBot no redistribuye los pesos del modelo. Cada usuario de autoalojamiento descarga Fish S2 Pro directamente de Hugging Face y es responsable de cumplir con la Licencia de Investigación de Fish Audio. La atribución requerida es: Built with Fish Audio.

## Hardware y sistemas operativos

> [!IMPORTANTE]
> Fish Audio apunta oficialmente a Linux y WSL2. Fish S2 Pro utiliza una arquitectura dual autorregresiva (Dual-AR) (36 capas de transformador lento + 10 pases rápidos del libro de códigos = 76 evaluaciones de capa por token). En Linux, OpenAI Triton compila este bucle en núcleos de GPU fusionados (`torch.compile(backend="inductor")`), lo que permite la síntesis en tiempo real. El contenedor deja la compilación desactivada de forma predeterminada; configure `FISH_S2_COMPILE=1` para habilitarlo. >
> En Windows nativo, Triton no es compatible, lo que obliga a PyTorch a entrar en modo ansioso sin compilar con más de 120.000 envíos secuenciales de kernel CUDA a través del controlador WDDM de Windows. Esto provoca una grave parada en el envío, lo que ralentiza la generación a ~8-10 minutos (~65 s de cálculo por segundo de audio) para exactamente el mismo clip. Para una inferencia utilizable, ejecute Fish S2 Pro dentro de Linux o WSL2.

Hardware recomendado:

- **Linux o WSL2 (muy recomendado)**
- GPU NVIDIA con 16 GB a 24 GB de VRAM (BF16 cabe cómodamente en ~16-18 GB de VRAM con almacenamiento en caché y descarga KV)
- Python 3.12 recomendada
- `git`, `ffmpeg` y bibliotecas de audio estándar requeridas por Fish Speech

## Configuración

### Linux y WSL2 (recomendado)

Desde la raíz del repositorio TomoriBot:

```bash
bash servers/tts/fishs2/install-fishs2.sh
servers/tts/fishs2/.venv/bin/python servers/tts/fishs2/server.py
```

El instalador:

1. clona `Imagilux/fish-speech` en `servers/tts/fishs2/fish-speech/` y verifica la confirmación del tiempo de ejecución fijada;
2. crea el `.venv` aislado;
3. instala Fish Speech más las dependencias del contenedor TomoriBot; y
4. descarga el punto de control oficial BF16 `fishaudio/s2-pro` en `fish-speech/checkpoints/fish-speech-s2-pro/`.

Una reinstalación normal permanece en la confirmación de tiempo de ejecución fijada `2225e924e7d35cc0a1d24dbc67cd1819e6cf429f` en lugar de seguir una rama en movimiento; pasar a un tiempo de ejecución más nuevo significa cambiar ese pin en el instalador. La revisión del modelo por defecto es `main`; fije `FISH_S2_MODEL_REVISION` a una revisión de Hugging Face inmutable cuando una implementación debe ser reproducible. La configuración del instalador se enumera en [Variables del instalador](#installer-variables).

El modelo Hugging Face está cerrado. Primero acepte su licencia en Hugging Face. Si la descarga solicita autenticación, ejecute:

```bash
servers/tts/fishs2/.venv/bin/hf auth login
```

Luego vuelva a ejecutar el instalador.

### Windows PowerShell (solo mejor esfuerzo)

Windows nativo se proporciona únicamente para evaluación. Debido a la latencia de envío del controlador en el modo ansioso sin compilar, la generación será extremadamente lenta (~8-10 minutos por clip):

```powershell
.\servers\tts\fishs2\install-fishs2.ps1
.\servers\tts\fishs2\.venv\Scripts\python.exe servers\tts\fishs2\server.py
```

El instalador de PowerShell tiene como objetivo la aceleración CUDA GPU (`cu124`) de forma predeterminada. Para instalar en una máquina que solo tiene CPU y sin una GPU NVIDIA, pase `-Cpu`:

```powershell
.\servers\tts\fishs2\install-fishs2.ps1 -Cpu
```

Si alguna vez es necesario instalar o actualizar PyTorch en Windows manualmente con soporte CUDA, ejecute:

```powershell
.\servers\tts\fishs2\.venv\Scripts\pip.exe install --force-reinstall torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

TomoriBot deja de esperar un mensaje de voz después de `TTS_SYNTHESIZE_TIMEOUT_MS` (240000 ms predeterminado), que es más corto que lo que tarda un clip nativo de Windows. Levántelo en `.env` de TomoriBot (por ejemplo, `TTS_SYNTHESIZE_TIMEOUT_MS=900000`) mientras evalúa en Windows.

## Transcripción de referencia obligatoria

> [!ADVERTENCIA]
> Se requiere el texto de referencia (`ref_text`) para la clonación de voz; El mecanismo de atención cruzada de Fish S2 Pro requiere la transcripción del audio de referencia para alinear tokens fonéticos con códigos acústicos. >
> Si carga una muestra de voz sin proporcionar su transcripción de referencia coincidente, Fish Speech descarta silenciosamente los tokens de audio de referencia y vuelve al habla aleatoria de referencia cero. El contenedor TomoriBot Fish valida y rechaza solicitudes de síntesis que carecen de texto de referencia con un `400 Bad Request` para evitar la generación accidental no condicionada.

Al agregar una voz de persona en `/config` en el campo `Models > `Parámetros y voces TTS``, always fill in the `Reference transcript` con el texto textual hablado en su clip de audio de referencia.

## Registro en TomoriBot

En `/providers`, elige `Agregar nuevo punto de conexión personalizado` y configura:

- Capacidad: `Speech`
- Compatibilidad de API: `tts-clone`
- Endpoint URL: `http://127.0.0.1:8015`
- Modo de fuente de voz: `Clone`
- Estilo de marcado del guion: `Etiquetas entre corchetes`
- Clave de API: déjalo vacío. El envoltorio no tiene autenticación; consulta [Acceso de red](/es-419/self-hosting/local-endpoints/text-to-speech/#network-access).

Luego agrega la entrada del modelo del endpoint y actívala a través de `/config` bajo Modelos > `Cambiar modelos`.

## Agrega voces de personas

1. Prepara un clip de referencia limpio de 10-20 segundos con un solo orador y poco o ningún ruido de fondo.
2. En `/config`, abre Modelos > `Parámetros y voces TTS` y sube la muestra de voz.
3. Ingresa la transcripción exacta hablada en el clip de referencia en el campo de texto de referencia.
4. En `/config`, abre Persona > Voz y asigna la muestra a la persona.
5. Genera un mensaje de voz con `/generate voice-message` o deja que TomoriBot genere uno a través de su herramienta de mensajes de voz.

El upstream describe una clonación precisa a partir de muestras de referencia de típicamente 10-30 segundos. El propio tiempo de ejecución de Fish S2 Pro no aplica ningún límite de duración de la referencia, así que un clip más largo se acepta en lugar de recortarse, pero la calidad de clonación documentada proviene del rango de 10-30 segundos.

## Controles de expresión

Fish S2 Pro puede variar la entrega dentro de un enunciado usando etiquetas entre corchetes. Por ejemplo:

```text
[whisper] Keep your voice down. [excited] Wait, you actually found it?
```

Debido a que el endpoint usa el marcado `Etiquetas entre corchetes`, TomoriBot conserva estas etiquetas en lugar de eliminarlas antes de la síntesis.

## Configuración

| Variable | Predeterminado | Propósito |
|---|---|---|
| `FISH_S2_MODEL_DIR` | `fish-speech/checkpoints/fish-speech-s2-pro` | Directorio del punto de control S2 Pro |
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Repositorio de modelos y etiqueta de metadatos de salud para el punto de control configurado |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Dirección de enlace del envoltorio; consulta [Acceso de red](/es-419/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `FISH_S2_PORT` | `8015` | Puerto del envoltorio Fish |
| `FISH_S2_UPSTREAM_PORT` | `8025` | Puerto de la API interna de Fish |
| `FISH_S2_COMPILE` | `0` | Habilitar Fish Speech `torch.compile` (requiere Linux/WSL2 con Triton) |
| `FISH_S2_HALF` | `0` | Solicitar modo de tiempo de ejecución FP16 |
| `FISH_S2_CHUNK_LENGTH` | `200` | Longitud del trozo del prompt iterativo de Fish |
| `FISH_S2_TOP_P` | `0.8` | Muestreo top-p |
| `FISH_S2_TEMPERATURE` | `0.8` | Temperatura de muestreo |
| `FISH_S2_REPETITION_PENALTY` | `1.1` | Penalización por repetición |
| `FISH_S2_MAX_NEW_TOKENS` | `1024` | Máximos tokens semánticos generados por solicitud |
| `FISH_S2_USE_MEMORY_CACHE` | `on` | Almacenar en caché las voces de referencia codificadas en el tiempo de ejecución de Fish |

### Variables del instalador

Leídas por `install-fishs2.sh` e `install-fishs2.ps1`. Registra cualquier valor que anules para que la implementación pueda reproducirse.

| Variable | Predeterminado | Propósito |
|---|---|---|
| `FISH_S2_MODEL_ID` | `fishaudio/s2-pro` | Repositorio de Hugging Face para descargar |
| `FISH_S2_MODEL_REVISION` | `main` | Revisión de Hugging Face para descargar |

El audio de referencia debe ser un archivo RIFF/WAVE PCM no vacío, sin comprimir y de 10 MB decodificados como máximo. El límite se verifica antes de la inferencia para que una solicitud base64 de gran tamaño no consuma memoria sin límites, y alcanza para unos 237 segundos del WAV mono de 22.05 kHz que envía TomoriBot.

## Opción de baja VRAM (cuantización INT8)

Los usuarios que ejecutan GPU con VRAM restringida (por ejemplo, de 8 a 12 GB) que no pueden ajustarse al punto de control oficial BF16 pueden optar por el modelo cuantificado INT8 (`Imagilux/fishaudio-s2-pro`).

Para instalar y ejecutar el punto de control INT8:

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

Inicia `server.py` desde el mismo shell, o configure las mismas tres variables antes de iniciarlo, de modo que el contenedor cargue el directorio INT8 en lugar del predeterminado BF16.

El punto de control INT8 reduce el peso del transformador de ~10,3 GB a ~5,1 GB mientras mantiene las incrustaciones de audio y las capas de códec en BF16, cabendo dentro de ~10 GB de VRAM total.
