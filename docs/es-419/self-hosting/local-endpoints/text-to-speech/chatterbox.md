---
title: "Chatterbox TTS"
aiGenerated: true
---

Clona voces en inglés con etiquetas de emociones utilizando el servidor de texto a voz local [Chatterbox](https://github.com/resemble-ai/chatterbox).

Chatterbox se ejecuta localmente a través de `servers/tts/chatterbox/server.py`. El valor predeterminado es el modelo rápido Chatterbox-Turbo (350M de parámetros) con etiquetas de eventos de emoción en línea como `[laugh]` y `[sigh]`. También puede configurar el modelo liviano Chatterbox-Nano (parámetros 110M) para configuraciones de CPU o el modelo estándar 0.5B para guía sin clasificador (`cfg_weight`) y ajuste emocional `exaggeration`. Este contenedor no carga Chatterbox Multilingual V3.

## Configuración

Ejecuta estos comandos desde la raíz del repositorio TomoriBot, la carpeta donde clonó TomoriBot:

### Windows PowerShell

```powershell
python -m venv servers\tts\chatterbox\.venv
servers\tts\chatterbox\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install numpy
pip install -r servers\tts\chatterbox\requirements.txt
python servers\tts\chatterbox\server.py
```

### Linux/macOS Bash

```bash
python3 -m venv servers/tts/chatterbox/.venv
source servers/tts/chatterbox/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install numpy
python -m pip install -r servers/tts/chatterbox/requirements.txt
python servers/tts/chatterbox/server.py
```

Mantén esa terminal abierta mientras TomoriBot esté usando Chatterbox. La URL del punto final predeterminado es `http://127.0.0.1:8011`; configure `CHATTERBOX_PORT` para usar otro puerto.

### Opcional: usa Chatterbox-Nano

Nano requiere una compilación Chatterbox con la opción de cargador `nano=True`. Después de la configuración normal anterior, instale la revisión anterior fijada en el mismo entorno virtual. El hash de confirmación corrige la versión fuente compatible; No es una garantía de seguridad. Este comando requiere `git` y mantiene las dependencias de tiempo de ejecución ya instaladas:

```sh
python -m pip install --no-deps --force-reinstall "git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
```

Luego configure `CHATTERBOX_FAST_MODEL=nano` antes de iniciar el contenedor. Deja la variable sin configurar para Turbo. En Windows PowerShell, configúrelo con `$env:CHATTERBOX_FAST_MODEL = "nano"`; en Linux o macOS, use `CHATTERBOX_FAST_MODEL=nano python servers/tts/chatterbox/server.py`. La respuesta `/health` informa `fast_model` para que pueda verificar la opción cargada. Nano y Turbo utilizan la misma solicitud de clonación y etiquetas de eventos compatibles. Ambos son solo en inglés.

El interruptor de modelo rápido `/config` debe permanecer habilitado para usar Nano o Turbo. Al desactivarlo, se selecciona el modelo estándar Chatterbox 0.5B para ajuste de exageración y peso CFG.

### Estándar Chatterbox (0.5B con CFG y exageración)

El modelo original Chatterbox base 0.5B (`ChatterboxTTS`) está integrado directamente en el contenedor del servidor. Cambia las etiquetas de eventos de paréntesis en línea de Turbo por un control vocal detallado utilizando la guía sin clasificador (`cfg_weight`) y el emocional `exaggeration`.

Para utilizar el modelo Estándar:
1. Inicia el contenedor del servidor como de costumbre.
2. En Discord, ejecute `/config` > `Modelos` > `Parámetros y voces TTS`.
3. Desactiva la opción `Fast Model (Turbo)`.
4. En la próxima generación, el contenedor descarga y carga lentamente el modelo estándar 0.5B en la memoria.

Ambos valores son campos de texto en el modal `Editar parámetros`. Siempre son editables y la página indica que se ignoran mientras el modelo rápido está habilitado:
- **`cfg_weight`** (predeterminado `0.5`): ajusta qué tan cerca se adhiere el audio sintetizado al tempo de referencia y al estilo vocal.
- **`exaggeration`** (predeterminado `0.5`): controla la intensidad emocional y la inflexión dramática de la entrega.

> [!NOTA]
> El Chatterbox estándar no admite etiquetas de eventos de corchetes en línea (como `[laughs]` o `[sigh]`). TomoriBot elimina automáticamente las etiquetas de corchetes del texto del mensaje cuando la opción Modelo rápido está desactivada.

## Registro en TomoriBot

Incluye `Chatterbox` en la etiqueta del punto de conexión o en el nombre del modelo. TomoriBot reconoce un endpoint de Chatterbox solo por ese nombre (o una URL del punto de conexión que lo contenga), por lo que la lista blanca de etiquetas de Turbo, la eliminación de etiquetas del modelo estándar y las opciones de Chatterbox en `/generate voice-message` se aplican solo cuando está presente.

Ejecuta `/providers`, elige `Agregar nuevo punto de conexión personalizado` y usa la compatibilidad de API de voz:

- Compatibilidad de API: `tts-clone`
- `endpoint_url`: `http://127.0.0.1:8011`

Después de guardar la conexión, selecciónala y usa su menú desplegable de modelos para agregar un modelo de Voz. Elige `Clon de voz` como el Modo de fuente de voz y `Etiquetas entre corchetes` como el Estilo de marcado del guion para que las etiquetas de entrega sobrevivan al envío.

Usa `/providers` para el registro del endpoint y la configuración del modelo. Luego abre `/config` > Modelos > `Cambiar modelos` para seleccionar y activar el endpoint registrado.

## Configurar una voz personal

1. Prepare un clip de voz limpio de 10 segundos con un altavoz y sin música de fondo.
2. Abre `/config` en Modelos > `Parámetros y voces TTS` y cargue el clip.
3. Abre `/config` en Persona > `Voz`, luego elija la persona y la muestra de voz.

Un clip más largo no aporta nada a Chatterbox y tampoco es rechazado. Su tiempo de ejecución trunca la referencia antes del acondicionamiento, por lo que el audio que pasa por la ventana se carga, almacena y luego se ignora ([`tts_turbo.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts_turbo.py), [`tts.py`](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/tts.py)):

- El aviso acústico es los primeros 10 segundos en cada variante.
- El contexto del token de voz son los primeros 15 segundos en Turbo y Nano, y 6 segundos en Estándar.

Esas ventanas son constantes en el tiempo de ejecución ascendente en lugar de una guía publicada: el archivo README del repositorio no proporciona la longitud del clip de referencia y su nombre de archivo de ejemplo es solo `your_10s_ref_clip.wav`. La duración que realmente impone el tiempo de ejecución es mínima, afirmando que el mensaje dura más de 5 segundos.

Por lo tanto, diez segundos es el objetivo práctico. Completa el mensaje acústico, que es donde se configuran el timbre y la entrega, y un clip de entre 10 y 15 segundos agrega contexto de token de voz solo en Turbo y Nano. La incrustación del hablante todavía se calcula a partir de todo el clip, por lo que alargarlo no cambia la identidad del hablante, solo la parte del mensaje que se descarta sin leer.

Turbo y Nano pueden usar etiquetas de eventos de soporte como `[laugh]` y `[sigh]` cuando la alternancia de modelo rápido está habilitada.

## Sintonización opcional

Utilice `/config` en Modelos > `Parámetros y voces TTS` para ajustar la carga útil de la solicitud Chatterbox:

- El cambio de modelo rápido está habilitado de forma predeterminada. TomoriBot mantiene las etiquetas de eventos Turbo/Nano compatibles y elimina los descriptores de corchetes no compatibles antes de que el contenedor llame a `ChatterboxTurboTTS.generate(...)`.
- `cfg_weight` tiene como valor predeterminado `0.5`. El mínimo es `0`; TomoriBot no establece un máximo estricto. Sólo aplica cuando `turbo` es `false`; Los valores más bajos pueden ayudar a ralentizar las voces de referencia rápidas, mientras que los valores más altos siguen la referencia con más fuerza.
- `exaggeration` tiene como valor predeterminado `0.5`. El mínimo es `0`; TomoriBot no establece un máximo estricto. Sólo aplica cuando `turbo` es `false`; los valores más altos hacen que la expresión sea más expresiva o dramática y pueden acelerar el habla.

Las etiquetas de eventos Turbo/Nano admitidas son `[clear throat]`, `[sigh]`, `[shush]`, `[cough]`, `[groan]`, `[sniff]`, `[gasp]`, `[chuckle]` y `[laugh]`. Los descriptores no admitidos, como `[excited]`, `[whisper]` o `[smiles]`, se eliminan en lugar de enviarse a TTS.

Cuando `turbo` está deshabilitado, TomoriBot elimina todos los descriptores de corchetes antes de enviar texto a TTS, luego el contenedor carga lentamente el modelo estándar `ChatterboxTTS` y llama a `model.generate(..., cfg_weight, exaggeration)`.
