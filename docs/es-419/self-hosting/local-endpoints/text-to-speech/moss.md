---
title: "MOSS-TTS"
---

Evalúe la clonación de voz y el diseño de voz en lenguaje natural localmente a través de un punto final de voz unificado usando [MOSS-TTS](https://github.com/OpenMOSS/MOSS-TTS).

Al utilizar `servers/tts/moss/server.py`, TomoriBot enruta las solicitudes de síntesis de forma dinámica: carga el modelo de clonación cuando una persona proporciona `ref_audio` y cambia a MOSS-VoiceGenerator cuando se le proporciona orientación sobre `instruct` en lenguaje natural. Solo se mantiene un modelo en la memoria de la GPU a la vez para ejecutarse dentro de presupuestos de 16 GB de VRAM.

El modelo de clonación predeterminado es [MOSS-TTS-Local-Transformer-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5) (4B), seleccionado como base práctica para GPU de 16 GB. [MOSS-TTS-v1.5](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-v1.5) es una alternativa emblemática de 8B que requiere más VRAM en BF16. El diseño de voz utiliza [MOSS-VoiceGenerator](https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator) (aproximadamente 1.7B). El cambio entre clonación y diseño de voz genera un retraso en la carga del modelo.

## Configuración

Ejecuta comandos desde la raíz del repositorio TomoriBot usando Python 3.12 y un controlador compatible con CUDA 12.8:

### Windows PowerShell

```powershell
python -m venv servers\tts\moss\.venv
servers\tts\moss\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers\tts\moss\requirements.txt
python servers\tts\moss\prefetch_models.py
python servers\tts\moss\server.py
```

### Linux o WSL Bash

```bash
python3.12 -m venv servers/tts/moss/.venv
source servers/tts/moss/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 "moss-tts[torch-runtime] @ git+https://github.com/OpenMOSS/MOSS-TTS.git"
python -m pip install -r servers/tts/moss/requirements.txt
python servers/tts/moss/prefetch_models.py
python servers/tts/moss/server.py
```

El comando de captación previa descarga el modelo de clonación, VoiceGenerator y los tokenizadores de audio en su caché de Hugging Face antes de iniciar el servidor. Si el espacio en disco es limitado, configure `HF_HOME` en una partición más grande. Para descargar solo un modelo, pase `--mode clone` o `--mode voice-design`.

El punto final predeterminado es `http://127.0.0.1:8018`. Ejecuta `bun run launch --moss` para iniciar el servidor junto con TomoriBot. El modo automático precalienta el modelo clonado desde la memoria caché local. En su lugar, configure `MOSS_TTS_WARM_MODE=voice-design` para precalentar VoiceGenerator, o `MOSS_TTS_WARM_MODE=none` para una inicialización diferida. Verifique `GET /health` para ver si hay `warm_mode`, `active_mode` y `model_id` activos. El contenedor utiliza Hugging Face `trust_remote_code=True`, así que revise el código ascendente antes de las actualizaciones.

## Registro en TomoriBot

En `/providers`, elija `Add New Custom Endpoint`, establezca Compatibilidad de API en `tts-clone` y use la URL del punto final `http://127.0.0.1:8018`. Agrega un modelo de voz con `Modo de fuente de voz` configurado en `Automático` y `Script Markup` configurado en `Plano`. Actívelo en `/config` > `Modelos` > `Cambiar modelos`.

Para la clonación de voz, cargue un clip de referencia limpio en `/config` > `Modelos` > TTS Parameters & Voices y asígnelo en Persona > `Voz`. Los clips de audio más cortos y limpios producen resultados más consistentes. Para el diseño de voz, guarde una descripción en lenguaje natural en Persona > `Voz`. Tenga en cuenta que MOSS-VoiceGenerator está diseñado para inglés y chino. Si bien el modelo clonado 4B admite japonés, las etiquetas de idioma explícito mejoran la claridad de la síntesis.

El adaptador clonador de TomoriBot no envía etiquetas de idioma automáticamente. Para uso en un solo idioma, configure `MOSS_TTS_DEFAULT_LANGUAGE=Japanese` (o `Español (Latinoamérica)`, `Chinese`, etc.) antes de iniciar el servidor. Las llamadas manuales `/synthesize` pueden pasar directamente a `language`.

El servidor lee su propio entorno shell; La configuración en el `.env` del bot no se aplica a una terminal Python iniciada de forma independiente.

Para ejecutar el modelo 8B en hardware con mucha memoria, configure `MOSS_TTS_CLONE_MODEL_ID=OpenMOSS-Team/MOSS-TTS-v1.5` antes de la captación previa. `MOSS_TTS_PORT`, `MOSS_TTS_DEVICE`, `MOSS_TTS_DTYPE` y `MOSS_TTS_MAX_NEW_TOKENS` se pueden configurar en `.env.optional.example`. Aumente `TTS_SYNTHESIZE_TIMEOUT_MS` en TomoriBot si los cambios de modelo o la ejecución de la CPU provocan tiempos de espera.
