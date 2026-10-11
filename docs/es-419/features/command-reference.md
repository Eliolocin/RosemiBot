---
title: "Referencia de comandos"
sidebar:
  order: 6
---

<!--
  GENERATED FILE: do not edit by hand.
  Run `bun run generate-command-reference` from the repository root.
-->

Todos los comandos de barra que TomoriBot tiene registrados actualmente, generados a partir de los mismos constructores de comandos y descripciones en español que se usan para el registro en Discord (las descripciones sin traducir aparecen en inglés).

Grupos de comandos de nivel superior: **41**. Comandos de barra ejecutables: **85**.

## `/comment`

Envía un embed de comentario visible en el chat pero invisible en el contexto.

| Comando | Resumen |
|---|---|
| `/comment` | Envía un embed de comentario visible en el chat pero invisible en el contexto. |

## `/compact`

Resume la conversación reciente en una memoria compacta del sistema.

| Comando | Resumen |
|---|---|
| `/compact` | Resume la conversación reciente en una memoria compacta del sistema. |

## `/conditioning`

Administra las memorias persistentes de recompensa y castigo.

| Comando | Resumen |
|---|---|
| `/conditioning manage` | Administra el historial de condicionamiento inyectado entre todas las personas de este servidor. |
| `/conditioning remove` | Elimina entradas de condicionamiento entre todas las personas de este servidor. |

## `/config`

Configura ajustes de persona, comportamiento, canal, permisos y modelo.

| Comando | Resumen |
|---|---|
| `/config` | Configura ajustes de persona, comportamiento, canal, permisos y modelo. |

## `/context`

Mira qué parte de la ventana de contexto del modelo ocupa el prompt de una persona en este canal.

| Comando | Resumen |
|---|---|
| `/context` | Mira qué parte de la ventana de contexto del modelo ocupa el prompt de una persona en este canal. |

## `/contribute`

Encuentra el código fuente y las formas de ayudar a construir TomoriBot.

| Comando | Resumen |
|---|---|
| `/contribute github` | Obtén el enlace del repositorio de GitHub y aprende a contribuir a TomoriBot. |

## `/donate`

Apoya los costos de desarrollo y alojamiento de TomoriBot.

| Comando | Resumen |
|---|---|
| `/donate kofi` | Apoya el desarrollo de TomoriBot mediante donaciones en Ko-fi. |

## `/export`

Exporta tu configuración o memorias como un archivo portátil.

| Comando | Resumen |
|---|---|
| `/export config` | Exporta la configuración de este servidor como un archivo portátil. |
| `/export memories` | Exporta memorias como un archivo portátil. |
| `/export personal config` | Exporta tu configuración personal como un archivo portátil. |
| `/export personal memories` | Exporta las memorias que posee tu cuenta como un archivo portátil. |

## `/expressions`

Enséñale a TomoriBot cuándo usar los emojis y stickers personalizados de este servidor.

| Comando | Resumen |
|---|---|
| `/expressions initialize` | Analiza y clasifica todos los emojis y stickers personalizados usando visión de IA |
| `/expressions manage` | Administra emojis, stickers, expresiones personalizadas y acceso de las personas. |

## `/generate`

Genera imágenes, videos y mensajes de voz con IA.

| Comando | Resumen |
|---|---|
| `/generate image` | Genera una imagen con IA a partir de tu propia idea o la escena actual del canal |
| `/generate scene` | Genera una breve escena de texto guionada entre las personas seleccionadas. |
| `/generate video` | Genera un video con IA usando Google Veo, OpenRouter o Z.ai |
| `/generate voice-message` | Habla un mensaje con una voz que elijas |

## `/help`

Guías de configuración, funciones, proveedores, memoria, comportamiento, herramientas y multimedia.

| Comando | Resumen |
|---|---|
| `/help` | Guías de configuración, funciones, proveedores, memoria, comportamiento, herramientas y multimedia. |

## `/impersonate`

Suplanta personas, usuarios o inyecta prompts de sistema.

| Comando | Resumen |
|---|---|
| `/impersonate persona` | Envía un mensaje como una de las personas de este servidor. |
| `/impersonate system` | Inyecta un mensaje de sistema en el contexto de la conversación. |
| `/impersonate user` | Haz que el bot escriba y envíe un mensaje como si fuera ese miembro. |

## `/import`

Importa configuración o memorias de un archivo portátil.

| Comando | Resumen |
|---|---|
| `/import config` | Importa un archivo de configuración del servidor. |
| `/import memories` | Importa un archivo de memoria del servidor. |
| `/import personal config` | Importa un archivo de configuración personal. |
| `/import personal memories` | Importa un archivo de memoria personal. |

## `/kill`

Detén inmediatamente el stream actual y borra las respuestas en cola en este canal.

| Comando | Resumen |
|---|---|
| `/kill` | Detén inmediatamente el stream actual y borra las respuestas en cola en este canal. |

## `/learn`

Aprende, extrae e ingiere el historial de conversación en la memoria.

| Comando | Resumen |
|---|---|
| `/learn history` | Extrae conocimiento del historial de mensajes de este canal usando IA. |

## `/legal`

Consulta los términos de servicio, la política de privacidad y la licencia de TomoriBot.

| Comando | Resumen |
|---|---|
| `/legal license` | Consulta la licencia de código abierto de TomoriBot |
| `/legal privacy-policy` | Consulta la política de privacidad de TomoriBot |
| `/legal terms-of-service` | Consulta los términos de servicio de TomoriBot |

## `/matrix`

Vincula canales de Discord a salas de Matrix para retransmisión bidireccional.

| Comando | Resumen |
|---|---|
| `/matrix link` | Vincula un canal de Discord a una sala de Matrix para retransmisión bidireccional |
| `/matrix unlink` | Elimina el vínculo del puente de Matrix de un canal de Discord |

## `/memories`

Consulta y administra memorias del servidor, documentos y memoria a corto plazo.

| Comando | Resumen |
|---|---|
| `/memories` | Consulta y administra memorias del servidor, documentos y memoria a corto plazo. |

## `/model`

Administra los modelos de IA predeterminados de este servidor.

| Comando | Resumen |
|---|---|
| `/model override remove` | Elimina las excepciones de modelo de canal y persona. |

## `/moderation`

Administra permisos de miembros, lista negra, lista blanca de canales y roles, y ajustes de cuota.

| Comando | Resumen |
|---|---|
| `/moderation` | Administra permisos de miembros, lista negra, lista blanca de canales y roles, y ajustes de cuota. |

## `/novelai`

Configura la generación de texto e imágenes de NovelAI para este servidor.

| Comando | Resumen |
|---|---|
| `/novelai generate image` | Genera una imagen de NovelAI con etiquetas estilo imageboard y referencia de personaje opcional. |
| `/novelai usage` | Medidor de uso de generación Opus de NovelAI del servidor (requiere Administrar servidor). |

## `/nsfw`

Comandos y ajustes con restricción de edad.

| Comando | Resumen |
|---|---|
| `/nsfw jailbreaks` | Administra comportamientos opcionales de jailbreak para mis prompts en este servidor. |
| `/nsfw persona default` | Aplica una configuración de personalidad preajustada NSFW |
| `/nsfw persona import` | Importa una persona desde un archivo PNG, JSON o CHARX, incluidas las personas NSFW |

## `/nuke`

Borra completamente todos los datos del servidor. Requiere ejecutar /setup después.

| Comando | Resumen |
|---|---|
| `/nuke` | Borra completamente todos los datos del servidor. Requiere ejecutar /setup después. |

## `/persona`

Administra los preajustes de personalidad

| Comando | Resumen |
|---|---|
| `/persona create` | Crea un preajuste de personalidad sencillo manualmente |
| `/persona default` | Aplica una configuración de personalidad preajustada |
| `/persona export` | Exporta la personalidad actual como un archivo PNG para compartir |
| `/persona generate` | Generación de personalidad con IA (requiere un proveedor compatible) |
| `/persona import` | Importa una persona desde un archivo PNG, JSON o CHARX |
| `/persona remove` | Elimina un alter del servidor |

## `/personal`

Administra tus configuraciones personales

| Comando | Resumen |
|---|---|
| `/personal config` | Administra tus preferencias personales, privacidad, modelos y perfil. |
| `/personal language` | Elige el idioma en el que TomoriBot te habla. |
| `/personal memories` | Administra tus memorias personales a largo plazo y contexto corto de conversación. |
| `/personal nuke` | Borra todo lo que TomoriBot guarda sobre ti en cada servidor. |
| `/personal providers` | Administra tus credenciales de proveedor, endpoints y catálogos de modelos personales. |

## `/ping`

Verifica la latencia del bot.

| Comando | Resumen |
|---|---|
| `/ping` | Verifica la latencia del bot. |

## `/providers`

Agrega, edita y elimina credenciales, endpoints y catálogos de modelos de proveedores.

| Comando | Resumen |
|---|---|
| `/providers` | Agrega, edita y elimina credenciales, endpoints y catálogos de modelos de proveedores. |

## `/punish`

Castígame con interacciones juguetonas.

| Comando | Resumen |
|---|---|
| `/punish bite` | ¡Dame una mordida juguetona! |
| `/punish bonk` | ¡Dame un golpecito en la cabeza! |
| `/punish pinch` | ¡Dame un pellizco! |
| `/punish spank` | ¡Dame una nalgada juguetona! |
| `/punish squeeze` | ¡Dame un apachurrón! |

## `/quota`

Administra los reinicios de cuotas de generación.

| Comando | Resumen |
|---|---|
| `/quota reset global` | Reinicia el fondo de cuota de generación a nivel de servidor. |
| `/quota reset user` | Reinicia el uso de la cuota diaria para un usuario. |

## `/refresh`

Borra el historial de conversación (solo en este canal).

| Comando | Resumen |
|---|---|
| `/refresh` | Borra el historial de conversación (solo en este canal). |

## `/reset`

Restablece la configuración del servidor o personal a los valores predeterminados.

| Comando | Resumen |
|---|---|
| `/reset config` | Restablece la configuración de este servidor a los valores predeterminados de la base de datos. |
| `/reset personal config` | Restablece tu configuración personal a los valores predeterminados de la base de datos. |

## `/respond`

Activa manualmente una respuesta al último mensaje en este canal.

| Comando | Resumen |
|---|---|
| `/respond` | Activa manualmente una respuesta al último mensaje en este canal. |

## `/reward`

Recompénsame con interacciones divertidas.

| Comando | Resumen |
|---|---|
| `/reward feed` | ¡Dame un bocadillo delicioso! |
| `/reward headpat` | ¡Dame unas caricias en la cabeza! |
| `/reward hug` | ¡Dame un abrazo! |
| `/reward kiss` | ¡Dame un beso! |
| `/reward tickle` | ¡Hazme cosquillas! |

## `/scheduled-task`

Administra tareas programadas y recordatorios.

| Comando | Resumen |
|---|---|
| `/scheduled-task edit` | Edita una tarea programada o un recordatorio. |
| `/scheduled-task remove` | Elimina una tarea programada o un recordatorio. |

## `/setup`

Inicia el proceso de configuración inicial. Configura el proveedor de IA y la personalidad.

| Comando | Resumen |
|---|---|
| `/setup` | Inicia el proceso de configuración inicial. Configura el proveedor de IA y la personalidad. |

## `/stats`

Ve las estadísticas de uso

| Comando | Resumen |
|---|---|
| `/stats generate` | Genera una tarjeta de estadísticas compartible. |
| `/stats persona` | Ve las estadísticas de uso de una persona en este servidor. |
| `/stats personal` | Ve tus propias estadísticas de uso. |
| `/stats server` | Ve las estadísticas de uso de todo el servidor. |

## `/status`

Muestra el estado personal, del servidor o de una persona.

| Comando | Resumen |
|---|---|
| `/status` | Muestra el estado personal, del servidor o de una persona. |

## `/support`

Obtén ayuda, reporta errores y únete a la comunidad de TomoriBot.

| Comando | Resumen |
|---|---|
| `/support discord` | Obtén el enlace del servidor oficial de Discord para reportar errores y chatear. |

## `/tool`

Acciones de utilidad para el contexto de la conversación, prompts y diagnósticos.

| Comando | Resumen |
|---|---|
| `/tool delete turn` | Elimina el turno de la última persona del canal. |
| `/tool estimate cost` | Estima los costos de API para proveedores de IA de pago |
| `/tool prompt snapshot` | Vuelca el prompt exacto del LLM para una persona en un archivo para depuración. |

## `/troubleshoot`

Obtén ayuda con algo que hizo TomoriBot.

| Comando | Resumen |
|---|---|
| `/troubleshoot chat` | Crea un archivo privado sobre un problema reciente en el chat. |

## `/update`

Mira las últimas notas de la versión de TomoriBot

| Comando | Resumen |
|---|---|
| `/update` | Mira las últimas notas de la versión de TomoriBot |
