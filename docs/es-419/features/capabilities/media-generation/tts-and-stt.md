---
title: "Voz: TTS y STT"
sidebar:
  order: 3
aiGenerated: true
---

TomoriBot puede hablar y escuchar en Discord: enviar respuestas de voz con texto a voz (TTS) y transcribir mensajes de audio en contexto de conversación con voz a texto (STT).

Elige proveedores de voz en `/providers`, o usa `/personal providers` para tus propios modelos de voz de Google u OpenRouter. También puedes ejecutar modelos de voz locales en tu propio hardware.

## Texto a voz
<!-- anchor: text-to-speech -->

### Voces de Google y OpenRouter

Agregar Google selecciona Gemini Flash TTS para `TTS (Diseño de voz)`. Agregar OpenRouter selecciona el modelo de pago Fish S2.1 Pro para `TTS (Clon de voz)`, y completa `TTS (Diseño de voz)` con Seed Audio 1.0 únicamente cuando esa ranura está vacía. OpenRouter nunca reemplaza un diseño de Gemini o Vertex que ya hayas elegido, por lo que ambos proveedores pueden permanecer activos al mismo tiempo. Si agregaste OpenRouter antes de que Seed estuviera disponible, tu ranura de Diseño permanecerá vacía hasta que elijas Seed. Agregar la clave de OpenRouter de nuevo también llenará una ranura de Diseño vacía con Seed, incluida una que hayas limpiado a propósito. Flash-Lite y Fish gratuito requieren una selección de modelo explícita; la disponibilidad y las cuotas de los proveedores siguen aplicando. Usa `/config` > Modelos > Cambiar modelos para cambiar o limpiar cualquiera de las dos ranuras.
Las selecciones personales y sus controles para activarlas o desactivarlas están en `/personal config` > Modelos > Cambiar modelos. Desactivar un modo personal permite que ese modo use la selección del servidor mientras el otro sigue activo.

Usa una clave de API para el proveedor en el mismo ámbito que la selección. Una suscripción de chat por sí sola no otorga acceso a la API. El [nivel gratuito de la API](https://ai.google.dev/gemini-api/docs/pricing) de Gemini tiene cuotas de proyecto y requisitos de elegibilidad; verifica el acceso en AI Studio. Fish gratuito es un código de modelo independiente, `fish-audio/s2.1-pro-free:free`, y debe seleccionarse explícitamente. Una falla en un modelo personal gratuito aún puede recurrir a la selección de pago del servidor cuando Respaldo al modelo del servidor está activado.

En `/config` > Persona > Voz, elige `Describir voz` para guardar una descripción de hasta 1,000 caracteres. Puedes redactarla antes de elegir un modelo. Para usar Fish o un modelo de clonación local, agrega una referencia en `/config` > Modelos > Parámetros y voces TTS y asígnala en la página Voz de la persona. Ambas entradas permanecen guardadas cuando cambias de proveedor. Elige `Diseño de voz` o `Clon de voz` para establecer la prioridad; si la entrada preferida no tiene un modelo coincidente o una voz utilizable, se puede usar la otra entrada guardada. La página explica qué fuente es efectiva para las selecciones del servidor.

Ejecuta `/generate voice-message` para ingresar un guion corto, o pídele a la persona que envíe un mensaje de voz. El comando también acepta una descripción única o la carga de una referencia. Las descripciones guardadas reutilizan una identidad de voz de Gemini; las ediciones la retiran. Las descripciones de una sola vez crean una identidad temporal que el bot elimina después de la generación. Si la limpieza falla, se vuelve a intentar cuando se vuelvan a usar esas credenciales; los administradores podrían necesitar eliminar voces en la consola del proveedor después de una falla o un tiempo de espera ambiguo.
Las descripciones se incluyen en las tarjetas de persona exportadas en PNG y JSON; las identidades de voz remotas y las asignaciones de referencia se excluyen. Google almacena la identidad diseñada en el proyecto de la API. La clonación con audio de referencia de Gemini está postergada hasta que el bot pueda recopilar grabaciones de consentimiento.

Seed Audio funciona de manera diferente a Gemini. Construye la voz a partir de la descripción cada vez que habla, por lo que la misma descripción puede sonar un poco diferente de un mensaje a otro. Si necesitas una voz que se mantenga constante, usa Gemini o una muestra de referencia. Seed funciona mejor en inglés y chino y produce un máximo de dos minutos de audio por mensaje, por lo que sus guiones se limitan a 1,100 caracteres. La descripción, cualquier indicación de entonación y el guion también comparten un total de 2,048 caracteres, por lo que una descripción larga deja menos espacio para el guion. Un guion que no quepa se rechazará antes de enviar nada, y el bot te pedirá que lo acortes.
OpenRouter factura Seed por segundo de audio, lo que cuesta aproximadamente diez veces más por minuto que Fish. Para cambiar a Gemini o limpiar la ranura, usa `/config` > Modelos > Cambiar modelos.

Las fallas de voz personales siguen la configuración de Respaldo al modelo del servidor y los permisos del servidor. Un respaldo exitoso aparece en el comprobante del comando. Los proveedores pueden facturar trabajos fallidos o cancelados; los límites de guion y de audio no establecen un límite de gasto.

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
