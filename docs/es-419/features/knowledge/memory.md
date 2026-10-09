---
title: "Memoria"
sidebar:
  order: 1
aiGenerated: false
---

TomoriBot tiene un sistema de memoria persistente, así que recuerda datos entre conversaciones.
Esta página trata sobre *lo que sabe* (datos, contexto, documentos). Para *cómo se comporta*
(personalidad, tono), consulta
[Múltiples personas](/es-419/features/chatting-personality/multiple-personas/).

## Jerarquía de memoria

De lo más permanente a lo más pasajero

| Nivel | Qué es | Cuánto dura |
|---|---|---|
| Memoria a largo plazo (LTM) | Datos guardados sobre un usuario o un servidor, documentos subidos y condicionamiento | Para siempre, hasta que alguien lo elimine. Sobrevive a `/refresh`, a reinicios, a todo |
| Memoria a corto plazo (STM) | Un resumen que escribe para un canal, más algunos mensajes recientes | 24 horas. Puede cruzar entre canales |
| Historial de chat | Los mensajes recientes en el canal en el que está respondiendo | Solo este canal, solo hasta que salgan del rango de `/config` > Motor > General (80 mensajes más recientes por defecto). `/refresh` lo corta de inmediato |

Casi todo lo que parece "saber" en una conversación es solo historial de chat reciente, por eso
parece olvidar un mensaje una vez que la conversación se vuelve demasiado larga. **Solo la
memoria a largo plazo es permanente.** La STM queda en el medio: útil para mantener una escena
entre canales sin comprometer nada, pero igual expira.

Para ver exactamente qué se le entrega en un turno dado, consulta
[Dentro del prompt](/es-419/features/knowledge/inside-the-prompt/).

## Memoria a largo plazo
<!-- anchor: long-term-memory -->

Las memorias a largo plazo son lo único que conserva de forma permanente. No se ven afectadas
por `/refresh`, por reinicios, ni por moverse a otro canal.

### Memorias personales frente a memorias del servidor
<!-- anchor: personal-vs-server-memories -->

Hay dos tipos de memoria a largo plazo:

- Memorias personales (`/personal memories`): datos sobre un usuario individual, por ejemplo
  "a Amaori le encantan los gatos", "prefiere el modo oscuro", "alérgico a los cacahuates". Están
  vinculadas a *ti* y te siguen a través de todos los servidores, pero solo las usa en
  conversaciones en las que estás participando activamente.
- Memorias del servidor (`/memories`): información relevante para todo el servidor, por
  ejemplo "la noche de juegos es cada viernes a las 8 PM", "no publicar contenido NSFW",
  "#general es para anuncios". Estas permanecen dentro del servidor y siempre están presentes
  ahí.

Las memorias están aisladas por persona por defecto. Cada persona (incluidos los alters)
mantiene su propio conjunto separado de memorias personales y del servidor, así que personas
distintas significan que no puede recordar lo que aprendió otra persona. La única excepción es
una memoria personal añadida desde la página Global en `/personal memories`, que entonces se
aplica a todas las personas específicamente para ti. Las memorias del servidor no tienen esa
opción; el conjunto de memorias del servidor de cada persona siempre se mantiene separado,
incluso dentro del mismo servidor.

Usa `/memories` para explorar, añadir, editar, eliminar o mover memorias del servidor a la base
de conocimiento de documentos. `/personal memories` gestiona los datos vinculados a ti.
Las memorias persisten hasta que las elimines.

En servidores nuevos, el acceso de miembros no administradores para crear, editar o eliminar
memorias compartidas del servidor está desactivado por defecto. Los miembros con el permiso
`Administrar servidor` mantienen acceso en todo momento, y los administradores pueden habilitar a otros
miembros mediante Acceso de miembros en `/moderation`.

### Cómo se guardan las memorias

Hay exactamente dos formas en que se crea una memoria a largo plazo:

1. Tú la guardas con `/personal memories` o `/memories`.
2. Ella misma la guarda cuando decide que algo vale la pena conservar.

Cuando ella guarda una por su cuenta, publica un embed diciendo que aprendió algo. **Ese embed
es la confirmación.** Si le cuentas algo y no aparece ningún embed, no se guardó nada: sigue
siendo solo historial de chat, así que lo perderá una vez que la conversación avance, y no lo
tendrá en un canal distinto.

Si no está guardando cosas que quieres que conserve, tienes tres opciones, en orden creciente de
insistencia:

- Pídele directamente que lo recuerde.
- Agrega un empujón con `/config` > Motor > General, o con cualquiera de los otros comandos que
  llevan prompt de [Dentro del prompt](/es-419/features/knowledge/inside-the-prompt/) (`/config` >
  Persona > Avanzado, `/config` > Motor > General, `/config` > Canales > Excepciones de canal).
  Una nota de contexto en particular se ubica baja en su prompt, lo que hace más probable que
  actúe sobre ella. Algo tan simple como *"Se recomienda crear memorias a largo plazo para
  información que vale la pena recordar"* suele ser suficiente. Para referirte a la herramienta
  real de guardar memoria por nombre sin codificar algo que puede variar según el proveedor, usa
  la [macro de prompt](/es-419/features/capabilities/tools-and-extensions/#herramientas-integradas)
  `{memory_tool}` en su lugar, por ejemplo, *"Usa {memory_tool} siempre que..."*.
- Guárdala tú mismo con `/personal memories`, que es un método garantizado.

Los administradores del servidor pueden desactivar por completo el autoguardado con `/config` >
Permisos.

### Cuántas memorias

Por defecto conserva hasta 100 memorias personales y 100 memorias del servidor. Quienes
se autoalojan pueden cambiar esto con las variables de entorno `MAX_PERSONAL_MEMORIES`,
`MAX_SERVER_MEMORIES` y `MAX_MEMORY_LENGTH`. Subir la *longitud* cuesta mucho más contexto que
subir la *cantidad*, así que prefiere más memorias cortas en lugar de menos memorias largas.

Estos conteos son por persona, no por usuario ni por servidor. Cada persona mantiene su
propio conjunto, así que un servidor con cuatro personas activas tiene cuatro cupos separados.
Tus propias memorias personales globales cuentan contra el cupo personal de cada persona.

### Base de conocimiento de documentos (RAG)
<!-- anchor: document-knowledge-base-rag -->

Los administradores del servidor pueden darle documentos como referencia mediante RAG. Los
documentos se fragmentan y se almacenan como incrustaciones (embeddings) que se pueden buscar;
recupera automáticamente el contenido relevante al responder. En servidores nuevos, la gestión
de documentos también está restringida por defecto a miembros con `Administrar servidor`; los
administradores pueden otorgar acceso a miembros mediante Acceso de miembros en `/moderation`.

Requiere un modelo de incrustaciones, configurado con `/config` > Modelos > Cambiar modelos.
Consulta [Proveedores y modelos](/es-419/features/setup-administration/providers-and-models/).
La página Documentos en `/memories` ofrece alcances por persona y por servidor, conteos en vivo
de documentos y fragmentos, subidas, exploración de documentos y eliminación:

- Sube archivos de texto, PDF o Markdown como conocimiento del servidor. El alcance elige si
  está vinculado solo a esta persona (el predeterminado) o a todo el servidor para que lo
  consulten todas las personas.
- `/learn history`: extrae el historial de un canal en conocimiento consultable.
- Explora los documentos guardados fragmento por fragmento. Los administradores del servidor
  pueden editar fragmentos individuales, actualizar las etiquetas de canal de un documento, o
  eliminar un solo fragmento sin quitar el documento completo.
- Elimina documentos guardados o fragmentos individuales directamente desde el panel.

#### Prompts de importación de historial

Al importar el historial de un canal con `/learn history`, la opción `prompt` cambia cómo
TomoriBot extrae las memorias:

- Conversación extrae datos independientes de un chat normal. Resuelve pronombres y usa
  marcas de tiempo absolutas cuando se mencionan fechas u horas o se pueden inferir.
- Rol busca escenas, lore, relaciones y eventos memorables sin intentar preservar cada
  detalle pequeño.
- En personaje extrae memorias desde el punto de vista de la persona seleccionada, usando el
  prompt, los atributos, las memorias existentes y los documentos relevantes de esa persona como
  contexto.

El prompt se muestra antes de importar para que puedas ajustarlo según el canal o la escena.

Las importaciones de historial se almacenan como documentos, así que `/memories` también
funciona con ellas.

### Condicionamiento
<!-- anchor: conditioning -->

`/conditioning` es una memoria por persona y por servidor que orienta el comportamiento de una
persona con el tiempo. Un empujón más liviano que un atributo completo o un prompt del sistema.
Úsalo para reforzar cómo debería actuar un personaje específico en un servidor específico.

Cada `/reward` o `/punish` se contabiliza de todos modos, pero solo se convierte en una memoria
sobre la que realmente actúa cuando le das una `reason`, que aparece así en su prompt:

```text
## Rewarded Behaviors
Here are past things Tomori did that got rewarded for. Strive to do them again:
- [Tomori was fed by Amaori. Reason: `being extra helpful today` with `cookies`] (2 times)

## Punished Behaviors
Here are past things Tomori did that got punished for. Avoid doing them again:
- [Tomori was bonked by Amaori. Reason: `spamming pings after being told to stop`]
```

Sin una `reason`, el conteo queda registrado pero nunca aparece en su prompt. Revisa o borra
entradas con `/conditioning remove`.

## Controlar cuándo se activan las memorias

El alcance limita las cosas antes que nada más: una memoria del servidor solo llega a los
prompts de su propio servidor, una memoria personal solo cuando ese usuario es visible en la
conversación, y ambas solo para la persona que las posee. Dentro de ese alcance, **cada memoria
se envía con cada prompt** por defecto. El etiquetado lo limita aún más, así que una memoria se
activa solo con una palabra clave o solo en un canal. Actívalo con `/config` > Motor > Memoria y
STM.

### Etiquetas de palabra clave
<!-- anchor: keyword-tags -->

- Las memorias sin etiquetas de palabra clave están siempre activas (el valor
  predeterminado).
- Las memorias con etiquetas de palabra clave solo se activan cuando la palabra clave
  aparece en el contexto visible.
- Usa `/tool prompt snapshot` para ver qué memorias están activas en ese momento.

### Etiquetas de canal

- Las memorias con una etiqueta `#channel` se activan solo en ese canal.
- Las etiquetas de canal se combinan con las etiquetas de palabra clave.
- Si usas la base de conocimiento de documentos (RAG), las etiquetas de canal también se aplican
  a documentos e historiales extraídos.

En `/help`, elige `Memoria` y luego `Etiquetado de memoria`, para ver el mismo resumen en
Discord.

## Memoria a corto plazo (STM)
<!-- anchor: short-term-memory-stm -->

TomoriBot puede leer fácilmente los mensajes del canal actual en el que está hablando, pero la
STM le permite hacer lo siguiente sin guardar una memoria a largo plazo real:
1. Reforzar temporalmente el escenario/situación actual del canal en el contexto
2. Recordar temporalmente conversaciones de otros canales/servidores

Solo recuerda conversaciones en las que participó. Actualiza la memoria de un canal cuando
responde, y en ningún otro momento, así que un canal ocupado donde nadie le habla no deja
rastro.

La STM de cada canal expira después de 24 horas por defecto, y si decidiste no participar con
`/personal config`, tus mensajes tampoco entran nunca en ella.

### Qué puede y qué no puede ver

| Dónde | Qué significa eso |
|---|---|
| En un servidor | Una memoria compartida por canal, no una por persona. No lleva notas sobre ti individualmente. |
| En mensajes directos | Solo tuya. |
| Otros canales | Puede recordar sus conversaciones recientes de algunos otros canales en el mismo servidor. |
| Canales privados | Cualquier cosa configurada con `/config` > Canales > Reglas de canal se queda ahí y no aparecerá en otro lugar. |
| Otros servidores | Nunca, a menos que actives `/personal config` → `crossserver`. Aun así, solo *tus propias* conversaciones te siguen. |
| Cada persona | Mantiene su propia memoria separada, así que cambiar de persona cambia de memoria. |

La memoria de cada canal contiene los últimos mensajes más un resumen breve que ella misma
escribe y actualiza a medida que avanza la conversación. Se desvanece sola después de algunas
horas sin actividad.

### Comandos

| Comando | Qué hace |
|---|---|
| `/config` > Persona > Memorias | Ver el resumen que mantiene para este canal |
| `/config` > Persona > Memorias | Corregirlo o escribirlo tú mismo |
| `/personal config` / `/personal memories` | Activar el recuerdo entre servidores, o borrar el tuyo |
| `/refresh` | Hacer que olvide este canal de inmediato |
| `/config` > Motor > Memoria y STM | Con qué frecuencia lo actualiza, y cuánto detalle conserva |
| `/config` > Motor > Memoria y STM | Cambiar el resumen por hasta 5 campos etiquetados (*Escena actual*, *Ánimo*, …) |
| `/config` > Motor > Memoria y STM | Reformular cómo se le pide que lo conserve |
| `/memories` | Revisar y borrar selectivamente entradas activas del servidor desde un panel de administrador |
| `/config` > Permisos | Permitir que las memorias de canal privado aparezcan en otro lugar |
| `/config` > Permisos | Activar o desactivar la función (las memorias guardadas se conservan de todos modos) |

Cualquiera puede ejecutar `/config` > Persona > Memorias, `/personal config` y
`/personal memories`. El resto necesita Administrar servidor.

### Configuración de la STM

Los administradores del espacio de trabajo pueden ajustar la memoria a corto plazo desde
`/config` → `Comportamiento` → Memoria y STM. Estos ajustes se aplican a los registros
activos de STM del espacio de trabajo:

- Cadencia de actualización controla cuántos turnos del bot pasan entre empujones de
  actualización. El rango permitido es de 1 a 100.
- Modo de renderizado elige si los valores de categoría sustituyen a los turnos recientes o
  aparecen como un resumen simple.
- Mensajes sin procesar controla cuántos mensajes recientes se conservan, de 1 hasta el máximo
  del canal.
- Profundidad de aviso ubica el empujón de actualización desde el final del contexto
  ensamblado, de 0 a 20.
- Profundidad de contenido ubica el contenido de STM desde el final del contexto ensamblado,
  de -1 a 20.

Categorías de STM reemplaza el campo de Resumen predeterminado por hasta cinco campos
etiquetados. Ingresa cada campo como `Label: Description`; dejar todos los campos en blanco
restaura la categoría de Resumen predeterminada. Guardar categorías limpia la STM activa
incompatible de canal-servidor, y el panel muestra los canales afectados antes de guardar.

Prompt de STM permite a los administradores anular la descripción de la herramienta y el
empujón de actualización. Las anulaciones en blanco restauran los valores predeterminados
efectivos, incluido el empujón consciente de categoría cuando las categorías están activadas.

:::tip
Estos comandos de STM son solo para usuarios avanzados; se recomienda mantener los ajustes
predeterminados, a menos que quieras permitir que te recuerde entre servidores con
`/personal config`
:::

---

## Privacidad

Para saber exactamente qué almacena y cómo exportarlo o eliminarlo, consulta
[Manejo de datos](/es-419/features/knowledge/data-handling/) y `/legal privacy-policy`. Puedes
optar por no participar de la memoria por completo con `/personal config`.
