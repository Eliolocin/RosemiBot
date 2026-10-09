---
title: "Transcripción con whisper.cpp"
sidebar:
  order: 2
---

Ejecuta conversión de voz a texto liviana y de alto rendimiento para TomoriBot usando [whisper.cpp](https://github.com/ggerganov/whisper.cpp).

TomoriBot se conecta a Whisper.cpp a través de su punto final de transcripción de audio compatible con OpenAI (`POST /v1/audio/transcriptions`).

## Configuración

Inicia tu servidor HTTP de whisper.cpp y confirma que expone un endpoint de transcripción compatible con OpenAI:

- `POST /v1/audio/transcriptions`
- `GET /v1/models` o `GET /models`

Mantén el servidor en ejecución mientras TomoriBot lo esté usando. La URL del endpoint es la raíz del servidor, por ejemplo `http://127.0.0.1:8022`.

Si tu compilación de whisper.cpp expone otra forma de endpoint, coloca un envoltorio ligero delante que traduzca las solicitudes al formato compatible con OpenAI que TomoriBot espera.

## Registrar en TomoriBot

Ejecuta `/providers`, elige `Agregar nuevo punto de conexión personalizado` y usa la compatibilidad de API de transcripción:

- Compatibilidad de API: `openai-compatible-transcription`
- `endpoint_url`: la raíz de tu servidor de whisper.cpp

Después de guardar la conexión, selecciónala y usa su lista desplegable de modelos para agregar el nombre del
modelo que tu servidor reporta como modelo de transcripción.

Usa `/providers` para registrar el endpoint y configurar el modelo. Luego abre `/config` > Modelos > `Cambiar modelos` para seleccionar y activar el endpoint registrado.

## Usar transcripciones

Después del registro, TomoriBot transcribe los archivos adjuntos de audio en segundo plano y agrega el texto al contexto del chat. Utilice `/config` > Motor > Avisos solo si también desea que las transcripciones se publiquen de manera visible en el chat.
