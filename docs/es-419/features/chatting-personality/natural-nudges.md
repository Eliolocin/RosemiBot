---
title: "Natural Nudges"
description: "Permite que tus personas de TomoriBot inicien conversaciones cuando un canal de Discord quede en silencio y se unan a aquellas que coincidan con sus intereses, a un ritmo adaptado a la actividad de tu servidor."
sidebar:
  order: 4
aiGenerated: true
---

Natural Nudges permite que TomoriBot hable sin haber sido mencionada, de dos maneras:

- **Intervenciones espontáneas**: cuando un canal se queda en silencio, una de tus personas elige algo que hacer, como saludar a alguien, retomar una conversación, plantear un nuevo tema o interpretar una breve escena con otra persona, publicándolo con su propia voz.
- **Intervenciones activas**: cuando los miembros hablan sobre algo que le gusta a una persona, esa persona se une a la charla.

Las intervenciones están pensadas para sentirse como un amigo que pasa a saludar:

- **El ritmo sigue al servidor**: los servidores que hablan con TomoriBot todos los días reciben cerca de una intervención espontánea al día; los servidores que rara vez le hablan no reciben ninguna, ni tampoco intervenciones activas.
- **Espera un momento natural**: una intervención espontánea solo comienza en un canal que haya estado en silencio entre una y tres horas, durante el horario en el que tu servidor suele estar despierto.
- **Guarda silencio si nadie responde**: cada intervención espontánea sin respuesta hace que la siguiente espere más tiempo, y tras tres consecutivas sin respuesta se detiene hasta que alguien vuelva a hablarle.
- **Ante la duda, no dice nada**: si alguien publica primero, el canal se vuelve concurrido o nada encaja, la intervención se descarta.

Natural Nudges solo funciona en servidores, nunca en mensajes directos (MD).

## Intervenciones activas
<!-- anchor: active-nudges -->

Una intervención activa ocurre cuando una persona se une a una conversación que ya está en marcha porque trata sobre algo que le gusta a esa persona. Así es como se produce:

1. Mientras los miembros conversan en un canal apto, TomoriBot cuenta sus mensajes. Los hilos cuentan como parte de su canal principal, y el conteo se reinicia cada vez que habla una persona.
2. Cada cierto tiempo (más pronto en servidores activos y con mayor frecuencia para las intervenciones activas), lee los últimos cinco mensajes y evalúa si la conversación trata realmente sobre los intereses de alguna de tus personas. Una mención pasajera no cuenta.
3. La persona con ese interés responde. Si varias personas comparten el mismo interés, suele participar la que haya estado más callada últimamente, mientras que una persona que acaba de hablar cede el turno. De vez en cuando otra persona toma el turno en su lugar, con mayor frecuencia una con la que el servidor hable poco.
4. La respuesta llega entre 15 y 45 segundos después, con la personalidad habitual de la persona. Si otra persona habla antes, los miembros cambian de tema o el canal se vuelve concurrido, no dice nada.

Existe como máximo una intervención activa por canal (incluidos hilos) por hora, además de un límite diario para todo el servidor. Una persona necesita tener intereses en su página de Intervenciones para participar, y las personas en silencio nunca lo hacen.

## Intervenciones espontáneas
<!-- anchor: idle-nudges -->

Cada intervención espontánea pertenece a una categoría:

| Categoría | Qué ocurre |
|---|---|
| **Mencionar a un usuario** | Una persona menciona a un miembro que conoce: para saludar, dar seguimiento a algo que comentaron, compartir un enlace que les pueda gustar, bromear sobre el juego al que están jugando u ofrecerles un recordatorio. |
| **Reanudar tema** | Una persona retoma una conversación que quedó pendiente: una pregunta sin respuesta, una segunda opinión o algo que buscó e investigó. |
| **Iniciar tema** | Una persona plantea algo nuevo, generalmente basado en sus propios intereses: un pensamiento, una opinión controvertida, un dilema de "qué preferirías", una noticia, una imagen o una nota de voz. |
| **Interpretar escena** | Dos o tres personas conversan entre sí en una escena breve de dos a cuatro mensajes: una discusión divertida, un plan "secreto" para un miembro, pedirse consejo mutuamente o mostrar una imagen. |

`/nudge-studio` (requiere Gestionar servidor) cuenta con una pestaña para cada categoría. Cada pestaña enumera las intervenciones espontáneas de esa categoría con un punto de color:

- 🟢 **Activada**: puede ser seleccionada.
- 🟡 **Activada, pero no puede ejecutarse aquí todavía**: ninguna persona cuenta con una herramienta necesaria, una escena no tiene una segunda persona o ninguna de las personas a las que está limitada puede intervenir. La fila indica qué falta.
- 🔴 **Desactivada**.

**Cambiar disponibilidad...** abre una intervención espontánea con una casilla para cada persona:

- **Todas las casillas marcadas**: cualquier persona puede usarla, incluidas las que agregues más adelante.
- **Algunas marcadas**: solo esas personas, y su fila las nombra, como "¿Te recuerdo algo? (solo Mirri y Juno)". Las personas que agregues más adelante quedan fuera hasta que las marques.
- **Ninguna marcada**: la intervención espontánea queda desactivada.

Debajo de la lista puedes añadir hasta 25 intervenciones propias para todo el servidor. Al elegir una se abre para edición; **Eliminar intervenciones personalizadas** muestra tus intervenciones espontáneas, y desmarcar una la elimina. Cada una incluye:

- **Nombre**.
- **Instrucción**: lo que la persona se propone hacer. Escribe `{persona}` donde va su nombre, `{partner}` para la otra persona en una escena y `{target}` para el miembro involucrado.
- **Propósito oculto** (opcional): la pequeña meta personal que la persona mantiene tras su mensaje inicial.
- **Requisitos**: lo que debe cumplirse antes de que la intervención espontánea pueda ejecutarse, como un recuerdo reciente o una herramienta disponible. Cada categoría ya incluye los suyos: un miembro al que mencionar, una conversación pendiente o una segunda persona.
- **Herramientas recomendadas**: herramientas que se alienta a la persona a usar cuando las tiene disponibles. La intervención espontánea se ejecuta igualmente sin ellas. Una herramienta seleccionada en Requisitos ya se considera obligatoria, por lo que se quita de esta lista al guardar.

### Mencionar a un usuario
<!-- anchor: ping-user -->

Este tipo de intervención espontánea menciona a un miembro por su nombre, por lo que solo elige a personas que la persona realmente conoce:

- **Hablaron con esta persona recientemente**: solo se pueden elegir miembros que hayan iniciado una conversación con esa persona en este servidor en los últimos 14 días. Haber sido mencionado o nombrado en una charla no cuenta, y tener cercanía con la misma persona en otro servidor tampoco cuenta.
- **La persona los conoce**: el miembro tiene un recuerdo con esta persona de los últimos 30 días, o un recuerdo a corto plazo (STM) reciente con ella.
- **No han optado por no participar**: cualquiera puede desactivar Menciones de personas para sí mismo en `/personal config` > Privacidad. Los miembros con privacidad Completa, los miembros en la lista negra de personalización del servidor y los miembros bloqueados por la persona nunca son seleccionados.

Entre esos miembros, los más cercanos son elegidos con mayor frecuencia: cada mensaje enviado a esa persona en este servidor en los últimos 14 días, y cada canal en el que hayan conversado recientemente, suma a sus probabilidades. Alguien a quien una persona mencionó en los últimos tres días tiene menos probabilidades de ser elegido de nuevo. La mención se dirige únicamente a ese miembro individual; una intervención de mención nunca menciona roles, `@everyone` ni a nadie más. Cualquier respuesta en el canal cuenta como contestación.

### Interpretar escena
<!-- anchor: play-scene -->

Una escena es un breve diálogo entre personas, de dos a cuatro mensajes de duración. La persona que toma la iniciativa abre la escena y elige a un compañero (a veces dos) de entre las otras personas autorizadas en ese canal. Las personas más habladoras se unen con mayor frecuencia, y las personas en silencio nunca lo hacen.

- **Los miembros son lo primero**: cuando cualquiera publica en el canal durante la escena, los mensajes restantes de la escena se descartan y la persona que estaba a punto de hablar le responde, como cuando alguien se une a una conversación. Si nombraron o mencionaron a una persona en particular, esa persona responde en su lugar.
- **Los planes se mantienen en privado**: las personas pueden tramar una sorpresa inofensiva para alguien que conocen, pero la escena no menciona a ese miembro.

### Propósitos ocultos

Junto con su mensaje de apertura, cada intervención espontánea le asigna a la persona una pequeña meta privada, como "averigua a quién más le gusta este anime". La meta se mantiene vinculada sobre la apertura y solo esa persona la ve, por lo que continúa persiguiendo el objetivo en sus respuestas posteriores. En una escena cada persona recibe su propia meta, que las demás nunca ven. Una vez que el mensaje de apertura sale del contexto que la persona recuerda, la meta desaparece. Los propósitos nunca solicitan datos personales, dinero ni nada fuera del chat. Los miembros autorizados para ver la instantánea del prompt pueden consultarlos.

## Configuración

Natural Nudges está activado de manera predeterminada y no requiere configuración previa. En cuanto los usuarios de un servidor comiencen a hablar con TomoriBot con regularidad, las intervenciones espontáneas y activas comenzarán en los canales donde conversan con ella.

Para cambiar su funcionamiento, abre `/config` > Plugins > Natural Nudges (requiere Gestionar servidor):

- **Intervenciones espontáneas** e **Intervenciones activas**: activa o desactiva cada modalidad por separado.
- **Canales**: funciona de manera automática con los canales donde los usuarios hablaron con TomoriBot en los últimos 14 días (excepto canales de rol). Puedes seleccionar canales específicos manualmente o limpiar la lista para volver al modo automático. Un canal donde otros bots publiquen con frecuencia nunca queda en silencio, por lo que se ignora automáticamente.
- **Selección de modelos**: elige los dos modelos de IA que utiliza Natural Nudges. Los modelos gratuitos de Google están sujetos a los términos de uso gratuito de Google, que permiten que Google utilice las conversaciones que se les envían.
  - **Planificador de intervenciones espontáneas**: planifica las intervenciones espontáneas. Por defecto es el modelo de chat del servidor. No todos los modelos pueden realizar esta tarea; si el tuyo no puede, el panel lo indicará y te permitirá elegir otro.
  - **Verificador de intervenciones activas**: revisa las conversaciones periódicamente para ver si coinciden con algún interés. Se ejecuta con mucha más frecuencia que el planificador, por lo que un modelo pequeño y económico es el más adecuado. Por defecto TomoriBot elige uno automáticamente: un modelo de decisiones (un modelo pequeño optimizado para responder preguntas de opción única) si el servidor cuenta con una clave de OpenRouter, Gemma 4 31B si cuenta con una clave de Google, o en su defecto el Planificador de intervenciones espontáneas. Puedes seleccionar cualquiera de ellos manualmente, incluidos modelos de decisiones personalizados.

El panel muestra qué tan activo es el servidor, cuántas intervenciones espontáneas esperar cada semana y con qué frecuencia revisa las conversaciones para intervenciones activas.

### Frecuencia

- **Frecuencia**: establece el ritmo por separado para intervenciones espontáneas y activas: Raras, Suaves (por defecto), Normales o Frecuentes. Incluso en nivel Frecuentes, permanecerá en silencio en un servidor que rara vez le habla a TomoriBot.
- **Límites diarios**: se adaptan al nivel de frecuencia: Raras permite 1 intervención espontánea y 1 activa al día; Suaves 3 de cada una; Normales 5 intervenciones espontáneas y 6 activas; Frecuentes 8 intervenciones espontáneas y 10 activas.
- **Límites de comprobación**: evitan que las intervenciones activas agoten la cuota de la clave de IA: TomoriBot revisa las conversaciones como máximo 10 veces al día en Raras, 20 en Suaves, 40 en Normales y 60 en Frecuentes. Tras una comprobación sin coincidencias, ese canal espera más tiempo antes de la siguiente, desde 10 minutos hasta 3 horas. Si el proveedor de IA indica que la clave alcanzó su límite, las intervenciones activas se pausan por 3 horas.

### Casos en que permanece desactivado

- **Las estadísticas de uso están desactivadas**: TomoriBot evalúa qué tan activo es un servidor a partir de sus estadísticas de uso. Si quien aloja tu bot las desactivó, las intervenciones nunca iniciarán.
- **Los miembros pagan con sus propias claves (BYOK)**: si tu servidor hace que cada miembro use su propia clave de IA, ninguna clave cubre un mensaje que nadie solicitó expresamente, por lo que Natural Nudges permanece desactivado.

## Configuración de personas

Cada persona tiene su propia página de **Intervenciones** en `/config` > Persona:

- **Locuacidad**: con qué frecuencia esta persona es la que interviene. Las personas en silencio nunca inician intervenciones espontáneas ni participan en las activas; las tímidas hablan menos y las habladoras con más frecuencia.
- **Intereses**: hasta 8 temas que a la persona le gusta plantear y sobre los que le gusta opinar, cada uno con una breve descripción y ejemplos (por ejemplo, **anime de mechas**: ficción sobre robots gigantes tripulados, como Gundam).

Los preajustes oficiales vienen con sus propios intereses y locuacidad. `/persona generate` sugiere intereses para nuevos personajes, y las exportaciones de personas los incluyen.

## Datos que se almacenan

Natural Nudges almacena tus ajustes, intervenciones espontáneas personalizadas e intereses de personas junto con el resto de la configuración del servidor. También recuerda qué intervenciones espontáneas y activas se ejecutaron recientemente, si alguien respondió y a quién se dirigió una mención durante 30 días, y cada propósito oculto hasta por 90 días. Al ejecutar `/reset` se restauran los ajustes y se eliminan las intervenciones personalizadas. `/export config` e `/import config` transfieren los ajustes y las intervenciones personalizadas, pero no la lista de canales elegidos (que pertenece a un servidor específico). Tu preferencia personal de Menciones de personas forma parte de tus ajustes personales: `/reset personal config` la conserva, `/export personal config` la transfiere y `/personal nuke` la elimina junto con el resto de tus datos.
