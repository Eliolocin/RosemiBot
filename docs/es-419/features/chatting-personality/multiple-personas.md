---
title: "Múltiples personas"
# Keyword-rich <title> targeting "AI companion Discord" queries; replaces
# Starlight's default "{title} | TomoriBot" for this page only. H1 and sidebar
# keep the plain title. The homepage title bets on "AI agent" + "roleplay" -
# this page carries the "companion" keyword instead.
head:
  - tag: title
    content: "TomoriBot | AI Companions & Personas for Your Discord Server"
# Hand-written search snippet; overrides the auto-derived description from
# routeData.ts middleware.
description: "Run multiple AI companions in one Discord server. Custom personas with their own avatars, triggers, and speaking styles."
sidebar:
  order: 2
---

La personalidad de TomoriBot se guarda en una persona: su nombre, avatar, rasgos, forma de hablar y comportamiento. Puedes usar varias personas a la vez, cada una como un personaje distinto con sus propias palabras de activación y avatar de webhook. Esta página explica cómo se comportan las personas. Para hechos y recuerdos, consulta [Memoria](/es-419/features/knowledge/memory/).

## Crear una persona

- `/persona create`: crea una persona personalizada desde cero.
- `/persona generate`: haga que la IA genere una persona a partir de un mensaje y una imagen (requiere un proveedor que admita resultados estructurados). También puede proporcionar una tarjeta TomoriBot preestablecida o SillyTavern existente (consulte [Soporte SillyTavern](/es-419/features/integrations/sillytavern-support/)).
- `/persona default`: cambia a uno de los caracteres predeterminados integrados.
- `/persona export` y `/persona import`: realice copias de seguridad o comparta archivos personales. La importación admite la adición de un personaje como personaje alternativo con sus propios activadores y avatar de webhook.
- `/persona remove`: eliminar una alter persona.

## Personas alter

Las personas alter permiten que varios personajes convivan en un servidor:

- Cada alter tiene su propia personalidad, palabras de activación y avatar de webhook, por lo que cada personaje publica con su nombre e imagen en el mismo canal.
- Varios alters pueden responder a un mismo mensaje, hasta el límite configurado en `/config` > `Comportamiento` > `Comportamiento de activación`.
- Responder directamente a un mensaje de webhook continúa la conversación con esa persona.
- Agrega alters con `/persona import`, seleccionando la opción de alter, y adminístralos con `/persona` y `/persona remove`.

Para conocer cómo se dirigen las respuestas y se identifica cada webhook, consulta la [arquitectura de múltiples personas](/en/architecture/subsystems/multi-persona/).

## Dar forma a la personalidad

Afina cómo se ve, habla y se comporta una persona:

### Atributos
<!-- anchor: attributes -->

Abre `/config` > `Persona` > `Identidad y personalidad` para definir rasgos de personalidad o detalles físicos (como `friendly`, `red hair` o `ends sentences with *Nya~*`).

### Diálogos de ejemplo
<!-- anchor: sample-dialogues -->

Abre `/config` > `Persona` > `Identidad y personalidad` para enseñarle su estilo de hablar con el ejemplo utilizando los marcadores de posición `{user}` y `{bot}`:

- `{user}`: reemplazado con el nombre para mostrar o apodo del usuario real.
- `{bot}`: reemplazada por su nombre personal actual.

```text
{user}: What's your favorite hobby?
{bot}: Fufu~ I like knitting tiny clothes for tiny plushies~♥
```

Consejos para ejemplos de diálogos eficaces:

- Escriba intercambios naturales que muestren en lugar de contar.
- Demuestre el tono y el vocabulario que desea que utilice.
- Agrega variedad en varios ejemplos para que pueda generalizar bien.

### Nombre y avatar

Abre `/config` > `Persona` > `Identidad y personalidad` para configurar cómo se llama y cargar su foto de perfil.

También puede configurar un mensaje de sistema personalizado en `/config` > `Comportamiento` > `Comportamiento general`; consulte [Ajustes de comportamiento](/es-419/features/chatting-personality/behavior-tweaking/).

### Hábitos de nomenclatura

Los administradores de servidores pueden abrir `/config` > `Persona` > Naming Habits para establecer cómo una persona se dirige a los miembros:

- Configura prefijos, sufijos y términos de dirección masculinos, femeninos y neutros separados.
- Diferentes personas pueden dirigirse al mismo usuario con diferentes títulos (como uno que lo llama "Capitán" y otro que lo llama "Senpai").
- Las anulaciones personales siguen a cada usuario a través de los servidores; consulte [Personalización](/es-419/features/knowledge/personalization/).

## Sprites (avatares de emoción)
<!-- anchor: sprites-emotion-avatars -->

Los sprites son avatares alternativos a los que cambia una persona durante una conversación para reflejar emociones (como `happy`, `mad` o `embarrassed`).

Al responder, elige el objeto que coincide con su emoción. Para usar uno, comienza la línea de respuesta con `PersonaName (label):` y Discord entrega ese mensaje con el avatar del sprite correspondiente. Si ningún objeto encaja, ella responde con su avatar predeterminado.

Administrar sprites en `/config` > `Persona` > Sprites (requiere Administrar servidor):

- **Agregar o reemplazar**: seleccione la persona, proporcione una etiqueta, cargue una imagen (PNG, JPG o GIF) y, opcionalmente, escriba instrucciones de uso que describan cuándo mostrarla.
- **Editar**: actualiza la etiqueta, imagen o instrucciones de un objeto existente.
- **Eliminar**: elimina los sprites que ya no deseas.
- **Exportar e importar**: comparte o haz una copia de seguridad del paquete completo de sprites de la persona como un archivo.

La palanca `Guardar como identidad` muestra el autor del mensaje como `Label (Persona)` en Discord, útil para caracteres con múltiples formas.

Reemplazar el avatar de una persona predeterminada borra sus sprites incorporados, porque representan el personaje original. Los sprites que agregaste tú mismo permanecen intactos. La ejecución de `/persona default` restaura los sprites integrados.

## Elección de persona por canal

Para elegir qué persona le responde en un canal específico sin cambiar la configuración de todo el servidor, utilice Personal Spotlight; consulte [Personalización](/es-419/features/knowledge/personalization/#personal-spotlight).
