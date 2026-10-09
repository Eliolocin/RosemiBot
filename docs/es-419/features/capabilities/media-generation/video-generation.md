---
title: "Generación de videos"
sidebar:
  order: 2
---

TomoriBot puede generar videos cortos a partir de un mensaje de texto o animando una imagen existente. Utilice `/generate video` o pregúntele directamente en el chat.

## Qué puede hacer

- **Texto a vídeo**: genera un clip corto a partir de una descripción.
- **Imagen a vídeo**: anima una imagen. La primera imagen de un mensaje al que se hace referencia se convierte en el fotograma inicial.
- ** Bucle de imagen a video**: cuando se solicita a través del chat, los modelos compatibles pueden reutilizar la imagen inicial como fotograma final.
- **Relaciones de aspecto personalizables**.

La conversión de imagen a vídeo y el bucle dependen de la compatibilidad del primer y último fotograma del modelo seleccionado. TomoriBot verifica el catálogo de modelos de OpenRouter antes de enviar una generación y le pregunta si es necesario eliminar una imagen o un bucle para el modelo elegido.

Generar vídeo lleva tiempo: TomoriBot envía el trabajo al proveedor, comprueba que se haya completado en segundo plano y publica el vídeo terminado en el canal cuando esté listo.

## Configuración

1. Selecciona un modelo de video en `/config` > `Modelos` > `Cambiar modelos`.
2. Confirme que la generación de video esté habilitada en `/config` > `Permisos` (`video_generation_enabled`).
3. Pregúntale en el chat o ejecuta `/generate video`.

## Compatibilidad con proveedores

La generación de video nativo está disponible en Google, OpenRouter y Z.ai. Consulta la matriz completa en [Proveedores y modelos](/es-419/features/setup-administration/providers-and-models/#supported-providers).

Para la generación de video local a través de ComfyUI (como flujos de trabajo de imagen a video WAN), consulte [Configuración: ComfyUI](/es-419/self-hosting/local-endpoints/setup-comfyui/).

Para conocer la arquitectura de sondeo y generación interna, consulte la referencia en [generación de video](/en/architecture/subsystems/video-generation/).
