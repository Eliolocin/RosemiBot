---
title: "Herramientas y extensiones"
sidebar:
  order: 1
---

Más allá del chat, TomoriBot puede llamar a herramientas para buscar en la web, leer documentos, generar medios, configurar recordatorios e interactuar con mensajes de Discord. Ella decide cuándo usarlos según la conversación. Esta página cubre las herramientas integradas, cómo ampliarla con servidores MCP y cómo mantener las indicaciones optimizadas con el modo de herramienta deliberada.

A continuación se muestran algunos ejemplos de lo que las herramientas permiten en la conversación:

- **1. Comprobador de bienestar**
  ```text
  Every few hours, do a mandatory wellness check on @bau_h.
  Ask them how they feel right now and if they've taken a break from coding recently.
  Track their emotional state over time with {memory_tool} and/or {memory_update_tool} to report back to them later.
  ```
- **2. Noticias semanales de Yuri**
  ```text
  Every Friday, compile the week's notable yuri manga chapters, anime episodes, and community fanart drops using {web_search_tool}.
  Present findings with {voice_message_tool} in a seductive ASMR voice.
  ```
- **3. Policía del sueño**
  ```text
  If you notice through {message_metadata_tool} that someone is chatting past 2 AM, use {voice_message_tool} to send them a threateningly calm ASMR lullaby telling them to go to bed.
  If they keep talking 10 minutes later, use {manage_message_tool} to delete their message for their own good and remind them that sleep deprivation is a leading cause of their issues.
  ```

## Herramientas integradas
<!-- anchor: built-in-tools -->

Las herramientas dependen del proveedor activo y del modelo que respalda la llamada de herramientas. Muchos están cerrados detrás de un indicador de característica (`/config` > `Permisos`), un permiso Discord, una capacidad de modelo o una clave API opcional.

| Herramienta | Macro rápida | Requiere | que hace |
|---|---|---|---|
| Capacidades de revisión | `{capabilities_tool}` | - | Verifique las capacidades, comandos o configuraciones actuales del chat antes de responder. |
| Crear/actualizar memoria a largo plazo | `{memory_tool}` / `{memory_update_tool}` | `self_teaching_enabled` | Guarda o reemplace un dato de servidor estable o una preferencia de usuario. |
| Actualizar la memoria a corto plazo | `{short_term_memory_tool}` | (no en NovelAI) | Guarda la memoria de trabajo temporal para el canal actual o el arco de la historia. |
| Crear/actualizar tarea | `{task_tool}` / `{task_update_tool}` | - | Programe o edite recordatorios y tareas automáticas (consulte [Tareas programadas](/es-419/features/capabilities/scheduled-tasks/)). |
| Mensaje multicanal | `{cross_channel_tool}` | (no en NovelAI) | Actuar en otro canal o hilo, con reporte opcional. |
| Crear hilo | `{create_thread_tool}` | `thread_creation_enabled` + permisos de hilo | Abre un hilo público y publique su mensaje inicial. |
| Seleccionar sticker | `{sticker_tool}` | `sticker_usage_enabled` | Agrega una etiqueta de servidor coincidente o una expresión personalizada a una respuesta. |
| Administrar mensaje | `{manage_message_tool}` | `manage_message_enabled` | Anclar, editar o eliminar mensajes recientes (el ancla necesita `Administrar mensajes`). |
| Bloquear/desbloquear usuario | `{block_user_tool}` / `{unblock_user_tool}` | `user_blocking_enabled` | Silenciar/bloquear a un usuario con alcance personal (no toca los recuerdos). |
| Interactuar con mensaje reciente | `{message_interaction_tool}` | - | Reacciona o envía una breve respuesta a un mensaje reciente. |
| Echar un vistazo a la foto de perfil | `{profile_picture_tool}` | modelo de visión o `vision_llm` | Inspecciona el avatar de una usuario o de la persona. |
| Leer documento | `{document_tool}` | - | Extraiga texto de un PDF o cualquier archivo de texto UTF-8: código fuente (`.py`/`.ts`/`.rs`/…), `.json`, `.yaml`, `.md`, `.txt` y cualquier archivo adjunto no binario. |
| Revelar metadatos del mensaje | `{message_metadata_tool}` | - | Anota giros recientes con identificadores y marcas de tiempo para apuntar con precisión. |
| Procesar vídeo de YouTube | `{youtube_tool}` | modelo con soporte de video | Analiza un enlace específico de YouTube bajo demanda. |
| Analizar imagen | `{image_analysis_tool}` | configurado `vision_llm` | Delegar la comprensión de la imagen a un modelo de visión independiente. |
| Generar imagen/imagen anime | `{image_generation_tool}` / `{anime_image_generation_tool}` | Proveedor compatible con `imagegen_enabled` + | Genere o edite imágenes (consulte [Generación de medios](/es-419/features/capabilities/media-generation/)). |
| Generar mensaje de voz | `{voice_message_tool}` | Tecla ElevenLabs + voz personal + `voice_message_enabled` | Envíe una respuesta de voz hablada Discord. |

:::note[For prompt authors]
Al personalizar el mensaje del sistema o las instrucciones de la persona, haga referencia a las herramientas por sus **macros de mensajes** de la tabla anterior en lugar de codificar los nombres de las herramientas, porque las macros se expanden a los nombres correctos en el momento del ensamblaje del contexto y se degradan elegantemente cuando una herramienta no está disponible. `{pin_tool}` y `{timestamp_refresh_tool}` todavía funcionan como alias de compatibilidad para `{manage_message_tool}` y `{message_metadata_tool}`. Las siguientes herramientas de búsqueda web y URL también tienen macros: `{web_search_tool}`, `{image_search_tool}`, `{video_search_tool}`, `{news_search_tool}`, `{url_fetch_tool}` y `{url_metadata_tool}`. Estos se resuelven dinámicamente con el mejor motor disponible, incluidos los reemplazos del gremio MCP.
:::

### Bloques de prompt condicionales

El texto de aviso que admite las macros de herramientas anteriores también admite condicionales de ámbito:

```text
{{if capability:self_teaching}}
Use {memory_tool} when a detail is worth remembering.
{{else}}
Do not promise to save long-term memories.
{{/if}}
```

Utilice `capability:<name>` para una configuración TomoriBot habilitada, o `tool:<function_name>` cuando el texto debería aparecer solo si esa herramienta exacta está disponible para el proveedor y modelo activo. Utilice `tool_family:url_fetch` cuando esté disponible el lector de URL incluido o un reemplazo del gremio MCP. Anteponga una condición con `!` para invertirla. Los bloques se pueden anidar y pueden contener un `{{else}}`; No se admiten expresiones generales `and`/`or`.

Los nombres de capacidad admitidos son `tool_use`, `self_teaching`, `personal_memories`, `emoji_usage`, `sticker_usage`, `web_search`, `manage_message`, `thread_creation`, `image_generation`, `video_generation`, `voice_message`, `user_blocking`, `short_term_memory` y `time_awareness`.

Las condiciones de la herramienta reflejan la compatibilidad del proveedor/modelo, la configuración del servidor, los backends configurados, los reemplazos de MCP y la lista de permitidos actual del modo de herramienta deliberada. No omiten ni predicen las comprobaciones de permisos Discord realizadas cuando se ejecuta una herramienta. Los nombres de capacidades desconocidas se evalúan como falsos y se registran; Se omiten los bloques mal formados. Los mensajes de chat sin procesar, los resultados del modelo y los resultados de las herramientas nunca se tratan como plantillas condicionales.

## Búsqueda web y lectura de URL
<!-- anchor: web-search--url-reading -->

El modelo ve una única herramienta `web_search(query, category)` unificada. Detrás de él, un despachador dirige cada llamada a través de una cadena de motores y devuelve el primer éxito:

Brave → SearXNG → DuckDuckGo

- **Brave** se ejecuta primero cuando se configura una clave Brave API (configúrela con `/providers`); Agrega búsqueda de imágenes, videos y noticias. ⚠️ Establece un límite de uso de $5 en el panel de Brave para evitar cargos sorpresa.
- DuckDuckGo es la opción predeterminada cuando no se ha configurado ninguna clave. Solo cubre búsquedas de texto. Cuando DuckDuckGo aplica un límite de velocidad al bot o muestra una verificación antibot, la búsqueda falla y TomoriBot publica un aviso sugiriendo Brave.
- SearXNG y Crawl4AI son servidores autohospedados opcionales que agregan más categorías y búsquedas de páginas renderizadas por el navegador; consulte [Autohospedaje](/es-419/self-hosting/).

Para leer una página específica, utiliza `fetch_url`. No está disponible en NovelAI.

## Servidores MCP
<!-- anchor: mcp-servers -->

[MCP](https://modelcontextprotocol.io/) (Model Context Protocol) la amplía con herramientas
externas que registras tú mismo.

### Añadir un MCP en línea

Usa un endpoint HTTPS directo de un proveedor que admita MCP Streamable HTTP o SSE:

1. Obtén el endpoint MCP y sus requisitos de autenticación del proveedor.
2. Abre `/config` > Plugins > Servidores MCP y elige `+ Agregar MCP`.
3. Pega el endpoint en `URL`, ingresa su token Bearer en `Token de autenticación` si es necesario y elige el `Tipo de servidor` requerido. **Uso general** está seleccionado por defecto.

### Añadir un servidor Smithery

Los servidores alojados en Smithery tienen direcciones que terminan en `.run.tools`. Pega esa dirección en `URL` y tu clave de API de Smithery en `Token de autenticación`. TomoriBot envía la clave únicamente a la API de Smithery en `api.smithery.ai`, nunca a la dirección del servidor en sí. Smithery luego pasa cada llamada a herramientas al servidor, por lo que Smithery ve cada solicitud y resultado de herramienta. Los registros guardados antes de que este soporte volviera a estar disponible funcionan nuevamente sin cambios.

TomoriBot mantiene una conexión de Smithery por dirección de servidor en el primer espacio de nombres de tu cuenta de Smithery (Smithery crea un espacio de nombres si no tienes ninguno) y la reutiliza, por lo que agregar, probar y reconectar no acumulan conexiones. TomoriBot nunca elimina conexiones. Las versiones anteriores de TomoriBot creaban una nueva conexión en cada reconexión, por lo que tu cuenta puede tener muchas conexiones sin usar para el mismo servidor; puedes eliminarlas desde tu panel de Smithery.

Algunos servidores te piden iniciar sesión en el servicio que envuelven. Si intentas agregar uno, fallará con un mensaje de que se requiere autorización, y TomoriBot nunca muestra el enlace de inicio de sesión en Discord. Abre tu panel de Smithery, completa el inicio de sesión para la conexión cuyo nombre comienza con `tomoribot-` y vuelve a agregar el servidor. La conexión y la obtención de la lista de herramientas deben completarse en un plazo de 15 segundos.

Desactivar un registro seleccionado para búsqueda o lectura de URL restablece la selección integrada de TomoriBot; dejarlo activado impide un cambio automático. Los nombres de herramientas guardados describen el último descubrimiento, por lo que no garantizan que la conexión aún funcione.

Las respuestas se detienen a los 8 MiB durante la descarga. Los catálogos grandes de herramientas o resultados voluminosos pueden dejar un plugin no disponible o hacer que una llamada a una herramienta falle. Para conexiones SSE, el límite cubre todo el flujo de respuestas, incluidas las actualizaciones sucesivas. Pide al proveedor resultados más pequeños, paginación o enlaces a archivos cuando una herramienta devuelva documentos grandes o contenido multimedia incrustado.

Si un servidor no necesita autenticación, deja vacío `Token de autenticación`. Tu token de autenticación se cifra en reposo y nunca vuelve a mostrarse. Abre la misma página de Config para revisar el estado configurado, activar o desactivar un servidor, o eliminarlo con confirmación explícita. Eliminarlo lo desconecta de inmediato y libera un espacio. Cada fila guardada también muestra los nombres de herramientas acotados de su último descubrimiento exitoso. `ninguna descubierta` es un resultado conocido de cero herramientas; `descubrimiento desconocido` identifica una fila heredada o un servidor que aún no tiene una instantánea exitosa. Abrir la superficie de administración de MCP solo lee metadatos guardados y no contacta al servidor remoto.

### Servidores MCP locales

Los servidores MCP locales solo son compatibles con instancias con autoalojamiento: el bot
público alojado requiere HTTPS y bloquea direcciones locales o privadas. Si ejecutas tu propia
instancia, consulta
[Configuración: servidor MCP local](/es-419/self-hosting/local-endpoints/setup-local-mcp/).

:::danger[Agrega solo servidores MCP de confianza]
Un servidor MCP malicioso puede hacerle inyección de prompt con instrucciones ocultas,
exfiltrar los datos que los usuarios entregan a sus herramientas, o devolver **resultados
dañinos o falsos** que ella transmitirá a tu servidor. Trata los servidores MCP como extensiones
del navegador: si tienes dudas, no lo agregues. Revisa siempre las herramientas descritas por un
MCP antes de añadirlo.
:::

## Modo de herramientas deliberado
<!-- anchor: deliberate-tool-mode -->

Cada herramienta declarada aumenta el tamaño del prompt. El `Modo de Herramientas Deliberado` mantiene las declaraciones fuera de los turnos normales de chat, salvo que el mensaje necesite una herramienta de tarea; así reduce el prompt y ayuda a los modelos pequeños o locales a responder más rápido. La selección de stickers sigue disponible para expresarse espontáneamente cuando el uso de stickers y herramientas está activado y el proveedor lo admite. Las restricciones de DM, suplantación y rol siguen vigentes. Desactiva el uso de stickers para impedir respuestas con stickers. Cuando vence el plazo de actualización de la memoria a corto plazo, su herramienta de mantenimiento también queda disponible sin una solicitud del usuario.

- Primero comprueba el mensaje en busca de la intención de la herramienta. Los activadores integrados cubren solicitudes comunes (recordatorios, búsqueda web, actualizaciones de memoria, mensajes entre canales, generación de imágenes/vídeo/voz, análisis de medios, creación de hilos, acciones de mensajes). Las preguntas sobre su modelo actual, herramientas, configuraciones o por qué una capacidad no está disponible exponen la revisión de capacidades y el acceso a la documentación oficial juntos. Las frases de seguimiento también funcionan, como "haz eso de nuevo pero más enojado" después de una solicitud de mensaje de voz.
- Los administradores de servidores pueden agregar frases de activación personalizadas literales con `/server trigger add`, por ejemplo, asignando `pic`, `img` o `pfp` a la generación de imágenes.
- Los disparadores incorporados leen frases en inglés. Otros idiomas llegan a las mismas herramientas a través de la lista de palabras clave de cada idioma. La lista de cada idioma enviado se verifica en cada mensaje, cualquiera que sea su configuración de idioma, por lo que un servidor bilingüe funciona en ambos idiomas.
- Las frases personalizadas en japonés, chino o coreano también coinciden dentro de palabras más largas, porque esos idiomas no separan las palabras con espacios. Una frase que termina en `*` coincide con cualquier palabra que comience con ella: `remind*` cubre `reminder` y `reminding`.

### Controles

- `/server dtm`: los administradores del servidor lo alternan.
- `/personal config`: las usuarios lo anulan por sí mismas.
- Con un canal de registro de pensamiento configurado (`/server thought-logs`), las llamadas exitosas a la herramienta en modo deliberado se registran allí junto con el disparador que expuso la herramienta.

El modo de herramienta deliberada solo decide qué herramientas se *muestran* al modelo, pero el modelo aún tiene que elegir llamar a una. En `/help`, elija `Comportamiento` y luego `Modo de Herramientas Deliberado` para obtener el resumen de Discord.

:::note
`Modo de Herramientas Deliberado` (esta sección) no está relacionado con `Modo de Activación Deliberada`, que controla cómo se activa *ella*; consulte [Chat y activadores](/es-419/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode). Ambos se abrevian "DTM" en Discord.
:::

## Actualizaciones estructuradas de información del usuario

TomoriBot puede actualizar automáticamente tu perfil y tus preferencias de nombres de personas cuando preguntas directamente en el chat (como "llámame Capitán" o "mis pronombres son ellos"):

| Preferencia | Alcance | Efecto |
|---|---|---|
| Apodo, prefijo, sufijo | por persona | Sólo la persona activa se dirige a usted con este nombre o título. |
| Identidad de género, pronombres, estilo de direccionamiento, zona horaria. | Global | Cada persona usa el mismo valor en todos los servidores. |

- **Eliminar un título**: pedirle que deje de usar un título (como "deja de llamarme Maestro") lo borra para esa persona.
- **Privacidad**: los niveles de privacidad restrictivos bloquean nuevas adiciones y ediciones y al mismo tiempo te permiten borrar los datos existentes.
- **Permisos**: los administradores de servidores pueden alternar actualizaciones automáticas usando `Actualizaciones de Información del Usuario` en `/config` > `Permisos`. Siempre puedes editar tu perfil manualmente con `/personal config`.

Para conocer los esquemas de parámetros de herramientas y el diseño de almacenamiento de la base de datos, consulte la [arquitectura del sistema de herramientas](/en/architecture/subsystems/tool-system/#structured-user-info-updates).
