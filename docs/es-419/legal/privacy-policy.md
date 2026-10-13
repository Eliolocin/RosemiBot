---
title: Política de privacidad
description: Cómo la instancia oficial alojada de TomoriBot recopila, almacena y elimina tus datos.
aiGenerated: false
---

Aviso de traducción: Esta traducción se proporciona para tu comodidad. La versión en inglés controla en caso de conflicto.

Última actualización: 2026-09-12

Esta Política de privacidad explica cómo la instancia oficial alojada de TomoriBot maneja los datos. Si autoalojas TomoriBot desde este repositorio, tú controlas tus propios datos; este documento es una plantilla de referencia y no rige tu despliegue autoalojado.

Los términos «Servidor», «Memorias», «Persona/Preajuste», «Proveedor», «Activación» y «Clave de API» se definen en nuestros [Términos de servicio](/es-419/legal/terms-of-service/). Consulta ese documento para ver las definiciones.

## Privacidad de un vistazo

- No conservamos una copia de tu historial de chat de Discord. TomoriBot lee mensajes recientes mientras responde y luego los descarta.
- Si la memoria a corto plazo está habilitada, TomoriBot almacena resúmenes breves derivados de esas conversaciones. Vencen después de un periodo de inactividad (90 días de forma predeterminada).
- Todo lo que enseñas a TomoriBot intencionalmente (memorias, ajustes de persona y documentos cargados) se almacena hasta que alguien lo borra.
- Cuando TomoriBot responde, envía tu prompt y el contexto reciente al proveedor de IA configurado para ese servidor. Ese proveedor tiene sus propios términos y prácticas de privacidad, que no controlamos.
- `/personal nuke` borra todo lo que almacenamos sobre ti en todos los servidores.

Las siguientes secciones explican cada uno de esos puntos.

## 1) A quién cubre esta política
Esta política se aplica a la instancia oficial alojada de TomoriBot. Los administradores configuran TomoriBot para un servidor, pero todo miembro cuyos mensajes procese TomoriBot está cubierto, haya ejecutado un comando o no.

Los administradores aceptan los Términos de servicio durante `/setup` y confirman que pondrán esta información a disposición de sus miembros. Cualquier miembro puede leer las políticas vigentes en cualquier momento con `/legal privacy-policy` y `/legal terms-of-service`.

## 2) Qué almacenamos

### 2.1) Sobre ti
- Identidad y preferencias: tu ID de usuario de Discord, preferencia de idioma y estado de exclusión de privacidad.
- Ajustes de personalización: apodo, pronombres, identidad de género, formas de tratamiento, etiquetas de apariencia física, prompt de suplantación, URL de imagen de referencia, zona horaria y ajustes personales de prefijo o sufijo de mensajes.
- Preferencias de nombres: cómo debe llamarte cada persona.
- Memorias personales: datos que enseñas a TomoriBot sobre ti o que guarda sobre ti cuando las memorias personales están habilitadas.
- Destacados: la configuración de destacados personales que estableces por servidor.
- Registros de condicionamiento: el texto y motivo que proporcionas mediante `/reward` y `/punish`, que moldean el comportamiento de una persona en ese servidor.
- Contadores de uso: totales diarios de comandos, modelos y herramientas que usaste, además de tokens, asociados contigo, el servidor y la persona. Estos alimentan `/stats`.

### 2.2) Sobre tu servidor
- Configuración del servidor: atributos de persona, diálogos de ejemplo, palabras de activación, selecciones de proveedor y modelo, permisos de canales y roles, cuotas, zona horaria y funciones activadas.
- Memorias del servidor: datos enseñados a TomoriBot para todo el servidor. Pueden describir a miembros, incluso a quienes no los escribieron.
- Metadatos de emojis y stickers: ID, nombres, descripciones y banderas de formato de Discord. Los archivos de imagen no se almacenan.
- Recordatorios: texto, ID y apodo de Discord del usuario objetivo, canal, horario y configuración de recurrencia.
- Resúmenes de memoria a corto plazo: cuando está habilitada, TomoriBot escribe en la base de datos resúmenes breves derivados de conversaciones recientes para conservar el contexto entre activaciones. Se eliminan tras un periodo de inactividad (90 días de forma predeterminada).
- Enlaces de integración: enlaces de salas y canales de Matrix, además de las URL, nombres de herramientas descubiertos y tokens de autenticación cifrados de cualquier servidor MCP conectado por un administrador.

### 2.3) Credenciales
- Claves de API de proveedores que elijas almacenar a nivel del servidor o personalmente.
- Definiciones de endpoints personalizados, incluida la URL del endpoint y cualquier token bearer.

Todas las credenciales se cifran en reposo.

### 2.4) Contenido que cargas
- Documentos: todo el texto extraído de archivos cargados a la base de conocimientos del servidor, junto con nombre, tipo de medio, tamaño y embeddings de búsqueda generados a partir de ese texto.
- Imágenes de personas: avatares, sprites e imágenes de referencia, almacenados en almacenamiento de objetos para renderizar personas de forma consistente.
- Muestras de voz: muestras de audio y sus transcripciones de referencia cuando se configura la clonación de voz.

### 2.5) Registros operativos
- Registros de errores: ID de interacción, ID de usuario y servidor, nombres de comandos, tipos de error y trazas. No se registran mensajes ni conversaciones. Se conservan 90 días.
- Métricas de rendimiento: muestras de tiempo y recursos usadas para mantener el servicio saludable. Se conservan 30 días.
- Mapeos de mensajes de personas: ID de mensajes y canales de Discord que vinculan un mensaje enviado con el sprite de persona usado, para que TomoriBot pueda actualizar o limpiar sus propios mensajes. Se conservan 30 días.

## 3) Qué no almacenamos
Lo siguiente se lee mientras TomoriBot prepara una respuesta y no se escribe en nuestra base de datos:
- Mensajes de Discord: se leen en memoria los mensajes recientes del canal (normalmente los últimos 80) para crear contexto y se envían al proveedor configurado. Se descartan al generar la respuesta. Pueden conservarse resúmenes por separado si la memoria a corto plazo está habilitada, como se describe en la sección 2.2.
- Archivos adjuntos y multimedia: imágenes, videos y fotos de perfil analizados durante una activación se procesan en memoria y se descartan.
- Metadatos del servidor y canal: nombres y descripciones del servidor, nombres de canales y temas se leen de nuevo cada vez.
- Información de presencia: tu actividad o estado actual, cuando está disponible.
- Imágenes de emojis y stickers: se obtienen de Discord cada vez que se usan.

## 4) Qué enviamos a terceros
- Proveedores de IA: tu prompt, el contexto reciente descrito arriba, datos de persona y archivos adjuntos se envían al proveedor configurado para ese servidor o para ti, como Google, OpenRouter, NovelAI o un endpoint personalizado. Esto cubre solicitudes de texto, visión, embeddings, imágenes, video, voz y transcripción. Sus términos, políticas, filtros y reglas de retención se aplican a ese contenido y no los controlamos.
- Proveedores de búsqueda: si la búsqueda web está habilitada, las consultas y el contexto relevante se envían al proveedor configurado.
- Matrix: si hay un puente de Matrix configurado para un canal, los mensajes pasan entre Discord y la sala de Matrix vinculada.

No vendemos datos personales. Los compartimos solo cuando es necesario para operar las funciones que invocas o cuando la ley lo exige.

## 5) Durante cuánto tiempo lo conservamos
| Datos | Retención |
|---|---|
| Resúmenes de memoria a corto plazo | 90 días después de la última actividad (predeterminado) |
| Registros de errores | 90 días |
| Métricas de rendimiento | 30 días |
| Mapeos de mensajes de personas | 30 días |
| Todo lo demás de la sección 2 | Hasta que se elimine mediante los comandos de la sección 6 |

Cuando TomoriBot se elimina de un servidor, los datos se conservan para que la configuración sobreviva a una nueva invitación. Un administrador que quiera eliminarlos debe ejecutar `/nuke` antes de retirar el bot.

## 6) Tus controles
| Lo que quieres | Comando |
|---|---|
| Evitar que TomoriBot guarde memorias personales sobre ti | `/personal config` |
| Revisar o eliminar memorias personales individuales | `/personal memories` |
| Revisar o eliminar memorias y documentos del servidor | `/memories` |
| Obtener una copia de tus datos personales | `/export personal config`, `/export personal memories` |
| Obtener una copia de los datos del servidor | `/export config`, `/export memories` |
| Restablecer tus ajustes personales a los valores predeterminados | `/reset personal config` |
| Borrar todo lo que almacenamos sobre ti en todos los servidores | `/personal nuke` |
| Borrar los datos de un servidor (solo administradores) | `/nuke` |

`/personal nuke` elimina tus memorias personales, ajustes de personalización y nombres, destacados, claves de proveedor personales y endpoints personales guardados, modelos registrados, contadores de uso, condicionamiento de personas que aportaste y cualquier recordatorio que hayas creado o que se haya configurado para ti. Antes de ejecutarlo, ten en cuenta dos consecuencias:

- El condicionamiento de personas que aportaste mediante `/reward` y `/punish` influye en el comportamiento para todos en ese servidor, así que eliminarlo cambia el comportamiento compartido.
- Las memorias del servidor que enseñaste y los documentos que cargaste pertenecen al servidor y se conservan, eliminando tu autoría. Si alguno te describe, pide a un administrador que lo elimine con `/memories`.

Tus ajustes de exclusión sobreviven deliberadamente al borrado, así que borrar tus datos no vuelve a activar silenciosamente la recopilación sobre ti.

Para cualquier cosa que estos comandos no puedan alcanzar, contáctanos usando la sección 9 y la gestionaremos manualmente.

## 7) Seguridad
- Las claves de API de proveedores, tokens bearer y credenciales MCP se cifran en reposo.
- Las conexiones de base de datos usan TLS con verificación de certificados.
- El acceso a la base de datos se limita al tiempo de ejecución del bot y a operadores con acceso a la infraestructura.

Ningún sistema es completamente seguro. No proporciones a TomoriBot información altamente sensible o regulada.

## 8) Datos de menores
TomoriBot no está dirigida a personas menores de la edad mínima que Discord exige en su país, que es de al menos 13 años. No recopilamos conscientemente datos de personas menores de esa edad. Si crees que tenemos datos de alguien menor de la edad mínima aplicable, contáctanos mediante la sección 9 y los eliminaremos.

## 9) Contacto
Para preguntas o solicitudes de privacidad que excedan los comandos anteriores, escribe a `bredrumb@gmail.com` o contáctanos en el [servidor oficial de soporte de TomoriBot en Discord](https://discord.gg/bjCfHm9QsB). Usa el correo electrónico o un mensaje directo, no una incidencia pública de GitHub, para cualquier asunto relacionado con tus datos personales.

## 10) Cambios
Podemos actualizar esta Política de privacidad y cambiará la fecha de «Última actualización» cuando lo hagamos. Los cambios sustanciales se anuncian en el Discord de soporte o el repositorio del proyecto.

## 11) Usuarios internacionales y GDPR
- El servicio alojado de TomoriBot está disponible globalmente y los datos se almacenan en infraestructura operada por nuestro proveedor de alojamiento.
- Si estás en el Espacio Económico Europeo, el Reino Unido o Suiza, tienes derechos bajo el GDPR para acceder, rectificar, borrar, restringir y portar tus datos personales, y para oponerte al procesamiento.
- Los controles de la sección 6 cubren directamente el acceso, la portabilidad y el borrado. Para cualquier otra cosa, contáctanos mediante la sección 9.
- Nos basamos en los siguientes fundamentos legales: ejecución de un contrato para operar las funciones que invocas; interés legítimo para seguridad, prevención de abusos y estabilidad del servicio; y consentimiento para funciones opcionales que activas, como memorias personales, memoria a corto plazo y búsqueda web. Puedes retirar ese consentimiento desactivando la función.
