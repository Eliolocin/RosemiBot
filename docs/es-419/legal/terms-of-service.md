---
title: Términos de servicio
description: Los términos que rigen el uso de la instancia oficial alojada de TomoriBot.
aiGenerated: false
---

Aviso de traducción: Esta traducción se proporciona para tu comodidad. La versión en inglés controla en caso de conflicto.

Última actualización: 2026-09-12

Al configurar o interactuar con TomoriBot, aceptas estos Términos, así como los Términos de servicio y las Directrices comunitarias de Discord. Estos Términos se aplican a la instancia oficial alojada de TomoriBot en Discord. Si ejecutas tu propia copia desde el repositorio de código abierto de TomoriBot, estos Términos no te obligan; tu uso se rige por la licencia AGPLv3 en `LICENSE` y tú controlas por completo el manejo de datos en tu entorno autoalojado.

## 1) Definición de términos
Para mayor claridad, estos términos se usan en todo este documento:
- **Servidor**: un servidor o comunidad de Discord donde TomoriBot está configurada
- **Memorias**: datos o información enseñados a TomoriBot mediante comandos o aprendidos por sí misma mediante la herramienta de función `remember_this_fact`
- **Persona/Preajuste**: perfiles configurables de personalidad y comportamiento que cambian cómo responde TomoriBot
- **Proveedor**: servicios externos de IA o búsqueda (por ejemplo, Google, NovelAI, OpenRouter, Brave Search) que configuras para usar con TomoriBot
- **Instancia alojada**: el servicio oficial de TomoriBot mantenido como bot público para Discord, a diferencia de las copias autoalojadas
- **Clave de API**: credenciales de autenticación que proporcionas para conectar TomoriBot con los proveedores que elijas
- **Activación**: un evento que hace que TomoriBot genere una respuesta en un canal de texto de Discord usando el proveedor configurado, como mencionar al bot, responder a sus mensajes, usar comandos de barra que requieran procesamiento de IA o búsqueda, o enviar mensajes en canales donde la respuesta automática esté habilitada. Las activaciones consumen créditos o tokens de API de tu cuenta del proveedor.
- **Administrador del servidor**: un miembro con permiso para configurar TomoriBot en un servidor, como quien ejecuta `/setup`

## 2) Alcance del servicio
- TomoriBot es un chatbot con IA que responde a interacciones de Discord usando proveedores externos que tú configuras.
- Podemos cambiar, suspender o terminar funciones de TomoriBot en cualquier momento por mantenimiento, seguridad o motivos legales.

## 3) Quién acepta qué
- Un administrador del servidor acepta estos Términos para el servidor al completar `/setup` y confirma allí que leyó la Política de privacidad y que pondrá esa información a disposición de los miembros del servidor.
- Un administrador no puede aceptar estos Términos en nombre de otro miembro ni garantiza la edad o conducta de ningún otro miembro. Cada miembro acepta estos Términos por sí mismo al interactuar con TomoriBot.
- Los miembros pueden leer los documentos vigentes en cualquier momento mediante `/legal terms-of-service` y `/legal privacy-policy`.
- Los administradores son responsables de informar a sus miembros que TomoriBot está instalada y cómo procesa los mensajes, y de usar los controles disponibles de canales y roles para limitar dónde lee mensajes.

## 4) Tus responsabilidades
- No uses TomoriBot para contenido ilegal, dañino o prohibido por la plataforma, acoso ni intentos de acceso no autorizado.
- Debes cumplir la edad mínima que Discord exige en tu país, que es de al menos 13 años, para usar TomoriBot. Al usar el servicio, declaras que cumples este requisito.
- Sigues siendo responsable del contenido que proporciones (mensajes, memorias, datos de personas, archivos cargados). Asegúrate de tener derecho a compartirlo y evita datos sensibles que no quieras procesar mediante tus proveedores configurados.
- Respeta los límites de frecuencia y evita el spam o el abuso que degrade el servicio.

## 5) Contenido con restricción de edad
- Las funciones que producen contenido para adultos están desactivadas de forma predeterminada y un administrador debe habilitarlas deliberadamente.
- El administrador que las habilite confirma que tiene 18 años o más y que el contenido se limitará a canales que Discord marque con restricción de edad, accesibles solo para adultos.
- El contenido prohibido por las Directrices comunitarias de Discord o por la ley sigue estando prohibido sin importar la configuración, la marca del canal o la confirmación de edad.
- Podemos desactivar estas funciones para un servidor o retirar el acceso por completo cuando parezca que llegan a menores o producen contenido prohibido.

## 6) Proveedores y modelos externos
- Puedes conectar TomoriBot con proveedores externos (por ejemplo, Anthropic, Google Gemini, OpenAI/OpenRouter, NovelAI, Brave Search). Sus términos, políticas de privacidad, filtros de seguridad y facturación se aplican a cualquier contenido que envíes mediante ellos.
- Aceptar estos Términos cubre únicamente TomoriBot. No implica aceptar los términos de ningún proveedor ni te exime de cumplirlos. Revisa los términos del proveedor elegido antes de configurarlo con TomoriBot.
- TomoriBot no está afiliada, respaldada ni patrocinada por Discord ni por ninguno de estos proveedores. Somos un servicio independiente que se integra con sus API.
- No podemos controlar el comportamiento, la retención ni las políticas de seguridad de esos proveedores.
- El contenido generado por IA puede ser impreciso, parcial o inapropiado pese a los filtros de seguridad. TomoriBot no verifica ni respalda los resultados de IA.

## 7) Claves de API y facturación
- Si proporcionas claves de API para proveedores de IA o búsqueda, autorizas a TomoriBot a almacenarlas y usarlas para cumplir tus solicitudes. Todas las claves se cifran en reposo.
- Solo debes proporcionar claves de API cuyo uso estés legalmente autorizado a realizar. Esto significa claves obtenidas directamente del proveedor con tu propia cuenta o autorizadas explícitamente por el titular de la cuenta. Queda estrictamente prohibido lo siguiente:
  - Claves de API robadas, filtradas o comprometidas
  - Claves compradas a terceros no autorizados o en mercados negros
  - Claves compartidas en incumplimiento de los términos de servicio del proveedor
- Asumes toda responsabilidad legal por la legitimidad de las claves que proporciones.
- Solo usaremos tus claves para procesar tus interacciones explícitas con TomoriBot. No agrupamos claves, las usamos para solicitudes de otros usuarios ni para pruebas, desarrollo, análisis o cualquier fin distinto de cumplir las solicitudes directas tuyas y de los miembros de tu servidor.
- Eres responsable de los costos y el uso de la cuenta del proveedor causados por cada activación asociada a tu clave. Supervisa los paneles de tu proveedor. El comando `/tool estimate cost` ofrece una estimación aproximada del costo por activación.
- Recomendamos usar claves con los permisos mínimos necesarios y límites de frecuencia y topes de gasto del proveedor cuando estén disponibles.

## 8) Manejo de datos
- Los datos recopilados, los periodos de retención y las finalidades de uso se describen en la [Política de privacidad](/es-419/legal/privacy-policy/).
- Puedes exportar o borrar tus datos con los comandos de ese documento. `/personal nuke` borra tus datos personales en todos los servidores; `/nuke` borra los datos de un servidor y está limitado a administradores.
- El contenido propiedad de un servidor, como sus memorias y documentos cargados, sobrevive al borrado personal sin tu autoría. Pide a un administrador que elimine entradas específicas con `/memories`.
- Algunos registros operativos pueden conservarse durante el periodo indicado o más tiempo cuando la ley o la seguridad lo exijan.

## 9) Disponibilidad, soporte y cambios
- No se garantiza la disponibilidad del servicio. Las interrupciones, el mantenimiento o los límites de frecuencia pueden interrumpir las respuestas.
- Podemos actualizar estos Términos en cualquier momento. Los cambios sustanciales se anunciarán con al menos 30 días de anticipación en el Discord de soporte o el repositorio del proyecto, y se reflejarán al actualizar la fecha de «Última actualización». Si sigues usando el bot después de los cambios, aceptas los Términos revisados.

## 10) Terminación
- Podemos suspender o retirar el acceso por incumplimientos, requisitos legales o problemas de seguridad.
- Puedes retirar TomoriBot en cualquier momento. Considera ejecutar `/nuke` antes, porque de otro modo los datos del servidor se conservan para que la configuración sobreviva a una nueva invitación.

## 11) Exclusiones de responsabilidad y responsabilidad civil
- El servicio se proporciona «TAL CUAL» y «SEGÚN DISPONIBILIDAD», sin garantías de ningún tipo. Excluimos las garantías implícitas de comerciabilidad, idoneidad para un fin particular, no infracción y disponibilidad ininterrumpida.
- Ciframos las credenciales en reposo, usamos TLS con verificación de certificados para las conexiones de base de datos y limitamos el acceso a la base de datos al tiempo de ejecución del bot y a operadores con acceso a la infraestructura. Ningún sistema es completamente seguro y no podemos garantizar protección contra todas las amenazas, filtraciones o accesos no autorizados.
- En la máxima medida permitida por la ley, no somos responsables por:
  - Daños indirectos, incidentales, consecuentes o punitivos
  - Acciones de proveedores o usuarios externos
  - El acceso no autorizado, el robo, la corrupción o la pérdida de cualquier dato almacenado por TomoriBot (incluidas claves de API, memorias, personas y configuraciones)
  - Cualquier daño, salvo en casos de negligencia grave o conducta dolosa de nuestra parte
- Nuestra responsabilidad total se limita al mayor de estos valores: (a) lo que nos hayas pagado por el servicio (normalmente 0 USD; las donaciones voluntarias no son pago por el servicio) o (b) 10 USD en total por todas las reclamaciones.
- Al usar el servicio alojado de TomoriBot, aceptas estos riesgos. Si te incomodan, considera autoalojarla desde el repositorio de código abierto, donde tendrás control total sobre el almacenamiento, cifrado y seguridad de los datos.
- Nada de estos Términos limita derechos que no puedan limitarse bajo la ley aplicable.

## 12) Informes y contacto
- Para preguntas, informes de abuso o seguridad, o informes de que TomoriBot conserva datos de alguien menor de la edad mínima aplicable, escribe a `bredrumb@gmail.com` o contáctanos en el [servidor oficial de soporte de TomoriBot en Discord](https://discord.gg/bjCfHm9QsB).
- Usa el correo electrónico o un mensaje directo, no una incidencia pública de GitHub, para cualquier asunto relacionado con datos personales o vulnerabilidades de seguridad.
