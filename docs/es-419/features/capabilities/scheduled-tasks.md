---
title: "Tareas programadas"
sidebar:
  order: 2
---

Configura recordatorios para usted o programe anuncios recurrentes sin salir del chat. Pregúntale directamente al robot y ella creará el cronograma por ti. Las tareas programadas pertenecen a la persona activa.

Los recordatorios notifican al usuario objetivo cuando dispara, mientras que las tareas automáticas son acciones que la persona realiza por sí sola a la hora programada.

## Crear una tarea

Dile qué programar en el chat:

```text
remind me to submit the report at 14:30
every Friday at 8pm, post a reminder that game night is starting
```

Ella analiza el tiempo solicitado y la recurrencia. Los recordatorios hacen ping al usuario objetivo cuando dispara. Las tareas son acciones silenciosas que la persona lleva a cabo cuando llega el momento.

## Zonas horarias

Las horas absolutas (como "a las 14:30" o "el viernes a las 8 p.m.") utilizan la zona horaria del servidor (`/config` > `Comportamiento` > `Comportamiento general`) de forma predeterminada. Si configura su propia zona horaria con `/personal config`, el bot convierte su hora local automáticamente. "recuérdamelo a las 9 a. m." significa tus 9:00 a. m., incluso si el servidor está en otra zona horaria. Los tiempos relativos (como "en 2 horas") no dependen de zonas horarias y siempre son seguros.

Cuando un recordatorio se dirige a un usuario cuya zona horaria personal difiere de la del servidor, la confirmación muestra ambos relojes: la hora del servidor y la hora local del objetivo. Si una hora está mal etiquetada, corríjala con un mensaje de seguimiento o `/scheduled-task edit`.

## Administrar tareas

Dos comandos de barra diagonal le permiten revisar y ajustar los horarios existentes:

- `/scheduled-task edit`: cambia el contenido de una tarea, la próxima hora de activación, el intervalo de recurrencia o el objetivo del recordatorio. Establece el intervalo en `0` para realizar una tarea recurrente por única vez.
- `/scheduled-task remove`: eliminar un recordatorio o tarea.

Ambos comandos abren un selector que enumera sus programaciones existentes por persona, hora, canal y recurrencia.

Un servidor puede almacenar hasta 100 recordatorios y tareas pendientes a la vez. Cuando esté lleno, TomoriBot te avisará en lugar de agregar otro; elimina los anteriores con `/scheduled-task remove` para liberar espacio.

## Cómo se entregan

Los recordatorios solo se marcan como completos después de que la entrega se realiza correctamente. Si se interrumpe la entrega, TomoriBot vuelve a intentarlo automáticamente sin alterar el cronograma recurrente.

Si la entrega falla repetidamente y alcanza el límite de reintentos, TomoriBot publica una advertencia con el contenido programado y el ID de la tarea. Los recordatorios de usuario fallidos hacen ping al objetivo para que no se pierda el recordatorio, mientras que las tareas automáticas fallidas no envían ping. Luego se eliminan las programaciones únicas, mientras que las programaciones recurrentes permanecen activas para la próxima aparición y se pueden administrar con `/scheduled-task edit` o `/scheduled-task remove`.

---

Para obtener más capacidades, consulte [Herramientas y extensiones](/es-419/features/capabilities/tools-and-extensions/).
