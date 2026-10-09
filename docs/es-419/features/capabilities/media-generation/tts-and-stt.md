---
title: "Voz: TTS y STT"
sidebar:
  order: 3
---

TomoriBot puede hablar y escuchar en Discord: enviar respuestas de voz con texto a voz (TTS) y transcribir mensajes de audio en contexto de conversación con voz a texto (STT).

Ambos utilizan el sistema de punto final del proveedor. ElevenLabs es la opción de nube más rápida. También puede ejecutar modelos de voz locales en su propio hardware utilizando motores autohospedados.

## Texto a voz
<!-- anchor: text-to-speech -->

### ElevenLabs (en la nube, opción más sencilla)

1. Obtenga una clave API de [ElevenLabs](https://elevenlabs.io/app/settings/api-keys).
2. Ejecuta `/providers`, elija `Agregar nuevo proveedor`, seleccione `ElevenLabs` y pegue la clave. Este flujo:
   - registra el punto final de voz y el punto final de transcripción ElevenLabs,
   - activa ambos puntos finales,
   - Opcionalmente, asigna una voz a una persona de inmediato.
3. Asigne voces a personas adicionales en `/config` > `Persona` > Voz. Busque voces en la [Biblioteca de voces ElevenLabs](https://elevenlabs.io/app/voice-library), donde también puede clonar las suyas.

Selecciona ElevenLabs en `/providers`, luego elija `Editar punto de conexión` siempre que necesite actualizar la clave.

Notas:

- En el plan gratuito, solo funcionan las voces prefabricadas. Explore la [lista de voces prefabricada](https://elevenlabs-sdk.mintlify.app/voices/premade-voices).
- Los caracteres se cuentan cuando genera mensajes de voz. El nivel gratuito tiene límites mensuales, así que controle su panel ElevenLabs.
- Las respuestas de voz requieren `voice_message_enabled` en `/config` > `Permisos`, y la persona activa debe tener una voz asignada.
- Cambiar `/config` > `Persona` > Voz requiere el permiso Administrar servidor en un servidor y permanece disponible para el propietario en los mensajes directos.

En `/help`, elija `Funciones` y luego `Voz` para ver el tutorial interactivo en Discord.

### Motores locales de clonación de voz (con autoalojamiento)

En instancias autohospedadas, puede ejecutar un servidor de clonación de voz local. El flujo de trabajo: inicie el servidor, registre su conexión y modelo en `/providers`, selecciónelo en `/providers`, cargue una muestra de referencia en `/config` > `Modelos` > TTS Parameters & Voices, luego asígnela en `/config` > `Persona` > Voice. Se acepta cualquier formato de audio (convertido automáticamente a mono WAV); Los clips de 10 a 20 segundos sin música de fondo funcionan mejor.

Cada motor tiene su propia guía de configuración:

- [Chatterbox-Turbo/Nano](/es-419/self-hosting/local-endpoints/text-to-speech/chatterbox/): clonación rápida de voz en inglés con etiquetas de emociones como `[laugh]`.
- [Qwen3-TTS](/es-419/self-hosting/local-endpoints/text-to-speech/qwen3tts/): multilingüe (10 idiomas) más un modo VoiceDesign en lenguaje natural.
- [MOSS-TTS](/es-419/self-hosting/local-endpoints/text-to-speech/moss/): clonación multilingüe y diseño de voz en inglés o chino.
- [IrodoriTTS](/es-419/self-hosting/local-endpoints/text-to-speech/irodoritts/): motor especializado en japonés que lee emojis como señales emocionales.

Consulta la [tabla de comparación de texto a voz](/es-419/self-hosting/local-endpoints/text-to-speech/) para obtener orientación sobre el hardware y la lista completa de motores.

## Voz a texto
<!-- anchor: speech-to-text -->

Los puntos finales de transcripción convierten los archivos adjuntos de audio del usuario en texto para el contexto de la conversación. Si las transcripciones se publican públicamente en el chat se controla en `/config` > `Comportamiento` > Comportamiento de aviso.

### ElevenLabs (en la nube)

Agregar ElevenLabs desde `/providers` registra el punto final de transcripción junto con la voz. Utilice `/providers` para cambiar entre puntos finales de transcripción activa.

### Motores locales (con autoalojamiento)

- [WhisperX](/es-419/self-hosting/local-endpoints/speech-to-text/whisperx/): ruta local recomendada; alrededor de 100 idiomas, acelerado por GPU, múltiples tamaños de modelos.
- [KoboldCPP](/es-419/self-hosting/local-endpoints/speech-to-text/koboldcpp/): funciona cuando su compilación expone un punto final de transcripción compatible con OpenAI.
- [susurro.cpp](/es-419/self-hosting/local-endpoints/speech-to-text/whispercpp/).

Consulta el centro [Voz a texto](/es-419/self-hosting/local-endpoints/speech-to-text/) para obtener la lista completa de motores. Para el resumen de Discord, ejecute `/help`, luego elija `Funciones` y `Transcripción`.
