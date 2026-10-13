---
title: "Qwen3-TTS"
aiGenerated: true
---

Sintetice el habla de caracteres multilingües de alta precisión utilizando [Qwen3-TTS](https://github.com/QwenAudio/Qwen3-TTS) tanto en el modo de clonación de voz como en el modo VoiceDesign descrito por texto.

Qwen3-TTS 12Hz 1.7B proporciona síntesis de voz local de alta precisión. Al ejecutar `servers/tts/qwen3tts/server.py` en su modo automático predeterminado, se selecciona dinámicamente el modelo base de clonación de voz o el modelo VoiceDesign en función de cada solicitud entrante.

## Configuración

Ejecuta estos comandos desde la raíz del repositorio TomoriBot, la carpeta donde clonó TomoriBot:

### WindowsPowerShell

```powershell
python -m venv servers\tts\qwen3tts\.venv
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r servers\tts\qwen3tts\requirements.txt
python servers\tts\qwen3tts\server.py
```

### Bash de Linux y macOS

```bash
python3 -m venv servers/tts/qwen3tts/.venv
source servers/tts/qwen3tts/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r servers/tts/qwen3tts/requirements.txt
python servers/tts/qwen3tts/server.py
```

La URL del punto final en modo automático predeterminada es `http://127.0.0.1:8012`; configure `QWEN3TTS_PORT` para usar otro puerto. También puedes especificar el modo automático explícitamente:

```powershell
python servers\tts\qwen3tts\server.py --mode auto
```

El modo automático inspecciona cada solicitud `/synthesize`: las solicitudes con `ref_audio` usan el modelo clonado, mientras que las solicitudes con `instruct` usan el modelo VoiceDesign. Mantiene solo un modelo cargado a la vez e intercambia modelos cuando cambia el tipo de solicitud, por lo que la primera solicitud después de un intercambio puede ser más lenta.

## Registro en TomoriBot

Para la mayoría de los usuarios, registra el servidor en modo automático para que un solo endpoint pueda admitir tanto las personas de clonación de voz como las de Diseño de voz.

Ejecuta `/providers`, elige `Agregar nuevo punto de conexión personalizado`, y usa la compatibilidad de API de voz:

- Compatibilidad de API: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8012`

Después de guardar la conexión, selecciónala y usa su menú desplegable de modelos para agregar un modelo de Voz. El formulario del modelo
pregunta por el `Modo de fuente de voz` y el `Estilo de marcado del guion`; elige `Auto` y `Plain` para el servidor de modo automático.

Usa `/providers` para el registro del endpoint y la configuración del modelo. Luego abre `/config` > Modelos > `Cambiar modelos` para seleccionar y activar el endpoint registrado.

## Configurar voces personales

### Clonación de voz

Utilice esto para personas que deberían imitar un clip de referencia:

1. Prepare un clip de voz limpio de 10 a 20 segundos con un altavoz y sin música de fondo.
2. Abre `/config` en Modelos > `Parámetros y voces TTS` y cargue el clip.
3. Abre `/config` en Persona > `Voz`, luego elija la persona y la muestra de voz.

Qwen3-TTS anuncia una clonación rápida desde tan solo 3 segundos de audio de referencia, y su tiempo de ejecución no documenta ni impone un límite de duración de referencia. Por lo tanto, la duración del clip es una compensación de calidad que usted controla y no un límite que el servidor verifica.

### Diseño de voz

Utilice esto para personas que deberían utilizar una descripción de voz escrita en lugar de una muestra:

1. Abre `/config` en Persona > `Voz` y elija VoiceDesign.
2. Elige la persona.
3. Ingresa un mensaje de voz en lenguaje natural, como la edad, el tono, el acento y la forma de expresarse del hablante.

Elimina el mensaje VoiceDesign de una persona desde Persona > `Voz` en `/config`. Durante la generación, TomoriBot envía el mensaje guardado en el cuerpo JSON de `/synthesize` como `instruct`; Se adjuntan `voice_instructions` únicos de la herramienta.

El modo automático mantiene ambas configuraciones. Las personas configuradas en Persona > `Voz` en `/config` usan síntesis de clonación o síntesis de VoiceDesign según su selección.

## Opcional: servidor exclusivo de VoiceDesign

Inicia el mismo servidor en modo VoiceDesign cuando sirva `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`.

WindowsPowerShell:

```powershell
servers\tts\qwen3tts\.venv\Scripts\Activate.ps1
$env:TOMORI_TTS_MODE = "voice-design"
python servers\tts\qwen3tts\server.py
```

Intento:

```bash
source servers/tts/qwen3tts/.venv/bin/activate
TOMORI_TTS_MODE=voice-design python servers/tts/qwen3tts/server.py
```

También puede pasar `--mode voice-design` en lugar de configurar `TOMORI_TTS_MODE`. La URL predeterminada del punto final exclusivo de VoiceDesign es `http://127.0.0.1:8014`.

Regístrelo de la misma manera que el modo automático, pero use la URL del punto final `http://127.0.0.1:8014` y elija `Diseño de voz` como modo de fuente de voz en el modelo de voz.
