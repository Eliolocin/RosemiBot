---
title: "Transcripción de KoboldCPP"
sidebar:
  order: 3
---

Utilice su instancia [KoboldCPP](https://github.com/LostRuins/koboldcpp) existente para transcribir archivos adjuntos de audio y mensajes de voz en TomoriBot.

KoboldCPP incluye conversión de voz a texto basada en Whisper. TomoriBot se conecta a KoboldCPP utilizando su punto final de transcripción de audio compatible con OpenAI (`POST /v1/audio/transcriptions`).

## Configuración

Inicia KoboldCPP con Whisper/STT habilitado y confirma que tu compilación expone:

- `POST /v1/audio/transcriptions`
- `GET /v1/models` o `GET /models`

Mantén KoboldCPP en ejecución mientras TomoriBot lo esté usando. Si tu compilación solo expone `/api/extra/transcribe` u otra forma personalizada, usa un envoltorio hasta que TomoriBot tenga un adaptador dedicado.

## Registro en TomoriBot

Ejecuta `/providers`, elige `Agregar nuevo punto de conexión personalizado` y usa la compatibilidad de API de transcripción:

- Compatibilidad de API: `openai-compatible-transcription`
- `endpoint_url`: la raíz de tu servidor KoboldCPP

Después de guardar la conexión, selecciónala y usa su menú desplegable de modelos para agregar el nombre del modelo que tu servidor reporta como un modelo de Transcripción.

Usa `/providers` para el registro del endpoint y la configuración del modelo. Luego abre `/config` > Modelos > `Cambiar modelos` para seleccionar y activar el endpoint registrado.

## Usar transcripciones

Después del registro, TomoriBot transcribe los archivos adjuntos de audio en segundo plano y agrega el texto al contexto del chat. Utilice `/config` > Motor > Avisos solo si también desea que las transcripciones se publiquen de manera visible en el chat.
