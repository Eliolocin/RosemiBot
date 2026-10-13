---
title: "IrodoriTTS"
aiGenerated: true
---

Genere un habla japonesa natural con clonación de voz, VoiceDesign basado en subtítulos y marcado de emoji expresivo usando [Irodori-TTS v4.1](https://github.com/Aratako/Irodori-TTS).

Irodori-TTS v4.1 es un modelo de conversión de texto a voz centrado en japonés que admite tanto la clonación de voz como el VoiceDesign descrito en texto dentro de un único punto de control. TomoriBot se conecta a Irodori a través del contenedor FastAPI local en `servers/tts/irodoritts/`, de forma predeterminada es `Aratako/Irodori-TTS-v4.1-Small`.

Se pueden seleccionar puntos de control de Hugging Face compatibles con `IRODORI_TTS_MODEL_ID`, incluidos ajustes comunitarios como `phasefield-audio/Irodori-TTS-v4.1-Anime`.

## Configuración

Irodori utiliza `uv` para la gestión de dependencias y backend de PyTorch. El servidor mantiene su propio `pyproject.toml` con dependencias fijadas de Irodori y `dacvae` para instalaciones reproducibles. Primero instale `uv`, luego ejecute el script de instalación desde la raíz del repositorio TomoriBot:

### Windows PowerShell (NVIDIA)

```powershell
.\servers\tts\irodoritts\install-irodori.ps1 cu128
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

### Linux Bash (NVIDIA)

```bash
bash servers/tts/irodoritts/install-irodori.sh cu128
servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

Los scripts de instalación crean `servers/tts/irodoritts/.venv`, por lo que `bun run launch --irodoritts` continúa funcionando después de la instalación.

Servidores disponibles:

- `cu128`: NVIDIA CUDA 12.8 en Windows y Linux
- `cpu`: solo CPU o CPU/MPS macOS a través de PyPI
- `rocm`: AMD ROCm en Linux/WSL
- `xpu`: Intel XPU en Windows y Linux

La URL del punto final predeterminado es `http://127.0.0.1:8013`.

## Usando un punto de control diferente

El modelo predeterminado es `Aratako/Irodori-TTS-v4.1-Small`. Los repositorios compatibles de Hugging Face, los ajustes comunitarios (como `phasefield-audio/Irodori-TTS-v4.1-Anime`) o los archivos de puntos de control locales se pueden configurar mediante variables de entorno.

Cuando inicia el servidor (directamente con Python o mediante `bun run launch --irodoritts`), lee automáticamente la raíz del repositorio `.env` (o un `.env` local en `servers/tts/irodoritts/`) y registra la ID del modelo activo al inicio.

### Vía `.env` (persistente)

Agrega a su `.env` en la raíz TomoriBot:

```dotenv
IRODORI_TTS_MODEL_ID="phasefield-audio/Irodori-TTS-v4.1-Anime"
```

### A través de variable de entorno por sesión

En Windows PowerShell:

```powershell
$env:IRODORI_TTS_MODEL_ID = "phasefield-audio/Irodori-TTS-v4.1-Anime"
.\servers\tts\irodoritts\.venv\Scripts\python.exe servers\tts\irodoritts\server.py
```

En Linux Bash:

```bash
IRODORI_TTS_MODEL_ID=phasefield-audio/Irodori-TTS-v4.1-Anime \
  servers/tts/irodoritts/.venv/bin/python servers/tts/irodoritts/server.py
```

### Usando un archivo de punto de control local

Si ha descargado un archivo de punto de control (`.pt` o `.safetensors`) localmente, configure `IRODORI_TTS_CHECKPOINT` en su ruta:

```dotenv
IRODORI_TTS_CHECKPOINT="/path/to/custom_checkpoint.pt"
```

Irodori actual descarga el punto de control junto con los activos del tokenizador incluidos en el repositorio de Hugging Face. Las variantes de la subcarpeta Hugging Face también son compatibles con `IRODORI_TTS_MODEL_ID` cuando el repositorio del modelo las proporciona.

## Regístrate en TomoriBot

Ejecuta `/providers`, elija `Add New Custom Endpoint` y use la compatibilidad de voz API:

- Compatibilidad API: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8013`

Después de guardar la conexión, selecciónela y use su menú desplegable de modelo para agregar un modelo de voz. Para v4.1, las configuraciones recomendadas son:

- `Modo de fuente de voz`: `Automático`
- `Estilo de marcado del guion`: `Emoji`

`Automático` permite que el mismo terminal Irodori admita ambos modos de voz TomoriBot, por lo que las señales emocionales sobreviven al envío:

- Las personas con una muestra de voz asignada en Persona > `Voz` envían un clip de referencia almacenado para la clonación de voz.
- Las personas con un mensaje de VoiceDesign configurado en Persona > `Voz` envían el mensaje guardado en lenguaje natural como acondicionamiento de subtítulos de Irodori.

Aún puede elegir `Clon de voz` como modo de fuente de voz si solo desea clonar voz de audio de referencia.

Utilice `/providers` para el registro de terminales y la configuración del modelo. Luego abra `/config` > `Modelos` > Switch Models para seleccionar y activar el punto final registrado.

## Configurar voces personales

### Clonación de voz

1. Prepare un clip de voz japonés limpio con un altavoz y sin música de fondo. Alrededor de 30 segundos ya es suficiente: más allá de ese punto, el audio adicional compra poca fidelidad de timbre y cuesta tamaño de carga y tiempo de inferencia.
2. Abre `/config` en Modelos > `Parámetros y voces TTS` y cargue el clip.
3. Abre `/config` en Persona > `Voz`, luego elija la persona y la muestra de voz.

Irodori v4.1 admite un acondicionamiento de referencia más prolongado que los modelos anteriores, pero el audio de fuente limpia sigue siendo más importante que la duración sin formato.

El tiempo de ejecución v4.1 limita el clip de referencia en el punto de control predeterminado, que el punto de control v4.1 establece en 120 segundos. Cualquier cosa más larga se recorta a ese límite en lugar de rechazarse, y `IRODORI_MAX_REF_SECONDS` lo anula. Por lo tanto, un clip en el techo de carga de 130 segundos de TomoriBot todavía funciona: condiciones de Irodori en los primeros 120 segundos.

Los clips más largos no mejoran la calidad de la voz. Upstream informa que aproximadamente 30 segundos de discurso de referencia limpio ya capturan la mayor parte de la ganancia medible de similitud del hablante, y que varios clips más cortos del mismo hablante superan a una grabación larga. Los pasos latentes de referencia adicionales que vienen con un clip más largo también alargan cada solicitud de síntesis. Llegue a más de 30 segundos solo cuando el timbre de un hablante se desvíe a lo largo de la grabación.

### Diseño de voz

1. Abre `/config` en Persona > `Voz`.
2. Elige la persona.
3. Ingresa una descripción en lenguaje natural de la voz y la entrega deseadas.

TomoriBot envía este mensaje como `instruct`; el contenedor Irodori lo asigna a la condición v4.1 `caption`. Las solicitudes de VoiceDesign no requieren un clip de referencia almacenado.

TomoriBot elimina la sintaxis de emoji personalizada de Discord antes de enviar texto a TTS. Con `script_markup: emoji`, los emojis Unicode se conservan para el condicionamiento del texto de Irodori.

### Controles de estilo emoji

IrodoriTTS admite anotaciones emoji en el texto de entrada para influir en los efectos de sonido, los estilos de habla y las expresiones emocionales. Con `Estilo de marcado del guion` de TomoriBot configurado en `Emoji`, estos emojis Unicode se conservan y se envían a Irodori.

| emojis | Significado/emoción/estilo |
| --- | --- |
| 👂 | Susurro, sonidos cerca del oído. |
| 😮‍💨 | Respiración, suspiro, respiración dormida. |
| ⏸️ | Pausa, silencio |
| 🤭 | Risa, risa tonta, risa reprimida |
| 🥵 | Jadeando, gemido, gemido |
| 📢 | eco, reverberación |
| 😏 | Bromeando, juguetonamente dulce / persuasivo |
| 🥺 | Voz temblorosa, tímido/inseguro. |
| 🌬️ | Dificultad para respirar, respiración pesada. |
| 😮 | Jadear |
| 👅 | Sonido de lamido, sonido de masticación, sonido húmedo. |
| 💋 | Lamer los labios/ruido de los labios |
| 🫶 | Suavemente, tiernamente |
| 😭 | Sollozando, llorando, con pena/tristeza |
| 😱 | Gritar, gritar, chillar |
| 😪 | Somnoliento, perezoso/lánguido |
| 😴 | Hablar dormido, roncar |
| ⏩ | Habla rápido, dispara rápido, apresuradamente. |
| 📞 | Por teléfono, a través de un altavoz |
| 🐢 | Despacio |
| 🥤 | Trago, sonido de deglución. |
| 🤧 | Toser, sollozar, estornudar, aclararse la garganta. |
| 😒 | Tutting, chasqueando la lengua |
| 😰 | Pánico, agitada, nerviosa, tartamudeando |
| 😆 | Con alegría, felizmente |
| 💥 | Con fuerza/impulso, con fuerza |
| 😠 | Enojado, disgustado, de mal humor |
| 😲 | Sorpresa, asombro/exclamación |
| 🥱 | Bostezo |
| 😖 | Dolorosamente, agonizantemente |
| 😟 | Ansiosamente, preocupado |
| 🫣 | Tímidamente, tímidamente |
| 🙄 | Exasperada, ojos rodantes |
| 😊 | alegremente, con mucho gusto |
| 😎 | Con confianza, orgullo |
| 👌 | Backchanneling, sonido de acuerdo |
| 🙏 | suplicando, rogando |
| 🥴 | Borracha |
| 🎵 | Zumbadora |
| 🤐 | Amortiguado (boca tapada) |
| 😌 | Aliviado, contento |
| 🤔 | Voz interrogante, preguntándose |
| 💪 | Con esfuerzo, fuertemente |
| 👃 | Sonido de olfateo/olor |
| 📖 | Narración, monólogo |

Repetir el mismo emoji puede potenciar su efecto. El control de emojis no es perfectamente consistente, así que trátelos como señales de estilo en lugar de resultados garantizados. Consulta las [anotaciones emoji oficiales de IrodoriTTS](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small/blob/main/EMOJI_ANNOTATIONS.md) para ver la lista ascendente y futuras actualizaciones.

## mensajes de voz largos

Irodori v4.1 predice la longitud de salida con su predictor de duración en lugar de generar un clip de longitud fija, por lo que el servidor no impone un límite propio de duración por expresión. TomoriBot todavía fragmenta el texto largo antes de la síntesis y concatena el audio generado en una respuesta WAV, por lo que Discord recibe un mensaje de voz; la fragmentación mantiene breve cada paso de inferencia, que es lo que limita la latencia.

La implementación comienza con el enfoque de fragmentación utilizado por el [servidor oficial compatible con Irodori OpenAI](https://github.com/Aratako/Irodori-TTS-Server/blob/main/src/irodori_openai_tts/app.py), cuyos valores predeterminados permiten la fragmentación en 80 caracteres que no son espacios en blanco. TomoriBot agrega un manejo de límites más estricto para que las comillas y corchetes de cierre permanezcan con la puntuación que cierran, las ejecuciones de puntuación como `！？` y `...` permanezcan juntas, los puntos decimales junto a los dígitos no se divida y las colas finales muy cortas se fusionen nuevamente en el fragmento anterior.

La fragmentación prefiere terminaciones de oración fuertes, como `。`, `！`, `？`, `.`, `!`, `?`, elipses y saltos de línea una vez que se alcanza la longitud mínima configurada. Las comas solo se utilizan como límites alternativos después de que el fragmento crece hasta aproximadamente 1,5 veces ese umbral. Con el `IRODORI_CHUNK_MIN_CHARS=80` predeterminado, los límites estrictos se vuelven elegibles a partir de 80 caracteres que no sean espacios en blanco y las comas a aproximadamente 120. Si un pasaje largo no contiene puntuación elegible, aún puede seguir siendo una única solicitud de síntesis.

Para VoiceDesign solo con subtítulos, la semilla de Irodori generada por el primer fragmento se reutiliza para los fragmentos restantes para reducir la variación aleatoria entre las uniones. Reutilizar una semilla no garantiza un timbre idéntico en fragmentos sintetizados de forma independiente. El modo de audio de referencia continúa aplicando el mismo clip de referencia a cada fragmento.

Las entradas largas requieren múltiples pases de inferencia secuenciales y pueden tardar mucho más en hardware más lento. El tiempo de espera predeterminado del cliente TTS de TomoriBot es de 240 segundos. Puede desactivar la fragmentación con `IRODORI_CHUNKING_ENABLED=false` o ajustar el umbral de división aproximado con `IRODORI_CHUNK_MIN_CHARS`.

## Inferencia más rápida con muestreo de influencia

El valor predeterminado sigue siendo el muestreo lineal de 40 pasos de mayor calidad de Irodori. Para una latencia más baja, pruebe Sway Sampling con menos pasos:

```powershell
$env:IRODORI_NUM_STEPS = "6"
$env:IRODORI_T_SCHEDULE_MODE = "sway"
$env:IRODORI_SWAY_COEFF = "-1.0"
```

Esta es una compensación entre la calidad y la velocidad de la inferencia, así que pruébela con el punto de control y las voces que haya elegido antes de convertirla en permanente.

## Variables ambientales

| Variable | Por defecto | Objetivo |
|---|---|---|
| `IRODORI_TTS_MODEL_ID` | `Aratako/Irodori-TTS-v4.1-Small` | Repositorio del modelo Hugging Face o fuente de repositorio/subcarpeta compatible |
| `IRODORI_TTS_CHECKPOINT` | desarmada | Punto de control local opcional `.pt` o `.safetensors`; anula el modelo de cara abrazada |
| `TOMORI_TTS_HOST` | `127.0.0.1` | Dirección de enlace del servidor; consulte [Acceso a la red](/es-419/self-hosting/local-endpoints/text-to-speech/#network-access) |
| `IRODORI_TTS_PORT` | `8013` | Puerto del servidor |
| `IRODORI_MODEL_DEVICE` | `auto` | Modelo de dispositivo (`auto`, `cuda`, `cpu`, `mps`, `xpu`) |
| `IRODORI_CODEC_DEVICE` | `auto` | Dispositivo códec |
| `IRODORI_MODEL_PRECISION` | `bf16` en CUDA, de lo contrario `fp32` | Precisión del modelo |
| `IRODORI_CODEC_PRECISION` | `fp32` | Precisión del códec |
| `IRODORI_COMPILE_MODEL` | `false` | Habilita `torch.compile` para el modelo Irodori |
| `IRODORI_COMPILE_DYNAMIC` | `false` | Habilitar formas dinámicas al compilar |
| `IRODORI_NUM_STEPS` | `40` | Pasos de muestreo de Euler |
| `IRODORI_T_SCHEDULE_MODE` | `linear` | Programa de muestreo (`linear` o `sway`) |
| `IRODORI_SWAY_COEFF` | `-1.0` | Coeficiente de oscilación cuando se utiliza el programa `sway` |
| `IRODORI_CFG_SCALE_TEXT` | `3.0` | Escala de guía de texto |
| `IRODORI_CFG_SCALE_CAPTION` | `3.0` | Escala de guía de subtítulos/VoiceDesign |
| `IRODORI_CFG_SCALE_SPEAKER` | `5.0` | Escala de orientación del hablante de referencia |
| `IRODORI_MAX_REF_SECONDS` | punto de control predeterminado | Límite opcional en la duración del audio de referencia |
| `IRODORI_CHUNKING_ENABLED` | `true` | Divida el texto largo en límites de puntuación elegibles y concatene los fragmentos generados |
| `IRODORI_CHUNK_MIN_CHARS` | `80` | Mínimo de caracteres que no sean espacios en blanco antes de dividir los límites fuertes de la oración; las comas son límites alternativos en aproximadamente 1,5 veces este valor |
