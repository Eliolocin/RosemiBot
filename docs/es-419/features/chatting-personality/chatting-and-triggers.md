---
title: "Chat y activadores"
sidebar:
  order: 1
---

TomoriBot responde cuando se le invoca. Esta página cubre las formas en que se puede activar, cómo habilitar el chat con manos libres con activación automática y cómo evitar activaciones accidentales con el modo de activación deliberada.

## Cómo activarla
<!-- anchor: how-to-trigger-her -->

De forma predeterminada, ella responde cuando tú:

- **Mencionarla**: `@TomoriBot`
- **Responder** a uno de sus mensajes (incluido el mensaje de webhook de una persona)
- **Utilice una palabra de activación**: cualquier palabra de activación registrada en cualquier parte de un mensaje.
- **Utilice `/respond`**: solicite una respuesta manualmente

En un DM, envíe un mensaje directamente sin ninguna palabra de activación ni mención.

### Administrar palabras de activación
<!-- anchor: managing-trigger-words -->

Los administradores de servidores usan `/config` > `Persona` > Activadores para agregar o eliminar palabras de activación para la persona activa. Los miembros sin Administrar servidor pueden ver los activadores existentes en modo de solo lectura.

## Expresiones y reacciones
<!-- anchor: expressions--reactions -->

Al responder, puede usar emojis, stickers y reacciones emoji personalizados del servidor:

- Los emojis personalizados aparecen de forma natural en las conversaciones con la sintaxis `:name:`.
- Puede enviar una calcomanía por respuesta, como su propio mensaje antes, entre o después de su mensaje de texto.
- Los administradores de servidores pueden agregar [expresiones personalizadas](/es-419/features/chatting-personality/behavior-tweaking/#expressions) con `/expressions manage`: GIF de reacción, chistes con imágenes o enlaces a cualquier sitio web.
- Ejecuta `/expressions initialize` para que sepa cuándo encaja cada emoji y sticker del servidor.

## Canales de roleplay
<!-- anchor: roleplay-channels -->

Los canales de juegos de rol suprimen los mensajes de stickers y emojis personalizados en sus respuestas. Los miembros también pueden usar `/tool delete turn` en canales de juegos de rol para eliminar su último turno sin necesidad del permiso Administrar servidor.

Configura canales de juego de rol en `/config` > `Canales` > Reglas del canal.

## Consciencia situacional

Cada vez que responde, recibe un contexto que describe dónde y cuándo ocurre la conversación:

- **Ubicación**: el nombre del servidor, el nombre del canal o si el chat es un Mensaje Directo.
- **Hora**: hora local del servidor y hora del día desde `/config` > `Comportamiento` > `Comportamiento general`, además de relojes locales para usuarios que configuran una zona horaria en `/personal config`.
- **Participantes**: nombres para mostrar, identificadores de menciones, etiquetas de apariencia y recordatorios pendientes.
- **Actividad Discord**: qué están reproduciendo, transmitiendo, escuchando los participantes actualmente (como pistas de Spotify) o su estado personalizado.

El estado de actividad requiere la intención `Guild Presences` de Discord y respeta la privacidad del usuario (`/personal config`). Los usuarios que aumentan su configuración de privacidad no se incluyen en el contexto de presencia.

## Activación automática (chat sin manos)

La activación automática permite a TomoriBot unirse a conversaciones sin ser mencionado directamente:

- `/config` > `Canales` > Auto-Trigger (o `/server autotrigger channels`): elige canales donde responda de forma autónoma.
- `/config` > `Canales` > Activación automática (o `/server autotrigger threshold`): establece cuántos mensajes deben acumularse antes de que ella intervenga.
- `/config` > `Comportamiento` > Comportamiento del disparador: configura disparadores aleatorios basados en temporizador para un canal.

Utilice la activación automática en canales casuales dedicados donde desee que el bot participe de forma natural.

## Modo de activación deliberada
<!-- anchor: deliberate-trigger-mode -->

Si el nombre de una persona se usa con frecuencia en una conversación normal, las palabras de activación simples pueden activarla por accidente. El modo de activación deliberada (DTM) evita la activación accidental al ignorar las palabras de activación sin adornos.

Cuando DTM está activa:

- `@{trigger}` (la palabra de activación con el prefijo `@`) genera una respuesta
- Discord menciona que `@TomoriBot` aún genera una respuesta
- Las respuestas a los mensajes siguen funcionando
- `/respond` todavía funciona
- Las palabras de activación simples sin `@` ya no la desencadenan.

### Control del servidor y personal

- `/server dtm`: los administradores del servidor alternan el valor predeterminado del servidor.
- `/personal config`: los miembros individuales anulan la configuración de sus propios mensajes:
  - `off`: permitir siempre palabras de activación simples
  - `follow`: sigue la configuración del servidor
  - `on`: siempre requiere invocación deliberada

En `/help`, elija `Comportamiento` y luego `Modo de Activación Deliberada` para obtener el resumen de Discord.

:::note
El modo de activación deliberada (esta página) controla cuándo responde. El modo de herramienta deliberada controla qué herramientas se presentan al modelo en un turno. Ambos se abrevian "DTM" en Discord; consulte [Herramientas y extensiones](/es-419/features/capabilities/tools-and-extensions/#deliberate-tool-mode).
:::
