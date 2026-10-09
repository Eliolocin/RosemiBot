---
title: "Personalización"
sidebar:
  order: 3
---

TomoriBot puede recordar datos personales, nombres personalizados y credenciales de proveedores de IA que lo siguen en cada servidor que comparte con ella. Puede administrar estas configuraciones con los comandos `/personal` sin alterar la configuración compartida de ningún servidor.

## Memorias personales

Los datos que ella aprende o recuerda sobre ti te siguen entre servidores. Administrarlos (agregar, eliminar, exportar o borrar contexto) se trata en la página [Memoria](/es-419/features/knowledge/memory/#personal-vs-server-memories).

## Perfil y nombres conscientes de la persona

Configura cómo TomoriBot se dirige y se refiere a usted en todos los servidores en `/personal config` > `Perfil`.

### Detalles del perfil

En `/personal config` > `Perfil` > Preferencias generales, la sección **Acerca de usted** almacena tres preferencias opcionales e independientes:

- **Identidad de género**: tu descripción de género.
- **Pronombres**: tus pronombres preferidos.
- **Estilo de dirección**: elige la variante de nombre masculino, femenino o neutral de una persona. Neutral es el valor predeterminado.

TomoriBot nunca infiere un campo de otro. Los campos en blanco se borran y se omiten en el contexto del mensaje. Los campos de perfil sin procesar están expuestos a la IA solo cuando su nivel de privacidad está establecido en `Ninguno`.

La sección **Interfaz** le permite configurar su desplazamiento numérico UTC (-12 a +14) o hacer coincidir el valor predeterminado del servidor. TomoriBot almacena solo este desplazamiento numérico, nunca una ubicación geográfica o zona horaria de IANA.

### Herencia de nombres

En `/personal config` > `Perfil` > Preferencias generales o Preferencias específicas de persona, puede establecer un apodo, prefijo o sufijo:

- **Alcance global**: se aplica a todas las personas a menos que se anule.
- **Ámbito de persona**: se aplica solo a un linaje de persona específico en todos los servidores.

Los nombres se resuelven del más específico al menos específico:

1. **Preferencia de persona**: apodo personalizado establecido para esa persona.
2. **Preferencia global**: apodo personalizado establecido para todas las personas.
3. **Discord nombre para mostrar**: el nombre para mostrar de su servidor en vivo.

Dejar su apodo global en blanco le permite a TomoriBot seguir su nombre para mostrar Discord automáticamente, incluidos cambios futuros. Al guardar un apodo global personalizado, se congela ese valor hasta que lo borre.

Los prefijos y sufijos se heredan de la misma manera. Por ejemplo, un prefijo de un nivel y un sufijo de otro se pueden combinar en `Master Mirri-san`. Para evitar que una persona use un título que genera por sí sola, pregúntale directamente en el chat ("deja de llamarme Maestro"); que suprime el título de esa persona y deja intactas a otras personas.

Los administradores de servidores configuran los valores predeterminados de personas en todo el servidor en `/config` > `Persona` > `Identidad y personalidad`. Cuando la capacidad de `Actualizaciones de Información del Usuario` está habilitada, las personas también pueden actualizar los detalles de su perfil cuando se les solicite durante la conversación.

## Tus propios proveedores
<!-- anchor: your-own-providers -->

Los proveedores personales permiten que sus propias solicitudes utilicen sus propias claves y modelos API en lugar de los valores predeterminados del servidor. Esto es "traiga su propia clave" (BYOK) a nivel de usuario individual.

Hay dos alcances disponibles:

- **Predeterminado del servidor**: credenciales compartidas y modelos configurados en `/providers` y `/model` por los administradores del servidor. Se aplica a todos en el servidor.
- **Anulación personal**: credenciales y modelos configurados en `/personal providers` y `/personal config`. Se aplica solo a sus solicitudes en todos los servidores donde utiliza TomoriBot.

### Configuración

1. Ejecuta `/personal providers` para guardar un proveedor (su clave API está cifrada). Guardar un proveedor permite que su texto personal se anule inmediatamente con el modelo predeterminado de ese proveedor.
2. Ejecuta `/personal config` > `Modelos` > `Cambiar modelos` para seleccionar un modelo diferente para su anulación de texto personal.
3. Regrese a `/personal providers` siempre que necesite actualizar credenciales, administrar puntos finales personalizados o agregar registros de modelos personalizados.

Al cambiar una capacidad del valor predeterminado del servidor a una anulación personal se muestra un mensaje de confirmación antes de guardar. Al actualizar las credenciales de un proveedor que ya utiliza, se omite la confirmación.

Los registros de pensamiento le atribuyen turnos utilizando su clave personal. Puede ajustar los parámetros personales de su modelo (temperatura, topp, límites de token) en `/personal config` > `Modelos` > Samplers & Parameters. Para registrar puntos finales personalizados privados, consulte [Puntos finales personalizados](/es-419/features/setup-administration/providers-and-models/#custom-endpoints).

### Manejo de errores y respaldo

Si una solicitud falla mientras usa su proveedor personal, los consejos de error lo dirigen a sus comandos personales (`/personal providers`, `/personal config`) en lugar de a la configuración del servidor.

Cuando todos los modelos de su ruta de texto personal fallan, TomoriBot puede recurrir al modelo de texto predeterminado del servidor en lugar de fallar silenciosamente. Las reservas del servidor se ejecutan en las credenciales del servidor, cuentan con la cuota de texto del servidor y muestran un botón `Respaldo utilizado` con detalles.

Puede deshabilitar el respaldo del servidor en `/personal config` > `Modelos` > Respaldos en `Respaldo al modelo del servidor`. La configuración es para toda la cuenta y está habilitada de forma predeterminada.

:::note[BYOK-required servers]
Un servidor puede requerir que los miembros proporcionen sus propias claves API a través del modo Usuario BYOK ([Moderación del servidor](/es-419/features/setup-administration/server-moderation/#user-byok-bring-your-own-key)). Cuando está habilitado, sus mensajes requieren un proveedor personal configurado antes de que TomoriBot responda, y las rutas personales fallidas no recurren a las credenciales del servidor.
:::

## Otros ajustes personales

Utilice `/personal config` para personalizar funciones adicionales:

- **Apariencia** (`Perfil` > `Apariencia`): guarde las etiquetas de apariencia de estilo booru que se utilizan cada vez que una [generación de imagen](/es-419/features/capabilities/media-generation/image-generation/#tag-customization) hace referencia a usted. Envíe un cuadro vacío para borrarlos.
- **Controles de privacidad** (`Privacidad` > `Controles de privacidad`): elija su nivel de visibilidad (`Ninguno`, `Parcial` o `Completo`) o alterne el uso compartido de memoria a corto plazo entre servidores.
- **Modos de respuesta** (`Avanzado` > `Modos de Respuesta`): alterna tu anulación personal para [Modo de activación deliberada](/es-419/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode).
- **Suplantación** (`Avanzado` > `Imitación`): establece un mensaje reutilizable que se utilizará cuando alguien invoque `/impersonate user` por usted.

## Destacado personal
<!-- anchor: personal-spotlight -->

Personal Spotlight limita qué personas puede activar en un canal específico y, opcionalmente, asigna una persona alternativa de activación automática para sus mensajes allí. Está dirigido a usted y a un canal: no afecta a nadie más en el servidor.

Para configurar un foco en `/personal config` > `Avanzado` > Foco Personal:

1. Selecciona una duración en horas (ingrese `0` para mantenerla activa hasta que se elimine manualmente).
2. Elige el canal de destino.
3. Selecciona las personas que desea permitir en su centro de atención.
4. Opcionalmente, elija una de esas personas como su **persona personal de activación automática** (el respondedor predeterminado para sus mensajes en ese canal). Las menciones explícitas aún pueden apuntar a cualquier persona permitida. Presione `Guardar enfoque` para omitir la configuración de una persona de activación automática.

### Reglas destacadas

- Spotlight solo limita el acceso: no puedes activar personas excluidas de tu lista de Spotlight.
- Respeta los permisos personales a nivel de servidor configurados en `/moderation`.
- Las transferencias de proxy de persona están restringidas a personas incluidas en su lista destacada.

Administre o elimine focos en `/personal config` > `Avanzado` > Personal Spotlight (desmarque las entradas para eliminarlas; los focos cronometrados caducan automáticamente). En `/help`, elija `Avanzado` > `Enfoque personal` para obtener un resumen rápido.
