---
title: "Manejo de datos"
sidebar:
  order: 4
---

Exporta, respalda, importa o elimina tus ajustes, recuerdos y personas con los comandos de barra de Discord. Para conocer las condiciones del servicio y la privacidad, consulta `/legal terms-of-service` y `/legal privacy-policy`.

:::note
Esta página cubre los controles de usuario en-Discord. En instancias autohospedadas, las copias de seguridad y restauraciones completas de la base de datos son operaciones del lado del host; consulte [Mantenimiento y copias de seguridad](/es-419/self-hosting/maintenance/).
:::

## Lo que ella almacena

### Datos almacenados

- Servidor y recuerdos personales.
- Perfiles de personas, rasgos y ejemplos de diálogo.
- Ajustes de configuración del servidor
- Claves cifradas del proveedor API
- Metadatos de expresión, reglas de acceso de personas y medios de expresión cargados

### No almacenado

- Historial de mensajes Discord (los mensajes no se archivan en un registro de mensajes persistentes)

### Enviado a su proveedor de IA

Siempre que se activa, TomoriBot recupera mensajes recientes en el canal junto con recuerdos relevantes como contexto para el modelo. Ella no lee ni procesa mensajes fuera de esos desencadenantes.

:::note
El proveedor de IA que elija (Google, OpenRouter, NovelAI,…) procesa los mensajes según su propia política de privacidad. Evite compartir credenciales personales sensibles o datos confidenciales.
:::

### Opciones de Revisión de respuestas
<!-- anchor: response-drafting-selections -->

`/config` > `Plugins` > `Revisión de respuestas` almacena las elecciones de revisor, modelo de decisiones, verificador de reglas opcional y prompt para el espacio de trabajo. Cuando está activada, las respuestas y las solicitudes reales de herramientas se revisan antes de enviarse o ejecutarse. Un verificador opcional recibe el texto de la respuesta pendiente y envía sus observaciones solo al revisor. La omisión por decisiones permanece inactiva a la espera de validación etiquetada, y las selecciones de decisiones guardadas no realizan llamadas de pago mientras falte la calibración. Desactivarla conserva las respuestas y herramientas habituales sin solicitudes de revisión.

El revisor seleccionado recibe la respuesta pendiente y el contexto ya admitido para su autor: instrucciones de la persona, diálogos representativos, activador y objetivo de respuesta, conversación relevante, relaciones visibles entre participantes, memorias, documentos y resultados reales de herramientas. Para una solicitud de herramienta, el revisor también recibe su destino exacto y sus argumentos, incluido cualquier texto de mensaje, y las definiciones de herramientas disponibles. La revisión no agrega búsquedas de perfiles privados. Las credenciales y los argumentos de autenticación se redactan. La evidencia requerida debe caber; una cobertura incompleta de medios, argumentos de herramientas ocultos o límites de modelo ausentes hacen que la revisión no esté disponible. Una revisión no disponible mantiene las comprobaciones habituales de la aplicación; una acción previamente rechazada permanece bloqueada.

La herencia utiliza el modelo y las credenciales que realmente responden, incluidos el enrutamiento personal, la rotación de claves, las excepciones y el respaldo. Un revisor fijado utiliza su propio registro de espacio de trabajo y la clave de proveedor guardada. Su proveedor tiene su propia política de privacidad. Elegirlo no modifica el proveedor de respuestas principal. Las respuestas pendientes y los paquetes de corrección duran solo durante el turno. Solo el diálogo aceptado por Discord ingresa a la memoria de conversación; la contabilidad de tokens incluye los intentos reales no exitosos cuando el proveedor informa el uso. Los diagnósticos contienen metadatos y recuentos, sin borradores, evidencia, correcciones, cuerpos de respuesta del proveedor ni claves.

Las exportaciones de configuración incluyen estos ajustes sin claves de API ni tokens de autenticación MCP. Las importaciones conservan las referencias de modelos y verificadores solo cuando están disponibles para el espacio de trabajo receptor. Registra un equivalente local o borra las selecciones no disponibles antes de importar. El restablecimiento de la configuración del servidor restaura el estado desactivado, la herencia del revisor, ningún modelo de decisiones, el prompt predeterminado y ningún verificador.

## Exporta tus datos

Los datos exportables se envían a sus mensajes directos como un archivo JSON:

- `/export config`: valores de configuración del servidor (excluye claves y credenciales de API).
- `/export personal config`: configuración de perfil personal (privacidad, etiquetas de apariencia, nombres).
- `/export memories`: memorias del servidor, con alcance para la persona principal, una persona o todas las personas.
- `/export personal memories`: recuerdos personales, de alcance global o por persona.
- `/persona export`: definiciones completas de personas.

Los medios de expresión cargados se almacenan en el host del servidor y están fuera de estas exportaciones JSON. Los autohospedadores deben realizar copias de seguridad del almacenamiento de la base de datos y de los activos multimedia juntos; consulte [copias de seguridad de medios personalizados](/es-419/self-hosting/safe-migration/#custom-expression-media-backups).

## Importa tus datos

Adjunte un archivo exportado para restaurarlo:

- `/import config`: configuración del servidor (requiere Administrar Servidor). Elige qué secciones aplicar.
- `/import personal config`: configuración personal. Elige qué secciones detectadas aplicar.
- `/import memories`: memorias del servidor (requiere Manage Server). Fusionar o reemplazar y asignar personas.
- `/import personal memories`: recuerdos personales. Fusionar o reemplazar y asignar personas.
- `/persona import`: restaurar una persona. También importa tarjetas SillyTavern PNG, tarjetas JSON y archivos `.charx` (consulte [Soporte SillyTavern](/es-419/features/integrations/sillytavern-support/)).

## Elimina tus datos

Estas acciones eliminan o restablecen permanentemente los datos almacenados:

- `/personal memories`: gestiona o elimina recuerdos personales.
- `/memories`: administrar o eliminar memorias del servidor (requiere Administrar Servidor).
- `/personal nuke`: elimina permanentemente todos los datos personales en los servidores.
- `/nuke`: borra los datos del servidor, incluidas las expresiones personalizadas y las reglas de acceso de personas. Configura `preserve_personas: true` para conservar las personas y al mismo tiempo eliminar expresiones y medios personalizados.
- `/reset config`: restaura la configuración del servidor a los valores predeterminados de la base de datos.
  - **Conservas**: asignaciones de modelos activos, claves API, puntos finales personalizados, personas, memorias de servidor e integraciones.
  - **Borrar**: anulaciones de canales, reglas de activación automática, listas negras de usuarios y listas blancas de canales.
  - Requiere el permiso Administrar servidor en servidores; también disponible en DM.
- `/reset personal config`: restaura la configuración del perfil personal y los focos del canal a los valores predeterminados.
  - **Conserva**: identidad del usuario, recuerdos personales, claves API del proveedor guardadas, puntos finales personalizados y tareas programadas.
  - **Se borra**: anulación de apodos, etiquetas de apariencia, pronombres, estilo de dirección y aspectos destacados del canal.
  - Disponible para todos los usuarios en servidores y DM.

Para obtener tablas de bases de datos exactas y listas de columnas conservadas, consulte [arquitectura de esquema de base de datos](/en/architecture/subsystems/database-schema/#reset-domain-classifications).

## Optar por no participar

- `/personal config`: controle su visibilidad, hasta la invisibilidad total (optando fuera del contexto de la memoria).
- `/config` > `Permisos`: los administradores del servidor pueden desactivar las funciones de memoria y autoaprendizaje.

Consulta [Memoria](/es-419/features/knowledge/memory/) para conocer la administración de la memoria diaria.
