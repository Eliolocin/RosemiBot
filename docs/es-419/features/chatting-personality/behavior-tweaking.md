---
title: "Ajuste del comportamiento"
sidebar:
  order: 3
---

Puedes ajustar lo que TomoriBot puede hacer y cómo genera respuestas en `/config`, incluida la página de permisos. Para la personalidad, consulta [Múltiples personas](/es-419/features/chatting-personality/multiple-personas/); para el conocimiento, consulta [Memoria](/es-419/features/knowledge/memory/). Esta página cubre los ajustes más comunes.

## Capacidades: lo que puede hacer
<!-- anchor: capabilities-what-shes-allowed-to-do -->

`/config` > `Plugins` controla las herramientas, las adiciones de contexto y la revisión de respuestas opcional:

- **`Herramientas disponibles`**: generación de imágenes, `Uso de Stickers`, creación de hilos, administración de mensajes, bloqueo de usuarios, autoaprendizaje, mensajes de voz y más. Cada palanca activa la herramienta correspondiente (consulte [Herramientas y extensiones](/es-419/features/capabilities/tools-and-extensions/)), por lo que desactivar el `Uso de Herramientas` las desactiva todas a la vez.
- **`Adiciones de contexto`**: personalización, emojis en las respuestas y reconocimiento del tiempo. Estos agregan información a su mensaje, por lo que continúan funcionando cuando el `Uso de Herramientas` está desactivado.

El resumen automático de memoria a corto plazo se activa en `/config` > `Comportamiento` > `Memoria avanzada`. Cuando una capacidad está desactivada, no puede realizar esa acción independientemente de las solicitudes del usuario.

## Revisión de respuestas

Abre `/config` > `Plugins` > `Revisión de respuestas` para activar la revisión. Comienza desactivada y se aplica a cada persona en ese espacio de trabajo, incluidas las respuestas en cola y las escenas generadas. Los administradores del servidor modifican los ajustes del servidor; tu espacio de trabajo de DM tiene sus propios ajustes.

Cuando está activada, Tomori retiene su respuesta mientras un revisor comprueba la voz de su personaje y el encaje con la escena. El revisor puede solicitar una revisión completa. Las solicitudes de herramientas también entran en revisión antes de su ejecución; las solicitudes rechazadas pueden recibir una corrección acotada. Las acciones exitosas se conservan mientras se revisa la respuesta. El texto sigue utilizando la identidad habitual de la persona, el manejo de emojis y el formato. La revisión y las correcciones pueden aumentar el tiempo de respuesta y el costo de tokens; la página muestra esto en ambos estados.

`Elegir modelo revisor` selecciona un modelo de texto registrado elegible. `Usar el modelo de respuesta actual` utiliza el modelo y las credenciales que realmente responden, incluido tu proveedor personal o un modelo de respaldo. Un revisor fijado utiliza el registro y las credenciales propios del espacio de trabajo. Los creadores de solo texto y los creadores con el uso de herramientas desactivado aún pueden utilizar un revisor elegible. Un modelo heredado no admitido muestra `No disponible`; elige un revisor admitido para habilitar la revisión detallada.

`Establecer prompt` edita las instrucciones de revisión, hasta 4,000 caracteres. `Usar predeterminado` restaura el valor predeterminado adaptado a la persona. `Elegir verificador de reglas` selecciona un verificador MCP compatible ya registrado, o `Ninguno`. Sus observaciones se envían de forma privada al revisor, que decide si son relevantes para este personaje. El verificador no ofrece garantías validadas de idioma o perfil en esta versión.

`Elegir modelo de decisiones` guarda un registro de decisión de `/providers`. La omisión de la revisión detallada permanece inactiva hasta que cada modelo y rúbrica de revisión cuente con evidencia de calidad etiquetada. Una selección guardada no realiza solicitudes de decisión de pago en esta versión. Los prompts personalizados también mantienen la omisión inactiva. Borrar cualquiera de los modelos restaura la herencia del revisor o `Ninguno`; desactivar la opción conserva tus elecciones.

La revisión es un control de calidad opcional. Un rechazo, un modelo no disponible, un tiempo de espera agotado, evidencia incompleta o un presupuesto de revisión agotado permiten que una respuesta válida o una solicitud de herramienta independiente continúe bajo las reglas normales de la aplicación. Las acciones previamente rechazadas permanecen bloqueadas. `/kill` y las interrupciones posteriores descartan el texto retenido. Los archivos, la voz y las publicaciones remotas reciben una revisión de sus argumentos de herramientas propuestos; sus medios generados quedan fuera de la revisión del texto retenido. La generación oculta y la suplantación de usuario mantienen sus vías existentes. El criterio del proveedor y la utilidad del verificador aún requieren evaluación humana. Consulta el [manejo de datos de revisión](/es-419/features/knowledge/data-handling/#response-drafting-selections).

## Expresiones
<!-- anchor: expressions -->

Las expresiones permiten que tus personas reaccionen con más que palabras. Puede usar los emojis y stickers de tu servidor, y puedes darle reacciones propias: un GIF favorito, una imagen de una broma interna o un enlace a cualquier cosa en la web. Describe cuándo encaja cada una y la enviará cuando llegue el momento.

Los miembros con `Administrar servidor` abren `/expressions manage` para explorar todo en tres pestañas: `Emojis`, `Stickers` y `Personalizadas`.

### Emojis y stickers de tu servidor

Ejecuta `/expressions initialize` y observará cada emoji y sticker para aprender cuándo encaja. Los que se añadan después se mostrarán como no inicializados en `/expressions manage` hasta que lo vuelvas a ejecutar. Para corregirla, selecciona uno y elige `Editar` para cambiar su descripción y emoción, o `Borrar información` para eliminarlos.

### Expresiones personalizadas

En `Personalizadas`, abre el menú y elige `+ Agregar una expresión personalizada`. Ponle un nombre, una descripción de cuándo usarla, una emoción y un enlace o un archivo. Lee la descripción para decidir cuándo enviarla, así que sé específico: "cuando el chat se descontrole" funciona mejor que "divertido".

Un enlace puede apuntar a cualquier cosa. Lo publica exactamente como se guardó, y Discord lo muestra como cualquier enlace: un enlace GIF de un sitio como Tenor se reproduce como GIF, un enlace de imagen muestra la imagen y un sitio web muestra su tarjeta de vista previa. Eso hace que los enlaces sean buenos para bromas, como el sitio web de un hospital para cuando el chat se descontrole. Los enlaces deben comenzar con `https://`.

Los archivos pueden ser PNG, JPEG, WebP, GIF o MP4, de hasta 10 MB.

Cada servidor puede tener hasta 20 expresiones personalizadas por defecto, compartidas entre todas las personas. Tanto los archivos como los enlaces cuentan; los emojis y stickers nativos no. Al llegar al límite, elimina una expresión antes de agregar otra. Las expresiones existentes aún se pueden usar y editar. Los bots autohospedados pueden cambiar este límite en sus ajustes de entorno.

Cada persona puede usar una nueva expresión personalizada. Para guardarla para personas específicas, selecciónala y usa `Agregar persona`. Eliminar a la última persona de esa lista la abre a todos de nuevo.

### Cómo las usa

Con `Uso de stickers` activado en `/config` > `Plugins`, envía como máximo una expresión por respuesta, como su propio mensaje antes, entre o después de su texto. No las usa en [canales de rol](/es-419/features/chatting-personality/chatting-and-triggers/#roleplay-channels).
`/expressions manage` muestra cuántas veces las personas han usado cada una.

## Ajuste de generación
<!-- anchor: generation-tuning -->

- `/config` > `Modelos` > Muestrarios y parámetros de texto: parámetros de muestreo como temperatura y top-p. Una temperatura más alta produce más variedad.
- `/config` > `Comportamiento` > `Comportamiento general`: grado de humanización de la respuesta. Ajusta la naturalidad con la que envía mensajes de texto. La configuración se aplica a todo el servidor de forma predeterminada o a una persona individual.
- `/config` > `Comportamiento` > `Comportamiento general`: límite del historial de mensajes. Súbelo para un contexto conversacional más profundo o bájalo para ahorrar tokens.

## Prompt del sistema
<!-- anchor: system-prompt -->

El mensaje del sistema se encuentra encima de la persona y da forma al `Comportamiento general`:

- `/config` > `Comportamiento` > `Comportamiento general`: establece una instrucción personalizada del sistema (hasta 16.000 caracteres).
- `/config` > `Comportamiento` > `Comportamiento general`: elija entre los mensajes preestablecidos del sistema.
- `/config` > `Comportamiento` > `Comportamiento general`: restablecer los valores predeterminados. La confirmación muestra el mensaje anterior para que pueda restaurarlo si se borra accidentalmente.

Cuando un [preajuste SillyTavern](/es-419/features/integrations/sillytavern-support/) está activo, se reemplaza el mensaje del sistema de respaldo incorporado, pero aún se envía uno personalizado que configuró aquí.

## Salida sin censura
<!-- anchor: uncensored-output -->

TomoriBot no tiene filtro de contenido propio: no agrega ninguna capa de moderación encima del modelo y responde con lo que genera el proveedor. `/nsfw jailbreaks` no habilita funciones de bot ocultas; evita filtros del lado del proveedor que son más estrictos de lo deseado.

Alterna tres técnicas independientes (todas desactivadas de forma predeterminada):

- **Inyección rápida**: agrega un bloque de instrucciones al contexto para alejar el modelo de rechazos innecesarios.
- **Espacios Unicode**: intercambia espacios normales por espacios Unicode similares para que los filtros de palabras clave no se activen en frases, aplicadas tanto al mensaje como a su respuesta.
- **Sanitize**: oculta palabras sensibles por el mismo motivo, tanto en solicitudes como en respuestas.

Ninguno de estos cambia lo que el modelo puede hacer; solo reducen la frecuencia con la que un filtro de proveedor bloquea una salida que de otro modo sería normal. Algunas de estas opciones tienen restricción de edad; consulte [Comandos restringidos por edad](/es-419/features/setup-administration/age-restricted-commands/).

## Apariencia y hora

- `/config` > `Persona` > `Identidad y personalidad`: cómo se autodenomina.
- `/config` > `Comportamiento` > `Comportamiento general`: la zona horaria del servidor, utilizada para respuestas con reconocimiento de tiempo y tareas programadas.

---

¿Busca controles administrativos y de costos (cuotas, listas blancas, BYOK) en lugar de comportamiento? Aquellos que viven bajo [Moderación del servidor](/es-419/features/setup-administration/server-moderation/).
