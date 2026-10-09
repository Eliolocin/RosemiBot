---
title: "Moderación del servidor"
sidebar:
  order: 2
---

TomoriBot proporciona a los administradores de servidores un control detallado sobre el uso, los costos, los permisos y los canales a través de `/moderation` y `/config`. La mayoría de estos controles requieren el permiso `Administrar servidor`. Para obtener una lista completa de comandos, consulte la [Referencia de comandos](/es-419/features/command-reference/).

## Control de costo: cuotas
<!-- anchor: cost-control-quotas -->

La generación cuesta dinero, ya sea que la paguen desde su cuenta de proveedor o sus miembros. Uso del límite de cuotas por usuario y en todo el servidor:

- **Configurar límites**: en `/moderation` > `Cuotas`, configure límites diarios por usuario y grupos de restablecimiento en todo el servidor para la generación de texto, imágenes y videos. Establece un límite por usuario en `0` de forma ilimitada.
- **Restablecimientos manuales**: ejecute `/quota reset user` para borrar el uso diario de un miembro, o `/quota reset global` para restablecer todo el grupo del servidor.

Los grupos de todo el servidor se restablecen automáticamente en un intervalo configurable en días.

## BYOK de usuario (trae tu propia clave)
<!-- anchor: user-byok-bring-your-own-key -->

En `/moderation` > `Acceso de miembros`, puedes controlar si los miembros pueden usar IA financiada por el servidor:

- **Modelos de servidor permitidos** (predeterminado): los miembros utilizan proveedores configurados en el servidor.
- **Se requieren proveedores personales**: los miembros deben configurar sus propias claves API a través de `/personal providers`. El servidor no paga nada por los mensajes iniciados por los miembros. Las acciones iniciadas por el servidor (como saludos automatizados o tareas programadas) aún utilizan el proveedor del servidor.

Los miembros configuran sus proveedores personales en [Personalización](/es-419/features/knowledge/personalization/#your-own-providers).

También puede iniciar un servidor sin un proveedor de texto del lado del servidor eligiendo `BYOK del Usuario` durante `/setup`.

## Control de acceso: listas blancas

Utilice `/moderation` > `Lista blanca` para restringir dónde y cómo responde TomoriBot:

- **Canales**: elija qué canales permiten respuestas de bot y establezca anulaciones de tiempo de reutilización específicas del canal. Los canales heredan el tiempo de reutilización global a menos que se establezca una anulación.
- **Personas**: restringe los canales en los que puede activarse una persona específica.
- **Roles**: restringe las interacciones del bot a miembros con roles específicos de Discord.

Configura el tiempo de reutilización de la respuesta global en todo el servidor en `/config` > `Comportamiento` > Comportamiento del disparador.

## Controles de aprendizaje y privacidad

- **Permisos de miembros**: en `/moderation` > `Acceso de miembros`, haga clic en `Editar permisos` para controlar si los miembros sin `Administrar servidor` pueden administrar memorias del servidor, atributos de persona, diálogos de muestra o inspeccionar instantáneas de mensajes.
- **Lista negra de usuarios**: en `/moderation` > `Lista negra de usuarios`, elija miembros para que TomoriBot los ignore por completo. Los miembros de la lista negra no pueden activarla ni ejecutar comandos, y sus mensajes nunca llegan al contexto del mensaje. También puede establecer bloqueos de miembros específicos de una persona.
- **Reglas del canal**: en `/config` > `Canales` > Reglas del canal, marque los canales privados (donde la memoria a corto plazo permanece aislada y los registros de pensamiento se suprimen) y las listas de bloqueo de herramientas entre canales.

## Transparencia: registros de pensamiento

En `/config` > `Canales` > Registros y bienvenida, haga clic en `Establecer canal de registros` para designar un canal donde TomoriBot publica su razonamiento interno, avisos alternativos y llamadas de herramientas exitosas. Esto es útil para auditar lo que está haciendo, incluido qué disparador expuso una herramienta en [Modo de herramienta deliberada](/es-419/features/capabilities/tools-and-extensions/#deliberate-tool-mode).

El registro solo copia de canales que todos los miembros de tu servidor ya pueden ver. La actividad en un canal o hilo que algunos miembros no pueden abrir queda fuera del registro, por lo que el registro nunca muestra contenido que no pudieran leer donde ocurrió. El canal de registros debe estar en el mismo servidor.

## Saludos de bienvenida

En `/config` > `Canales` > Registros y bienvenida, configure saludos automatizados para nuevos miembros en un canal elegido. TomoriBot espera hasta que el nuevo miembro complete la evaluación y la incorporación de las reglas de Discord antes de enviar el saludo. Si un miembro se va antes de finalizar la evaluación, no se envía ningún saludo. Haz clic en `Borrar bienvenida` en esa misma página para desactivar los saludos.

## Expresiones

Ejecuta `/expressions initialize` para indexar los emojis y stickers personalizados de su servidor para que las personas puedan usarlos con precisión en la conversación. Para saber cómo las personas usan emojis, stickers y reacciones, consulte [Expresiones y reacciones](/es-419/features/chatting-personality/chatting-and-triggers/#expressions--reactions).
