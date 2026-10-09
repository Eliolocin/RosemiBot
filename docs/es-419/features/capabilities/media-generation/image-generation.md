---
title: "Generación de imágenes"
sidebar:
  order: 1
---

TomoriBot puede generar imágenes a partir de un mensaje de texto o editando una imagen de referencia. Usa `/generate image` o describe lo que quieres en el chat ("dibuja un panda rojo tomando café").

## Qué puede hacer

- **Texto a imagen**: genera una imagen a partir de una descripción.
- **Imagen a imagen**: edita o cambia el estilo de una imagen existente.
- **Inpainting**: vuelve a dibujar una región específica manteniendo el resto.
- **Pintura exterior**: extiende el lienzo más allá del marco original.
- **Relaciones de aspecto personalizables**.
- **Imágenes de referencia**: extraídas de archivos adjuntos de mensajes, stickers, emojis o avatares de usuarios y personas. Mencione a un usuario o persona para utilizar su avatar como referencia.

Los modos de edición disponibles dependen del backend activo. Trabajo de texto a imagen e imagen a imagen en proveedores de nube (Google, Vertex, OpenRouter). La pintura interna y externa son compatibles con los puntos finales personalizados locales [ComfyUI](/es-419/self-hosting/local-endpoints/setup-comfyui/) y dependen de las capacidades declaradas de ese punto final. Los modos que su configuración no admite se ocultan automáticamente del modelo.

Cuando genera una imagen, combina las etiquetas de apariencia de su persona con etiquetas positivas y negativas en todo el servidor (cuando sea compatible). El resultado llega como una galería multimedia Discord con detalles de generación, incluidos los usuarios o personas a los que se hace referencia.

## Personalizar etiquetas
<!-- anchor: tag-customization -->

Cada fuente de etiqueta se puede editar en su lugar con un modal precargado:

- **`/config` > `Persona` > `Detalles de generación de imágenes`**: las etiquetas `Apariencia Física` de la persona seleccionada (cómo se ve). Requiere el permiso Administrar servidor.
- **`/personal config`**: tus propias etiquetas de apariencia, que se aplican cada vez que una generación de imágenes hace referencia a ti. Te sigue en todos los servidores (consulte [Personalización](/es-419/features/knowledge/personalization/)).
- **`/config` > `Modelos` > `Valores de imagen`**: use `Editar positivo` y `Editar negativo` para configurar etiquetas predeterminadas agregadas o alejadas de cada generación. Las etiquetas negativas solo se aplican cuando el backend admite mensajes negativos. Al enviar un cuadro vacío se restablecen los valores predeterminados integrados.

## Configuración

1. Configura un modelo de imagen con `/config` > `Modelos` > `Cambiar modelos`.
2. Habilita la generación de imágenes en `/config` > `Permisos` (`imagegen_enabled`).
3. Pregúntale en el chat o ejecuta `/generate image`.

## Compatibilidad con proveedores

La generación de imágenes nativas está disponible en Google, Vertex AI, Vertex AI Express, OpenRouter, Z.ai, NVIDIA NIM y NovelAI (estilo anime). Para obtener la matriz de proveedores completa, consulte [Proveedores y modelos](/es-419/features/setup-administration/providers-and-models/#supported-providers).

Para la generación local en su propio hardware a través de ComfyUI, consulte [Configuración: ComfyUI](/es-419/self-hosting/local-endpoints/setup-comfyui/).
