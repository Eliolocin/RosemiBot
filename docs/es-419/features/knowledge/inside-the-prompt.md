---
title: "Dentro del prompt"
sidebar:
  order: 2
aiGenerated: false
---

Cada vez que activa TomoriBot, lo siguiente se ensambla y envía a su modelo de texto configurado como mensaje/contexto principal, en este orden:

| Bloquear | ¿Opcional? | Comandos | que es |
|---|---|---|---|
| [Mensaje del sistema](/es-419/features/chatting-personality/behavior-tweaking/#system-prompt) |  | `/config` > Motor > General | Instrucciones básicas en la parte superior del contexto. |

> **Texto de aviso del sistema predeterminado**: se usa solo cuando no hay ningún aviso del sistema del servidor configurado. >
> *"Eres {bot}. {bot} se asegura de responder de forma breve y concisa de forma predeterminada. {bot} solo da respuestas largas si la situación lo amerita. >
> {{if tool:create_long_term_memory}}{bot} utiliza proactivamente la {memory_tool} disponible cada vez que alguien comparte un detalle o {bot} nota uno en la conversación que realmente vale la pena recordar, como una preferencia, un interés o un hecho importante, prefiriendo recordar cosas incluso si son menores, siempre y cuando no sean un duplicado de lo que {bot} ya sabe. {{/if}}{{if tool:update_long_term_memory}}{bot} usa {memory_update_tool} en su lugar cuando nueva información cambia o se suma a algo que {bot} ya recuerda, en lugar de guardar un duplicado.{{/if}} >
> {{if tool:review_capabilities}}Cuando alguien pregunta qué puede hacer {bot} o por qué algo no está disponible, {bot} verifica {capabilities_tool} antes de responder. {{/if}}{{if tool_family:url_fetch}}Cuando se necesitan más detalles, {bot} utiliza {url_fetch_tool} en `https://docs.tomoribot.app/llms.txt` para obtener información.{{/if}}"*

| Bloquear | ¿Opcional? | Dominio | que es |
|---|---|---|---|
| Mensaje de canal (añadir) | *(Opcional)* | `/config` > `Canales` > Anulación de canales | Varía según el canal y se superpone justo después del mensaje del sistema. El modo *reemplazar* de la misma página ocupa el espacio de aviso del sistema anterior en lugar de agregar uno nuevo. |
| Mensaje de persona | *(Opcional)* | `/config` > `Persona` > Avanzado | Un mensaje escrito específicamente para la persona activa, separado del mensaje del sistema. |
| [Atributos personales](/es-419/features/chatting-personality/multiple-personas/#attributes) |  | `/config` > `Persona` > `Identidad y personalidad` | Los rasgos de personalidad y los patrones de habla de la persona activa. |
| información del servidor |  | *(ninguno, de Discord)* | El nombre del servidor, la descripción y el canal en el que se encuentra, extraídos del propio Discord. |
| [Bloqueos persona-usuario](/es-419/features/capabilities/tools-and-extensions/#built-in-tools) | *(Opcional)* | `/moderation` para revisar/borrar; cerrado por `/config` > `Permisos` (Bloqueo de usuario) | Restricciones activas de silencio/bloqueo que esta persona tiene contra usuarios específicos. |
| [Memorias del servidor](/es-419/features/knowledge/memory/#personal-vs-server-memories) |  | `/memories` | Los hechos a largo plazo guardados para este servidor. |
| [emojis del servidor](/es-419/features/chatting-personality/behavior-tweaking/#capabilities-what-shes-allowed-to-do) | *(Opcional)* | `/config` > `Plugins` > `Adiciones de contexto` (`Emojis en respuestas`) (solo alternar), inicializar con `/expressions initialize` | Los emojis personalizados presentes en el servidor. |
| [Pegatinas del servidor](/es-419/features/chatting-personality/behavior-tweaking/#expressions) | *(Opcional)* | `/config` > `Plugins` > `Herramientas disponibles` (`Uso de Stickers`), clasificar activos nativos con `/expressions initialize`, administrar con `/expressions manage` | Calcomanías nativas que se pueden enviar y todas las expresiones personalizadas elegibles para la persona que responde, con nombres, descripciones y emociones. Las fuentes de medios y las reglas de acceso de personas permanecen fuera del aviso. |
| [Sprites personales](/es-419/features/chatting-personality/multiple-personas/#sprites-emotion-avatars) | *(Opcional)* | `/config` > `Persona` > Sprites | Sprites de expresión con nombre configurados para la persona, si tiene alguno. |
| [Participantes de la conversación](/es-419/features/knowledge/memory/#personal-vs-server-memories) | *(Opcional)* | `/personal memories` (cerrado por `/config` > `Permisos` (Personalización)) | Las personas en la conversación, sus apodos y menciones, y los recuerdos personales guardados sobre cada uno de ellos. Se carga cuando la persona posee un mensaje en contexto, o si se menciona su nombre/alias. También lleva el canal actual y la hora local como pie de página, usando `/config` > Motor > General. |
| [Memoria a corto plazo](/es-419/features/knowledge/memory/#short-term-memory-stm) |  | `/config` > `Persona` > Recuerdos; `/memories` para borrar entradas; cerrado por `/config` > `Permisos` (memoria a corto plazo) | Contiene resúmenes y mensajes recientes de diferentes canales. |
| [`Documentos`](/es-419/features/knowledge/memory/#document-knowledge-base-rag) | *(Opcional)* | `/memories` | Partes relevantes extraídas de la base de conocimientos mediante RAG. |
| [Condicionamiento](/es-419/features/knowledge/memory/#conditioning) | *(Opcional)* | `/reward <feed\|headpat\|hug\|kiss\|tickle>`, `/punish <bite\|bonk\|pinch\|spank\|squeeze>`; administrado con `/conditioning remove` | Preferencias de comportamiento acumuladas para esta persona en este servidor. |
| [Diálogos de muestra](/es-419/features/chatting-personality/multiple-personas/#sample-dialogues) | *(Opcional)* | `/config` > `Persona` > `Identidad y personalidad` | Ejemplos de cómo habla esta persona, si hay alguno configurado. |
| [Mensajes recientes](/es-419/features/chatting-personality/behavior-tweaking/#generation-tuning) |  | `/config` > Motor > General | La conversación real, hasta esta cantidad de mensajes (80 por defecto). Su nota de contexto y cualquier nota de reunión se insertan en línea dentro de este bloque, en una profundidad configurable, en lugar de ser un bloque independiente. |

Las filas marcadas *(Opcional)* no aportan nada (y no cuestan tokens) cuando no hay nada que decir, p. no hay documentos que coincidan o el servidor no tiene emojis personalizados.

Los mensajes recientes son la parte más grande y frágil, es una ventana que se desliza hacia adelante a medida que la gente habla. Todo lo que está encima de ellos se reconstruye a partir de la configuración guardada y es estable.

`/tool prompt snapshot` vuelca el paquete exacto de una persona en un archivo. Es la verdad fundamental sobre qué recuerdos están actualmente activos, si un documento coincide y qué parte de la conversación realmente encaja.

`/context` dibuja el mismo paquete como una cuadrícula de colores de la ventana contextual del modelo, un color por cada grupo de bloques de arriba, para que puedas ver de un vistazo qué lo llena y cuánto espacio queda. Un círculo marca un grupo más pequeño que un cuadrado. También muestra el costo de entrada estimado por respuesta y cuántos tokens de entrada informó el proveedor para la última respuesta real.

`/tool estimate cost` desglosa el mismo paquete por tamaño, lo cual es útil para determinar qué está consumiendo su contexto antes de aumentar los límites.

### ¿Dónde se definen las herramientas?

Para cada proveedor que TomoriBot admite de forma nativa, los esquemas de herramientas se envían a través del propio campo `tools` del proveedor, por lo que depende del proveedor/motor de inferencia configurado.

### ¿Por qué TomoriBot olvida?

Este orden explica casi todos los "¿por qué no se acuerda?" pregunta:

| Qué pasó | Por qué |
|---|---|
| Ella olvidó algo de hoy | Pasó el límite de mensajes. Solo estuvo en Mensajes recientes, si Tomori no lo guarda como memoria a largo plazo, se olvidará una vez que salga de la ventana del mensaje. |
| Se le olvidó algo en otro canal. | Los mensajes recientes son por canal. Sólo las memorias del servidor, los participantes de la conversación y la memoria a corto plazo cruzan canales. La memoria a corto plazo soluciona esto cargando mensajes recientes de diferentes canales, pero no lo descarta todo. |
| `/refresh` la hizo olvidar | Actualizar corta los mensajes recientes y borra la memoria a corto plazo de este canal, pero no debería eliminar la memoria a largo plazo. Elimina la inserción de actualización para eliminar el corte. |
| Olvidó algo después de reiniciar | Los mensajes recientes nunca sobreviven a los reinicios |

Si quieres que algo sobreviva a todo lo anterior, tiene que convertirse en una memoria a largo plazo. Consulta [Memoria](/es-419/features/knowledge/memory/#long-term-memory).

## Consejos y trucos

- `/config` > Motor > General amplía la ventana de conversación (20-100 mensajes). Más
  contexto, más tokens por respuesta.
- `/config` > Motor > General inyecta un recordatorio breve a una profundidad elegida. Como se
  ubica bajo en el paquete, cerca de los mensajes recientes, es más probable que actúe según él
  que según algo en el prompt del sistema. Este es el mejor lugar para animarla a guardar
  memorias con más frecuencia.
- `/personal memories` y `/memories` escriben directamente en `Memorias del servidor` y
  Participantes de la conversación, lo cual es una de las formas garantizadas de hacer
  permanente el conocimiento en el contexto de TomoriBot.
