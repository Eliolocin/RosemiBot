---
title: "Compatibilidad con SillyTavern"
head:
  - tag: title
    content: "TomoriBot | Usa tarjetas de personaje de SillyTavern en Discord"
description: "Importa tarjetas de personaje y preajustes de prompt de SillyTavern a Discord con TomoriBot. Trae tus personajes existentes a tu servidor."
sidebar:
  order: 2
---

TomoriBot puede importar dos recursos desde [SillyTavern](https://github.com/SillyTavern/SillyTavern): ajustes preestablecidos del Administrador de mensajes (que controlan la estructura de mensajes) y tarjetas de personajes (la definición del personaje). Si nunca ha utilizado SillyTavern, puede saltarse esta página de forma segura.

## Importación de tarjetas de personaje

Trae un personaje SillyTavern existente a Discord con `/persona import`. Acepta:

- **Tarjetas PNG** con metadatos `chara` o `char` integrados.
- Tarjetas **JSON estilo v2** con propiedades de nivel raíz (`name`, `description`, `first_mes`).
- Tarjetas **v3 JSON** (`spec: "chara_card_v3"` con un objeto `data` anidado).
- **Archivos `.charx`** (paquetes de Character Card V3).

Un archivo `.charx` es un archivo ZIP que contiene una definición de `card.json`. TomoriBot importa el texto de caracteres de `card.json` y omite los archivos de activos incluidos (iconos, sprites, audio, video). Puedes configurar un avatar en `/config` > `Persona` > `Identidad y personalidad` y agregar sprites en `/config` > `Persona` > Sprites.

Si un archivo cargado es una tarjeta SillyTavern válida sin metadatos TomoriBot, la importación lo convierte automáticamente. También puedes pasar una tarjeta a `/persona generate` para crear una nueva personalidad inspirada en el personaje.

Las importaciones se validan antes de guardar (límites predeterminados: 5000 caracteres por campo de texto, 200 atributos, 100 diálogos de muestra por lado, 100 palabras de activación). Para conocer la mecánica de conversión y mapeo de campos, consulte la [arquitectura de soporte de tarjeta](/en/architecture/integrations/sillytavern/card-support/).

## Preajustes de prompt
<!-- anchor: prompt-presets -->

Un ajuste preestablecido del Administrador de mensajes SillyTavern controla el orden y el diseño del mensaje enviado al modelo. Abre `/config` > `Plugins` > SillyTavern Presets para importar ajustes preestablecidos, alternar nodos individuales, cambiar ajustes preestablecidos activos o restaurar el formato predeterminado.

### Qué controla un preajuste

- Pedido rápido y colocación de marcadores.
- Nodos de aviso personalizados
- Nodos posteriores a la historia y de inyección profunda.
- Estado inicial habilitado para nodos importados

### Lo que un preset no reemplaza

Un diseño de aviso de estructuras preestablecidas; no reemplaza las fuentes de texto que lo completan:

- Instrucciones del sistema y campos de persona: `/config` > `Comportamiento` > `Comportamiento general`, `/config` > `Persona` > Avanzado y `/config` > `Persona` > `Identidad y personalidad`.
- Historial de chat en vivo y contexto del documento recuperado.
- Contexto automático: memorias del servidor, datos de emojis y stickers, listas de participantes y memorias a corto plazo.

### Cómo se mapean los bloques nativos

Los bloques nativos se asignan directamente a los componentes del mensaje TomoriBot:

- `main`: el indicador del sistema activo (`/config` > `Comportamiento` > `Comportamiento general`, o el respaldo predeterminado)
- `charDescription`: `/config` > `Persona` > Avanzado
- `charPersonality`: `/config` > `Persona` > `Identidad y personalidad`
- `dialogueExamples`: `/config` > `Persona` > `Identidad y personalidad`
- `chatHistory`: historial de mensajes del canal en vivo
- `worldInfoBefore` y `worldInfoAfter`: contexto del documento recuperado (no libros de historia de SillyTavern)

### Regla del prompt del sistema

Cuando un ajuste preestablecido importado está activo, se elimina el mensaje del sistema de respaldo incorporado. Sin embargo, si configura un mensaje del sistema personalizado en `/config` > `Comportamiento` > `Comportamiento general`, ese mensaje siempre se incluye.

### Notas de compatibilidad

- Los nodos deshabilitados en `prompt_order` permanecen inactivos hasta que se habilitan en `/config` > `Plugins` > SillyTavern Presets. Los nodos vacíos y de solo comentarios nunca se envían.
- El orden de los bloques es literal: colocar `chatHistory` delante de `dialogueExamples` coloca el historial de chat primero en el mensaje.
- Las inyecciones posteriores al historial se fusionan con el historial de conversaciones existente en lugar de enviarse como mensajes independientes.
- No se admiten el posprocesamiento de expresiones regulares, los parámetros de muestreo predefinidos (temperatura, top-p) ni los ajustes preestablecidos en capas. Los ajustes preestablecidos de finalización de texto heredados se importan con bloques solo ST eliminados.

En `/help`, elija `Plugins`, luego `Preajustes de SillyTavern`, para la guía Discord. Para el procesamiento interno preestablecido, consulte la [arquitectura del sistema preestablecido](/en/architecture/integrations/sillytavern/preset-system/).
