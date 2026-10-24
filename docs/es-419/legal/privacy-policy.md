---
title: Política de privacidad
description: Cómo TomoriBot oficial alojada recopila, usa y elimina tus datos.
aiGenerated: false
---

Aviso de traducción: Esta traducción se proporciona para tu comodidad. La versión en inglés controla en caso de conflicto.

Última actualización: 2026-10-22

Esta política cubre TomoriBot oficial alojada en Discord, incluido el uso personal, en servidores y las solicitudes patrocinadas. Si autoalojas TomoriBot, tú controlas tus datos; esta política no se aplica a tu copia.

## Resumen de privacidad

- TomoriBot lee mensajes recientes para responder y envía el contexto relevante al proveedor de IA seleccionado. No guardamos una copia del historial del chat, pero la memoria a corto plazo opcional guarda resúmenes.
- Conservamos la configuración, las memorias y los archivos que tú o tu servidor elijan guardar. Algunas memorias del servidor pueden describir a miembros que no aportaron esa información.
- Las membresías de pago agregan vínculos de cuenta, patrocinios y registros de uso para proporcionar beneficios y controlar la asignación compartida. No recopilamos tu contraseña de Patreon ni datos de tarjetas.
- Puedes consultar o eliminar la mayoría de los datos guardados mediante comandos. Los registros de suscripción requieren una solicitud separada a soporte. Eliminar datos del bot no cancela los cobros de Patreon.

## 1) A quién cubre esta política

Incluye a los miembros cuyos mensajes lee TomoriBot, aunque nunca usen un comando. Los administradores deben informar a los miembros sobre el bot y esta política. Lee los documentos actuales con `/legal privacy-policy` y `/legal terms-of-service`, o consulta los [Términos de servicio](/legal/terms-of-service/).

## 2) Qué guardamos y para qué

Usamos los datos guardados para ofrecer las funciones que eliges, recordar tus preferencias, administrar el acceso de pago y mantener el servicio funcionando.

### 2.1) Tu cuenta y preferencias

Guardamos tu ID de usuario de Discord, elecciones de privacidad y los datos de perfil y preferencias que elijas guardar. También conservamos totales de uso para que puedas consultar estadísticas tuyas, del servidor y de sus personas. Las preferencias guardadas incluyen si las personas pueden mencionarte para iniciar una conversación (Menciones de personas).

### 2.2) Memorias y configuración del servidor

Conservamos memorias personales y del servidor, personalizaciones de personas, recordatorios y configuración del servidor para ofrecer las funciones que configures.

Cuando una persona inicia una conversación por su cuenta (Natural Nudges), registramos qué persona habló, el canal, si alguien respondió y el miembro al que mencionó. También guardamos el objetivo privado de la persona para esa conversación, que puede mencionar a ese miembro.

La memoria a corto plazo opcional guarda resúmenes de conversaciones. Otras memorias guardadas permanecen hasta su eliminación y pueden describir a personas que no las escribieron.

### 2.3) Claves de API y servicios conectados

Guardamos claves de API, direcciones de servicios y datos de autenticación que proporcionas para proveedores de IA, endpoints personalizados y servidores MCP, además de los vínculos entre canales de Discord y salas de Matrix. El servicio alojado también administra las credenciales de acceso por suscripción. Las credenciales guardadas están cifradas.

### 2.4) Archivos que guardas

Conservamos el texto y la información de los documentos de la base de conocimiento para que el bot pueda buscarlos. También guardamos imágenes de personas y, para clonar voces, muestras de voz y transcripciones.

### 2.5) Registros del servicio

Los registros de errores y rendimiento ayudan a investigar problemas. Pueden incluir IDs de Discord, nombres de comandos y detalles de errores, pero no conversaciones ni contenido de mensajes. También conservamos identificadores de mensajes para administrar los mensajes enviados por el bot.

### 2.6) Membresías y uso de suscripciones

Vincular Patreon conecta tu cuenta de Discord con tu membresía de Patreon. Recibimos de Patreon tu nivel, estado de pago y fechas de cobro para determinar tus beneficios.

Conservamos patrocinios, sus autorizaciones, totales de asignación y gastos, y detalles de solicitudes como modelo, función, costo, cantidad de tokens, hora e identificadores. El uso en un servidor patrocinado se asocia con ese servidor y se descuenta de la asignación del patrocinador.

Los registros temporales de inicio de sesión y actualización de membresía ayudan a proteger la vinculación y evitar actualizaciones duplicadas. Tus propios tokens de inicio de sesión de Patreon no se conservan después de la vinculación.

## 3) Qué leemos sin guardar

TomoriBot lee temporalmente mensajes recientes, medios relevantes, detalles del servidor y canal, e información de presencia disponible para responder. Esto no se guarda como historial de chat. Los resúmenes de memoria a corto plazo y los archivos que guardes deliberadamente se tratan como se explica arriba.

## 4) Quién recibe tus datos

- **Proveedores de IA:** el proveedor seleccionado recibe el prompt, contexto relevante de conversación, información de la persona y medios necesarios para texto, imágenes, video, voz o búsqueda de documentos. Antes de que una persona mencione a alguien, el modelo del servidor también recibe el nombre de ese miembro, su actividad actual y sus recuerdos personales recientes, a menos que su nivel de privacidad los oculte. Las solicitudes por suscripción usan OpenRouter y los proveedores del modelo seleccionado. Consultamos los gastos con OpenRouter para aplicar tu asignación.
- **Patreon:** la vinculación nos autoriza a verificar tu membresía. Patreon proporciona actualizaciones de cuenta y membresía; Patreon y sus proveedores de pago gestionan pagos y datos de pago.
- **Proveedores de búsqueda:** al usar búsqueda web, reciben las consultas y el contexto relevante.
- **Matrix:** al configurar un puente, los mensajes se comparten entre el canal de Discord y la sala de Matrix vinculados.
- **Proveedores de alojamiento y almacenamiento:** procesan y guardan los datos necesarios para ejecutar TomoriBot.

Estos servicios pueden procesar datos fuera de tu país y tienen sus propias políticas de privacidad y conservación. No vendemos datos personales; los compartimos para ofrecer las funciones que usas o cuando lo exige la ley.

## 5) Cuánto tiempo los conservamos

| Datos | Conservación |
|---|---|
| Resúmenes de memoria a corto plazo | 90 días después de la última actividad, de forma predeterminada |
| Registros de errores | 90 días |
| Registros de rendimiento e identificadores de mensajes del bot | 30 días |
| Registros de Natural Nudges | 30 días; el objetivo privado de la persona hasta 90 días |
| Registros de actualización de membresía de Patreon | 30 días de forma predeterminada |
| Registros de inicio de sesión de Patreon completados o vencidos | Pueden eliminarse después de una hora de forma predeterminada |
| Uso detallado de suscripción | 90 días; los registros del período actual quedan hasta que termine si es posterior |
| Copias de recuperación de la base de datos | Siete días |
| Copias automáticas al iniciar | Hasta cinco copias; las antiguas se eliminan al crear nuevas |
| Vínculos de membresía, estado de acceso, patrocinios y claves administradas | Mientras exista el vínculo; pide la desvinculación o eliminación a soporte |
| Identificadores de membresía y totales de asignación/gastos tras desvincular | 90 días desde el último de estos eventos: desvinculación, fin del período pagado y eliminación completada de la clave del proveedor |
| Otras configuraciones, memorias, credenciales y archivos guardados | Hasta eliminarlos con los controles de la Sección 6 |

Los registros vencidos se eliminan durante la limpieza programada. Podemos conservar registros contables relevantes por más tiempo para una disputa específica sin resolver u obligación legal y eliminarlos cuando termine esa necesidad. Los totales de gastos pueden permanecer después de eliminar el uso detallado. Los datos eliminados pueden quedar en copias conservadas: las de recuperación de la base de datos vencen después de siete días y las de inicio permanecen hasta reemplazarse. Las copias separadas para recuperación o migración se eliminan al terminar ese trabajo.

Quitar el bot conserva los datos del servidor para volver a invitarlo; ejecuta `/nuke` antes si quieres eliminarlos. Cancelar los cobros no elimina los registros de membresía.

## 6) Consultar, exportar o eliminar tus datos

| Qué quieres hacer | Dónde hacerlo |
|---|---|
| Controlar la visibilidad de mensajes y el uso de memoria personal | `/personal config` |
| Evitar que las personas te mencionen para iniciar una conversación | `/personal config` > `Privacidad` > `Menciones de personas` |
| Consultar o quitar memorias personales | `/personal memories` |
| Consultar o quitar memorias y documentos del servidor | `/memories` |
| Exportar configuración o memorias personales | `/export personal config`, `/export personal memories` |
| Exportar configuración o memorias del servidor | `/export config`, `/export memories` |
| Restablecer la configuración personal | `/reset personal config` |
| Borrar los datos personales descritos abajo en todos los servidores | `/personal nuke` |
| Borrar los datos de un servidor (solo administradores) | `/nuke` |

`/personal nuke` elimina tu configuración personal, memorias, credenciales y configuraciones guardadas de proveedores, contadores de uso y recordatorios que creaste o que se configuraron para ti. Eliminar tus comentarios también puede afectar el comportamiento de una persona para otros miembros.

Tus memorias y documentos del servidor permanecen, sin la asociación de autoría; pide a un administrador que los elimine con `/memories`. Si una memoria o documento compartido contiene datos personales sobre ti y no consigues que lo quiten, contáctanos directamente mediante la Sección 9. No necesitas permiso de un administrador para pedir revisión y eliminación.

La configuración de privacidad limita la visibilidad de mensajes y personalización; no borra memorias existentes. Las elecciones para excluirte de la recopilación permanecen tras la eliminación para que esta no se reactive silenciosamente. Tu elección de Menciones de personas es un ajuste de personalización, por lo que `/personal nuke` lo borra; desactiva Menciones de personas nuevamente después si aún deseas tenerlas desactivadas.

Para suscripciones, usa el panel de suscripción para consultar tu asignación y patrocinios o dejar de patrocinar un servidor. Cancela la renovación en Patreon; detener un patrocinio o eliminar datos del bot no detiene los cobros.

Contáctanos mediante la Sección 9 para acceder, desvincular o borrar registros de suscripción; las exportaciones comunes y `/personal nuke` no los incluyen. La desvinculación elimina el vínculo de cuenta, acceso, patrocinios y uso local detallado, y solicita eliminar la clave administrada del proveedor. Pueden quedar registros contables limitados como se describe en la Sección 5.

## 7) Cómo protegemos tus datos

Las credenciales de acceso guardadas están cifradas. Las conexiones a la base de datos están cifradas y verifican la identidad del servidor. El acceso se limita al entorno de ejecución del bot y operadores con acceso a la infraestructura.

Ningún sistema es completamente seguro. Evita proporcionar información altamente sensible o datos que requieran tratamiento especial.

## 8) Datos de menores

TomoriBot no se dirige a personas por debajo de la edad mínima de Discord en su país, que es de al menos 13 años. No recopilamos conscientemente datos de personas por debajo de esa edad. Contáctanos si crees que tenemos esos datos y los eliminaremos. Algunos proveedores y funciones de suscripción tienen requisitos de edad mayores, como explican los Términos de servicio.

## 9) Contacto

Para dudas de privacidad o solicitudes que los comandos no resuelven, escribe a `bredrumb@gmail.com` o contáctanos en el [servidor oficial de soporte de TomoriBot en Discord](https://discord.gg/bjCfHm9QsB). Usa correo o mensaje directo para datos personales o asuntos de seguridad, en lugar de una issue pública de GitHub.

## 10) Cambios

Anunciamos cambios importantes mediante el Discord de soporte o el repositorio del proyecto y actualizamos la fecha al inicio de esta política.

## 11) Usuarios internacionales y GDPR

Si estás en el EEE, Reino Unido o Suiza, la ley de protección de datos aplicable te da derechos de acceder, corregir, borrar, restringir y recibir una copia portátil de tus datos, y de oponerte al procesamiento. Usa los controles anteriores o contáctanos.

Procesamos datos para cumplir nuestro acuerdo contigo, incluida la prestación de funciones solicitadas y beneficios pagados. Nos basamos en intereses legítimos para proporcionar conversaciones grupales configuradas por el servidor, proteger el servicio, evitar abuso y asignaciones duplicadas, y mantener la confiabilidad, considerando los derechos y elecciones de privacidad de los miembros. Que un administrador active una función no significa que todos los miembros hayan consentido. Puedes usar los controles de privacidad anteriores o contactarnos para oponerte al procesamiento.
